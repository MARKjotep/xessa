/**
 * Check bodies for the five TT1 fuzz areas.
 *
 * The `*.test.ts` files and `runner.ts` share this module so a fix or a new
 * assertion lands in exactly one place; the tests add named adversarial cases on
 * top, the runner replays the same budgeted cases for long runs.
 *
 * Properties asserted here, per the plan's TT1 exit criteria:
 *
 * - the lexer is lossless, eof-terminated, forward-only and in-bounds (area `lexer`);
 * - the parser never throws, always returns a `Stylesheet`, and keeps diagnostics
 *   in bounds and bounded per input (area `parser`);
 * - `compile()` never throws, keeps diagnostics bounded, and every diagnostic span
 *   satisfies `0 <= start <= end <= source.length` (area `compile`);
 * - `format(format(x)) == format(x)` and `parse(format(x))` is IR-equal to
 *   `parse(x)` once positions are normalized (area `roundtrip`);
 * - identical output across repeated runs, shuffled module-read order and
 *   generator re-runs (area `determinism`).
 *
 * No defect is pinned any more. `CSSX-T1` (at-rule terminator growth),
 * `CSSX-T2` (adjacent `@`-marker variant split) and `CSSX-T3` (out-of-bounds
 * `XESSA2001` span on an invalid `$` prefix) are fixed, so any violation reported
 * here is a hard failure for its area; there is no classifier that could exempt
 * an input shape. The `limitation`/`limitations` fields are retained for future
 * owner-approved pins and are empty in every run.
 */

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import {
  compile,
  compileProject,
  format,
  parse,
  tokenize,
} from "../../../packages/compiler/src/index.ts";
import type {
  CompileResult,
  Diagnostic,
  ModuleHost,
} from "../../../packages/compiler/src/index.ts";
import {
  REPO_ROOT,
  fixtureDirectoryFiles,
  loadCorpus,
  mutantCorpus,
  syntheticTemplates,
} from "../corpus.ts";
import type { CorpusFixture, Mutant } from "../corpus.ts";
import { createLabelledRng, hashString } from "../prng.ts";
import type { StressRng } from "../prng.ts";

/** The five TT1 areas, in run order. */
export const AREA_NAMES = ["lexer", "parser", "compile", "roundtrip", "determinism"] as const;

/** One TT1 area name. */
export type AreaName = (typeof AREA_NAMES)[number];

/** Seed plus budget for one area run. */
export interface AreaConfig {
  /** PRNG seed; the same seed reproduces every case. */
  readonly seed: number;
  /** Number of randomized cases to run in the area. */
  readonly budget: number;
}

/** One invariant violation, fully reproducible from `seed` plus `inputHash`. */
export interface Violation {
  /** Area that found it. */
  readonly area: AreaName;
  /** Case label, including fixture id, operator and description. */
  readonly caseLabel: string;
  /** What invariant failed. */
  readonly message: string;
  /** Stable hash of the offending input. */
  readonly inputHash: string;
  /** Stand-alone reproduction snippet (input plus API call). */
  readonly reproducer: string;
  /** Known-defect label; reserved (no defect is pinned, so runs leave it unset). */
  readonly limitation?: string;
}

/** Result of one area run. */
export interface AreaRun {
  /** Area name. */
  readonly area: AreaName;
  /** Seed used. */
  readonly seed: number;
  /** Budget used. */
  readonly budget: number;
  /** Randomized cases executed (fixed adversarial cases are added by the tests). */
  readonly cases: number;
  /** Invariant violations; any entry fails the area. */
  readonly violations: readonly Violation[];
  /** Owner-approved, documented exceptions; empty because nothing is pinned. */
  readonly limitations: readonly Violation[];
  /** Elapsed wall time in milliseconds, for the runner's report. */
  readonly elapsedMs: number;
}

/**
 * Fixed cap on diagnostics for one input.
 *
 * Measured worst case over 200 mutants, all unicode injections and the synthetic
 * templates is far below this; the cap exists so an unbounded diagnostic blow-up
 * (one per token, say) fails instead of merely looking slow.
 */
export const MAX_DIAGNOSTICS_PER_INPUT = 64;

