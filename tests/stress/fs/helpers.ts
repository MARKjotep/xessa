/**
 * Shared harness for the TT3 filesystem / output-planner stress cases.
 *
 * Every case builds a project in a fresh `mkdtemp` directory under the OS temp
 * dir (never the repository, `examples/` or `tests/fixtures/`), drives the real
 * CLI as a subprocess, and cleans up afterwards. Nothing here writes into the
 * repository.
 *
 * Temp roots are canonicalized with `realpathSync` before use: on macOS
 * `os.tmpdir()` returns `/var/folders/...` while the kernel path is
 * `/private/var/folders/...`, and a lexical root would make the compiler's
 * lexical workspace-containment checks disagree with the host's canonical one
 * (observed while writing these cases; see `.ai/reports/CSSX-TT3.md`).
 *
 * Paths crossing this module are POSIX-style (`/`) and relative to the project
 * root unless named `absolute`.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root as an absolute path with forward slashes. */
export const repoRoot = toPosix(fileURLToPath(new URL("../../../", import.meta.url)));

/** CLI TypeScript entry point. */
export const cliEntry = join(repoRoot, "packages/cli/src/index.ts");

/** Directory holding every temporary project created by this worker. */
const temporaryProjects: string[] = [];

/** Convert platform separators to forward slashes. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Create a fresh temporary project and write the given files into it.
 *
 * `files` is keyed by POSIX path relative to the project root; parent
 * directories are created as needed. The returned root is canonical, so
 * lexical and canonical containment agree (see the module note).
 */
export async function createProject(files: Readonly<Record<string, string>>): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "xessa-fs-"));
  const root = toPosix(realpathSync(created));
  temporaryProjects.push(root);
  for (const [path, content] of Object.entries(files)) {
    await writeProjectFile(root, path, content);
  }
  return root;
}

