# Xessa

Xessa is a CSS-first, property-centric stylesheet language. Responsive values, theme overrides and
nested selectors live beside their base declarations, and compile to ordinary CSS plus static
JavaScript class maps with optional TypeScript declarations and source maps. There is **no browser
runtime**, no framework dependency and no editor requirement: `@xessa/compiler` is pure TypeScript
with zero runtime dependencies, the `xessa` CLI drives it from Node or Bun, and the VS Code extension
is an interface to the same compiler.

Xessa is at **v0.1** — implementation complete. **0.1.1 is the first Xessa release (2026-11-27),
prepared for publication; publish with [docs/release.md](docs/release.md).** The full release gate
(`bun run release:check`) is green; registry install checks follow publication. The VS Code extension
is **not on the Marketplace yet**: it ships as the local VSIX
produced by `bun run release:check` (PP4b deferred). It is an MVP with a deliberately small, honest
feature set — read [compatibility](docs/compatibility.md) and
[known limitations](docs/known-limitations.md) before adopting it. The normative language definition
is [SPECIFICATION.md](SPECIFICATION.md); architecture decisions are recorded in
[`docs/decisions/`](docs/decisions/).

Source files use the `.cssx` extension; the language ID, packages, CLI command and `XESSA####`
diagnostics keep the Xessa name ([ADR-0013](docs/decisions/ADR-0013-cssx-file-extension.md)).

