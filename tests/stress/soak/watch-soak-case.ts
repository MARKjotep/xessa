/**
 * TT7 watch soak — one shared implementation for the committed gated test and
 * the long driver (`.ai/plans/CSSX-PLAN-TESTING.md` §TT7 row 1).
 *
 * The case runs a real `xessa watch --json` process on a generated project,
 * rewrites one source every `editIntervalMs`, and asserts per edit that the
 * emitted CSS contains that revision's unique marker (a fresh artifact, not a
 * stale one). While it waits between edits it samples the watcher's resident set
 * through `ps`, so the report can show a *series* rather than a single sample:
 * bounded growth and no monotonic runaway are checked against
 * {@link WATCH_RSS_CEILING_MB} and {@link WATCH_RSS_GROWTH_MB}.
 *
 * Revisions rotate over a small hot set (8 files) instead of the whole project,
 * so repeated edits land on the same source: a stale artifact would then show the
 * previous revision's colour and the case would fail instead of silently passing
 * on a file that was only ever written once.
 *
 * Scheduling reads the clock; no assertion depends on it. Everything hashed or
 * compared is deterministic.
 */

import { join } from "node:path";
import {
  type ManifestCheck,
  type RssAnalysis,
  type RssSample,
  analyseRss,
  checkManifest,
  cssArtifactPath,
  hashFileBytes,
  readSoakFile,
  sampleRssMb,
  sleep,
  soakEntrySource,
  soakMarker,
  sourceStem,
  startSoakWatch,
  waitFor,
  writeSoakFile,
} from "./helpers.ts";

/**
 * Runaway ceiling for the watcher's RSS.
 *
 * A 100-file watch session must not approach this: the TT2 cold build of 1000
 * files peaks around 115 MB (`docs/performance.md`), so 512 MB is roughly four
 * times a full-project build and cannot be reached by a bounded 100-file
 * session. Exceeding it means something is retaining per-build state.
 */
export const WATCH_RSS_CEILING_MB = 512;

/**
 * Bound on `last - first` RSS drift across the soak.
 *
 * The watcher legitimately grows while the first edits warm the module graph and
 * the JSC heap reaches steady state, then oscillates with collection. 128 MB is
 * far above the observed steady state (see `.ai/reports/CSSX-TT7.md`) and still
 * fails a leak that retains a build's worth of memory per edit.
 */
export const WATCH_RSS_GROWTH_MB = 128;

/** Files edited repeatedly by the soak (a small hot set, not the whole project). */
const HOT_FILE_COUNT = 8;

/** One confirmed edit: the artifact for this revision landed. */
export interface WatchSoakEdit {
  /** 1-based edit number; also the revision written into the source. */
  readonly revision: number;
  /** Workspace-relative edited source. */
  readonly source: string;
  /** Marker the emitted CSS must contain, unique per revision. */
  readonly marker: string;
  /** Workspace-relative emitted CSS that carries the marker. */
  readonly artifact: string;
  /** `sha256:` of that artifact at confirmation (freshness is a new hash). */
  readonly artifactHash: string;
  /** Milliseconds from write to marker observed, i.e. watcher latency. */
  readonly latencyMs: number;
  /** Milliseconds since the watcher signalled readiness when the edit landed. */
  readonly atMs: number;
  /** Build events observed at that moment (monotonic per run). */
  readonly builds: number;
  /** Watcher RSS when the edit landed. */
  readonly rssMb: number | null;
}

/** Options for one soak run. */
export interface WatchSoakOptions {
  /** Project root created by `createSoakProject`. */
  readonly root: string;
  /** Sources in the project (drives file naming width). */
  readonly fileCount: number;
  /** Number of edits to drive. */
  readonly edits: number;
  /** Gap between scheduled edits, in milliseconds. */
  readonly editIntervalMs: number;
  /** RSS sampling period while waiting, in milliseconds. */
  readonly sampleIntervalMs: number;
  /** Per-edit ceiling; a missed marker inside it is reported as a watcher stall. */
  readonly buildTimeoutMs: number;
  /** Progress callback (the driver prints one line every few edits). */
  readonly onEdit?: (edit: WatchSoakEdit) => void;
}

/** Everything the report needs from one watch soak. */
export interface WatchSoakResult {
  readonly fileCount: number;
  readonly edits: readonly WatchSoakEdit[];
  /** Total `build` events emitted by the watcher. */
  readonly builds: number;
  /** Every build event reported success and no error diagnostics. */
  readonly buildsHealthy: boolean;
  /** Error diagnostics from any build event, formatted. */
  readonly buildDiagnostics: readonly string[];
  /** Which source set the watcher announced at readiness. */
  readonly readySources: number;
  readonly debounceMs: number;
  /** RSS series sampled after readiness. */
  readonly samples: readonly RssSample[];
  readonly rss: RssAnalysis;
  /** Watcher RSS at the readiness handshake. */
  readonly readyRssMb: number | null;
  /** Manifest-vs-artifact-tree consistency after the last edit. */
  readonly manifest: ManifestCheck;
  /** Number of distinct artifact hashes observed across the edit confirmations. */
  readonly distinctArtifacts: number;
  /** `xessa watch: discarded a stale build generation` lines seen on the stream. */
  readonly staleDiscards: number;
  readonly durationMs: number;
  readonly watchExitCode: number;
}

