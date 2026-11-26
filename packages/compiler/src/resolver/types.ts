/**
 * Public shapes produced by the module resolver.
 *
 * These types are the A08 handoff: a scope tells substitution where every
 * visible symbol is defined, how it was brought into the file, and whether it
 * may be referenced without a namespace. All module identifiers are canonical
 * paths as returned by {@link ModuleHost.canonicalize}, normalized to forward
 * slashes.
 */

import type {
  Declaration,
  GroupDefinition,
  Stylesheet,
  TokenDeclaration,
  UseImport,
} from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";

/**
 * Resolver-internal record of one resolved `@use` statement.
 *
 * Not part of the facade: `target` is present only when the import passed
 * containment and existence checks, so later passes can distinguish a broken
 * edge (already diagnosed) from a real dependency.
 */
export interface ResolvedImport {
  /** The authored AST node. */
  readonly item: UseImport;
  /** Specifier after CSS string-escape decoding. */
  readonly specifier: string;
  /** Canonical target path when resolution succeeded. */
  readonly target?: string;
  /**
   * `true` when the import carried the `styles` clause, so the edge also merges
   * the target's rules into the importing build (ADR-0014). Token-only imports
   * are `false`.
   */
  readonly styles: boolean;
}

/** The two symbol spaces a Xessa module can export. */
export type ScopedTokenType = "compile" | "runtime";

/**
 * One `@keyframes` name referenceable as `$keyframes.<name>` in a module.
 *
 * Names are not symbols with a value: substitution splices {@link name} as
 * literal CSS text, and the same authored text resolves identically in every
 * module that can see it (ADR-0015).
 */
export interface KeyframeName {
  /** Authored keyframe name, a plain identifier (no quotes or escapes). */
  readonly name: string;
  /** Canonical path of the module whose `@keyframes` block declared it. */
  readonly module: string;
  /** Span of the declaring `@keyframes` at-rule in that module. */
  readonly span: Span;
}

/**
 * One `@group.<name>` definition visible to a module (ADR-0017).
 *
 * The definition stays in its declaring module: {@link module} and
 * {@link definition} always point at the module that authored it, so expansion
 * can attribute `$refs` to that module (SPECIFICATION.md §6.1).
 */
export interface VisibleGroup {
  /** Group name without the `@group.` prefix, matched exactly and case-sensitively. */
  readonly name: string;
  /** Canonical path of the module whose `@group` block declares it. */
  readonly module: string;
  /** Span of the declaring `@group` at-rule in that module. */
  readonly span: Span;
  /** The declaring definition node, carrying the defaults and their authored spans. */
  readonly definition: GroupDefinition;
}

/**
 * How one group name resolves from a module's point of view (ADR-0017 item 5).
 *
 * Both variants stay inert data for the expansion pass: it splices
 * {@link VisibleGroup.definition} for `resolved` and reports XESSA2001 at the
 * use site for `ambiguous` (plan G3). Ambiguity is not a resolver diagnostic
 * because only a use site makes it actionable.
 */
export type GroupResolution =
  | {
      /** Exactly one addressable definition: local first, otherwise a single import. */
      readonly kind: "resolved";
      readonly group: VisibleGroup;
    }
  | {
      /** Two or more imported definitions and no local one. */
      readonly kind: "ambiguous";
      /** The contested group name. */
      readonly name: string;
      /** Distinct visible definitions in traversal order; the message names their modules. */
      readonly candidates: readonly VisibleGroup[];
    };

/** Origin of a symbol declared in the scope's own file. */
export interface LocalSymbolOrigin {
  readonly kind: "local";
}

/** Origin of a symbol reached through a `@use` statement. */
export interface ImportSymbolOrigin {
  readonly kind: "import";
  /** Canonical path of the module that declares the symbol. */
  readonly module: string;
  /** Import specifier after CSS string-escape decoding, as authored otherwise. */
  readonly specifier: string;
  /** Span of the `@use` statement in the importing file. */
  readonly span: Span;
  /** Namespace alias when the import was written `as alias`; absent otherwise. */
  readonly namespace?: string;
}

/** How a visible symbol entered a token scope. */
export type SymbolOrigin = LocalSymbolOrigin | ImportSymbolOrigin;

/**
 * One visible token definition from the substitution point of view.
 *
 * The definition itself stays in its declaring module: {@link module} and
 * {@link declaration} always point at the module that authored the value, so a
 * local override never mutates an imported module (SPECIFICATION.md §6.1).
 */
export interface ScopedToken {
  /** Symbol name without the `$` sigil, exactly as authored. */
  readonly name: string;
  /** Which symbol space the definition belongs to. */
  readonly tokenType: ScopedTokenType;
  /** Canonical path of the module that declares this symbol. */
  readonly module: string;
  /** Span of the declaring `TokenDeclaration` or `Declaration`. */
  readonly span: Span;
  /**
   * The declaring AST node, carrying the raw value, optional parsed value
   * tokens and runtime variants. Immutable by contract.
   */
  readonly declaration: TokenDeclaration | Declaration;
  /** Whether the symbol is local or imported, and via which `@use`. */
  readonly origin: SymbolOrigin;
  /**
   * Whether a bare `$name` reference may resolve to this symbol. Always `true`
   * for locals and unqualified imports; `false` for namespaced members, which
   * are reachable only as `$namespace.name`.
   */
  readonly unqualified: boolean;
}

