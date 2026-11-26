/**
 * Xessa color provider: named and hex colors authored in declaration values
 * become inline swatches, with hex/alpha-preserving presentations on edit.
 *
 * The detection is the pure `colorsAt` helper; this adapter only converts its
 * ranges and channels into `vscode` types. VS Code renders the swatch inline and
 * opens the native color picker on click; picking a color writes back
 * `#rrggbb` (lowercase, alpha only when it is not 1).
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorRange } from "../adapter.js";
import { colorsAt, rgbaToHex } from "../intelligence.js";
import type { AnalysisService } from "../service.js";

/** Color swatches for named and hex values in declarations. */
export class XessaColorProvider implements vscode.DocumentColorProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideDocumentColors(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.ColorInformation[]> {
    const source = sourceTextOf(document);
    const state = await this.service.analyzeNow(source);
    if (token.isCancellationRequested) return [];
    return colorsAt(source.text, state.analysis).map(
      ({ color, range }) =>
        new vscode.ColorInformation(
          toEditorRange(range),
          new vscode.Color(color.red, color.green, color.blue, color.alpha),
        ),
    );
  }

  provideColorPresentations(
    color: vscode.Color,
    context: { readonly document: vscode.TextDocument; readonly range: vscode.Range },
  ): vscode.ColorPresentation[] {
    // One hex presentation replaces exactly the authored value: a named color
    // (`red`) is rewritten only when the author actively picks a color, never by
    // an implicit edit.
    const presentation = new vscode.ColorPresentation(
      rgbaToHex(color.red, color.green, color.blue, color.alpha),
    );
    presentation.textEdit = new vscode.TextEdit(context.range, presentation.label);
    return [presentation];
  }
}
