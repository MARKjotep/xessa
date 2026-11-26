/**
 * Thin VS Code adapters over the pure analysis/intelligence results.
 *
 * Keeping every `vscode` type conversion here means the providers stay short
 * and the unit-testable logic never depends on the editor module.
 */

import { readFileSync, readdirSync } from "node:fs";
import * as vscode from "vscode";
import type { AnalysisProblem, Range as AnalysisRange, SourceText } from "./analysis.js";
import type { DirectoryEntry } from "./glob.js";
import type { DefinitionTarget, SuggestionKind } from "./intelligence.js";
import { normalizePath, toPosix } from "./paths.js";

/** Plain source input for the pure analysis layer. */
export function sourceTextOf(document: vscode.TextDocument): SourceText {
  return {
    text: document.getText(),
    path: toPosix(document.uri.fsPath),
    version: document.version,
  };
}

/** Convert a pure range to an editor range. */
export function toEditorRange(range: AnalysisRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

/** Convert an editor range to a pure range. */
export function toAnalysisRange(range: vscode.Range): AnalysisRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/** Convert a compiler problem to an editor diagnostic. */
export function toEditorDiagnostic(problem: AnalysisProblem): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    toEditorRange(problem.range),
    problem.message,
    problem.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.code = problem.code;
  diagnostic.source = "xessa";
  return diagnostic;
}

/** Convert a definition/reference target to an editor location. */
export function toLocation(
  target: DefinitionTarget,
  document: vscode.TextDocument,
  currentFile: string,
): vscode.Location {
  const uri =
    normalizePath(target.file) === normalizePath(currentFile)
      ? document.uri
      : vscode.Uri.file(target.file);
  return new vscode.Location(uri, toEditorRange(target.range));
}

/** Map a suggestion kind to `vscode.CompletionItemKind`. */
export function toCompletionKind(kind: SuggestionKind): vscode.CompletionItemKind {
  switch (kind) {
    case "property":
      return vscode.CompletionItemKind.Property;
    case "value":
      return vscode.CompletionItemKind.Value;
    case "color":
      // Colour entries render as swatches in the suggest widget.
      return vscode.CompletionItemKind.Color;
    case "alias":
      return vscode.CompletionItemKind.EnumMember;
    case "directive":
      return vscode.CompletionItemKind.Keyword;
    case "token":
      return vscode.CompletionItemKind.Variable;
    case "runtime-token":
      return vscode.CompletionItemKind.Constant;
    case "member":
      return vscode.CompletionItemKind.Field;
    case "group":
      return vscode.CompletionItemKind.Module;
    case "setup-key":
      return vscode.CompletionItemKind.Property;
    case "setup-value":
      return vscode.CompletionItemKind.Value;
    case "import-path":
      return vscode.CompletionItemKind.File;
    case "selector":
      return vscode.CompletionItemKind.Class;
    case "pseudo":
      return vscode.CompletionItemKind.Method;
    default:
      return vscode.CompletionItemKind.Text;
  }
}

/** Synchronous module reader for namespace-token completion and hover. */
export function readModuleSync(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Synchronous directory entries for project discovery. */
export function listDirectoryEntriesSync(directory: string): readonly DirectoryEntry[] {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    directory: entry.isDirectory(),
  }));
}

/** Synchronous directory names for import-path completion. */
export function listDirectorySync(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => entry.name);
}
