import { readCssIdentifier } from "./table.js";

/**
 * Class-token scanning of a flattened selector (SPECIFICATION.md §7.1, §7.2).
 *
 * The A06 selector module exposes structural scanning but not class ranges, so
 * this module mirrors the same state machine — quoted strings, comments,
 * backslash escapes and attribute selectors stay opaque — and adds exactly two
 * observations:
 *
 * - `.` followed by a CSS identifier is a class token; the name is escape-decoded
 *   (`.foo\.bar` → `foo.bar`, `.\31 23` → `123`);
 * - a `:global(...)` function around class tokens is recorded so the wrapper can
 *   be removed and its classes kept literal.
 *
 * Policy boundary (documented per the task): every class token is renamed
 * **except** tokens inside `:global(...)` and inside strings, comments or
 * attribute values. Class tokens inside functional pseudos such as `:is(.a)` or
 * `:not(.a)` are real class selectors in the same selector and therefore are
 * renamed; pseudo names, pseudo-element names, ids, type selectors and
 * attribute text are never touched.
 */

/** One class token in a flattened selector. */
export interface ScannedClass {
  /** Offset of the leading dot. */
  readonly start: number;
  /** Exclusive end offset after the identifier. */
  readonly end: number;
  /** Exact source slice, dot included. */
  readonly raw: string;
  /** Decoded class name. */
  readonly name: string;
  /** `true` when the token is inside a `:global(...)` function. */
  readonly global: boolean;
}

/** One `:global(...)` wrapper, kept as two removable ranges. */
export interface GlobalEscape {
  /** Offset of the leading `:`. */
  readonly start: number;
  /** Exclusive end of `:global(`, where the inner content starts. */
  readonly openEnd: number;
  /** Offset of the closing `)`. */
  readonly closeStart: number;
  /** Exclusive end after the closing `)`. */
  readonly end: number;
}

/** Result of scanning one flattened selector. */
export type SelectorClassScan =
  | {
      readonly ok: true;
      /** Class tokens in source order, globals included. */
      readonly classes: readonly ScannedClass[];
      /** `:global(...)` wrappers in source order. */
      readonly globals: readonly GlobalEscape[];
    }
  | { readonly ok: false; readonly reason: string };

/** Top of the opener stack, or `""` when no bracket/paren is open. */
function top(stack: readonly string[]): string {
  return stack[stack.length - 1] ?? "";
}

/** Find the `)` matching the `(` at `open`, honouring strings and comments. */
function findClosingParen(text: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let inComment = false;
  let escaped = false;

  for (let index = open; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (inComment) {
      if (character === "*" && text.charAt(index + 1) === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "/" && text.charAt(index + 1) === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** True when `:global(` starts at `index` (ASCII case-insensitive). */
function isGlobalFunction(text: string, index: number): boolean {
  return text.slice(index, index + 8).toLowerCase() === ":global(";
}

/**
 * Scan one flattened selector for class tokens and `:global(...)` wrappers.
 *
 * Pure and deterministic. Structural failures (unbalanced brackets, an
 * unterminated string or comment, a trailing escape) return `ok: false` with a
 * reason; callers then leave the selector untouched so the emitter reports the
 * same XESSA1001 it already reports for malformed selectors.
 */
export function scanSelectorClasses(text: string): SelectorClassScan {
  const classes: ScannedClass[] = [];
  const globals: GlobalEscape[] = [];
  const closers: string[] = [];
  let quote: '"' | "'" | null = null;
  let inComment = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);

    if (inComment) {
      if (character === "*" && text.charAt(index + 1) === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "/" && text.charAt(index + 1) === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      closers.push(")");
      continue;
    }
    if (character === "[") {
      closers.push("]");
      continue;
    }
    if (character === ")" || character === "]") {
      if (closers.pop() !== character) {
        return { ok: false, reason: `unbalanced "${character}"` };
      }
      continue;
    }

    if (top(closers) === "]") continue;

    if (character === ":" && isGlobalFunction(text, index)) {
      const closeStart = findClosingParen(text, index + 7);
      if (closeStart !== -1) {
        globals.push({ start: index, openEnd: index + 8, closeStart, end: closeStart + 1 });
      }
      continue;
    }

    if (character === ".") {
      const identifier = readCssIdentifier(text, index + 1);
      if (identifier !== null) {
        classes.push({
          start: index,
          end: identifier.end,
          raw: text.slice(index, identifier.end),
          name: identifier.name,
          global: false,
        });
        index = identifier.end - 1;
      }
    }
  }

  if (quote !== null) return { ok: false, reason: "unterminated string" };
  if (inComment) return { ok: false, reason: "unterminated comment" };
  if (escaped) return { ok: false, reason: "trailing escape" };
  if (closers.length > 0) {
    return { ok: false, reason: `unbalanced "${top(closers)}"` };
  }

  const marked = classes.map((token) => ({
    ...token,
    global: globals.some((range) => token.start >= range.openEnd && token.end <= range.closeStart),
  }));

  return { ok: true, classes: Object.freeze(marked), globals: Object.freeze(globals) };
}

/** One text replacement over `[start, end)`. */
export interface SelectorEdit {
  /** Inclusive start offset. */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  /** Replacement text; empty removes the range. */
  readonly text: string;
}

/**
 * Apply non-overlapping selector edits in ascending offset order.
 *
 * Edits are sorted defensively so callers cannot depend on insertion order.
 */
export function applySelectorEdits(text: string, edits: readonly SelectorEdit[]): string {
  if (edits.length === 0) return text;
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  let output = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) continue;
    output += text.slice(cursor, edit.start);
    output += edit.text;
    cursor = edit.end;
  }
  return output + text.slice(cursor);
}
