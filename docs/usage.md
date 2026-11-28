# Xessa usage guide (v0.1)

This is the practical guide to using Xessa: installing it, writing the language, reading the
generated artifacts, driving the CLI and the VS Code extension, and theming a page with runtime
tokens.

The normative language definition is [SPECIFICATION.md](../SPECIFICATION.md). When this guide and the
specification disagree, the specification wins. CLI command reference:
[packages/cli/README.md](../packages/cli/README.md). Related references:

- [configuration.md](configuration.md) — every `@setup` and `xessa.config.json` key.
- [grammar.md](grammar.md) — lexical rules, grammar, decisions D1–D3.
- [cascade.md](cascade.md) — the emitted-order contract with browser evidence.
- [known-limitations.md](known-limitations.md) — what v0.1 does not do.
- [examples/](../examples/) — nine working projects with committed output.

---

## 1. Getting started

### 1.1 Install

Xessa requires Node.js ≥ 20 or Bun. The compiler is pure ESM with no runtime dependencies.
`@xessa/compiler` and `@xessa/cli` **0.1.2** are live on npm (published 2026-11-27) — see
[release.md](release.md). Install the current release with:

```sh
bun add @xessa/compiler        # programmatic compiler API
bun add -d @xessa/cli          # xessa build/check/watch/clean/format
```

The packaged `bin` points at the built `dist/index.js`, so with Bun `bunx xessa` runs directly. With
Node, use the same built entry: `node node_modules/@xessa/cli/dist/index.js` (or `npx @xessa/cli` in
an installed project). The unscoped `xessa` package is not published; install `@xessa/cli` for the
local `xessa` bin, or use `npx @xessa/cli`. The source entry
carries the `#!/usr/bin/env node` shebang, so a plain `bin` symlink also runs on a Node-only machine,
and Bun executes the same file.

To build from a source checkout instead:

```sh
bun install
bun run --cwd packages/compiler build
bun run --cwd packages/cli build
(cd examples/basic && node ../../packages/cli/dist/index.js build)
```

The VS Code extension is built from the same checkout:

```sh
bun run --cwd packages/vscode build       # dist/extension.js + out/extension.js
cd packages/vscode && bunx @vscode/vsce package --no-dependencies
# then: Extensions view → … → Install from VSIX
```

For extension development, open `packages/vscode` in VS Code and run the extension host (F5). The
manifest declares VS Code `^1.85.0`; the tested version is `1.147.0`.

### 1.2 First project

Create a directory with two sources. Xessa sources use the `.cssx` extension; the language ID stays
`xessa` ([ADR-0013](decisions/ADR-0013-cssx-file-extension.md)). A `xessa.config.json` is optional:
without one, the CLI uses the nearest `package.json` as the workspace root and discovers
`**/*.cssx` ([ADR-0023](decisions/ADR-0023-zero-config-defaults.md)).

```text
my-site/
  package.json             # workspace boundary; no config required
  src/
    theme.cssx
    button.cssx
```

Add a config only to scope discovery or change a default:

```json
{
  "include": ["src/**/*.cssx"],
  "classes": { "strategy": "prefix", "prefix": "ui" }
}
```

`src/theme.cssx` — a token-only module that declares itself, so the build writes no artifacts for
it even though discovery finds it:

```xessa
@setup {
  module: true;
}

@variables {
  primary: #2563eb;
}
```

`src/button.cssx`:

```xessa
@setup {
  prefix: "ui";
  css-dir: "../generated/styles";
  css-name: "button.css";
  map-dir: "../generated/maps";
  map-name: "button.map.js";
  map-types: true;
}

@use "./theme.cssx" as theme;

@variables {
  spacing: 12px;
  radius: 8px;
}

.button {
  display: flex;
  padding: $spacing @md 20px;
  border-radius: $radius;
  background: $theme.primary;

  &:hover {
    opacity: 0.85;
  }

  & > .icon {
    width: 16px;
  }
}
```

Build it:

```sh
# from the project directory, with an installed CLI
bunx xessa build        # or: xessa build

# from a source checkout, without installing, inside the project directory
cd /path/to/my-site && bun /path/to/xessa/packages/cli/dist/index.js build
```

The CLI writes `generated/styles/button.css`, `generated/maps/button.map.js`,
`generated/maps/button.map.d.ts` (because `map-types: true`), and records them in
`.cssx-manifest.json`. The map is exactly:

```js
export const button = "ui-button";
export const icon = "ui-icon";
```

`@setup` directories resolve relative to the source file and are exact. Project-level
`output.cssDir`/`output.mapDir` resolve relative to the workspace root and mirror the source path.
Precedence is **defaults < `xessa.config.json` < file `@setup` < explicit CLI flags**; see
[configuration.md](configuration.md).

To serve two apps from one build, `css-dir` accepts a comma-separated list of in-workspace
directories; each item gets the same stylesheet and, with `source-map: true`, its own source map:

```xessa
@setup {
  css-dir: "../client", "../src";
  css-name: "app.css";
}
```

The list replaces `output.cssDir` for that file. Empty or duplicate items are `XESSA2001`; every
destination is recorded in the manifest, so `clean` removes all copies and `watch` rewrites all of
them.

### 1.3 What the build does

The pipeline is tokenize → parse → resolve modules/config → validate → lower to ordered CSS IR →
class rewrite → grouping (`safe` by default; opt-in `merge`) → emit CSS/map/types/source map → plan
and write outputs. The compiler never writes by itself; `planOutputs` validates every destination
before the CLI writes atomically.

---

## 2. Language tour

Every snippet below is ordinary Xessa; the emitted CSS is ordinary CSS. There is no browser runtime.

### 2.1 Rules and declarations

