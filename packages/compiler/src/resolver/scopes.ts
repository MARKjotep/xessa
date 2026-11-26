/**
 * Token-scope construction for the module resolver.
 *
 * A scope answers the question A08 asks: for a visible `$name` or
 * `$namespace.member`, which module declares it, what AST node carries the
 * value, and how did it become visible? Local definitions are collected first
 * so imports always resolve against the target's *own* definitions and never
 * re-export transitively (SPECIFICATION.md §6.1).
 */

import type { Declaration, Stylesheet, TokenDeclaration } from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";
import { GROUP_DIRECTIVE } from "./groups.js";
import { KEYFRAMES_NAMESPACE } from "./keyframes.js";
import type {
  ImportSymbolOrigin,
  ResolvedImport,
  RuntimeProviders,
  ScopedNamespace,
  ScopedToken,
  ScopedTokenType,
  TokenScope,
} from "./types.js";

/** A module's own, non-imported symbols, one map per symbol space. */
export interface LocalSymbols {
  /** Definitions authored in `@variables` blocks. */
  readonly compile: ReadonlyMap<string, ScopedToken>;
  /** Definitions authored in `@runtime` blocks. */
  readonly runtime: ReadonlyMap<string, ScopedToken>;
}

/** One `@use "... as namespace"` binding before symbol-space filtering. */
interface NamespaceBinding {
  readonly namespace: string;
  readonly target: string;
  readonly span: Span;
  readonly specifier: string;
}

/** An unqualified import that exports one name. */
interface UnqualifiedProvider {
  readonly target: string;
  readonly tokenType: ScopedTokenType;
  readonly definition: ScopedToken;
  readonly import: ResolvedImport;
}

/**
 * Collect a module's local compile-time and runtime symbols in authored order.
 *
 * Reports XESSA2001 at the offending declaration for a duplicate local name
 * within or across blocks, and for a name defined as both a compile-time and a
 * runtime variable (§6.1, §6.2). The first definition wins in the scope so the
 * result stays deterministic even though the input is already erroneous.
 */
export function collectLocalSymbols(
  file: string,
  ast: Stylesheet,
  report: (diagnostic: Diagnostic) => void,
): LocalSymbols {
  const compile = new Map<string, ScopedToken>();
  const runtime = new Map<string, ScopedToken>();

  const add = (
    target: Map<string, ScopedToken>,
    tokenType: ScopedTokenType,
    name: string,
    declaration: TokenDeclaration | Declaration,
  ): void => {
    if (target.has(name)) {
      report(
        error(
          "XESSA2001",
          `Duplicate local ${labelFor(tokenType)} variable "$${name}" in "${file}".`,
          declaration.span,
        ),
      );
      return;
    }
    target.set(name, {
      name,
      tokenType,
      module: file,
      span: declaration.span,
      declaration,
      origin: { kind: "local" },
      unqualified: true,
    });
  };

  for (const item of ast.items) {
    if (item.kind === "variables") {
      for (const token of item.tokens) add(compile, "compile", token.name, token);
    } else if (item.kind === "runtime") {
      for (const declaration of item.declarations) {
        add(runtime, "runtime", declaration.property, declaration);
      }
    }
  }

  for (const [name, runtimeToken] of runtime) {
    const compileToken = compile.get(name);
    if (compileToken === undefined) continue;
    const later =
      compileToken.span.start <= runtimeToken.span.start ? runtimeToken.span : compileToken.span;
    report(
      error(
        "XESSA2001",
        `"$${name}" cannot be both a compile-time and a runtime variable in "${file}".`,
        later,
      ),
    );
  }

  return { compile, runtime };
}

/**
 * Build both token scopes for one module from its resolved imports.
 *
 * Unqualified imports merge into the `$name` namespace shared by both symbol
 * spaces, with a local definition of either kind taking precedence. Namespaced
 * imports are exposed only through `namespaces`, so `$layout` stays
 * unresolvable while `$layout.spacing` works. Ambiguous unqualified names are
 * XESSA2001 at the second conflicting `@use`; the first provider is kept in the
 * scope for deterministic downstream behaviour when the caller chooses to
 * continue after errors. A conflict made only of runtime providers is not
 * ambiguous when the module never references the bare name, because merge order
 * decides the emitted property (ADR-0016); {@link RuntimeProviders} still
 * carries every provider for that decision.
 */
