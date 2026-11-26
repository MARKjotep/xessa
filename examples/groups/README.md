# Groups example

One build that exercises reusable declaration groups (`@group.<name>`, [ADR-0017](../docs/decisions/ADR-0017-reusable-declaration-groups.md)):
two groups defined once in a style-imported module and customized at each use site through the
ordinary cascade — no new runtime, no generated code, no CSS emitted for the definitions.

```text
groups/
  xessa.config.json        minimal config: project prefix `ui` only
  src/chrome.cssx          `@group.chrome` and `@group.elevated` plus tokens; `module: true`
  src/theme.cssx           runtime `surface`/`accent` tokens; `module: true`, imported with `styles`
  src/entry.cssx           both `styles` imports, a same-named local token, one rule per behaviour
  generated/styles/app.css
  generated/maps/app.map.js
  generated/maps/app.map.d.ts
```

`generated/` is committed output produced by the CLI, not hand-written CSS. Rebuilding rewrites
identical bytes.

## Build

From the repository root:

```sh
bun packages/cli/src/index.ts build --config examples/groups/xessa.config.json
```

Or from this directory with an installed `xessa` CLI:

```sh
cd examples/groups && xessa build
```

## What it demonstrates

- **Definitions are inert.** `chrome.cssx` authors `@group.chrome` and `@group.elevated`; neither
  appears in the CSS. Only the five entry use sites expand, so an unused group would cost nothing.
- **Overrides are emergent cascade.** `.ui-card` emits the group's defaults (`padding: 12px`,
  radius, border, `box-sizing`) and then the use-site `padding: 20px` as a second declaration. The
  later declaration wins at equal specificity; both stay in the output. Nothing is filtered,
  reordered or deduplicated (ADR-0017 decision, SPECIFICATION.md §3.7).
- **Per-use-site customization.** `.ui-tile` repeats only `border-radius: 0`, so padding and border
  keep the defaults while `.ui-card` repeats a different property.
- **`!important` consequence.** `@group.chrome` authors `box-sizing: border-box !important`.
  `.ui-framed` tries `box-sizing: content-box`; the plain declaration is emitted later but cannot
  beat the important default (ADR-0003 binds `!important` per value segment), so border-box
  persists.
- **Inline variant default.** `@group.elevated` declares `padding: 12px @md 20px`. `.ui-raised`
  overrides only the background, so the default survives: 12px below 768px, 20px from 768px up.
  `.ui-flush` repeats `padding: 4px` at the use site, and by design that later base declaration
  wins at every width, including under `@md` (SPECIFICATION.md §5.2).
- **Defining-module token resolution.** The defaults use `$chrome-padding`, `$chrome-radius`,
  `$chrome-border` and `$elevated-*` from `chrome.cssx`. `entry.cssx` declares an identically named
  `chrome-padding: 40px`; it shadows the import inside the entry only, so the defaults still emit
  12px and only `.ui-local-token` sees 40px. A copy that dropped authored spans would silently
  rebind that token.
- **Runtime customization at the use site (decision (b)).** Group defaults are compile-time only:
  `$theme.surface`/`$theme.accent` are not allowed in a default. `.ui-raised` authors them in its
  use-site block instead, so the CSS keeps the compile-time default and then emits
  `var(--ui-surface)`/`var(--ui-accent)` from `theme.cssx`'s `@runtime` tokens.
- **Visibility.** Only `@use "./chrome.cssx" styles;` exposes the groups. A token-only import would
  expose none (ADR-0017 decision (a)); `theme.cssx` is imported with `styles` so its `:root` block
  is emitted.
- `classes.prefix: "ui"` is the only project setting (the config demonstrates a non-default value).
  It prefixes entry classes (`ui-card`) and runtime properties (`--ui-surface`); no prefix leaks
  into the imported modules, which self-declare `module: true`.

These are **declaration groups, not mixins**. v0.1 is non-parametric and unconditional: no
parameters, interpolation or `@apply`; no group chaining; no conditional or variant use sites; no
bare `@group.<name>;` include; no `$group.<name>` values; and no cross-module group renaming or
re-export (ADR-0017 §9, SPECIFICATION.md §3.7).

Rebuilding after editing a source updates `generated/`; the build exits 1 on any error diagnostic
and leaves the last successful artifacts untouched.
