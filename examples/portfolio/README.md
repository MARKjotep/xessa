# Portfolio example

A deliberately full showcase: one entry, five stylesheet modules, one generated
stylesheet. It demonstrates the three headline Xessa features together — compile-time
`@variables` with namespaced imports, `@runtime` custom properties with a dark media variant,
and reusable `@group` declarations with per-use-site overrides — on a responsive portfolio page.

```text
portfolio/
  package.json              workspace boundary; no config needed
  index.html                the page, using emitted `pf-*` class names
  src/tokens.cssx           compile-time tokens (color.*, space.*, font.* namespaces)
  src/theme.cssx            runtime theme tokens + `@dark` variants
  src/layout.cssx           page shell: header, nav, theme control, sections, footer
  src/components.cssx       @group.card / @group.button / @group.badge, keyframes, buttons
  src/sections.cssx         hero, skills, projects, experience, contact
  src/portfolio.cssx        the single entry; imports all five modules
  generated/styles/portfolio.css     one merged stylesheet (~24.5 KB)
  generated/maps/portfolio.map.js     class map (~4.1 KB)
  .cssx-manifest.json       build manifest (hashes of the generated files)
```

All five modules declare `@setup { module: true; }`, so the default `**/*.cssx` discovery finds them
without writing artifacts for each; only `src/portfolio.cssx` produces the stylesheet and map.
`generated/` is committed output produced by the CLI, not hand-written CSS. Rebuilding rewrites
identical bytes.

`src/nas.cssx` is a scratch stylesheet that declares `module: true` and emits nothing (kept so ad-hoc
compiler experiments do not create tracked output).

## Build and serve

From the repository root:

```sh
(cd examples/portfolio && bun ../../packages/cli/src/index.ts build)
```

Or from this directory with an installed `xessa` CLI:

```sh
cd examples/portfolio && xessa build
```

Then serve the directory so the page can read the generated stylesheet's rules for the theme
control (`file://` may block CSSOM access in some browsers):

```sh
cd examples/portfolio && python3 -m http.server 4173
# open http://127.0.0.1:4173/
```

`generated/maps/portfolio.map.js` exports one camelCase `export const` per class, so a bundled page
can use `import { heroTitle } from "./generated/maps/portfolio.map.js"` and
`class={heroTitle}` instead of the literal `pf-` names used by the static `index.html`. It has no
default export and does not import the stylesheet; the page or bundler entry loads
`generated/styles/portfolio.css` explicitly. Run the build with `map-types: true` to also emit
literal `.d.ts` declarations.

## Import graph

```text
src/portfolio.cssx (entry)
├── src/tokens.cssx              token-only      no CSS emitted
├── src/theme.cssx        styles  runtime tokens → :root + dark @media
├── src/layout.cssx       styles  ├── tokens.cssx as color / space / font
│                                 └── theme.cssx as theme
├── src/components.cssx   styles  ├── tokens.cssx as color / space / font
│                                 ├── theme.cssx as theme
│                                 ├── @group.card, @group.button, @group.badge
│                                 └── @keyframes rise
└── src/sections.cssx     styles  ├── tokens.cssx as color / space / font
                                  ├── theme.cssx as theme
                                  └── components.cssx styles (groups + keyframes)
```

The graph is loaded by canonical path and each module is emitted once. `sections.cssx` imports
`components.cssx` again with `styles` so its own file can see the group definitions and
`$keyframes.rise`; the entry's import of the same module does not duplicate any rule. Emission
order is depth-first in `@use` order: theme, layout, components, sections, then the entry (which has
no rules of its own).

The three aliases of `tokens.cssx` (`color`, `space`, `font`) all point at one cached module, so
every token is addressable under each alias while declarations read by family:
`$color.ink`, `$space.section`, `$font.display`.

## Feature map

