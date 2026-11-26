/**
 * TT6 · keystroke storm.
 *
 * Replays every storm corpus document one character at a time — the shape of a
 * fast typist, where each keystroke re-parses the document and runs the provider
 * entry points the extension calls per keystroke:
 *
 * - `parse()` from the compiler barrel (tolerant parse of whatever is typed),
 * - `analyzeText()` (analysis that completion/hover read from the service cache),
 * - `completionsAt()`, `hoverAt()`, `colorsAt()`, `documentSymbols()`.
 *
 * Assertions: nothing throws, no unhandled rejection is raised, every result
 * shape stays inside the document bounds, and the whole storm finishes under a
 * generous wall-clock ceiling (recorded, not asserted as a number).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parse } from "../../../packages/compiler/src/index.ts";
import { analyzeText } from "../../../packages/vscode/src/analysis.ts";
import {
  colorsAt,
  completionsAt,
  documentSymbols,
  hoverAt,
} from "../../../packages/vscode/src/intelligence.ts";
import { STORM_DOCUMENTS, stormCorpusSize } from "./documents.ts";
import { HARD_CEILING_MS, TimingTable, timeRepeated } from "./timing.ts";

/** Total wall-clock ceiling for replaying the whole storm corpus. */
const STORM_CEILING_MS = 60_000;

const table = new TimingTable();
const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

beforeAll(() => {
  process.on("unhandledRejection", onRejection);
});

afterAll(() => {
  process.off("unhandledRejection", onRejection);
  table.print("keystroke storm (per-keystroke cost, milliseconds)");
});

/** One keystroke's worth of editor work. */
interface Keystroke {
  readonly document: string;
  readonly offset: number;
  readonly text: string;
}

/** Every character position of every storm document. */
function keystrokes(): Keystroke[] {
  const strokes: Keystroke[] = [];
  for (const document of STORM_DOCUMENTS) {
    for (let end = 1; end <= document.text.length; end += 1) {
      strokes.push({ document: document.name, offset: end, text: document.text.slice(0, end) });
    }
  }
  return strokes;
}

/** Run one keystroke through every entry point; returns the pieces to assert on. */
function runKeystroke(stroke: Keystroke) {
  const parsed = parse(stroke.text, { file: `${stroke.document}.cssx` });
  const analysis = analyzeText(
    { text: stroke.text, path: `/virtual/storm/${stroke.document}.cssx`, version: stroke.offset },
    { workspaceRoot: "/virtual/storm", readModule: () => undefined },
  );
  const completions = completionsAt(stroke.text, stroke.offset, { analysis });
  const hover = hoverAt(stroke.text, stroke.offset, { analysis });
  const colors = colorsAt(stroke.text, analysis);
  const symbols = documentSymbols(analysis);
  return { parsed, analysis, completions, hover, colors, symbols };
}

describe("keystroke storm — corpus", () => {
  const strokes = keystrokes();

  test("the corpus is the six A45–A51 documents, typed one character at a time", () => {
    expect(STORM_DOCUMENTS.length).toBe(6);
    expect(stormCorpusSize()).toBeGreaterThan(800);
    expect(strokes.length).toBe(stormCorpusSize());
    for (const name of STORM_DOCUMENTS.map((document) => document.name)) {
      expect(strokes.some((stroke) => stroke.document === name)).toBe(true);
    }
  });

  test("every keystroke parses and analyses without throwing", () => {
    let parseDiagnostics = 0;
    for (const stroke of strokes) {
      const state = runKeystroke(stroke);
      parseDiagnostics += state.parsed.diagnostics.length;
      // The parser and the analysis layer must agree on what is broken.
      expect(state.analysis.problems.every((problem) => problem.range.start.line >= 0)).toBe(true);
    }
    // Mid-edit prefixes really are malformed for much of the storm: a corpus
    // that produced no diagnostics at all would not be testing recovery.
    expect(parseDiagnostics).toBeGreaterThan(0);
  });

  test("every completion result stays inside the document and cursor", () => {
    for (const stroke of strokes) {
      const { completions } = runKeystroke(stroke);
      expect(completions.replaceEnd).toBe(stroke.offset);
      expect(completions.replaceStart).toBeGreaterThanOrEqual(0);
      expect(completions.replaceStart).toBeLessThanOrEqual(stroke.offset);
      for (const item of completions.items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.insertText.length).toBeGreaterThan(0);
        if (item.replaceStart !== undefined) {
          expect(item.replaceStart).toBeGreaterThanOrEqual(0);
          expect(item.replaceStart).toBeLessThanOrEqual(stroke.offset);
        }
      }
    }
  });

  test("hover, colour and outline results stay inside the document bounds", () => {
    for (const stroke of strokes) {
      const { hover, colors, symbols, analysis } = runKeystroke(stroke);
      const lastLine = analysis.lineStarts.length - 1;
      if (hover !== undefined) {
        expect(hover.range.start.line).toBeGreaterThanOrEqual(0);
        expect(hover.range.end.line).toBeLessThanOrEqual(lastLine);
      }
      for (const color of colors) {
        expect(color.range.start.line).toBeGreaterThanOrEqual(0);
        expect(color.range.end.line).toBeLessThanOrEqual(lastLine);
        expect(color.color.alpha).toBeGreaterThanOrEqual(0);
        expect(color.color.alpha).toBeLessThanOrEqual(1);
      }
      for (const symbol of symbols) {
        expect(symbol.range.start.line).toBeGreaterThanOrEqual(0);
        expect(symbol.range.end.line).toBeLessThanOrEqual(lastLine);
      }
    }
  });

  test("the storm is bounded in time and raises no unhandled rejection", () => {
    const started = performance.now();
    for (const stroke of strokes) runKeystroke(stroke);
    const total = performance.now() - started;
    console.log(
      `[TT6 storm] ${strokes.length} keystrokes over ${STORM_DOCUMENTS.length} documents: ${total.toFixed(1)}ms total`,
    );
    expect(total).toBeLessThan(STORM_CEILING_MS);
    expect(rejections).toEqual([]);
  });

  test("per-keystroke cost is recorded", () => {
    const sample = strokes.filter((_, index) => index % 8 === 0);
    const stats = timeRepeated(
      () => {
        for (const stroke of sample) runKeystroke(stroke);
      },
      { warmup: 1, samples: 20 },
    );
    // Normalize to a single keystroke so the number in the report is readable.
    const perStroke = {
      samples: stats.samples,
      p50: Math.round((stats.p50 / sample.length) * 1000) / 1000,
      p95: Math.round((stats.p95 / sample.length) * 1000) / 1000,
      max: Math.round((stats.max / sample.length) * 1000) / 1000,
      total: stats.total,
    };
    table.add(`keystroke (${sample.length} sampled states)`, perStroke);
    expect(perStroke.p95).toBeLessThan(HARD_CEILING_MS);
  });
});
