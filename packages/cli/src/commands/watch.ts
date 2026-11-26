/**
 * `xessa watch` — incremental rebuilds until interrupted.
 *
 * The watcher performs an initial full build, then watches the directories that
 * hold entry sources and their import dependencies. Events are debounced, mapped
 * through a reverse import graph (built from `CompileResult.dependencies`) to the
 * affected entries, and serialized: one build runs at a time and any event that
 * arrives mid-build invalidates it through a generation counter, so a stale
 * result never lands on disk.
 *
 * Sources (`.cssx`), the configuration file and directory events trigger work.
 * Generated CSS, JS, declarations, maps, writer temporaries and the manifest are
 * matched against the known artifact set and ignored, so the watcher cannot feed
 * back on its own outputs. Deletions and unhandled paths trigger a full
 * rediscovery through the include globs.
 */

import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import type { CliInvocation } from "../args.js";
import type { CliConfig } from "../config.js";
import { staticDirectoryPrefix } from "../glob.js";
import { MANIFEST_FILENAME } from "../manifest.js";
import { dirnamePosix, joinPosix, relativePosix } from "../paths.js";
import { type ProjectContext, prepareProject } from "../project.js";
import { invocationFailure, writeErrorLine, writeLine } from "../report.js";
import { emitReport, executeBuild, toJsonReport } from "./build.js";

/**
 * Debounce window for filesystem events in milliseconds.
 *
 * Exported so integration tests can reason about event coalescing instead of
 * guessing at a sleep, and reported in the JSON `watch` ready event. Changing it
 * only affects latency, never correctness: every build is still awaited through
 * its emitted build event.
 */
export const WATCH_DEBOUNCE_MS = 40;

/** Options for {@link runWatch}. */
export interface WatchOptions {
  /** Parsed invocation with the optional single-entry file argument. */
  readonly invocation: CliInvocation;
  /** Working directory used to resolve relative paths. */
  readonly cwd: string;
  /** Abort signal that stops the watcher; defaults to SIGINT/SIGTERM. */
  readonly signal?: AbortSignal;
}

interface WatchState {
  context: ProjectContext;
  config: CliConfig | null;
  /** Source path (entry or dependency) to the entries depending on it. */
  reverse: Map<string, Set<string>>;
  /** Every known source file: entries plus dependencies. */
  sources: Set<string>;
  /** Workspace-relative artifact paths, so the watcher ignores its own writes. */
  artifacts: Set<string>;
  /** Build generation, bumped by every filesystem event. */
  generation: number;
}

