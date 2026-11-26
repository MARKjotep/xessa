/**
 * TT1 round-trip stress — the "formatter on malformed/large input" gap named in
 * the TT0 matrix.
 *
 * `formatter.test.ts:137,404` already asserts `format(format(x)) == format(x)` for
 * every fixture and compares the `parse(format(x))` group *shape*. This file
 * extends that to full-IR equality (positions normalized) over the same 67
 * fixtures, every unicode/encoding injection and every synthetic template, and
 * over the seeded mutation corpus.
 *
 * The two defects this file originally pinned (`CSSX-T1`: a swallowed at-rule
 * terminator grows one `;` per format pass; `CSSX-T2`: adjacent `@`-markers
 * split differently after a round trip) are fixed, so their cases are asserted
 * as positive invariants below: a regression reports a violation, not a pin.
 */

import { describe, expect, test } from "bun:test";
import { format, parse } from "../../../packages/compiler/src/index.ts";
import type { Stylesheet } from "../../../packages/compiler/src/index.ts";
import { loadCorpus, mutantCorpus, syntheticTemplates, unicodeMutants } from "../corpus.ts";
import { createLabelledRng, readStressBudget, readStressSeed } from "../prng.ts";
import { fingerprint, roundTripViolations, runRoundTripArea } from "./areas.ts";

const FILE = "stress/roundtrip.cssx";

/** Authored variant aliases per declaration, in document order. */
function variantAliases(ast: Stylesheet): string[][] {
  const aliases: string[][] = [];
  const visit = (items: readonly unknown[]): void => {
    for (const item of items) {
      if (item === null || typeof item !== "object") continue;
      const node = item as {
        kind?: string;
        variants?: readonly { readonly aliases: readonly string[] }[];
        body?: readonly unknown[];
        block?: readonly unknown[];
      };
      if (node.kind === "declaration") {
        for (const variant of node.variants ?? []) aliases.push([...variant.aliases]);
      }
      const children = node.body ?? node.block;
      if (children !== undefined) visit(children);
    }
  };
  visit(ast.items);
  return aliases;
}

describe("TT1 round trip: seeded mutation corpus", () => {
  test("no unclassified round-trip violation over the mutation corpus", () => {
    const seed = readStressSeed();
    const budget = readStressBudget();
    const run = runRoundTripArea({ seed, budget });
    expect(run.cases).toBeGreaterThanOrEqual(budget);
    expect(
      run.violations.map(
        (violation) => `${violation.caseLabel}: ${violation.message} [${violation.inputHash}]`,
      ),
    ).toEqual([]);
    // No defect is pinned any more: every violation is a hard failure.
    expect(run.limitations).toEqual([]);
  }, 60_000);
});

describe("TT1 round trip: whole fixture corpus", () => {
  test("format is idempotent and the reparsed IR is equal for all 67 fixtures", () => {
    const fixtures = loadCorpus().fixtures;
    expect(fixtures).toHaveLength(67);
    for (const fixture of fixtures) {
      const outcome = roundTripViolations(fixture.source, fixture.file);
      expect({ fixture: fixture.id, problems: outcome.problems }).toEqual({
        fixture: fixture.id,
        problems: [],
      });
      const once = format(fixture.source, fixture.file);
      expect({
        fixture: fixture.id,
        idempotent: format(once.formatted, fixture.file).formatted,
      }).toEqual({ fixture: fixture.id, idempotent: once.formatted });
      expect({
        fixture: fixture.id,
        ir: fingerprint(parse(once.formatted, { file: fixture.file }).ast),
      }).toEqual({
        fixture: fixture.id,
        ir: fingerprint(parse(fixture.source, { file: fixture.file }).ast),
      });
    }
  }, 60_000);

  test("every unicode injection over every fixture round-trips", () => {
    for (const fixture of loadCorpus().fixtures) {
      for (const mutant of unicodeMutants(fixture)) {
        const outcome = roundTripViolations(mutant.source, mutant.file);
        expect({
          case: `${mutant.fixtureId} ${mutant.description}`,
          problems: outcome.problems,
        }).toEqual({
          case: `${mutant.fixtureId} ${mutant.description}`,
          problems: [],
        });
      }
    }
  }, 60_000);

  test("synthetic grammar templates round-trip", () => {
    for (const template of syntheticTemplates()) {
      const outcome = roundTripViolations(template.source, `stress/${template.id}.cssx`);
      expect({ template: template.id, problems: outcome.problems }).toEqual({
        template: template.id,
        problems: [],
      });
    }
  });
});

