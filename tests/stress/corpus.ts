/**
 * Frozen mutation corpus for the TT1 fuzz harness.
 *
 * `tests/fixtures/**\/input.cssx` is a **read-only** input: every mutant below is
 * derived in memory from the bytes read at module load and nothing is ever
 * written back. Mutants are seeded, so `mutantCorpus(rng, n)` yields the same
 * first `n` cases for a given seed regardless of a larger budget being used
 * later.
 *
 * Operators target the documented coverage gaps (`tests/stress/README.md`
 * weakest-10 rows #6, #7 and #8): byte corruption, every-prefix truncation,
 * token splicing, brace/quote/comment imbalance, `$`/`@` abuse, and unicode
 * injections (BOM, lone surrogates, NUL, CRLF/CR/LF mixes).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { tokenize } from "../../packages/compiler/src/index.ts";
import type { StressRng } from "./prng.ts";
import { hashString } from "./prng.ts";

/** Absolute path of the repository root (the directory `tests/` lives in). */
export const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Absolute path of `tests/fixtures`. */
export const FIXTURES_ROOT = join(REPO_ROOT, "tests", "fixtures");

/** One frozen fixture source, addressed the way the compiler addresses sources. */
export interface CorpusFixture {
  /** Fixture id, for example `canonical/button`. */
  readonly id: string;
  /** Workspace-relative POSIX path, for example `tests/fixtures/canonical/button/input.cssx`. */
  readonly file: string;
  /** Authored source bytes, decoded once at load time and never mutated. */
  readonly source: string;
}

/** One deterministic mutant of one fixture. */
export interface Mutant {
  /** Fixture the source derives from. */
  readonly fixtureId: string;
  /** Workspace-relative source path used as `Span.file`. */
  readonly file: string;
  /** Operator name, used in case labels and failure reports. */
  readonly operator: MutationOperator;
  /** Human-readable description, including offsets for reproduction. */
  readonly description: string;
  /** Mutated source text. */
  readonly source: string;
  /** Stable hash of {@link Mutant.source}, so a failure is identifiable. */
  readonly inputHash: string;
}

/** Mutation operators applied by {@link mutateFixture}. */
export type MutationOperator =
  | "byte-flip"
  | "truncate"
  | "token-splice"
  | "imbalance"
  | "dollar-at-abuse"
  | "unicode-injection"
  | "line-ending-churn";

/** A named unicode/encoding injection applied at a concrete offset. */
export interface UnicodeInjection {
  /** Short label used in case ids. */
  readonly name: string;
  /** Text inserted into the source. */
  readonly text: string;
  /** Insertion offset: `0` = prefix, `0.5` = middle, `1` = suffix. */
  readonly at: "prefix" | "middle" | "suffix";
}

/** BOM, lone surrogates, NUL and line-ending mixes demanded by weakness row #8. */
export const UNICODE_INJECTIONS: readonly UnicodeInjection[] = Object.freeze([
  { name: "bom-at-zero", text: "\uFEFF", at: "prefix" },
  { name: "bom-mid", text: "\uFEFF", at: "middle" },
  { name: "bom-suffix", text: "\uFEFF", at: "suffix" },
  { name: "lone-high-surrogate", text: "\uD800", at: "middle" },
  { name: "lone-low-surrogate", text: "\uDC00", at: "middle" },
  { name: "reversed-surrogate-pair", text: "\uDC00\uD800", at: "middle" },
  { name: "nul-at-zero", text: "\u0000", at: "prefix" },
  { name: "nul-mid", text: "\u0000", at: "middle" },
  { name: "crlf-mix", text: "\r\n", at: "middle" },
  { name: "cr-only", text: "\r", at: "middle" },
  { name: "lf-only", text: "\n", at: "middle" },
  { name: "combining-mark", text: "e\u0301", at: "middle" },
  { name: "astral-emoji", text: "\u{1F600}", at: "middle" },
]);

/** Spliced fragments used by the token-splice and `$`/`@` operators. */
const HOSTILE_FRAGMENTS: readonly string[] = Object.freeze([
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  '"',
  "'",
  "/*",
  "*/",
  ";",
  ":",
  "$",
  "@",
  "@media",
  "@use",
  "@setup",
  "@variables",
  "$a.b",
  "$$",
  "@@",
  "\\",
  "!important",
]);

/** Result of {@link loadCorpus}: frozen fixtures plus convenience lookups. */
export interface Corpus {
  readonly fixtures: readonly CorpusFixture[];
  readonly byId: ReadonlyMap<string, CorpusFixture>;
}

