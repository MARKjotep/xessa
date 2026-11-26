/**
 * TT2 scale corpus — seeded generators, temp-project plumbing and emitted-CSS
 * checks for `.ai/plans/CSSX-PLAN-TESTING.md` §TT2.
 *
 * Every input is produced by a seeded generator (`tests/stress/prng.ts`) or by a
 * fixed index-derived recipe; nothing here reads the clock, the PID or OS
 * entropy. Character-level content that does not affect the assertion (padding,
 * colour, alias order) still comes from the PRNG so a different
 * `XESSA_STRESS_SEED` exercises different bytes at the same sizes.
 *
 * Files are written only into `mkdtemp` directories under the OS temp dir and
 * removed by {@link cleanupTempProjects}; the repository, `examples/` and
 * `tests/fixtures/` are never written.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { compileProject, parse, tokenize } from "../../../packages/compiler/src/index.ts";
import type { Diagnostic } from "../../../packages/compiler/src/types/diagnostics.ts";
import type { ModuleHost, OutputOptions } from "../../../packages/compiler/src/types/options.ts";
import { REPO_ROOT } from "../corpus.ts";
import type { StressRng } from "../prng.ts";

/** Absolute path of the TypeScript entry point under test. */
export const COMPILER_ENTRY = join(REPO_ROOT, "packages/compiler/src/index.ts");

/** Absolute path of the CLI entry point used for real-project builds. */
export const CLI_ENTRY = join(REPO_ROOT, "packages/cli/src/index.ts");

/** Absolute path of the benchmark harness (subprocess-only; it runs `main()` on import). */
export const BENCHMARK_ENTRY = join(REPO_ROOT, "scripts/benchmark.ts");

/** Absolute path of the repository's TypeScript compiler binary. */
export const TSC_ENTRY = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

/** Sizes fixed by the plan's §TT2 case table. */
export const SCALE = Object.freeze({
  /** Source files in the generated 10k-selector project. */
  selectorFiles: 100,
  /** Rules (one selector each) per selector-project file. */
  rulesPerFile: 100,
  /** Declarations in the token-heavy file; measured to exceed 5k lexer tokens. */
  tokenDeclarations: 850,
  /** Media aliases/variants on one rule. */
  mediaVariants: 100,
  /** Modules in the `@use` chain. */
  useChainModules: 1_000,
  /** Modules in the diamond and cycle graphs. */
  graphModules: 500,
  /** Nested `&` levels. */
  ampDepth: 1_000,
  /** Selectors in the deepest rule's selector list. */
  selectorListItems: 500,
  /** Source files in the generated project. */
  projectFiles: 1_000,
});

/** One generated project: file contents keyed by workspace-relative POSIX path. */
export interface ScaleProject {
  readonly files: Readonly<Record<string, string>>;
  /** Workspace-relative entry paths handed to `compileProject` or the CLI. */
  readonly entries: readonly string[];
}

const temporaryRoots: string[] = [];

/** Write every file of a project map into `root`, creating parent directories. */
export function writeProjectFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
}

/**
 * Create a project in a fresh `mkdtemp` directory and return its canonical root.
 *
 * The root is `realpath`-ed because on macOS `os.tmpdir()` hands out
 * `/var/folders/…` while the kernel path is `/private/var/folders/…`; the
 * compiler's workspace-containment checks compare canonical paths.
 */
export function createTempProject(files: Readonly<Record<string, string>>): string {
  const created = mkdtempSync(join(tmpdir(), "xessa-scale-"));
  const root = realpathSync(created).replace(/\\/g, "/");
  temporaryRoots.push(root);
  writeProjectFiles(root, files);
  return root;
}

/** Remove every temporary project created by this module. */
export function cleanupTempProjects(): void {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Read one project file as UTF-8. */
export function readProjectFile(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/**
 * Recursively list files under `root/relativeDir` as sorted POSIX paths relative
 * to `root` (`dist/styles/src/file-0000.css` and so on).
 */
export function listProjectFiles(root: string, relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(root, relative)).sort()) {
      const child = `${relative}/${entry}`;
      if (statSync(join(root, child)).isDirectory()) {
        walk(child);
        continue;
      }
      found.push(child);
    }
  };
  walk(relativeDir);
  return found.sort();
}

