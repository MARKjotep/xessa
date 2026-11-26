/**
 * Xessa document formatting provider.
 *
 * The provider is a thin adapter over the pure {@link formatDocument} decision:
 * manual **Format Document** / ⌥⇧F and `editor.formatOnSave` reach the same
 * whole-document edit, and the extension's own save listener reuses
 * {@link formattingEdits} so both paths behave identically.
 *
 * There is no range formatter in v0.1: the compiler formatter is a
 * document-level parse→print pass (see `docs/known-limitations.md`).
 */

import * as vscode from "vscode";
import { toEditorRange } from "../adapter.js";
import { formatDocument } from "../formatting.js";
import { toPosix } from "../paths.js";

/**
 * Whole-document formatting edits for a Xessa document.
 *
 * Returns an empty array when the document is already canonical or parsing
 * failed (the formatter is forbidden from rewriting input it cannot parse).
 */
export function formattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
  const outcome = formatDocument(document.getText(), toPosix(document.uri.fsPath));
  if (outcome.edit === undefined) return [];
  return [new vscode.TextEdit(toEditorRange(outcome.edit.range), outcome.edit.newText)];
}

/** Provides canonical whole-document formatting for Xessa documents. */
export class XessaFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): vscode.TextEdit[] {
    if (document.languageId !== "xessa") return [];
    if (token.isCancellationRequested) return [];
    return formattingEdits(document);
  }
}