/** Per-case ceiling: a single case slower than this counts as a hang. */
export const MAX_CASE_MS = 5_000;

/** Positions on AST nodes and tokens; dropped before structural comparison. */
const POSITION_KEYS: ReadonlySet<string> = new Set([
  "span",
  "selectorSpan",
  "start",
  "end",
  "file",
  "offset",
  "line",
  "column",
]);

/**
 * Structural view of a value with every position dropped.
 *
 * `format()` necessarily moves text, so offsets and spans may differ between the
 * authored and formatted source. Everything else (`kind`, names, values,
 * variants, ordering) must be identical for the round-trip property to hold.
 */
export function structureOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structureOf);
  if (value !== null && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (POSITION_KEYS.has(key)) continue;
      normalized[key] = structureOf(child);
    }
    return normalized;
  }
  return value;
}

/** Stable structural fingerprint of a value. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(structureOf(value));
}

/** Trim an input for a readable, still-replayable reproducer string. */
export function describeInput(source: string): string {
  const quoted = JSON.stringify(source);
  if (quoted.length <= 600) return quoted;
  return `${quoted.slice(0, 600)}… (${source.length} chars, hash ${hashString(source)})`;
}

/** Build the violation record used by every area. */
function violation(
  area: AreaName,
  caseLabel: string,
  message: string,
  source: string,
  reproducer: string,
  limitation?: string,
): Violation {
  const base = {
    area,
    caseLabel,
    message,
    inputHash: hashString(source),
    reproducer,
  };
  return limitation === undefined ? base : { ...base, limitation };
}

/**
 * Lexical stream invariants: lossless coverage, single trailing `eof`, forward
 * progress, in-bounds diagnostics.
 */
export function tokenStreamViolations(source: string, file: string): string[] {
  const problems: string[] = [];
  let result: ReturnType<typeof tokenize>;
  try {
    result = tokenize(source, file);
  } catch (error) {
    return [`tokenize threw: ${String(error)}`];
  }
  const { tokens, diagnostics } = result;
  if (tokens.length === 0) problems.push("token stream is empty");
  const last = tokens[tokens.length - 1];
  if (last?.kind !== "eof") problems.push(`last token is ${String(last?.kind)}, not eof`);
  if (tokens.filter((token) => token.kind === "eof").length !== 1) {
    problems.push("token stream does not end with exactly one eof");
  }
  if (last !== undefined && (last.start !== source.length || last.end !== source.length)) {
    problems.push(`eof span ${last.start}..${last.end} != ${source.length}`);
  }
  let offset = 0;
  for (const token of tokens) {
    if (token.start !== offset)
      problems.push(`token ${token.kind} starts at ${token.start}, expected ${offset}`);
    if (token.kind !== "eof" && token.end <= token.start)
      problems.push(`token ${token.kind} is not forward-only`);
    if (token.value !== source.slice(token.start, token.end)) {
      problems.push(
        `token ${token.kind} value is not the authored slice at ${token.start}..${token.end}`,
      );
    }
    offset = token.end;
    if (problems.length > 8) return problems;
  }
  if (offset !== source.length)
    problems.push(`tokens cover ${offset} of ${source.length} code units`);
  problems.push(...diagnosticViolations(diagnostics, singleSourceResolver(source.length), true));
  return problems;
}

/** Longest source text a span may address, or `undefined` when the file is unknown. */
export type SourceLengthResolver = (spanFile: string) => number | undefined;

/** Cache of module source lengths, so a cross-module diagnostic is checked against its own file. */
const moduleLengthCache = new Map<string, number>();

/**
 * Resolve the length of the source a diagnostic span addresses.
 *
 * `compile()` diagnostics may point at an imported module rather than the entry,
 * so the bound must come from the span's own file. The entry source is used when
 * the paths agree; otherwise the file is read (read-only) from {@link REPO_ROOT}
 * and cached. Files outside the workspace are unknown and only get the
 * path-independent checks.
 */