/** Write one UTF-8 file inside a project, creating parent directories. */
export async function writeProjectFile(root: string, path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

/** Write one JSON document inside a project with a trailing newline. */
export async function writeProjectJson(root: string, path: string, value: unknown): Promise<void> {
  await writeProjectFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Read one UTF-8 file, returning `null` when it is absent. */
export async function readProjectFile(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

/** Whether a project path exists (any file type). */
export async function projectPathExists(root: string, path: string): Promise<boolean> {
  try {
    await stat(join(root, path));
    return true;
  } catch {
    return false;
  }
}

/** Remove one project path recursively. */
export async function removeProjectPath(root: string, path: string): Promise<void> {
  await rm(join(root, path), { recursive: true, force: true });
}

/** Every file below a directory, as sorted POSIX paths relative to it. */
export function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(relative === "" ? root : join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk("");
  return found.sort();
}

/** Remove every temporary project created by this worker. */
export async function cleanupProjects(): Promise<void> {
  await Promise.all(
    temporaryProjects.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

/** Result of one CLI subprocess run. */
export interface CliResult {
  /** Exit status, or `-1` when the process was killed or failed to start. */
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one CLI invocation synchronously in `cwd`. */
export function runCli(args: readonly string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Minimal shape of the `--json` build report this suite asserts on. */
export interface JsonReport {
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly dryRun: boolean;
  readonly workspaceRoot: string;
  readonly configFile: string | null;
  readonly entries: ReadonlyArray<{
    readonly file: string;
    readonly dependencies: readonly string[];
    readonly outputs: ReadonlyArray<{
      readonly kind: string;
      readonly path: string;
      readonly written: boolean;
      readonly reason?: string;
    }>;
    readonly diagnostics: readonly JsonDiagnostic[];
  }>;
  readonly diagnostics: readonly JsonDiagnostic[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Minimal shape of a positioned CLI diagnostic. */
export interface JsonDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** Parse a `--json` report, failing with the raw text when it is not JSON. */
export function parseReport(result: CliResult): JsonReport {
  try {
    return JSON.parse(result.stdout) as JsonReport;
  } catch {
    throw new Error(
      `expected a JSON report from \`${result.stdout.slice(0, 200)}\` ` +
        `(status ${result.status}, stderr ${result.stderr.slice(-800)})`,
    );
  }
}

/** Run `xessa build --json` and parse the report. */
export function buildReport(args: readonly string[], cwd: string): JsonReport {
  return parseReport(runCli(["build", "--json", ...args], cwd));
}

/** Every diagnostic code in a report, in report order. */
export function diagnosticCodes(report: JsonReport): string[] {
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Whether any report diagnostic carries a code. */
export function hasCode(report: JsonReport, code: string): boolean {
  return report.diagnostics.some((diagnostic) => diagnostic.code === code);
}

/** Every diagnostic message in a report, in report order. */
export function diagnosticMessages(report: JsonReport): string[] {
  return report.diagnostics.map((diagnostic) => diagnostic.message);
}

/** Shape of the on-disk output manifest this suite asserts on. */
export interface ManifestDocument {
  readonly version: number;
  readonly files: ReadonlyArray<{
    readonly kind: string;
    readonly path: string;
    readonly source: string;
    readonly hash: string;
  }>;
}

/** Read `.cssx-manifest.json`, or `null` when it is absent. */
export async function readManifest(root: string): Promise<ManifestDocument | null> {
  const text = await readProjectFile(root, ".cssx-manifest.json");
  return text === null ? null : (JSON.parse(text) as ManifestDocument);
}

/** Remove the output manifest. */
export async function deleteManifest(root: string): Promise<void> {
  await rm(join(root, ".cssx-manifest.json"), { force: true });
}

/** Poll `predicate` until it is true, throwing a labelled timeout otherwise. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error(`[${label}] timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** One NDJSON event from `xessa watch --json`. */
export interface WatchEvent {
  readonly type?: string;
  readonly [key: string]: unknown;
}

/** A `build` event from the watcher's NDJSON stream. */
export interface WatchBuild extends WatchEvent {
  readonly type: "build";
  readonly success: boolean;
  readonly exitCode: number;
  readonly entries: ReadonlyArray<{
    readonly file: string;
    readonly outputs: ReadonlyArray<{ kind: string; path: string; written: boolean }>;
    readonly diagnostics: ReadonlyArray<JsonDiagnostic>;
  }>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** A `watch` readiness event from the watcher's NDJSON stream. */
export interface WatchReady extends WatchEvent {
  readonly type: "watch";
  readonly ready: boolean;
  readonly sources: number;
  readonly debounceMs: number;
}

/** Handle on a running watcher process. */
export interface WatchHarness {
  /** Every event observed so far, in arrival order. */
  readonly events: readonly WatchEvent[];
  /** Every `build` event observed so far, in arrival order. */
  builds(): WatchBuild[];
  /** Await the readiness handshake (initial build finished, watchers attached). */
  awaitReady(label?: string): Promise<WatchReady>;
  /** Await the next unconsumed `build` event. */
  nextBuild(label: string): Promise<WatchBuild>;
  /** Await the next unconsumed `build` event matching `predicate`. */
  nextBuildMatching(
    label: string,
    predicate: (build: WatchBuild) => boolean,
    timeoutMs?: number,
  ): Promise<WatchBuild>;
  /** Await an unconsumed `build` event, or `null` when none arrives in time. */
  quietNextBuild(label: string, timeoutMs: number): Promise<WatchBuild | null>;
  /** Stop the child (SIGINT, escalating to SIGKILL) and return its exit code. */
  stop(): Promise<number>;
}

/** Bound for every watcher event await. */
const WATCH_TIMEOUT_MS = 15_000;

/**
 * Start `xessa watch --json` in `root` and expose its NDJSON event stream.
 *
 * Every await is bounded and reports the event types seen so far plus the
 * stderr tail, so a stall identifies the await instead of hanging the suite.
 */
export function startWatch(root: string, args: readonly string[] = []): WatchHarness {
  const child = spawn(process.execPath, [cliEntry, "watch", "--json", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout === null || stderr === null) {
    throw new Error("watch process did not expose piped stdout/stderr");
  }

  const events: WatchEvent[] = [];
  let buffer = "";
  let stderrText = "";
  let stopped = false;

  stdout.setEncoding("utf8");
  stderr.setEncoding("utf8");
  stderr.on("data", (chunk: string) => {
    stderrText = `${stderrText}${chunk}`.slice(-8_000);
  });
  stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      try {
        events.push(JSON.parse(line) as WatchEvent);
      } catch {
        events.push({ type: "text", text: line });
      }
    }
  });

  const diagnostics = (label: string): string =>
    `[${label}] event types: ${JSON.stringify(events.map((event) => event.type))}; ` +
    `stderr tail: ${stderrText.slice(-1_000) || "(empty)"}`;

  // Events are consumed in arrival order: every `build` await advances `cursor`
  // past the event it returned, so no case can silently assert on an older one.
  let cursor = 0;

  const awaitEvent = async (
    label: string,
    predicate: (event: WatchEvent) => boolean,
    timeoutMs: number,
  ): Promise<WatchEvent | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let index = cursor; index < events.length; index += 1) {
        const event = events[index];
        if (event === undefined || !predicate(event)) continue;
        cursor = index + 1;
        return event;
      }
      if (Date.now() >= deadline) {
        if (timeoutMs < WATCH_TIMEOUT_MS) return null;
        throw new Error(`[${label}] timed out: ${diagnostics(label)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  const isBuild = (event: WatchEvent): boolean => event.type === "build";
  const builds = (): WatchBuild[] => events.filter(isBuild) as WatchBuild[];

  return {
    events,
    builds,
    awaitReady: async (label = "watch ready") => {
      cursor = 0;
      const event = await awaitEvent(
        label,
        (candidate) => candidate.type === "watch" && candidate.ready === true,
        WATCH_TIMEOUT_MS,
      );
      if (event === null) {
        throw new Error(`[${label}] readiness handshake missing: ${diagnostics(label)}`);
      }
      return event as WatchReady;
    },
    nextBuild: async (label: string) => {
      const event = await awaitEvent(label, isBuild, WATCH_TIMEOUT_MS);
      if (event === null) {
        throw new Error(`[${label}] no build event: ${diagnostics(label)}`);
      }
      return event as WatchBuild;
    },
    nextBuildMatching: async (
      label: string,
      predicate: (build: WatchBuild) => boolean,
      timeoutMs = WATCH_TIMEOUT_MS,
    ) => {
      const event = await awaitEvent(
        label,
        (candidate) => isBuild(candidate) && predicate(candidate as WatchBuild),
        timeoutMs,
      );
      if (event === null) {
        throw new Error(`[${label}] no matching build event: ${diagnostics(label)}`);
      }
      return event as WatchBuild;
    },
    quietNextBuild: async (label: string, timeoutMs: number) => {
      const event = await awaitEvent(label, isBuild, timeoutMs);
      return event as WatchBuild | null;
    },
    stop: async (): Promise<number> => {
      if (stopped) return child.exitCode ?? 0;
      stopped = true;
      child.kill("SIGINT");
      const exited = await Promise.race([
        new Promise<number>((resolve) => child.once("exit", () => resolve(1))),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
      ]);
      if (exited === "timeout") {
        child.kill("SIGKILL");
      }
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
      return child.exitCode ?? 0;
    },
  };
}

/** Build the config document used by most filesystem cases. */
export function projectConfig(
  options: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly cssDir?: string;
    readonly mapDir?: string;
    readonly emitMap?: boolean;
    readonly emitTypes?: boolean;
    readonly strict?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    include: options.include ?? ["src/**/*.cssx"],
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    output: {
      ...(options.cssDir === undefined ? {} : { cssDir: options.cssDir }),
      ...(options.mapDir === undefined ? {} : { mapDir: options.mapDir }),
      emitMap: options.emitMap ?? false,
      emitTypes: options.emitTypes ?? false,
    },
    ...(options.strict === undefined ? {} : { compiler: { strict: options.strict } }),
  };
}

/** Content of one entry with a unique marker so rebuilds are observable. */
export function simpleSource(selector: string, color = "red"): string {
  return `.${selector} {\n  color: ${color};\n}\n`;
}

/** Whether a path exists (sync, for tight polling loops). */
export function pathExistsSync(path: string): boolean {
  return existsSync(path);
}