A rule is a selector and a block of declarations. Xessa declarations require semicolons. A final
ordinary CSS declaration may omit its semicolon only when it contains neither a Xessa modifier
(an inline `@alias`) nor a `$` reference; otherwise the parser reports `XESSA1002`
([ADR-0011](decisions/ADR-0011-semicolonless-final-declarations.md)).

```xessa
.card {
  color: red;
  padding: 4px
}

// rejected: a Xessa declaration is missing its semicolon
.bad {
  padding: 4px @md 8px
}
```

The second declaration is `XESSA1002` because it carries a modifier. Recovery keeps the accepted
statement and omits the rejected one.

### 2.2 Nesting, `&` and bare descendants

Nested selectors flatten to ordinary CSS. A nested rule **without** `&` is a descendant selector
(decision D1, [ADR-0002](decisions/ADR-0002-descendant-nesting.md)):

```xessa
.button {
  display: flex;
  &:hover { opacity: 0.85; }
  &::before { content: ""; }
  & > .icon { width: 16px; }
  & + .button { margin-left: 8px; }
  &.is-active { color: white; }
  .icon { height: 16px; }        // same as & .icon
}
```

With prefix `ui` this emits `.ui-button`, `.ui-button:hover`, `.ui-button > .ui-icon`,
`.ui-button.ui-is-active`, `.ui-button .ui-icon`, and so on. `&` remains required for compound,
sibling and other complex nesting. Selector lists are split at top-level commas, and mixed-specificity
parent lists use `:is(...)` where native nesting requires it rather than a naïve expansion.

Native attribute selectors pass through byte-for-byte: `&[aria-expanded="true"]:hover` becomes
`.ui-button[aria-expanded="true"]:hover`, and prefixing is limited to class tokens outside the
brackets. Attribute names, operators, values and flags are never rewritten.

### 2.3 Compile-time variables and namespaces

`@variables` definitions substitute **token sequences**, not JavaScript expressions. `@use` imports
them unqualified or under a namespace; `$ns.member` addresses the namespace.

```xessa
@use "./tokens.cssx";              // unqualified: $spacing, $radius
@use "./layout.cssx" as layout;    // namespaced: $layout.gutter

@variables {
  gap: $layout.gutter;
  spacing: 16px;                   // local override of the imported $spacing
}

.card {
  padding: $spacing;               // 16px, not the imported value
  margin: $gap;
  border-radius: $radius;
}
```

- A local definition shadows an unqualified import of the same name.
- Two unqualified imports exporting the same name are `XESSA2001` unless a local definition wins.
- Imported values resolve in their defining module; a local override never mutates the module.
- There is no implicit transitive re-export. Duplicate local definitions and cycles are errors.
- Namespaced imports remain independent even when the same module is imported twice.

The complete example is [`examples/variables`](../examples/variables/).

**Terminology: variables vs runtime tokens.** The two token blocks differ in **when** the value is
resolved, not in how you reference it:

| Block        | Resolved when | Emitted as                                              | Referenced in Xessa as                                          |
| ------------ | ------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `@variables` | at build time | inlined value (`padding: 12px`)                         | `$name` / `$ns.name`                                            |
| `@runtime`   | at runtime    | `:root { --prefix-name: … }` plus conditional overrides | `$name` / `$ns.name` (the compiler writes `var(--prefix-name)`) |

Both are used identically as `$name` in source. Promoting a declaration from `@variables` to
`@runtime` — or moving it back — changes only the declaration site: every reference stays `$name`,
and the emitted CSS switches between the inlined value and `var()`.

```xessa
@variables { primary: #2563eb; }
.card { color: $primary; }     // .ui-card { color: #2563eb; }

// same reference: only the declaration site moved
@runtime { primary: #2563eb; }
.card { color: $primary; }     // :root { --ui-primary: #2563eb; }
                               // .ui-card { color: var(--ui-primary); }
```

Compile-time is the default because it costs nothing at runtime and emits no custom properties; reach
for `@runtime` when a value must be themed or overridden without a rebuild
([ADR-0016](decisions/ADR-0016-runtime-token-override.md)).

The naming is the awkward part: CSS calls `var(--x)` a "CSS variable" (custom property), while Xessa
calls the build-time block `variables` and the CSS-var block `runtime`. Read the block name, not the
word "variable".

### 2.4 Runtime tokens and `--var` references

`@runtime` tokens become native custom properties under the consuming build's prefix, plus
conditional `:root` blocks. Use the token as `$primary` in Xessa; the compiler writes
`var(--ui-primary)` for you. Native `var(--anything)` remains valid CSS.

```xessa
@runtime {
  primary: #2563eb @dark #60a5fa;
}

.card {
  color: $primary;
  border-color: var(--ui-primary);
}
```

```css
:root {
  --ui-primary: #2563eb;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ui-primary: #60a5fa;
  }
}

.ui-card {
  color: var(--ui-primary);
  border-color: var(--ui-primary);
}
```

When a token module is imported as a namespace, its runtime tokens are addressed through that
namespace (`$theme.primary`). Duplicate runtime property names inside one build resolve in merge
order — style-imported modules first, then other token modules, entry last — with no conflict
diagnostic ([ADR-0016](decisions/ADR-0016-runtime-token-override.md)). Runtime tokens are emitted
per consuming entrypoint.

**Naming a runtime property inside `var()`.** The first argument of `var()` is a property name, not a
value, so Xessa accepts a runtime token there and writes the prefixed name for you:

```xessa
@runtime { primary: #2563eb; }

.card {
  color: var($primary, #333);          // .ui-card { color: var(--ui-primary, #333); }
  border-color: var(--ui-primary);     // hand-written names are untouched
}
```

