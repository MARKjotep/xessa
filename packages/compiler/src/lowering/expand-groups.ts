import type { GroupResolution, VisibleGroup } from "../resolver/index.js";
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
 * `@group.<name>` use-site expansion (ADR-0017, ADR-0025, SPECIFICATION.md §3.7).
 *
 * Expansion is a pure AST-to-AST pre-pass that runs **per module**, immediately
 * before that module's {@link lower} call and its own {@link substitute} pass.
 * Each use site is replaced in place by the group's effective declarations
 * followed by the use-site block's declarations (authored order), so lowering
 * sees one ordinary declaration run at the authored position. Nothing is
 * filtered, reordered, deduplicated or rewritten: a use-site declaration that
 * repeats a default property stays later in the run and wins by the native
 * cascade (§5.2).
 *
 * **Composition (ADR-0025).** A definition body is an ordered mix of
 * declarations and nested `@group.<name> { … }` composition statements. A
 * nested composition expands the base definition's effective declarations using
 * the *defining* module's group scope, then splices the nested block's
 * overrides, then continues in authored order. Diamonds expand textually on
 * every path and are never deduplicated. Cycles and an over-deep chain are
 * XESSA2001 at the nested composition statement that closes them, and only that
 * statement is omitted. Unknown and ambiguous nested targets reuse the existing
 * use-site messages. A definition that is never expanded is never diagnosed:
 * unused definitions stay inert.
 *
 * **Token attribution.** Every spliced declaration is the defining module's own
 * {@link Declaration} object, so it keeps the defining module's span and
 * `span.file` — including a base reached through several composition levels.
 * Substitution derives the token scope from `span.file`
 * (`variables/substitute.ts`), which is exactly the ADR-0017 item 6 requirement:
 * a default's `$refs` resolve in the module that authored them and a
 * consumer-local token of the same name never leaks in. Copying the text without
 * its authored spans would silently rebind it to the consumer.
 *
 * A rejected use site omits **exactly** its whole block: the rest of the rule
 * continues, and a rule emptied by the omission is dropped by lowering like any
 * other declaration-free rule. Definitions themselves are never mutated here
 * and emit no IR.
 *
 * Not to be confused with `./group.ts`, which is the unrelated safe
 * declaration-run grouping post-pass (`groupRuns`, §5.3).
 */

/** Maximum nested composition depth; deeper chains are XESSA2001 (ADR-0025). */
const MAX_COMPOSITION_DEPTH = 64;

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
  /**
   * Every loaded module's visible groups, keyed by canonical path. A nested
   * composition resolves in the **defining** module's scope, so this map is
   * required for correct cross-module composition. Optional for old callers:
   * without it nested composition falls back to {@link groups}, which preserves
   * the previous single-module behaviour.
   */
  readonly scopes?: ReadonlyMap<string, ReadonlyMap<string, GroupResolution>>;
}

/** Result of {@link expandGroupUseSites}. */
export interface GroupExpansionResult {
  /** The expanded AST; the input instance when the module has no use sites. */
  readonly ast: Stylesheet;
  /** XESSA2001 diagnostics in authored walk order, one per rejected construct. */
  readonly diagnostics: readonly Diagnostic[];
}

/** One group identity on the active composition path. */
interface CompositionFrame {
  readonly module: string;
  readonly name: string;
}

/** `"a"`, `"a" and "b"`, or `"a", "b" and "c"` for an ambiguity message. */
function moduleList(candidates: readonly { readonly module: string }[]): string {
  const quoted = candidates.map((candidate) => `"${candidate.module}"`);
  const last = quoted[quoted.length - 1];
  if (last === undefined) return "";
  if (quoted.length === 1) return last;
  return `${quoted.slice(0, -1).join(", ")} and ${last}`;
}

/** `@group.name` display form for a composition frame. */
function frameText(frame: CompositionFrame): string {
  return `@group.${frame.name}`;
}

/** The chain that closes a cycle, from the first repetition through the repeat. */
function cycleChain(stack: readonly CompositionFrame[], target: CompositionFrame): string {
  const index = stack.findIndex(
    (frame) => frame.module === target.module && frame.name === target.name,
  );
  const slice = index === -1 ? stack : stack.slice(index);
  return [...slice.map(frameText), frameText(target)].join(" -> ");
}