/** In-memory `ModuleHost`: no filesystem access, canonical paths are identities. */
export function createMemoryHost(
  files: Readonly<Record<string, string>>,
  root = "/workspace",
): ModuleHost {
  const map = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    map.set(path.startsWith("/") ? path : posix.join(root, path), content);
  }
  return {
    async readFile(path: string): Promise<string> {
      const content = map.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return map.has(path);
    },
    canonicalize(path: string): string {
      return path;
    },
    resolvePath(from: string, to: string): string {
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      return root;
    },
  };
}

/** Seeded six-digit hex colour. */
function colour(rng: StressRng): string {
  return `#${(rng.nextInt(0x100_0000) + 0x100_0000).toString(16).slice(1)}`;
}

/**
 * Plan row "10k-selector project, 5k-token file".
 *
 * `selectorFiles × rulesPerFile` = 10 000 single-class rules and one token module
 * whose source tokenizes to more than 5 000 lexer tokens. Every entry imports the
 * token module, so the build exercises resolution, naming and emission at scale.
 */
export function selectorScaleProject(rng: StressRng): ScaleProject {
  const files: Record<string, string> = {};
  const declarations: string[] = [];
  for (let index = 0; index < SCALE.tokenDeclarations; index += 1) {
    declarations.push(`  --token-${index}: ${rng.nextRange(0, 400)}px;`);
  }
  files["src/tokens.cssx"] =
    `@variables {\n  spacing: ${rng.nextRange(2, 12)}px;\n}\n\n.token-set {\n${declarations.join("\n")}\n}\n`;
  const entries: string[] = ["src/tokens.cssx"];

  for (let fileIndex = 0; fileIndex < SCALE.selectorFiles; fileIndex += 1) {
    const file = String(fileIndex).padStart(3, "0");
    const rules: string[] = [];
    for (let ruleIndex = 0; ruleIndex < SCALE.rulesPerFile; ruleIndex += 1) {
      const rule = String(ruleIndex).padStart(3, "0");
      const mediaPadding = rng.nextRange(0, 32);
      rules.push(
        [
          `.card-${file}-${rule} {`,
          `  display: ${ruleIndex % 2 === 0 ? "flex" : "grid"};`,
          `  gap: ${rng.nextRange(0, 24)}px;`,
          `  padding: ${rng.nextRange(0, 32)}px @md ${mediaPadding}px;`,
          `  color: ${colour(rng)};`,
          "}",
        ].join("\n"),
      );
    }
    files[`src/file-${file}.cssx`] = `@use "./tokens.cssx" as t;\n\n${rules.join("\n\n")}\n`;
    entries.push(`src/file-${file}.cssx`);
  }

  return { files, entries };
}

/** Expected shape of the one-rule/100-media-variant case. */
export interface MediaVariantCase {
  readonly source: string;
  /** Declaration values in authored order (`value-0` … `value-100`). */
  readonly values: readonly string[];
  /** Visual order of the aliases after the seeded shuffle. */
  readonly aliases: readonly { readonly name: string; readonly query: string }[];
}

/**
 * Plan row "One rule with 100 media variants".
 *
 * Aliases are defined in index order but referenced in a PRNG-shuffled order, so
 * "grouped output keeps declaration order" is asserted against a non-identity
 * sequence: the emitted declarations must follow {@link MediaVariantCase.values}
 * and the emitted `@media` blocks must follow {@link MediaVariantCase.aliases}.
 */
export function mediaVariantCase(rng: StressRng, variants = SCALE.mediaVariants): MediaVariantCase {
  const order = rng.shuffle(Array.from({ length: variants }, (_, index) => index));
  const aliases = order.map((index) => ({
    name: `m${index}`,
    query: `(min-width: ${index * 10}px)`,
  }));
  const values: string[] = ["value-0"];
  let declaration = "width: value-0";
  for (let step = 0; step < aliases.length; step += 1) {
    const alias = aliases[step];
    if (alias === undefined) break;
    values.push(`value-${step + 1}`);
    declaration += ` @${alias.name} value-${step + 1}`;
  }
  declaration += ";";
  const blocks = aliases.map((alias) => `  ${alias.name}: ${alias.query};`).join("\n");
  const source = `@media-types {\n${blocks}\n}\n\n.rule {\n  ${declaration}\n}\n`;
  return { source, values, aliases };
}

