/**
 * Rule-bearing (`styles`) module ordering for merged builds (ADR-0014).
 *
 * A `@use "./card.cssx" styles;` edge contributes the target's stylesheet
 * rules to the importing build in addition to its tokens. The cascade order of
 * a merged build is native-`@import`-like: imported modules first (depth-first
 * in authored `@use` order), then the importing file's own rules.
 *
 * Everything here is a pure projection of {@link ModuleGraph}: no filesystem
 * access, no parsing and no mutation. Cycle edges are already reported as
 * XESSA2001 by the graph stage; this pass only makes sure the walk terminates
 * deterministically when a cycle exists.
 */

import type { ModuleGraph } from "./types.js";

/**
 * Canonical paths of every module whose rules merge into `entryFile`, in
 * emission order.
 *
 * Traversal is depth-first over `styleDependencies` in authored `@use` order and
 * the result is a post-order, so a module always appears after the modules it
 * style-imports. Each module appears exactly once (diamond imports merge once),
 * and `entryFile` itself is never included.
 *
 * Modules with no `styles` edge anywhere in their imports contribute nothing and
 * are absent. Modules participating in an import cycle stay in the order at
 * their first reachable position; the cycle is reported separately as XESSA2001
 * and the walk does not recurse back into a module already on the stack.
 *
 * @param graph Module graph produced by `buildModuleGraph`.
 * @param entryFile Canonical path of the entry whose build is being assembled.
 * @returns Emitted stylesheet module order (imported modules first).
 */
export function styleModuleOrder(graph: ModuleGraph, entryFile: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>([entryFile]);

  const visit = (file: string): void => {
    const record = graph.modules.get(file);
    if (record === undefined) return;
    for (const target of record.styleDependencies) {
      if (seen.has(target)) continue;
      // Mark before descending so a style-import cycle terminates here; the
      // graph stage has already reported it as XESSA2001.
      seen.add(target);
      visit(target);
      order.push(target);
    }
  };

  visit(entryFile);
  return order;
}