function sourceLengthResolver(entryFile: string, entrySource: string): SourceLengthResolver {
  const entry = entryFile.replaceAll("\\", "/");
  return (spanFile: string): number | undefined => {
    const normalized = spanFile.replaceAll("\\", "/");
    if (normalized === entry || normalized.endsWith(`/${entry}`)) return entrySource.length;
    const absolute = normalized.startsWith("/") ? normalized : `${REPO_ROOT}/${normalized}`;
    if (!absolute.startsWith(`${REPO_ROOT}/`)) return undefined;
    const cached = moduleLengthCache.get(absolute);
    if (cached !== undefined) return cached;
    try {
      const length = readFileSync(absolute, "utf8").length;
      moduleLengthCache.set(absolute, length);
      return length;
    } catch {
      return undefined;
    }
  };
}

/** Bounds resolver for a single-source call: every span addresses that source. */
function singleSourceResolver(sourceLength: number): SourceLengthResolver {
  return () => sourceLength;
}

/** Span, code and severity invariants shared by every diagnostic producer. */
export function diagnosticViolations(
  diagnostics: readonly Diagnostic[],
  lengthOf: SourceLengthResolver,
  requireSourceOrder = false,
): string[] {
  const problems: string[] = [];
  let previousStart = -1;
  for (const diagnostic of diagnostics) {
    const { start, end, file } = diagnostic.span;
    if (!/^XESSA[1-5]\d{3}$/u.test(diagnostic.code)) problems.push(`bad code ${diagnostic.code}`);
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
      problems.push(`bad severity ${String(diagnostic.severity)} for ${diagnostic.code}`);
    }
    const sourceLength = lengthOf(file);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      problems.push(`non-integer span ${String(start)}..${String(end)} for ${diagnostic.code}`);
    } else if (start < 0 || end < start) {
      problems.push(`invalid span ${start}..${end} for ${diagnostic.code}`);
    } else if (sourceLength !== undefined && end > sourceLength) {
      problems.push(
        `out-of-bounds span ${start}..${end} for ${diagnostic.code} in ${file} (source ${sourceLength})`,
      );
    }
    if (typeof file !== "string" || file.length === 0)
      problems.push(`empty span file for ${diagnostic.code}`);
    // Only single-stage producers (the lexer) promise source order; `parse` and
    // `compile` merge lexical-then-syntactic and per-module batches by design.
    if (requireSourceOrder && start < previousStart) {
      problems.push(`${diagnostic.code} is out of source order at ${start}`);
    }
    previousStart = start;
    if (problems.length > 8) return problems;
  }
  return problems;
}

/**
 * Parse invariants for one source: total function, stable file, bounded diagnostics.
 *
 * `diagnosticCap` defaults to {@link MAX_DIAGNOSTICS_PER_INPUT}, which is the
 * fixture-sized budget. Deliberately pathological inputs that author one
 * statement per nesting level (the 10 000-deep cases) pass a depth-derived cap,
 * because their diagnostic count is legitimately linear in the authored depth.
 */
export function parseViolations(
  source: string,
  file: string,
  diagnosticCap = MAX_DIAGNOSTICS_PER_INPUT,
): string[] {
  const problems: string[] = [];
  let result: ReturnType<typeof parse>;
  try {
    result = parse(source, { file });
  } catch (error) {
    return [`parse threw: ${String(error)}`];
  }
  if (result.ast.kind !== "stylesheet") problems.push(`ast.kind is ${String(result.ast.kind)}`);
  if (result.ast.file !== file) problems.push(`ast.file is ${result.ast.file}, expected ${file}`);
  if (result.ast.span.start !== 0)
    problems.push(`stylesheet span starts at ${result.ast.span.start}`);
  if (!Object.isFrozen(result.ast)) problems.push("ast is not frozen");
  if (result.diagnostics.length > diagnosticCap) {
    problems.push(`${result.diagnostics.length} diagnostics exceeds cap ${diagnosticCap}`);
  }
  problems.push(...diagnosticViolations(result.diagnostics, singleSourceResolver(source.length)));
  return problems;
}

