# ADR-0020: Module-side map-inheritance opt-out (`map-inherit`)

## Status

Accepted (2026-11-26) — project owner decision, normative for v0.1. Amends
[ADR-0014](ADR-0014-rule-merge-imports.md) §3: the "one merged class table" is still the default and
still keeps CSS, JS and `.d.ts` in lockstep, but a style-merged module may now opt its **bindings**
out of the importing build. The rule-merge decision itself (§1, §2, §4–§6) is unchanged.

Related: SPECIFICATION.md §6.3, §8, §9; ADR-0010, ADR-0014; `.ai/reports/CSSX-F20.md`

## Context

ADR-0014 §3 made a style-merged build expose one flat class table: the entry's classes plus every
style-imported module's classes, feeding the JS map and the opt-in `.d.ts`. That is the right default
— one component library, one importable module, no manual bookkeeping.

It is the wrong shape for a module that is consumed only as CSS. A design-system package may ship
rules that a page imports for their rendered effect while the page never addresses those classes
from JavaScript; inheriting the bindings then pollutes the importer's map with names it cannot
meaningfully use, and can even surface `XESSA4001` collisions between a module's component classes
and the importer's own classes. The owner asked for a module-side switch so the **rules still merge**
while the **bindings stay home**.

Constraints from the existing design:

- The module's `@setup prefix` already travels through resolution so merged rules keep their own
  names; `map-inherit` belongs on the same path.
- The map and `.d.ts` are generated from the same merged table, so filtering one without the other
  would break ADR-0014's lockstep invariant. The exception must be expressed once, in the table.
- Default behaviour must remain byte-identical: no existing `@setup` block changes meaning.
- `XESSA4001` is a table-level diagnostic; a binding that is not in the table cannot collide.

## Decision

Add a boolean `@setup` key `map-inherit` (JSON: `output.mapInherit`), **default `true`**.

1. **Meaning.** When a module with `@setup { map-inherit: false; }` is style-merged
   (`@use "…" styles;`) into an importer, its rules still emit into the importing stylesheet in the
   normal imported-first cascade order, with the module's own prefix. Its class bindings are
   excluded from the importer's `map.js`, its `.d.ts` and `CompileResult.classes`. CSS/JS/`.d.ts`
   therefore stay in lockstep over the table that is actually exported.
2. **Own build unaffected.** The flag governs inheritance only. When the same file is compiled as an
   entry, its own map and declarations include its classes as usual.
3. **Precedence.** Defaults < project configuration (`output.mapInherit`) < the module's own
   `@setup` value. Explicit API output fields behave like the project layer for `compile()`; an
   authored file value always wins.
4. **Diagnostics.** Excluded bindings are not present in the merged table, so they can never raise
   `XESSA4001` (neither the different-emitted-name error nor the camelCase-alias warning). The
   module's CSS is unchanged, and `XESSA2001` import/cycle diagnostics are unaffected.
5. **Composition with `module: true` is allowed and silent.** `@setup { module: true;
   map-inherit: false; }` means the module's bindings exist nowhere by default: the module emits no
   artifacts of its own (ADR-0014 §4) and contributes none to importers. Components in that module
   address classes with literal strings or `:global(...)`. This is the intended escape hatch for a
   rule-only module, not an error.
6. **Runtime tokens are unchanged.** Merged modules still register their runtime tokens in the
   consuming build under ADR-0014 §5; `map-inherit` does not touch token merging.

## Rejected alternatives

- **Per-import syntax `@use "…" styles no-map;`.** Deferred, not adopted. It puts the decision at
  the use site (so one importer could inherit and another not), but it adds a second modifier to the
  `@use` grammar and splits the module's contract across its consumers. The module-side key expresses
  ownership where it belongs, and importer-side control already exists: a token-only import brings in
  symbols without rules or bindings.
- **A warning when `module: true` and `map-inherit: false` are combined.** Rejected as noisy: the
  combination is an intentional, documented escape hatch for a rule-only module, not a mistake. A
  warning on every deliberate use would train users to ignore diagnostics.
- **Filtering only `map.js` while keeping `.d.ts` entries.** Rejected: it breaks the lockstep
  invariant the rest of the pipeline relies on, and leaves declarations for bindings that do not
  exist in JavaScript.

## Consequences

- A component library can ship rule-bearing modules without widening every consumer's class map, and
  an importer's own classes can never collide with an excluded module's.
- The merged table remains the single source of truth for exports; the exception is one documented
  predicate at merge time, not a second generation path.
- Default output is unchanged byte-for-byte (`map-inherit` defaults to `true`); only files that
  author the key change.
- `module: true` + `map-inherit: false` intentionally produces a module whose classes are usable
  only through literal strings or `:global`.
