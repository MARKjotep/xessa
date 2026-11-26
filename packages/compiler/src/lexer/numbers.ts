/**
 * Numeric token scanning.
 *
 * The frozen `number` JSDoc keeps a numeric token "as authored" (`12`, `0.5`,
 * `10px`), so a number, its dimension unit and a trailing `%` all stay in one
 * token with the unit text preserved. There is no separate percentage or
 * dimension kind.
 */

import { isDigitCode } from "./characters.js";
import { nameEnd } from "./names.js";

/**
 * Whether a numeric token can start at `index`: a digit, `.` followed by a
 * digit, or a sign followed by either.
 */
export function isNumberStartAt(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  if (isDigitCode(code)) return true;
  if (code === 0x2d || code === 0x2b) {
    const next = source.charCodeAt(index + 1);
    return isDigitCode(next) || (next === 0x2e && isDigitCode(source.charCodeAt(index + 2)));
  }
  return code === 0x2e && isDigitCode(source.charCodeAt(index + 1));
}

/**
 * End offset of the numeric token starting at `from`.
 *
 * Grammar: optional sign, integer and/or fraction, optional exponent, then a
 * `%` suffix or an identifier unit. A `%` wins over a unit, matching CSS
 * tokenization; anything that is not a name character ends the token.
 */
export function numberEnd(source: string, from: number): number {
  let index = from;
  const first = source.charCodeAt(index);
  if (first === 0x2d || first === 0x2b) index += 1;

  while (isDigitCode(source.charCodeAt(index))) index += 1;

  if (source.charCodeAt(index) === 0x2e && isDigitCode(source.charCodeAt(index + 1))) {
    index += 1;
    while (isDigitCode(source.charCodeAt(index))) index += 1;
  }

  const exponent = source.charCodeAt(index);
  if (exponent === 0x65 || exponent === 0x45) {
    let probe = index + 1;
    const sign = source.charCodeAt(probe);
    if (sign === 0x2d || sign === 0x2b) probe += 1;
    if (isDigitCode(source.charCodeAt(probe))) {
      index = probe;
      while (isDigitCode(source.charCodeAt(index))) index += 1;
    }
  }

  if (source.charCodeAt(index) === 0x25) return index + 1;
  return nameEnd(source, index);
}