/**
 * Plan row "1k-deep `@use` chain".
 *
 * Each module style-imports the next and defines one rule, so the emitted CSS
 * must contain all 1 000 rules deepest-first and the dependency list must hold
 * the 999 imported modules.
 */
export function useChainProject(rng: StressRng, depth = SCALE.useChainModules): ScaleProject {
  const files: Record<string, string> = {};
  for (let index = 0; index < depth; index += 1) {
    const next = index === depth - 1 ? "" : `@use "./m${index + 1}.cssx" styles;\n`;
    const step = rng.nextRange(1, 9);
    files[`src/m${index}.cssx`] =
      `${next}@variables {\n  step: ${step}px;\n}\n\n.c${index} {\n  order: ${index};\n  gap: ${step}px;\n}\n`;
  }
  return { files, entries: ["src/m0.cssx"] };
}

/** One generated module graph plus its entry. */
export interface GraphProject extends ScaleProject {
  readonly modules: number;
}

/**
 * Plan row "Diamond + cycle graph of 500 modules" — diamond half.
 *
 * `entry` imports 249 `a` leaves and 249 `b` leaves; every leaf style-imports the
 * single shared `c` module, so `c` must be merged exactly once and the build must
 * be byte-identical on a second run.
 */
export function diamondProject(rng: StressRng, modules = SCALE.graphModules): GraphProject {
  const shared = Math.max(1, modules - 2);
  const left = Math.ceil(shared / 2);
  const right = shared - left;
  const files: Record<string, string> = {
    "src/c.cssx": `.c {\n  color: ${colour(rng)};\n}\n`,
  };
  const entryUses: string[] = [];
  for (let index = 0; index < left; index += 1) {
    files[`src/a${index}.cssx`] =
      `@use "./c.cssx" styles;\n\n.a${index} {\n  order: ${index};\n}\n`;
    entryUses.push(`@use "./a${index}.cssx" styles;\n`);
  }
  for (let index = 0; index < right; index += 1) {
    files[`src/b${index}.cssx`] =
      `@use "./c.cssx" styles;\n\n.b${index} {\n  order: ${index};\n}\n`;
    entryUses.push(`@use "./b${index}.cssx" styles;\n`);
  }
  files["src/entry.cssx"] =
    `${entryUses.join("")}\n.entry {\n  padding: ${rng.nextRange(0, 16)}px;\n}\n`;
  return { files, entries: ["src/entry.cssx"], modules };
}

/**
 * Plan row "Diamond + cycle graph of 500 modules" — cycle half.
 *
 * Every module style-imports its successor and the last imports the first, so
 * the resolver must report one typed `XESSA2001` cycle diagnostic and terminate
 * deterministically instead of hanging.
 */
export function cycleProject(rng: StressRng, modules = SCALE.graphModules): GraphProject {
  const files: Record<string, string> = {};
  for (let index = 0; index < modules; index += 1) {
    const successor = (index + 1) % modules;
    files[`src/m${index}.cssx`] =
      `@use "./m${successor}.cssx" styles;\n\n.c${index} {\n  order: ${index};\n  color: ${colour(rng)};\n}\n`;
  }
  return { files, entries: ["src/m0.cssx"], modules };
}

/** Expected shape of the deep-`&`/selector-list case. */
export interface AmpChainCase {
  readonly source: string;
  readonly depth: number;
  readonly selectorCount: number;
  /** Suffixes appended by each `&` level, in nesting order. */
  readonly chainSuffixes: readonly string[];
}

/**
 * Plan row "1k-deep `&` chain, 500-item selector list".
 *
 * Each level appends `&.m<n>`, which flattens to one selector of linear length
 * (a bare `& {}` would resolve to the identical parent selector and emit nothing
 * new); the deepest rule then carries a 500-item list. Emitted selectors must
 * stay valid CSS.
 */
