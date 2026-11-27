/**
 * Group override ghost text (CSSX-GROUP-GHOST-HINTS).
 *
 * A zero-width `after` decoration shows the group default a use-site
 * declaration shadows. The decoration type is created once and every hint only
 * supplies its own `contentText`, so nothing is written, no column shifts and
 * the colour comes from the theme's code-lens foreground.
 *
 * Refresh reads the document analysis already cached by {@link AnalysisService}
 * instead of scheduling a second compile: a change debounces briefly until the
 * diagnostics pass has published its result. Selection and editor events reuse
 * the same cached analysis.
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorRange } from "../adapter.js";
import type { DocumentState } from "../analysis.js";
import {
  type GroupHint,
  groupHintMode,
  groupHints,
  planGroupHintDecorations,
} from "../group-hints.js";
import type { AnalysisService } from "../service.js";

/** Setting id relative to the `xessa` section. */
const SETTING = "editor.groupOverrideHints";
/** Slightly after the diagnostics debounce (150 ms), so its result is cached. */
const REFRESH_DELAY_MS = 160;
/** Retry while the shared analysis is still running; never compiles itself. */
const RETRY_DELAY_MS = 25;
const MAX_RETRIES = 40;

function isFileXessaDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "xessa" && document.uri.scheme === "file";
}

/** Applies and clears group override ghost text for visible editors. */
export class XessaGroupHintsProvider implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly service: AnalysisService) {}

  /** Debounced refresh after a document change or open. */
  schedule(document: vscode.TextDocument): void {
    if (!isFileXessaDocument(document)) return;
    const key = document.uri.toString();
    const previous = this.pending.get(key);
    if (previous !== undefined) clearTimeout(previous);
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.refresh(document);
      }, REFRESH_DELAY_MS),
    );
  }

  /**
   * Re-apply hints from the cached analysis for this document version.
   *
   * Never triggers a compile: while the shared analysis is still running the
   * call waits (bounded) for its cache entry. A stale version is ignored.
   */
  refresh(document: vscode.TextDocument, attempt = 0): void {
    if (!isFileXessaDocument(document)) {
      this.clear(document.uri);
      return;
    }
    const key = document.uri.toString();
    const state = this.service.cached(sourceTextOf(document));
    if (state !== undefined) {
      this.cancelRetry(key);
      this.apply(document, state);
      return;
    }
    if (attempt >= MAX_RETRIES) return;
    const previous = this.retries.get(key);
    if (previous !== undefined) clearTimeout(previous);
    this.retries.set(
      key,
      setTimeout(() => {
        this.retries.delete(key);
        this.refresh(document, attempt + 1);
      }, RETRY_DELAY_MS),
    );
  }

  /** Apply one analysed state to every visible editor showing its document. */
  apply(document: vscode.TextDocument, state: DocumentState): void {
    if (!isFileXessaDocument(document) || state.analysis.version !== document.version) return;
    const hints = groupHints({ ...state.analysis, text: document.getText() });
    const key = document.uri.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) this.decorate(editor, hints);
    }
  }

  /** Re-apply every visible Xessa editor from cached analysis (mode changes). */
  refreshVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isFileXessaDocument(editor.document)) this.refresh(editor.document);
    }
  }

  /** Re-apply one editor (selection or active-editor change). */
  refreshEditor(editor: vscode.TextEditor): void {
    if (isFileXessaDocument(editor.document)) this.refresh(editor.document);
  }

  /** Drop decorations and timers for a closed document. */
  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    this.cancelPending(key);
    this.cancelRetry(key);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) editor.setDecorations(this.decoration, []);
    }
  }

  dispose(): void {
    for (const handle of this.pending.values()) clearTimeout(handle);
    for (const handle of this.retries.values()) clearTimeout(handle);
    this.pending.clear();
    this.retries.clear();
    this.decoration.dispose();
  }

  private decorate(editor: vscode.TextEditor, hints: readonly GroupHint[]): void {
    const document = editor.document;
    const raw = vscode.workspace
      .getConfiguration("xessa", document.uri)
      .get<unknown>(SETTING, "always");
    const cursor = editor.selection.active;
    const planned = planGroupHintDecorations(
      hints,
      groupHintMode(raw),
      { line: cursor.line, character: cursor.character },
      (id) => new vscode.ThemeColor(id),
    );
    editor.setDecorations(
      this.decoration,
      planned.map((option) => ({
        range: toEditorRange(option.range),
        renderOptions: option.renderOptions,
      })),
    );
  }

  private cancelPending(key: string): void {
    const handle = this.pending.get(key);
    if (handle !== undefined) clearTimeout(handle);
    this.pending.delete(key);
  }

  private cancelRetry(key: string): void {
    const handle = this.retries.get(key);
    if (handle !== undefined) clearTimeout(handle);
    this.retries.delete(key);
  }
}
