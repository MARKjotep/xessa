/**
 * Pure semantic-token classification for the Xessa editor (CSSX-COLOR-TOKENS).
 *
 * The grammar can only see syntax: `$name` is a variable, `$ns.member` is a
 * namespace member, `--x` is a custom property. Which *kind* of variable a
 * reference points at (compile-time, runtime, keyframe) needs the analysis
 * layer, so this module maps every reference in one document to a span + legend
 * type. It never imports `vscode`, so `bun test` exercises the exact ranges and
 * legend the extension host renders.
 *
 * Rules:
 * - `<span>` compile-time reference → `variable`
 * - `<span>` runtime reference → `runtimeVariable`
 * - `<span>` `--custom-property` reference → `customProperty`
 * - `<span>` `$ns` prefix of a namespaced reference → `namespace`
 * - `<span>` resolved `$keyframes.<name>` member → `keyframe`
 * - a member whose symbol cannot be resolved keeps grammar styling (no span);
 *   the namespace prefix is still emitted, and a bare unknown `$name` emits
 *   nothing at all.
 *
 * Declaration sites are deliberately not emitted: v1 colours references, and a
 * declaration keeps its property-name styling (`--token: …`, `@variables { … }`).
 */

import type { AnalyzeResult, TokenSymbol } from "./analysis.js";
import { collectTokenReferences, forEachDeclaration } from "./analysis.js";
import { declarationSegments, tokenDeclarationSegment } from "./analysis.js";
import { KEYFRAMES_NAMESPACE } from "./keyframes.js";
import { positionAt } from "./positions.js";

/**
 * Legend token types, in legend-index order.
 *
 * The first two are VS Code standard types; `runtimeVariable`, `customProperty`
 * and `keyframe` are custom types declared by this extension. The provider
 * registers exactly this array. Semantic colours are not an extension
 * contribution point: users set them with
 * `editor.semanticTokenColorCustomizations` (the palette and snippet are
 * documented in `packages/vscode/README.md`), while `contributes.semanticTokenScopes`
 * maps each type to its grammar fallback scope.
 */
export const SEMANTIC_TOKEN_TYPES = Object.freeze([
  "variable",
  "namespace",
  "runtimeVariable",
  "customProperty",
  "keyframe",
] as const);

/** One legend token type. */
export type XessaSemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

/** No modifiers in v1 (declaration sites keep grammar styling). */
export const SEMANTIC_TOKEN_MODIFIERS = Object.freeze([] as const);

/** Legend index of one type; the provider encodes this number. */
const TYPE_INDEX: Readonly<Record<XessaSemanticTokenType, number>> = Object.freeze(
  Object.fromEntries(SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index])) as Record<
    XessaSemanticTokenType,
    number
  >,
);

