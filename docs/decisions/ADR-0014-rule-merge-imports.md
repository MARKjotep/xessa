# ADR-0014: Rule-merge imports (`@use ... styles`)

## Status

Accepted (2026-11-25) — project owner decision, normative for v0.1. **Amended by CSSX-A52
(2026-11-26):** identifier collisions are `XESSA4001` warnings resolved with `_N` suffixes, and the
generated map no longer imports CSS (the `import-css` setting was removed). The rule-merge decision
itself is unchanged.

Related: SPECIFICATION.md §3.2, §6.1, §6.3, §7.2, §8, §9; ADR-0007, ADR-0010;
`.ai/reports/CSSX-A16.md`

## Context

v0.1 modules were token-only: `@use "./theme.cssx"` brings in `@variables` and
`@runtime` symbols, and SPECIFICATION.md §6.1 said explicitly that imports "may bring in tokens
only, not stylesheet rules". In practice a component library needs to modularize *markup* as well:
a button module owns `.button`/`.icon` rules that several pages reuse. The alternatives were
copying CSS, generating a separate shared stylesheet that consumers must import by hand, or
letting `@use` merge the module's rules.

The owner decided on 2026-11-25 that a `styles` clause on `@use` merges the target's rules into
the importing build, with native-`@import`-like cascade order.

## Decision

`@use "<specifier>" [as <alias>] [styles];` — the optional `styles` clause makes the import
rule-bearing as well as token-bearing.

1. **Prefix ownership.** Merged rules keep the imported module's own `@setup prefix`. The
   importing file's prefix, the API `prefix` and the project `classes.prefix` never apply to them.
   A module without `@setup` merges unprefixed.
2. **Cascade order.** Imported modules first (depth-first in authored `@use` order, each module
   once), then the importing file's own rules. Local rules therefore win equal-specificity ties,
   matching a native `@import` chain at the top of the consuming stylesheet.
3. **One merged class table.** The importing build's JS map and `.d.ts` cover the entry's classes
   plus every style-imported module's classes. The same original class name may resolve to the
   same emitted name in several modules (it unifies); different emitted names are **XESSA4001
   errors**, while a camelCase named-export alias collision is one `XESSA4001` **warning** and a
   deterministic `_2`/`_3` suffix. The build does not fail for an alias collision.
4. **No forced artifacts.** Style-imported modules do not emit artifacts in the importing build.
   A module that should never emit anything on its own marks itself with
   `@setup { module: true; }`: its own build suppresses `emit-css`, `emit-map` and `emit-types`
   unless those keys are authored explicitly. The file layer wins over the marker;
   explicit API/CLI overrides stay highest (SPECIFICATION.md §9.1).
5. **Tokens are unchanged.** Compile-time substitution and runtime custom-property emission follow
   §6.1/§6.2: an imported value resolves in its defining module, and runtime tokens of merged
   modules are emitted into the consuming build (deduplicated there, prefixed with the consuming
   build's prefix). A merged module's rule-level `$runtime` references register their custom
   property in the consuming build.
6. **Cycles.** Any cycle through `@use` edges, style-bearing or not, remains XESSA2001 at the edge
   that closes it (existing detection). The merged walk terminates deterministically on cycles.

## Rejected alternatives

- **`@setup { styles: "./x.cssx"; }` instead of a `@use` clause.** Rejected: `@setup` values are
  single scalars, a file can only name one module that way, and duplicate setting keys are already
  errors (SPECIFICATION.md §3.2, §9.2), so a second style import could not be expressed without
  inventing a new list syntax.
- **Per-file opt-in of the importing prefix on imported rules.** Rejected: two modules with the
  same class name would silently collide, and a module's CSS would change meaning depending on who
  imports it.
- **Silently picking the first class mapping on conflict.** Rejected by ADR-0010's strict policy:
  the map would be wrong for one module with no signal.

## Consequences

- Modular component CSS is expressible without a build-time copy step or a manually imported
  shared stylesheet.
- Existing outputs are byte-identical: the feature is opt-in through the new clause, and the
  single-file pipeline is unchanged when no `styles` edge exists.
- The merged map is a flat union keyed by the authored class name, so two modules that both author
  `.button` under different prefixes must be renamed or made global (strict conflict).
- Deterministic order and a single merged table keep CSS, JS and `.d.ts` in lockstep.