export function ampChainCase(
  rng: StressRng,
  depth = SCALE.ampDepth,
  selectorCount = SCALE.selectorListItems,
): AmpChainCase {
  const chainSuffixes = Array.from({ length: depth }, (_, index) => `m${index}`);
  const list = Array.from({ length: selectorCount }, (_, index) => `&.s${index}`).join(", ");
  const lines: string[] = [".chain {"];
  for (const suffix of chainSuffixes) lines.push(`  &.${suffix} {`);
  lines.push(`    ${list} {`);
  lines.push(`      color: ${colour(rng)};`);
  lines.push("    }");
  for (let index = 0; index < depth; index += 1) lines.push("  }");
  lines.push("}");
  return {
    source: `${lines.join("\n")}\n`,
    depth,
    selectorCount,
    chainSuffixes,
  };
}

/** Output settings used by the generated 1000-file project (mirrors the benchmark shape). */
export function projectOutputOptions(): OutputOptions {
  return {
    cssDir: "dist/styles",
    mapDir: "dist/maps",
    emitCss: true,
    emitMap: true,
    emitTypes: true,
    sourceMap: false,
    minify: false,
  };
}

/**
 * Plan row "1000-file project": a real `xessa.config.json` project plus a
 * `tsconfig.json` that type-checks only the generated declarations.
 */
export function thousandFileProject(rng: StressRng, fileCount = SCALE.projectFiles): ScaleProject {
  const config = {
    include: ["src/**/*.cssx"],
    exclude: ["dist"],
    output: projectOutputOptions(),
    classes: { strategy: "prefix", prefix: "ui" },
    media: { md: "(min-width: 768px)" },
    compiler: { strict: true, mediaGrouping: "safe" },
  };
  const files: Record<string, string> = {
    "xessa.config.json": `${JSON.stringify(config, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["dist/maps/**/*.d.ts"],
      },
      null,
      2,
    )}\n`,
  };
  const width = String(fileCount).length;
  const entries: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const name = `file-${String(index).padStart(width, "0")}`;
    files[`src/${name}.cssx`] =
      `@variables {\n  gap: ${rng.nextRange(2, 16)}px;\n}\n\n.card-${name.slice(5)} {\n  display: flex;\n  padding: $gap @md ${rng.nextRange(0, 24)}px;\n  color: ${colour(rng)};\n  &:hover {\n    opacity: 0.85;\n  }\n  & > .icon-${name.slice(5)} {\n    width: 16px;\n  }\n}\n`;
    entries.push(`src/${name}.cssx`);
  }
  return { files, entries };
}

/* -------------------------------------------------------------------------- */
/* Benchmark harness replication (weakest-10 #10)                              */
/* -------------------------------------------------------------------------- */

/** Import-chain length in `scripts/benchmark.ts` (`CHAIN_LENGTH`). */
export const BENCHMARK_CHAIN_LENGTH = 10;

