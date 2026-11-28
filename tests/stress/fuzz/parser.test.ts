/**
 * TT1 parser stress — weakness row #7 of `tests/stress/README.md`.
 *
 * The existing `parser.test.ts:1136` / `pipeline.test.ts:186` truncation fuzz
 * covers **one** source (TT0 report). This file extends it to all 68 fixtures
 * (character *and* token prefixes, exhaustively), adds 10 000-deep `{` and
 * at-rule nesting, unbalanced quote/comment/bracket at every depth level 1–64 and
 * a diagnostic-count bound per nesting depth.
 *
 * Measured cost on this machine: 7 779 character prefixes and 3 268 token
 * prefixes over the whole corpus in ~45 ms and ~35 ms, so both sweeps run
 * exhaustively rather than sampled.
 */

import { describe, expect, test } from "bun:test";
import { parse } from "../../../packages/compiler/src/index.ts";
import {
  characterPrefixes,
  loadCorpus,
  mutantCorpus,
  syntheticTemplates,
  tokenPrefixes,
} from "../corpus.ts";
import { createLabelledRng, readStressBudget, readStressSeed } from "../prng.ts";
import { describeInput, parseViolations, runParserArea } from "./areas.ts";

const FILE = "stress/parser.cssx";

/** Deepest nesting the parser is probed at; the plan asks for 10 000. */
const DEEP_NESTING = 10_000;

/** Assert every parse invariant for one source, naming the input on failure. */
function expectParseOk(source: string, file = FILE, diagnosticCap?: number): void {
  const input = describeInput(source);
  const problems =
    diagnosticCap === undefined
      ? parseViolations(source, file)
      : parseViolations(source, file, diagnosticCap);
  expect({ input, problems }).toEqual({ input, problems: [] });
}

