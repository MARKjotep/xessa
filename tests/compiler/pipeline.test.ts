import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, tokenize } from "../../packages/compiler/src/index.ts";
import type { Diagnostic } from "../../packages/compiler/src/index.ts";

/**
 * End-to-end pipeline tests for the barrel (`tokenize` → `parseTokens`).
 *
 * Every `tests/fixtures/**\/input.cssx` entry is tokenized and parsed through
 * `parse(source, { file })`, which is the integration under test. The local
 * stream invariants (single trailing `eof`, lossless round-trip) are asserted
 * separately from the same public `tokenize` export.
 *
 * Authored diagnostics are checked for code + severity only. `messageContains`
 * and the position policy stay owned by the parser test (`parser.test.ts`) and
 * by later-phase golden checks, per the lead's integration instruction.
 */

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

interface ExpectedDiagnostic {
  readonly code: string;
  readonly severity: string;
}

interface FixtureCase {
  /** Fixture id, for example `canonical/button`. */
  readonly id: string;
  /** Workspace-relative source path used as `Span.file`, for example `canonical/button/input.cssx`. */
  readonly file: string;
  readonly source: string;
  /** Authored expectation array, or `null` when the fixture is diagnostic-unchecked. */
  readonly expected: readonly ExpectedDiagnostic[] | null;
}

/**
 * Authored diagnostics that tokens alone cannot produce.
 *
 * The parser pins each fixture's AST shape and positions (see
 * `parser.test.ts`); the diagnostic itself needs an alias registry, the settings
 * schema or the merged `@setup` view. The map is a drift guard: if a fixture's
 * authored codes change, this test fails instead of silently skipping it.
 */
const DEFERRED_SEMANTIC_FIXTURES: Readonly<
  Record<string, { readonly phase: string; readonly codes: readonly string[] }>
> = {
  "errors/unknown-modifier": {
    phase: "P2 media alias validation (XESSA3001)",
    codes: ["XESSA3001"],
  },
  "errors/unknown-setup-key": {
    phase: "P5 configuration validation (XESSA1001)",
    codes: ["XESSA1001"],
  },
  "errors/duplicate-setting": {
    phase: "P3/P5 setup resolution (XESSA1001)",
    codes: ["XESSA1001"],
  },
};

/**
 * Group fixtures whose XESSA1001 is authored syntax misuse inside a group
 * construct (ADR-0017 §3.7): the only non-`errors/` fixtures that diagnose
 * during `parse`. `groups.golden.test.ts` pins the full diagnostic set.
 */
const GROUP_SYNTAX_FIXTURES: Readonly<Record<string, readonly string[]>> = {
  "groups/conditional-use-site": ["XESSA1001"],
  "groups/nested-rule-in-definition": ["XESSA1001"],
};

function readExpected(id: string): readonly ExpectedDiagnostic[] | null {
  const text = readFileSync(join(fixturesRoot, id, "expected", "diagnostics.json"), "utf8");
  return JSON.parse(text) as readonly ExpectedDiagnostic[] | null;
}

function discoverFixtures(): readonly FixtureCase[] {
  const cases: FixtureCase[] = [];
  const groups = readdirSync(fixturesRoot)
    .filter((entry) => statSync(join(fixturesRoot, entry)).isDirectory())
    .sort();

  for (const group of groups) {
    const groupPath = join(fixturesRoot, group);
    const fixtures = readdirSync(groupPath)
      .filter((entry) => statSync(join(groupPath, entry)).isDirectory())
      .sort();

    for (const fixture of fixtures) {
      const fixturePath = join(groupPath, fixture);
      if (!readdirSync(fixturePath).includes("input.cssx")) continue;
      const id = `${group}/${fixture}`;
      cases.push({
        id,
        file: `${id}/input.cssx`,
        source: readFileSync(join(fixturePath, "input.cssx"), "utf8"),
        expected: readExpected(id),
      });
    }
  }

  return Object.freeze(cases);
}

const fixtures = discoverFixtures();

