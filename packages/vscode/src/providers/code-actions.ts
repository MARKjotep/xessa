/**
 * Xessa code action provider.
 *
 * The provider only adapts pure quick-fix decisions ({@link missingSemicolonFixes})
 * to `vscode.CodeAction`s; the analysis comes from the same `AnalysisService`
 * the other providers use, so the action matches the published diagnostics.
 */

import * as vscode from "vscode";
import { sourceTextOf, toAnalysisRange, toEditorRange } from "../adapter.js";
import type { Range as AnalysisRange } from "../analysis.js";
import { MISSING_SEMICOLON_CODE, missingSemicolonFixes } from "../quickfixes.js";
import type { AnalysisService } from "../service.js";

/** Provides `quickfix` code actions for Xessa documents. */
export class XessaCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  constructor(private readonly service: AnalysisService) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeAction[]> {
    if (document.languageId !== "xessa") return [];
    const state = await this.service.analyzeNow(sourceTextOf(document));
    if (token.isCancellationRequested) return [];

    const reported = context.diagnostics.filter(
      (diagnostic) => diagnostic.code === MISSING_SEMICOLON_CODE,
    );
    return missingSemicolonFixes(state.analysis, toAnalysisRange(range)).map((fix) => {
      const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      for (const change of fix.edits) {
        edit.replace(document.uri, toEditorRange(change.range), change.newText);
      }
      action.edit = edit;
      action.diagnostics = reported.filter((diagnostic) =>
        fix.diagnostics.some((problem) => sameRange(diagnostic.range, problem.range)),
      );
      action.isPreferred = true;
      return action;
    });
  }
}

function sameRange(editor: vscode.Range, problem: AnalysisRange): boolean {
  return (
    editor.start.line === problem.start.line &&
    editor.start.character === problem.start.character &&
    editor.end.line === problem.end.line &&
    editor.end.character === problem.end.character
  );
}
