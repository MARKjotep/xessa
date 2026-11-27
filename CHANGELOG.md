# Changelog

All notable changes to Xessa are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Pre-1.0 syntax changes are called out explicitly.

## [0.1.2] - 2026-11-27

`@xessa/compiler` and `@xessa/cli` `0.1.2` — **published 2026-11-27**. The VS Code extension remains
`0.1.0`.

### Compiler

- Consecutive top-level `@use` statements stay contiguous in canonical formatting; the next
  top-level construct still gets one blank line.
- Default media aliases add `smd` (`(min-width: 624px)`), `no_hover`/`mobile` (`(pointer: coarse)`)
  and `screen`; `print` was already built in.

### Editor

- Accepting an `@setup` value completion (`true`, `false`, `merge`, `safe`, `none`) appends the
  terminating `;` immediately unless one already follows the cursor.

- Media variant markers (`@md`, `@dark`, `@xl+dark`, block variant headers and `@media-types`
  captions) now use the `@`-directive keyword colour: the grammar scopes them as
  `keyword.control.media.xessa` and the extension contributes a `#C586C0` default for that scope, so
  they read like directives without collapsing into strings. A user
  `editor.tokenColorCustomizations` rule for the scope still wins.
- Accepting a property completion now reopens the value list at the cursor, so named colours and hex
  values appear without retyping the colon.
- Typing a digit in a declaration value now suggests CSS units in the real editor: `0`–`9` are
  completion trigger characters, and accepting a unit appends it without deleting the digits
  (`margin: 1` → `1rem`).
- The curated property completion list grows from 123 to 197 entries, each with a one-sentence
  description, so common longhands such as `container-type`, `text-shadow`, `will-change` and
  `scrollbar-color` complete out of the box.
- 43 WebKit- and Moz-prefixed property fallbacks (`-webkit-appearance`, `-moz-appearance`, …) now
  complete beside the standard property they mirror: typing a base name surfaces the variants in
  order (`appear` → `appearance`, `-moz-appearance`, `-webkit-appearance`), typing `web` or `moz`
  filters to one engine family, and color properties among them keep the named/hex color list.
- WebKit- and Moz-prefixed pseudo-classes and pseudo-elements (`::-webkit-scrollbar`,
  `::-moz-selection`, …) are offered after the standard pseudos as optional, lower-priority
  suggestions with a `vendor-prefixed …` detail; typing `web` or `moz` after the colons filters to
  them, and accepting one keeps the correct colon count.

### Packaging and docs

- The `@xessa/compiler` tarball ships `SPECIFICATION.md` plus the complete `docs/` tree (`docs/**`,
  including every ADR), generated from the repository at pack time by
  `scripts/sync-package-docs.mjs`; the packed tarball grows from 403 to ~436 files, so npm users get
  the language contract offline at `node_modules/@xessa/compiler/`. Generated copies stay gitignored.
- The compiler, CLI and extension READMEs are reorganized by audience: the compiler owns the language
  and API contract, the CLI owns install/commands/operations, the extension owns editor behaviour.
  npm-visible links use absolute GitHub URLs.
- The repository root stays a private, unpublished workspace package at `0.1.1`; only
  `@xessa/compiler`, `@xessa/cli` and the hand-built VSIX are published artifacts.
- The VS Code extension remains `0.1.0` (Marketplace publication still deferred).

## [0.1.1] - 2026-11-27

The first public Xessa release (published 2026-11-27; see
[docs/release.md](docs/release.md)). It carries the 0.1.0 language surface plus the packaging fixes
and one compiler correction below. The VS Code extension remains at `0.1.0`.

### Compiler

- Runtime-token merge order now matches `SPECIFICATION.md` §6.2 and
  [ADR-0016](docs/decisions/ADR-0016-runtime-token-override.md) when two unqualified `styles`
  imports declare the same `@runtime` property: the later module in merge order supplies the single
  emitted custom property, and no `XESSA2001` is reported while the entry never references `$name`.
  A referenced unqualified name keeps the existing ambiguity diagnostic and first-provider recovery.

