/**
 * TT6 · malformed mid-edit states.
 *
 * Every truncated prefix of the five representative A45–A51 documents — a hex
 * colour line, the `(` call opener, `&:`/`&.` repairs, an `@setup` block and a
 * `@use` line — is fed through the parser and every provider entry point. A
 * prefix is exactly what the editor sees between two keystrokes, and most of
 * them are malformed: an unterminated string, an open block, a dangling
 * declaration.
 *
 * Assertions: nothing throws, no unhandled rejection, every diagnostic span and
 * every editor range stays inside the document, and completions degrade to a
 * well-formed (possibly empty) list rather than an error.
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
import { MID_EDIT_DOCUMENTS, truncatedPrefixes } from "./documents.ts";

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

beforeAll(() => {
  process.on("unhandledRejection", onRejection);
});

afterAll(() => {
  process.off("unhandledRejection", onRejection);
});

/** Every (document, prefix) pair of the corpus. */
interface PrefixCase {
  readonly document: string;
  readonly text: string;
  /** Cursor offsets exercised for this prefix (always includes the end). */
  readonly offsets: readonly number[];
}

/** Build the full truncation corpus, with a few interior cursors per prefix. */
function prefixCorpus(): PrefixCase[] {
  const cases: PrefixCase[] = [];
  for (const document of MID_EDIT_DOCUMENTS) {
    for (const text of truncatedPrefixes(document.text)) {
      const offsets = new Set<number>([text.length]);
      // Two interior cursors per prefix so hover/completion are also probed at
      // offsets that are not the end of the typed text.
      for (const fraction of [1 / 3, 2 / 3]) {
        offsets.add(Math.min(text.length, Math.max(0, Math.round(text.length * fraction))));
      }
      cases.push({ document: document.name, text, offsets: [...offsets].sort((a, b) => a - b) });
    }
  }
  return cases;
}

const CORPUS = prefixCorpus();

describe("malformed mid-edit — corpus", () => {
  test("the corpus is every prefix of every representative document", () => {
    expect(MID_EDIT_DOCUMENTS.length).toBe(5);
    const expected = MID_EDIT_DOCUMENTS.reduce(
      (total, document) => total + document.text.length,
      0,
    );
    expect(CORPUS.length).toBe(expected);
    for (const document of MID_EDIT_DOCUMENTS) {
      const prefixes = CORPUS.filter((entry) => entry.document === document.name);
      expect(prefixes.length).toBe(document.text.length);
      // Shortest prefix and the complete document are both present.
      expect(prefixes[0]?.text.length).toBe(1);
      expect(prefixes[prefixes.length - 1]?.text).toBe(document.text);
    }
  });
});

describe("malformed mid-edit — providers never throw", () => {
  let diagnosticCount = 0;
  let malformedPrefixes = 0;

  test("every prefix parses with in-bounds diagnostic spans", () => {
    for (const entry of CORPUS) {
      const parsed = parse(entry.text, { file: `${entry.document}.cssx` });
      if (parsed.diagnostics.length > 0) malformedPrefixes += 1;
      for (const diagnostic of parsed.diagnostics) {
        diagnosticCount += 1;
        expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
        expect(diagnostic.span.end).toBeLessThanOrEqual(entry.text.length);
        expect(diagnostic.code.startsWith("XESSA")).toBe(true);
      }
    }
    console.log(
      `[TT6 mid-edit] ${CORPUS.length} prefixes over ${MID_EDIT_DOCUMENTS.length} documents: ` +
        `${malformedPrefixes} malformed, ${diagnosticCount} parse diagnostics`,
    );
    // A quarter of the truncation corpus must be malformed, otherwise this file
    // would only be re-testing well-formed documents.
    expect(malformedPrefixes).toBeGreaterThan(CORPUS.length / 4);
    expect(diagnosticCount).toBeGreaterThan(malformedPrefixes);
  });

  test("analysis and every provider call return well-formed results", () => {
    for (const entry of CORPUS) {
      const analysis = analyzeText(
        {
          text: entry.text,
          path: `/virtual/mid/${entry.document}.cssx`,
          version: entry.text.length,
        },
        { workspaceRoot: "/virtual/mid", readModule: () => undefined },
      );
      const lastLine = analysis.lineStarts.length - 1;
      for (const problem of analysis.problems) {
        expect(problem.range.start.line).toBeGreaterThanOrEqual(0);
        expect(problem.range.end.line).toBeLessThanOrEqual(lastLine);
      }

      for (const offset of entry.offsets) {
        const completions = completionsAt(entry.text, offset, { analysis });
        expect(Array.isArray(completions.items)).toBe(true);
        expect(completions.replaceEnd).toBe(offset);
        expect(completions.replaceStart).toBeGreaterThanOrEqual(0);
        expect(completions.replaceStart).toBeLessThanOrEqual(offset);
        for (const item of completions.items) {
          expect(item.label.length).toBeGreaterThan(0);
          expect(item.insertText.length).toBeGreaterThan(0);
        }

        const hover = hoverAt(entry.text, offset, { analysis });
        if (hover !== undefined) {
          expect(hover.range.start.line).toBeGreaterThanOrEqual(0);
          expect(hover.range.end.line).toBeLessThanOrEqual(lastLine);
        }
      }

      for (const color of colorsAt(entry.text, analysis)) {
        expect(color.range.start.line).toBeGreaterThanOrEqual(0);
        expect(color.range.end.line).toBeLessThanOrEqual(lastLine);
      }
      for (const symbol of documentSymbols(analysis)) {
        expect(symbol.range.start.line).toBeGreaterThanOrEqual(0);
        expect(symbol.range.end.line).toBeLessThanOrEqual(lastLine);
      }
    }
  });

  test("completions degrade gracefully: an empty list, never a broken one", () => {
    let emptyStates = 0;
    let offeredStates = 0;
    for (const entry of CORPUS) {
      const analysis = analyzeText(
        {
          text: entry.text,
          path: `/virtual/mid/${entry.document}.cssx`,
          version: entry.text.length,
        },
        { workspaceRoot: "/virtual/mid", readModule: () => undefined },
      );
      const offset = entry.text.length;
      const result = completionsAt(entry.text, offset, { analysis });
      if (result.items.length === 0) {
        emptyStates += 1;
        // An empty list is fine; the replacement range must still be valid (it
        // can start before the cursor: an `@` directive prefix covers its `@`).
        expect(result.replaceStart).toBeGreaterThanOrEqual(0);
        expect(result.replaceStart).toBeLessThanOrEqual(offset);
        continue;
      }
      offeredStates += 1;
      // Every offered label must survive being inserted: no NUL, no newline in
      // a single-line value and no label that is only whitespace.
      for (const item of result.items) {
        expect(item.label.trim().length).toBeGreaterThan(0);
        expect(item.insertText.includes("\u0000")).toBe(false);
        expect(item.insertText.includes("\n")).toBe(false);
      }
    }
    expect(offeredStates).toBeGreaterThan(0);
    expect(emptyStates).toBeGreaterThan(0);
  });

  test("no unhandled rejection was raised by the corpus", () => {
    expect(rejections).toEqual([]);
  });
});
