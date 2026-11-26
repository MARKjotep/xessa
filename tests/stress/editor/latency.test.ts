/**
 * TT6 · latency at scale: a generated 10 000-line document.
 *
 * Measures the editor operations a keystroke actually reaches
 * (`analyzeText`, `completionsAt`, `hoverAt`, `definitionsAt`, `renameAt`,
 * `colorsAt`, `documentSymbols`) plus the cold-cache path that also runs the
 * compiler (`analyzeDocument`).
 *
 * Assertions are deliberately weak on speed and strict on behaviour: every
 * operation is checked to do real work (items/targets/edits found), and every
 * p95 is compared against `HARD_CEILING_MS`, a value ~50× the observed p95 on
 * the recording machine, so a slow CI box records a larger number instead of
 * failing. Exact millisecond values are never asserted.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { analyzeDocument, analyzeText } from "../../../packages/vscode/src/analysis.ts";
import {
  colorsAt,
  completionsAt,
  definitionsAt,
  documentSymbols,
  hoverAt,
  referencesAt,
  renameAt,
} from "../../../packages/vscode/src/intelligence.ts";
import { DEFAULT_SEED, generateLargeDocument } from "./documents.ts";
import {
  COMPILE_CEILING_MS,
  HARD_CEILING_MS,
  TimingTable,
  timeRepeated,
  timeRepeatedAsync,
} from "./timing.ts";

const TARGET_LINES = 10_000;
const DOCUMENT_PATH = "/virtual/stress/large-10k.cssx";
const TEXT = generateLargeDocument({ lines: TARGET_LINES, seed: DEFAULT_SEED });
const ANALYSIS = analyzeText({ text: TEXT, path: DOCUMENT_PATH, version: 1 });

/** Offset directly after the first `$gap` reference inside `.rule-500`. */
function probeOffset(): number {
  const rule = TEXT.indexOf(".rule-500 {");
  expect(rule).toBeGreaterThan(0);
  const reference = TEXT.indexOf("$gap", rule);
  expect(reference).toBeGreaterThan(rule);
  return reference + "$gap".length;
}

/** Offset at the `$` of that same reference (definition/rename cursor). */
function referenceOffset(): number {
  return probeOffset() - "$gap".length;
}

const table = new TimingTable();
afterAll(() => table.print("10 000-line generated document (p50/p95/max, milliseconds)"));

describe("10k-line document — shape of the input", () => {
  test("the generated document really is at 10k lines and analyses cleanly", () => {
    const lines = TEXT.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(TARGET_LINES);
    // A degenerate input would make every latency number meaningless.
    expect(ANALYSIS.problems).toEqual([]);
    expect(ANALYSIS.tokens.length).toBeGreaterThan(10);
    expect(ANALYSIS.classes.length).toBeGreaterThan(100);
    expect(ANALYSIS.colors.length).toBeGreaterThan(100);
    expect(ANALYSIS.keyframes.length).toBe(1);
    expect(ANALYSIS.groups.length).toBe(1);
  });
});

describe("10k-line document — recorded latency", () => {
  test("cold analysis (parse + symbol collection) stays under the ceiling", () => {
    const stats = timeRepeated(() => analyzeText({ text: TEXT, path: DOCUMENT_PATH, version: 1 }), {
      warmup: 2,
      samples: 20,
    });
    table.add("analyzeText (cold analysis)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
    expect(stats.p50).toBeLessThanOrEqual(stats.p95);
  });

  test("completion returns real items inside the ceiling", () => {
    const offset = probeOffset();
    const result = completionsAt(TEXT, offset, { analysis: ANALYSIS });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.replaceEnd).toBe(offset);
    const stats = timeRepeated(() => completionsAt(TEXT, offset, { analysis: ANALYSIS }), {
      warmup: 10,
      samples: 100,
    });
    table.add("completionsAt ($ga → token)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("hover resolves the reference inside the ceiling", () => {
    const offset = probeOffset();
    const hover = hoverAt(TEXT, offset, { analysis: ANALYSIS });
    expect(hover).toBeDefined();
    expect(hover?.markdown).toContain("gap");
    const stats = timeRepeated(() => hoverAt(TEXT, offset, { analysis: ANALYSIS }), {
      warmup: 10,
      samples: 100,
    });
    table.add("hoverAt ($gap)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("definition finds the declaring token inside the ceiling", () => {
    const offset = referenceOffset();
    const targets = definitionsAt(TEXT, offset, { analysis: ANALYSIS });
    expect(targets.length).toBe(1);
    expect(targets[0]?.name).toBe("gap");
    const stats = timeRepeated(() => definitionsAt(TEXT, offset, { analysis: ANALYSIS }), {
      warmup: 10,
      samples: 100,
    });
    table.add("definitionsAt ($gap)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("references returns every use site inside the ceiling", () => {
    const offset = referenceOffset();
    const references = referencesAt(TEXT, offset, { analysis: ANALYSIS });
    expect(references.length).toBeGreaterThan(50);
    const stats = timeRepeated(() => referencesAt(TEXT, offset, { analysis: ANALYSIS }), {
      warmup: 5,
      samples: 50,
    });
    table.add("referencesAt ($gap)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("rename builds a whole-document plan inside the ceiling", () => {
    const offset = referenceOffset();
    const plan = renameAt(TEXT, offset, "gap-renamed", { analysis: ANALYSIS });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.edits.length).toBeGreaterThan(50);
    const stats = timeRepeated(
      () => renameAt(TEXT, offset, "gap-renamed", { analysis: ANALYSIS }),
      {
        warmup: 5,
        samples: 50,
      },
    );
    table.add("renameAt ($gap → gap-renamed)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("colour and symbol scans stay inside the ceiling", () => {
    const colors = colorsAt(TEXT, ANALYSIS);
    expect(colors.length).toBeGreaterThan(100);
    const symbols = documentSymbols(ANALYSIS);
    expect(symbols.length).toBeGreaterThan(100);
    const colorStats = timeRepeated(() => colorsAt(TEXT, ANALYSIS), { warmup: 5, samples: 50 });
    table.add("colorsAt (inline swatches)", colorStats);
    const symbolStats = timeRepeated(() => documentSymbols(ANALYSIS), { warmup: 5, samples: 50 });
    table.add("documentSymbols (outline)", symbolStats);
    expect(colorStats.p95).toBeLessThan(HARD_CEILING_MS);
    expect(symbolStats.p95).toBeLessThan(HARD_CEILING_MS);
  });

  test("the compile-backed analysis path is recorded against its own ceiling", async () => {
    const state = await analyzeDocument(
      { text: TEXT, path: DOCUMENT_PATH, version: 1 },
      { workspaceRoot: "/virtual/stress", compile: true },
    );
    expect(state.analysis.problems).toEqual([]);
    expect(Object.keys(state.compiled?.classes ?? {}).length).toBeGreaterThan(100);
    const stats = await timeRepeatedAsync(
      () =>
        analyzeDocument(
          { text: TEXT, path: DOCUMENT_PATH, version: 2 },
          { workspaceRoot: "/virtual/stress", compile: true },
        ),
      { warmup: 1, samples: 5 },
    );
    table.add("analyzeDocument (parse + compile)", stats);
    expect(stats.p95).toBeLessThan(COMPILE_CEILING_MS);
  });
});
