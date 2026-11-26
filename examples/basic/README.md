# Basic example

A feature tour of Xessa on the canonical project layout: one entry, a token-only `@use` module,
runtime tokens, an unused group, inline media variants, nested and child selectors, keyframes, and
independent CSS and class-map output directories.

```text
basic/
  package.json             workspace boundary; no xessa.config.json is needed
  src/button.cssx          the feature tour: setup, tokens, runtime tokens, an inert group, variants
  src/theme.cssx           token-only module ($theme.primary), `module: true`
  generated/styles/button.css    pretty-printed CSS (`minify: false`)
  generated/maps/button.map.js   `button`, `icon` and `test` bindings
```

`generated/` is committed output produced by the CLI, not hand-written CSS. It is deterministic:
rebuilding rewrites identical bytes.

## Build

From the repository root:

```sh
(cd examples/basic && bun ../../packages/cli/src/index.ts build)
```

Or from this directory with an installed `xessa` CLI:

```sh
cd examples/basic && xessa build
```

## What it demonstrates

- `@setup` with `prefix`, independent `css-dir`/`map-dir`, explicit basenames and `minify: false`.
- `@use "./theme.cssx" as theme` namespaced compile-time tokens; the module declares
  `@setup { module: true; }`, so discovery finds it but it writes no artifacts of its own.
- `@variables { spacing, radius }` feed the button's padding, its radius and the keyframe.
- `@runtime { colors: orange @dark #4ec9b0 }` becomes a prefixed custom property with a dark
  override — `:root { --ui-colors: orange }` plus a `prefers-color-scheme: dark` block.
- `@group.clr { color: purple; }` is defined but never used. Definitions emit nothing on their own.
- Inline variants (`padding: $spacing @md 20px @xl 32px`) become ordinary media queries; `@dark` on
  `background` compiles to a dark color-scheme query.
- `&:disabled` flattens to `.ui-button:disabled`; `& > .icon` renames the child class through the
  same prefix table (`ui-icon`).
- `.test` shows nested emission (`&:after` → `.ui-test:after`) and the empty-rule teaching point:
  `&:hover {}` and `&:focus {}` are dropped, so only non-empty rules reach the stylesheet.
- `@keyframes ss` is emitted under its authored name with `$radius` substituted as authored
  (`background-color: 8px`); tokens are textual substitutions, not a value validator.
- The class map exports `button`, `icon` and `test` as camelCase named consts (`export const test =
  "ui-test";`) and has no default export. It does not import the stylesheet: link
  `generated/styles/button.css` from the page or `import` it explicitly from the bundler entry. Add
  `map-types: true` to `@setup` to also write literal declarations (`button.map.d.ts`).
- `minify: false` opts this example out of the repository default of minified output
  ([ADR-0022](../../docs/decisions/ADR-0022-minified-output-default.md)), so
  `generated/styles/button.css` stays pretty-printed.

Rebuilding after editing `src/button.cssx` updates `generated/`; the build exits 1 on any error
diagnostic and leaves the last successful artifacts untouched.