let cachedCorpus: Corpus | undefined;

/** Recursively collect every fixture directory that owns an `input.cssx`. */
function collectFixtureDirectories(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const full = join(directory, entry);
    if (!statSync(full).isDirectory()) continue;
    found.push(...collectFixtureDirectories(full));
  }
  if (readdirSync(directory).includes("input.cssx")) found.push(directory);
  return found;
}

/**
 * Load the fixture corpus once (read-only) and memoize it.
 *
 * Sources are decoded once and shared; callers must treat them as immutable.
 * The list is sorted by fixture id so case order is stable across machines.
 */
export function loadCorpus(): Corpus {
  if (cachedCorpus !== undefined) return cachedCorpus;
  const fixtures = collectFixtureDirectories(FIXTURES_ROOT)
    .map((directory) => {
      const id = posix.join(
        ...directory
          .slice(FIXTURES_ROOT.length + 1)
          .split(/[\\/]/u)
          .filter((segment) => segment.length > 0),
      );
      return Object.freeze({
        id,
        file: `tests/fixtures/${id}/input.cssx`,
        source: readFileSync(join(directory, "input.cssx"), "utf8"),
      });
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture] as const));
  cachedCorpus = Object.freeze({ fixtures: Object.freeze(fixtures), byId });
  return cachedCorpus;
}

/** Build a mutant record with the input hash precomputed for failure reports. */
function makeMutant(
  fixture: CorpusFixture,
  operator: MutationOperator,
  description: string,
  source: string,
): Mutant {
  return Object.freeze({
    fixtureId: fixture.id,
    file: fixture.file,
    operator,
    description,
    source,
    inputHash: hashString(source),
  });
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** Flip 1–3 bytes of the UTF-8 encoding, then decode non-fatally (invalid bytes become U+FFFD). */
function byteFlip(rng: StressRng, fixture: CorpusFixture): Mutant {
  const bytes = utf8Encoder.encode(fixture.source);
  if (bytes.length === 0) return makeMutant(fixture, "byte-flip", "empty source", "\u0000");
  const flips = rng.nextRange(1, 3);
  const positions: number[] = [];
  for (let index = 0; index < flips; index += 1) {
    const position = rng.nextInt(bytes.length);
    const replacement = rng.nextByte();
    bytes[position] = replacement;
    positions.push(position);
  }
  const source = utf8Decoder.decode(bytes);
  return makeMutant(fixture, "byte-flip", `bytes[${positions.join(",")}] <- random byte`, source);
}

/** Cut the source at one random character offset. */
function truncate(rng: StressRng, fixture: CorpusFixture): Mutant {
  const cut = rng.nextInt(fixture.source.length + 1);
  return makeMutant(
    fixture,
    "truncate",
    `prefix of ${cut}/${fixture.source.length} chars`,
    fixture.source.slice(0, cut),
  );
}

/** Duplicate, drop, swap or inject one token in the real token stream. */
function tokenSplice(rng: StressRng, fixture: CorpusFixture): Mutant {
  const values = tokenize(fixture.source, fixture.file)
    .tokens.filter((token) => token.kind !== "eof")
    .map((token) => token.value);
  if (values.length === 0) {
    const injected = rng.pick(HOSTILE_FRAGMENTS);
    return makeMutant(fixture, "token-splice", "inject into tokenless source", injected);
  }
  const index = rng.nextInt(values.length);
  const mode = rng.nextInt(4);
  const copy = [...values];
  if (mode === 0) {
    copy.splice(index, 0, values[index] ?? "");
    return makeMutant(fixture, "token-splice", `duplicate token ${index}`, copy.join(""));
  }
  if (mode === 1) {
    copy.splice(index, 1);
    return makeMutant(fixture, "token-splice", `drop token ${index}`, copy.join(""));
  }
  if (mode === 2) {
    const other = rng.nextInt(values.length);
    const held = copy[index] ?? "";
    copy[index] = copy[other] ?? "";
    copy[other] = held;
    return makeMutant(fixture, "token-splice", `swap tokens ${index} and ${other}`, copy.join(""));
  }
  const injected = rng.pick(HOSTILE_FRAGMENTS);
  copy.splice(index, 0, injected);
  return makeMutant(
    fixture,
    "token-splice",
    `inject ${JSON.stringify(injected)} at token ${index}`,
    copy.join(""),
  );
}

/** Insert 1–4 unbalanced braces, brackets, quotes, comments or parens. */
function imbalance(rng: StressRng, fixture: CorpusFixture): Mutant {
  const pieces = ["{", "}", "(", ")", "[", "]", '"', "'", "/*", "*/", "url(", "@media {"];
  const count = rng.nextRange(1, 4);
  let source = fixture.source;
  const inserted: string[] = [];
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const piece = rng.pick(pieces);
    const offset = rng.nextInt(source.length + 1);
    source = `${source.slice(0, offset)}${piece}${source.slice(offset)}`;
    inserted.push(piece);
    offsets.push(offset);
  }
  return makeMutant(
    fixture,
    "imbalance",
    `inserted ${inserted.map((piece) => JSON.stringify(piece)).join(" ")} at [${offsets.join(",")}]`,
    source,
  );
}

