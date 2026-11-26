/**
 * Pure formatting-decision tests for the Xessa VS Code extension.
 *
 * These exercise the same `formatDocument` function the provider and the
 * save listener call, without the `vscode` module: one whole-document edit only
 * when the canonical text differs and parsing succeeded. Deterministic, no
 * editor host and no fixed sleeps.
 */

import { describe, expect, test } from "bun:test";
import { format } from "../../packages/compiler/src/index.ts";
import { type Range, computeLineStarts, positionAt } from "../../packages/vscode/src/analysis.ts";
import { formatDocument } from "../../packages/vscode/src/formatting.ts";

const FILE = "src/example.cssx";

function applyEdit(
  text: string,
  edit: { readonly range: Range; readonly newText: string },
): string {
  const lineStarts = computeLineStarts(text);
  const offset = (position: { readonly line: number; readonly character: number }): number =>
    (lineStarts[Math.min(position.line, lineStarts.length - 1)] ?? 0) + position.character;
  return (
    text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end))
  );
}

describe("formatDocument", () => {
  test("already canonical text produces no edit", () => {
    const text = ".a {\n  color: red;\n}\n";
    const outcome = formatDocument(text, FILE);
    expect(outcome.edit).toBeUndefined();
    expect(outcome.formatted).toBe(text);
    expect(outcome.parseFailed).toBe(false);
  });

  test("an empty document produces no edit", () => {
    expect(formatDocument("", FILE)).toEqual({ formatted: "", parseFailed: false });
  });

  test("messy text produces one full-document edit and is then idempotent", () => {
    const text = ".a{color:red}";
    const outcome = formatDocument(text, FILE);
    expect(outcome.parseFailed).toBe(false);
    expect(outcome.edit).toBeDefined();
    if (outcome.edit === undefined) return;

    expect(outcome.edit.range.start).toEqual({ line: 0, character: 0 });
    expect(outcome.edit.range.end).toEqual(positionAt(computeLineStarts(text), text.length));
    expect(outcome.edit.newText).toBe(".a {\n  color: red;\n}\n");

    const applied = applyEdit(text, outcome.edit);
    expect(applied).toBe(outcome.edit.newText);
    expect(formatDocument(applied, FILE).edit).toBeUndefined();
  });

  test("a parse error returns the input byte-identical with no edit", () => {
    const text = "@md {\n  .card { padding: 20px; }\n}\n";
    const outcome = formatDocument(text, FILE);
    expect(outcome).toEqual({ formatted: text, parseFailed: true });
    expect(outcome.edit).toBeUndefined();
  });

  test("a Xessa declaration missing its semicolon is never repaired by the formatter", () => {
    const text = "@variables { gap: 8px; }\n.a { padding: $gap }";
    const outcome = formatDocument(text, FILE);
    expect(outcome).toEqual({ formatted: text, parseFailed: true });
    expect(outcome.edit).toBeUndefined();
    // Evidence: the parser reports XESSA1002 and the quick fix owns the repair.
    const diagnostics = format(text, FILE).diagnostics;
    expect(diagnostics.some((diagnostic) => diagnostic.code === "XESSA1002")).toBe(true);
  });

  test("a semicolonless plain-CSS final declaration prints its canonical semicolon", () => {
    const text = ".a { color: red }";
    const outcome = formatDocument(text, FILE);
    expect(outcome.parseFailed).toBe(false);
    expect(outcome.edit?.newText).toBe(".a {\n  color: red;\n}\n");
  });

  test("CRLF input becomes the canonical LF layout in one edit", () => {
    const text = ".a {\r\n  color: red;\r\n}\r\n";
    const outcome = formatDocument(text, FILE);
    expect(outcome.edit?.newText).toBe(".a {\n  color: red;\n}\n");
  });
});
