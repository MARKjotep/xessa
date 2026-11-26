import { mediaConditionIr } from "../ir/factories.js";
import type { MediaConditionIr } from "../ir/types.js";
import type { Stylesheet } from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";

/**
 * Media alias resolution (SPECIFICATION.md §4, ADR-0006).
 *
 * Definitions merge **by key** across three layers: built-in defaults, then
 * project configuration (`options.media`), then file-level `@media-types` in
 * document order. A later definition of the same key replaces the earlier one;
 * distinct keys accumulate. Definitions are validated when a condition is
 * resolved, not when the table is built, so an unused invalid definition never
 * produces a diagnostic.
 */

/** Built-in alias table of SPECIFICATION.md §4.1. Frozen; never mutated. */
export const BUILTIN_MEDIA_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  smd: "(min-width: 624px)",
  sm: "(min-width: 640px)",
  md: "(min-width: 768px)",
  lg: "(min-width: 1024px)",
  xl: "(min-width: 1280px)",
  "2xl": "(min-width: 1536px)",
  dark: "(prefers-color-scheme: dark)",
  light: "(prefers-color-scheme: light)",
  portrait: "(orientation: portrait)",
  landscape: "(orientation: landscape)",
  screen: "screen",
  print: "print",
  reduced: "(prefers-reduced-motion: reduce)",
  // `no_hover` and `mobile` intentionally share the coarse-pointer condition.
  no_hover: "(pointer: coarse)",
  mobile: "(pointer: coarse)",
});

/** The merged alias table used to resolve one stylesheet's conditions. */
export interface MediaAliasTable {
  /** Alias name to raw media-query definition; later layers already applied. */
  readonly definitions: ReadonlyMap<string, string>;
}

/**
 * Build the merged alias table for one stylesheet.
 *
 * Order is fixed by ADR-0006: built-ins, then `project` (`options.media`), then
 * every top-level `@media-types` block in document order. Only top-level blocks
 * are considered because the grammar restricts `@media-types` to the file
 * level. The AST is not mutated.
 */
export function buildMediaAliasTable(
  ast: Stylesheet,
  project?: Readonly<Record<string, string>>,
): MediaAliasTable {
  const definitions = new Map<string, string>(Object.entries(BUILTIN_MEDIA_ALIASES));
  if (project !== undefined) {
    for (const [alias, definition] of Object.entries(project)) definitions.set(alias, definition);
  }
  for (const item of ast.items) {
    if (item.kind !== "media-types") continue;
    for (const alias of item.aliases) definitions.set(alias.name, alias.media);
  }
  return Object.freeze({ definitions });
}

/** One alias reference with the exact source range it was authored at. */
export interface ConditionAlias {
  /** Alias name without the `@` sigil. */
  readonly alias: string;
  /** Exact span of the authored alias text, used for diagnostics. */
  readonly span: Span;
}

/** Resolution outcome: a single query plus its keys, or one blocking diagnostic. */
export type ConditionResolution =
  | {
      readonly ok: true;
      readonly condition: MediaConditionIr;
      /** Deduplicated alias references in authored order (first occurrence wins). */
      readonly aliases: readonly ConditionAlias[];
    }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** Media types recognised at the start of a definition (CSS Media Queries). */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "all",
  "aural",
  "braille",
  "embossed",
  "handheld",
  "print",
  "projection",
  "screen",
  "speech",
  "tty",
  "tv",
]);

interface ExpressionScan {
  readonly balanced: boolean;
  readonly comma: boolean;
  readonly words: readonly string[];
}

/**
 * Scan a media-query definition at top level only.
 *
 * Words and commas inside parentheses, brackets and quoted strings are ignored
 * so `(min-width: 640px)` and `url("a,b")` never look like a list or a bare
 * media type.
 */
function scanExpression(text: string): ExpressionScan {
  let depth = 0;
  let balanced = true;
  let comma = false;
  let quote: string | null = null;
  const words: string[] = [];
  let word = "";

  const flushWord = (): void => {
    if (word !== "") {
      words.push(word);
      word = "";
    }
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (quote !== null) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      flushWord();
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      flushWord();
      depth++;
      continue;
    }
    if (character === ")" || character === "]") {
      flushWord();
      depth--;
      if (depth < 0) balanced = false;
      continue;
    }
    if (depth === 0) {
      if (character === ",") {
        comma = true;
        flushWord();
        continue;
      }
      if (/[A-Za-z0-9-]/.test(character)) {
        word += character;
        continue;
      }
    }
    flushWord();
  }
  flushWord();

  if (quote !== null || depth !== 0) balanced = false;
  return { balanced, comma, words };
}

type ExpressionClass =
  | { readonly ok: true; readonly kind: "feature" | "type" | "modifier"; readonly hasOr: boolean }
  | { readonly ok: false; readonly reason: string };

