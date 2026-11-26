import type { Span } from "../types/span.js";
import type {
  AtRuleContextIr,
  DeclarationIr,
  MediaConditionIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "./types.js";

/**
 * Frozen IR constructors.
 *
 * IR nodes are immutable by contract, so every factory freezes the node (and
 * its arrays) before returning. Factories preserve the exact field values they
 * receive; they never sort, deduplicate or normalize.
 */

/** Create a frozen {@link DeclarationIr}. */
export function declarationIr(
  property: string,
  value: string,
  span: Span,
  important?: boolean,
): DeclarationIr {
  return Object.freeze(
    important === undefined
      ? { property, value, span: Object.freeze(span) }
      : { property, value, important, span: Object.freeze(span) },
  );
}

/** Create a frozen {@link MediaConditionIr} from already-merged alias keys. */
export function mediaConditionIr(query: string, keys: readonly string[]): MediaConditionIr {
  return Object.freeze({ query, keys: Object.freeze([...keys]) });
}

/** Create a frozen {@link AtRuleContextIr}. */
export function atRuleContextIr(name: string, prelude: string, span: Span): AtRuleContextIr {
  return Object.freeze({ name, prelude, span: Object.freeze(span) });
}

/** Create a frozen {@link RuleIr}; `ancestors` and `context` are copied. */
export function ruleIr(fields: {
  readonly selector: string;
  readonly ancestors: readonly string[];
  readonly declarations: readonly DeclarationIr[];
  readonly condition: MediaConditionIr | null;
  readonly context: readonly AtRuleContextIr[];
  readonly span: Span;
}): RuleIr {
  return Object.freeze({
    selector: fields.selector,
    ancestors: Object.freeze([...fields.ancestors]),
    declarations: Object.freeze([...fields.declarations]),
    condition: fields.condition,
    context: Object.freeze([...fields.context]),
    span: Object.freeze(fields.span),
  });
}

/** Create a frozen {@link NativeBlockIr}; `children` is copied. */
export function nativeBlockIr(fields: {
  readonly name: string;
  readonly prelude: string;
  readonly statement?: boolean;
  readonly children: readonly NativeBlockChild[];
  readonly span: Span;
}): NativeBlockIr {
  const base = {
    name: fields.name,
    prelude: fields.prelude,
    children: Object.freeze([...fields.children]),
    span: Object.freeze(fields.span),
  };
  return Object.freeze(
    fields.statement === true ? { ...base, statement: true } : base,
  ) as NativeBlockIr;
}

/** Create a frozen {@link StylesheetIr}; `rules` is copied. */
export function stylesheetIr(rules: readonly (RuleIr | NativeBlockIr)[]): StylesheetIr {
  return Object.freeze({ rules: Object.freeze([...rules]) });
}
