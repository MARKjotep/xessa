/**
 * `url(...)` scanning.
 *
 * The frozen `url` JSDoc makes one token out of the whole construct, including
 * its parentheses, quotes and any `@` or `$` inside. That also means interior
 * brackets never contribute to parser depth: the parser only sees one token.
 * Both authored forms (`url("x@2x.png")` and `url(x@2x.png)`) are supported, as
 * is the empty `url()`.
 */

import { escapeEnd, isWhitespaceCode } from "./characters.js";
import { scanString } from "./strings.js";

/** Result of scanning one `url(...)` construct. */
export interface UrlScan {
  /** Offset just past the closing parenthesis, or where scanning stopped. */
  readonly end: number;
  /** `null` when the construct closed properly, else which rule it broke. */
  readonly problem: "unterminated" | "malformed" | null;
}

/** Whether the name at `[start, end)` is `url` in any ASCII casing. */
export function isUrlName(source: string, start: number, end: number): boolean {
  return end - start === 3 && source.slice(start, end).toLowerCase() === "url";
}

/**
 * Scan the construct whose opening parenthesis is at `parenIndex`.
 *
 * A quoted path is followed by optional whitespace and a required `)`; an
 * unquoted path ends at the first unescaped `)`, so `url(a\)b.png)` stays one
 * token. On failure the returned `end` is a resumable boundary: the caller
 * reports the diagnostic and continues lexing there.
 */
export function scanUrl(source: string, parenIndex: number): UrlScan {
  let probe = parenIndex + 1;
  while (isWhitespaceCode(source.charCodeAt(probe))) probe += 1;

  const quote = source.charCodeAt(probe);
  if (quote === 0x22 || quote === 0x27) {
    const literal = scanString(source, probe);
    if (!literal.closed) return { end: literal.end, problem: "unterminated" };

    let index = literal.end;
    while (isWhitespaceCode(source.charCodeAt(index))) index += 1;
    if (source.charCodeAt(index) === 0x29) return { end: index + 1, problem: null };
    return { end: index, problem: index >= source.length ? "unterminated" : "malformed" };
  }

  let index = parenIndex + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 0x29) return { end: index + 1, problem: null };
    if (code === 0x5c) {
      const escaped = escapeEnd(source, index);
      index = escaped > index ? escaped : index + 1;
      continue;
    }
    index += 1;
  }

  return { end: source.length, problem: "unterminated" };
}
