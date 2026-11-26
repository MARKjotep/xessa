import { type TokenCursor, tokenAt } from "./cursor.js";
import { findSemicolonlessRuleStart } from "./value.js";

/** How a block statement resolves: a nested rule, a declaration, or neither. */
export type StatementKind = "rule" | "declaration" | "unknown";

/**
 * Balanced lookahead that distinguishes a nested rule from a declaration
 * (ADR-0002, SPECIFICATION.md §3.4).
 *
 * A `{` at top level before the statement terminator means the statement is a
 * rule; a `;` or the enclosing `}` first means it is a declaration. Colon
 * presence alone is never decisive, and strings, URLs, functions, parentheses
 * and brackets are already single tokens or tracked depth.
 *
 * One exception protects ADR-0011: when the statement opens as a declaration
 * and the `{` is preceded by a selector-start token (for example
 * `color: red` then `&:hover {`), the statement is a declaration that lost its
 * semicolon, not a rule whose selector swallowed the value. It classifies as a
 * declaration so the caller reports XESSA1002 and keeps the nested rule
 * (`findSemicolonlessRuleStart` owns the lookahead).
 */
export function classifyStatement(cursor: TokenCursor): StatementKind {
  const tokens = cursor.tokens;
  const closers: Array<"rparen" | "rbracket"> = [];
  let index = cursor.index;

  while (true) {
    const token = tokenAt(tokens, index, cursor.endOffset);
    if (token.kind === "eof") break;
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) return "unknown";
    } else if (closers.length === 0) {
      if (token.kind === "lbrace") {
        return findSemicolonlessRuleStart(tokens, cursor.index, index) === -1
          ? "rule"
          : "declaration";
      }
      if (token.kind === "semicolon" || token.kind === "rbrace") return "declaration";
    }
    index++;
  }

  return closers.length === 0 ? "declaration" : "unknown";
}
