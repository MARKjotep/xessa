/**
 * Structural scanning of authored selector text.
 *
 * Selectors are raw source slices (ADR-0005), so every consumer that wants to
 * split, rewrite or measure them must understand strings, comments, escapes,
 * functional pseudos and attribute selectors. This module is the single
 * scanner used by selector flattening and specificity estimation: it never
 * rewrites text, never throws and reports a reason instead of failing.
 */

/** Result of scanning one selector (or selector list) slice. */
export interface SelectorScan {
  /** `false` when the text is structurally malformed; every array is then empty. */
  readonly ok: boolean;
  /** Human-readable rejection reason; empty when {@link ok} is `true`. */
  readonly reason: string;
  /** Offsets of unescaped `&` characters outside strings, comments and attribute selectors. */
  readonly ampersands: readonly number[];
  /** Offsets of top-level commas (selector-list separators). */
  readonly commas: readonly number[];
  /** `true` when the trimmed text starts with `>`, `+`, `~` or `||`. */
  readonly leadingCombinator: boolean;
  /** `true` when a top-level combinator separates compounds (`a b`, `a > b`). */
  readonly hasTopLevelCombinator: boolean;
  /** `true` when a `::` sequence occurs outside strings and comments. */
  readonly hasPseudoElement: boolean;
}

function failure(reason: string): SelectorScan {
  return {
    ok: false,
    reason,
    ampersands: [],
    commas: [],
    leadingCombinator: false,
    hasTopLevelCombinator: false,
    hasPseudoElement: false,
  };
}

/** Legacy single-colon pseudo-elements, which `:is(...)` cannot contain either. */
const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

/** Read a plain name without decoding escapes (pseudo-element names are plain). */
function readPlainName(text: string, start: number): string {
  let index = start;
  while (index < text.length) {
    const character = text.charAt(index);
    if (!/[A-Za-z0-9_-]/.test(character)) break;
    index += 1;
  }
  return text.slice(start, index).toLowerCase();
}

/** True for CSS whitespace characters (selector whitespace is only these). */
export function isWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f"
  );
}

/** True when `text` (already trimmed) begins with an explicit combinator. */
function startsWithCombinator(text: string): boolean {
  const first = text.charAt(0);
  if (first === ">" || first === "+" || first === "~") return true;
  return first === "|" && text.charAt(1) === "|";
}

/**
 * Scan selector text for structural validity, ampersands and top-level commas.
 *
 * A backslash escapes the following character (CSS escapes are never decoded),
 * quoted strings and comments stay opaque, attribute selectors are opaque to
 * `&` search, and parentheses are balanced but do not hide ampersands because
 * `&` may legally appear inside functional pseudos such as `:is(&)`.
 */
export function scanSelector(text: string): SelectorScan {
  const ampersands: number[] = [];
  const commas: number[] = [];
  const closers: Array<")" | "]"> = [];
  let quote: '"' | "'" | null = null;
  let inComment = false;
  let escaped = false;
  let hasTopLevelCombinator = false;
  let hasPseudoElement = false;

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
        return failure(`unbalanced "${character}"`);
      }
      continue;
    }

    if (character === ":" && text.charAt(index + 1) === ":") {
      hasPseudoElement = true;
    }

    const insideAttribute = closers.length > 0 && closers[closers.length - 1] === "]";
    if (character === ":" && !insideAttribute && text.charAt(index + 1) !== ":") {
      if (LEGACY_PSEUDO_ELEMENTS.has(readPlainName(text, index + 1))) {
        hasPseudoElement = true;
      }
    }
    if (character === "&" && !insideAttribute) {
      ampersands.push(index);
    }

    if (closers.length === 0) {
      if (character === ",") {
        commas.push(index);
      } else if (
        character === ">" ||
        character === "+" ||
        character === "~" ||
        (character === "|" && text.charAt(index + 1) === "|") ||
        isWhitespace(character)
      ) {
        hasTopLevelCombinator = true;
      }
    }
  }

  if (quote !== null) return failure("unterminated string");
  if (inComment) return failure("unterminated comment");
  if (escaped) return failure("trailing escape");
  if (closers.length > 0) {
    return failure(`unbalanced "${closers[closers.length - 1] ?? ")"}"`);
  }

  return {
    ok: true,
    reason: "",
    ampersands,
    commas,
    leadingCombinator: startsWithCombinator(text.trimStart()),
    hasTopLevelCombinator,
    hasPseudoElement,
  };
}

/** Result of splitting a selector list at top-level commas. */
export type SelectorListSplit =
  | { readonly ok: true; readonly items: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Split authored selector text at top-level commas and trim each item.
 *
 * Commas inside strings, comments, attribute selectors and functional pseudos
 * are ignored. Empty items are rejected because the emitter cannot produce a
 * valid selector list from them.
 */
export function splitSelectorList(text: string): SelectorListSplit {
  const scan = scanSelector(text);
  if (!scan.ok) return { ok: false, reason: scan.reason };

  const items: string[] = [];
  let start = 0;
  for (const comma of scan.commas) {
    items.push(text.slice(start, comma).trim());
    start = comma + 1;
  }
  items.push(text.slice(start).trim());

  if (items.some((item) => item.length === 0)) {
    return { ok: false, reason: "empty selector list item" };
  }
  return { ok: true, items };
}
