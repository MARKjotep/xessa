# ADR-0016: Runtime token override by merge order

## Status

Accepted (2026-11-25) — project owner decision, normative for v0.1. This is a semantics change, so it
is recorded here, restated in `SPECIFICATION.md` §6.1–§6.3 and pinned by fixtures.

Related: SPECIFICATION.md §5.2, §6.1, §6.2, §6.3; ADR-0005, ADR-0014, ADR-0015;
`.ai/reports/CSSX-A20.md`

## Context

`@runtime { primary: #2563eb; }` emits `:root { --<prefix>-primary: … }` and references become
`var(--<prefix>-primary)`. A build can therefore see the same custom-property name from several
places: the entry's own `@runtime` block, a module imported with `@use`, and the rules of modules
imported with `@use "…" styles` (ADR-0014). Before this decision the compiler treated that as an
error: `emitRuntimeTokens` reported XESSA2001, kept the first definition and rejected the build.

That was safe but wrong for the feature authors actually want — a theme module provides defaults and
the entry overrides them, exactly like later CSS wins in the native cascade. Custom properties are
*live* cascade values: the winning declaration is decided by source order, not by a compile-time
identity check. The owner asked on 2026-11-25 for clashing variable names to be detected *and*
overridable, and specifically for the `:root` custom-property strategy to be settled.

## Decision

1. **Runtime tokens resolve in merge order.** When more than one runtime definition maps to the same
   post-prefix custom-property name, the definition that comes later in merge order wins. The
   compiler emits one resolved declaration for that property; it does not emit duplicates and does
   not report a diagnostic. This replaces the previous XESSA2001 first-wins conflict.
2. **Merge order is the emission order, entry last.**
   - style-imported (`styles`) modules in canonical DFS `@use` post-order (dependencies before
     importers, each module once), exactly the order their rules are emitted (ADR-0014);
   - then any other reachable runtime-token module in `ModuleGraph.order` (topological:
     dependencies before importers, path ties);
   - the entry last.
   The rank is a pure, deterministic projection of the module graph. Because the entry is last, its
   `@runtime` definition overrides a style-imported module's same-named property; among modules, the
   later one in merge order wins — the same "later `:root` in the cascade wins" rule a browser
   applies to emitted CSS.
3. **Variants follow the same order per query group.** Inline variants still become conditional
   `:root` overrides grouped by resolved media query, base declarations first, then one `:root` per
   query in first-appearance order. The winning definition contributes its base value *and* its
   variants, so the entry's `@dark` value beats an imported module's `@dark` value for that query.
   A losing definition contributes nothing, including variants the winner does not define; the
   declaration is overridden as a whole, as authored CSS would.
4. **Compile-time tokens keep their existing override story.** A local `@variables` definition wins
   over unqualified imports (already the case, now pinned by a fixture), namespaces disambiguate,
   and `$name` ambiguity between unqualified imports remains XESSA2001 where no local definition or
   namespace exists. Runtime property merge order is about emitted custom-property names; it does
   **not** silence `$name` symbol ambiguity.
5. **Other conflict errors are unchanged.** Duplicate local definitions in one file (compile-time or
   runtime), compile-time/runtime cross-kind locals, ambiguous unqualified imports and duplicate
   namespace aliases stay XESSA2001. `@use "…" as keyframes` shadowing (ADR-0015) is untouched. No new
   diagnostic code joins the registry.
6. **Messages name their sources.** The ambiguous-unqualified-import message lists every clashing
   module path and whether it exports a compile-time or runtime token, and tells the author to use a
   namespace or a local definition. The previous message already named the paths; it now also names
   the symbol kind and the recovery.
7. **One predicate, one pass.** The rule lives in `variables/runtime.ts` (`emitRuntimeTokens` and its
   merge-rank helper). No parser, lexer or frozen-contract change, no new IR field, and no change to
   the per-module emission order inside the stylesheet.

## Rejected alternatives

- **Keep strict errors forever.** Rejected by the owner: it makes a theme module unusable as a
  defaults layer, and it rejects valid CSS the browser would cascade happily. It also forces every
  consumer to rename properties just to avoid a build error.
- **An opt-in override marker (`@runtime … !override`, an import flag, or a config key).** Rejected:
  it adds syntax and configuration for the common case, and the rule would still need an ordering
  definition. Merge order is already observable in the emitted CSS, so matching it is the least
  surprising contract and needs no opt-in.
- **Emit every definition and let the browser cascade decide.** Rejected for v0.1: it would duplicate
  custom properties in one `:root` block, make the artifact larger and dependent on emission
  ordering, and contradict "deduplicated by property" in §6.2. Resolving to one value produces the
  same computed winner while keeping the output deterministic and reviewable.
- **Report a conflict as a warning and keep first-wins.** Rejected: a warning on a deliberate,
  successful override trains authors to ignore XESSA diagnostics, and "first wins" contradicts the
  entry-last cascade the feature exists for.
- **Resolve per query instead of per definition.** Rejected: an entry that overrides the base value
  would silently inherit the imported module's `@dark` variant, which is not what "override this
  property" means and is harder to reason about than overriding the authored declaration wholesale.
- **Relax `$name` import ambiguity at the same time.** Rejected: compile-time substitution genuinely
  has to choose a value for a bare `$name`, so ambiguity stays an error there; namespaces or a local
  definition are the existing escape hatch (§6.1).

## Consequences

- A theme module can declare defaults and the entry can override them by defining the same
  `@runtime` property; the output contains one `:root` declaration with the entry's value, and the
  entry's conditional variants win their query groups.
- Two style-imported modules may define one property; the later one in merge order wins and the
  build no longer fails on an ordinary CSS layering pattern.
- Existing single-module output is unchanged. The only changed outputs are builds that previously
  failed with XESSA2001 for a duplicate runtime property, plus the updated diagnostic message for
  ambiguous unqualified imports.
- Recommended author guidance is unchanged in spirit: use namespaces or a local definition when
  you mean to choose a compile-time value; use merge order when you mean to layer custom properties.
- Pinned by `runtime/override-entry`, `runtime/override-modules`, `runtime/override-variants`,
  `variables/duplicate-local` and `variables/local-overrides-ambiguous-import`, plus
  `tests/compiler/runtime.test.ts`, `resolver.test.ts` and `variables.golden.test.ts`.
- Cross-entrypoint runtime collisions are still P5 project work and are not changed here.
