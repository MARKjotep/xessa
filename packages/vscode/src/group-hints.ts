/**
 * Cosmetic `@group.<name>` override hints (CSSX-GROUP-GHOST-HINTS).
 *
 * Within a use-site block, a declaration whose property is also a default of
 * the resolved group shadows that default. This module computes the ghost text
 * that names the shadowed value and the position it belongs at, without any
 * `vscode` import so the rules stay unit-testable.
 *
 * The hint is a description of authored text only:
 *
 * - it is computed for resolved use sites of the analysed document, never for
 *   unknown or ambiguous groups;
 * - the value is the group's last default for that property, verbatim (inline
 *   variants, `!important` and unresolved `$tokens` are not rewritten);
 * - only the first declaration of a property per use-site block is hinted;
 * - the range covers the declaration span and its terminating `;` when present
 *   (the editor API rejects empty decoration ranges), so the `after` attachment
 *   lands after the statement without inserting text or moving a column.
 */

import type { Stylesheet } from "../../compiler/src/index.js";
import type { GroupSymbol, GroupVisibility } from "./groups.js";
import { type Position, type Range, rangeAt } from "./positions.js";

/** How group override hints are displayed; matches the setting's enum. */
export type GroupHintMode = "always" | "inside" | "off";

/** Inputs needed to compute hints for one analysed document. */
export interface GroupHintSource {
  readonly text: string;
  readonly ast: Stylesheet;
  readonly lineStarts: readonly number[];
  /** Visible groups of this document, as `analysis.groups` provides them. */
  readonly groups: readonly GroupVisibility[];
}

/** One ghost-text hint for a use-site declaration that shadows a default. */
export interface GroupHint {
  /** Property name exactly as authored at the use site. */
  readonly property: string;
  /** Raw authored value of the group's last default for this property. */
  readonly value: string;
  /**
   * Declaration range, including a terminating `;` when one immediately
   * follows the value; the `after` attachment renders after the statement.
   */
  readonly range: Range;
  /** Whole `@group.<name> { … }` use-site block containing the declaration. */
  readonly site: Range;
}

/** Minimal structural view of the AST nodes this module walks. */
interface HintNode {
  readonly kind?: string;
  readonly name?: string;
  readonly span?: { readonly start: number; readonly end: number };
  readonly declarations?: readonly {
    readonly property: string;
    readonly span: { readonly start: number; readonly end: number };
  }[];
  readonly body?: readonly HintNode[];
  readonly block?: readonly HintNode[];
}

/**
 * Compute the ghost hints of one document in authored order.
 *
 * A use site contributes hints only when its name resolves to exactly one
 * visible definition. Properties that exist only at the use site are ignored,
 * and later duplicates of a hinted property inside the same block are skipped.
 */
export function groupHints(source: GroupHintSource): readonly GroupHint[] {
  const resolved = new Map<string, GroupSymbol>();
  for (const visibility of source.groups) {
    if (visibility.kind === "resolved") resolved.set(visibility.name, visibility.symbol);
  }

  const hints: GroupHint[] = [];
  visitUseSites(source.ast.items, (node) => {
    const symbol = resolved.get(node.name ?? "");
    if (symbol === undefined) return;

    // Cascade order: the last default declaration of a property wins.
    const defaults = new Map<string, string>();
    for (const entry of symbol.defaults) defaults.set(entry.property, entry.authored);

    const hinted = new Set<string>();
    for (const declaration of node.declarations ?? []) {
      if (hinted.has(declaration.property)) continue;
      const value = defaults.get(declaration.property);
      if (value === undefined) continue;
      hinted.add(declaration.property);
      hints.push({
        property: declaration.property,
        value,
        range: declarationRange(source.text, source.lineStarts, declaration.span),
        site: rangeAt(source.lineStarts, node.span?.start ?? 0, node.span?.end ?? 0),
      });
    }
  });
  return hints;
}

/**
 * Apply a mode to a document's hints.
 *
 * `always` keeps every hint, `inside` keeps only hints whose own use-site block
 * contains the cursor, and `off` keeps none (so a caller clears decorations).
 * A missing cursor behaves like "outside every block".
 */
