/**
 * AST lowerer: parsed Xessa AST to immutable CSS IR.
 *
 * Pure, zero-dependency and deterministic. `lower` expands inline variants in
 * authored order, resolves media aliases (built-ins < project < file,
 * ADR-0006), combines aliases with logical AND and keeps native at-rules as a
 * context stack. `groupRuns` is the separate safe-grouping utility; the
 * pipeline runs it after class rewriting (P4/A09). `expandGroupUseSites` is the
 * `@group.<name>` pre-pass (ADR-0017): it splices use sites into declaration
 * runs per module before `lower`, so defaults keep their defining module's
 * spans and token scope.
 *
 * Not owned here: CSS text emission and nesting flattening (A06), variable
 * substitution (A08), class naming and prefixing (P4/A09), `@runtime` emission
 * (P3/A08). No file in this module reads the filesystem or mutates the AST.
 */
export { lower } from "./lower.js";
export { groupRuns } from "./group.js";
export { mergeRuns } from "./merge.js";
export { isWildcardDeclaration, propertyFamily } from "./property-families.js";
export { expandGroupUseSites } from "./expand-groups.js";
export type { GroupExpansionOptions, GroupExpansionResult } from "./expand-groups.js";

export {
  BUILTIN_MEDIA_ALIASES,
  buildMediaAliasTable,
  resolveMediaCondition,
} from "./media.js";
export type {
  ConditionAlias,
  ConditionResolution,
  MediaAliasTable,
} from "./media.js";

export type {
  AtRuleContextIr,
  DeclarationIr,
  MediaConditionIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
