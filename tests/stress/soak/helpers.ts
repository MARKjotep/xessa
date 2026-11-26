/**
 * Shared plumbing for the TT7 soak cases (`.ai/plans/CSSX-PLAN-TESTING.md` §TT7).
 *
 * The soak phase is the only one that measures *time*: a long `xessa watch`
 * session, twenty cold builds of the same 1000-file project, five full gate runs
 * and the TT1 fuzz runner at its maximum budget. Everything here exists so the
 * committed tests (`watch-soak.test.ts`, `cold-build.test.ts`) and the drivers
 * (`soak-watch.ts`, `cold-build.ts`, `flake-run.ts`, `long-fuzz.ts`) share one
 * implementation and cannot drift apart.
 *
 * Rules this module honours (from `tests/stress/README.md`):
 *
 * - **Gated.** {@link SOAK_ENABLED} is `XESSA_SOAK=1`; every committed soak test
 *   skips with a reason when it is unset, so `bun run verify` stays fast.
 * - **Temp dirs only.** Projects are created under `mkdtemp` in the OS temp dir
 *   and removed by {@link cleanupSoakProjects}; nothing writes into the
 *   repository, `examples/` or `tests/fixtures/`.
 * - **Deterministic.** Project content comes from the TT2 generator plus a fixed
 *   index/revision recipe; no clock, PID or entropy reaches a byte that is
 *   hashed. Only *scheduling* reads the clock, and no assertion depends on it.
 *
 * Reused read-only: `tests/stress/scale/generate.ts` (1000-file generator and
 * CLI entry point), `tests/stress/prng.ts` (seed plumbing).
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { createRng } from "../prng.ts";
import { CLI_ENTRY, thousandFileProject } from "../scale/generate.ts";

/** Whether the long soak cases run (`XESSA_SOAK=1`). */
export const SOAK_ENABLED = process.env.XESSA_SOAK === "1";

/** Skip suffix attached to every gated describe block so the reason is visible. */
export const SOAK_SKIP_LABEL = " [gated: set XESSA_SOAK=1 to run]";

/** Absolute path of the CLI TypeScript entry point, re-exported for drivers. */
export const SOAK_CLI_ENTRY = CLI_ENTRY;

/** Defaults for every knob; each is overridable through `XESSA_SOAK_*`. */
export const SOAK_DEFAULTS = Object.freeze({
  /** Sources in the watch-soak project ("moderate size", plan §TT7). */
  watchFiles: 100,
  /** Edits driven through the watcher by the committed test. */
  watchEdits: 12,
  /**
   * Gap between edits in the committed test (ms).
   *
   * Deliberately below one incremental build (~300 ms on a 100-file project):
   * a write can land *inside* a running build and invalidate that generation.
   * This is the regression cadence for TT7 finding F1 / CSSX-T06 — the watcher
   * must latch such a wakeup and rebuild, never wait for an unrelated event. At
   * 1 000 ms the race was unreachable, which is why the stall escaped the soak.
   */
  watchEditIntervalMs: 250,
  /** Watch-process RSS sampling period (ms). */
  watchSampleIntervalMs: 250,
  /** Per-edit ceiling: an edit whose artifact does not land in time is a stall. */
  watchBuildTimeoutMs: 30_000,
  /** Sources in the cold-build identity project. */
  coldFiles: 1_000,
  /** Consecutive cold builds compared byte-for-byte. */
  coldBuilds: 20,
  /** Full gate runs per suite in the flake case. */
  flakeRuns: 5,
  /** TT1 runner budget for the long fuzz case. */
  fuzzBudget: 100_000,
  /** Seed shared by every soak generator and fuzz run. */
  seed: 1,
});

/** Directory holding every temporary project created by this module. */
const temporaryRoots: string[] = [];

/**
 * Read one non-negative integer knob from the environment.
 *
 * A malformed or missing value falls back to the documented default rather than
 * silently running a different case: the drivers print the effective values.
 */
export function readSoakInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/u.test(raw.trim())) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Value of `--name value` in an argv list, or `undefined` when absent.
 *
 * The soak drivers are small standalone scripts; a shared one-line parser keeps
 * them free of flag-library dependencies (plan §TT7: no new dependencies).
 */
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

/** Numeric value of `--name <int>`, or `fallback` when absent or malformed. */
export function flagNumber(argv: readonly string[], name: string, fallback: number): number {
  const raw = flagValue(argv, name)?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : fallback;
}

/** Total physical memory in GiB, for the report's machine context. */
function totalMemoryGb(): number {
  return Math.round((totalmem() / 1024 ** 3) * 10) / 10;
}