/**
 * Drive one watch soak and return the recorded evidence.
 *
 * Throws when an edit's marker never lands inside `buildTimeoutMs` (a watcher
 * stall): the error names the revision, source and artifact, and the caller's
 * stack identifies the await. Everything else is returned as data so the test
 * and the driver assert on the same numbers.
 */
export async function runWatchSoak(options: WatchSoakOptions): Promise<WatchSoakResult> {
  const watch = startSoakWatch(options.root);
  const samples: RssSample[] = [];
  const edits: WatchSoakEdit[] = [];
  const startedAt = performance.now();
  let samplerRunning = true;
  let readyRssMb: number | null = null;
  let readySources = 0;
  let debounceMs = 0;
  let sampler: Promise<void> | undefined;

  try {
    const ready = await watch.awaitReady("watch soak ready", 120_000);
    readySources = ready.sources;
    debounceMs = ready.debounceMs;
    const baseline = performance.now();
    readyRssMb = sampleRssMb(watch.pid);
    if (readyRssMb !== null) samples.push({ atMs: 0, rssMb: readyRssMb });

    const takeSample = (): void => {
      const rssMb = sampleRssMb(watch.pid);
      if (rssMb !== null) samples.push({ atMs: Math.round(performance.now() - baseline), rssMb });
    };

    // Continuous sampling: edits are minutes apart in the long run, so the series
    // has to be collected by a timer rather than only around the edits.
    sampler = (async () => {
      while (samplerRunning) {
        await sleep(options.sampleIntervalMs);
        if (!samplerRunning) return;
        takeSample();
      }
    })();

    for (let revision = 1; revision <= options.edits; revision += 1) {
      const due = baseline + revision * options.editIntervalMs;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);

      const index = (revision - 1) % Math.min(options.fileCount, HOT_FILE_COUNT);
      const source = `src/${sourceStem(index, options.fileCount)}.cssx`;
      const marker = soakMarker(revision);
      const artifact = cssArtifactPath(source);
      writeSoakFile(options.root, source, soakEntrySource(index, revision, options.fileCount));
      const latencyMs = await waitFor(
        () => (readSoakFile(options.root, artifact) ?? "").includes(marker),
        `watch soak edit ${revision} (${source} -> ${artifact})`,
        options.buildTimeoutMs,
        10,
      );
      const edit: WatchSoakEdit = {
        revision,
        source,
        marker,
        artifact,
        artifactHash: hashFileBytes(join(options.root, artifact)),
        latencyMs,
        atMs: Math.round(performance.now() - baseline),
        builds: watch.builds().length,
        rssMb: sampleRssMb(watch.pid),
      };
      edits.push(edit);
      options.onEdit?.(edit);
    }
  } finally {
    samplerRunning = false;
    if (sampler !== undefined) await sampler;
  }

  const builds = watch.builds();
  const staleDiscards = watch.events.filter(
    (event) =>
      event.type === "text" &&
      typeof event.text === "string" &&
      event.text.includes("discarded a stale build generation"),
  ).length;
  // The NDJSON `build` event is emitted after the artifacts are renamed into
  // place, so the last edit's event can still be in flight here: give it a
  // bounded settle window before health is judged (a missed event is not a
  // failure, a failed one is).
  const expectedBuilds = (edits.at(-1)?.builds ?? 0) + 1;
  const settleBuilds = performance.now() + options.buildTimeoutMs;
  while (watch.builds().length < expectedBuilds && performance.now() < settleBuilds) {
    await sleep(20);
  }
  const buildDiagnostics: string[] = [];
  for (const build of builds) {
    if (build.success !== true) {
      buildDiagnostics.push(`build event reported success=${String(build.success)}`);
    }
    for (const diagnostic of build.diagnostics) {
      if (diagnostic.severity === "error") {
        buildDiagnostics.push(`${diagnostic.code} ${diagnostic.message}`);
      }
    }
    for (const entry of build.entries) {
      for (const diagnostic of entry.diagnostics) {
        if (diagnostic.severity === "error") {
          buildDiagnostics.push(`${diagnostic.code} ${diagnostic.message} (${entry.file})`);
        }
      }
    }
  }

  // The manifest is written at the end of a build, so give the last cycle a
  // bounded settle window; a genuine inconsistency is returned, not swallowed.
  let manifest = checkManifest(options.root);
  const settleDeadline = performance.now() + 15_000;
  while (manifest.problems.length > 0 && performance.now() < settleDeadline) {
    await sleep(50);
    manifest = checkManifest(options.root);
  }

  const watchExitCode = await watch.stop();
  const distinctArtifacts = new Set(edits.map((edit) => edit.artifactHash)).size;

  return {
    fileCount: options.fileCount,
    edits,
    builds: builds.length,
    buildsHealthy: buildDiagnostics.length === 0,
    buildDiagnostics,
    readySources,
    debounceMs,
    samples,
    rss: analyseRss(samples),
    readyRssMb,
    manifest,
    distinctArtifacts,
    staleDiscards,
    durationMs: Math.round(performance.now() - startedAt),
    watchExitCode,
  };
}
