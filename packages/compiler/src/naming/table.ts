/**
 * CSS class-identifier primitives shared by the selector scanner and the naming
 * table (SPECIFICATION.md §7.2 "Validate CSS identifier compatibility").
 *
 * Everything here is pure and lossless: identifiers are decoded exactly once so
 * that the class map is keyed by the logical class name (`.foo\.bar` →
 * `foo.bar`), while the authored selector bytes stay available for unprefixed
 * output.
 */

/** A decoded CSS identifier plus the exclusive end offset in the source text. */
export interface CssIdentifier {
  /** Exclusive end offset of the identifier in the scanned text. */
  readonly end: number;
  /** Decoded identifier text, with CSS escapes resolved. */
  readonly name: string;
}

/** A decoded escape plus the exclusive end offset in the source text. */
export interface CssEscape {
  /** Decoded character (a replacement character for invalid code points). */
  readonly character: string;
  /** Exclusive end offset after the escape, including any terminating whitespace. */
  readonly end: number;
}

/**
 * True when `name` is a valid, unescaped CSS identifier.
 *
 * This is the strict MVP check of §7.2: it accepts ASCII letters, digits after
 * the start, `_`, `-` and non-ASCII code points, with the CSS start rule
 * (`--`, `-<start>` or `<start>`). Escapes are deliberately not accepted here:
 * a renamed class is emitted verbatim as a bare identifier, so a result that
 * would need escaping is rejected rather than silently rewritten into an
 * equivalent-looking but different map key.
 */
export function isValidCssIdentifier(name: string): boolean {
  return /^(?:--|-?[A-Za-z_\u0080-\uFFFF])[A-Za-z0-9_\-\u0080-\uFFFF]*$/.test(name);
}

/**
 * Decode one CSS escape starting at `index` (which must be a backslash).
 *
 * Handles 1–6 hex digits with the optional single terminating whitespace and a
 * non-hex escaped character. Returns `null` for a trailing backslash or an
 * escaped newline, which cannot start an identifier; callers then stop scanning
 * instead of inventing a name.
 */
export function decodeCssEscape(text: string, index: number): CssEscape | null {
  if (text.charAt(index) !== "\\") return null;
  const next = index + 1;
  if (next >= text.length) return null;

  const hex = /[0-9A-Fa-f]/.test(text.charAt(next));
  if (hex) {
    let cursor = next;
    let digits = "";
    while (cursor < text.length && digits.length < 6 && /[0-9A-Fa-f]/.test(text.charAt(cursor))) {
      digits += text.charAt(cursor);
      cursor += 1;
    }
    if (text.charAt(cursor) === "\r" && text.charAt(cursor + 1) === "\n") {
      cursor += 2;
    } else if (/[ \t\n\r\f]/.test(text.charAt(cursor))) {
      cursor += 1;
    }
    const codePoint = Number.parseInt(digits, 16);
    if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return { character: "\uFFFD", end: cursor };
    }
    return { character: String.fromCodePoint(codePoint), end: cursor };
  }

  const character = text.charAt(next);
  if (character === "\n" || character === "\r" || character === "\f") return null;
  return { character, end: next + 1 };
}

/**
 * Read a CSS identifier starting at `start`, decoding escapes.
 *
 * The caller supplies the position **after** a class dot. A digit-first name is
 * rejected (invalid CSS unless escaped), and a lone `-` is rejected. The end
 * offset is exclusive, so callers can splice the identifier out precisely.
 */
export function readCssIdentifier(text: string, start: number): CssIdentifier | null {
  let index = start;
  let name = "";
  let started = false;

  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "\\") {
      const escaped = decodeCssEscape(text, index);
      if (escaped === null) break;
      name += escaped.character;
      index = escaped.end;
      started = true;
      continue;
    }
    if (!started) {
      if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
        name += character;
        index += 1;
        started = true;
        continue;
      }
      if (character === "-") {
        name += character;
        index += 1;
        started = true;
        continue;
      }
      return null;
    }
    if (/[A-Za-z0-9_\-\u0080-\uFFFF]/.test(character)) {
      name += character;
      index += 1;
      continue;
    }
    break;
  }

  if (!started || name === "-") return null;
  return { end: index, name };
}

/**
 * Apply the MVP naming table to one decoded class name (ADR-0010).
 *
 * - `prefix` with a non-empty, valid prefix → `"<prefix>-<name>"`, but only
 *   when the result is itself a valid bare CSS identifier.
 * - `none`, an empty prefix, an invalid prefix or an invalid result → the name
 *   is unchanged, and the caller reports XESSA4001 for the invalid configuration
 *   or result (the documented fallback: the class stays unprefixed).
 *
 * Pure and deterministic; it never escapes names, which is why the result check
 * is strict.
 */
export function renameClassName(
  name: string,
  prefix: string,
  strategy: "none" | "prefix",
): { readonly emitted: string; readonly renamed: boolean } {
  if (strategy === "none" || prefix === "" || !isValidCssIdentifier(prefix)) {
    return { emitted: name, renamed: false };
  }
  const candidate = `${prefix}-${name}`;
  if (!isValidCssIdentifier(candidate)) {
    return { emitted: name, renamed: false };
  }
  return { emitted: candidate, renamed: true };
}