/** Machine context recorded next to every soak number. */
export function machineContext(): Record<string, string | number> {
  return {
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    cores: cpus().length,
    memoryGb: totalMemoryGb(),
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    bun: process.versions.bun ?? "n/a",
    node: process.versions.node,
  };
}

/* -------------------------------------------------------------------------- */
/* Project generation and temp dirs                                           */
/* -------------------------------------------------------------------------- */

/**
 * A generated project's file map: the TT2 1000-file recipe with CSS source maps
 * switched on, so the identity case covers CSS, map, `.d.ts`, JS and manifest.
 */
export function projectFiles(fileCount: number, seed = SOAK_DEFAULTS.seed): Record<string, string> {
  const generated = thousandFileProject(createRng(seed), fileCount);
  const files: Record<string, string> = { ...generated.files };
  const configText = files["xessa.config.json"];
  if (configText === undefined) throw new Error("generated project has no xessa.config.json");
  const config = JSON.parse(configText) as { output: Record<string, unknown> };
  config.output.sourceMap = true;
  files["xessa.config.json"] = `${JSON.stringify(config, null, 2)}\n`;
  return files;
}

/** Zero-padded source stem used by {@link projectFiles}. */
export function sourceStem(index: number, fileCount: number): string {
  return `file-${String(index).padStart(String(fileCount).length, "0")}`;
}

/** Create a project in a fresh `mkdtemp` dir and return its canonical root. */
export function createSoakProject(files: Readonly<Record<string, string>>): string {
  const created = mkdtempSync(join(tmpdir(), "xessa-soak-"));
  const root = realpathSync(created).replace(/\\/g, "/");
  temporaryRoots.push(root);
  for (const [path, content] of Object.entries(files)) writeSoakFile(root, path, content);
  return root;
}

