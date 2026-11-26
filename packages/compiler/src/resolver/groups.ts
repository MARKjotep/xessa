/**
 * Reusable declaration group collection and visibility (ADR-0017).
 *
 * A `@group.<name>` definition is inert: it emits no CSS, and only a matching
 * use site splices its declarations into a rule. The resolver records the
 * definitions a module may use so the expansion pass can resolve a use site
 * with the consuming module's view. It never inspects use sites itself and
 * never expands, reorders or validates declarations.
 *
 * Visibility mirrors ADR-0015's keyframe rule and the `styles` closure of
 * ADR-0014, but for a different reason: the owner decision is that group
 * definitions travel with the CSS a build emits. A module sees its own
 * top-level definitions plus the definitions of every module reached through a
 * `styles` `@use` edge, transitively in authored order. Token-only imports
 * expose no groups.
 */

import type { Stylesheet } from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { GroupResolution, VisibleGroup } from "./types.js";

/**
 * Directive name reserved for groups (SPECIFICATION.md §3.6, ADR-0017 item 5).
 *
 * An `@use "…" as group` alias would compete with the built-in construct, so it
 * is rejected like an alias named `keyframes` (ADR-0015) and creates no
 * namespace.
 */
export const GROUP_DIRECTIVE = "group";

/**
 * Collect one module's top-level `@group.<name>` definitions in authored order.
 *
 * A duplicate name inside one module is XESSA2001 at the later definition and
 * is omitted, so the first definition wins — the same recovery the duplicate
 * local-variable rule uses (SPECIFICATION.md §6.1). The surviving list has at
 * most one definition per name.
 */
export function collectGroups(
  file: string,
  ast: Stylesheet,
  report: (diagnostic: Diagnostic) => void,
): VisibleGroup[] {
  const groups: VisibleGroup[] = [];
  const seen = new Set<string>();

  for (const item of ast.items) {
    if (item.kind !== "group-definition") continue;
    if (seen.has(item.name)) {
      report(
        error(
          "XESSA2001",
          `Duplicate group definition "@group.${item.name}" in "${file}".`,
          item.span,
        ),
      );
      continue;
    }
    seen.add(item.name);
    groups.push({ name: item.name, module: file, span: item.span, definition: item });
  }

  return groups;
}

/**
 * Per-module inputs for {@link visibleGroups}.
 *
 * Split from `ModuleRecord` for the same reason as keyframe collection: the
 * record stores the *computed* visibility, so building the closure must not
 * depend on it.
 */
export interface GroupSource {
  /** Top-level definitions authored in this module, first definition of a name wins. */
  readonly own: readonly VisibleGroup[];
  /** Canonical paths of `styles` `@use` targets, in authored order (ADR-0014). */
  readonly styleDependencies: readonly string[];
}

/**
 * Resolve every module's visible group names.
 *
 * The reachable set is the module's own definitions first, then each `styles`
 * dependency depth-first in authored order with that dependency's own merge
 * closure, deduplicated per defining module (diamonds contribute once). A name
 * the module defines itself stays in the reachable set of its importers but is
 * shadowed for the module itself, matching ADR-0017 item 5:
 *
 * - a local definition resolves the name — no diagnostic, imports are shadowed;
 * - exactly one imported definition resolves the name;
 * - two or more imported definitions with no local one are
 *   {@link GroupResolution} `ambiguous`; the resolver reports nothing here
 *   because the diagnostic belongs to the use site (plan G3).
 *
 * Modules are visited in sorted canonical-path order with a shared memo, so the
 * result is deterministic even when a cycle is present (cycles are already
 * XESSA2001 at the closing edge; a back edge contributes nothing).
 */
export function visibleGroups(
  sources: ReadonlyMap<string, GroupSource>,
): ReadonlyMap<string, ReadonlyMap<string, GroupResolution>> {
  const reachable = new Map<string, Map<string, VisibleGroup[]>>();
  const files = [...sources.keys()].sort(comparePaths);
  for (const file of files) collect(file, sources, reachable, new Set());

  const scopes = new Map<string, Map<string, GroupResolution>>();
  for (const file of files) {
    const visible = reachable.get(file);
    if (visible === undefined) continue;
    const scope = new Map<string, GroupResolution>();
    for (const [name, groups] of visible) {
      const first = groups[0];
      if (first === undefined) continue;
      // Own definitions are collected first, so `first.module === file` means
      // a local definition shadows every imported definition of that name.
      if (groups.length === 1 || first.module === file) {
        scope.set(name, { kind: "resolved", group: first });
        continue;
      }
      scope.set(name, { kind: "ambiguous", name, candidates: groups });
    }
    scopes.set(file, scope);
  }

  return scopes;
}

/**
 * Collect the definitions reachable from `file`, memoized per module.
 *
 * Arrays stored in the memo are never exposed mutably: each caller merges the
 * groups it receives into a fresh local list, so one module's closure cannot be
 * altered by its importers.
 */
function collect(
  file: string,
  sources: ReadonlyMap<string, GroupSource>,
  memo: Map<string, Map<string, VisibleGroup[]>>,
  visiting: Set<string>,
): Map<string, VisibleGroup[]> {
  const cached = memo.get(file);
  if (cached !== undefined) return cached;
  const source = sources.get(file);
  if (source === undefined) return new Map();

  // Post-error recovery: a back edge in a cycle contributes nothing, keeping the
  // walk terminating and deterministic (the cycle itself is already reported).
  if (visiting.has(file)) return new Map();
  visiting.add(file);

  const visible = new Map<string, VisibleGroup[]>();
  for (const group of source.own) {
    if (!visible.has(group.name)) visible.set(group.name, [group]);
  }
  for (const dependency of source.styleDependencies) {
    for (const [name, groups] of collect(dependency, sources, memo, visiting)) {
      const merged = visible.get(name) ?? [];
      for (const group of groups) {
        if (merged.some((existing) => existing.module === group.module)) continue;
        merged.push(group);
      }
      if (merged.length > 0) visible.set(name, merged);
    }
  }

  visiting.delete(file);
  memo.set(file, visible);
  return visible;
}

/** Locale-independent string comparison. */
function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