export function buildScopes(
  file: string,
  locals: LocalSymbols,
  imports: readonly ResolvedImport[],
  localsFor: (module: string) => LocalSymbols | undefined,
  references: ReadonlySet<string>,
  report: (diagnostic: Diagnostic) => void,
): {
  readonly compileScope: TokenScope;
  readonly runtimeScope: TokenScope;
  readonly runtimeProviders: RuntimeProviders;
} {
  const bindings = collectNamespaceBindings(file, imports, report);
  const unqualified = resolveUnqualified(file, locals, imports, localsFor, references, report);

  return {
    compileScope: buildScope(file, "compile", locals, localsFor, bindings, unqualified.winners),
    runtimeScope: buildScope(file, "runtime", locals, localsFor, bindings, unqualified.winners),
    runtimeProviders: unqualified.runtimeProviders,
  };
}

/**
 * Merge unqualified imports into one shared name table.
 *
 * Compile-time and runtime imports share the `$name` namespace, matching the
 * `$name`/`$name.member` syntax: a single local definition of either kind
 * shadows every unqualified import of that name, and two distinct providers
 * (same or different symbol spaces) are ambiguous. The first provider wins so
 * repeated runs and post-error recovery stay deterministic.
 *
 * Runtime-only conflicts are not reported when the module never references the
 * bare name: the emitted custom property is then decided by merge order
 * (ADR-0016), not by symbol resolution. All runtime providers are returned per
 * name so emission can apply that order; a referenced name keeps the XESSA2001
 * and its first-wins recovery.
 */
function resolveUnqualified(
  file: string,
  locals: LocalSymbols,
  imports: readonly ResolvedImport[],
  localsFor: (module: string) => LocalSymbols | undefined,
  references: ReadonlySet<string>,
  report: (diagnostic: Diagnostic) => void,
): { readonly winners: Map<string, ScopedToken>; readonly runtimeProviders: RuntimeProviders } {
  const providers = new Map<string, UnqualifiedProvider[]>();

  for (const imported of imports) {
    if (imported.target === undefined || imported.item.alias !== undefined) continue;
    const exported = localsFor(imported.target);
    if (exported === undefined) continue;

    for (const tokenType of ["compile", "runtime"] as const) {
      for (const [name, definition] of exported[tokenType]) {
        if (locals.compile.has(name) || locals.runtime.has(name)) continue;
        const existing = providers.get(name);
        if (existing === undefined) {
          providers.set(name, [
            { target: imported.target, tokenType, definition, import: imported },
          ]);
          continue;
        }
        if (
          existing.some(
            (provider) => provider.target === imported.target && provider.tokenType === tokenType,
          )
        ) {
          continue;
        }
        existing.push({ target: imported.target, tokenType, definition, import: imported });
      }
    }
  }

  const winners = new Map<string, ScopedToken>();
  const runtimeProviders = new Map<string, ScopedToken[]>();
  for (const [name, list] of providers) {
    const first = list[0];
    if (first === undefined) continue;

    const allRuntime = list.every((provider) => provider.tokenType === "runtime");
    if (list.length > 1 && !(allRuntime && !references.has(name))) {
      const conflicting = list[1];
      const span =
        conflicting === undefined ? first.import.item.span : conflicting.import.item.span;
      const sources = list
        .map((provider) => `"${provider.target}" (${labelFor(provider.tokenType)})`)
        .join(", ");
      report(
        error(
          "XESSA2001",
          `Ambiguous unqualified import in "${file}": "$${name}" is exported by ${sources}. Import it with a namespace (@use "..." as <alias>) or define "$${name}" locally to choose one.`,
          span,
        ),
      );
    }

    winners.set(name, importedToken(first.definition, importOrigin(first.import), true));

    const runtimes = list
      .filter((provider) => provider.tokenType === "runtime")
      .map((provider) => importedToken(provider.definition, importOrigin(provider.import), true));
    if (runtimes.length > 0) runtimeProviders.set(name, runtimes);
  }

  return { winners, runtimeProviders };
}

