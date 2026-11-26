/**
 * Identifier and name scanning shared by idents, function names, dimension
 * units, hashes and `@`/`$` references.
 *
 * `nameEnd` consumes CSS name characters and valid escapes; `identEnd` only
 * starts a name where the identifier grammar allows one. Escapes stay exactly
 * as authored, matching the frozen `ident` JSDoc examples (`\31 23`,
 * `status\:active`).
 */

import { escapeEnd, isNameCode, isNameStartCode } from "./characters.js";

/**
 * Offset just past the run of name characters and valid escapes starting at
 * `from`, or `from` itself when nothing name-like starts there.
 */
export function nameEnd(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (isNameCode(source.charCodeAt(index))) {
      index += 1;
      continue;
    }
    const escaped = escapeEnd(source, index);
    if (escaped <= index) break;
    index = escaped;
  }
  return index;
}

/**
 * Whether a CSS identifier can start at `index`: a name-start character, a
 * hyphen followed by a name-start/hyphen/escape (`--label`, `-webkit-calc`), or
 * a valid escape.
 */
export function isIdentStartAt(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  if (isNameStartCode(code)) return true;
  if (code === 0x2d) {
    const next = source.charCodeAt(index + 1);
    return isNameStartCode(next) || next === 0x2d || escapeEnd(source, index + 1) > index + 1;
  }
  return escapeEnd(source, index) > index;
}

/** End offset of the identifier starting at `from`, or `from` when none starts. */
export function identEnd(source: string, from: number): number {
  return isIdentStartAt(source, from) ? nameEnd(source, from) : from;
}
