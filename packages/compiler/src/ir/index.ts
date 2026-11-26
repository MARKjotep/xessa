/**
 * Immutable CSS IR produced by lowering. The IR records ordered selectors,
 * declarations, at-rule stack, origin spans and condition keys.
 *
 * The IR sits between the parser AST and generation. It is a flat, frozen,
 * source-ordered view: declarations are already split per value segment, Xessa
 * conditions are resolved to a single media query, and native at-rule wrappers
 * are recorded as a stack. Selector flattening (A06), class naming (A09),
 * variable substitution (A08) and CSS text emission (A06) all happen later.
 */
export type {
  AtRuleContextIr,
  DeclarationIr,
  MediaConditionIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "./types.js";

export {
  atRuleContextIr,
  declarationIr,
  mediaConditionIr,
  nativeBlockIr,
  ruleIr,
  stylesheetIr,
} from "./factories.js";
