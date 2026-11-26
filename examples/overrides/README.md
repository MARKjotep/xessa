# Overrides example

One build that exercises every token strategy settled by ADR-0015 and ADR-0016: real `--ui-*`
custom properties, two style-imported theme modules declaring the same `primary` property, an entry
`@runtime` override that wins over both, compile-time locals, a namespaced member and an imported
keyframe.

```text
overrides/
  xessa.config.json        minimal config: project prefix `ui` for entry classes only
  src/entry.cssx           the entry: both theme imports, tokens, local overrides and strategy rules
  src/theme-base.cssx      runtime defaults (`primary`, `surface`, `on-surface`) + `@keyframes fade`
  src/theme-alt.cssx       clashing runtime `primary` (#dc2626), imported later
  src/tokens.cssx          compile-time `radius`, `primary`, `gap`, imported unqualified
  generated/styles/app.css
  generated/maps/app.map.js
```

`generated/` is committed output produced by the CLI, not hand-written CSS. Rebuilding rewrites
identical bytes.

## Build

From the repository root:

```sh
bun packages/cli/src/index.ts build --config examples/overrides/xessa.config.json
```

Or from this directory with an installed `xessa` CLI:

```sh
cd examples/overrides && xessa build
```

## What it demonstrates

- `classes.prefix: "ui"` is the example's only project setting; the config exists just to show a
  non-default value. It prefixes the entry's classes (`ui-local-override`).
  Runtime custom properties take the same effective prefix, so names read `--ui-primary`, not
  `--primary`. (The CLI schema key is `classes.prefix`; `naming.prefix` is the compiler API field.)
- **Entry-wins runtime override.** `theme-base.cssx` and `theme-alt.cssx` both declare `primary`;
  the entry's local `@runtime` is last in merge order and wins, so the build emits one
  `:root { --ui-primary: #0f766e; }` (and the entry's `@dark` value).
- **Module-order resolution.** Style-imported modules resolve in authored `@use` order. `theme-alt`
  is imported after `theme-base`, so it would be the module winner if the entry did not define
  `primary` — the same "later `:root` wins" rule a browser applies to emitted CSS. No conflict
  diagnostic is reported (ADR-0016).
- **Compile-time local override.** The entry's `@variables { radius: 12px; gap: 20px; }` shadows the
  unqualified imports from `tokens.cssx` (4px/8px), so `border-radius: $radius` emits `12px`.
- **Namespace disambiguation.** `tokens.cssx` is also imported as `tokens`, so `$tokens.radius`
  still yields the original `4px` and `$tokens.primary` the compile-time `#1d4ed8`, while `$primary`
  is the local runtime custom property. `@use "./theme-base.cssx" as base styles` likewise keeps
  `$base.surface` addressable. (The duplicate import loads one module; it has no rules to merge.)
- **Imported keyframe.** `$keyframes.fade` resolves because `theme-base.cssx` is imported with
  `styles`, so its `@keyframes fade` block is emitted in this build; `animation-name` becomes the
  plain name `fade`. A token-only import would not make the name visible (ADR-0015).
- Style modules keep their own `@setup prefix: "ui"` and `module: true`, so discovery finds them but
  they write no artifacts of their own; project/API prefixes never leak into imported module rules
  (ADR-0014). Their rules still reference the shared `var(--ui-*)` properties, so the entry's winning
  values apply everywhere.

Rebuilding after editing a source updates `generated/`; the build exits 1 on any error diagnostic
and leaves the last successful artifacts untouched.
