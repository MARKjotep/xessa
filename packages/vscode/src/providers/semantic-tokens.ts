/**
 * Xessa semantic-token provider: compile-time `$tokens`, runtime tokens,
 * `--custom-property` references and resolved `$ns.member` / `$keyframes.name`
 * members, coloured by the pure `semantic-tokens.ts` classifier.
 *
 * The provider runs parse-only analysis (`analyzeText`) so a document with
 * parse errors can never push an exception into the editor: classifications the
 * analysis cannot produce fall back to the TextMate grammar, which keeps its
 * existing scopes. Imported members resolve through the same synchronous module
 * reader the hover/completion path uses.
 */

import * as vscode from "vscode";
import { readModuleSync, sourceTextOf } from "../adapter.js";
import { analyzeText } from "../analysis.js";
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  encodeSemanticTokens,
  semanticTokensFor,
} from "../semantic-tokens.js";

/** Document semantic tokens for Xessa. */
export class XessaSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  readonly legend: vscode.SemanticTokensLegend = new vscode.SemanticTokensLegend(
    [...SEMANTIC_TOKEN_TYPES],
    [...SEMANTIC_TOKEN_MODIFIERS],
  );

  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens | undefined {
    const source = sourceTextOf(document);
    try {
      const analysis = analyzeText(source, { readModule: readModuleSync });
      const data = encodeSemanticTokens(
        semanticTokensFor(source.text, analysis),
        analysis.lineStarts,
      );
      return new vscode.SemanticTokens(Uint32Array.from(data));
    } catch {
      // Grammar fallback: an empty result keeps every authored scope intact.
      return new vscode.SemanticTokens(new Uint32Array(0));
    }
  }
}
