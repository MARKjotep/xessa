import type { Token } from "../types/token.js";
import { type TokenCursor, tokenAt } from "./cursor.js";

/**
 * Statement-boundary recovery helpers (SPECIFICATION.md §12, ADR-0004).
 *
 * Recovery never throws and never rewinds: every helper returns an index at or
 * after its input so callers keep making progress.
 */

/** Move past the next `;`, stopping before a `}` that closes the enclosing block. */
export function recoverStatement(cursor: TokenCursor): void {
  const tokens = cursor.tokens;
  let index = cursor.index;
  while (true) {
    const token = tokenAt(tokens, index, cursor.endOffset);
    if (token.kind === "eof") {
      cursor.index = Math.min(index, tokens.length);
      return;
    }
    if (token.kind === "rbrace") {
      cursor.index = Math.min(index, tokens.length);
      return;
    }
    if (token.kind === "semicolon") {
      cursor.index = index + 1;
      return;
    }
    index++;
  }
}

/** Skip a brace-balanced block; `openIndex` must point at its `{`. */
export function skipBalancedBlock(
  tokens: readonly Token[],
  openIndex: number,
  eofOffset: number,
): number {
  let depth = 0;
  let index = openIndex;
  while (true) {
    const token = tokenAt(tokens, index, eofOffset);
    if (token.kind === "eof") return Math.min(index, tokens.length);
    if (token.kind === "lbrace") depth++;
    else if (token.kind === "rbrace") {
      depth--;
      if (depth <= 0) return index + 1;
    }
    index++;
  }
}

/**
 * Skip a whole statement, including a balanced block when it opens one.
 *
 * Used for recovery past a rejected nested rule or native at-rule. The closing
 * `}` of the enclosing block is never consumed, so the caller keeps its own
 * terminator.
 */
export function skipStatementBlock(
  tokens: readonly Token[],
  startIndex: number,
  eofOffset: number,
): number {
  let depth = 0;
  let index = startIndex;
  while (true) {
    const token = tokenAt(tokens, index, eofOffset);
    if (token.kind === "eof") return Math.min(index, tokens.length);
    if (token.kind === "lparen" || token.kind === "lbracket") depth++;
    else if (token.kind === "rparen" || token.kind === "rbracket") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (token.kind === "lbrace") return skipBalancedBlock(tokens, index, eofOffset);
      if (token.kind === "semicolon") return index + 1;
      if (token.kind === "rbrace") return index;
    }
    index++;
  }
}

/** Skip a whole native at-rule: prelude plus a balanced block or `;`. */
export function skipAtRule(
  tokens: readonly Token[],
  startIndex: number,
  eofOffset: number,
): number {
  return skipStatementBlock(tokens, startIndex + 1, eofOffset);
}