**npm package name:** npm rejected the unscoped `xessa` name as too similar to an existing package,
so the repository root is private and is not published. The CLI is
[`@xessa/cli`](https://www.npmjs.com/package/@xessa/cli), the compiler is
[`@xessa/compiler`](https://www.npmjs.com/package/@xessa/compiler), and the VS Code extension is
`xessa` on the Marketplace (publication deferred).

## Canonical example

```xessa
@setup {
  prefix: "ui";
  css-dir: "../generated/styles";
  css-name: "button.css";
  map-dir: "../generated/maps";
  map-name: "button.map.js";
}
@use "./theme.cssx" as theme;
@variables {
  spacing: 12px;
  radius: 8px;
}
.button {
  display: flex;
  padding: $spacing @md 20px @xl 32px;
  border-radius: $radius;
  background: $theme.primary @dark #1e40af;
  font-size: 14px @md 16px;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  & > .icon { width: 16px @lg 20px; }
}
```

With `theme.primary = #2563eb`, `src/button.cssx` compiles to `generated/styles/button.css` and
`generated/maps/button.map.js`. The CSS contains `.ui-button`, `.ui-button > .ui-icon`, ordinary
media queries and flattened pseudo-selectors. The map exports the emitted class names as camelCase
bindings — one `export const` per class, no default export:

```js
// generated/maps/button.map.js
export const button = "ui-button";
export const icon = "ui-icon";
```

The map holds only bindings and never imports CSS. Load `generated/styles/button.css` yourself:
`<link rel="stylesheet">` on a static page, or an explicit `import "./button.css"` in a bundler
entry.

```tsx
// app code
import { button } from "../generated/maps/button.map.js";
export function Button() {
  return <button className={button}>Continue</button>;
}
```

Add `map-types: true` (or `output.mapTypes` in `xessa.config.json`) to also write
`generated/maps/button.map.d.ts` with the same bindings as literal types. Declarations are opt-in
(CSSX-A52).

The complete, committed output is in [`examples/basic/`](examples/basic/). For the full language
tour, CLI/editor reference and theming recipes, read the **[full usage guide](docs/usage.md)**.

## Install

`@xessa/compiler` and `@xessa/cli` **0.1.1** are the first Xessa release (2026-11-27), prepared for
publication — see [docs/release.md](docs/release.md). Once published, install them with:

```sh
bun add @xessa/compiler        # programmatic compiler API
bun add -d @xessa/cli          # the xessa CLI (build, check, watch, clean)
# or with npm
npm install @xessa/compiler
npm install --save-dev @xessa/cli
```

Requires Node.js ≥ 20 or Bun. The compiler is ESM and has no runtime dependencies; the CLI is ESM,
ships built `dist` output, and its `bin` entry points at `dist/index.js` — run `bunx xessa` with Bun,
or `npx @xessa/cli` (or `node node_modules/@xessa/cli/dist/index.js`) with Node. The unscoped `xessa`
package is unavailable; use `npx @xessa/cli`, or install `@xessa/cli` first so the local `xessa` bin
is available (`bunx xessa`).

The VS Code extension is **not published to the Marketplace yet** (PP4b deferred). Build the local
VSIX from this checkout and install it by hand:

```sh
bun run release:check      # also produces packages/vscode/xessa-0.1.0.vsix
# Extensions view → … → Install from VSIX
```

## Quick start

1. **Write** `src/button.cssx` using the example above. Mark token-only or component files that are
   only imported with `@setup { module: true; }` so they self-suppress their own artifacts.
2. **Optionally configure the project.** No configuration is required: `xessa build` discovers
   `**/*.cssx` under the nearest `package.json` workspace root. Add `xessa.config.json` only to
   change a default or scope discovery:

   ```json
   {
     "include": ["src/**/*.cssx"],
     "classes": { "strategy": "prefix", "prefix": "ui" }
   }
   ```

   `exclude` is not needed for imported modules when they declare `module: true`.

3. **Build**:

   ```sh
   bunx xessa build            # project build from include globs (config or default)
   bunx xessa build src/button.cssx
   bunx xessa watch            # rebuild changed entries until interrupted
   bunx xessa check            # diagnostics only; never writes
   bunx xessa format           # canonical source formatting (--check to report only)
   bunx xessa clean            # delete only compiler-owned, unmodified outputs
   ```

4. **Use the map in JSX** by importing the generated bindings as shown above. With `map-types`
   enabled, the `.d.ts` next to it gives literal types such as `"ui-button"`; the runtime value is a
   plain string, so no helper or client runtime is involved.

To build from a source checkout instead of the npm packages:

```sh
bun install
bun run --cwd packages/compiler build
bun run --cwd packages/cli build
(cd examples/basic && node ../../packages/cli/dist/index.js build)
```

## Output configuration

File-level `@setup` controls one stylesheet. Project-level `xessa.config.json` is optional: it only
changes a default or scopes discovery. Precedence is **defaults < project config < file `@setup` <
explicit CLI flags**.

| Setting                                | Default          | Meaning                                                                                                                                                                                           |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`                               | `""`             | Class-name prefix (`ui` → `ui-card`).                                                                                                                                                             |
| `css-dir` / `output.cssDir`            | source directory | CSS output directory.                                                                                                                                                                             |
| `css-name` / `output.cssName`          | `<stem>.css`     | CSS basename.                                                                                                                                                                                     |
| `map-dir` / `output.mapDir`            | source directory | Class-map directory.                                                                                                                                                                              |
| `map-name` / `output.mapName`          | `<stem>.map.js`  | Class-map basename; opt-in declarations become `classes.d.ts`.                                                                                                                                    |
| `emit-css` / `output.emitCss`          | `true`           | Write the stylesheet.                                                                                                                                                                             |
| `emit-map` / `output.emitMap`          | `true`           | Write the JS class map.                                                                                                                                                                           |
| `map-types` / `output.mapTypes`        | `false`          | Write `.d.ts` beside the map (opt-in). `emit-types` / `output.emitTypes` remains a deprecated alias.                                                                                              |
| `source-map` / `output.sourceMap`      | `false`          | Write a CSS v3 source map beside the stylesheet.                                                                                                                                                  |
| `minify` / `output.minify`             | `true`           | Compact generated whitespace, preserving tokens and order. Set `false` or pass `--no-minify` for readable CSS.                                                                                    |
| `include` (config only)                | `["**/*.cssx"]`  | Entry globs; omit it for the default. A missing config uses the same globs.                                                                                                                       |
| `exclude` (config only)                | `[]`             | Extra discovery exclusions; imported modules self-declare with `module: true` instead.                                                                                                            |
| `compiler.strict` (config only)        | `true`           | Unknown configuration keys exit 2; `"strict": false` downgrades them to warnings.                                                                                                                 |
| `compiler.mediaGrouping` (config only) | `"safe"`         | `safe` merges only adjacent compatible runs without reordering; `merge` is the opt-in disjoint-family optimizer; `none` emits as authored. `@setup { media-grouping: …; }` overrides it per file. |

`@setup` directories resolve relative to the source file and are exact. Project directories resolve
relative to the workspace root and mirror the source path. Full details, safety rules and examples:
[docs/configuration.md](docs/configuration.md).

## CLI

| Command                           | Behaviour                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `xessa build [file]`              | Project build from include globs (configured or default), or one file. Writes artifacts + manifest.                                    |
| `xessa check [file]`              | Same compilation and diagnostics, **never writes**.                                                                                    |
| `xessa watch [file]`              | Initial build, then incremental rebuilds (including sources in newly created directories) until SIGINT/SIGTERM.                        |
| `xessa clean`                     | Deletes only manifest-owned files whose hash still matches.                                                                            |
| `xessa format [file]`             | Reformats sources canonically in place; `--check` lists files that would change and writes nothing; parse errors never rewrite a file. |
| `xessa --help`, `xessa --version` | Usage / version, exit 0.                                                                                                               |

Flags: `--config <path>`, `--json`, `--dry-run`, `--minify`, `--no-minify` (last wins), `--check`
(`format` only), `-h/--help`, `-v/--version`. A value flag never consumes a following option
(`--config --json` is a missing path), and `--dry-run` is rejected by `check`, which never writes.
`--json` emits JSON for build/check/clean/format and NDJSON for watch.

| Exit | Meaning                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (warnings allowed; `check` with no errors).                                                                                                                                          |
| `1`  | Compile/validation/formatting error, write or manifest failure, or `format --check` found changes.                                                                                           |
| `2`  | Invocation or configuration error: unknown flag/command, invalid config/schema, a value flag without a value, an explicitly empty `include`, or include globs that match no `.cssx` sources. |

## VS Code extension

The extension (`packages/vscode`) registers the `xessa` language and `.cssx` files with a standalone
TextMate grammar, language configuration and a chick file icon in light and dark themes. It provides:

- syntax highlighting for directives, aliases, `$tokens`, selectors, values and native at-rules;
- diagnostics from the tolerant parser and an in-memory compile, with exact spans and XESSA codes;
- completions for a curated list of 197 standard properties plus 43 WebKit/Moz-prefixed fallbacks
  surfaced beside their standard property (`appear` → `appearance`, `-moz-appearance`,
  `-webkit-appearance`), values, `@` aliases (built-in, project and `@media-types`), `$` tokens and
  namespace members (including `$keyframes.`), setup keys, import paths, nested selectors and
  pseudo-classes, with optional WebKit/Moz-prefixed selectors offered after the standard pseudos;
  context-aware repairs after `&:` and `&.`, and property completion above `&` lines;
- color intelligence: 25 curated CSS functions with usage tooltips after `(`, 148 named colors and
  a 35-entry hex palette after `#` on color properties, 27 units after numbers, clickable swatches
  and the native color picker;
- semantic token colors for compile-time, runtime and namespaced `$token` references, `--custom`
  properties and `$keyframes` members, plus a distinct orange/red marker for media variants
  (`@md`, `@dark`, `@xl+dark`) — styled by the active theme with no configuration, and pinnable
  with the literal palette documented in
  [`packages/vscode/README.md`](packages/vscode/README.md#token-colors);
- hover for resolved tokens, media conditions, generated class names and CSS function usage;
  definition, references, single-file token rename, colors and outline; accepting a property leaves
  the cursor before `;` (`xessa.editor.completePropertyWithSemicolon`, default on);
- commands **Compile File**, **Build Project**, **Preview Compiled CSS** (in memory, never writes),
  **Open Generated CSS**, **Open Class Map**, **Check Project**, plus a status bar and output
  channel;
- **compile on save is off by default** and only runs in a trusted workspace. Writing commands are
  blocked in Restricted Mode; no watcher is started by the extension.

Tested on VS Code 1.147.0 (manifest declares `^1.85.0`). See
[`packages/vscode/README.md`](packages/vscode/README.md).

## Testing and quality gates

```sh
bun run typecheck     # compiler, CLI and language-service packages
bun run lint          # Biome
bun test              # unit + integration + extension/provider suites
bun run verify        # typecheck && lint && test (the aggregate gate)
bun run test:browser  # Playwright computed-style cascade gate (Chromium required)
bun run benchmark     # benchmark measurements -> docs/performance.md
```

`bun run verify` currently passes with **1351 pass / 2 skip / 0 fail** across 99 files, including the
VS Code extension-host smoke suite **15 scenarios / 928 assertions**. Browser coverage: 96/96
Playwright tests recorded on Chromium, Firefox and WebKit, checking viewport boundaries, light/dark,
reduced motion, hover/focus/disabled, specificity, safe/none/merge grouping parity and
pretty-vs-minified parity.

## Repository layout

```text
xessa/
  README.md / SPECIFICATION.md / CHANGELOG.md / LICENSE
  docs/                  grammar, cascade, configuration, compatibility, performance, ADRs
  examples/              basic, responsive, variables, jsx, custom-output, overrides,
                         groups, portfolio, modules (built output committed)
  packages/
    compiler/            lexer, parser, resolver, transformer, generators (zero runtime deps)
    cli/                 build, check, watch, clean, config, output planner writer
    language-service/    shared editor analysis (no vscode import)
    vscode/              extension manifest, grammar, providers, commands
  scripts/benchmark.ts   benchmark harness
  tests/                 compiler, integration, extension, browser (Playwright)
```

Dependency direction: VS Code → language service → compiler; CLI → compiler. The compiler core is
pure and filesystem-independent through an injected host.

## Documentation

- [SPECIFICATION.md](SPECIFICATION.md) — normative language and compiler specification.
- [docs/usage.md](docs/usage.md) — the full usage guide (getting started, language tour, outputs, CLI, editor). Its terminology note in §2.3–2.4 explains why `@variables` are build-time and `@runtime` tokens are CSS custom properties.
- [docs/grammar.md](docs/grammar.md) — grammar, lexical rules, D1–D3.
- [docs/cascade.md](docs/cascade.md) — the cascade contract with worked examples and browser evidence.
- [docs/configuration.md](docs/configuration.md) — every `@setup` and `xessa.config.json` key.
- [docs/compatibility.md](docs/compatibility.md) — what is supported, what is not.
- [docs/performance.md](docs/performance.md) — measured benchmark numbers and machine context.
- [docs/known-limitations.md](docs/known-limitations.md) — operational gaps and release blockers.
- [docs/decisions/](docs/decisions/) — ADRs.
- [examples/](examples/) — nine working examples with committed output.

## License

MIT © Marky. See [LICENSE](LICENSE).