function codeSeverity(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}`).sort();
}

function expectedCodeSeverity(entries: readonly ExpectedDiagnostic[]): string[] {
  return entries.map((entry) => `${entry.code}:${entry.severity}`).sort();
}

describe("fixture catalog through the public pipeline", () => {
  test("discovers the frozen 67-entry catalog", () => {
    expect(fixtures).toHaveLength(67);
    expect(fixtures.filter((fixture) => fixture.id.startsWith("errors/"))).toHaveLength(9);
  });

  for (const fixture of fixtures) {
    test(fixture.id, () => {
      const lexed = tokenize(fixture.source, fixture.file);

      // Lossless stream: exactly one zero-width eof at the end and a byte-exact round-trip.
      expect(lexed.tokens.length).toBeGreaterThan(0);
      const eof = lexed.tokens[lexed.tokens.length - 1];
      expect(eof?.kind).toBe("eof");
      expect(eof?.value).toBe("");
      expect(eof?.start).toBe(fixture.source.length);
      expect(eof?.end).toBe(fixture.source.length);
      expect(lexed.tokens.filter((token) => token.kind === "eof")).toHaveLength(1);
      expect(lexed.tokens.map((token) => token.value).join("")).toBe(fixture.source);

      // The barrel pipeline under test.
      const result = parse(fixture.source, { file: fixture.file });
      expect(result.ast.kind).toBe("stylesheet");
      expect(result.ast.file).toBe(fixture.file);
      expect(result.ast.span).toEqual({
        start: 0,
        end: fixture.source.length,
        file: fixture.file,
      });
      expect(Array.isArray(result.diagnostics)).toBe(true);

      if (fixture.id.startsWith("errors/") && fixture.expected !== null) {
        const deferred = DEFERRED_SEMANTIC_FIXTURES[fixture.id];
        if (deferred !== undefined) {
          // Not derivable from tokens: pinned as a later-phase expectation, with
          // zero pipeline diagnostics today so the boundary cannot drift silently.
          expect(fixture.expected.map((entry) => entry.code)).toEqual([...deferred.codes]);
          expect(result.diagnostics).toEqual([]);
        } else {
          expect(codeSeverity(result.diagnostics)).toEqual(expectedCodeSeverity(fixture.expected));
        }
      } else {
        const groupSyntax = GROUP_SYNTAX_FIXTURES[fixture.id];
        if (groupSyntax !== undefined) {
          // Authored group syntax misuse: the parser reports it, the golden suite
          // asserts the span and message (ADR-0017 §3.7).
          expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([...groupSyntax]);
        } else {
          expect(result.diagnostics).toEqual([]);
        }
      }
    });
  }
});

describe("pipeline invariants", () => {
  test("lexical diagnostics precede syntactic diagnostics, whatever their offsets", () => {
    // The unterminated string starts at offset 14; the unclosed rule starts at 0.
    // A source-order merge would surface the parser diagnostic first.
    const source = '.a { content: "oops\n';
    const file = "src/ordering.cssx";
    const lexed = tokenize(source, file);
    expect(lexed.diagnostics).toHaveLength(1);

    const result = parse(source, { file });
    expect(result.diagnostics.length).toBeGreaterThan(lexed.diagnostics.length);
    expect(result.diagnostics[0]).toEqual(lexed.diagnostics[0]);
    expect(result.diagnostics[1]?.code).toBe("XESSA1001");
    expect(result.diagnostics[1]?.span.start).toBe(0);
  });

  test("parse never throws on any prefix of the canonical source", () => {
    const canonical = fixtures.find((fixture) => fixture.id === "canonical/button");
    if (canonical === undefined) throw new Error("canonical/button fixture is missing");

    for (let end = 0; end <= canonical.source.length; end++) {
      const result = parse(canonical.source.slice(0, end), { file: canonical.file });
      expect(result.ast.kind).toBe("stylesheet");
      expect(result.ast.span.end).toBe(end);
    }
  });

  test("empty and garbage sources still yield a stylesheet", () => {
    for (const source of ["", "}}}{{{;;; @ @@@ . ; @md { color: red }", '.a { content: "oops\n']) {
      const result = parse(source, { file: "src/garbage.cssx" });
      expect(result.ast.kind).toBe("stylesheet");
      expect(result.ast.span).toEqual({ start: 0, end: source.length, file: "src/garbage.cssx" });
    }
  });
});