/**
 * Expand every `@group.<name>` use site of one module in place.
 *
 * Deterministic and side-effect free: the input AST is never mutated and a
 * module without use sites returns the same instance. Diagnostics are reported
 * in authored walk order and de-duplicated by span and message, so a shared base
 * expanded through several use sites does not repeat the same nested
 * diagnostic.
 */
export function expandGroupUseSites(
  ast: Stylesheet,
  options: GroupExpansionOptions,
): GroupExpansionResult {
  const diagnostics: Diagnostic[] = [];
  const seenDiagnostics = new Set<string>();

  const report = (diagnostic: Diagnostic): void => {
    const key = [
      diagnostic.code,
      diagnostic.span.file,
      diagnostic.span.start,
      diagnostic.span.end,
      diagnostic.message,
    ].join("\u0000");
    if (seenDiagnostics.has(key)) return;
    seenDiagnostics.add(key);
    diagnostics.push(diagnostic);
  };

  /**
   * The scope a nested composition resolves in. When the caller supplies the
   * per-module scopes this is exact; the fallback keeps old callers working for
   * same-module composition.
   */
  const scopeFor = (module: string): ReadonlyMap<string, GroupResolution> => {
    return options.scopes?.get(module) ?? options.groups;
  };

  /** Report a nested composition that cannot be resolved, then omit it. */
  const reportNested = (site: GroupUseSite, module: string): void => {
    const resolution = scopeFor(module).get(site.name);
    if (resolution === undefined) {
      report(
        error(
          "XESSA2001",
          `Unknown group "@group.${site.name}" in "${module}"; define it in this module or import the module that defines it with @use "..." styles (ADR-0017).`,
          site.span,
        ),
      );
      return;
    }
    if (resolution.kind === "ambiguous") {
      report(
        error(
          "XESSA2001",
          `Ambiguous group "@group.${site.name}" in "${module}": visible definitions in ${moduleList(resolution.candidates)}; define it locally or import only one defining module (ADR-0017).`,
          site.span,
        ),
      );
    }
  };

  /**
   * Effective declarations of one definition, in authored expansion order.
   *
   * `stack` already contains `group`; nested compositions check against it.
   * `depth` counts composition edges below the use site (0 for the definition
   * the use site names).
   */
  const expandDefinition = (
    group: VisibleGroup,
    depth: number,
    stack: readonly CompositionFrame[],
  ): readonly Declaration[] => {
    const expanded: Declaration[] = [];
    const definition = group.definition;

    for (const item of definition.body) {
      if (item.kind === "declaration") {
        expanded.push(item);
        continue;
      }

      const module = group.module;
      const resolution = scopeFor(module).get(item.name);
      if (resolution === undefined || resolution.kind === "ambiguous") {
        // Unknown or ambiguous: omit this composition statement, keep the rest.
        reportNested(item, module);
        continue;
      }

      const target = resolution.group;
      const nextDepth = depth + 1;
      if (stack.some((frame) => frame.module === target.module && frame.name === target.name)) {
        report(
          error(
            "XESSA2001",
            `Cyclic group composition ${cycleChain(stack, { module: target.module, name: target.name })} in "${module}"; a group cannot compose itself directly or transitively (ADR-0025).`,
            item.span,
          ),
        );
        continue;
      }
      if (nextDepth > MAX_COMPOSITION_DEPTH) {
        report(
          error(
            "XESSA2001",
            `Group composition depth limit of ${MAX_COMPOSITION_DEPTH} exceeded at "@group.${item.name}" in "${module}"; simplify the composition chain (ADR-0025).`,
            item.span,
          ),
        );
        continue;
      }

      expanded.push(...expandDefinition(target, nextDepth, [...stack, frameOf(target)]));
      // The composition block's overrides follow the base's effective lines.
      expanded.push(...item.declarations);
    }

    return expanded;
  };

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
    // The definition's own effective declarations (including composition),
    // then the use-site overrides in authored order. Every node keeps its own
    // authored module, span and tokens.
    const group = resolution.group;
    const defaults = expandDefinition(group, 0, [frameOf(group)]);
    return [...defaults, ...site.declarations];
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
    // A conditional block cannot hold a use site (§3.7), but its nested rules
    // and conditional blocks can contain one at any depth.
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

/** Identity frame of a resolved group. */
function frameOf(group: VisibleGroup): CompositionFrame {
  return { module: group.module, name: group.name };
}
