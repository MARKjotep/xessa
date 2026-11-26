import { declarationIr, stylesheetIr } from "../ir/factories.js";
import type {
  DeclarationIr,
  MediaConditionIr,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
import { buildMediaAliasTable, resolveMediaCondition } from "../lowering/index.js";
import { declarationSegmentSpans, modifierAliasSpans } from "../lowering/spans.js";
import type { ModuleGraph, ScopedToken } from "../resolver/index.js";
import type { Declaration } from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";
import { astReferences, segmentValueTokens } from "./ast.js";
import { expandValue, resolveReference } from "./expand.js";
import type { ExpansionHooks, ValueOrigin } from "./expand.js";
import { effectivePrefix, runtimePropertyName } from "./naming.js";
import type { VariableNamingOptions } from "./naming.js";
import { mapIrDeclarations, rootRule } from "./walk.js";

/**
 * Runtime token emission (SPECIFICATION.md §6.2).
 *
 * `@runtime` declarations become native custom properties:
 *
 * ```css
 * :root { --ui-primary: #2563eb; }
 * @media (prefers-color-scheme: dark) { :root { --ui-primary: #60a5fa; } }
 * ```
 *
 * Naming rule: `--<prefix>-<name>`, or `--<name>` when the effective prefix is
 * empty (`naming.prefix` wins over `prefix`, matching §7.2). The prefix is
 * authored configuration and is never sanitized here (P4/A09 owns CSS identifier
 * validation).
 *
 * Emission ownership (§6.2): runtime tokens visible to the entry module — its
 * own `@runtime` declarations, unqualified imports and any namespaced member
 * referenced by the entry or by reachable token modules — are emitted in every
 * consuming entrypoint and deduplicated by custom-property name.
 *
 * A duplicated post-prefix property name is **not** an error (ADR-0016). Native
 * custom properties are live cascade values, so the definition that comes later
 * in merge order wins: style-imported modules in canonical DFS `@use` order
 * (dependencies before importers), then other reachable token modules in graph
 * topological order, and the entry last. That makes an entry's `@runtime`
 * definition override a style-imported module's same-named property, and a later
 * style module override an earlier one. The rule is deliberate and mirrors the
 * §5.4 "later wins is authored CSS" precedent; do not turn it back into an
 * error. Cross-entrypoint collision reporting is P5 project work.
 *
 * Inline variants on runtime tokens become conditional `:root` override rules.
 * Conditions are resolved with the same alias table and AND semantics as
 * lowering (A05), so keys and query text are identical. Declarations are grouped
 * by resolved query in first-appearance order: base declarations first, then one
 * `:root` rule per condition. This preserves each property's authored order
 * while letting the native custom-property cascade do the work — conditional
 * *reference* splitting is deliberately not performed.
 *
 * References inside declaration values are rewritten to `var(--...)`; a compile
 * reference that reaches this pass is expanded textually in its defining module
 * (the pass is safe to call without `substitute`, and idempotent after it).
 */

/** Options for {@link emitRuntimeTokens}. */
export interface RuntimeEmitOptions extends VariableNamingOptions {
  /** Project-level media alias overrides, merged before file `@media-types` (ADR-0006). */
  readonly media?: Readonly<Record<string, string>>;
  /**
   * Rule-bearing (`styles`) modules merged into this build, in emission order
   * (ADR-0014). Their rule-level runtime references register custom properties
   * too, because their declarations are emitted in this build even though their
   * `$references` were authored in another file. They are also the first ranks in
   * merge order, so the entry's `@runtime` definition overrides them (ADR-0016).
   */
  readonly ruleModules?: readonly string[];
}

/** Result of {@link emitRuntimeTokens}. */
export interface RuntimeEmitResult {
  /** IR with `:root` rules prepended and runtime references rewritten. */
  readonly ir: StylesheetIr;
  /** XESSA2001 value-expansion errors and XESSA3001 condition errors, in walk order. */
  readonly diagnostics: Diagnostic[];
}

/** One custom-property slot; a later-in-merge-order definition replaces the value. */
interface EmittedToken {
  readonly property: string;
  token: ScopedToken;
  span: Span;
  /** Merge rank of the defining module; higher wins. */
  rank: number;
}

interface ConditionGroup {
  readonly condition: MediaConditionIr;
  readonly declarations: DeclarationIr[];
}

/**
 * Canonical path list of the modules reachable from `entry` through `@use`.
 *
 * Entry first, then `ModuleGraph.order` (dependencies before importers, path
 * ties) restricted to reachable modules, then any remaining reachable module
 * (cycle members are absent from `order`) sorted by path. Deterministic for a
 * given graph.
 */
function reachableModules(graph: ModuleGraph, entry: string): string[] {
  const reachable = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reachable.has(file)) continue;
    const record = graph.modules.get(file);
    if (record === undefined) continue;
    reachable.add(file);
    for (const dependency of record.dependencies) queue.push(dependency);
  }

  const ordered: string[] = [];
  for (const file of graph.order) {
    if (reachable.has(file)) ordered.push(file);
  }
  const seen = new Set(ordered);
  const leftovers = [...reachable].filter((file) => !seen.has(file)).sort();
  return [...ordered, ...leftovers];
}

