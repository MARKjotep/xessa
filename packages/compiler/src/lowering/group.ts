import { nativeBlockIr, ruleIr, stylesheetIr } from "../ir/factories.js";
import type { NativeBlockChild, NativeBlockIr, RuleIr, StylesheetIr } from "../ir/types.js";
import type { MediaGroupingMode } from "../types/options.js";
import { mergeRuns } from "./merge.js";
import { sameAncestors, sameCondition, sameContext } from "./spans.js";

/**
 * Declaration-run grouping (SPECIFICATION.md §5.3, ADR-0024).
 *
 * Grouping is a pure post-pass over the IR: the pipeline runs it **after**
 * class rewriting (P4/A09), so selector equality is prefix-insensitive there and
 * two runs that will emit the same selector text are already equal.
 *
 * `safe` (the default) merges only **adjacent** runs with identical selector
 * text, identical ancestor chain, identical native at-rule context stack and
 * identical Xessa condition. It preserves declaration order and keeps the span
 * of the first run. Different conditions, different native wrappers and nested
 * rules therefore block a merge, so specificity, layers and scope never change
 * and computed styles are untouched (§5.3).
 *
 * `merge` (opt-in, ADR-0024) runs the same safe pass and then moves conditional
 * runs into later identical-selector identical-condition runs when every
 * crossed declaration has a property family disjoint from the moved run and no
 * wildcard (`all`, `var()`) is involved. See `merge.ts` for the cascade proof.
 *
 * Grouping never crosses a native block boundary: children of a native at-rule
 * are grouped among themselves, and adjacent native blocks stay separate. No
 * global "group at the bottom" pass is performed.
 *
 * `none` returns the IR exactly as authored (the same instance), for fixtures
 * and for comparing against the ungrouped lowering output.
 */
export function groupRuns(ir: StylesheetIr, mode: MediaGroupingMode = "safe"): StylesheetIr {
  if (mode === "none") return ir;
  const grouped = stylesheetIr(groupList(ir.rules));
  return mode === "merge" ? mergeRuns(grouped) : grouped;
}

function sameRun(left: RuleIr, right: RuleIr): boolean {
  return (
    left.selector === right.selector &&
    sameAncestors(left.ancestors, right.ancestors) &&
    sameCondition(left.condition, right.condition) &&
    sameContext(left.context, right.context)
  );
}

function mergeRules(left: RuleIr, right: RuleIr): RuleIr {
  return ruleIr({
    selector: left.selector,
    ancestors: left.ancestors,
    declarations: [...left.declarations, ...right.declarations],
    condition: left.condition,
    context: left.context,
    span: left.span,
  });
}

function groupList(
  nodes: readonly (RuleIr | NativeBlockIr)[],
): readonly (RuleIr | NativeBlockIr)[] {
  const grouped: (RuleIr | NativeBlockIr)[] = [];
  for (const node of nodes) {
    if ("declarations" in node) {
      const previous = grouped[grouped.length - 1];
      if (previous !== undefined && "declarations" in previous && sameRun(previous, node)) {
        grouped[grouped.length - 1] = mergeRules(previous, node);
      } else {
        grouped.push(node);
      }
      continue;
    }
    if (node.statement === true) {
      grouped.push(node);
      continue;
    }
    grouped.push(
      nativeBlockIr({
        name: node.name,
        prelude: node.prelude,
        children: groupChildren(node.children),
        span: node.span,
      }),
    );
  }
  return grouped;
}

function groupChildren(children: readonly NativeBlockChild[]): readonly NativeBlockChild[] {
  const grouped: NativeBlockChild[] = [];
  for (const child of children) {
    if ("children" in child) {
      if (child.statement === true) {
        grouped.push(child);
      } else {
        grouped.push(
          nativeBlockIr({
            name: child.name,
            prelude: child.prelude,
            children: groupChildren(child.children),
            span: child.span,
          }),
        );
      }
      continue;
    }
    if (!("declarations" in child)) {
      grouped.push(child);
      continue;
    }
    const previous = grouped[grouped.length - 1];
    if (previous !== undefined && "declarations" in previous && sameRun(previous, child)) {
      grouped[grouped.length - 1] = mergeRules(previous, child);
    } else {
      grouped.push(child);
    }
  }
  return grouped;
}
