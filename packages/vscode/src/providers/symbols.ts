/**
 * Xessa outline provider: setup/use/variables/runtime/media-types/rules with
 * nested rules and conditional blocks.
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorRange } from "../adapter.js";
import { type OutlineNode, documentSymbols } from "../intelligence.js";
import type { AnalysisService } from "../service.js";

function symbolKind(node: OutlineNode): vscode.SymbolKind {
  switch (node.kind) {
    case "setup":
    case "variables":
    case "runtime":
    case "media-types":
      return vscode.SymbolKind.Namespace;
    case "use":
      return vscode.SymbolKind.Module;
    case "token":
      return vscode.SymbolKind.Variable;
    case "alias":
      return vscode.SymbolKind.EnumMember;
    case "group":
      return vscode.SymbolKind.Interface;
    case "rule":
      return vscode.SymbolKind.Class;
    case "declaration":
      return vscode.SymbolKind.Property;
    default:
      return vscode.SymbolKind.Object;
  }
}

function toSymbol(node: OutlineNode): vscode.DocumentSymbol {
  const range = toEditorRange(node.range);
  const symbol = new vscode.DocumentSymbol(
    node.name,
    node.detail ?? "",
    symbolKind(node),
    range,
    range,
  );
  symbol.children = node.children.map(toSymbol);
  return symbol;
}

/** Outline symbols for `.cssx` documents. */
export class XessaSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentSymbol[]> {
    const state = await this.service.analyzeNow(sourceTextOf(document));
    if (token.isCancellationRequested) return [];
    return documentSymbols(state.analysis).map(toSymbol);
  }
}