/**
 * Merge rank per module for runtime custom-property resolution (ADR-0016).
 *
 * Higher rank wins. Style-imported modules come first in canonical DFS `@use`
 * post-order (the order their rules are emitted), then any other reachable
 * runtime-token module in graph topological order, and the entry is always last.
 * The ordering is a deterministic projection of the graph; ties cannot occur
 * because every module is assigned at most one rank.
 */
function moduleMergeRanks(
  graph: ModuleGraph,
  entry: string,
  ruleModules: readonly string[] | undefined,
): Map<string, number> {
  const ranks = new Map<string, number>();
  let next = 0;
  const assign = (file: string): void => {
    if (file === entry || ranks.has(file)) return;
    ranks.set(file, next);
    next += 1;
  };

  for (const file of ruleModules ?? []) assign(file);
  for (const file of reachableModules(graph, entry)) assign(file);
  ranks.set(entry, next);
  return ranks;
}

/**
 * Emit `@runtime` custom properties and rewrite runtime references in `ir`.
 *
 * Signature note (deviation from the task sketch): the input IR is required.
 * Producing `:root` rules alone would leave declaration values untouched, so
 * the prescribed `(graph, entryFile, options)` shape cannot satisfy
 * "references become `var(--...)`" without re-reading the AST.
 *
 * Runtime rules are inserted after leading statement at-rules (`@charset`,
 * `@import`, `@layer a, b;`) so emitted CSS stays valid, and before authored
 * rules. The pass is pure, deterministic and never mutates the input IR; it
 * returns the input instance when there is nothing to add.
 */