/** Round-trip invariants for one source; every problem is a hard failure. */
export function roundTripViolations(
  source: string,
  file: string,
): { readonly problems: readonly string[] } {
  const problems: string[] = [];
  let once: ReturnType<typeof format>;
  try {
    once = format(source, file);
  } catch (error) {
    return { problems: [`format threw: ${String(error)}`] };
  }
  problems.push(...diagnosticViolations(once.diagnostics, singleSourceResolver(source.length)));
  const twice = format(once.formatted, file);
  if (twice.formatted !== once.formatted) {
    problems.push("format(format(x)) != format(x)");
  }
  const before = fingerprint(parse(source, { file }).ast);
  const after = fingerprint(parse(once.formatted, { file }).ast);
  if (before !== after) problems.push("parse(format(x)) IR differs from parse(x) IR");
  return { problems };
}

/** Compile invariants for one source: never throws, bounded and in-bounds diagnostics. */
export async function compileViolations(source: string, file: string): Promise<string[]> {
  const problems: string[] = [];
  let result: Awaited<ReturnType<typeof compile>>;
  try {
    result = await compile(source, { file, workspaceRoot: REPO_ROOT });
  } catch (error) {
    return [`compile threw: ${String(error)}`];
  }
  if (result.diagnostics.length > MAX_DIAGNOSTICS_PER_INPUT) {
    problems.push(
      `${result.diagnostics.length} diagnostics exceeds cap ${MAX_DIAGNOSTICS_PER_INPUT}`,
    );
  }
  problems.push(...diagnosticViolations(result.diagnostics, sourceLengthResolver(file, source)));
  if (Object.getPrototypeOf(result.classes) !== null) {
    problems.push("result.classes does not have a null prototype");
  }
  for (const [key, value] of Object.entries(result.classes)) {
    if (typeof value !== "string" || value.length === 0)
      problems.push(`class ${key} maps to ${String(value)}`);
    if (problems.length > 8) return problems;
  }
  for (const dependency of result.dependencies) {
    if (typeof dependency !== "string" || dependency.includes("\\")) {
      problems.push(`dependency ${String(dependency)} is not a POSIX path`);
    }
  }
  for (const [kind, artifact] of [
    ["css", result.css],
    ["js", result.js],
    ["types", result.types],
    ["sourceMap", result.sourceMap],
  ] as const) {
    if (artifact !== undefined && typeof artifact !== "string")
      problems.push(`${kind} is not a string`);
  }
  return problems;
}

/** Artifact snapshot used for byte-identity comparisons. */
export function artifactSnapshot(result: Awaited<ReturnType<typeof compile>>): string {
  return JSON.stringify({
    css: result.css ?? null,
    js: result.js ?? null,
    types: result.types ?? null,
    sourceMap: result.sourceMap ?? null,
    classes: { ...result.classes },
    dependencies: [...result.dependencies],
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      start: diagnostic.span.start,
      end: diagnostic.span.end,
      file: diagnostic.span.file,
    })),
  });
}

/** Case label for a mutant. */
function mutantLabel(mutant: Mutant): string {
  return `${mutant.fixtureId} [${mutant.operator}] ${mutant.description}`;
}

/** Case label for a synthetic template. */
function templateLabel(id: string): string {
  return `template:${id}`;
}

/** Reproducer command for a budgeted case. */
function reproducerFor(area: AreaName, config: AreaConfig, label: string): string {
  return `XESSA_STRESS_SEED=${config.seed} bun tests/stress/fuzz/runner.ts --area ${area} --budget ${config.budget} --seed ${config.seed}  # case: ${label}`;
}

/** Execute one budgeted case, converting a throw into a violation. */
function runCase(
  area: AreaName,
  config: AreaConfig,
  label: string,
  source: string,
  check: string[],
  reproducer: string,
): Violation | undefined {
  if (check.length === 0) return undefined;
  return violation(area, label, check.join("; "), source, reproducer);
}

/** Mutant source list for one area: fixtures round-robin so every fixture is used. */
function mutantsFor(
  area: AreaName,
  config: AreaConfig,
): { readonly rng: StressRng; readonly mutants: Mutant[] } {
  const rng = createLabelledRng(config.seed, area);
  return { rng, mutants: mutantCorpus(rng, config.budget) };
}

