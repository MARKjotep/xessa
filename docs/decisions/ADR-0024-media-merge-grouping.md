# ADR-0024: Opt-in media-run merge grouping

## Status

Accepted (2026-11-26) — project owner decision, normative for v0.1. Adds an opt-in
`mediaGrouping: "merge"` mode and a file-level `@setup { media-grouping: …; }` override. **`safe`
remains the public default**; making `merge` the default was considered and rejected in the same
owner decision.

Related: SPECIFICATION.md §5.3, §9, §10; ADR-0022, ADR-0023; CSSX-MEDIA-MERGE;
`packages/compiler/src/lowering/property-families.ts`, `merge.ts`;
`tests/browser/specs/grouping.pw.ts`; `.ai/reports/CSSX-MEDIA-MERGE.md`

## Context

Safe grouping merges only *adjacent* runs with an identical selector chain, condition and native
at-rule context. It is intentionally conservative: an intervening declaration run, even one that
sets unrelated properties, keeps two conditional runs apart and therefore repeats the complete
selector and `@media` wrapper in the output. Large responsive stylesheets accumulate such runs
because authors interleave base declarations, conditional blocks and unrelated states.

The optimizer could remove those repeats only if moving a declaration across another declaration
cannot change any cascade winner. The cascade decides each property independently, so the question
is whether any crossed declaration can compete for the same property. That is a property-family
question, not a selector-overlap or media-algebra question.

## Decision

1. **`safe` remains the default.** A default flip would silently change every project's emitted
   bytes and require regenerating all default-output goldens and example stylesheets. The owner
   chose a stable default with an explicit opt-in instead: defaults < project
   `compiler.mediaGrouping` < file `@setup media-grouping`.
2. **Add `mediaGrouping: "merge"`.** It keeps the safe adjacent pass and additionally merges a
   conditional run `i` into a later conditional run `j` exactly when:
   - the selector chain (`selector` plus `ancestors`), normalized condition **string** and native
     at-rule context are identical;
   - both conditions are non-empty (media/conditional runs only — unconditional runs never merge);
   - every declaration of every run strictly between `i` and `j` belongs to a property family
     disjoint from every declaration of run `i`;
   - neither run contains a wildcard declaration.
   The merged declarations are placed before the destination's existing declarations, preserving
   the source-then-destination order. The pass iterates to a fixpoint. Native blocks are hard
   barriers: children merge among themselves, never across a block boundary.
3. **Freeze family data.** `family(property)` strips one vendor prefix (`-webkit-`, `-moz-`,
   `-ms-`, `-o-`), keeps a custom property's full case-sensitive name, and otherwise takes the
   segment before the first `-` (`background-color` → `background`, `border-left-color` → `border`,
   `grid-template-columns` → `grid`, `margin-block` → `margin`). Standard shorthands share their
   longhands' first segment, so shorthand/longhand competition is blocked automatically. A frozen
   override table covers the standard properties whose longhands do **not** share that segment
   (`inset`/`top`, `place-*`/`align-*`+`justify-*`, `columns`/`column-count`, `gap`/`row-gap`,
   `white-space`/`text-wrap`, `font`/`line-height`, logical `inline-size`/`width`, the
   `page-break-*`/`break-*` aliases, `word-wrap`/`overflow-wrap`, legacy `-ms-flex-*` and
   `-webkit-box-*` spellings). Collapsing a group is conservative: `width` and `height` use the
   synthetic `size` family even though they never compete.
4. **Wildcards are barriers.** The `all` property and any declaration whose value contains `var(`
   never merge and nothing merges across them. `all` resets every property; `var()` makes a value
   depend on a custom property that a crossed declaration could change.
5. **Proof.** Consider any property `P` set by the moved run. Every crossed declaration `D` sets a
   property in a family disjoint from `P`'s family, so `D` cannot be a declaration for `P` (nor for a
   shorthand/longhand that writes `P`). The moved declaration therefore crosses no competitor for
   `P`: it lands before the destination's declarations, preserving its relative order, and selector
   specificity, condition overlap, `@layer` ordering and `!important` were identical or untouched.
   Hence every property's winner is unchanged. A property set by the destination is unaffected
   because the source declarations land before the destination's own declarations; a shared family
   between source and destination is still safe by preserved order, and a shared family among
   *crossed* runs blocks the merge.
6. **Escape hatches.** `safe` is the default and keeps today's output byte-for-byte. `none` emits
   every run as authored. `merge` is opt-in per project or per file. An invalid value is
   `XESSA1001`; the invalid file value is ignored and the lower layer applies.

## Why the family approximation is acceptable

- It over-approximates conflict: a missed merge is allowed, a changed cascade is not.
- It is frozen and tested (`tests/compiler/property-families.test.ts`), not heuristic.
- It is conservative for known shorthands: shorthands normally share their prefix, and the
  exception table prevents the under-approximations that would be unsound (`inset` vs `top`,
  logical vs physical sizing, `place-*`, `gap`, `columns`, `line-clamp`, `white-space`, `font` vs
  `line-height`, legacy aliases).
- Its limit is documented: a *future* cross-prefix shorthand not in the frozen table would be
  treated as disjoint. That is a deliberate maintenance boundary — extend the table when such a
  property enters the language; do not add speculative runtime heuristics.
- Values are opaque here. `var()` is the only value form that creates a declaration-order
  dependency between runs, and it is a wildcard.

## Rejected alternatives

- **Make `merge` the default (owner decision 2026-11-26).** Rejected: it would change every
  project's emitted CSS on upgrade, force default-output golden and example regeneration, and make
  the most safety-critical optimization unconditional. Stable default, explicit opt-in.
- **Merge across different selectors.** Rejected: requires selector-overlap analysis (specificity,
  pseudo-classes, `:is()`/`:where()`, `:has()`) to know whether two selectors can match the same
  element for the same property.
- **Merge across different conditions.** Rejected: requires media-query algebra to know whether two
  conditions can overlap for the same property.
- **Hoist a conditional run past a same-property base declaration.** Rejected: that flips the
  winner (for example a later base `color` beating an earlier `@md color` would start losing).
- **Merge across native blocks or different native contexts.** Rejected: `@layer`/`@supports`/
  `@container`/`@media` wrappers change the cascade context; keeping blocks as barriers avoids
  reasoning about context equivalence.
- **Deduplicate or reorder declarations.** Out of scope: Xessa preserves authored order and only
  groups runs; no property values are rewritten.

## Consequences

- `MediaGroupingMode` is `"safe" | "none" | "merge"`; the resolved default stays `"safe"` in the
  compiler, CLI config and editor.
- `@setup media-grouping` is a new kebab-case key with editor completion and a hover card.
- Default-output goldens and all example stylesheets remain byte-identical; merge is covered by
  explicit-mode unit tests and the browser differential.
- The browser gate compiles every scenario with `safe`, `none` and `merge` and requires equal
  computed styles across all viewports, color schemes and installed engines.
