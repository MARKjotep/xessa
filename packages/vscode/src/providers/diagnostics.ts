/**
 * Xessa diagnostics provider.
 *
 * Diagnostics come from the tolerant compiler parse plus an in-memory compile
 * for semantic checks. Analysis is debounced (150 ms) and version-guarded by
 * {@link AnalysisService}; publishing a stale result is impossible because the
 * service only reports the newest document version. Compiler failures are
 * captured and summarized in the output channel, never thrown at the editor.
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorDiagnostic } from "../adapter.js";
import type { DocumentState } from "../analysis.js";
import type { AnalysisService } from "../service.js";

/** Publishes compiler problems as editor diagnostics. */
export class XessaDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(
    private readonly service: AnalysisService,
    private readonly report: (message: string) => void,
  ) {
    this.collection = vscode.languages.createDiagnosticCollection("xessa");
  }

  /** Debounced analysis for an edited/opened document. */
  schedule(document: vscode.TextDocument): void {
    if (document.languageId !== "xessa") return;
    const source = sourceTextOf(document);
    this.service.schedule(source, (state) => {
      this.publish(document.uri, state);
      this.reportCompileFailure(document, state);
    });
  }

  /** Analyze immediately and publish (save/command path). */
  async refresh(document: vscode.TextDocument): Promise<DocumentState | undefined> {
    if (document.languageId !== "xessa") return undefined;
    const state = await this.service.analyzeNow(sourceTextOf(document));
    this.publish(document.uri, state);
    this.reportCompileFailure(document, state);
    return state;
  }

  /**
   * Publish the current diagnostics of one document. Problems reported against
   * imported modules are not published at this document's offsets.
   */
  publish(uri: vscode.Uri, state: DocumentState): void {
    const own = state.analysis.problems.filter((problem) => problem.file === state.analysis.file);
    this.collection.set(uri, own.map(toEditorDiagnostic));
  }

  /** Clear diagnostics for a closed document. */
  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  /** Replace diagnostics for an arbitrary URI (project checks). */
  set(uri: vscode.Uri, state: DocumentState): void {
    this.publish(uri, state);
  }

  dispose(): void {
    this.collection.dispose();
  }

  private reportCompileFailure(document: vscode.TextDocument, state: DocumentState): void {
    if (state.compiled?.error === undefined) return;
    this.report(`${document.uri.fsPath}: compile failed: ${state.compiled.error}`);
  }
}