/**
 * Every unqualified runtime definition visible under one `$name`.
 *
 * Symbol resolution keeps a deterministic first provider, but runtime emission
 * needs the whole list so merge order (ADR-0016) can choose the later value.
 * Definitions are in authored `@use` order.
 */
export type RuntimeProviders = ReadonlyMap<string, readonly ScopedToken[]>;

/** The members one `@use "... as namespace"` statement exposes. */
export interface ScopedNamespace {
  /** Authored alias without the `$` sigil. */
  readonly namespace: string;
  /** Canonical path of the imported module. */
  readonly module: string;
  /** Span of the `@use` statement in the importing file. */
  readonly span: Span;
  /** Decoded import specifier as authored otherwise. */
  readonly specifier: string;
  /**
   * Symbols exported by the target module's own `@variables`/`@runtime`
   * blocks. There is no transitive re-export: member definitions are always
   * local to {@link module}.
   */
  readonly members: ReadonlyMap<string, ScopedToken>;
}

/**
 * Visible symbols of one module for one symbol space.
 *
 * `tokens` holds the names a bare `$name` reference may use after local
 * definitions shadow unqualified imports; `namespaces` holds every namespaced
 * import, with `members` filtered to this scope's {@link kind}.
 */
export interface TokenScope {
  /** The symbol space this scope exposes. */
  readonly kind: ScopedTokenType;
  /** Canonical path of the module whose source defines this scope. */
  readonly module: string;
  /** Unqualified, directly referenceable symbols. */
  readonly tokens: ReadonlyMap<string, ScopedToken>;
  /** Namespaced imports, addressable as `$namespace.member`. */
  readonly namespaces: ReadonlyMap<string, ScopedNamespace>;
}

/** One parsed and validated module of the graph. */
export interface ModuleRecord {
  /** Canonical path used as the module cache key and graph key. */
  readonly file: string;
  /** Immutable AST produced by `parseTokens`. */
  readonly ast: Stylesheet;
  /**
   * Canonical paths this module imports, deduplicated in first-authored
   * `@use` order. Includes token-only and rule-merge (`styles`) imports.
   * Failed imports are reported as diagnostics and omitted.
   */
  readonly dependencies: readonly string[];
  /**
   * Canonical paths imported with the `styles` clause, deduplicated in
   * first-authored `@use` order (ADR-0014). These modules contribute their rules
   * to a consuming build; `dependencies` is the superset used for scopes and
   * cycle detection.
   */
  readonly styleDependencies: readonly string[];
  /** Canonical paths of modules importing this one, sorted for determinism. */
  readonly importedBy: readonly string[];
  /** Compile-time (`@variables`) scope, including namespace member maps. */
  readonly compileScope: TokenScope;
  /** Runtime (`@runtime`) scope, including namespace member maps. */
  readonly runtimeScope: TokenScope;
  /**
   * All unqualified runtime imports visible to this module, grouped by `$name`
   * in authored `@use` order. Runtime emission registers every provider so the
   * later definition in merge order wins even when symbol resolution kept a
   * single first provider (SPECIFICATION.md §6.2, ADR-0016). Local definitions
   * shadow imports and appear only in {@link runtimeScope}.
   */
  readonly runtimeProviders: RuntimeProviders;
  /**
   * `@keyframes` names visible to this module as `$keyframes.<name>` (ADR-0015):
   * its own top-level blocks plus those of every module reached through a
   * `styles` `@use` edge (ADR-0014), because that is exactly the CSS this module's
   * build emits. Token-only imports contribute nothing.
   */
  readonly keyframes: ReadonlyMap<string, KeyframeName>;
  /**
   * `@group.<name>` definitions visible to this module (ADR-0017): its own
   * top-level definitions plus those of every module reached through a `styles`
   * `@use` edge (ADR-0014), transitively in authored order. Token-only imports
   * contribute no groups.
   *
   * A local definition shadows imported definitions of the same name without a
   * diagnostic; two imported definitions with no local one are
   * {@link GroupResolution} `ambiguous` and stay inert until a use site reports
   * XESSA2001 (plan G3). The map is resolver-internal data: it carries no
   * expansion state and nothing is emitted for a definition.
   */
  readonly groups: ReadonlyMap<string, GroupResolution>;
  /**
   * Whether the module contains top-level stylesheet rules or native at-rules.
   * Token-only modules report `false` so P4/P5 can skip artifact emission
   * (SPECIFICATION.md §6.1).
   */
  readonly hasRules: boolean;
}

/** Result of {@link buildModuleGraph}. */
export interface ModuleGraph {
  /** Every successfully loaded module keyed by canonical path. */
  readonly modules: ReadonlyMap<string, ModuleRecord>;
  /**
   * Deterministic topological order: dependencies before importers, ties by
   * canonical path. Modules participating in an import cycle are omitted after
   * their XESSA2001 diagnostic; every other loaded module appears exactly once.
   */
  readonly order: readonly string[];
  /**
   * Parse diagnostics followed by resolver diagnostics, stably sorted by file,
   * offset and code so identical inputs always yield identical output.
   */
  readonly diagnostics: readonly Diagnostic[];
}