/** Write one UTF-8 file inside a project, creating parent directories. */
export function writeSoakFile(root: string, path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

/** Read one UTF-8 file, returning `null` when it is absent. */
export function readSoakFile(root: string, path: string): string | null {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
}

/** Remove every temporary project created by this module. */
export function cleanupSoakProjects(): void {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Remove one temporary project immediately (cold-build keeps disk usage flat). */
export function removeSoakProject(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Every file below `root/relativeDir`, as sorted POSIX paths relative to `root`. */
export function listSoakFiles(root: string, relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  if (relativeDir !== "" && !existsSync(join(root, relativeDir))) return found;
  walk(relativeDir);
  return found.sort();
}

/* -------------------------------------------------------------------------- */
/* Edit recipe                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Source written by one soak edit.
 *
 * `revision` appears verbatim as the red channel of the declaration colour, so
 * the emitted CSS contains `rgb(<revision>, 0, 17)` — a marker that is unique per
 * edit and cannot survive in a stale artifact from an earlier revision. Every
 * revision of a file stays a valid Xessa document.
 */
export function soakEntrySource(index: number, revision: number, fileCount: number): string {
  const stem = sourceStem(index, fileCount);
  return `@variables {
  gap: ${8 + (index % 8)}px;
}

.card-${stem.slice(5)} {
  display: flex;
  padding: $gap @md ${8 + (revision % 24)}px;
  color: rgb(${revision}, 0, 17);
  &:hover {
    opacity: 0.85;
  }
}
`;
}

/** The emitted CSS marker for one edit revision. */
export function soakMarker(revision: number): string {
  return `rgb(${revision}, 0, 17)`;
}

/** Emitted CSS path for one generated source (`dist/styles/src/file-0000.css`). */
export function cssArtifactPath(source: string): string {
  return `dist/styles/${source.replace(/\.cssx$/u, ".css")}`;
}

/* -------------------------------------------------------------------------- */
/* Hashing                                                                    */
/* -------------------------------------------------------------------------- */

/** `sha256:<hex>` of one file's bytes. */
export function hashFileBytes(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/**
 * Every artifact of one build: the output tree plus the manifest, keyed by
 * workspace-relative path with the `sha256:<hex>` of its bytes.
 */
export function artifactHashes(root: string, outputDir = "dist"): Record<string, string> {
  const hashes: Record<string, string> = {};
  const paths = listSoakFiles(root, outputDir);
  if (existsSync(join(root, ".cssx-manifest.json"))) paths.push(".cssx-manifest.json");
  for (const path of paths.sort()) hashes[path] = hashFileBytes(join(root, path));
  return hashes;
}

/** Total byte size of every file below `root/outputDir` plus the manifest. */
export function artifactBytes(root: string, outputDir = "dist"): number {
  let bytes = 0;
  for (const path of listSoakFiles(root, outputDir)) bytes += statSync(join(root, path)).size;
  if (existsSync(join(root, ".cssx-manifest.json"))) {
    bytes += statSync(join(root, ".cssx-manifest.json")).size;
  }
  return bytes;
}

/** One fingerprint for a whole artifact set: hash of the sorted `path:hash` list. */
export function artifactFingerprint(hashes: Readonly<Record<string, string>>): string {
  const lines = Object.keys(hashes)
    .sort()
    .map((path) => `${path}:${hashes[path] ?? ""}`);
  return `sha256:${createHash("sha256")
    .update(`${lines.join("\n")}\n`, "utf8")
    .digest("hex")}`;
}

/* -------------------------------------------------------------------------- */
/* CLI plumbing                                                               */
/* -------------------------------------------------------------------------- */

/** Outcome of one synchronous CLI subprocess run. */
export interface CliOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/** Run the CLI TypeScript entry point synchronously in `cwd`. */
export function runCliSync(args: readonly string[], cwd: string, timeoutMs = 300_000): CliOutcome {
  const started = performance.now();
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsedMs: performance.now() - started,
  };
}

/** Minimal `xessa build --json` shape this phase asserts on. */
export interface BuildReport {
  readonly success: boolean;
  readonly exitCode: number;
  readonly entries: ReadonlyArray<{
    readonly file: string;
    readonly outputs: ReadonlyArray<{ kind: string; path: string; written: boolean }>;
    readonly diagnostics: ReadonlyArray<{ code: string; severity: string; message: string }>;
  }>;
  readonly diagnostics: ReadonlyArray<{ code: string; severity: string; message: string }>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Parse a `build --json` report, throwing with the raw text when it is not JSON. */
export function parseBuildReport(outcome: CliOutcome, label: string): BuildReport {
  try {
    return JSON.parse(outcome.stdout) as BuildReport;
  } catch {
    throw new Error(
      `[${label}] expected a JSON report (status ${outcome.status}): ` +
        `stdout ${outcome.stdout.slice(0, 400) || "(empty)"} ` +
        `stderr ${outcome.stderr.slice(-800) || "(empty)"}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Process memory                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resident set size of one pid in MiB, or `null` when it cannot be sampled.
 *
 * `ps -o rss= -p <pid>` is used instead of the child's own
 * `process.memoryUsage()` because the watcher is a separate Bun process whose
 * heap counters are not reachable from the test runner. Sampling is read-only.
 */
export function sampleRssMb(pid: number): number | null {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const kib = Number.parseInt((result.stdout ?? "").trim(), 10);
  if (!Number.isFinite(kib) || kib <= 0) return null;
  return Math.round((kib / 1024) * 10) / 10;
}

/** One RSS observation of the watch process. */
export interface RssSample {
  /** Milliseconds since the watcher signalled readiness. */
  readonly atMs: number;
  readonly rssMb: number;
}

/** Summary of one RSS series. */
export interface RssAnalysis {
  readonly count: number;
  readonly firstMb: number;
  readonly lastMb: number;
  readonly minMb: number;
  readonly maxMb: number;
  /** `last - first`, the drift over the soak. */
  readonly growthMb: number;
  /** `max - min`, the widest excursion (collector sawtooth included). */
  readonly peakToTroughMb: number;
  /** Milliseconds between the first and last sample. */
  readonly spanMs: number;
}

/** Summarize an RSS series; throws when it is empty. */
export function analyseRss(samples: readonly RssSample[]): RssAnalysis {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("RSS series is empty: the watcher process was never sampled");
  }
  let minMb = first.rssMb;
  let maxMb = first.rssMb;
  for (const sample of samples) {
    if (sample.rssMb < minMb) minMb = sample.rssMb;
    if (sample.rssMb > maxMb) maxMb = sample.rssMb;
  }
  return {
    count: samples.length,
    firstMb: first.rssMb,
    lastMb: last.rssMb,
    minMb,
    maxMb,
    growthMb: Math.round((last.rssMb - first.rssMb) * 10) / 10,
    peakToTroughMb: Math.round((maxMb - minMb) * 10) / 10,
    spanMs: last.atMs - first.atMs,
  };
}

/** Sleep for `ms` milliseconds (scheduling only; no assertion depends on it). */
export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * Poll `predicate` until it holds and return the elapsed milliseconds.
 *
 * Bounded: throws with `label`, the last predicate error and the elapsed time
 * instead of hanging a soak run on a stalled watcher.
 */
export async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
  intervalMs = 20,
): Promise<number> {
  const started = performance.now();
  const deadline = started + timeoutMs;
  for (;;) {
    if (predicate()) return Math.round(performance.now() - started);
    if (performance.now() >= deadline) {
      throw new Error(`[${label}] timed out after ${timeoutMs}ms (possible watcher stall)`);
    }
    await sleep(intervalMs);
  }
}

/* -------------------------------------------------------------------------- */
/* Watch harness                                                              */
/* -------------------------------------------------------------------------- */

/** One NDJSON event from `xessa watch --json`. */
export interface WatchEvent {
  readonly type?: string;
  readonly [key: string]: unknown;
}

/** A `build` event from the watcher's NDJSON stream. */
export interface WatchBuild extends WatchEvent, BuildReport {
  readonly type: "build";
}

/** A `watch` readiness event from the watcher's NDJSON stream. */
export interface WatchReady extends WatchEvent {
  readonly type: "watch";
  readonly ready: boolean;
  readonly sources: number;
  readonly debounceMs: number;
}

/** Handle on a running soak watcher, including its pid for RSS sampling. */
export interface SoakWatch {
  readonly pid: number;
  readonly events: readonly WatchEvent[];
  builds(): WatchBuild[];
  awaitReady(label?: string, timeoutMs?: number): Promise<WatchReady>;
  stderrTail(): string;
  stop(): Promise<number>;
}

/**
 * Start `xessa watch --json` in `root` and expose its pid plus NDJSON events.
 *
 * Unlike the TT3 harness this one hands out the child pid, because the soak case
 * samples the watcher's resident set through `ps` while it runs. Every await is
 * bounded and reports the events seen so far plus the stderr tail.
 */
export function startSoakWatch(root: string, args: readonly string[] = []): SoakWatch {
  const child = spawn(process.execPath, [CLI_ENTRY, "watch", "--json", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = child.stdout;
  const stderr = child.stderr;
  const pid = child.pid;
  if (stdout === null || stderr === null || pid === undefined) {
    throw new Error("watch process did not expose a pid with piped stdout/stderr");
  }

  const events: WatchEvent[] = [];
  let buffer = "";
  let stderrText = "";

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

  const describe = (label: string): string =>
    `[${label}] event types: ${JSON.stringify(events.map((event) => event.type).slice(-20))}; ` +
    `stderr tail: ${stderrText.slice(-1_000) || "(empty)"}`;

  return {
    pid,
    events,
    builds: () => events.filter((event) => event.type === "build") as WatchBuild[],
    stderrTail: () => stderrText,
    awaitReady: async (label = "watch ready", timeoutMs = 60_000) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        const ready = events.find((event) => event.type === "watch" && event.ready === true) as
          | WatchReady
          | undefined;
        if (ready !== undefined) return ready;
        if (performance.now() >= deadline) {
          throw new Error(`[${label}] readiness handshake missing: ${describe(label)}`);
        }
        await sleep(10);
      }
    },
    stop: async (): Promise<number> => {
      child.kill("SIGINT");
      const exited = await Promise.race([
        new Promise<"exit">((resolve) => child.once("exit", () => resolve("exit"))),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10_000)),
      ]);
      if (exited === "timeout") child.kill("SIGKILL");
      if (child.exitCode === null && exited === "timeout") {
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
      return child.exitCode ?? 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Manifest consistency                                                       */
/* -------------------------------------------------------------------------- */

/** Shape of the on-disk output manifest. */
export interface ManifestDocument {
  readonly version: number;
  readonly files: ReadonlyArray<{
    readonly kind: string;
    readonly path: string;
    readonly source: string;
    readonly hash: string;
  }>;
}

/** Result of checking the manifest against the artifact tree. */
export interface ManifestCheck {
  /** Manifest records read, or `-1` when the document was missing/malformed. */
  readonly records: number;
  /** Artifact files found below the output directory. */
  readonly artifacts: number;
  /** Every inconsistency found; an empty list means the manifest is consistent. */
  readonly problems: readonly string[];
}

/**
 * Check that the manifest matches the artifact tree exactly.
 *
 * Verifies: the document parses, `version` is 1, records are sorted and unique,
 * every recorded file exists with the recorded SHA-256, and every file below the
 * output directory is recorded (no orphan artifacts, no phantom records).
 */
export function checkManifest(root: string, outputDir = "dist"): ManifestCheck {
  const problems: string[] = [];
  const artifacts = listSoakFiles(root, outputDir);
  const text = readSoakFile(root, ".cssx-manifest.json");
  if (text === null) {
    return { records: -1, artifacts: artifacts.length, problems: ["manifest is missing"] };
  }
  let document: ManifestDocument;
  try {
    document = JSON.parse(text) as ManifestDocument;
  } catch {
    return { records: -1, artifacts: artifacts.length, problems: ["manifest is not JSON"] };
  }
  if (document.version !== 1) problems.push(`manifest version is ${String(document.version)}`);
  if (!Array.isArray(document.files)) {
    return {
      records: -1,
      artifacts: artifacts.length,
      problems: [...problems, "manifest.files is not an array"],
    };
  }

  const paths = document.files.map((record) => record.path);
  const sorted = [...paths].sort();
  if (paths.join("\n") !== sorted.join("\n"))
    problems.push("manifest records are not sorted by path");
  if (new Set(paths).size !== paths.length)
    problems.push("manifest records contain duplicate paths");

  for (const record of document.files) {
    const actual = readSoakFile(root, record.path);
    if (actual === null) {
      problems.push(`manifest records missing file ${record.path}`);
      continue;
    }
    const hash = hashFileBytes(join(root, record.path));
    if (hash !== record.hash) problems.push(`hash mismatch for ${record.path}`);
  }

  const recorded = new Set(paths);
  for (const artifact of artifacts) {
    if (!recorded.has(artifact))
      problems.push(`artifact not recorded in the manifest: ${artifact}`);
  }
  return { records: document.files.length, artifacts: artifacts.length, problems };
}

/* -------------------------------------------------------------------------- */
/* Cold-build identity                                                        */
/* -------------------------------------------------------------------------- */

/** One cold build of the identity project. */
export interface ColdBuildRun {
  /** 1-based build number. */
  readonly run: number;
  readonly status: number;
  readonly elapsedMs: number;
  readonly artifactCount: number;
  readonly artifactBytes: number;
  readonly fingerprint: string;
  readonly errors: readonly string[];
}

/** Result of the consecutive cold-build comparison. */
export interface ColdBuildResult {
  readonly runs: readonly ColdBuildRun[];
  readonly identical: boolean;
  readonly files: number;
  /** `run: path` pairs whose hash differs from the first build. */
  readonly mismatches: readonly string[];
  /** Paths present in some runs but not the first. */
  readonly missing: readonly string[];
}

/**
 * Run `builds` consecutive cold builds of the same generated project and hash
 * every artifact (CSS, source map, `.d.ts`, JS and `.cssx-manifest.json`).
 *
 * Each build starts from a brand-new `mkdtemp` project holding byte-identical
 * sources, so this is a genuine cold build (no manifest, no warm caches), and
 * the temp dir is removed right after hashing to keep disk usage flat.
 */
export function runColdBuilds(options: {
  readonly builds: number;
  readonly files: number;
  readonly seed?: number;
  readonly onRun?: (run: ColdBuildRun) => void;
}): ColdBuildResult {
  const files = projectFiles(options.files, options.seed ?? SOAK_DEFAULTS.seed);
  const runs: ColdBuildRun[] = [];
  const mismatches: string[] = [];
  const missing = new Set<string>();
  let reference: Record<string, string> = {};

  for (let run = 1; run <= options.builds; run += 1) {
    const root = createSoakProject(files);
    try {
      const outcome = runCliSync(["build", "--json"], root);
      const report = parseBuildReport(outcome, `cold build ${run}`);
      const hashes = artifactHashes(root);
      const result: ColdBuildRun = {
        run,
        status: outcome.status,
        elapsedMs: Math.round(outcome.elapsedMs),
        artifactCount: Object.keys(hashes).length,
        artifactBytes: artifactBytes(root),
        fingerprint: artifactFingerprint(hashes),
        errors: report.errors,
      };
      if (run === 1) {
        reference = hashes;
      } else {
        for (const path of Object.keys(reference)) {
          const expected = reference[path];
          const actual = hashes[path];
          if (actual === undefined) missing.add(path);
          else if (actual !== expected) mismatches.push(`run ${run}: ${path}`);
        }
        for (const path of Object.keys(hashes)) {
          if (!Object.hasOwn(reference, path)) mismatches.push(`run ${run}: unexpected ${path}`);
        }
      }
      runs.push(result);
      options.onRun?.(result);
    } finally {
      removeSoakProject(root);
    }
  }

  return {
    runs,
    identical: mismatches.length === 0 && missing.size === 0,
    files: options.files,
    mismatches,
    missing: [...missing].sort(),
  };
}
