/**
 * Character classification shared by every lexer scanner.
 *
 * Helpers are pure and take either a UTF-16 code unit or an offset, so no two
 * scanners share a mutable cursor and the facade stays a plain loop. The
 * families follow CSS syntax (whitespace, digits, name characters, escapes)
 * without decoding anything: the frozen `Token` contract keeps authored text
 * verbatim, including escaped sequences.
 */

/** `\t`, `\n`, `\f`, `\r` and the space are CSS whitespace. */
export function isWhitespaceCode(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

/** Line terminators that end an unescaped quoted string. */
export function isNewlineCode(code: number): boolean {
  return code === 0x0a || code === 0x0c || code === 0x0d;
}

/** ASCII decimal digit (`0`–`9`). */
export function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** ASCII hexadecimal digit, used by numeric escapes such as `\31 `. */
export function isHexDigitCode(code: number): boolean {
  return isDigitCode(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/** First character of a CSS name: ASCII letter, `_` or any non-ASCII code unit. */
export function isNameStartCode(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code >= 0x80
  );
}

/** Any CSS name character: name-start, digit or hyphen. */
export function isNameCode(code: number): boolean {
  return isNameStartCode(code) || isDigitCode(code) || code === 0x2d;
}

/**
 * NUL and C0 control codes other than CSS whitespace are illegal in source.
 * The scanner reports each one once and keeps it as a `delim` token so the
 * stream still reproduces the input exactly.
 */
export function isIllegalCode(code: number): boolean {
  return code === 0x00 || (code < 0x20 && !isWhitespaceCode(code));
}

/**
 * End offset of the backslash escape that starts at `index`, or `index` when
 * the character there is not a valid escape (not a backslash, a trailing
 * backslash, or a backslash before a line terminator).
 *
 * A hex escape consumes at most six hex digits plus one optional whitespace
 * terminator, with CRLF counted as a single terminator, so `\31 23` remains one
 * name. Escapes are measured, never decoded.
 */
export function escapeEnd(source: string, index: number): number {
  if (source.charCodeAt(index) !== 0x5c) return index;
  const next = source.charCodeAt(index + 1);
  if (Number.isNaN(next) || isNewlineCode(next)) return index;
  if (!isHexDigitCode(next)) return index + 2;

  let probe = index + 1;
  let digits = 0;
  while (digits < 6 && isHexDigitCode(source.charCodeAt(probe))) {
    probe += 1;
    digits += 1;
  }

  const terminator = source.charCodeAt(probe);
  if (isWhitespaceCode(terminator)) {
    return terminator === 0x0d && source.charCodeAt(probe + 1) === 0x0a ? probe + 2 : probe + 1;
  }
  return probe;
}