export function filterGroupHints(
  hints: readonly GroupHint[],
  mode: GroupHintMode,
  cursor?: Position,
): readonly GroupHint[] {
  if (mode === "off") return [];
  if (mode === "always") return hints;
  if (cursor === undefined) return [];
  return hints.filter(
    (hint) =>
      comparePosition(cursor, hint.site.start) >= 0 && comparePosition(cursor, hint.site.end) <= 0,
  );
}

/** Normalize a raw configuration value to the setting's enum; unknown → `always`. */
export function groupHintMode(value: unknown): GroupHintMode {
  return value === "inside" || value === "off" ? value : "always";
}

/**
 * Theme token and attachment styling carried by every decoration instance.
 *
 * VS Code's per-instance `renderOptions` replace the type's generated
 * attachment CSS, so `contentText`, the theme colour, italics and the gap must
 * all be present on each instance for the ghost to stay dim, italic and
 * separated from the declaration.
 */
export const GROUP_HINT_ATTACHMENT = Object.freeze({
  color: "editorGhostText.foreground",
  fontStyle: "italic",
  fontWeight: "300",
  margin: "0 0 0 2em",
} as const);

/** Final decoration options for one ghost, with the colour resolved by the caller. */
export interface GroupHintDecoration<Color> {
  /** Declaration/terminator range carried from {@link GroupHint}. */
  readonly range: Range;
  readonly renderOptions: {
    readonly after: {
      readonly contentText: string;
      readonly color: Color;
      readonly fontStyle: (typeof GROUP_HINT_ATTACHMENT)["fontStyle"];
      readonly fontWeight: (typeof GROUP_HINT_ATTACHMENT)["fontWeight"];
      readonly margin: string;
    };
  };
}

/**
 * Build the exact per-instance decoration options for a document's hints.
 *
 * The mode filter runs first, so `off` produces an empty set (the provider
 * clears decorations) and `inside` only plans the block containing the cursor.
 */
export function planGroupHintDecorations<Color>(
  hints: readonly GroupHint[],
  mode: GroupHintMode,
  cursor: Position | undefined,
  themeColor: (id: string) => Color,
): readonly GroupHintDecoration<Color>[] {
  return filterGroupHints(hints, mode, cursor).map((hint) => ({
    range: hint.range,
    renderOptions: {
      after: {
        contentText: `// ${hint.value}`,
        color: themeColor(GROUP_HINT_ATTACHMENT.color),
        fontStyle: GROUP_HINT_ATTACHMENT.fontStyle,
        fontWeight: GROUP_HINT_ATTACHMENT.fontWeight,
        margin: GROUP_HINT_ATTACHMENT.margin,
      },
    },
  }));
}

function comparePosition(left: Position, right: Position): number {
  if (left.line !== right.line) return left.line - right.line;
  return left.character - right.character;
}

/**
 * Declaration span plus an immediately following `;` (after spaces/tabs only,
 * never across a newline), so the ghost renders after the statement.
 */
function declarationRange(
  text: string,
  lineStarts: readonly number[],
  span: { readonly start: number; readonly end: number },
): Range {
  // The parser can include the whitespace before a closing brace when the
  // declaration has no semicolon; trim it so the range ends at the value.
  let end = span.end;
  while (end > span.start && (text[end - 1] === " " || text[end - 1] === "\t")) end -= 1;
  let cursor = end;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  if (text[cursor] === ";") end = cursor + 1;
  return rangeAt(lineStarts, span.start, end);
}

/** Visit every use site inside rules, conditional blocks and native at-rules. */
function visitUseSites(items: readonly unknown[], visit: (node: HintNode) => void): void {
  for (const raw of items) {
    const node = raw as HintNode;
    if (node.kind === "group-use-site" && node.name !== undefined && node.span !== undefined) {
      visit(node);
      continue;
    }
    if (node.kind === "rule" || node.kind === "conditional-block") {
      if (node.body !== undefined) visitUseSites(node.body, visit);
      continue;
    }
    if (node.kind === "native-at-rule" && node.block !== undefined) {
      visitUseSites(node.block, visit);
    }
  }
}
