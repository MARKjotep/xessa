/**
 * Quoted string scanning.
 *
 * A string token covers the quote characters and every byte between them,
 * escapes included and never decoded, because `Token.value` is the authored
 * slice. `@`, `$`, `{`, `}` and `;` inside stay inert by construction: the
 * scanner never leaves the string until it closes.
 */

import { escapeEnd, isNewlineCode } from "./characters.js";

/** Result of scanning one quoted string: where it ends and whether it closed. */
export interface StringScan {
  /** Offset just past the closing quote, or where scanning stopped. */
  readonly end: number;
  /** False for an unterminated string (end of file or an unescaped line break). */
  readonly closed: boolean;
}

/**
 * Scan the string whose opening quote is at `start`.
 *
 * A backslash escapes the next character and a backslash before a line
 * terminator continues the string, as in CSS. An unescaped line terminator ends
 * the string as unterminated without consuming the break, so the caller can
 * resume at a safe boundary; end of file does the same.
 */
export function scanString(source: string, start: number): StringScan {
  const quote = source.charCodeAt(start);
  let index = start + 1;

  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === quote) return { end: index + 1, closed: true };
    if (isNewlineCode(code)) return { end: index, closed: false };

    if (code === 0x5c) {
      const next = source.charCodeAt(index + 1);
      if (isNewlineCode(next)) {
        index += next === 0x0d && source.charCodeAt(index + 2) === 0x0a ? 3 : 2;
        continue;
      }
      const escaped = escapeEnd(source, index);
      index = escaped > index ? escaped : index + 1;
      continue;
    }

    index += 1;
  }

  return { end: source.length, closed: false };
}
