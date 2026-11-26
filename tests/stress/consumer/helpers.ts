/**
 * TT5 consumer-matrix plumbing — runtime discovery, `dist` build orchestration and
 * subprocess plumbing for `.ai/plans/CSSX-PLAN-TESTING.md` §TT5.
 *
 * The phase proves that the **built** artifacts (`packages/*\/dist`) work outside Bun,
 * so every runtime case runs a real subprocess instead of importing the compiler into
 * the test process:
 *
 * - {@link ensureDistBuild} runs the standard `bun run --cwd <pkg> build` once per
 *   machine state (mtime staleness check) under an exclusive lock file in the OS temp
 *   dir, so several test files in one `bun test` run cannot race on `dist/`.
 * - {@link discoverRuntimes} enumerates the Node and Bun binaries that are actually
 *   installed (PATH plus the common version-manager layouts) and asks each one for its
 *   version. Nothing is installed; a runtime that is not present is reported through
 *   {@link runtimeMatrix} as `unverified` with a reason, never as passed.
 * - {@link createConsumerInstall} builds a throwaway consumer project whose
 *   `node_modules/@xessa/*` entries are symlinks to this repository's packages, which
 *   is how a published install resolves (`package.json` `exports` → `dist/index.js`)
 *   without a network install.
 *
 * Determinism: runtime discovery depends on the machine by design (that matrix is the
 * deliverable); everything else (project contents, expectations) is fixed or derived
 * from the generated artifacts. Temporary directories live under `mkdtemp` and are
 * removed by {@link cleanupTempProjects} (re-exported from the TT2 scale harness).
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { REPO_ROOT } from "../corpus.ts";
import { createTempProject, writeProjectFiles } from "../scale/generate.ts";

/** Absolute directory of the compiler workspace package. */
export const COMPILER_PACKAGE_DIR = join(REPO_ROOT, "packages", "compiler");

/** Absolute directory of the CLI workspace package. */
export const CLI_PACKAGE_DIR = join(REPO_ROOT, "packages", "cli");

/** Built compiler entry point — the artifact a consumer actually imports. */
export const COMPILER_DIST_ENTRY = join(COMPILER_PACKAGE_DIR, "dist", "index.js");

/** Built CLI entry point — the artifact a consumer actually runs. */
export const CLI_DIST_ENTRY = join(CLI_PACKAGE_DIR, "dist", "index.js");

/** Repository TypeScript compiler binary, used for the type-inference cases. */
export const TSC_ENTRY = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

/** Node majors the plan's §TT5 row names explicitly. */
export const REQUIRED_NODE_MAJORS: readonly number[] = Object.freeze([20, 22, 24]);

/** `engines.node` floor from the root `package.json`. */
export const NODE_ENGINE_FLOOR = 20;

/* -------------------------------------------------------------------------- */
/* Standard build orchestration                                               */
/* -------------------------------------------------------------------------- */

/** One workspace package whose `dist/` the matrix needs. */
interface BuildTarget {
  /** Workspace-relative POSIX path, also the `bun run --cwd` argument. */
  readonly directory: string;
  /** Built entry point whose mtime decides staleness. */
  readonly entry: string;
}

const BUILD_TARGETS: readonly BuildTarget[] = Object.freeze([
  { directory: "packages/compiler", entry: COMPILER_DIST_ENTRY },
  { directory: "packages/cli", entry: CLI_DIST_ENTRY },
]);

/** Outcome of {@link ensureDistBuild}; recorded in the TT5 report. */
export interface DistBuildResult {
  /** Targets rebuilt by this process. */
  readonly built: readonly string[];
  /** Targets skipped because `dist/` was already newer than every input. */
  readonly fresh: readonly string[];
  /** Monotonic duration of the whole ensure step, in milliseconds. */
  readonly milliseconds: number;
}