/** Lexer area: mutated bytes/tokens plus the synthetic grammar templates. */
export function runLexerArea(config: AreaConfig): AreaRun {
  const startedAt = performance.now();
  const violations: Violation[] = [];
  const limitations: Violation[] = [];
  const { mutants } = mutantsFor("lexer", config);
  let cases = 0;
  for (const mutant of mutants) {
    cases += 1;
    const label = mutantLabel(mutant);
    const found = runCase(
      "lexer",
      config,
      label,
      mutant.source,
      tokenStreamViolations(mutant.source, mutant.file),
      reproducerFor("lexer", config, label),
    );
    if (found !== undefined) violations.push(found);
  }
  for (const template of syntheticTemplates()) {
    cases += 1;
    const label = templateLabel(template.id);
    const found = runCase(
      "lexer",
      config,
      label,
      template.source,
      tokenStreamViolations(template.source, `stress/${template.id}.cssx`),
      reproducerFor("lexer", config, label),
    );
    if (found !== undefined) violations.push(found);
  }
  return finish("lexer", config, cases, violations, limitations, startedAt);
}

/**
 * Parser area: mutated sources plus deterministic character prefixes taken
 * round-robin across the whole fixture corpus.
 */
export function runParserArea(config: AreaConfig): AreaRun {
  const startedAt = performance.now();
  const violations: Violation[] = [];
  const limitations: Violation[] = [];
  const { mutants } = mutantsFor("parser", config);
  let cases = 0;
  for (const mutant of mutants) {
    cases += 1;
    const label = mutantLabel(mutant);
    const found = runCase(
      "parser",
      config,
      label,
      mutant.source,
      parseViolations(mutant.source, mutant.file),
      reproducerFor("parser", config, label),
    );
    if (found !== undefined) violations.push(found);
  }
  for (const template of syntheticTemplates()) {
    cases += 1;
    const label = templateLabel(template.id);
    const found = runCase(
      "parser",
      config,
      label,
      template.source,
      parseViolations(template.source, `stress/${template.id}.cssx`),
      reproducerFor("parser", config, label),
    );
    if (found !== undefined) violations.push(found);
  }
  return finish("parser", config, cases, violations, limitations, startedAt);
}

/** Compile area: mutated fixture sources through the public `compile()`. */
export async function runCompileArea(config: AreaConfig): Promise<AreaRun> {
  const startedAt = performance.now();
  const violations: Violation[] = [];
  const limitations: Violation[] = [];
  const { mutants } = mutantsFor("compile", config);
  let cases = 0;
  for (const mutant of mutants) {
    cases += 1;
    const label = mutantLabel(mutant);
    const caseStartedAt = performance.now();
    const problems = await compileViolations(mutant.source, mutant.file);
    const elapsed = performance.now() - caseStartedAt;
    if (elapsed > MAX_CASE_MS)
      problems.push(`case took ${Math.round(elapsed)}ms (ceiling ${MAX_CASE_MS}ms)`);
    const found = runCase(
      "compile",
      config,
      label,
      mutant.source,
      problems,
      reproducerFor("compile", config, label),
    );
    if (found !== undefined) violations.push(found);
  }
  return finish("compile", config, cases, violations, limitations, startedAt);
}

/** Round-trip area: `format` idempotence and `parse(format(x))` IR equality. */
export function runRoundTripArea(config: AreaConfig): AreaRun {
  const startedAt = performance.now();
  const violations: Violation[] = [];
  const limitations: Violation[] = [];
  const { mutants } = mutantsFor("roundtrip", config);
  let cases = 0;
  const check = (label: string, source: string, file: string): void => {
    cases += 1;
    const outcome = roundTripViolations(source, file);
    if (outcome.problems.length === 0) return;
    const record = violation(
      "roundtrip",
      label,
      outcome.problems.join("; "),
      source,
      reproducerFor("roundtrip", config, label),
    );
    violations.push(record);
  };
  for (const mutant of mutants) check(mutantLabel(mutant), mutant.source, mutant.file);
  for (const template of syntheticTemplates()) {
    check(templateLabel(template.id), template.source, `stress/${template.id}.cssx`);
  }
  return finish("roundtrip", config, cases, violations, limitations, startedAt);
}