/** Repeat `$`/`@` sequences, including namespace and at-rule shaped abuse. */
function dollarAtAbuse(rng: StressRng, fixture: CorpusFixture): Mutant {
  const abuse = [
    "$$$$$",
    "@@@@@",
    "$a.b.c.d",
    '@use ""',
    "@setup {}",
    "@variables { $$$: 1; }",
    "@media { }",
    "@if true { }",
    "$: ;",
    "@: ;",
    '@use "./missing.cssx" as a.b;',
    "@runtime { --a: @b$c; }",
  ];
  const count = rng.nextRange(1, 3);
  let source = fixture.source;
  const inserted: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const piece = rng.pick(abuse);
    const offset = rng.nextInt(source.length + 1);
    source = `${source.slice(0, offset)}${piece}${source.slice(offset)}`;
    inserted.push(piece);
  }
  return makeMutant(fixture, "dollar-at-abuse", `inserted ${inserted.join(" | ")}`, source);
}

/** Insert one {@link UNICODE_INJECTIONS} snippet at its documented position. */
function unicodeInjection(rng: StressRng, fixture: CorpusFixture): Mutant {
  const injection = rng.pick(UNICODE_INJECTIONS);
  const offset =
    injection.at === "prefix"
      ? 0
      : injection.at === "suffix"
        ? fixture.source.length
        : rng.nextInt(fixture.source.length + 1);
  const source = `${fixture.source.slice(0, offset)}${injection.text}${fixture.source.slice(offset)}`;
  return makeMutant(fixture, "unicode-injection", `${injection.name} at ${offset}`, source);
}

/** Rewrite every line ending to one of CRLF, CR or LF, then mix the three. */
function lineEndingChurn(rng: StressRng, fixture: CorpusFixture): Mutant {
  const pieces = fixture.source.split(/\r\n|\r|\n/u);
  const endings = ["\r\n", "\r", "\n"] as const;
  const mixed = pieces
    .map((piece, index) => (index === pieces.length - 1 ? piece : `${piece}${rng.pick(endings)}`))
    .join("");
  const uniform = rng.pick(endings);
  const source = rng.chance(1, 2) ? mixed : pieces.join(uniform);
  return makeMutant(
    fixture,
    "line-ending-churn",
    `${pieces.length - 1} line endings (${uniform === mixed ? "mixed" : JSON.stringify(uniform)})`,
    source,
  );
}

/** Apply one seeded operator to one fixture. */
export function mutateFixture(rng: StressRng, fixture: CorpusFixture): Mutant {
  const operators = [
    byteFlip,
    truncate,
    tokenSplice,
    imbalance,
    dollarAtAbuse,
    unicodeInjection,
    lineEndingChurn,
  ] as const;
  const operator = rng.pick(operators);
  return operator(rng, fixture);
}

/**
 * Deterministic set of `budget` mutants over the whole fixture corpus.
 *
 * Case `i` uses `fixtures[i % fixtures.length]`, so any budget ≥ the corpus size
 * touches every fixture, and a smaller budget is always a prefix of a larger
 * one (same seed, same sequence).
 */
export function mutantCorpus(rng: StressRng, budget: number): Mutant[] {
  const { fixtures } = loadCorpus();
  const mutants: Mutant[] = [];
  for (let index = 0; index < budget; index += 1) {
    const fixture = fixtures[index % fixtures.length];
    if (fixture === undefined) break;
    mutants.push(mutateFixture(rng, fixture));
  }
  return mutants;
}

