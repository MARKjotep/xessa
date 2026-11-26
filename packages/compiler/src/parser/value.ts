import type { Modifier, Variant } from "../types/ast.js";
import type { Token } from "../types/token.js";
import { isWhitespace, skipTriviaAt, textOf, trimWhitespace } from "./cursor.js";
import { readModifier } from "./modifier.js";

/**
 * One value segment: the raw slice plus the ADR-0005 token sequence when a
 * `$` reference is present, and the ADR-0003 per-segment `!important` flag.
 */
export interface Segment {
  readonly value: string;
  readonly tokens?: readonly Token[];
  readonly important?: boolean;
}

/** Base segment plus inline variants, each variant independent for cascade purposes. */
export interface ValueParts {
  readonly base: Segment;
  readonly variants: readonly Variant[];
}

/** True when the raw range contains a `$name` / `$name.member` token. */
export function containsDollarRef(tokens: readonly Token[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (tokens[i]?.kind === "dollar-ref") return true;
  }
  return false;
}

/**
 * A token that can only begin a selector where a declaration value would have
 * ended, so no line break is needed to be sure (`&` is never value content).
 */
function isDefiniteSelectorStart(token: Token): boolean {
  return token.kind === "delim" && token.value === "&";
}

/**
 * A token that can begin a selector but also occur inside a value (`.`, `#`,
 * `[`, `>` and `*`), so it counts only at a line break.
 */
function isAmbiguousSelectorStart(token: Token): boolean {
  if (token.kind === "hash" || token.kind === "lbracket") return true;
  if (token.kind !== "delim") return false;
  return token.value === "." || token.value === ">" || token.value === "*";
}

/** Index of the last non-trivia token before `index`, or `-1`. */
function previousContentIndex(tokens: readonly Token[], index: number): number {
  let cursor = index - 1;
  while (cursor >= 0) {
    const token = tokens[cursor];
    if (token === undefined) return -1;
    if (token.kind !== "whitespace" && token.kind !== "comment") return cursor;
    cursor--;
  }
  return -1;
}

/** True when only whitespace or comments separate `index` from a line break. */
function hasLineBreakBefore(tokens: readonly Token[], index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0) {
    const token = tokens[cursor];
    if (token === undefined) return false;
    if (token.kind === "whitespace") {
      if (token.value.includes("\n")) return true;
      cursor--;
      continue;
    }
    if (token.kind === "comment") {
      cursor--;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Raw index where a nested rule's selector begins when a declaration lost its
 * terminating `;`, or `-1` when the statement is not that shape.
 *
 * This is the recovery side of ADR-0011: `color: red` immediately before
 * `&:hover { ... }` is an unterminated declaration, not one combined rule
 * selector (`color: red &:hover`). The statement must unambiguously open as a
 * declaration — an identifier, `:`, then a non-empty value — and the nested
 * rule must start at a selector-start token:
 *
 * - `&` is decisive on its own: it is never part of a CSS declaration value.
 * - `.`, `#`, `[`, `>` and `*` also occur in values, so they count only at a
 *   line break and never directly after a `,` (which continues a selector list
 *   such as `a:hover,\n.b { ... }`). Valid nested selectors written on one line
 *   — `div:hover .child { ... }`, `li:nth-child(2n) > a { ... }` — stay rules.
 *
 * The caller reports XESSA1002 for the declaration and resumes at the returned
 * index, so the nested rule is preserved.
 */
export function findSemicolonlessRuleStart(
  tokens: readonly Token[],
  statementStart: number,
  openIndex: number,
): number {
  const property = tokens[statementStart];
  if (property === undefined || property.kind !== "ident") return -1;

  const colonIndex = skipTriviaAt(tokens, statementStart + 1);
  if (colonIndex >= openIndex || tokens[colonIndex]?.kind !== "colon") return -1;

  const closers: Array<"rparen" | "rbracket"> = [];
  let index = colonIndex + 1;

  while (index < openIndex) {
    const token = tokens[index];
    if (token === undefined) return -1;

    if (token.kind === "lparen") {
      closers.push("rparen");
      index++;
      continue;
    }
    if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) return -1;
      index++;
      continue;
    }
    if (closers.length > 0) {
      if (token.kind === "lbracket") closers.push("rbracket");
      index++;
      continue;
    }

    const definite = isDefiniteSelectorStart(token);
    if (definite || isAmbiguousSelectorStart(token)) {
      const valueBounds = trimWhitespace(tokens, colonIndex + 1, index);
      if (valueBounds.start < valueBounds.end) {
        if (definite) return index;
        const previous = previousContentIndex(tokens, index);
        const continuesList = previous !== -1 && tokens[previous]?.kind === "comma";
        if (!continuesList && hasLineBreakBefore(tokens, index)) return index;
      }
    }

    if (token.kind === "lbracket") closers.push("rbracket");
    index++;
  }

  return -1;
}

