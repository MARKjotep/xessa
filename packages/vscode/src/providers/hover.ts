/**
 * Xessa hover provider: resolved token values, media condition expressions, CSS
 * property descriptions, groups, keyframes and generated class names. Built-in
 * one-sentence property docs are provided; the full css-languageservice
 * projection is still not embedded (A13 report).
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorRange } from "../adapter.js";
import { hoverAt } from "../intelligence.js";
import type { AnalysisService } from "../service.js";

/** Hover for `$tokens`, `@aliases`, CSS properties and selector classes. */
export class XessaHoverProvider implements vscode.HoverProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const source = sourceTextOf(document);
    const state = await this.service.analyzeNow(source);
    if (token.isCancellationRequested) return undefined;
    const hover = hoverAt(source.text, document.offsetAt(position), {
      analysis: state.analysis,
      ...(state.compiled === undefined ? {} : { classMap: state.compiled.classes }),
    });
    if (hover === undefined) return undefined;
    return new vscode.Hover(new vscode.MarkdownString(hover.markdown), toEditorRange(hover.range));
  }
}
