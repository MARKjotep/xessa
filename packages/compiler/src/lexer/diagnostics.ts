/**
 * Lexical diagnostics.
 *
 * Every lexical failure uses the `XESSA1001` syntax anchor with `error`
 * severity, which the frozen registry defines as covering "a lexer-level
 * recovery". Spans cover the offending construct itself (the unterminated
 * string, comment or URL, or the single illegal character) so an editor can
 * point at its start and end. The tokenizer never throws: callers always
 * receive tokens plus these diagnostics.
 */

import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";

const LEXICAL_CODE = "XESSA1001" as const;

/** User-facing wording for each lexical failure the tokenizer can report. */
export const LEXICAL_MESSAGES = {
  unterminatedString:
    "Unterminated string literal; the closing quote is missing before the end of the line.",
  unterminatedComment: "Unterminated comment; the closing star-slash sequence is missing.",
  unterminatedUrl: "Unterminated url() construct; the closing parenthesis is missing.",
  malformedUrl:
    "Malformed url() construct; only whitespace and a closing parenthesis may follow a quoted path.",
  invalidEscape:
    "Invalid escape sequence; a backslash must be followed by a character other than a line break.",
} as const;

/** Build one error diagnostic with a span in `file`. */
export function lexicalError(
  message: string,
  start: number,
  end: number,
  file: string,
): Diagnostic {
  return error(LEXICAL_CODE, message, { start, end, file });
}

/** Message for an illegal control character, naming its code point. */
export function illegalCharacterMessage(code: number): string {
  return `Illegal control character U+${code.toString(16).toUpperCase().padStart(4, "0")} in source.`;
}