function buildScope(
  file: string,
  kind: ScopedTokenType,
  locals: LocalSymbols,
  localsFor: (module: string) => LocalSymbols | undefined,
  bindings: ReadonlyMap<string, NamespaceBinding>,
  unqualified: ReadonlyMap<string, ScopedToken>,
): TokenScope {
  const tokens = new Map<string, ScopedToken>(locals[kind]);
  const namespaces = new Map<string, ScopedNamespace>();

  for (const binding of bindings.values()) {
    const exported = localsFor(binding.target);
    if (exported === undefined) continue;
    const members = new Map<string, ScopedToken>();
    const origin: ImportSymbolOrigin = {
      kind: "import",
      module: binding.target,
      specifier: binding.specifier,
      span: binding.span,
      namespace: binding.namespace,
    };
    for (const [name, definition] of exported[kind]) {
      members.set(name, importedToken(definition, origin, false));
    }
    namespaces.set(binding.namespace, {
      namespace: binding.namespace,
      module: binding.target,
      span: binding.span,
      specifier: binding.specifier,
      members,
    });
  }

  for (const [name, definition] of unqualified) {
    if (definition.tokenType === kind) tokens.set(name, definition);
  }

  return { kind, module: file, tokens, namespaces };
}

function collectNamespaceBindings(
  file: string,
  imports: readonly ResolvedImport[],
  report: (diagnostic: Diagnostic) => void,
): Map<string, NamespaceBinding> {
  const bindings = new Map<string, NamespaceBinding>();

  for (const imported of imports) {
    const alias = imported.item.alias;
    if (imported.target === undefined || alias === undefined || alias === "") continue;

    // The built-in `keyframes` namespace is reserved (ADR-0015): an alias would
    // shadow names that ADR-0015 defines, so it is a XESSA2001 instead of a
    // second, competing namespace.
    if (alias === KEYFRAMES_NAMESPACE) {
      report(
        error(
          "XESSA2001",
          `"$${alias}" is a built-in namespace (ADR-0015) and cannot be used as an @use alias in "${file}".`,
          imported.item.span,
        ),
      );
      continue;
    }

    // The built-in `@group.<name>` construct owns the `group` directive name
    // (ADR-0017 item 5, §3.6), so an alias of that name is rejected the same
    // way: XESSA2001 at the `@use`, no namespace, and the edge itself still
    // resolves.
    if (alias === GROUP_DIRECTIVE) {
      report(
        error(
          "XESSA2001",
          `"${alias}" is a reserved directive name (ADR-0017) and cannot be used as an @use alias in "${file}".`,
          imported.item.span,
        ),
      );
      continue;
    }

    const existing = bindings.get(alias);
    if (existing === undefined) {
      bindings.set(alias, {
        namespace: alias,
        target: imported.target,
        span: imported.item.span,
        specifier: imported.specifier,
      });
      continue;
    }

    if (existing.target !== imported.target) {
      report(
        error(
          "XESSA2001",
          `Duplicate namespace "${alias}" in "${file}" refers to both "${existing.target}" and "${imported.target}".`,
          imported.item.span,
        ),
      );
    }
  }

  return bindings;
}

function importedToken(
  definition: ScopedToken,
  origin: ImportSymbolOrigin,
  unqualified: boolean,
): ScopedToken {
  return { ...definition, origin, unqualified };
}

function importOrigin(imported: ResolvedImport): ImportSymbolOrigin {
  return {
    kind: "import",
    module: imported.target ?? imported.specifier,
    specifier: imported.specifier,
    span: imported.item.span,
  };
}

function labelFor(tokenType: ScopedTokenType): string {
  return tokenType === "compile" ? "compile-time" : "runtime";
}
