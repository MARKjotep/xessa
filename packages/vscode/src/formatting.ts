/**
 * Pure canonical formatting for Xessa documents.
 *
 * The compiler's public `format()` is a parse→print pass: parse errors return
 * the input byte-identical, and formatting never changes compilation semantics.
 * This module decides whether a document needs one full-document edit; the
 * provider adapter converts that edit to `vscode.TextEdit` and the save
 * listener requests the same edit. No `vscode` import, so `bun test` drives the
 * exact logic the extension host uses.
 */

import { format } from "../../compiler/src/index.js";
import type { Range } from "./analysis.js";
import { computeLineStarts, positionAt } from "./analysis.js";

/** One full-document replacement edit. */
export interface DocumentFormatEdit {
  readonly range: Range;
  readonly newText: string;
}

/** Formatting decision for one document snapshot. */
export interface DocumentFormatOutcome {
  /** Canonical text, or the original text when parsing failed or nothing changed. */
  readonly formatted: string;
  /** Single whole-document edit; absent when the document is already canonical. */
  readonly edit?: DocumentFormatEdit;
  /** True when `format()` reported at least one error and returned the input unchanged. */
  readonly parseFailed: boolean;
}

/**
 * Format `text` and return a whole-document edit only when it is safe and useful.
 *
 * A parse error leaves the input untouched: the formatter must never mangle a
 * document it cannot understand (including a Xessa declaration missing its
 * semicolon, `XESSA1002`, whose fix belongs to the quick fix). Already
 * canonical input produces no edit so save-time formatting is a no-op.
 *
 * @param text The document's current text.
 * @param file Workspace-relative POSIX label used for formatter diagnostics.
 */
export function formatDocument(text: string, file: string): DocumentFormatOutcome {
  const result = format(text, file);
  const parseFailed = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (parseFailed || result.formatted === text) return { formatted: text, parseFailed };

  const lineStarts = computeLineStarts(text);
  return {
    formatted: result.formatted,
    parseFailed,
    edit: {
      range: {
        start: { line: 0, character: 0 },
        end: positionAt(lineStarts, text.length),
      },
      newText: result.formatted,
    },
  };
}