describe("TT1 parser: seeded mutation corpus", () => {
  test("every mutated source parses totally with in-bounds diagnostics", () => {
    const seed = readStressSeed();
    const budget = readStressBudget();
    const run = runParserArea({ seed, budget });
    expect(run.cases).toBeGreaterThanOrEqual(budget);
    expect(
      run.violations.map(
        (violation) => `${violation.caseLabel}: ${violation.message} [${violation.inputHash}]`,
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("TT1 parser: deep nesting (row #7a)", () => {
  test("10 000-deep brace nesting never throws and keeps diagnostics bounded", () => {
    for (const depth of [1_000, 4_000, DEEP_NESTING]) {
      const balanced = `${"a { ".repeat(depth)}${"}".repeat(depth)}`;
      const unclosed = "a { ".repeat(depth);

      // Balanced deep nesting is valid input: no diagnostic at any depth (from
      // roughly 8 192 the defensive recovery path yields exactly one instead).
      const balancedResult = parse(balanced, { file: FILE });
      expect(balancedResult.ast.kind).toBe("stylesheet");
      expect(balancedResult.diagnostics.length).toBeLessThanOrEqual(1);

      // Unclosed deep nesting is bounded by the authored depth: one diagnostic per
      // unclosed block, never one per token, never a throw.
      const unclosedResult = parse(unclosed, { file: FILE });
      expect(unclosedResult.ast.kind).toBe("stylesheet");
      expect(unclosedResult.diagnostics.length).toBeLessThanOrEqual(depth);

      const input = `depth ${depth} (${unclosed.length} chars)`;
      expect({ input, problems: parseViolations(unclosed, FILE, depth + 8) }).toEqual({
        input,
        problems: [],
      });
      expect(parseViolations(balanced, FILE, depth + 8)).toEqual([]);
    }
  }, 60_000);

  test("10 000-deep at-rule nesting never throws and keeps diagnostics bounded", () => {
    for (const depth of [1_000, DEEP_NESTING]) {
      const unclosed = "@media (min-width: 1px) { ".repeat(depth);
      const result = parse(unclosed, { file: FILE });
      expect(result.ast.kind).toBe("stylesheet");
      expect(result.diagnostics.length).toBeLessThanOrEqual(depth);
      expectParseOk(unclosed, FILE, depth + 8);
    }
  }, 60_000);

  test("nesting past the recursion guard degrades to one bounded diagnostic", () => {
    // Measured: from roughly 8 192 levels of recursion the parser's defensive
    // `try`/`catch` in `parseTokens` returns an empty stylesheet plus a single
    // XESSA1001 instead of overflowing the stack. The contract asserted here is
    // the cheap one: no throw, a stylesheet, bounded diagnostics.
    const source = `${"a { ".repeat(DEEP_NESTING)}${"}".repeat(DEEP_NESTING)}`;
    const { ast, diagnostics } = parse(source, { file: FILE });
    expect(ast.kind).toBe("stylesheet");
    expect(diagnostics.length).toBeLessThanOrEqual(8);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toMatch(/^XESSA1\d{3}$/u);
      expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
    }
  }, 60_000);

  test("diagnostic count is bounded per nesting depth", () => {
    for (const depth of [1, 2, 4, 8, 16, 64, 256, 1_024, 4_096]) {
      const balanced = `${"a { ".repeat(depth)}${"}".repeat(depth)}`;
      expect({ depth, diagnostics: parse(balanced, { file: FILE }).diagnostics.length }).toEqual({
        depth,
        diagnostics: 0,
      });
      const unclosed = "a { ".repeat(depth);
      expect(parse(unclosed, { file: FILE }).diagnostics.length).toBeLessThanOrEqual(depth);
      const atRule = "@media x { ".repeat(depth);
      expect(parse(atRule, { file: FILE }).diagnostics.length).toBeLessThanOrEqual(depth);
    }
  }, 60_000);
});

describe("TT1 parser: unbalanced input at every depth (row #7b)", () => {
  test("unbalanced quote, comment and bracket at every depth level 1-64", () => {
    const injections = ['"', "'", "/*", "(", "[", "{", "url(", "@media {"];
    const suffixes = ["x: y;", "}", ".b { color: red; }", ""];
    for (let depth = 1; depth <= 64; depth += 1) {
      for (const injection of injections) {
        for (const suffix of suffixes) {
          const source = `${"a { ".repeat(depth)}${injection}${suffix}`;
          const problems = parseViolations(source, FILE, depth + 8);
          expect({ depth, injection, suffix, problems }).toEqual({
            depth,
            injection,
            suffix,
            problems: [],
          });
          // Bounded per depth: at most one diagnostic per open block plus the
          // injection itself, never one per token.
          expect(parse(source, { file: FILE }).diagnostics.length).toBeLessThanOrEqual(depth + 2);
        }
      }
    }
  }, 60_000);

  test("`$`/`@` abuse parses totally", () => {
    const sources = [
      "$$$$$",
      "@@@@@",
      "$a.b.c.d",
      '@use ""',
      "@setup {}",
      "@variables { $$$: 1; }",
      "@if true { }",
      "$: ;",
      "@: ;",
      '@use "./missing.cssx" as a.b;',
      "@runtime { --a: @b$c; }",
      ".a { color: $$$; }",
      ".a { @x @y @z; }",
      "@media { .a { b: c; } }",
      "$".repeat(4_096),
      "@".repeat(4_096),
    ];
    for (const source of sources) expectParseOk(source);
  });
});

describe("TT1 parser: prefix truncation over all 68 fixtures (row #7c)", () => {
  test("every character prefix of every fixture parses totally", () => {
    const fixtures = loadCorpus().fixtures;
    expect(fixtures).toHaveLength(68);
    let cases = 0;
    for (const fixture of fixtures) {
      for (const prefix of characterPrefixes(fixture.source)) {
        const problems = parseViolations(prefix, fixture.file);
        expect({ fixture: fixture.id, length: prefix.length, problems }).toEqual({
          fixture: fixture.id,
          length: prefix.length,
          problems: [],
        });
        cases += 1;
      }
    }
    // 68 fixtures / 7 711 code units ⇒ 7 779 prefixes, plus one per fixture.
    expect(cases).toBe(7_779);
  }, 60_000);

  test("every token prefix of every fixture parses totally", () => {
    let cases = 0;
    for (const fixture of loadCorpus().fixtures) {
      for (const prefix of tokenPrefixes(fixture.source)) {
        const problems = parseViolations(prefix, fixture.file);
        expect({ fixture: fixture.id, length: prefix.length, problems }).toEqual({
          fixture: fixture.id,
          length: prefix.length,
          problems: [],
        });
        cases += 1;
      }
    }
    expect(cases).toBe(3_268);
  }, 60_000);

  test("truncations produced by the mutation operator also parse totally", () => {
    const seed = readStressSeed();
    for (const mutant of mutantCorpus(createLabelledRng(seed, "parser-truncate"), 200)) {
      const prefix = mutant.source.slice(0, Math.floor(mutant.source.length / 2));
      const problems = parseViolations(prefix, mutant.file);
      expect({ case: mutant.fixtureId, problems }).toEqual({
        case: mutant.fixtureId,
        problems: [],
      });
    }
  }, 60_000);
});

describe("TT1 parser: synthetic grammar templates", () => {
  test("templates parse totally", () => {
    for (const template of syntheticTemplates()) {
      expectParseOk(template.source, `stress/${template.id}.cssx`);
    }
  });
});