/** Path of the cross-process build lock. */
const BUILD_LOCK = join(tmpdir(), "xessa-tt5-dist-build.lock");

/** A lock older than this is treated as abandoned. */
const BUILD_LOCK_STALE_MS = 120_000;

/** How long to wait for another process's build before failing. */
const BUILD_LOCK_TIMEOUT_MS = 120_000;

/** Bun binary to run the standard build with (the test runner is itself Bun). */
function bunBinary(): string {
  return basename(process.execPath).startsWith("bun") ? process.execPath : "bun";
}

/** Newest mtime under `path` (recursive); `0` when the path does not exist. */
function newestMtime(path: string): number {
  let newest = 0;
  const walk = (candidate: string): void => {
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(candidate);
    } catch {
      return;
    }
    newest = Math.max(newest, stats.mtimeMs);
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(candidate)) walk(join(candidate, entry));
  };
  walk(path);
  return newest;
}

/** True when `dist/` is missing or older than any build input of its package. */
function isStale(target: BuildTarget): boolean {
  if (!existsSync(target.entry)) return true;
  const packageDir = join(REPO_ROOT, target.directory);
  const inputs = newestMtime(join(packageDir, "src"));
  const configuration = Math.max(
    newestMtime(join(packageDir, "tsconfig.json")),
    newestMtime(join(packageDir, "package.json")),
    newestMtime(join(REPO_ROOT, "tsconfig.base.json")),
  );
  const outputs = newestMtime(join(packageDir, "dist"));
  return outputs === 0 || Math.max(inputs, configuration) > outputs;
}

/**
 * Run `work` while holding the exclusive build lock.
 *
 * The lock exists so concurrent `bun test` files (or a sibling worker) never run two
 * `tsc` builds into the same `dist/`. A stale lock is reclaimed; the wait is bounded.
 */
