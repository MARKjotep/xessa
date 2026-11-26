import { isWhitespace, scanSelector, splitSelectorList } from "./scan.js";

/**
 * Selector specificity estimation used only to decide whether a parent
 * selector list may be expanded as a cross-product (`A, B` → `A x, B x`) or
 * must be substituted as `:is(A, B)` (SPECIFICATION.md §7.1).
 *
 * The estimator is deliberately conservative: any construct it does not model
 * returns `null`, and callers then fall back to `:is(...)`, which always
 * preserves native nesting semantics. It is not a public validator.
 */

/** CSS specificity triple, ordered from IDs to type selectors. */
export interface Specificity {
  /** Number of ID selectors. */
  readonly a: number;
  /** Number of class, attribute and pseudo-class selectors. */
  readonly b: number;
  /** Number of type and pseudo-element selectors. */
  readonly c: number;
}

/** Compare two specificity triples lexicographically. */
export function compareSpecificity(left: Specificity, right: Specificity): number {
  if (left.a !== right.a) return left.a - right.a;
  if (left.b !== right.b) return left.b - right.b;
  return left.c - right.c;
}

/** Add two specificity triples, used when combining a parent and a child. */
export function addSpecificity(
  left: Specificity | null,
  right: Specificity | null,
): Specificity | null {
  if (left === null || right === null) return null;
  return { a: left.a + right.a, b: left.b + right.b, c: left.c + right.c };
}

/** Largest specificity in a selector list, or `null` when any item is unknown. */
function maxSpecificityOfList(text: string): Specificity | null {
  const split = splitSelectorList(text);
  if (!split.ok) return null;
  let max: Specificity | null = null;
  for (const item of split.items) {
    const one = specificityOfItem(item);
    if (one === null) return null;
    if (max === null || compareSpecificity(one, max) > 0) max = one;
  }
  return max;
}

/** Read a CSS name (ident or hash/class name), honoring backslash escapes. */
function readName(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (/[A-Za-z0-9_-]/.test(character) || character.charCodeAt(0) >= 0x80) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

/**
 * Return the index just past the matching closer for the `(` or `[` at
 * `openIndex`, or `-1` when it is unbalanced.
 */
function skipBalanced(text: string, openIndex: number): number {
  const open = text.charAt(openIndex);
  if (open !== "(" && open !== "[") return -1;
  const closers: string[] = [open === "(" ? ")" : "]"];
  let quote: '"' | "'" | null = null;
  let inComment = false;
  let escaped = false;

  for (let index = openIndex + 1; index < text.length; index += 1) {
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
      if (closers.pop() !== character) return -1;
      if (closers.length === 0) return index + 1;
    }
  }
  return -1;
}

/** Pseudo-class names whose arguments are selectors, scored with `:is` semantics. */
const SELECTOR_ARGUMENT_PSEUDOS: ReadonlySet<string> = new Set([
  "is",
  "not",
  "has",
  "matches",
  "any",
  "global",
]);

/** Pseudo-class names whose arguments are An+B or other values, never selectors. */
const VALUE_ARGUMENT_PSEUDOS: ReadonlySet<string> = new Set(["lang", "dir", "state"]);

/** Legacy single-colon pseudo-elements counted in the type column. */
const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

/**
 * Specificity of one selector (not a list), or `null` when the text contains a
 * construct this estimator does not model.
 */
export function specificityOfItem(text: string): Specificity | null {
  const scan = scanSelector(text);
  if (!scan.ok || scan.commas.length > 0) return null;

  let a = 0;
  let b = 0;
  let c = 0;
  let index = 0;

  while (index < text.length) {
    const character = text.charAt(index);

    if (isWhitespace(character) || character === ">" || character === "+" || character === "~") {
      index += 1;
      continue;
    }
    if (character === "|" && text.charAt(index + 1) === "|") {
      index += 2;
      continue;
    }
    if (character === "," || character === "&") return null;
    if (character === "|") return null;

    if (character === "/" && text.charAt(index + 1) === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }

    if (character === "#") {
      const end = readName(text, index + 1);
      if (end === index + 1) return null;
      a += 1;
      index = end;
      continue;
    }

    if (character === ".") {
      const end = readName(text, index + 1);
      if (end === index + 1) return null;
      b += 1;
      index = end;
      continue;
    }

    if (character === "[") {
      const end = skipBalanced(text, index);
      if (end === -1) return null;
      b += 1;
      index = end;
      continue;
    }

    if (character === "*") {
      if (text.charAt(index + 1) === "|" && text.charAt(index + 2) !== "|") {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (character === ":") {
      const doubleColon = text.charAt(index + 1) === ":";
      const nameStart = index + (doubleColon ? 2 : 1);
      const nameEnd = readName(text, nameStart);
      if (nameEnd === nameStart) return null;
      const name = text.slice(nameStart, nameEnd).toLowerCase();
      const hasArguments = text.charAt(nameEnd) === "(";

      if (doubleColon) {
        c += 1;
        if (!hasArguments) {
          index = nameEnd;
          continue;
        }
        const end = skipBalanced(text, nameEnd);
        if (end === -1) return null;
        index = end;
        continue;
      }

      if (name === "where") {
        if (!hasArguments) {
          index = nameEnd;
          continue;
        }
        const end = skipBalanced(text, nameEnd);
        if (end === -1) return null;
        index = end;
        continue;
      }

      if (SELECTOR_ARGUMENT_PSEUDOS.has(name)) {
        if (!hasArguments) return null;
        const end = skipBalanced(text, nameEnd);
        if (end === -1) return null;
        const inner = text.slice(nameEnd + 1, end - 1);
        const max = maxSpecificityOfList(inner);
        if (max === null) return null;
        a += max.a;
        b += max.b;
        c += max.c;
        index = end;
        continue;
      }

      if (name === "host" || name === "host-context" || name === "slotted") return null;

      if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
        c += 1;
        index = nameEnd;
        continue;
      }

      if (name.startsWith("nth-")) {
        b += 1;
        if (!hasArguments) {
          index = nameEnd;
          continue;
        }
        const end = skipBalanced(text, nameEnd);
        if (end === -1) return null;
        const inner = text.slice(nameEnd + 1, end - 1);
        if (/\bof\b/i.test(inner)) return null;
        index = end;
        continue;
      }

      b += 1;
      if (!hasArguments) {
        index = nameEnd;
        continue;
      }
      if (!VALUE_ARGUMENT_PSEUDOS.has(name)) return null;
      const end = skipBalanced(text, nameEnd);
      if (end === -1) return null;
      index = end;
      continue;
    }

    if (character === "\\" || /[A-Za-z_-]/.test(character) || character.charCodeAt(0) >= 0x80) {
      const end = readName(text, index);
      if (end === index) return null;
      if (text.charAt(end) === "|" && text.charAt(end + 1) !== "|") {
        index = end + 1;
        continue;
      }
      c += 1;
      index = end;
      continue;
    }

    return null;
  }

  return { a, b, c };
}