/** Run `xessa watch [file]` until aborted. */
export async function runWatch(options: WatchOptions): Promise<number> {
  const { invocation, cwd } = options;
  const controller = options.signal === undefined ? new AbortController() : undefined;
  const signal = options.signal ?? controller?.signal;
  if (controller !== undefined) {
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
  }
  if (signal === undefined) return 2;

  const prepared = await prepareProject(invocation, cwd);
  if (!prepared.ok) return invocationFailure(invocation.command, prepared.message, invocation.json);
  if (!prepared.context.singleEntry && prepared.context.entries.length === 0) {
    return invocationFailure(
      invocation.command,
      "No .cssx sources matched the project include globs.",
      invocation.json,
    );
  }

  const state: WatchState = {
    context: prepared.context,
    config: prepared.context.config,
    reverse: new Map(),
    sources: new Set(),
    artifacts: new Set(),
    generation: 0,
  };

  const watchers = new Map<string, FSWatcher>();
  const pending = new Set<string>();
  let pendingUnknown = false;
  let pendingConfig = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  /**
   * Latched wakeup. `notify()` runs while no waiter exists (the build cycle is
   * in flight), so the request is remembered here and the next `waitForWork()`
   * returns immediately instead of sleeping until an unrelated event arrives.
   */
  let pendingWake = false;

  const notify = (): void => {
    const resolve = wake;
    wake = undefined;
    if (resolve === undefined) pendingWake = true;
    else resolve();
  };
  const waitForWork = (): Promise<void> => {
    if (signal.aborted) return Promise.resolve();
    if (pendingWake) {
      pendingWake = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      wake = resolve;
    });
  };
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const schedule = (absolute: string | null): void => {
    if (absolute === null) {
      pendingUnknown = true;
    } else {
      const relative = relativePosix(state.context.root, absolute);
      if (relative === "" || relative.startsWith("../")) pendingUnknown = true;
      else pending.add(relative);
    }
    // Any event invalidates an in-flight build generation.
    state.generation += 1;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      notify();
    }, WATCH_DEBOUNCE_MS);
  };

  const closeAll = (): void => {
    clearTimer();
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
  const onAbort = (): void => {
    closeAll();
    notify();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const watchDirectory = (directory: string): void => {
    if (watchers.has(directory)) return;
    try {
      const watcher = watch(directory, { persistent: true }, (_event, filename) => {
        if (typeof filename === "string") {
          if (filename === "") return;
          const absolute = joinPosix(directory, filename);
          if (state.config !== null && absolute === state.config.file) {
            pendingConfig = true;
            schedule(absolute);
            return;
          }
          const relative = relativePosix(state.context.root, absolute);
          if (relative === "" || relative.startsWith("../")) {
            schedule(null);
            return;
          }
          // Generated artifacts, the manifest and the writer's temporaries are
          // our own output: never rebuild because we wrote them.
          if (relative === MANIFEST_FILENAME) return;
          if (relative.endsWith(".cssx-tmp")) return;
          if (state.artifacts.has(relative)) return;
          if (relative.endsWith(".cssx")) {
            schedule(absolute);
            return;
          }
          // A directory creation/removal or an unknown entry: rediscover the
          // include globs so a brand-new source tree becomes visible without a
          // restart. This replaces the old "only `.cssx` filenames matter" rule.
          schedule(null);
          return;
        }
        schedule(null);
      });
      watcher.on("error", () => {
        watchers.delete(directory);
      });
      watchers.set(directory, watcher);
    } catch {
      // Missing or unwatchable directories are skipped; rediscovery retries.
    }
  };

  const syncWatchers = (): void => {
    const desired = new Set<string>();
    desired.add(state.context.root);
    if (state.config !== null) desired.add(dirnamePosix(state.config.file));
    for (const source of state.sources) {
      desired.add(dirnamePosix(joinPosix(state.context.root, source)));
    }
    for (const pattern of state.config?.include ?? []) {
      const prefix = staticDirectoryPrefix(pattern);
      desired.add(prefix === "" ? state.context.root : joinPosix(state.context.root, prefix));
    }
    for (const directory of desired) watchDirectory(directory);
    for (const [directory, watcher] of watchers) {
      if (desired.has(directory)) continue;
      watcher.close();
      watchers.delete(directory);
    }
  };

  const updateGraph = (report: Awaited<ReturnType<typeof executeBuild>>["report"]): void => {
    const reverse = new Map<string, Set<string>>();
    const sources = new Set<string>();
    for (const entry of report.entries) {
      sources.add(entry.file);
      const self = reverse.get(entry.file) ?? new Set<string>();
      self.add(entry.file);
      reverse.set(entry.file, self);
      for (const dependency of entry.dependencies) {
        sources.add(dependency);
        const affected = reverse.get(dependency) ?? new Set<string>();
        affected.add(entry.file);
        reverse.set(dependency, affected);
      }
      for (const output of entry.outputs) state.artifacts.add(output.path);
    }
    state.reverse = reverse;
    state.sources = sources;
  };

  const runCycle = async (entries: readonly string[], prune: boolean): Promise<void> => {
    const generation = state.generation;
    let outcome: Awaited<ReturnType<typeof executeBuild>> | undefined;
    try {
      outcome = await executeBuild({
        context: { ...state.context, entries },
        write: true,
        dryRun: false,
        prune,
        ...(invocation.minify === undefined ? {} : { minify: invocation.minify }),
        isCurrent: () => state.generation === generation,
      });
    } catch (error) {
      writeErrorLine(`xessa watch: build failed: ${describeError(error)}`);
    }

    if (outcome !== undefined && !outcome.stale) {
      updateGraph(outcome.report);
    }
    // Watchers must be attached (or refreshed) before the build event is
    // reported, so consumers that react to the event cannot race attachment.
    syncWatchers();
    if (outcome === undefined) return;
    if (outcome.stale) {
      writeLine("xessa watch: discarded a stale build generation");
      return;
    }
    if (invocation.json) {
      // True NDJSON: one compact JSON object per line, so consumers can parse
      // the stream incrementally.
      writeLine(JSON.stringify({ type: "build", ...toJsonReport(outcome.report) }));
    } else {
      emitReport(outcome.report, false);
    }
  };

  // Initial full build.
  await runCycle(state.context.entries, !state.context.singleEntry);

  if (invocation.json) {
    // Readiness handshake: emitted only after the initial build and watcher
    // attachment, so tests never guess when it is safe to touch files.
    writeLine(
      JSON.stringify({
        type: "watch",
        ready: true,
        sources: state.sources.size,
        debounceMs: WATCH_DEBOUNCE_MS,
      }),
    );
  } else {
    writeLine(
      `xessa watch: watching ${state.sources.size} source${state.sources.size === 1 ? "" : "s"} (Ctrl+C to stop)`,
    );
  }

  while (!signal.aborted) {
    await waitForWork();
    if (signal.aborted) break;

    const changes = [...pending];
    pending.clear();
    const configChanged = pendingConfig;
    pendingConfig = false;
    const unknown = pendingUnknown;
    pendingUnknown = false;

    if (changes.length === 0 && !configChanged && !unknown) continue;

    let full = configChanged || unknown;
    if (!full) {
      for (const change of changes) {
        if (!(await isFile(joinPosix(state.context.root, change)))) {
          full = true;
          break;
        }
      }
    }

    if (full) {
      const refreshed = await prepareProject(invocation, cwd);
      if (!refreshed.ok) {
        writeErrorLine(`xessa watch: configuration error: ${refreshed.message}`);
        continue;
      }
      state.context = refreshed.context;
      state.config = refreshed.context.config;
      await runCycle(state.context.entries, !state.context.singleEntry);
      continue;
    }

    const affected = new Set<string>();
    for (const change of changes) {
      const dependents = state.reverse.get(change);
      if (dependents === undefined) {
        full = true;
        break;
      }
      for (const entry of dependents) affected.add(entry);
    }
    if (full) {
      const refreshed = await prepareProject(invocation, cwd);
      if (!refreshed.ok) continue;
      state.context = refreshed.context;
      state.config = refreshed.context.config;
      await runCycle(state.context.entries, !state.context.singleEntry);
      continue;
    }

    const entries = [...affected].filter((entry) => state.sources.has(entry)).sort();
    if (entries.length === 0) continue;
    await runCycle(entries, false);
  }

  signal.removeEventListener("abort", onAbort);
  closeAll();
  return 0;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
