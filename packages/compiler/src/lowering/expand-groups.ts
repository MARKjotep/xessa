import type { GroupResolution } from "../resolver/index.js";
import type {
  BlockItem,
  ConditionalBlock,
  ConditionalBlockItem,
  Declaration,
  GroupUseSite,
  NativeAtRule,
  Rule,
  Stylesheet,
  StylesheetItem,
} from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";

/**
 * `@group.<name>` use-site expansion (ADR-0017, SPECIFICATION.md §3.7).
 *
 * Expansion is a pure AST-to-AST pre-pass that runs **per module**, immediately
 * before that module's {@link lower} call and its own {@link substitute} pass.
 * Each use site is replaced in place by the group's defaults (definition order)
 * followed by the use-site block's declarations (authored order), so lowering
 * sees one ordinary declaration run at the authored position. Nothing is
 * filtered, reordered, deduplicated or rewritten: a use-site declaration that
 * repeats a default property stays later in the run and wins by the native
 * cascade (§5.2).
 *
 * **Token attribution.** The spliced default nodes are the defining module's own
 * {@link Declaration} objects, so they keep the defining module's spans and
 * `span.file`. Substitution derives the token scope from `span.file`
 * (`variables/substitute.ts`), which is exactly the ADR-0017 item 6 requirement:
 * a default's `$refs` resolve in the module that authored them and a
 * consumer-local token of the same name never leaks in. Copying the text without
 * its authored spans would silently rebind it to the consumer.
 *
 * A rejected use site omits **exactly** its whole block: the rest of the rule
 * continues, and a rule emptied by the omission is dropped by lowering like any
 * other declaration-free rule. Definitions themselves are never touched here
 * and emit no IR.
 *
 * Not to be confused with `./group.ts`, which is the unrelated safe
 * declaration-run grouping post-pass (`groupRuns`, §5.3).
 */

/** Inputs needed to expand one module's AST. */
export interface GroupExpansionOptions {
  /**
   * Canonical path of the module whose AST is being expanded, used in
   * diagnostics and as the consuming scope.
   */
  readonly module: string;
  /**
   * The consuming module's visible groups, as resolved by G2
   * (`ModuleRecord.groups`). `resolved` entries splice; `ambiguous` and absent
   * entries are XESSA2001 at the use site.
   */
  readonly groups: ReadonlyMap<string, GroupResolution>;
}

/** Result of {@link expandGroupUseSites}. */
export interface GroupExpansionResult {
  /** The expanded AST; the input instance when the module has no use sites. */
  readonly ast: Stylesheet;
  /** XESSA2001 diagnostics in authored order, one per rejected use site. */
  readonly diagnostics: readonly Diagnostic[];
}

/** `"a"`, `"a" and "b"`, or `"a", "b" and "c"` for an ambiguity message. */
function moduleList(candidates: readonly { readonly module: string }[]): string {
  const quoted = candidates.map((candidate) => `"${candidate.module}"`);
  const last = quoted[quoted.length - 1];
  if (last === undefined) return "";
  if (quoted.length === 1) return last;
  return `${quoted.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * Expand every `@group.<name>` use site of one module in place.
 *
 * Deterministic and side-effect free: the input AST is never mutated and a
 * module without use sites returns the same instance. Diagnostics are reported
 * in authored walk order.
 */
export function expandGroupUseSites(
  ast: Stylesheet,
  options: GroupExpansionOptions,
): GroupExpansionResult {
  const diagnostics: Diagnostic[] = [];

  const expandUseSite = (site: GroupUseSite): readonly Declaration[] | null => {
    const resolution = options.groups.get(site.name);
    if (resolution === undefined) {
      diagnostics.push(
        error(
          "XESSA2001",
          `Unknown group "@group.${site.name}" in "${options.module}"; define it in this module or import the module that defines it with @use "..." styles (ADR-0017).`,
          site.span,
        ),
      );
      return null;
    }
    if (resolution.kind === "ambiguous") {
      diagnostics.push(
        error(
          "XESSA2001",
          `Ambiguous group "@group.${site.name}" in "${options.module}": visible definitions in ${moduleList(resolution.candidates)}; define it locally or import only one defining module (ADR-0017).`,
          site.span,
        ),
      );
      return null;
    }
    // Defaults in definition order, then the use-site overrides in authored
    // order. Every node keeps its own authored module, span and tokens.
    return [...resolution.group.definition.declarations, ...site.declarations];
  };

  const expandBlock = (items: readonly BlockItem[]): readonly BlockItem[] => {
    const expanded: BlockItem[] = [];
    for (const item of items) {
      switch (item.kind) {
        case "group-use-site": {
          const spliced = expandUseSite(item);
          if (spliced !== null) expanded.push(...spliced);
          break;
        }
        case "rule":
          expanded.push(expandRule(item));
          break;
        case "conditional-block":
          expanded.push(expandConditional(item));
          break;
        case "native-at-rule":
          expanded.push(expandNative(item));
          break;
        case "declaration":
          expanded.push(item);
          break;
      }
    }
    if (
      expanded.length === items.length &&
      expanded.every((entry, index) => entry === items[index])
    ) {
      return items;
    }
    return expanded;
  };

  const expandConditional = (block: ConditionalBlock): ConditionalBlock => {
    // A conditional block cannot hold a use site (§3.7 v0.1), but its nested
    // rules and conditional blocks can contain one at any depth.
    const body: ConditionalBlockItem[] = [];
    for (const item of block.body) {
      switch (item.kind) {
        case "rule":
          body.push(expandRule(item));
          break;
        case "conditional-block":
          body.push(expandConditional(item));
          break;
        case "declaration":
          body.push(item);
          break;
      }
    }
    if (
      body.length === block.body.length &&
      body.every((entry, index) => entry === block.body[index])
    ) {
      return block;
    }
    return { ...block, body };
  };

  const expandRule = (rule: Rule): Rule => {
    const body = expandBlock(rule.body);
    return body === rule.body ? rule : { ...rule, body };
  };

  const expandNative = (atRule: NativeAtRule): NativeAtRule => {
    if (atRule.block === undefined) return atRule;
    const block = expandBlock(atRule.block);
    return block === atRule.block ? atRule : { ...atRule, block };
  };

  const items: StylesheetItem[] = [];
  for (const item of ast.items) {
    switch (item.kind) {
      case "rule":
        items.push(expandRule(item));
        break;
      case "native-at-rule":
        items.push(expandNative(item));
        break;
      default:
        // Definitions, `@setup`, `@use`, `@variables`, `@runtime` and
        // `@media-types` are inert for expansion.
        items.push(item);
        break;
    }
  }

  const unchanged =
    items.length === ast.items.length && items.every((entry, index) => entry === ast.items[index]);
  return { ast: unchanged ? ast : { ...ast, items }, diagnostics };
}