The shorthand applies only when the reference is the **whole** first argument. Other positions keep
their normal rendering: `var(--brand, $primary)` becomes `var(--brand, var(--ui-primary))`, and
`var($a, var($b, red))` becomes `var(--ui-a, var(--ui-b, red))`. Nesting, `VAR(`, surrounding
whitespace and the fallback text are preserved. A compile-time token in the name position is
`XESSA2001` — it would emit a literal value where a property name belongs — so use a `@runtime` token
or write `var(--name)` directly. Group defaults still reject runtime references in every position.

### 2.5 Media aliases, inline variants and conditional blocks

Built-in aliases (all `min-width` unless noted):

| Alias | Condition             | Alias       | Condition                          |
| ----- | --------------------- | ----------- | ---------------------------------- |
| `smd` | `(min-width: 624px)`  | `dark`      | `(prefers-color-scheme: dark)`     |
| `sm`  | `(min-width: 640px)`  | `light`     | `(prefers-color-scheme: light)`    |
| `md`  | `(min-width: 768px)`  | `portrait`  | `(orientation: portrait)`          |
| `lg`  | `(min-width: 1024px)` | `landscape` | `(orientation: landscape)`         |
| `xl`  | `(min-width: 1280px)` | `screen`    | `screen`                           |
| `2xl` | `(min-width: 1536px)` | `print`     | `print`                            |
|       |                       | `reduced`   | `(prefers-reduced-motion: reduce)` |
|       |                       | `no_hover`  | `(pointer: coarse)`                |
|       |                       | `mobile`    | `(pointer: coarse)`                |

`screen` and `print` are media types; `no_hover` and `mobile` are media features and share the
coarse-pointer condition.

Inline variants follow a required base value and may combine aliases with `+`, which is logical
**AND**:

```xessa
.card {
  padding: 12px @md 20px @xl 32px;
  background: white @dark #181818 @xl+dark #101010;
}
```

```css
.ui-card {
  padding: 12px;
}
@media (min-width: 768px) {
  .ui-card {
    padding: 20px;
  }
}
@media (min-width: 1280px) {
  .ui-card {
    padding: 32px;
  }
}
.ui-card {
  background: white;
}
@media (prefers-color-scheme: dark) {
  .ui-card {
    background: #181818;
  }
}
@media (min-width: 1280px) and (prefers-color-scheme: dark) {
  .ui-card {
    background: #101010;
  }
}
```

Conditional blocks are **rule-scoped only** (decision D3,
[ADR-0004](decisions/ADR-0004-rule-scoped-conditionals.md)) and accept declarations and nested rules:

```xessa
@media-types {
  compact: (max-width: 500px);
}

.card {
  @md { display: grid; & > .icon { width: 20px; } }
  @compact { display: block; }
}
```

Aliases merge by key: built-ins < project `media` config < file `@media-types`. An alias may hold
one media-query expression; comma lists and some `not`/`only` combinations are `XESSA3001`. Native
media lists in a native `@media` prelude pass through unchanged. In the editor, every variant marker
(`@md`, `@dark`, `@xl+dark`, block headers and `@media-types` captions) uses the `markup.deleted`
scope, painted orange/red and distinct from numeric values and the five semantic token kinds. See
[`examples/responsive`](../examples/responsive/).

### 2.6 Reusable declaration groups

A group is a named, non-parametric set of declarations. Definitions are inert: they emit nothing.
A use site is the same syntax inside a rule body and splices the defaults followed by the use-site
declarations at the authored position. Overrides win through the ordinary cascade. A definition may
also **compose** another group with a nested `@group.<base> { overrides }` statement
([ADR-0025](decisions/ADR-0025-group-composition.md)): the base resolves in the defining module,
its effective declarations expand first, then the composition block's overrides, in authored order.

```xessa
@group.card {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
}

.panel {
  @group.card {
    padding: 20px;
  }
}

.button {
  &:hover {
    @group.card { border-radius: 0; }   // any rule body, including a nested rule
  }
}
```

```css
.ui-panel {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  padding: 20px;
}

.ui-button:hover {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  border-radius: 0;
}
```

Rules that always hold ([ADR-0017](decisions/ADR-0017-reusable-declaration-groups.md),
[ADR-0025](decisions/ADR-0025-group-composition.md), [SPECIFICATION.md §3.7](../SPECIFICATION.md)):

- A definition takes declarations and nested composition statements. A use-site block and a
  composition block's overrides take **declarations only**. A nested rule, conditional block or
  native at-rule inside any of them is `XESSA1001`, and a `@group.` statement inside a use-site block
  is `XESSA1001`, not composition.
- The use-site **block is required**; a bare `@group.card;` is `XESSA1001`.
- Groups are not mixins: no parameters, arguments, interpolation, `@apply`, variant use sites or
  `$group.<name>` values. Composition is allowed only as a definition-body statement.
- Composition expands textually on every path: repeated targets and diamonds are not deduplicated.
  A cycle or a chain deeper than 64 compositions is `XESSA2001` at the offending nested statement;
  only that statement is omitted. Unused definitions stay inert, so an unreachable broken
  composition is not diagnosed.
- A module sees its own groups plus those of `@use "…" styles` modules; token-only imports expose
  none. A local definition shadows an imported one; two visible imported definitions are `XESSA2001`
  at the use site. Composition targets resolve in the defining module, so a consumer cannot rebind
  the base by defining a same-named group.
- Defaults and composition overrides resolve against the module that authored them. A `@runtime`
  reference in either is `XESSA2001`; author runtime customization in the use-site block instead.
- A default authored `!important` is not beaten by a plain use-site declaration. A use-site base
  declaration beats an earlier inline-variant default at every width — the documented cascade
  consequence, not a bug.

See [`examples/groups`](../examples/groups/) and [`examples/portfolio`](../examples/portfolio/).

### 2.7 `@keyframes` and `$keyframes.<name>`