async function withBuildLock<T>(work: () => T): Promise<T> {
  const deadline = Date.now() + BUILD_LOCK_TIMEOUT_MS;
  for (;;) {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(BUILD_LOCK, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (descriptor !== undefined) {
      try {
        return work();
      } finally {
        closeSync(descriptor);
        rmSync(BUILD_LOCK, { force: true });
      }
    }
    try {
      if (Date.now() - statSync(BUILD_LOCK).mtimeMs > BUILD_LOCK_STALE_MS) {
        rmSync(BUILD_LOCK, { force: true });
      }
    } catch {
      // The holder removed the lock between the open and the stat; retry immediately.
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the TT5 dist build lock at ${BUILD_LOCK}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let distBuild: DistBuildResult | undefined;

/**
 * Build `packages/compiler/dist` and `packages/cli/dist` with the standard workspace
 * build command, once per machine state.
 *
 * Staleness is re-checked inside the lock, so the second of two concurrent test files
 * observes the fresh output and skips. Results are memoized per process.
 */
export async function ensureDistBuild(): Promise<DistBuildResult> {
  if (distBuild !== undefined) return distBuild;
  distBuild = await withBuildLock(() => {
    const started = performance.now();
    const built: string[] = [];
    const fresh: string[] = [];
    for (const target of BUILD_TARGETS) {
      if (!isStale(target)) {
        fresh.push(target.directory);
        continue;
      }
      const outcome = spawnSync(bunBinary(), ["run", "--cwd", target.directory, "build"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 180_000,
      });
      if (outcome.status !== 0) {
        throw new Error(
          `bun run --cwd ${target.directory} build failed (status ${outcome.status}):\n${
            outcome.stdout ?? ""
          }${outcome.stderr ?? ""}`,
        );
      }
      built.push(target.directory);
    }
    return { built, fresh, milliseconds: performance.now() - started };
  });
  return distBuild;
}

/* -------------------------------------------------------------------------- */
/* Runtime discovery                                                          */
/* -------------------------------------------------------------------------- */

/** JavaScript runtimes the matrix distinguishes. */
export type Engine = "node" | "bun";

/** One installed runtime binary that answered `--version`. */
export interface Runtime {
  readonly engine: Engine;
  /** Version without the leading `v`, for example `24.22.3` or `1.4.5`. */
  readonly version: string;
  /** Major version, the axis the plan's case table names. */
  readonly major: number;
  /** Absolute, canonical path of the binary. */
  readonly binary: string;
}

/** A binary that was found but not offered as a matrix row, with the reason why. */
export interface ExcludedRuntime {
  readonly binary: string;
  readonly version: string;
  readonly reason: string;
}

/** Result of one discovery pass. */
export interface RuntimeDiscovery {
  readonly runtimes: readonly Runtime[];
  readonly excluded: readonly ExcludedRuntime[];
}

/** Version-manager layouts scanned in addition to `PATH` (`<root>/<version>/bin`). */
function versionManagerRoots(): string[] {
  const home = homedir();
  return [
    join(home, ".nvm", "versions", "node"),
    join(home, ".fnm", "node-versions"),
    join(home, ".asdf", "installs", "nodejs"),
    join(home, ".volta", "tools", "image", "node"),
    join(home, ".local", "share", "mise", "installs", "node"),
  ];
}

/** Directory names under `path`, or an empty list when it does not exist. */
function directoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Directories that may contain a `node`/`bun` binary, canonicalized and sorted. */
function candidateDirectories(environment: NodeJS.ProcessEnv): string[] {
  const seen = new Set<string>();
  for (const entry of (environment.PATH ?? "").split(delimiter)) {
    if (entry.length === 0) continue;
    seen.add(entry);
  }
  for (const root of versionManagerRoots()) {
    for (const version of directoryNames(root)) seen.add(join(root, version, "bin"));
  }
  const executed = dirname(process.execPath);
  seen.add(executed);
  return [...seen].sort();
}

/** Parse `v24.22.3` / `1.4.5` into its numeric parts; `undefined` when unparseable. */
function parseVersion(
  text: string,
): { version: string; major: number; parts: number[] } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(text.trim());
  if (match === null) return undefined;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { version: parts.join("."), major: parts[0] ?? 0, parts };
}

/** Newest-first comparison of two parsed runtime versions. */
function compareVersions(
  left: { parts: readonly number[] },
  right: { parts: readonly number[] },
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (right.parts[index] ?? 0) - (left.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Enumerate the Node and Bun runtimes installed on this machine.
 *
 * Candidates come from `PATH`, the version-manager layouts above and the directory of
 * the running test binary. Each candidate must answer `<bin> --version` with a
 * `major.minor.patch` string; duplicates (a `PATH` entry that is a symlink to an
 * already-seen real path) are collapsed. Node majors below {@link NODE_ENGINE_FLOOR}
 * are returned in `excluded` with the reason, not dropped silently.
 */
export function discoverRuntimes(environment: NodeJS.ProcessEnv = process.env): RuntimeDiscovery {
  const runtimes: Runtime[] = [];
  const excluded: ExcludedRuntime[] = [];
  const visited = new Set<string>();

  for (const directory of candidateDirectories(environment)) {
    for (const name of ["node", "bun"] as const) {
      const candidate = join(directory, name);
      if (!existsSync(candidate)) continue;
      let canonical: string;
      try {
        canonical = realpathSync(candidate);
      } catch {
        continue;
      }
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      const outcome = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 30_000,
      });
      if (outcome.status !== 0) continue;
      const parsed = parseVersion(outcome.stdout ?? "");
      if (parsed === undefined) continue;
      const engine: Engine = name === "bun" ? "bun" : "node";
      if (engine === "node" && parsed.major < NODE_ENGINE_FLOOR) {
        excluded.push({
          binary: canonical,
          version: parsed.version,
          reason: `below the engines.node floor (>=${NODE_ENGINE_FLOOR})`,
        });
        continue;
      }
      runtimes.push({ engine, version: parsed.version, major: parsed.major, binary: canonical });
    }
  }

  const sorted = runtimes.sort((left, right) => {
    if (left.engine !== right.engine) return left.engine === "node" ? -1 : 1;
    return compareVersions(
      parseVersion(left.version) ?? { parts: [] },
      parseVersion(right.version) ?? { parts: [] },
    );
  });
  return { runtimes: sorted, excluded };
}

/** One row of the runtime-availability matrix in the TT5 report. */
export interface MatrixRow {
  /** Report label, for example `Node 24` or `Bun`. */
  readonly label: string;
  readonly engine: Engine;
  /** Required Node major, or the major of the selected Bun runtime. */
  readonly major: number;
  /** True for the rows the plan's case table names explicitly. */
  readonly required: boolean;
  /** Selected binary; absent exactly when {@link status} is `unverified`. */
  readonly runtime?: Runtime;
  readonly status: "verified" | "unverified";
  /** Why the row is unverified; always present for `unverified` rows. */
  readonly reason?: string;
}

/** The full availability matrix plus the discovery it came from. */
export interface RuntimeMatrix {
  readonly rows: readonly MatrixRow[];
  readonly discovery: RuntimeDiscovery;
}

/** Highest-version runtime per Node major. */
function byNodeMajor(runtimes: readonly Runtime[]): Map<number, Runtime> {
  const selected = new Map<number, Runtime>();
  for (const runtime of runtimes) {
    if (runtime.engine !== "node") continue;
    const current = selected.get(runtime.major);
    if (
      current === undefined ||
      compareVersions(
        parseVersion(runtime.version) ?? { parts: [] },
        parseVersion(current.version) ?? { parts: [] },
      ) < 0
    ) {
      selected.set(runtime.major, runtime);
    }
  }
  return selected;
}

/**
 * Build the TT5 availability matrix.
 *
 * Required Node majors (20/22/24) become verified rows when a matching binary exists
 * and `unverified` rows with "runtime not installed" otherwise. Any other installed
 * Node major above the engine floor is added as an extra, non-required row so the
 * report shows the full matrix that is available; Bun is always present because the
 * suite itself runs under it.
 */
export function runtimeMatrix(discovery: RuntimeDiscovery = discoverRuntimes()): RuntimeMatrix {
  const nodes = byNodeMajor(discovery.runtimes);
  const rows: MatrixRow[] = [];

  const requiredRows = [...REQUIRED_NODE_MAJORS].sort((left, right) => left - right);
  for (const major of requiredRows) {
    const runtime = nodes.get(major);
    rows.push(
      runtime === undefined
        ? {
            label: `Node ${major}`,
            engine: "node",
            major,
            required: true,
            status: "unverified",
            reason: `Node ${major} runtime not installed on this machine`,
          }
        : {
            label: `Node ${major}`,
            engine: "node",
            major,
            required: true,
            runtime,
            status: "verified",
          },
    );
  }

  const extra = [...nodes.keys()]
    .filter((major) => !REQUIRED_NODE_MAJORS.includes(major))
    .sort((left, right) => left - right);
  for (const major of extra) {
    const runtime = nodes.get(major);
    if (runtime === undefined) continue;
    rows.push({
      label: `Node ${major}`,
      engine: "node",
      major,
      required: false,
      runtime,
      status: "verified",
    });
  }

  const buns = discovery.runtimes.filter((runtime) => runtime.engine === "bun");
  const executed = realpathSync(process.execPath);
  const bun = buns.find((runtime) => runtime.binary === executed) ?? buns[0];
  rows.push(
    bun === undefined
      ? {
          label: "Bun",
          engine: "bun",
          major: 0,
          required: true,
          status: "unverified",
          reason: "no bun binary answered --version on this machine",
        }
      : {
          label: "Bun",
          engine: "bun",
          major: bun.major,
          required: true,
          runtime: bun,
          status: "verified",
        },
  );

  return { rows, discovery };
}

/** One-line summaries of the matrix, used by assertions and the report. */
export function formatMatrix(matrix: RuntimeMatrix): string[] {
  return matrix.rows.map((row) =>
    row.status === "verified" && row.runtime !== undefined
      ? `${row.label}: verified (${row.runtime.version}, ${row.runtime.binary})`
      : `${row.label}: UNVERIFIED — ${row.reason ?? "no reason recorded"}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Subprocess plumbing                                                        */
/* -------------------------------------------------------------------------- */

/** Outcome of one subprocess run. */
export interface ProcessOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one binary synchronously and capture both streams. */
export function runProcess(
  binary: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv },
): ProcessOutcome {
  const outcome = spawnSync(binary, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
  });
  return {
    status: outcome.status ?? -1,
    stdout: outcome.stdout ?? "",
    stderr: outcome.stderr ?? "",
  };
}

/** Printable `binary args` form used in failure messages. */
export function describeCommand(binary: string, args: readonly string[]): string {
  return [binary, ...args].join(" ");
}

/**
 * Fail with the full command context unless the subprocess exited as expected.
 *
 * Cases assert the data themselves; this guard exists so a red run prints the exact
 * command, status and both streams instead of a bare `expected 0, received 1`.
 */
export function expectStatus(label: string, outcome: ProcessOutcome, expected: number): void {
  if (outcome.status === expected) return;
  throw new Error(
    `${label}\nexpected status ${expected}, received ${outcome.status}\n` +
      `stdout:\n${outcome.stdout}\nstderr:\n${outcome.stderr}`,
  );
}

/** Version declared by a workspace package's `package.json`. */
export function packageVersion(packageDir: string): string {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    version?: string;
  };
  return manifest.version ?? "";
}

/* -------------------------------------------------------------------------- */
/* Consumer install                                                           */
/* -------------------------------------------------------------------------- */

/** A throwaway consumer install whose `node_modules/@xessa/*` are repository symlinks. */
export interface ConsumerInstall {
  readonly root: string;
  /** `node_modules/@xessa/compiler` inside the consumer install. */
  readonly compilerDir: string;
  /** `node_modules/@xessa/cli` inside the consumer install. */
  readonly cliDir: string;
}

/**
 * Create a consumer project that resolves `@xessa/compiler` and `@xessa/cli` through
 * `package.json` `exports`.
 *
 * Installing from the registry is impossible offline and would add a dependency, so the
 * packages are symlinked: Node's and Bun's ESM resolvers follow the link, read the
 * package manifest and load `dist/index.js` exactly as they would after `npm install`.
 * The directory is registered with the TT2 temp-project registry for cleanup.
 */
export function createConsumerInstall(): ConsumerInstall {
  const root = createTempProject({});
  writeProjectFiles(root, {
    "package.json": `${JSON.stringify(
      { name: "xessa-consumer-probe", version: "0.0.0", private: true, type: "module" },
      null,
      2,
    )}\n`,
  });
  const scope = join(root, "node_modules", "@xessa");
  mkdirSync(scope, { recursive: true });
  symlinkSync(COMPILER_PACKAGE_DIR, join(scope, "compiler"), "dir");
  symlinkSync(CLI_PACKAGE_DIR, join(scope, "cli"), "dir");
  return { root, compilerDir: join(scope, "compiler"), cliDir: join(scope, "cli") };
}

/* -------------------------------------------------------------------------- */
/* Small generated project shared by the ESM and type-inference cases         */
/* -------------------------------------------------------------------------- */

/** A generated consumer project plus the class names it must produce. */
export interface GeneratedProject {
  readonly files: Readonly<Record<string, string>>;
  /** Authored class name → emitted class name under the `ui` prefix. */
  readonly classes: Readonly<Record<string, string>>;
  /** Emitted class-map module paths, workspace-relative. */
  readonly mapModules: Readonly<Record<string, string>>;
  /** Emitted declaration paths, workspace-relative. */
  readonly declarations: Readonly<Record<string, string>>;
  /** Emitted stylesheet paths, workspace-relative. */
  readonly stylesheets: Readonly<Record<string, string>>;
}

/** Class-name prefix configured by the generated project. */
export const GENERATED_PREFIX = "ui";

/** Two-file project used by the ESM-consumer and type-inference cases. */
export function generatedProject(options: {
  readonly sourceMap: boolean;
  /** Opt in to `.d.ts` declarations (`map-types`, default off since CSSX-A52). */
  readonly mapTypes?: boolean;
}): GeneratedProject {
  const config = {
    include: ["src/**/*.cssx"],
    exclude: ["dist"],
    output: {
      cssDir: "dist/styles",
      mapDir: "dist/maps",
      emitCss: true,
      emitMap: true,
      mapTypes: options.mapTypes ?? false,
      sourceMap: options.sourceMap,
      minify: false,
    },
    classes: { strategy: "prefix", prefix: GENERATED_PREFIX },
    media: { md: "(min-width: 768px)" },
    compiler: { strict: true, mediaGrouping: "safe" },
  };
  const classes: Record<string, string> = {
    "panel-head": `${GENERATED_PREFIX}-panel-head`,
    "panel-body": `${GENERATED_PREFIX}-panel-body`,
    "card-one": `${GENERATED_PREFIX}-card-one`,
    "card-two": `${GENERATED_PREFIX}-card-two`,
  };
  return {
    files: {
      "xessa.config.json": `${JSON.stringify(config, null, 2)}\n`,
      "src/panel.cssx": ".panel-head {\n  display: flex;\n}\n\n.panel-body {\n  padding: 4px;\n}\n",
      "src/card.cssx": [
        "@variables {",
        "  gap: 12px;",
        "}",
        "",
        ".card-one {",
        "  display: flex;",
        "  padding: $gap @md 16px;",
        "  color: #123456;",
        "  &:hover {",
        "    opacity: 0.85;",
        "  }",
        "}",
        "",
        ".card-two {",
        "  display: grid;",
        "  gap: 4px;",
        "}",
        "",
      ].join("\n"),
    },
    classes,
    mapModules: {
      "src/panel.cssx": "dist/maps/src/panel.map.js",
      "src/card.cssx": "dist/maps/src/card.map.js",
    },
    declarations: {
      "src/panel.cssx": "dist/maps/src/panel.map.d.ts",
      "src/card.cssx": "dist/maps/src/card.map.d.ts",
    },
    stylesheets: {
      "src/panel.cssx": "dist/styles/src/panel.css",
      "src/card.cssx": "dist/styles/src/card.css",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Bundler availability (recorded, never installed)                           */
/* -------------------------------------------------------------------------- */

/** Status of the optional bundler row of the plan's §TT5 table. */
export interface BundlerStatus {
  readonly tool: "esbuild" | "vite";
  readonly present: boolean;
  /** Absolute path of the tool's manifest when present. */
  readonly manifest?: string;
  /** Recorded reason, mandatory when the tool is absent. */
  readonly reason: string;
}

/**
 * Report whether `esbuild` or `vite` is already installed in this repository.
 *
 * The plan allows bundling the generated import "when those tools are already present
 * (no new dependency)". Neither is a dependency here, so the row is recorded as not run
 * instead of installing one.
 */
export function bundlerStatus(tool: "esbuild" | "vite"): BundlerStatus {
  const manifest = join(REPO_ROOT, "node_modules", tool, "package.json");
  if (existsSync(manifest)) {
    return { tool, present: true, manifest, reason: `present at ${manifest}` };
  }
  return {
    tool,
    present: false,
    reason: `${tool} is not present in node_modules (no new dependency permitted)`,
  };
}
