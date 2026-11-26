import type { AtRuleContextIr, MediaConditionIr } from "../ir/types.js";
import type { Declaration, Modifier } from "../types/ast.js";
import type { Span } from "../types/span.js";
import type { ConditionAlias } from "./media.js";

/**
 * Span and equality helpers shared by lowering and safe grouping.
 *
 * Everything here is a pure function of AST/IR data: no source text is read
 * back, so spans are derived only from offsets authored by the parser.
 */

function clamp(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

/** Origin of the base segment plus one origin per inline-variant segment. */
export interface SegmentSpans {
  /** Property through the first modifier (or the whole declaration). */
  readonly base: Span;
  /** One span per variant, in authored order. */
  readonly variants: readonly Span[];
}

/**
 * Partition a declaration's authored span into segment origins.
 *
 * A segment starts at its modifier and ends at the next modifier, so the
 * segments tile the declaration with no gaps or overlaps. The base segment ends
 * where the first modifier begins. The frozen AST stores no value span for a
 * variant (A04 contract note), so a variant origin necessarily covers its
 * modifier plus the value and separator whitespace that follow it.
 */
export function declarationSegmentSpans(declaration: Declaration): SegmentSpans {
  const file = declaration.span.file;
  const { start: declarationStart, end: declarationEnd } = declaration.span;
  if (declaration.variants.length === 0) {
    return { base: declaration.span, variants: Object.freeze([]) };
  }

  const variants: Span[] = [];
  for (let index = 0; index < declaration.variants.length; index++) {
    const variant = declaration.variants[index] as Declaration["variants"][number];
    const next = declaration.variants[index + 1];
    const start = clamp(variant.span.start, declarationStart, declarationEnd);
    const end = clamp(next === undefined ? declarationEnd : next.span.start, start, declarationEnd);
    variants.push(Object.freeze({ start, end, file }));
  }
  const baseEnd = clamp(
    (declaration.variants[0] as Declaration["variants"][number]).span.start,
    declarationStart,
    declarationEnd,
  );
  return {
    base: Object.freeze({ start: declarationStart, end: baseEnd, file }),
    variants: Object.freeze(variants),
  };
}

/**
 * Exact spans for the aliases of one modifier chain.
 *
 * `@` and `+` are single authored characters, so alias origins can be derived
 * by walking the modifier span in alias order. Escaped alias text keeps its
 * authored length, so the walk stays correct without decoding.
 */
export function modifierAliasSpans(modifier: Modifier): readonly ConditionAlias[] {
  const spans: ConditionAlias[] = [];
  const { start, end, file } = modifier.span;
  let cursor = start + 1;
  for (const alias of modifier.aliases) {
    const aliasStart = clamp(cursor, start, end);
    const aliasEnd = clamp(aliasStart + alias.length, aliasStart, end);
    spans.push({ alias, span: Object.freeze({ start: aliasStart, end: aliasEnd, file }) });
    cursor = aliasEnd + 1;
  }
  return spans;
}

/** Structural equality of two Xessa conditions, used to bound declaration runs. */
export function sameCondition(
  left: MediaConditionIr | null,
  right: MediaConditionIr | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.query !== right.query || left.keys.length !== right.keys.length) return false;
  for (let index = 0; index < left.keys.length; index++) {
    if (left.keys[index] !== right.keys[index]) return false;
  }
  return true;
}

/** Structural equality of two native at-rule context stacks. */
export function sameContext(
  left: readonly AtRuleContextIr[],
  right: readonly AtRuleContextIr[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] as AtRuleContextIr;
    const b = right[index] as AtRuleContextIr;
    if (a.name !== b.name || a.prelude !== b.prelude) return false;
    if (a.span.start !== b.span.start || a.span.end !== b.span.end) return false;
    if (a.span.file !== b.span.file) return false;
  }
  return true;
}

/** Structural equality of two ancestor selector chains. */
export function sameAncestors(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