/**
 * True when a segment ends with `!important` (whitespace tolerant, case
 * insensitive). The tokens stay ordinary CSS content of that segment.
 */
export function endsWithImportant(tokens: readonly Token[], start: number, end: number): boolean {
  let index = end - 1;
  while (index >= start && tokens[index]?.kind === "whitespace") index--;

  const word = tokens[index];
  if (word === undefined || word.kind !== "ident") return false;
  if (word.value.toLowerCase() !== "important") return false;

  index--;
  while (index >= start && tokens[index]?.kind === "whitespace") index--;

  const bang = tokens[index];
  return bang !== undefined && bang.kind === "delim" && bang.value === "!";
}

/** Build one trimmed segment from a raw token range. */
export function buildSegment(tokens: readonly Token[], start: number, end: number): Segment {
  const bounds = trimWhitespace(tokens, start, end);
  const valueTokens = containsDollarRef(tokens, bounds.start, bounds.end)
    ? Object.freeze(tokens.slice(bounds.start, bounds.end))
    : undefined;
  const important = endsWithImportant(tokens, bounds.start, bounds.end) || undefined;

  return Object.freeze({
    value: textOf(tokens, bounds.start, bounds.end),
    ...(valueTokens === undefined ? {} : { tokens: valueTokens }),
    ...(important === undefined ? {} : { important }),
  });
}

/**
 * Split a declaration value at modifiers at top-level depth.
 *
 * A modifier must be at value depth zero and, for a plain `at-keyword`, must be
 * preceded by whitespace: SPECIFICATION.md §3.1 keeps `12px@md` literal and an
 * `@` inside strings, comments, URLs and functions inert. The base segment keeps
 * its trailing `!important`, and each variant carries only its own flag
 * (ADR-0003). No error is raised for a missing base or empty variant value:
 * those are semantic checks owned by lowering.
 */
export function segmentValue(
  tokens: readonly Token[],
  start: number,
  end: number,
  file: string,
): ValueParts {
  const boundaries: Array<{
    readonly atIndex: number;
    readonly modifier: Modifier;
    readonly nextIndex: number;
  }> = [];

  let depth = 0;
  let index = start;
  while (index < end) {
    const token = tokens[index];
    if (token === undefined) break;

    if (token.kind === "lparen" || token.kind === "lbracket") {
      depth++;
      index++;
      continue;
    }
    if (token.kind === "rparen" || token.kind === "rbracket") {
      depth = Math.max(0, depth - 1);
      index++;
      continue;
    }

    if (depth === 0 && (token.kind === "at-keyword" || token.kind === "modifier")) {
      const separated =
        token.kind === "modifier" || index === start || isWhitespace(tokens[index - 1]);
      if (separated) {
        const read = readModifier(tokens, index, end, file);
        if (read !== undefined) {
          boundaries.push({
            atIndex: index,
            modifier: read.modifier,
            nextIndex: read.nextIndex,
          });
          index = read.nextIndex;
          continue;
        }
      }
    }
    index++;
  }

  const first = boundaries[0];
  const base = buildSegment(tokens, start, first?.atIndex ?? end);
  const variants: Variant[] = [];

  for (let position = 0; position < boundaries.length; position++) {
    const boundary = boundaries[position];
    if (boundary === undefined) continue;
    const next = boundaries[position + 1];
    const segment = buildSegment(tokens, boundary.nextIndex, next?.atIndex ?? end);

    variants.push(
      Object.freeze({
        aliases: boundary.modifier.aliases,
        span: boundary.modifier.span,
        value: segment.value,
        ...(segment.tokens === undefined ? {} : { tokens: segment.tokens }),
        ...(segment.important === undefined ? {} : { important: segment.important }),
      }),
    );
  }

  return { base, variants: Object.freeze(variants) };
}