/** Byte-for-byte replica of `scripts/benchmark.ts`'s `sourceFor` generator. */
function benchmarkEntrySource(index: number): string {
  const pad = String(index).padStart(4, "0");
  const base = 12 + (index % 8);
  const wide = 20 + (index % 12);
  const gap = 8 + (index % 16);
  return `@use "./tokens.cssx" as t;
@use "./chain/chain-${BENCHMARK_CHAIN_LENGTH - 1}.cssx" as chain;
@variables {
  gap: $t.spacing;
  local: ${(index % 7) + 1}px;
}
.card-${pad} {
  display: flex;
  padding: $gap @md ${base}px @xl ${wide}px;
  margin: $local @dark 0;
  color: $chain.accent @dark #f8fafc;
  border-radius: 6px;
  &:hover { opacity: 0.85; }
  &:focus-visible { outline: 2px solid $chain.accent; }
  & > .icon-${pad} { width: 16px @lg 20px; }
  @md {
    gap: ${gap}px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
}

/** Byte-for-byte replica of `scripts/benchmark.ts`'s `chainSource` generator. */
function benchmarkChainSource(level: number): string {
  const previous =
    level === 0 ? '@use "../tokens.cssx" as tokens;\n' : `@use "./chain-${level - 1}.cssx";\n`;
  const inherited = level === 0 ? "$tokens.spacing" : `$${level - 1}px`;
  return `${previous}@variables {
  accent: #2563eb;
  step-${level}: ${level}px;
  inherited-${level}: ${inherited};
}
`;
}

/**
 * Recreate the benchmark harness's fixture project in memory for `size` files.
 *
 * This is a byte-for-byte copy of `scripts/benchmark.ts`'s `generate()` (a fixed
 * recipe, not a random input), which lets the verification test prove that its
 * own independent compile reproduces the harness's reported `outputBytes` before
 * trusting it about the zero-error claim.
 */
export function benchmarkShapedProject(size: number): ScaleProject {
  const files: Record<string, string> = {
    "src/tokens.cssx": "@variables {\n  spacing: 12px;\n  radius: 6px;\n}\n",
  };
  for (let level = 0; level < BENCHMARK_CHAIN_LENGTH; level += 1) {
    files[`src/chain/chain-${level}.cssx`] = benchmarkChainSource(level);
  }
  const width = String(size).length;
  const entries: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const name = `file-${String(index).padStart(width, "0")}.cssx`;
    files[`src/${name}`] = benchmarkEntrySource(index);
    entries.push(`src/${name}`);
  }
  return { files, entries };
}

/** Total emitted CSS + JS + types bytes for a project, matching the harness's `outputBytes`. */
export async function benchmarkArtifactBytes(project: ScaleProject): Promise<number> {
  const results = await compileProject(project.entries, createMemoryHost(project.files), {
    projectRoot: "/workspace",
    output: projectOutputOptions(),
    mediaGrouping: "safe",
  });
  let bytes = 0;
  for (const result of Object.values(results)) {
    bytes += Buffer.byteLength(result.css ?? "", "utf8");
    bytes += Buffer.byteLength(result.js ?? "", "utf8");
    bytes += Buffer.byteLength(result.types ?? "", "utf8");
  }
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Emitted-CSS validation helpers                                             */
/* -------------------------------------------------------------------------- */

/**
 * Re-parse emitted CSS with the compiler's tolerant parser.
 *
 * The plan accepts `parse()` (or `xessa check`) as the validity oracle because a
 * third-party CSS parser is an owner dependency decision; the limitation is
 * recorded in the TT2 report.
 */
export function cssReparseDiagnostics(css: string): readonly Diagnostic[] {
  return parse(css, { file: "dist/emitted.css" }).diagnostics;
}

/** Error diagnostics from {@link cssReparseDiagnostics}, formatted for failure messages. */
export function cssErrorMessages(css: string): string[] {
  return cssReparseDiagnostics(css)
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`);
}

/** Unique emitted class tokens (`.name`) in document order. */
export function cssClassTokens(css: string): string[] {
  const seen = new Set<string>();
  for (const match of css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/gu)) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