### Packaging

- Both package builds remove `dist` before compiling, so stale renamed outputs no longer ship
  (`@xessa/cli@0.1.0` carried obsolete `dist/output/importPath.*`).
- `@xessa/compiler` and `@xessa/cli` now ship `src/` alongside `dist/`, so every `.js`/`.d.ts`
  source-map `sources` entry resolves inside the installed package (compiler tarball 403 files, CLI
  89).
- The compiler README example now `await`s the async `compile()`.
- The `docs/usage.md` quick start is formatter-clean and notes that generated maps are ESM
  (`"type": "module"` or a bundler).

## [0.1.0] - 2026-11-26

First public MVP: a CSS-first, property-centric stylesheet language that compiles to ordinary CSS
plus static JavaScript class maps and TypeScript declarations. This release ships the compiler
(`@xessa/compiler`), the CLI (`@xessa/cli`) and the VS Code extension (marketplace name `xessa`).
The honest limits are listed in [docs/known-limitations.md](docs/known-limitations.md).

### Naming

- Source files use the `.cssx` extension; the language ID, packages, CLI command and diagnostics keep
  the Xessa name ([ADR-0013](docs/decisions/ADR-0013-cssx-file-extension.md)). `.xessa` files are not
  recognised.
- Extension identity: marketplace name `xessa`, version `0.1.0`, Xessa monogram and `.cssx`
  light/dark file icons; package-level `README.md`/`LICENSE` copies for the compiler and CLI tarballs.

### Language

- `@setup` with independent CSS/map directories, optional basenames, emit flags, prefix and
  minification. `css-dir` also accepts a comma-separated list of in-workspace directories, writing
  the same stylesheet (and one source map per destination) to every item
  ([ADR-0019](docs/decisions/ADR-0019-setup-output-lists.md)).
- Inline media variants (`padding: 8px @md 16px`) and rule-scoped conditional blocks, including
  combined aliases (`@xl+dark`, logical AND).
- Default aliases `sm`, `md`, `lg`, `xl`, `2xl`, `dark`, `light`, `portrait`, `landscape`, `print`,
  `reduced`; project `media` and file `@media-types` overrides merged by key.
- Nested selectors: `&:hover`, `&::before`, `&:nth-child()`, `& > .icon`, `& + .button`, compound
  classes and bare descendant nesting (D1). Mixed-specificity parent lists use `:is(...)`.
- Compile-time `@variables` with token-sequence substitution, forward references and cycle
  detection; `@use` imports with optional namespaces, workspace containment and no implicit
  re-export.
- Reusable declaration groups: `@group.<name> { … }` expanded at each `@use … as <ns> styles` site,
  with an optional per-use-site override block, `!important` per value segment and compile-time-only
  defaults ([ADR-0017](docs/decisions/ADR-0017-reusable-declaration-groups.md)).
- The `$keyframes.<name>` namespace: `@keyframes` names are referenceable and importable across
  modules, with the visibility and exclusion rules in
  [ADR-0015](docs/decisions/ADR-0015-keyframes-namespace.md) and
  [ADR-0018](docs/decisions/ADR-0018-keyframes-visibility-and-exclusions.md).
- `@runtime` custom properties with conditional overrides and `var(--prefix-name)` references; the
  entry's `@runtime` value wins over style-imported modules for the same custom property, while
  compile-time local-over-import override still applies
  ([ADR-0016](docs/decisions/ADR-0016-runtime-token-override.md)).
- Class prefixing (`none` and `prefix` strategies), simple `:global(.class)` escapes, deterministic
  class maps with camelCase aliases, literal types and `__proto__` safety.
- Module-side map-inheritance opt-out: `@setup { map-inherit: false; }` (JSON `output.mapInherit`)
  keeps a style-merged module's class bindings out of the importer's `map.js`, `.d.ts` and
  `classes` while its rules still merge in cascade order; excluded bindings cannot raise
  `XESSA4001`, the module's own entry map is unchanged, and `module: true` + `map-inherit: false`
  is a silent escape hatch for rule-only modules
  ([ADR-0020](docs/decisions/ADR-0020-map-inheritance-opt-out.md)).