A top-level `@keyframes <name>` stays native CSS and also registers the name in the built-in
`keyframes` namespace ([ADR-0015](decisions/ADR-0015-keyframes-namespace.md)):

```xessa
@keyframes spin {
  from { rotate: 0deg; }
  to { rotate: 360deg; }
}

.spinner {
  animation-name: $keyframes.spin;
  animation-duration: 1s;
}
```

emits `animation-name: spin` beside the unchanged block. Only a top-level keyframes block with a
plain identifier prelude registers; string-named keyframes (`@keyframes "fade"`) and keyframes
nested inside a rule or another at-rule block stay native-only and cannot be referenced
([ADR-0018](decisions/ADR-0018-keyframes-visibility-and-exclusions.md)). A module sees its own names
plus those of `@use "…" styles` modules; a token-only import exposes none. Duplicate names across
merged modules are not conflicts — both blocks emit and CSS cascade order decides.

### 2.8 Imports and rule merging (`styles`)

```xessa
@use "./tokens.cssx";                    // tokens only
@use "./layout.cssx" as layout;          // namespaced tokens only
@use "./components.cssx" styles;         // tokens + rules merged
@use "./theme.cssx" as theme styles;     // namespaced tokens + rules merged
```

- **Without `styles`**, an import is token-only and never imports rules.
- **With `styles`** ([ADR-0014](decisions/ADR-0014-rule-merge-imports.md)), the module's rules are
  merged ahead of the importing file's own rules, depth-first in authored `@use` order, each module
  once.
- Merged rules keep the imported module's own `@setup prefix`. The importing file's prefix, API
  prefix and project `classes.prefix` never leak into them.
- The importing build writes one merged class map covering its own classes plus every style-imported
  module's classes; the opt-in `.d.ts` matches. Identical original names that emit identically
  unify; different emitted names for one original name are `XESSA4001` errors; a camelCase binding
  collision is a `XESSA4001` **warning** with a `_2`/`_3` suffix.
- A module can opt its bindings out with `@setup { map-inherit: false; }`
  ([ADR-0020](decisions/ADR-0020-map-inheritance-opt-out.md)): its rules still merge in cascade order,
  but the importer's map, `.d.ts` and `classes` omit its classes, it cannot raise `XESSA4001`, and
  the module's own entry map is unchanged. Project `output.mapInherit` sets the default; the file's
  own value wins. Combining it with `module: true` is allowed and silent.
- Style-imported modules do not emit their own artifacts in the importing build. A module-only file
  marks itself `@setup { module: true; }`, which suppresses its own CSS, map and declarations unless
  those keys are authored explicitly.
- Imports are relative, workspace-contained and non-executable. Cycles through any `@use` edge are
  `XESSA2001` at the edge that closes the cycle.

The portfolio example's import graph is documented in
[`examples/portfolio/README.md`](../examples/portfolio/README.md).

### 2.9 `!important` is per value segment

`!important` belongs to the segment it terminates. It is never copied to another inline variant
([ADR-0003](decisions/ADR-0003-important-per-segment.md)):

```xessa
.button {
  padding: 10px !important @md 20px;
}
```

```css
.ui-button {
  padding: 10px !important;
}
@media (min-width: 768px) {
  .ui-button {
    padding: 20px;
  }
}
```

Write `!important` in each segment that should carry it.

### 2.10 Strings, comments and literal `@`

`//` and `/* … */` comments are supported. `@` inside strings, comments, `url(...)` and other
function arguments is ordinary CSS content, not a modifier or directive:

```xessa
.icon { background: url("image@2x.png"); }
.label::after { content: "@md"; }
.note { width: calc(100% - 2rem); }
```

Escaped characters are never interpreted as syntax. An unknown modifier at the correct depth is
`XESSA3001` rather than being emitted as CSS.

---

## 3. Outputs

### 3.1 Final CSS and the cascade contract

Xessa preserves authored order. Base declarations come first, then inline variants in written
order; conditional blocks and nested rules are emitted where they appear. Consecutive declarations
with the same selector and at-rule context are grouped only when safe (`compiler.mediaGrouping:
"safe"`, the default). Grouping never crosses a nested rule, a conditional block, a different
at-rule context, a layer or a scope.

For larger stylesheets, opt into `mediaGrouping: "merge"` (or `@setup { media-grouping: merge; }`):
it keeps the safe pass and additionally merges same-selector/same-condition conditional runs when
every crossed declaration has a provably disjoint property family. It never merges across a shared
property, `all`, a `var()` value, or a different selector or condition. The default stays `safe`, so
existing output is unchanged. See [ADR-0024](decisions/ADR-0024-media-merge-grouping.md).

A later base declaration **can** override an earlier conditional one. That is authored CSS and is
documented rather than repaired; write the declaration you want last. See [cascade.md](cascade.md)
for worked examples and the Playwright evidence in [`tests/browser/specs/`](../tests/browser/specs/).

### 3.2 JavaScript class maps

The class map is one npm-importable ESM module with one named binding per local class, in
first-appearance order. It has no default export, no object literal and, by default, no CSS
side-effect import. Load the stylesheet separately.

```js
// examples/basic/generated/maps/button.map.js
export const button = "ui-button";
export const icon = "ui-icon";
export const test = "ui-test";
```

```js
import { button, icon } from "../generated/maps/button.map.js";
document.querySelector(".cta").className = button;
```

The map is an ESM module, so a `package.json` that loads it needs `"type": "module"` (or a bundler
that handles ESM).

Static pages link the emitted stylesheet:

```html
<link rel="stylesheet" href="generated/styles/button.css" />
```

Bundler entries import it explicitly (the map never does by default):

```js
import "./generated/styles/button.css";
import { button } from "./generated/maps/button.map.js";
```