/**
 * Host whose `readFile` settlements are ordered by the PRNG.
 *
 * Every batch of pending reads settles in a seeded shuffled order, so a pass that
 * leaks iteration order into its output produces different bytes here than under
 * {@link createOrderedHost}.
 */
export function createShuffledHost(
  files: ReadonlyMap<string, string>,
  rng: StressRng,
  root: string,
): ModuleHost {
  const pending: (() => void)[] = [];
  return {
    readFile: (path: string): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        pending.push(() => {
          const content = files.get(path);
          if (content === undefined) reject(new Error(`ENOENT: ${path}`));
          else resolve(content);
        });
        queueMicrotask(() => {
          if (pending.length === 0) return;
          const batch = pending.splice(0, pending.length);
          for (const settle of rng.shuffle(batch)) settle();
        });
      }),
    fileExists: async (path: string): Promise<boolean> => files.has(path),
    canonicalize: (path: string): string => path,
    resolvePath: (from: string, to: string): string => posix.resolve(posix.dirname(from), to),
    workspaceRoot: (): string => root,
  };
}

/** Same files, FIFO settlement order: the control for {@link createShuffledHost}. */
export function createOrderedHost(files: ReadonlyMap<string, string>, root: string): ModuleHost {
  return {
    readFile: async (path: string): Promise<string> => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    fileExists: async (path: string): Promise<boolean> => files.has(path),
    canonicalize: (path: string): string => path,
    resolvePath: (from: string, to: string): string => posix.resolve(posix.dirname(from), to),
    workspaceRoot: (): string => root,
  };
}

/** Fixture used for the in-memory project determinism cases. */
const DETERMINISM_FIXTURE_ID = "canonical/button";

/** Build an in-memory project (entry plus siblings) from a real fixture. */
export function determinismProject(): {
  readonly files: Map<string, string>;
  readonly entry: string;
} {
  const fixture = loadCorpus().byId.get(DETERMINISM_FIXTURE_ID);
  if (fixture === undefined) throw new Error(`fixture ${DETERMINISM_FIXTURE_ID} is missing`);
  const files = new Map<string, string>();
  for (const [name, source] of fixtureDirectoryFiles(fixture)) {
    files.set(`/workspace/${fixture.file.slice(0, fixture.file.lastIndexOf("/"))}/${name}`, source);
  }
  return { files, entry: `/workspace/${fixture.file}` };
}

/** Snapshot of one compileProject record, keyed by entry. */
export function projectSnapshot(results: Record<string, CompileResult>): string {
  const entries = Object.keys(results).sort();
  return JSON.stringify(
    entries.map((entry) => {
      const result = results[entry];
      return [entry, result === undefined ? null : artifactSnapshot(result)];
    }),
  );
}

/**
 * Determinism area: repeated runs, shuffled module-read order and generator
 * re-runs must all be byte-identical.
 */