- Opt-in CSS side-effect import in the class map: `@setup { import-css: true; }` (`output.importCss`,
  default `false`) makes `map.js` start with one relative `import "./x.css";` naming the emitted
  stylesheet, so bundlers that carry CSS through imports can import the map alone. The specifier is
  computed from the map file to the planned CSS; with a `css-dir` list the first destination is
  imported, and no import is emitted when CSS is disabled. `.d.ts` stays pure declarations
  ([ADR-0021](docs/decisions/ADR-0021-opt-in-css-import.md)).
- Owner-locked decisions: bare nested selectors are descendants (D1), `!important` binds per inline
  segment (D2), conditional blocks are rule-scoped (D3).
- Minified CSS output by default ([ADR-0022](docs/decisions/ADR-0022-minified-output-default.md)):
  generated structural whitespace is compacted while authored tokens and declaration order are
  preserved. Opt out with `@setup { minify: false; }`, project `output.minify: false`, or
  `--no-minify`; `--minify` still forces compact output. `format()` and source formatting are
  unchanged.
- Opt-in media-run merging: `mediaGrouping: "merge"` (`@setup { media-grouping: merge; }`) keeps the
  default `safe` adjacent pass and also merges same-selector/same-condition conditional runs across
  declarations whose property families are provably disjoint. It never crosses a shared family,
  `all`, a `var()` value, a different selector or condition, or a native context; the default stays
  `safe`, so existing output is byte-identical
  ([ADR-0024](docs/decisions/ADR-0024-media-merge-grouping.md)).
- Native at-rule pass-through: `@media`, `@supports`, `@layer`, `@container`, `@keyframes`,
  `@font-face`, `@property`, `@page`, plus statement at-rules. Xessa transformations inside
  restricted contexts are rejected with diagnostics.
- Source-preserving cascade: base then variants in authored order, no reordering, safe adjacent
  grouping only.

### Compiler API (`@xessa/compiler`)

- Public `parse`, `compile`, `compileProject` and `planOutputs`, returning artifacts and diagnostics
  without writing files; zero runtime dependencies; Node ≥ 20 and Bun.
- Opt-in CSS v3 source maps (`source-map: true`) with `sourcesContent`, workspace-relative sources and
  a `sourceMappingURL` comment; `CompileResult.sourceMap` carries the serialized map.
- Injected `ModuleHost` (default Node host exported) and canonical-path containment.
- Frozen, immutable AST/IR and deterministic output; spans preserved for diagnostics and tooling.
- Stable `XESSA####` diagnostic families: syntax, symbols/modules, media, naming, output planning.
- Output planning validates overlap, duplicates, workspace and symlink escapes before writes.

### CLI (`@xessa/cli`)

- `xessa build`, `check`, `watch`, `clean`, `format`.
- `xessa format [file]` reprints sources canonically in place; `--check` reports without writing and
  exits 1 on changes, `--dry-run` reports the same; parse errors leave the file untouched.
- Optional project configuration: `xessa build` works without `xessa.config.json`, using the nearest
  `package.json` workspace root and `include` default `["**/*.cssx"]`; `compiler.strict` defaults to
  `true` (unknown keys exit 2) and `mediaGrouping` is explicitly `"safe"`. Imported modules
  self-declare with `@setup { module: true; }`, and the examples no longer restate defaults
  ([ADR-0023](docs/decisions/ADR-0023-zero-config-defaults.md)).
- `xessa.config.json` discovery and schema validation (strict unknown-key rejection by default),
  zero-dependency include/exclude globs, kebab↔camel configuration mapping.
- Atomic per-file writes, `.cssx-manifest.json` ownership, safe `clean`, stale-build handling and
  retained last-good outputs on failure.