/** Every character prefix of `source`, shortest first, ending with the full source. */
export function* characterPrefixes(source: string): Generator<string> {
  for (let length = 0; length <= source.length; length += 1) {
    yield source.slice(0, length);
  }
}

/** Every token-stream prefix of `source`, shortest first, ending with the full source. */
export function* tokenPrefixes(source: string): Generator<string> {
  const values = tokenize(source, "src/prefix.cssx").tokens.map((token) => token.value);
  yield "";
  let text = "";
  for (const value of values) {
    text += value;
    yield text;
  }
}

/** One unicode/encoding injection applied to a source, for exhaustive per-fixture checks. */
export function unicodeMutants(fixture: CorpusFixture): Mutant[] {
  return UNICODE_INJECTIONS.map((injection) => {
    const offset =
      injection.at === "prefix"
        ? 0
        : injection.at === "suffix"
          ? fixture.source.length
          : Math.floor(fixture.source.length / 2);
    return makeMutant(
      fixture,
      "unicode-injection",
      `${injection.name} at ${offset}`,
      `${fixture.source.slice(0, offset)}${injection.text}${fixture.source.slice(offset)}`,
    );
  });
}

/** Synthetic grammar templates covering constructs no single fixture combines. */
export function syntheticTemplates(): readonly { readonly id: string; readonly source: string }[] {
  return [
    {
      id: "empty",
      source: "",
    },
    {
      id: "declarations-only",
      source: "color: red;\npadding: 4px;\n",
    },
    {
      id: "empty-rule",
      source: ".a {}\n",
    },
    {
      id: "setup-all-keys",
      source: [
        "@setup {",
        '  prefix: "ui";',
        '  css-dir: "../out";',
        '  css-name: "styles.css";',
        '  map-dir: "../out";',
        '  map-name: "classes.js";',
        "  emit-css: true;",
        "  emit-map: true;",
        "  emit-types: true;",
        "  source-map: true;",
        "  minify: true;",
        "  module: false;",
        "}",
        ".a { color: red; }",
        "",
      ].join("\n"),
    },
    {
      id: "variants-and-nesting",
      source: [
        "@media-types { compact: (max-width: 500px); }",
        ".card {",
        "  padding: 8px @compact 16px;",
        "  &:hover { opacity: 0.5; }",
        "  & + & { margin: 0; }",
        "  @compact { display: block; }",
        "}",
        "",
      ].join("\n"),
    },
    {
      id: "runtime-and-variables",
      source: [
        "@variables { spacing: 8px; }",
        "@runtime { --brand: #2563eb; }",
        ".a {",
        "  padding: $spacing;",
        "  color: var(--brand);",
        "}",
        "",
      ].join("\n"),
    },
    {
      id: "groups",
      source: [
        "@group card {",
        "  display: flex;",
        "  &:hover { color: red; }",
        "}",
        ".a { @card; }",
        "",
      ].join("\n"),
    },
    {
      id: "keyframes-and-global",
      source: [
        "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
        "@global .native { color: red; }",
        "",
      ].join("\n"),
    },
    {
      id: "unterminated-everything",
      source: '.a { color: "red; /* @media { @use "./x.cssx" as y } ',
    },
    {
      id: "surrogate-and-nul",
      source: ".a\uDBFF { color: re\u0000d; }\uDC00",
    },
  ].map((template) => Object.freeze(template));
}

/**
 * Every `.cssx` file in one fixture directory, keyed by bare filename.
 *
 * Used by the determinism area to build an in-memory module project from a real
 * fixture (entry plus its `@use` targets) without touching the filesystem during
 * the compile under test.
 */
export function fixtureDirectoryFiles(fixture: CorpusFixture): ReadonlyMap<string, string> {
  const directory = join(FIXTURES_ROOT, ...fixture.id.split("/"));
  const files = new Map<string, string>();
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".cssx")) continue;
    files.set(entry, readFileSync(join(directory, entry), "utf8"));
  }
  return files;
}

/** Every fixture plus the smallest truncation of it, used as a cheap full-corpus sweep. */
export function fixtureFragments(): readonly { readonly id: string; readonly source: string }[] {
  const fragments: { id: string; source: string }[] = [];
  for (const fixture of loadCorpus().fixtures) {
    fragments.push({ id: fixture.id, source: fixture.source });
    fragments.push({ id: `${fixture.id}#head`, source: fixture.source.slice(0, 16) });
    fragments.push({ id: `${fixture.id}#tail`, source: fixture.source.slice(-16) });
  }
  return fragments;
}