/** One classified reference: UTF-16 offsets, legend type. */
export interface SemanticTokenSpan {
  readonly start: number;
  readonly length: number;
  readonly type: XessaSemanticTokenType;
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

function skipParentheses(text: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth <= 0) return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/** Whether `text` at `index` starts a `url(` token (case-insensitive). */
function isUrlStart(text: string, index: number): boolean {
  if (index > 0 && isIdentifierPart(text[index - 1])) return false;
  return text.slice(index, index + 4).toLowerCase() === "url(";
}

/**
 * `--custom-property` references in one value slice.
 *
 * Strings, comments, escapes and `url(...)` contents are skipped exactly like
 * {@link collectTokenReferences}, so `content: "--x"` never reports a reference.
 * A declaration's own left-hand side is not part of the value slice, so
 * `--brand: …` is never a reference here.
 */
export function customPropertyReferencesInSegment(
  text: string,
  absoluteStart: number,
): readonly { readonly start: number; readonly end: number }[] {
  const references: { start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close < 0 ? text.length : close + 2;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (isUrlStart(text, index)) {
      index = skipParentheses(text, index + 3);
      continue;
    }
    if (char === "-" && text[index + 1] === "-" && isIdentifierStart(text[index + 2])) {
      let end = index + 3;
      while (isIdentifierPart(text[end])) end += 1;
      references.push({ start: absoluteStart + index, end: absoluteStart + end });
      index = end;
      continue;
    }
    index += 1;
  }
  return references;
}

/** Every `--custom-property` reference in declarations and compile-time token values. */
function collectCustomPropertyReferences(
  text: string,
  analysis: AnalyzeResult,
): readonly { readonly start: number; readonly end: number }[] {
  const references: { start: number; end: number }[] = [];
  forEachDeclaration(analysis.ast, (declaration) => {
    for (const segment of declarationSegments(text, declaration)) {
      references.push(...customPropertyReferencesInSegment(segment.text, segment.start));
    }
  });
  for (const item of analysis.ast.items) {
    if (item.kind !== "variables") continue;
    for (const token of item.tokens) {
      const segment = tokenDeclarationSegment(text, token);
      if (segment === undefined) continue;
      references.push(...customPropertyReferencesInSegment(segment.text, segment.start));
    }
  }
  return references;
}

/** Legend type of a resolved token symbol. */
function typeOfSymbol(symbol: TokenSymbol): XessaSemanticTokenType {
  return symbol.kind === "compile" ? "variable" : "runtimeVariable";
}

/** Whether `name` resolves to a visible `@keyframes` definition. */
function isKnownKeyframe(analysis: AnalyzeResult, name: string): boolean {
  return analysis.keyframes.some((entry) => entry.kind === "resolved" && entry.name === name);
}

/**
 * Classify every reference in one analyzed document.
 *
 * Spans are sorted, non-overlapping and expressed as UTF-16 offsets into
 * `text`; they cover exactly the characters the editor colours. Unresolvable
 * references degrade to the grammar: a bare unknown `$name` contributes
 * nothing, and a namespaced reference contributes only its `$ns` prefix.
 */
export function semanticTokensFor(
  text: string,
  analysis: AnalyzeResult,
): readonly SemanticTokenSpan[] {
  const spans: SemanticTokenSpan[] = [];
  const localTokens = new Map<string, TokenSymbol>();
  for (const token of analysis.tokens) {
    if (token.namespace === undefined) localTokens.set(token.name, token);
  }

  for (const reference of collectTokenReferences(text, analysis.ast)) {
    if (reference.namespace === undefined) {
      const local = localTokens.get(reference.name);
      if (local === undefined) continue;
      spans.push({
        start: reference.start,
        length: reference.end - reference.start,
        type: typeOfSymbol(local),
      });
      continue;
    }

    // `$ns.member`: the prefix (sigil and alias) is a namespace reference in
    // every case, even when the member does not resolve.
    const prefixEnd = reference.start + 1 + reference.namespace.length;
    spans.push({
      start: reference.start,
      length: prefixEnd - reference.start,
      type: "namespace",
    });

    let memberType: XessaSemanticTokenType | undefined;
    if (reference.namespace === KEYFRAMES_NAMESPACE) {
      if (isKnownKeyframe(analysis, reference.name)) memberType = "keyframe";
    } else {
      const imported = analysis.imports.find((entry) => entry.alias === reference.namespace);
      const symbol = imported?.tokens.find((token) => token.name === reference.name);
      if (symbol !== undefined) memberType = typeOfSymbol(symbol);
    }
    if (memberType === undefined) continue;
    spans.push({
      start: prefixEnd + 1,
      length: reference.end - (prefixEnd + 1),
      type: memberType,
    });
  }

  for (const reference of collectCustomPropertyReferences(text, analysis)) {
    spans.push({
      start: reference.start,
      length: reference.end - reference.start,
      type: "customProperty",
    });
  }

  // One span per range: `collectTokenReferences` can see the same authored
  // reference only once, but a defensive dedupe keeps the encoder's contract
  // (sorted, non-overlapping, no duplicate tuples) explicit.
  const seen = new Set<string>();
  return spans
    .filter((span) => {
      const key = `${span.start}:${span.length}:${span.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return span.length > 0;
    })
    .sort((left, right) => left.start - right.start || right.length - left.length);
}

/**
 * Encode spans into the VS Code `SemanticTokens.data` layout.
 *
 * Five numbers per token: deltaLine, deltaStart (first token on a line uses the
 * absolute character), length, legend type index, modifier bitset. The caller
 * passes the same line starts the spans were classified against.
 */
export function encodeSemanticTokens(
  spans: readonly SemanticTokenSpan[],
  lineStarts: readonly number[],
): readonly number[] {
  const data: number[] = [];
  let lastLine = 0;
  let lastCharacter = 0;
  for (const span of spans) {
    const position = positionAt(lineStarts, span.start);
    const deltaLine = position.line - lastLine;
    const deltaCharacter =
      deltaLine === 0 ? position.character - lastCharacter : position.character;
    data.push(deltaLine, deltaCharacter, span.length, TYPE_INDEX[span.type], 0);
    lastLine = position.line;
    lastCharacter = position.character;
  }
  return data;
}