- Debounced watch with reverse import graph, config reload, deleted-entry pruning, stale-generation
  guard and NDJSON output.
- Exit codes `0` success, `1` compile/validation/write error, `2` invocation/config error.
- `--config`, `--json`, `--dry-run`, `--minify`, `--no-minify`, `--help`, `--version`; CLI minify
  flags override file `@setup` with a warning.
- The published `bin` points at the built `dist/index.js`; source and build use the
  `#!/usr/bin/env node` shebang, so a symlinked `xessa` runs on a Node-only machine and Bun executes
  the same file. Node smoke tests run the built CLI under plain Node.

### VS Code extension

- `xessa` language ID, `.cssx` files, standalone TextMate grammar and language configuration
  (comments, brackets, auto-closing, indentation); X/S monogram marketplace icon and light/dark
  `.cssx` file icons.
- Diagnostics from a tolerant parse plus in-memory compile, debounced, with stale-document discard
  and imported-file problem routing. `@setup { module: true }` is understood (ADR-0014).
- Completions for properties, values, media aliases, `$` tokens and namespace members, setup keys,
  import paths, selectors and pseudos; hover, definition, references, single-file `$token` rename,
  single-file class-selector rename inside `.cssx` (every non-global occurrence of the same authored
  name, nested/comma/`:is()`/`:not()`/`:has()` shapes included; the map/`.d.ts` and JSX follow the
  next build, so TypeScript catches a changed binding but literal `className="…"` strings are not),
  single-file id-selector rename inside `.cssx` (every occurrence of the id name, leading `#` kept,
  `:global(#x)` included; JSX/HTML `id="…"` anchors and inbound links are not updated and ids are
  not mapped), colors and outline.
- Editor intelligence wave (CSSX-A45–A51): completions recover after `@setup`, inside `@keyframes`
  and right after `property:`; `&` reopens selector completions; six missing animation longhands are
  present; the 25 curated CSS functions are offered in value context (and on a typed `(`) and
  documented by hover; accepting a property writes `property: ;` with the caret before the
  semicolon; CSS units complete in value position; color properties offer the 148 standard named
  colors plus a curated 35-entry hex palette, all as `color` items so the suggest widget shows
  swatches, and named colors are served by the document color provider as well as hex values.
- `!` completion (CSSX-U07): typing `!` after a declaration value suggests `!important`; accepting
  repairs the typed bang instead of stacking a second one, `!im` filters to the item, and selectors,
  property-name positions and empty values offer nothing.
- Id selector completion (feature 26): typing `#` in selector position lists the document's own ids
  in first-appearance order as `selector` items (`#panel`, detail `id selector`); accepting replaces
  the typed `#…` prefix so exactly one `#` remains. Ids are document-global and never renamed or
  mapped; a value `#` on a colour property keeps the colour/hex list only.
- Find All References is bidirectional for `$token` and `@runtime` tokens (board bug 27): from a
  definition it returns the definition plus every resolving use in direct importers, and from a use
  site it returns the same set across workspace `.cssx` files. Resolution decides inclusion
  (namespaced aliases, unqualified/style imports); local shadows and ambiguous unqualified imports
  are excluded, declarations are deduped and sorted, and `includeDeclaration` is honoured. The scan
  is on demand, bounded to 200 candidates and skips `node_modules`/`dist`/`generated`; rename remains
  single-file.
- `@group.<name>` hovers render defaults as a real multi-line bullet list (one declaration per line,
  authored order and spacing) and, at a use site, list overriding property names in a separate
  **Overrides at this use site** section (CSSX-F23).
- `@setup { media-grouping: …; }` completes its three values (`merge`, `safe`, `none`) with per-mode
  detail and a Markdown hover card explaining the grouping modes, the `safe` default and ADR-0024
  (owner request; CSSX-MEDIA-MERGE).
- CSS property and value completion now works inside `@group.<name>` definition and use-site bodies
  (board bug 25), so a declaration start in a group suggests the same property set as a rule body
  (CSSX-FIX-GROUP-COMPLETE).
