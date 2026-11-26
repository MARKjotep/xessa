/**
 * `@xessa/compiler` module resolver (P3).
 *
 * Turns entry paths into a validated import graph and per-module token scopes.
 * The resolver is host-injected and pure: all reads, existence checks,
 * canonicalization and workspace-root policy come from
 * {@link ModuleHost}; nothing here imports `node:fs`, `node:path` or ambient
 * state.
 *
 * Variable substitution itself is A08: this stage only reports import, cycle
 * and scope-definition errors (XESSA2001) and records enough provenance for
 * substitution to resolve values in their defining module. Reusable declaration
 * groups (ADR-0017) are collected and resolved here as well: `ModuleRecord.groups`
 * carries the definitions a module may use, while use-site diagnostics and
 * expansion belong to the later expansion pass (plan G3).
 */

import type { CompileOptions, ModuleHost } from "../types/options.js";
import { resolveModuleGraph } from "./graph.js";
import type { ModuleGraph } from "./types.js";

export type {
  GroupResolution,
  ImportSymbolOrigin,
  KeyframeName,
  LocalSymbolOrigin,
  ModuleGraph,
  ModuleRecord,
  RuntimeProviders,
  ScopedNamespace,
  ScopedToken,
  ScopedTokenType,
  SymbolOrigin,
  TokenScope,
  VisibleGroup,
} from "./types.js";
export { KEYFRAMES_NAMESPACE } from "./keyframes.js";
export { styleModuleOrder } from "./rules.js";

/**
 * Build the validated module graph for `entries`.
 *
 * The function is asynchronous because every {@link ModuleHost} operation is
 * asynchronous; otherwise it is deterministic. It reads each canonical module
 * once, resolves every `@use` relative to its importer, enforces workspace
 * containment (ADR-0007), detects cycles, and returns:
 *
 * - `modules` — every loaded module keyed by canonical path, including cycle
 *   members so tooling can recover from errors;
 * - `order` — dependencies before importers, ties by canonical path, with
 *   cycle members excluded;
 * - `diagnostics` — parse diagnostics plus XESSA2001 resolver diagnostics,
 *   stably sorted.
 *
 * Undefined `$name` references are deliberately left to A08; scopes expose
 * locals, unqualified imports and namespaced members so substitution can
 * report them with full provenance.
 *
 * Rule-bearing imports (ADR-0014) are available through {@link styleModuleOrder},
 * which returns the merged-build emission order for a `styleDependencies` edge
 * set.
 */
export async function buildModuleGraph(
  entries: readonly string[],
  host: ModuleHost,
  options: CompileOptions,
): Promise<ModuleGraph> {
  return resolveModuleGraph(entries, host, options);
}