export async function runDeterminismArea(config: AreaConfig): Promise<AreaRun> {
  const startedAt = performance.now();
  const violations: Violation[] = [];
  const limitations: Violation[] = [];
  const { rng, mutants } = mutantsFor("determinism", config);
  let cases = 0;

  // Generator determinism: the same seed must replay the same case list.
  cases += 1;
  const replay = mutantCorpus(createLabelledRng(config.seed, "determinism"), config.budget);
  const replayHash = hashString(
    replay.map((mutant) => `${mutant.fixtureId}:${mutant.inputHash}`).join("|"),
  );
  const expectedReplayHash = hashString(
    mutants.map((mutant) => `${mutant.fixtureId}:${mutant.inputHash}`).join("|"),
  );
  if (replayHash !== expectedReplayHash) {
    violations.push(
      violation(
        "determinism",
        "generator-replay",
        "the same seed produced a different mutant list",
        "",
        reproducerFor("determinism", config, "generator-replay"),
      ),
    );
  }

  // Repeated compile of the same source must be byte-identical.
  for (const mutant of mutants) {
    cases += 1;
    const label = `repeat ${mutantLabel(mutant)}`;
    const first = artifactSnapshot(
      await compile(mutant.source, { file: mutant.file, workspaceRoot: REPO_ROOT }),
    );
    const second = artifactSnapshot(
      await compile(mutant.source, { file: mutant.file, workspaceRoot: REPO_ROOT }),
    );
    const third = artifactSnapshot(
      await compile(mutant.source, { file: mutant.file, workspaceRoot: REPO_ROOT }),
    );
    if (first !== second || first !== third) {
      violations.push(
        violation(
          "determinism",
          label,
          "repeated compile() runs differ",
          mutant.source,
          reproducerFor("determinism", config, label),
        ),
      );
    }
  }

  // Shuffled module-read order must not change any artifact.
  const project = determinismProject();
  const ordered = projectSnapshot(
    await compileProject([project.entry], createOrderedHost(project.files, "/workspace"), {
      projectRoot: "/workspace",
    }),
  );
  const shuffledRuns = Math.max(1, Math.min(config.budget, 10));
  for (let run = 0; run < shuffledRuns; run += 1) {
    cases += 1;
    const shuffled = projectSnapshot(
      await compileProject([project.entry], createShuffledHost(project.files, rng, "/workspace"), {
        projectRoot: "/workspace",
      }),
    );
    if (shuffled !== ordered) {
      violations.push(
        violation(
          "determinism",
          `shuffled-read-order run ${run}`,
          "compileProject output depends on module-read order",
          project.entry,
          reproducerFor("determinism", config, `shuffled-read-order run ${run}`),
        ),
      );
    }
  }

  // Entry order must not change any entry's artifacts.
  cases += 1;
  const secondEntry = "/workspace/tests/fixtures/canonical/second.cssx";
  const secondFiles = new Map(project.files);
  secondFiles.set(secondEntry, ".second { color: red; }\n");
  const forward = projectSnapshot(
    await compileProject(
      [project.entry, secondEntry],
      createOrderedHost(secondFiles, "/workspace"),
      {
        projectRoot: "/workspace",
      },
    ),
  );
  const backward = projectSnapshot(
    await compileProject(
      [secondEntry, project.entry],
      createOrderedHost(secondFiles, "/workspace"),
      {
        projectRoot: "/workspace",
      },
    ),
  );
  if (forward !== backward) {
    violations.push(
      violation(
        "determinism",
        "entry-order",
        "compileProject output depends on entry order",
        project.entry,
        reproducerFor("determinism", config, "entry-order"),
      ),
    );
  }

  return finish("determinism", config, cases, violations, limitations, startedAt);
}

/** Finalize an area run, attaching timing. */
function finish(
  area: AreaName,
  config: AreaConfig,
  cases: number,
  violations: Violation[],
  limitations: Violation[],
  startedAt: number,
): AreaRun {
  return {
    area,
    seed: config.seed,
    budget: config.budget,
    cases,
    violations: Object.freeze(violations),
    limitations: Object.freeze(limitations),
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

/** Run one area by name. */
export async function runArea(area: AreaName, config: AreaConfig): Promise<AreaRun> {
  if (area === "lexer") return runLexerArea(config);
  if (area === "parser") return runParserArea(config);
  if (area === "compile") return runCompileArea(config);
  if (area === "roundtrip") return runRoundTripArea(config);
  return runDeterminismArea(config);
}

/** Run several areas in order and return every result. */
export async function runAreas(areas: readonly AreaName[], config: AreaConfig): Promise<AreaRun[]> {
  const runs: AreaRun[] = [];
  for (const area of areas) runs.push(await runArea(area, config));
  return runs;
}

/** Narrow a raw string to an area name. */
export function isAreaName(value: string): value is AreaName {
  return (AREA_NAMES as readonly string[]).includes(value);
}

/** Read one fixture source from disk, for the tests' named adversarial cases. */
export function sourceOfFixture(id: string): CorpusFixture {
  const fixture = loadCorpus().byId.get(id);
  if (fixture === undefined) throw new Error(`fixture ${id} is missing`);
  return fixture;
}

/** Absolute fixtures path of a fixture id, for read-only assertions. */
export function fixturePath(id: string): string {
  return join(REPO_ROOT, "tests", "fixtures", ...id.split("/"));
}

/** Read a workspace-relative file the way the compiler sees it (read-only). */
export function readRepoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, ...relative.split("/")), "utf8");
}