- Semantic token colorization with no configuration (CSSX-COLOR-TOKENS): compile-time `$token`
  references, runtime tokens and `--var` references, the `$ns` prefix of a namespaced reference (the
  member colored by its resolved kind) and resolved `$keyframes.<name>` members are colored by the
  active theme. `contributes.semanticTokenScopes` maps each kind to a common theme scope
  (`variable.language`, `entity.name.type`, `keyword.control`, `entity.name.function`); the
  extension README documents the literal `editor.semanticTokenColorCustomizations` palette as the
  override, which outranks the scope fallback. Media variant markers (`@md`, `@dark`, `@xl+dark`,
  block headers and `@media-types` captions) use the `markup.deleted` scope and paint orange/red.
- Commands: Compile File, Build Project, Preview Compiled CSS (in memory), Open Generated CSS, Open
  Class Map, Check Project; status bar, `Xessa` output channel, multi-root config resolution,
  format-on-save (`xessa.editor.formatOnSave`, off by default) and quick fixes.
- Workspace-trust respect and compile-on-save **off by default**.
- Extension-host smoke suite via `@vscode/test-electron` with a documented macOS launcher workaround.

### Changed — breaking for class-map consumers

- **Class map format (CSSX-A52).** The generated `.map.js` is now one
  `export const <camelCase> = "<emitted>";` per class, with no default export and no object literal,
  so consumers import the binding directly (`import { contactPanel }`). Names split on `-`/`_`;
  digit-leading/reserved identifiers get a `_` prefix and duplicate identifiers get `_2`, `_3`
  suffixes, each with a `XESSA4001` warning instead of a hard error. TypeScript declarations are now
  opt-in and default off: `@setup { map-types: true; }` /
  `"output": { "mapTypes": true }` writes the matching `export declare const` lines (the previous
  `emit-types`/`emitTypes` spelling is accepted as a deprecated alias). `map-name`/`map-dir` behavior
  is unchanged. Existing consumers of the default-object map must regenerate and update imports.
- **Class maps no longer import CSS by default.** The unconditional `import "../styles/x.css";`
  side-effect line is gone, so maps are importable by plain Node with no CSS loader. Load the
  stylesheet explicitly (`<link rel="stylesheet">` or `import "./x.css"`), or opt back in per file
  or project with `import-css` / `output.importCss` ([ADR-0021](docs/decisions/ADR-0021-opt-in-css-import.md)).

### Fixed

The 19-defect integration campaign ([CSSX-FIX-INTEGRATION](.ai/reports/CSSX-FIX-INTEGRATION.md))
closed formatter terminator/sigil bugs, nesting and span bounds, CLI watch/clean/exit-code gaps, and
editor analysis/completion repairs:

- Formatter: an at-rule prelude that leaves a `[`/`(` open no longer reabsorbs the printed `;`, so
  `format` is a fixed point and the reparsed IR matches (CSSX-T01).
- Formatter: adjacent `@`-markers keep the authored variant split, so `format` no longer turns one
  variant into two (CSSX-T02).
- Compiler: an invalid `$` setup prefix no longer produces a `XESSA2001` span past the end of the
  source; generated `$` text is not re-reported as an authored reference (CSSX-T03).
- Compiler: `&` flattening is bounded per rule at 8 388 608 characters / 100 000 selectors, failing
  one over-budget rule with a single `XESSA1001` that names the nesting depth instead of hanging
  (CSSX-T04).
- Formatter: the authored `$` sigil is re-emitted for namespaced token declarations
  (`$layout.margin`), so formatting no longer loses the declaration (CSSX-T05).
- Compiler and editor: a single-file document with duplicate `@variables`/`@runtime` keys or a
  compile-time/runtime name collision now reports exactly one `XESSA2001`, and a token rename onto an
  existing name is refused before any edit (CSSX-U04).
- CLI: `watch` latches wakeups that arrive mid-build and always records the artifacts that landed, so
  edits are not dropped and the manifest matches the tree (CSSX-T06).