If the whole project wants the map to carry its stylesheet — one import per component instead of two
— opt in with `@setup { import-css: true; }` (`output.importCss: true` in `xessa.config.json`). The
map then starts with exactly one relative side-effect import:

```js
// generated/maps/button.map.js
import "../styles/button.css";
export const button = "ui-button";
export const icon = "ui-icon";
export const test = "ui-test";
```

The specifier is relative from the map file to the emitted stylesheet (`./` when they share a
directory). With a `css-dir` list, the **first listed destination** is the one imported; all copies
are still written. The import is omitted when no stylesheet is emitted (`emit-css: false` or a
`module: true` build), so a map never points at a missing file, and the `.d.ts` is always pure
declarations. Default `false` keeps the map plain-Node importable without a CSS loader
([ADR-0021](decisions/ADR-0021-opt-in-css-import.md)).

Identifier rules ([SPECIFICATION.md §8](../SPECIFICATION.md)):

| Authored class       | Identifier            | Rule                                                                   |
| -------------------- | --------------------- | ---------------------------------------------------------------------- |
| `contact-panel`      | `contactPanel`        | interior `-`/`_` runs are separators                                   |
| `panel_head`         | `panelHead`           | same rule for `_`                                                      |
| `__proto__`          | `__proto__`           | leading/trailing `_` runs preserved; a `const` has no prototype hazard |
| `2col`               | `_2col`               | digit-leading identifier gets `_`                                      |
| `default`, `delete`  | `_default`, `_delete` | reserved word gets `_`                                                 |
| `foo.bar`            | `foo_bar`             | non-identifier characters become `_`                                   |
| `foo-bar` + `fooBar` | `fooBar`, `fooBar_2`  | first-authored keeps it; one `XESSA4001` warning                       |
| `-` (no parts)       | `_`                   | empty alias fallback                                                   |

Each adjustment is a `XESSA4001` **warning**; no class is dropped. Global classes
(`:global(.external)`) are never exported.

Declarations are opt-in (`map-types: true` / `output.mapTypes: true`; `emit-types` is a deprecated
alias). The `.d.ts` mirrors the JS exactly:

```ts
export declare const button: "ui-button";
export declare const icon: "ui-icon";
```

A map basename `classes.js` yields `classes.d.ts`. With declarations off (the default) the map is
still written; only the declaration file is absent. See
[`examples/jsx`](../examples/jsx/) for the type-check command.

### 3.3 CSS source maps

`source-map: true` (`output.sourceMap` at project level) writes a standard v3 map named
`<css-name>.map` beside the stylesheet, with `file`, workspace-relative `sources`,
`sourcesContent`, and a trailing `/*# sourceMappingURL=<css-name>.map */` comment. No source map is
written when CSS emission is off. The class map is not a source map; it is a runtime module.
[`examples/custom-output`](../examples/custom-output/) demonstrates both.

### 3.4 Output planning, destinations and the manifest

Before writing, the CLI validates the complete plan with `planOutputs`:

- every destination stays inside the workspace root (no external output in v0.1);
- symlink escapes, input/output overlap, duplicate targets across entries and unsafe basenames are
  `XESSA5001`;
- inconsistent flags are rejected or suppressed with a documented warning (`map-types` without
  `emit-map`).

Files are written atomically per artifact (temp file in the destination directory, then rename).
Generated files are tracked in `<workspaceRoot>/.cssx-manifest.json`; `xessa clean` deletes only
manifest-owned files whose SHA-256 still matches and whose record is artifact-shaped with an
in-workspace `.cssx` source. Modified or untrusted files are reported and kept. A successful full
build prunes obsolete owned outputs. Interrupted builds leave `.<artifact>.<pid>.<n>.cssx-tmp`
files, which the next `build` or `clean` sweeps.

`emit-css: false` is valid: the map (and requested declarations) are still produced, and no CSS or
source map is written.

