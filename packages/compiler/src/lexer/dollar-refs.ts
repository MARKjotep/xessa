/**
 * `$` reference scanning.
 *
 * The frozen `dollar-ref` JSDoc lists exactly two forms, `$name` and
 * `$name.member`, so at most one `.` member joins a reference. A malformed or
 * bare `$` stays a `delim` and the parser reports it; the lexer never guesses.
 */

import { isIdentStartAt, nameEnd } from "./names.js";

/**
 * End offset of the `dollar-ref` starting at `start`, or `null` when `$` is not
 * followed by a name.
 */
export function scanDollarRef(source: string, start: number): number | null {
  if (!isIdentStartAt(source, start + 1)) return null;

  let index = nameEnd(source, start + 1);
  if (source.charCodeAt(index) === 0x2e && isIdentStartAt(source, index + 1)) {
    index = nameEnd(source, index + 1);
  }
  return index;
}