- CLI: `build` and `clean` sweep the writer's own `.<artifact>.<pid>.<n>.cssx-tmp` pattern, so an
  interrupted build leaves no residue (CSSX-T07).
- CLI: a newly created nested source directory triggers rediscovery and is watched without a restart
  (CSSX-T08).
- CLI: a project whose include globs match no `.cssx` file is a configuration error — exit 2 with the
  text and JSON diagnostics — instead of a silent green build (CSSX-T09).
- CLI: `clean` only deletes records that are artifact-shaped and point at an in-workspace `.cssx`
  source, closing the manifest-provenance delete primitive (CSSX-T10).
- CLI: a value flag no longer consumes a following option, so `--config --json` reports a missing
  path (as JSON when `--json` came first) (CSSX-T11).
- CLI: `check --dry-run` is rejected with exit 2 instead of being silently ignored (CSSX-T12).
- Editor: `@group`/`@keyframes` closures in cyclic import graphs are resolved in sorted canonical-path
  order through the shared memo, matching the compiler's visibility (CSSX-T13).
- Editor: the `$`-namespace completion item is `$theme.` (label and insert), preserving the sigil when
  accepted (CSSX-U01).
- Editor: nested-selector starters replace a typed lone `&`, so accepting `&:hover` yields `&:hover`,
  never `&&:hover` (CSSX-U02).
- Editor: a `&.` class context lists class names only, so accepting one keeps the typed dot
  (CSSX-U03).
- Editor: `$tokens` inside `@group` definition and use-site bodies now have hover, definition,
  references and rename (CSSX-U05).
- Editor: `Preview Compiled CSS` on a document with no producible CSS shows the existing warning and
  opens no empty preview tab (CSSX-U06).
- Editor: an open importer re-analyzes when an imported `.cssx` module changes or is saved, so
  renaming a `$token`/`@runtime` member surfaces `XESSA2001` at the importer without retyping it
  (board bug 26, CSSX-STALE-DIAGS).

### Verification

- Unit, integration, golden, Node smoke and extension-provider suites; aggregate `bun run verify`
  recorded **1351 pass / 2 skip / 0 fail** across 99 files, including the VS Code extension-host
  smoke suite **15 scenarios / 928 assertions**.
- Playwright computed-style gate on Chromium, Firefox and WebKit: **96/96** recorded pass (32 per
  engine) across viewport boundaries, themes, reduced motion, interactions, specificity, safe
  grouping and minified parity.
- Performance benchmarks for 100 and 1,000 files recorded in `docs/performance.md`.

### Documentation and examples

- Full README, grammar, cascade, configuration, compatibility, performance and known-limitations
  documentation; ADRs 0001–0024, including the `.cssx` source-extension decision (ADR-0013),
  `css-dir` output lists (ADR-0019), module-side map inheritance (ADR-0020), the opt-in class-map
  CSS import (ADR-0021), minified output by default (ADR-0022), zero-config defaults (ADR-0023) and
  opt-in media grouping (ADR-0024).
- `docs/usage.md`: an end-to-end guide to installing, the language tour, outputs, the CLI reference,
  VS Code settings (including watcher-free build-on-demand flows), and a runtime-token theme recipe.
- Nine buildable examples with committed generated output: `basic`, `responsive`, `variables`,
  `jsx`, `custom-output`, `overrides`, `groups`, `portfolio` (full showcase page with runtime
  theme switch) and `modules` (no `exclude` list: self-declared `module: true` files, one merged
  stylesheet, `map-inherit: false` and a two-destination `css-dir` list).
- `release:check` aggregate script for verify, browser tests, tarball checks, the nine example
  builds and extension packaging.

### Known issues

- Project-level output directories repeat the workspace-relative source path (for example
  `dist/styles/src/…`).
- No mixins, container aliases, inline pseudo-state modifiers, hashing or file-scoped naming.
- See [docs/known-limitations.md](docs/known-limitations.md) for the complete, current list.