/** Parse → format → reparse must be a fixed point with equal IR and no errors. */
function expectFixedPoint(source: string): void {
  const before = parse(source, { file: FILE });
  expect({ source, diagnostics: before.diagnostics }).toEqual({ source, diagnostics: [] });
  const once = format(source, FILE);
  const twice = format(once.formatted, FILE);
  expect({ source, twice: twice.formatted }).toEqual({ source, twice: once.formatted });
  expect({ source, after: fingerprint(parse(once.formatted, { file: FILE }).ast) }).toEqual({
    source,
    after: fingerprint(before.ast),
  });
}

describe("TT1 round trip: formatter defect regressions (CSSX-T01, CSSX-T02)", () => {
  // A native at-rule statement whose prelude swallows the terminator used to
  // grow one `;` per pass (`@x[a` → `@x [a;` → `@x [a;;`). The formatter now
  // omits a terminator that the prelude would reabsorb.
  test("CSSX-T01: a swallowed at-rule terminator is a fixed point", () => {
    expectFixedPoint("@x[a");
    expectFixedPoint("@media[x { a: b; }");
    expectFixedPoint("@x[a;");
    expectFixedPoint("@x(a");
    expect(format("@x[a", FILE).formatted).toBe("@x [a\n");
    // Corpus instance from seed 1, budget 200 (hash c4a21866af2c9459).
    const corpusCase = mutantCorpus(createLabelledRng(1, "roundtrip"), 200).find(
      (mutant) => mutant.inputHash === "c4a21866af2c9459",
    );
    expect(corpusCase?.fixtureId).toBe("output/only-names");
    expectFixedPoint(corpusCase?.source ?? "");
  });

  // `@a@b 2` used to parse as one variant and print as `@a @b 2`, which parses
  // as two. The formatter keeps adjacent markers adjacent so the split survives.
  test("CSSX-T02: adjacent @-markers keep their variant split", () => {
    const source = ".a { x: 1 @a@b 2; }";
    const before = parse(source, { file: FILE });
    expect(before.diagnostics).toEqual([]);
    expect(variantAliases(before.ast)).toEqual([["a"]]);
    const once = format(source, FILE);
    expect(once.formatted).toBe(".a {\n  x: 1 @a@b 2;\n}\n");
    expect(variantAliases(parse(once.formatted, { file: FILE }).ast)).toEqual([["a"]]);
    expectFixedPoint(source);
    // Plus-joined aliases stay one variant with two aliases.
    expect(variantAliases(parse(".a { x: 1 @a+b 2; }", { file: FILE }).ast)).toEqual([["a", "b"]]);
    // Corpus instances: seed 1 budget 200 (017f72c1df03f0f0) and seed 5 budget
    // 500 (8ede5396d72b69ee, `media/combined-and`).
    const seedOne = mutantCorpus(createLabelledRng(1, "roundtrip"), 200).find(
      (mutant) => mutant.inputHash === "017f72c1df03f0f0",
    );
    expect(seedOne?.fixtureId).toBe("runtime/with-variant");
    expectFixedPoint(seedOne?.source ?? "");
    const seedFive = mutantCorpus(createLabelledRng(5, "roundtrip"), 500).find(
      (mutant) => mutant.inputHash === "8ede5396d72b69ee",
    );
    expect(seedFive?.fixtureId).toBe("media/combined-and");
    expectFixedPoint(seedFive?.source ?? "");
  });
});

describe("TT1 round trip: CSSX-T05 `$` sigil (roundtrip corpus)", () => {
  // The formatter recovers an authored `$` from the token span, so a namespaced
  // token declaration keeps its sigil instead of becoming an invalid bare
  // `name.member:` declaration on the next pass. The reference form is covered
  // too, so `$ns.name` stays a fixed point in both positions.
  test("CSSX-T05: a `$ns.name` token declaration and reference round-trip", () => {
    expectFixedPoint("@variables {\n  $layout.margin: 4px;\n}\n");
    expectFixedPoint("@variables {\n  $space.sm: 4px;\n}\n.a {\n  margin: $space.sm;\n}\n");
    expect(format("@variables {\n  $space.sm: 4px;\n}\n", FILE).formatted).toContain(
      "$space.sm: 4px;",
    );
  });
});