/** Values of every `property: <value>;` declaration, in emitted order. */
export function declarationValues(css: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;}]+);`, "gu");
  const values: string[] = [];
  for (const match of css.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) values.push(value.trim());
  }
  return values;
}

/** Every `@media <query>` prelude in emitted order. */
export function mediaQueries(css: string): string[] {
  const queries: string[] = [];
  for (const match of css.matchAll(/@media\s+([^{]+)\{/gu)) {
    const query = match[1];
    if (query !== undefined) queries.push(query.trim());
  }
  return queries;
}

/** Number of lexer tokens in one source (EOF excluded). */
export function tokenCount(source: string, file = "src/source.cssx"): number {
  return tokenize(source, file).tokens.filter((token) => token.kind !== "eof").length;
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

/** Run the compiled-and-installed TypeScript compiler against `projectRoot/tsconfig.json`. */
export function runTsc(projectRoot: string, timeoutMs = 180_000): ProcessOutcome {
  const result = spawnSync(
    process.execPath,
    [TSC_ENTRY, "-p", join(projectRoot, "tsconfig.json")],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: timeoutMs,
    },
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Run the CLI TypeScript entry point as a subprocess in `cwd`. */
export function runCli(args: readonly string[], cwd: string, timeoutMs = 180_000): ProcessOutcome {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Run `scripts/benchmark.ts --json --size <size>` in a subprocess.
 *
 * The harness calls `await main(process.argv.slice(2))` at import time, so it
 * cannot be imported from a test; a subprocess is the only honest invocation.
 */
export function runBenchmark(
  size: number,
  timeoutMs = 240_000,
): { readonly outcome: ProcessOutcome; readonly report: unknown } {
  const result = spawnSync(process.execPath, [BENCHMARK_ENTRY, "--json", "--size", String(size)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  let report: unknown;
  try {
    report = JSON.parse(stdout.trim());
  } catch {
    report = undefined;
  }
  return {
    outcome: { status: result.status ?? -1, stdout, stderr: result.stderr ?? "" },
    report,
  };
}

/** Structurally comparable shape of a JSON value: key sets, array shape and leaf types. */
export function valueShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [valueShape(value[0])];
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) shape[key] = valueShape(record[key]);
    return shape;
  }
  return typeof value;
}

/** Result of the isolated 1000-file memory probe. */
export interface MemoryProbeResult {
  readonly entries: number;
  readonly buildMs: number;
  readonly baselineRssMb: number;
  readonly rssMb: number;
  readonly heapUsedMb: number;
  readonly peakRssMb: number;
  readonly growthMb: number;
  readonly errors: number;
  readonly cssBytes: number;
  readonly classes: number;
}

/**
 * Measure one cold `compileProject` build of `projectRoot` in its own process.
 *
 * Peak RSS (`process.resourceUsage().maxRSS`) is process-wide and monotonic, so
 * running in a child keeps the number comparable to the benchmark harness's
 * per-size child process. The probe reads only the project's `src/` directory.
 */
export function runMemoryProbe(
  projectRoot: string,
  timeoutMs = 240_000,
): {
  readonly outcome: ProcessOutcome;
  readonly result: MemoryProbeResult | undefined;
} {
  const code = `
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { compileProject, createNodeHost } from ${JSON.stringify(COMPILER_ENTRY)};
const root = process.env.XESSA_SCALE_ROOT;
if (root === undefined) throw new Error("XESSA_SCALE_ROOT is required");
const entries = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".cssx"))
  .sort()
  .map((name) => "src/" + name);
const baseline = process.memoryUsage();
const started = performance.now();
const results = await compileProject(entries, createNodeHost(root), {
  projectRoot: root,
  output: {
    cssDir: "dist/styles",
    mapDir: "dist/maps",
    emitCss: true,
    emitMap: true,
    emitTypes: true,
    sourceMap: false,
    minify: false,
  },
  mediaGrouping: "safe",
});
const usage = process.memoryUsage();
const peak = process.resourceUsage().maxRSS * 1024;
let errors = 0;
let cssBytes = 0;
let classes = 0;
for (const result of Object.values(results)) {
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
  }
  cssBytes += Buffer.byteLength(result.css ?? "", "utf8");
  classes += Object.keys(result.classes).length;
}
console.log(JSON.stringify({
  entries: entries.length,
  buildMs: performance.now() - started,
  baselineRssMb: baseline.rss / 1048576,
  rssMb: usage.rss / 1048576,
  heapUsedMb: usage.heapUsed / 1048576,
  peakRssMb: peak / 1048576,
  growthMb: (peak - baseline.rss) / 1048576,
  errors,
  cssBytes,
  classes,
}));
`;
  const result = spawnSync(process.execPath, ["-e", code], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, XESSA_SCALE_ROOT: projectRoot },
  });
  const outcome: ProcessOutcome = {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  let parsed: MemoryProbeResult | undefined;
  try {
    parsed = JSON.parse(outcome.stdout.trim()) as MemoryProbeResult;
  } catch {
    parsed = undefined;
  }
  return { outcome, result: parsed };
}
