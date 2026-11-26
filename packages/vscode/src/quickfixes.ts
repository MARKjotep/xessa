/**
 * Pure quick-fix decisions over analyzed editor problems.
 *
 * This module has no `vscode` import: the code action provider converts these
 * plain edits into `WorkspaceEdit`s, and `bun test` exercises the same logic.
 */

import type { AnalysisProblem, AnalyzeResult, Range } from "./analysis.js";
import { positionAt } from "./analysis.js";

/** One text edit produced by a quick fix. */
export interface QuickFixEdit {
  readonly range: Range;
  readonly newText: string;
}

/** One applicable quick fix, already resolved to concrete edits. */
export interface QuickFix {
  readonly title: string;
  readonly diagnosticCode: string;
  /** Problems this action resolves, for editor diagnostic association. */
  readonly diagnostics: readonly AnalysisProblem[];
  readonly edits: readonly QuickFixEdit[];
}

/** Compiler code for a Xessa declaration missing its semicolon (ADR-0011). */
export const MISSING_SEMICOLON_CODE = "XESSA1002";

/**
 * Quick fixes for `XESSA1002` (missing semicolon) problems on the selected
 * line(s).
 *
 * The parser reports the declaration span from its first property character to
 * the last value character, so the missing `;` belongs exactly at the reported
 * range end. One action is produced per insertion offset; problems that share
 * an offset are attached to the same action.
 */
export function missingSemicolonFixes(
  analysis: AnalyzeResult,
  selection: Range,
): readonly QuickFix[] {
  const firstLine = Math.min(selection.start.line, selection.end.line);
  const lastLine = Math.max(selection.start.line, selection.end.line);

  const byOffset = new Map<number, AnalysisProblem[]>();
  for (const problem of analysis.problems) {
    if (problem.code !== MISSING_SEMICOLON_CODE) continue;
    if (problem.file !== analysis.file) continue;
    if (lastLine < problem.range.start.line || firstLine > problem.range.end.line) continue;
    const offset = (analysis.lineStarts[problem.range.end.line] ?? 0) + problem.range.end.character;
    const shared = byOffset.get(offset);
    if (shared === undefined) byOffset.set(offset, [problem]);
    else shared.push(problem);
  }

  const fixes: QuickFix[] = [];
  for (const [offset, problems] of byOffset) {
    const insert = positionAt(analysis.lineStarts, offset);
    fixes.push({
      title: "Add semicolon",
      diagnosticCode: MISSING_SEMICOLON_CODE,
      diagnostics: problems,
      edits: [{ range: { start: insert, end: insert }, newText: ";" }],
    });
  }
  return fixes;
}
