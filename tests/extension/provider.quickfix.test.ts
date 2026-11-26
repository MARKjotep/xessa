/**
 * Pure quick-fix tests: the missing-semicolon action and its edit offsets.
 * No editor session and no `vscode` module are involved.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type AnalysisProblem,
  type AnalyzeOptions,
  type DocumentState,
  type Position,
  type Range,
  analyzeDocument,
  analyzeText,
  computeLineStarts,
} from "../../packages/vscode/src/analysis.ts";
import { missingSemicolonFixes } from "../../packages/vscode/src/quickfixes.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const PATH = join(ROOT, "example.cssx");

async function analyze(text: string, options: AnalyzeOptions = {}): Promise<DocumentState> {
  return analyzeDocument(
    { text, path: PATH, version: 1 },
    { workspaceRoot: ROOT, compile: false, ...options },
  );
}

function offsetOf(lineStarts: readonly number[], position: Position): number {
  return (lineStarts[Math.min(position.line, lineStarts.length - 1)] ?? 0) + position.character;
}

function applyEdits(
  text: string,
  edits: readonly { readonly range: Range; readonly newText: string }[],
): string {
  const lineStarts = computeLineStarts(text);
  const resolved = edits
    .map((edit) => ({
      start: offsetOf(lineStarts, edit.range.start),
      end: offsetOf(lineStarts, edit.range.end),
      newText: edit.newText,
    }))
    .sort((left, right) => right.start - left.start);
  let result = text;
  for (const edit of resolved) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

function synthetic(text: string, problems: readonly AnalysisProblem[]): DocumentState {
  const analysis = analyzeText({ text, path: PATH, version: 1 });
  return { analysis: { ...analysis, problems } };
}

function problem(range: Range, overrides: Partial<AnalysisProblem> = {}): AnalysisProblem {
  return {
    code: "XESSA1002",
    severity: "error",
    message:
      "missing semicolon after a declaration; v0.1 requires a semicolon for Xessa declarations (ADR-0011)",
    file: PATH,
    range,
    source: "parse",
    ...overrides,
  };
}

function cursor(line: number, character: number): Range {
  return { start: { line, character }, end: { line, character } };
}

describe("missing-semicolon quick fix", () => {
  test("a real XESSA1002 diagnostic inserts ; at the declaration value end", async () => {
    const text = "@variables { gap: 8px; }\n.a { padding: $gap }";
    const state = await analyze(text);
    const diagnostics = state.analysis.problems.filter((item) => item.code === "XESSA1002");
    expect(diagnostics).toHaveLength(1);
    const end = { line: 1, character: 18 };
    expect(diagnostics[0]?.range.end).toEqual(end);

    const fixes = missingSemicolonFixes(state.analysis, cursor(end.line, end.character));
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.title).toBe("Add semicolon");
    expect(fixes[0]?.diagnosticCode).toBe("XESSA1002");
    expect(fixes[0]?.edits).toEqual([{ range: { start: end, end }, newText: ";" }]);
    expect(applyEdits(text, fixes[0]?.edits ?? [])).toBe(
      "@variables { gap: 8px; }\n.a { padding: $gap; }",
    );
  });

  test("the reported &-before-nested-rule shape gets an insertion at the line end", () => {
    const text = ".a {\n  color: red\n  & .b { color: blue; }\n}";
    const declaration = { start: { line: 1, character: 2 }, end: { line: 1, character: 12 } };
    const state = synthetic(text, [problem(declaration)]);
    const fixes = missingSemicolonFixes(state.analysis, cursor(1, 0));
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.edits).toEqual([
      {
        range: { start: { line: 1, character: 12 }, end: { line: 1, character: 12 } },
        newText: ";",
      },
    ]);
    expect(applyEdits(text, fixes[0]?.edits ?? [])).toBe(
      ".a {\n  color: red;\n  & .b { color: blue; }\n}",
    );
  });

  test("the same insertion offset yields one action carrying every problem", () => {
    const text = ".a { padding: $gap }";
    const first = {
      start: { line: 0, character: 5 },
      end: { line: 0, character: 18 },
    };
    const second = { start: { line: 0, character: 5 }, end: { line: 0, character: 18 } };
    const state = synthetic(text, [problem(first), problem(second)]);
    const fixes = missingSemicolonFixes(state.analysis, cursor(0, 9));
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.diagnostics).toHaveLength(2);
  });

  test("unrelated lines, other codes and other files produce no action", () => {
    const text = [".a { padding: $gap }", ".b { color: red; }", ".c { margin: $space }"].join("\n");
    const state = synthetic(text, [
      problem({ start: { line: 0, character: 5 }, end: { line: 0, character: 18 } }),
      problem(
        { start: { line: 2, character: 5 }, end: { line: 2, character: 19 } },
        {
          code: "XESSA1001",
        },
      ),
      problem(
        { start: { line: 2, character: 5 }, end: { line: 2, character: 19 } },
        {
          file: "/elsewhere/other.cssx",
        },
      ),
    ]);
    expect(missingSemicolonFixes(state.analysis, cursor(1, 2))).toEqual([]);
  });

  test("two declarations on different lines get one action each", () => {
    const text = ".a {\n  padding: $gap\n  margin: $space\n}";
    const state = synthetic(text, [
      problem({ start: { line: 1, character: 2 }, end: { line: 1, character: 15 } }),
      problem({ start: { line: 2, character: 2 }, end: { line: 2, character: 16 } }),
    ]);
    const fixes = missingSemicolonFixes(state.analysis, {
      start: { line: 1, character: 4 },
      end: { line: 2, character: 4 },
    });
    expect(fixes).toHaveLength(2);
    expect(fixes.map((fix) => fix.edits[0]?.range.start)).toEqual([
      { line: 1, character: 15 },
      { line: 2, character: 16 },
    ]);
  });
});