/** Classify one alias definition and reject what cannot form valid CSS. */
function classifyExpression(text: string): ExpressionClass {
  const scan = scanExpression(text);
  if (!scan.balanced) return { ok: false, reason: "unbalanced parentheses" };
  if (scan.comma) {
    return { ok: false, reason: "comma-separated media query lists are not supported" };
  }
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "the definition is empty" };
  if (/(^|\s)(and|or|not|only)$/i.test(trimmed)) {
    return { ok: false, reason: "the definition ends with a combinator" };
  }

  const hasOr = scan.words.some((word) => word.toLowerCase() === "or");
  if (trimmed.startsWith("(")) return { ok: true, kind: "feature", hasOr };

  const leading = /^([A-Za-z][A-Za-z0-9-]*)/.exec(trimmed);
  if (leading === null) return { ok: false, reason: "a media type or condition is required" };
  const word = (leading[1] as string).toLowerCase();
  const rest = trimmed.slice(leading[0].length);

  if (word === "and" || word === "or") {
    return { ok: false, reason: "a media type or condition is required" };
  }
  if (word === "not" || word === "only") {
    if (rest.trim() === "") return { ok: false, reason: "a media type or condition is required" };
    if (word === "only" && rest.trimStart().startsWith("(")) {
      return { ok: false, reason: "`only` requires a media type" };
    }
    return { ok: true, kind: "modifier", hasOr };
  }
  if (MEDIA_TYPES.has(word)) return { ok: true, kind: "type", hasOr };
  return { ok: false, reason: `\`${word}\` is not a supported media type` };
}

interface ResolvedPart {
  readonly alias: string;
  readonly text: string;
  readonly kind: "feature" | "type" | "modifier";
  readonly hasOr: boolean;
}

function fail(message: string, span: Span): ConditionResolution {
  return { ok: false, diagnostic: error("XESSA3001", message, span) };
}

/**
 * Resolve an ordered alias list into one normalized media query.
 *
 * The list usually combines inherited conditional-block aliases with an inline
 * variant's aliases. Duplicate alias names are normalized (first appearance
 * wins, §4.3); unknown aliases and definitions that cannot form a valid single
 * expression are rejected with XESSA3001 and no condition, so the caller omits
 * the affected declaration or block. Combination is logical AND only: a media
 * type is emitted first, `not`/`only` queries and queries containing `or`
 * cannot be combined, and two media types are incompatible.
 *
 * `wholeSpan` covers the authored modifier chain for combination diagnostics;
 * per-alias diagnostics use the exact {@link ConditionAlias.span}.
 */
export function resolveMediaCondition(
  entries: readonly ConditionAlias[],
  table: MediaAliasTable,
  wholeSpan: Span,
): ConditionResolution {
  const seen = new Set<string>();
  const aliases: ConditionAlias[] = [];
  const parts: ResolvedPart[] = [];

  for (const entry of entries) {
    if (seen.has(entry.alias)) continue;
    seen.add(entry.alias);
    const definition = table.definitions.get(entry.alias);
    if (definition === undefined) {
      return fail(
        `Unknown media alias "@${entry.alias}". Define it in @media-types or in the project "media" configuration.`,
        entry.span,
      );
    }
    const text = definition.trim();
    const classified = classifyExpression(text);
    if (!classified.ok) {
      return fail(
        `Media alias "@${entry.alias}" cannot form a valid single media query: ${classified.reason}.`,
        entry.span,
      );
    }
    aliases.push(entry);
    parts.push({ alias: entry.alias, text, kind: classified.kind, hasOr: classified.hasOr });
  }

  if (parts.length === 0) {
    return fail("A media condition requires at least one alias.", wholeSpan);
  }

  if (parts.length === 1) {
    const only = parts[0] as ResolvedPart;
    return {
      ok: true,
      condition: mediaConditionIr(only.text, [only.alias]),
      aliases,
    };
  }

  const combined = parts.map((part) => `@${part.alias}`).join("+");
  if (parts.some((part) => part.kind === "modifier")) {
    return fail(
      `Media aliases "${combined}" cannot be combined: a \`not\`/\`only\` query cannot be joined with \`and\`.`,
      wholeSpan,
    );
  }
  if (parts.some((part) => part.hasOr)) {
    return fail(
      `Media aliases "${combined}" cannot be combined: a query containing \`or\` cannot be joined with \`and\`.`,
      wholeSpan,
    );
  }
  const types = parts.filter((part) => part.kind === "type");
  if (types.length > 1) {
    const names = types.map((part) => `${part.alias} (${part.text})`).join(", ");
    return fail(
      `Media aliases "${combined}" combine incompatible media types (${names}) and cannot form valid CSS.`,
      wholeSpan,
    );
  }

  // A media type must lead a media query; reordering components of a logical AND
  // is a query normalization, not a declaration reorder.
  const ordered =
    types.length === 1
      ? [types[0] as ResolvedPart, ...parts.filter((part) => part !== types[0])]
      : parts;

  return {
    ok: true,
    condition: mediaConditionIr(
      ordered.map((part) => part.text).join(" and "),
      parts.map((part) => part.alias),
    ),
    aliases,
  };
}
