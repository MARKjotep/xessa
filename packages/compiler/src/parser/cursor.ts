import type { Span } from "../types/span.js";
import type { Token } from "../types/token.js";

/**
 * Cursor and raw-slice helpers over a `readonly Token[]` stream.
 *
 * The parser never receives the source text: every raw AST slice is rebuilt by
 * concatenating token values, which reproduces the authored source exactly
 * (the lexer keeps whitespace and comments, and a `function` token is followed
 * by its own `lparen`). Spans come from token offsets, so line and column stay
 * derivable by every consumer.
 */

/** True for tokens the grammar treats as insignificant between statements. */
export function isTrivia(token: Token): boolean {
  return token.kind === "whitespace" || token.kind === "comment";
}

/** True when a token is whitespace (comments are content for boundary trimming). */
export function isWhitespace(token: Token | undefined): boolean {
  return token !== undefined && token.kind === "whitespace";
}

/** True when a whitespace token carries a line break, so a new statement may start. */
export function startsNewLine(token: Token | undefined): boolean {
  return token !== undefined && token.kind === "whitespace" && token.value.includes("\n");
}

/** A zero-width `eof` token at the given source offset. */
export function eofToken(offset: number): Token {
  return { kind: "eof", value: "", start: offset, end: offset };
}

/** Token at an absolute stream index, or a synthetic `eof` when out of range. */
export function tokenAt(tokens: readonly Token[], index: number, eofOffset: number): Token {
  if (index < 0) return eofToken(eofOffset);
  return tokens[index] ?? eofToken(eofOffset);
}

/** Raw index of the next non-trivia token at or after `index`. */
export function skipTriviaAt(tokens: readonly Token[], index: number): number {
  let cursor = index;
  while (true) {
    const token = tokens[cursor];
    if (token === undefined || !isTrivia(token)) return cursor;
    cursor++;
  }
}

/** Exact source text of the raw range `[start, end)`. */
export function textOf(tokens: readonly Token[], start: number, end: number): string {
  let text = "";
  for (let i = start; i < end; i++) text += tokens[i]?.value ?? "";
  return text;
}

/** Narrow a raw range by dropping leading and trailing whitespace tokens. */
export function trimWhitespace(
  tokens: readonly Token[],
  start: number,
  end: number,
): { readonly start: number; readonly end: number } {
  let first = start;
  let last = end;
  while (first < last && tokens[first]?.kind === "whitespace") first++;
  while (last > first && tokens[last - 1]?.kind === "whitespace") last--;
  return { start: first, end: last };
}

/** Index of the last non-whitespace token in `[start, end)`, or `start - 1` when empty. */
export function lastContentIndex(tokens: readonly Token[], start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    const token = tokens[i];
    if (token !== undefined && token.kind !== "whitespace") return i;
  }
  return start - 1;
}

/** Span of the raw range `[start, end)`; zero-width at end of stream when empty. */
export function spanOf(tokens: readonly Token[], file: string, start: number, end: number): Span {
  const first = tokens[start];
  const last = tokens[end - 1];
  if (first === undefined || last === undefined) {
    const offset = tokens[tokens.length - 1]?.end ?? 0;
    return { start: offset, end: offset, file };
  }
  return { start: first.start, end: last.end, file };
}

/** Mutable read position over an immutable token stream. */
export class TokenCursor {
  readonly tokens: readonly Token[];
  readonly file: string;
  /** End-of-input offset from the trailing `eof` token, or the last token end. */
  readonly endOffset: number;
  index = 0;

  constructor(tokens: readonly Token[], file: string) {
    this.tokens = tokens;
    this.file = file;
    const last = tokens[tokens.length - 1];
    this.endOffset = last === undefined ? 0 : last.kind === "eof" ? last.start : last.end;
  }

  /** Current raw token, never `undefined`. */
  current(): Token {
    return tokenAt(this.tokens, this.index, this.endOffset);
  }

  /** Synthetic end-of-input token at the stream offset. */
  eof(): Token {
    return eofToken(this.endOffset);
  }

  /** Advance past whitespace and comment tokens. */
  skipTrivia(): void {
    this.index = skipTriviaAt(this.tokens, this.index);
  }

  /** Consume one raw token; the synthetic `eof` is never consumed. */
  advance(): Token {
    const token = this.current();
    if (token.kind !== "eof") this.index++;
    return token;
  }

  span(token: Token): Span {
    return { start: token.start, end: token.end, file: this.file };
  }

  spanOfRange(start: number, end: number): Span {
    return spanOf(this.tokens, this.file, start, end);
  }

  text(start: number, end: number): string {
    return textOf(this.tokens, start, end);
  }
}