export function emitRuntimeTokens(
  ir: StylesheetIr,
  graph: ModuleGraph,
  entryFile: string,
  options: RuntimeEmitOptions = {},
): RuntimeEmitResult {
  const entry = graph.modules.get(entryFile);
  const diagnostics: Diagnostic[] = [];
  if (entry === undefined) return { ir, diagnostics };

  const prefix = effectivePrefix(options);
  const table = buildMediaAliasTable(entry.ast, options.media);
  const ranks = moduleMergeRanks(graph, entryFile, options.ruleModules);

  const emitted: EmittedToken[] = [];
  const byProperty = new Map<string, EmittedToken>();
  const register = (token: ScopedToken, span: Span): void => {
    if (token.tokenType !== "runtime") return;
    const property = runtimePropertyName(token.name, prefix);
    const rank = ranks.get(token.module) ?? -1;
    const existing = byProperty.get(property);
    if (existing === undefined) {
      const slot: EmittedToken = { property, token, span, rank };
      byProperty.set(property, slot);
      emitted.push(slot);
      return;
    }
    // ADR-0016: native custom properties are live cascade values, so the later
    // definition in merge order wins. Equal ranks are the same definition
    // registered again (a reference and its declaration), so the first span is
    // kept. This intentionally reports no diagnostic.
    if (rank > existing.rank) {
      existing.token = token;
      existing.span = span;
      existing.rank = rank;
    }
  };

  // 1. Unqualified runtime surface of the entry itself: locals in authored
  //    order, then unqualified imports (the A07 scope shape). The scope keeps
  //    one deterministic winner per name, so register every runtime provider
  //    separately: merge order, not first-provider recovery, decides the value
  //    (ADR-0016).
  for (const token of entry.runtimeScope.tokens.values()) register(token, token.span);
  for (const providers of entry.runtimeProviders.values()) {
    for (const token of providers) register(token, token.span);
  }

  // 2. Runtime tokens actually consumed through a reference, either by the
  //    entry's rules or by any reachable token module.
  const registerReferences = (file: string, includeRules: boolean): void => {
    const record = graph.modules.get(file);
    if (record === undefined) return;
    for (const reference of astReferences(record.ast, { includeRules })) {
      const resolution = resolveReference(reference.reference, file, graph, reference.span);
      if (resolution.kind === "runtime") register(resolution.token, reference.span);
    }
  };

  registerReferences(entryFile, true);
  for (const file of reachableModules(graph, entryFile)) {
    if (file === entryFile) continue;
    registerReferences(file, false);
  }
  // Rule-merge imports (ADR-0014): the merged module's own rules are emitted in
  // this build, so their runtime references need a custom property here.
  for (const file of options.ruleModules ?? []) {
    if (file === entryFile) continue;
    registerReferences(file, true);
  }

  const hooks: ExpansionHooks = {
    runtimeRef: (token) => {
      register(token, token.span);
      return `var(${runtimePropertyName(token.name, prefix)})`;
    },
    report: (diagnostic) => diagnostics.push(diagnostic),
  };

  // 3. Defensive value rewrite: after `substitute` there are no `$` references
  //    left, but a standalone call still resolves and rewrites them here.
  const segments = segmentValueTokens(entry.ast);
  const originFor = (declaration: DeclarationIr): ValueOrigin => {
    const tokens = segments.get(declaration.span.start);
    return { module: entryFile, start: tokens?.[0]?.start ?? null, fallback: declaration.span };
  };
  const mapped = mapIrDeclarations(ir, (declaration) => {
    if (!declaration.value.includes("$")) return declaration;
    const expanded = expandValue(declaration.value, originFor(declaration), graph, hooks);
    if (expanded === null) return null;
    if (expanded === declaration.value) return declaration;
    return declarationIr(declaration.property, expanded, declaration.span, declaration.important);
  });

  // 4. Render each runtime token (the list can grow while values expand, so a
  //    plain index loop reaches a fixed point deterministically).
  const baseDeclarations: DeclarationIr[] = [];
  const groups: ConditionGroup[] = [];
  const groupByQuery = new Map<string, ConditionGroup>();

  for (let index = 0; index < emitted.length; index++) {
    const emittedToken = emitted[index];
    if (emittedToken === undefined) continue;
    const token = emittedToken.token;
    const declaration = token.declaration;
    if (token.tokenType !== "runtime" || !("variants" in declaration)) continue;

    const spans = declarationSegmentSpans(declaration);
    const baseValue = expandValue(
      declaration.value,
      { module: token.module, start: declaration.tokens?.[0]?.start ?? null, fallback: spans.base },
      graph,
      hooks,
    );
    if (baseValue === null) continue;
    baseDeclarations.push(
      declarationIr(emittedToken.property, baseValue, spans.base, declaration.important),
    );

    for (let variantIndex = 0; variantIndex < declaration.variants.length; variantIndex++) {
      const variant = declaration.variants[variantIndex];
      if (variant === undefined) continue;
      const span = spans.variants[variantIndex] ?? declaration.span;
      const value = expandValue(
        variant.value,
        { module: token.module, start: variant.tokens?.[0]?.start ?? null, fallback: span },
        graph,
        hooks,
      );
      if (value === null) continue;

      const resolution = resolveMediaCondition(modifierAliasSpans(variant), table, variant.span);
      if (!resolution.ok) {
        diagnostics.push(resolution.diagnostic);
        continue;
      }

      const rewritten = declarationIr(emittedToken.property, value, span, variant.important);
      let group = groupByQuery.get(resolution.condition.query);
      if (group === undefined) {
        group = { condition: resolution.condition, declarations: [] };
        groupByQuery.set(resolution.condition.query, group);
        groups.push(group);
      }
      group.declarations.push(rewritten);
    }
  }

  const runtimeRules: RuleIr[] = [];
  if (baseDeclarations.length > 0) runtimeRules.push(rootRule(baseDeclarations, null));
  for (const group of groups) {
    if (group.declarations.length > 0)
      runtimeRules.push(rootRule(group.declarations, group.condition));
  }

  if (runtimeRules.length === 0) return { ir: mapped.ir, diagnostics };

  // Keep `@charset`/`@import`/statement `@layer` first; CSS requires at-rule
  // statements before qualified rules.
  const nodes: (RuleIr | NativeBlockIr)[] = [...mapped.ir.rules];
  let insertAt = 0;
  while (insertAt < nodes.length) {
    const node = nodes[insertAt];
    if (node !== undefined && !("declarations" in node) && node.statement === true) insertAt++;
    else break;
  }

  return {
    ir: stylesheetIr([...nodes.slice(0, insertAt), ...runtimeRules, ...nodes.slice(insertAt)]),
    diagnostics,
  };
}
