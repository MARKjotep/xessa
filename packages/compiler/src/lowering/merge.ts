/**
 * Opt-in merge grouping (ADR-0024; SPECIFICATION.md §5.3).
 *
 * `safe` grouping only joins *adjacent* identical runs. `merge` keeps that pass
 * and then, for conditional runs only, moves a declaration run into a later run
 * with the **same selector chain, condition string and native at-rule context**
 * when every declaration of every run strictly between them belongs to a
 * property family disjoint from every declaration of the moved run.
 *
 * Why this cannot change a cascade winner:
 *
 * - A winner is decided per property. If the two families are disjoint, no
 *   crossed declaration can compete for the moved declaration's property.
 * - The moved run lands *before* the destination run's own declarations, so the
 *   relative order of the source and destination is preserved; selector
 *   specificity, condition overlap, `@layer` order and `!important` are
 *   unchanged by moving a declaration past a different property.
 * - Native blocks are barriers: children of one block are merged among
 *   themselves, never across the block boundary, so native context identity is
 *   preserved.
 *
 * Wildcards (`all`, or a value containing `var(`) are never moved and nothing
 * crosses them (see `property-families.ts`). A missed merge is acceptable; a
 * changed cascade is not.
 */

import { nativeBlockIr, ruleIr, stylesheetIr } from "../ir/factories.js";
import type {
  DeclarationIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
import { propertyFamily } from "./property-families.js";
import { sameAncestors, sameContext } from "./spans.js";

/** One run's family set, or `null` when it contains a wildcard declaration. */
function runFamilies(declarations: readonly DeclarationIr[]): ReadonlySet<string> | null {
  const families = new Set<string>();
  for (const declaration of declarations) {
    const family = propertyFamily(declaration.property, declaration.value);
    if (family === null) return null;
    families.add(family);
  }
  return families;
}

/** Whether two family sets share any property family. */
function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const family of left) {
    if (right.has(family)) return true;
  }
  return false;
}

/** Whether a run may participate in a merge as a destination. */
function isConditionalRun(rule: RuleIr): boolean {
  return rule.condition !== null && rule.condition.query !== "";
}

/** Identical selector chain, condition string and native context. */
function sameMergeRun(source: RuleIr, destination: RuleIr): boolean {
  return (
    source.selector === destination.selector &&
    sameAncestors(source.ancestors, destination.ancestors) &&
    sameContext(source.context, destination.context) &&
    source.condition !== null &&
    destination.condition !== null &&
    source.condition.query === destination.condition.query
  );
}

/** Move the source declarations into the destination block, source first. */
function mergeInto(source: RuleIr, destination: RuleIr): RuleIr {
  return ruleIr({
    selector: destination.selector,
    ancestors: destination.ancestors,
    declarations: [...source.declarations, ...destination.declarations],
    condition: destination.condition,
    context: destination.context,
    span: destination.span,
  });
}

/**
 * Merge non-adjacent conditional runs in one sibling list to a fixpoint.
 *
 * Greedy and deterministic: the lowest source index wins, then the lowest valid
 * destination index. Every merge removes one node, so the loop terminates.
 */
function mergeSiblingRuns(nodes: readonly NativeBlockChild[]): readonly NativeBlockChild[] {
  const result = [...nodes];
  let merged = true;
  while (merged) {
    merged = false;
    for (let sourceIndex = 0; sourceIndex < result.length && !merged; sourceIndex += 1) {
      const source = result[sourceIndex];
      if (source === undefined || !("declarations" in source) || !isConditionalRun(source)) {
        continue;
      }
      const sourceFamilies = runFamilies(source.declarations);
      if (sourceFamilies === null) continue;

      for (
        let destinationIndex = sourceIndex + 1;
        destinationIndex < result.length;
        destinationIndex += 1
      ) {
        const candidate = result[destinationIndex];
        if (candidate === undefined) break;
        if (!("declarations" in candidate)) {
          // A native block or descriptor declaration is a hard barrier: no
          // later sibling can be reached without changing native context.
          break;
        }
        if (
          isConditionalRun(candidate) &&
          sameMergeRun(source, candidate) &&
          runFamilies(candidate.declarations) !== null
        ) {
          result[destinationIndex] = mergeInto(source, candidate);
          result.splice(sourceIndex, 1);
          merged = true;
          break;
        }
        // The candidate is an intervening run. A wildcard or a shared family
        // blocks this source (and every later destination).
        const crossed = runFamilies(candidate.declarations);
        if (crossed === null || intersects(crossed, sourceFamilies)) break;
      }
    }
  }
  return result;
}

/** Recurse into native blocks, then merge each sibling list independently. */
function mergeChildren(children: readonly NativeBlockChild[]): readonly NativeBlockChild[] {
  const rebuilt: NativeBlockChild[] = children.map((child) => {
    if (!("children" in child)) return child;
    if (child.statement === true) return child;
    return nativeBlockIr({
      name: child.name,
      prelude: child.prelude,
      children: mergeChildren(child.children),
      span: child.span,
    });
  });
  return mergeSiblingRuns(rebuilt);
}

/**
 * Apply merge grouping to an already safe-grouped stylesheet.
 *
 * The public `groupRuns(ir, "merge")` entry point runs the safe adjacent pass
 * first, so `merge` is always a superset of `safe`. This function only adds the
 * cross-run pass and never merges unconditional runs.
 */
export function mergeRuns(ir: StylesheetIr): StylesheetIr {
  // Top-level stylesheets hold only rules and native blocks; the child helper's
  // wider `NativeBlockChild` type exists for descriptor at-rules.
  return stylesheetIr(mergeChildren(ir.rules) as readonly (RuleIr | NativeBlockIr)[]);
}