| File | Demonstrates | Concrete syntax |
| --- | --- | --- |
| `src/portfolio.cssx` | Single-entry build, rule-merge imports | `@use "./layout.cssx" styles;` with `@setup` paths for one CSS file and one map |
| `src/tokens.cssx` | Compile-time tokens, namespaced imports | `@variables { ink: #191d1a; section: 104px; }` + `@use "./tokens.cssx" as color;` → `$color.ink` |
| `src/theme.cssx` | Runtime tokens, media variant, merge order | `@runtime { accent: #0b6b5f @dark #5eead4; }` → `:root { --pf-accent: … }` and `@media (prefers-color-scheme: dark) { :root { --pf-accent: #5eead4; } }`; consumers emit `var(--pf-accent)` |
| `src/layout.cssx` | Shell classes, responsive variants, `@reduced` | `@use "./tokens.cssx" as space;` + `@md { order: 0; width: auto; }` + `@reduced { scroll-behavior: auto; }` |
| `src/components.cssx` | Reusable groups and use-site overrides | `@group.card { padding: $space.card; border: 1px solid $color.border; }` then `.skill-card { @group.card { padding: 22px; background: $theme.surface; } }` |
| `src/components.cssx` | Built-in keyframe namespace | `@keyframes rise { … }` + `animation-name: $keyframes.rise;` |
| `src/sections.cssx` | All three features combined | `@group.card` use sites in skill/project/contact cards, `$theme.*` runtime references, `@sm`/`@md`/`@lg` layout variants |

Every group expansion is visible in `generated/styles/portfolio.css`: the definition's defaults are
spliced first (including `padding: 26px` for `.pf-skill-card`), then the use-site declarations (the
later `padding: 22px`). Nothing is filtered or deduplicated, so the override wins by cascade exactly
as ADR-0017 documents.

## Theme control

`theme.cssx` follows the same mechanism as `examples/overrides`: runtime tokens become a `:root`
block plus one `@media (prefers-color-scheme: dark)` block, and component rules use `var(--pf-*)`.
The page therefore follows the operating system with no JavaScript.

The Auto / Light / Dark control is a preview aid. **Auto** does nothing and lets the media query
decide. **Light** and **Dark** read the compiler-emitted `:root` values (the base block, plus the
dark block when forcing dark) from the stylesheet's CSSOM and copy them onto the document root. No
token value is duplicated in `index.html`, and adding a token to `theme.cssx` automatically reaches
the control. Attribute-based theme conditions are not part of v0.1 (`docs/compatibility.md`), which
is why the control mirrors values rather than asking the compiler for a `[data-theme]` selector.

## Replace placeholder content

All personal content is invented. Search for these strings in `index.html`:

- **Identity:** `Avery Quinn`, `AQ`, the `<title>`, meta description, brand role
  (`Product engineer`), hero headline and lede, portrait card labels, footer copyright.
- **Contact and links:** `hello@example.com`, `https://example.com/call`,
  `https://example.com/notes`, `https://example.com/source`. Project “case study” links point at
  `#contact`; replace them with real URLs.
- **Numbers:** the three hero stats (`8 yrs`, `24`, `4`), the four project metrics (`42%`, `3.1×`,
  `90 s`, `18`) and every date in the experience timeline.
- **Sections:** four skill cards, four projects (names, descriptions, tags), three experience
  entries, the availability line (`Q2 2026`) and the contact copy.
- **Footer:** the line `Placeholder portfolio content.` should be removed with the real content.
- **Brand assets:** the favicon is an inline SVG data URI with the `AQ` monogram in the `<head>`.
- **Colours and type:** static values live in `src/tokens.cssx`; theme-dependent values live in
  `src/theme.cssx`; both are imported by every module.

Text edits in `index.html` need no rebuild. Edits to any `.cssx` file need the build command above;
if a class is renamed in CSSX, update the matching `pf-*` name in `index.html` (or switch the page to
the generated class map).

## Validation performed

- `(cd examples/portfolio && bun ../../packages/cli/src/index.ts build)` → exit 0, 6 entries (the
  entry plus five `module: true` modules), 2 files written, 0 warnings.
- `generated/styles/portfolio.css` contains the `:root` runtime block, the dark media block, one
  `@keyframes rise`, ~100 `var(--pf-*)` references, and each source rule exactly once.
- Every class in `index.html` exists in `generated/maps/portfolio.map.js` (94 used / 94 exported).
- `bun run verify` passes (see the task report for the recorded counts).
