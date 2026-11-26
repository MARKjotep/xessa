/**
 * TT1 compile stress — weakness row #6 of `tests/stress/README.md`.
 *
 * The public `compile()` had no property/fuzz loop at all (TT0 report). Every
 * case here drives the real public entry point on mutated fixture sources and
 * asserts the four things the plan promises:
 *
 * 1. it never throws (a broken input is a diagnostic, not an exception);
 * 2. diagnostics stay bounded per input (≤ {@link MAX_DIAGNOSTICS_PER_INPUT});
 * 3. every diagnostic span satisfies `0 <= start <= end <= the length of the file
 *    it points at` — including diagnostics that point at an imported module;
 * 4. the artifact surface stays well-formed (`classes` keeps its null prototype,
 *    every mapped class is a non-empty string, dependencies are POSIX paths).
 */

import { describe, expect, test } from "bun:test";
import { compile } from "../../../packages/compiler/src/index.ts";
import { REPO_ROOT, loadCorpus, mutantCorpus, unicodeMutants } from "../corpus.ts";
import { createLabelledRng, readStressBudget, readStressSeed } from "../prng.ts";
import {
  MAX_DIAGNOSTICS_PER_INPUT,
  compileViolations,
  readRepoFile,
  runCompileArea,
  sourceOfFixture,
} from "./areas.ts";

/** Expect every compile invariant for one source, naming the input on failure. */
async function expectCompileOk(source: string, file: string): Promise<void> {
  const problems = await compileViolations(source, file);
  expect({ file, length: source.length, problems }).toEqual({
    file,
    length: source.length,
    problems: [],
  });
}

describe("TT1 compile: seeded mutation corpus (row #6a)", () => {
  test("mutated fixture projects compile totally with bounded, in-bounds diagnostics", async () => {
    const seed = readStressSeed();
    const budget = readStressBudget();
    const run = await runCompileArea({ seed, budget });
    expect(run.cases).toBeGreaterThanOrEqual(budget);
    expect(
      run.violations.map(
        (violation) => `${violation.caseLabel}: ${violation.message} [${violation.inputHash}]`,
      ),
    ).toEqual([]);
    expect(run.limitations).toEqual([]);
  }, 60_000);
});

describe("TT1 compile: whole fixture corpus (row #6a)", () => {
  test("every fixture compiles through the public entry point", async () => {
    const fixtures = loadCorpus().fixtures;
    expect(fixtures).toHaveLength(67);
    for (const fixture of fixtures) {
      await expectCompileOk(fixture.source, fixture.file);
      const result = await compile(fixture.source, {
        file: fixture.file,
        workspaceRoot: REPO_ROOT,
      });
      expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_PER_INPUT);
      expect(Object.getPrototypeOf(result.classes)).toBeNull();
    }
  }, 60_000);

  test("three truncation points per fixture stay inside the invariants", async () => {
    for (const fixture of loadCorpus().fixtures) {
      for (const fraction of [0.25, 0.5, 0.75]) {
        const length = Math.floor(fixture.source.length * fraction);
        await expectCompileOk(fixture.source.slice(0, length), fixture.file);
      }
    }
  }, 60_000);

  test("every unicode injection over every fixture compiles totally", async () => {
    for (const fixture of loadCorpus().fixtures) {
      for (const mutant of unicodeMutants(fixture)) {
        await expectCompileOk(mutant.source, mutant.file);
      }
    }
  }, 60_000);

  test("seeded mutants over the whole corpus keep the span bound", async () => {
    const seed = readStressSeed();
    for (const mutant of mutantCorpus(createLabelledRng(seed, "compile-span"), 200)) {
      await expectCompileOk(mutant.source, mutant.file);
    }
  }, 60_000);
});

describe("TT1 compile: cross-module diagnostic spans", () => {
  test("a diagnostic pointing at an imported module is bounded by that module", async () => {
    // Truncating the entry inside its `@use` string still resolves the module, so
    // the resolver reports the cycle against `b.cssx` — the span must be inside
    // `b.cssx`, not inside the (shorter) entry source.
    const fixture = sourceOfFixture("variables/cycle");
    const truncated = fixture.source.slice(0, 15);
    await expectCompileOk(truncated, fixture.file);

    const result = await compile(truncated, { file: fixture.file, workspaceRoot: REPO_ROOT });
    const moduleFile = `${REPO_ROOT}/tests/fixtures/variables/cycle/b.cssx`.replaceAll("\\", "/");
    const moduleDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.span.file === moduleFile,
    );
    expect(moduleDiagnostic).toBeDefined();
    const moduleSource = readRepoFile("tests/fixtures/variables/cycle/b.cssx");
    expect(moduleDiagnostic?.span.end).toBeLessThanOrEqual(moduleSource.length);
    expect(moduleDiagnostic?.span.start).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

describe("TT1 compile: CSSX-T03 invalid $ prefix spans", () => {
  // CSSX-T3: an invalid `$`-bearing `@setup prefix` renders a runtime reference as
  // `var(--$-p)`, and the defensive runtime pass used to re-lex that generated
  // text with the authored value offsets, inventing a `$-p` reference at
  // `46..49` in a 44-character file. A synthesized `$` is not an authored
  // reference, so it is skipped and every reported span stays in bounds.
  test("CSSX-T03: an invalid $ prefix keeps every diagnostic span in bounds", async () => {
    const source = '@setup{prefix:"$";}@runtime{p:red;}.c{c:$p;}';
    const file = "tests/fixtures/runtime/basic/input.cssx";
    expect(source).toHaveLength(44);
    const result = await compile(source, { file, workspaceRoot: REPO_ROOT });
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
      expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
      expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
    }
    // `$p` resolves to the runtime token `p`; only the invalid class prefix is
    // reported, and never as a reference to the synthesized `$-p` text.
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA4001"]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"$-p"'))).toBe(
      false,
    );
    // Everything else about the call is still total: no throw, bounded diagnostics.
    expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_PER_INPUT);
    expect(Object.getPrototypeOf(result.classes)).toBeNull();
  });

  test("the compile area reports no violation for the same input", async () => {
    const problems = await compileViolations(
      '@setup{prefix:"$";}@runtime{p:red;}.c{c:$p;}',
      "tests/fixtures/runtime/basic/input.cssx",
    );
    expect(problems).toEqual([]);
  });
});

describe("TT1 compile: the cap is a real ceiling", () => {
  test("the worst observed input stays far below the fixed cap", async () => {
    // Measured worst case over 10 seeds × 500 mutants is 8 diagnostics; the cap is
    // an order of magnitude above that so it fails only on genuine blow-up.
    let worst = 0;
    const seed = readStressSeed();
    for (const mutant of mutantCorpus(createLabelledRng(seed, "compile-cap"), 200)) {
      const result = await compile(mutant.source, { file: mutant.file, workspaceRoot: REPO_ROOT });
      worst = Math.max(worst, result.diagnostics.length);
    }
    expect(worst).toBeLessThanOrEqual(MAX_DIAGNOSTICS_PER_INPUT);
    expect(MAX_DIAGNOSTICS_PER_INPUT).toBe(64);
  }, 60_000);
});