Emitted CSS is **minified by default** ([ADR-0022](decisions/ADR-0022-minified-output-default.md)):
generated structural whitespace is compacted, while authored tokens, values and declaration order are
preserved. For readable output, opt out with `@setup { minify: false; }`, project
`output.minify: false`, or `--no-minify`; precedence and last-wins flag behaviour are in
[configuration.md §1](configuration.md#1-precedence). Minification affects the stylesheet only:
`format()` output, the class map and `.d.ts` declarations are unchanged. Source maps keep the same
v3 format and generation rules; their mappings describe the emitted (possibly compact) positions.

---

## 4. CLI reference

```text
xessa build [file] [flags]
xessa check [file] [flags]
xessa watch [file] [flags]
xessa clean [flags]
xessa format [file] [flags]
xessa --help
xessa --version
```

| Command               | Behaviour                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`               | Compile the project from include globs (configured or the `**/*.cssx` default), or one file, and write artifacts + manifest. Empty discovery is exit 2. |
| `check`               | Compile and plan exactly like `build`, report diagnostics, **never write** and never touch the manifest.                                                |
| `watch`               | Initial build, then incremental rebuilds until SIGINT/SIGTERM.                                                                                          |
| `clean`               | Delete only manifest-owned outputs whose hash still matches.                                                                                            |
| `format`              | Reprint sources canonically in place; parse errors never rewrite a file.                                                                                |
| `--help`, `--version` | Usage / version, exit 0.                                                                                                                                |

Canonical formatting keeps consecutive top-level `@use` statements contiguous (no blank line between
them); the next top-level construct still gets one blank line, matching the compiler formatter and
Format Document in the extension.

Flags:

| Flag                        | Effect                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--config <path>`           | Use a specific `xessa.config.json`; its directory becomes the workspace root. A value flag never consumes a following option, so `--config --json` is a missing path (exit 2). |
| `--json`                    | Machine-readable JSON for build/check/clean/format; NDJSON for `watch`.                                                                                                        |
| `--dry-run`                 | Report planned work without writing or deleting. Rejected by `check` (exit 2) because `check` never writes.                                                                    |
| `--minify` / `--no-minify`  | Compact/expand CSS; the last flag wins and overrides file `@setup` with an informational warning.                                                                              |
| `--check`                   | With `format` only: list files that would change, write nothing, exit 1 if any would change.                                                                                   |
| `-h/--help`, `-v/--version` | Help/version.                                                                                                                                                                  |

Exit codes:

| Exit | Meaning                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success; warnings are allowed and `check` with no errors succeeds.                                                                                                                          |
| `1`  | Compile/validation/formatting error, write or manifest failure, or `format --check` found changes.                                                                                          |
| `2`  | Invocation or configuration error: unknown flag/command, invalid config/schema, bad value, `check --dry-run`, an explicitly empty `include`, or include globs that match no `.cssx` source. |

### 4.1 Machine-readable output

`--json` prints one report. `build`/`check` reports have this shape (abridged):

```json
{
  "command": "build",
  "success": true,
  "exitCode": 0,
  "dryRun": false,
  "workspaceRoot": "/abs/project",
  "configFile": "/abs/project/xessa.config.json",
  "entries": [
    {
      "file": "src/button.cssx",
      "dependencies": ["src/theme.cssx"],
      "outputs": [
        {
          "kind": "css",
          "path": "generated/styles/button.css",
          "written": true
        },
        {
          "kind": "js",
          "path": "generated/maps/button.map.js",
          "written": true
        }
      ],
      "diagnostics": []
    }
  ],
  "diagnostics": [],
  "warnings": [],
  "errors": []
}
```

`format` reports `files`/`changed`/`diagnostics`; `clean` reports `removed`/`skipped`/`warnings`.
`watch --json` is true NDJSON: one `{"type":"watch","ready":true,"sources":…,"debounceMs":40}`
handshake after the initial build and watcher attachment, then one `{"type":"build",…}` object per
cycle.

### 4.2 Watch semantics

- The initial cycle is a full build. Entries and import dependencies are tracked through a reverse
  import graph, so editing a token module rebuilds every dependent entry.
- Filesystem events are debounced by `WATCH_DEBOUNCE_MS` (40 ms). One build runs at a time. An
  event that arrives mid-build bumps a generation counter; the in-flight result is discarded as
  stale rather than landing on disk.
- A wake that arrives while no waiter exists is **latched** (`pendingWake`), so the next cycle starts
  immediately instead of sleeping until an unrelated event arrives.
- `.cssx` events map through the reverse graph. Deletions, directory events, config changes and
  unknown paths trigger a full rediscovery and reattach watchers; a brand-new nested source directory
  is therefore picked up without a restart.
- Generated artifacts, the manifest and writer temporaries are ignored, so the watcher cannot feed
  back on its own output.

---

## 5. VS Code extension

The extension uses the same compiler and adds no runtime dependency. It registers `.cssx` with the
`xessa` language ID, a TextMate grammar, language configuration and file icons.

### 5.1 Completions

Registered trigger characters: `@`, `$`, `.`, `:`, `/`, `&`, `(`, `#`, `!`.

- Property names from a curated list of 197 standard properties, plus 43 WebKit- and Moz-prefixed
  fallbacks (`-webkit-appearance`, `-moz-appearance`, …) surfaced beside the standard property they
  mirror: typing `appear` lists `appearance` first and then its two vendor variants, while typing
  `web`/`-web` or `moz`/`-moz` filters to one engine family. Curated common values and 27 CSS units
  after a number complete too. These lists are editor hints, not a full CSS database: any property
  or value the engine accepts still compiles.
- `@` media aliases: built-in, project `media`, file `@media-types`, and `@setup` keys.
- `$` compile-time tokens, namespace members, and `$keyframes.` names.
- `@use "` import paths, nested selector starters (`&`, `&:hover`, `&.`, `& > `), pseudo-classes.
  WebKit- and Moz-prefixed pseudo-classes/elements (`::-webkit-scrollbar`, `::-moz-selection`, …)
  follow the standard pseudos as optional, lower-priority suggestions; typing `web` or `moz` after
  the colons filters to them.
- `(` reveals curated CSS functions and replaces the typed paren on accept.
- `#` on a color-accepting property lists named/hex colors; accepting replaces the typed prefix.
- `#` in selector position lists the current document's id selectors (`#panel`, one item per
  distinct id in first-appearance order); accepting replaces the typed `#…` prefix, so one `#`
  remains. Ids are document-global: no imported or cross-file ids are suggested.
- `!` after a declaration value offers `!important` and replaces the typed `!` run, so accepting
  yields one `!important`.

Accepting a property inserts `property: ;` with the cursor before the semicolon by default
(`xessa.editor.completePropertyWithSemicolon`). Accepting an `@setup` key inserts `<key>: ` so the
value list can follow; accepting a value (`true`, `false`, `merge`, `safe`, `none`) appends the
setting's `;` immediately unless one already follows the cursor. The suggest-widget rendering
(ordering, color swatches, filtering) is a manual editor behavior and is not claimed by this guide.

### 5.2 Hover, navigation and rename

- Hover: resolved token values, media conditions, CSS property/function usage, group and keyframe
  information, and generated class names.
- Go to definition and find references for `$tokens` and `@runtime` tokens. References work in both
  directions across direct importers: from a use site the result is the definition plus every
  resolving use, and from the definition it is the definition plus every resolving use in the
  workspace's `.cssx` files. Resolution decides inclusion, so namespaced aliases
  (`@use "…" as t` → `$t.name`), unqualified/style imports (`$name`) count, while a local token that
  shadows an imported name and an unqualified name exported by two modules (`XESSA2001`) are
  excluded. The on-demand scan is bounded to 200 candidates and skips `node_modules`, `dist` and
  `generated`; rename remains single-file.
- Rename: single-file `$token` rename; `@group` and `@keyframes`/`$keyframes` rename across the
  current document's visible `styles` module closure. A class rename inside a `.cssx` document
  updates every non-global occurrence of that class name in the same file — the leading dot stays,
  `:global(...)` occurrences are excluded (and refused when selected), and base, `&` nesting, comma
  lists and `:is()`/`:not()`/`:has()` arguments are covered. JSX, the generated map and `.d.ts` are
  not edited; they follow the next build, so a changed map binding used from JSX is caught by
  TypeScript, while literal `className="ui-card"` strings are not. Cross-file/JSX class rename is
  not available, and namespace members are refused. An id rename is likewise single-file: it
  rewrites every occurrence of that id name in the same `.cssx` document, keeps the leading `#`,
  and includes `:global(#x)` occurrences because ids have no local/global split. JSX/HTML
  `id="…"` anchors and inbound links are not updated, and ids are not in the generated map. Keyframe
  rename rewrites exact `animation-name: <name>` values only.
- Id selectors are authored CSS and are never prefixed or mapped (they emit byte-for-byte); they can
  be renamed within the current document as described above. Completion suggests them after `#` in
  selector position from the current document only.
- Outline, color swatches and the native color picker are provided by the same analysis. The native
  picker is a manual editor behavior; use **Developer: Inspect Editor Tokens and Scopes** to verify
  what a token resolves to.

### 5.3 Semantic token colors

Five token kinds are classified: `variable` (compile-time `$token`), `namespace` (the `$ns` prefix,
including `$keyframes`), `runtimeVariable`, `customProperty` (`--var`, including inside `var()`), and
`keyframe` (a resolved `$keyframes.<name>` member). Declaration sites keep property styling.

Zero-config colors come from `contributes.semanticTokenScopes`, so they follow the active theme:

| Kind              | Fallback scope         | Default (2026 Dark) | Dark+     | Light+    |
| ----------------- | ---------------------- | ------------------- | --------- | --------- |
| `variable`        | `variable.language`    | `#79C0FF`           | `#569CD6` | `#0000FF` |
| `namespace`       | `entity.name.type`     | `#4EC9B0`           | `#4EC9B0` | `#267F99` |
| `runtimeVariable` | `keyword.control`      | `#C586C0`           | `#C586C0` | `#AF00DB` |
| `customProperty`  | `keyword.control`      | `#C586C0`           | `#C586C0` | `#AF00DB` |
| `keyframe`        | `entity.name.function` | `#D2A8FF`           | `#DCDCAA` | `#795E26` |

To pin literal colors regardless of theme, add this to user or workspace settings:

```json
{
  "editor.semanticHighlighting.enabled": true,
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "variable": "#4C8DF8",
      "namespace": "#4EC9B0",
      "runtimeVariable": "#D6409F",
      "customProperty": "#D6409F",
      "keyframe": "#D18616"
    }
  }
}
```

Text the classifier cannot resolve (before analysis finishes, or after a parse error) uses the same
scope fallback.

### 5.4 Quick fixes and formatting

- The code-action provider offers **Add semicolon** for `XESSA1002`, inserting the missing `;` at the
  reported declaration end.
- **Format Document** (⌥⇧F) runs the canonical whole-document formatter. `xessa.editor.formatOnSave`
  (default off) runs the same edit on save. There is no range formatting; a parse error leaves the
  document unchanged. Canonical style keeps consecutive top-level `@use` statements contiguous (no
  blank line between them); the next top-level construct still gets one blank line.

### 5.5 Commands and settings

| Command                  | Behaviour                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| **Compile File**         | Compile the active file and write its planned outputs. Requires a trusted workspace.               |
| **Build Project**        | Build every entry in the active document's project. Requires trust.                                |
| **Preview Compiled CSS** | Compile in memory into a read-only `xessa-preview:` document; never writes.                        |
| **Open Generated CSS**   | Compile-check and open the planned CSS artifact.                                                   |
| **Open Class Map**       | Compile-check and open the planned `.map.js`. It opens the file; it does not parse or reformat it. |
| **Check Project**        | Diagnostics only; never writes.                                                                    |

| Setting                                      | Default | Meaning                                                          |
| -------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `xessa.compileOnSave`                        | `false` | Compile on save and write outputs; requires a trusted workspace. |
| `xessa.editor.formatOnSave`                  | `false` | Format the whole document on save.                               |
| `xessa.editor.completePropertyWithSemicolon` | `true`  | Insert `property: ;` and place the cursor before the semicolon.  |
| `xessa.previewSplitEditor`                   | `true`  | Open preview beside the editor instead of replacing it.          |

Compile/Build are blocked in Restricted Mode; diagnostics, completion, hover, preview,
definition/references and Check Project still work. The extension starts no watcher: use either the
CLI watcher or `compileOnSave`, not both (see §5.6 for two watcher-free save flows).

**Compile File**, compile-on-save and **Preview Compiled CSS** use the same minified default as the
compiler and CLI ([ADR-0022](decisions/ADR-0022-minified-output-default.md)): the written `.css` and
the readonly preview are compact. To read the expanded form, add `@setup { minify: false; }` to that
file (or set project `output.minify: false`); **Format Document** is unaffected and still formats the
source.

### 5.6 Build on demand (no watcher)

Both flows below compile on a save or a shortcut instead of watching the tree. Neither starts a
process that stays alive.

**Compile on save.** `xessa.compileOnSave` (default off, requires a trusted workspace) compiles the
saved document and writes its planned outputs. It compiles **only that document**:

- a `@setup { module: true; }` file writes nothing of its own (ADR-0014), so saving it has no visible
  effect;
- importers are **not** refreshed. Saving a `styles`-imported module does not rebuild the importer's
  merged CSS or class map; save the importer, or run **Build Project**, when its bindings or rules
  must reach a consumer build.

**Code Runner.** The extension registers the `xessa` language ID (`.cssx` files), so
[Code Runner](https://marketplace.visualstudio.com/items?itemName=formulahendry.code-runner) can run
the CLI for the active document. In workspace settings:

```json
{
  "code-runner.executorMap": {
    "xessa": "npx @xessa/cli build \"$fullFileName\""
  },
  "code-runner.runInTerminal": true,
  "code-runner.saveAllFilesBeforeRun": true
}
```

- `runInTerminal` keeps the output visible and lets the CLI report progress/diagnostics normally;
  `saveAllFilesBeforeRun` avoids compiling stale text.
- Keep the quotes around `"$fullFileName"`: Code Runner substitutes the raw path, and workspace paths
  may contain shell-significant characters such as `$`. Without quotes the path is re-expanded by the
  shell and the file is not found.
- `npx @xessa/cli …` always resolves the CLI package; the unscoped `xessa` package is not published.
  Install `@xessa/cli` first so its local `xessa` bin is available. Without a
  registry install, use a global link (`cd packages/cli && bun link` or `npm link`, then
  `"xessa": "xessa build \"$fullFileName\""`) or the absolute built entry:

  ```json
  "xessa": "node /absolute/path/to/xessa/packages/cli/dist/index.js build \"$fullFileName\""
  ```

Native alternative: bind the extension commands directly instead of installing Code Runner:

```json
[
  { "key": "ctrl+alt+b", "command": "xessa.compileFile" },
  { "key": "ctrl+alt+shift+b", "command": "xessa.buildProject" }
]
```

`xessa.compileFile` writes the active file's outputs; `xessa.buildProject` rebuilds every project
entry, including importers of a changed module.

---

## 6. Theming recipe: runtime tokens and a theme switch

The pattern shared by [`examples/overrides`](../examples/overrides/) and
[`examples/portfolio`](../examples/portfolio/) is:

1. Put theme values in a `@runtime` block in a module and import it with `styles`:

   ```xessa
   @variables { brand: #0f766e; }
   @runtime {
     primary: $brand @dark #2dd4bf;
     surface: #ffffff @dark #0f172a;
   }
   ```

2. Refer to them from rules as `$theme.primary` (namespaced import) or `var(--ui-primary)`. The
   build emits one `:root` block, one `@media (prefers-color-scheme: dark)` block, and `var(...)`
   references:

   ```css
   :root {
     --ui-primary: #0f766e;
     --ui-surface: #ffffff;
   }
   @media (prefers-color-scheme: dark) {
     :root {
       --ui-primary: #2dd4bf;
       --ui-surface: #0f172a;
     }
   }
   ```

3. The page follows the operating system with no JavaScript. **Auto** does nothing.

4. A manual Light/Dark control does not duplicate token values. It reads the emitted `:root` values
   from the stylesheet's CSSOM — including the nested dark-media block — and copies them onto
   `document.documentElement` with `style.setProperty`. Adding a token to the theme module
   automatically reaches the control. The portfolio's `index.html` implements this; Xessa itself
   does not require or generate JavaScript.

Attribute-based theme conditions such as `[data-theme]` are not part of v0.1
([compatibility.md](compatibility.md)); the control mirrors values rather than asking the compiler
for a new selector.

---

## 7. Examples index

| Example                                       | Shows                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic`](../examples/basic/)                 | A feature tour: `@setup`, namespaced and runtime tokens, an unused group, inline variants, nesting, keyframes, independent output directories.      |
| [`responsive`](../examples/responsive/)       | Inline variants, combined aliases, file `@media-types`, rule-scoped conditional blocks.                                                             |
| [`variables`](../examples/variables/)         | Unqualified/namespaced `@use`, local override, runtime custom properties.                                                                           |
| [`jsx`](../examples/jsx/)                     | A generated class map consumed from a React-style component, with `map-types: true`.                                                                |
| [`custom-output`](../examples/custom-output/) | Independent directories/names, `emit-css: false`, source map, classes.js → classes.d.ts.                                                            |
| [`overrides`](../examples/overrides/)         | Every runtime token strategy: style imports, entry override, compile-time local, namespace, imported keyframe.                                      |
| [`groups`](../examples/groups/)               | `@group` definitions plus per-use-site overrides, `!important`, inline-variant defaults.                                                            |
| [`portfolio`](../examples/portfolio/)         | Full showcase: tokens, runtime theme switch, groups, keyframes, one merged stylesheet.                                                              |
| [`modules`](../examples/modules/)             | No `exclude` list and no config: self-declared `module: true` files, one merged stylesheet, `map-inherit: false`, a two-destination `css-dir` list. |

Seven examples build with no `xessa.config.json` at all (`overrides` and `groups` keep a minimal
config for `classes.prefix`). Each directory contains its sources, committed `generated/` output and
a build command; config-less examples carry a minimal `package.json` so the workspace root is the
example directory. Outputs are deterministic; rebuilding rewrites identical bytes.

---

## 8. Where to go next

- [SPECIFICATION.md](../SPECIFICATION.md) — normative language, outputs, API and diagnostics.
- [docs/configuration.md](configuration.md) — every key, precedence and destination rule.
- [docs/cascade.md](cascade.md) — what the emitted order means in the browser.
- [docs/compatibility.md](compatibility.md) — supported and unsupported constructs.
- [docs/known-limitations.md](known-limitations.md) — operational gaps and release blockers.
- [docs/performance.md](performance.md) — measured benchmark numbers and how to reproduce them.
- [packages/vscode/README.md](../packages/vscode/README.md) — extension details and Token colors.
