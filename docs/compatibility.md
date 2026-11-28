# Compatibility matrix (v0.1)

Xessa is a CSS-first language, but it is **not** a claim of full CSS compatibility. The v0.1
compatibility position is: avoid claiming full CSS compatibility until tested. This page lists what
is implemented and verified in v0.1, what is deliberately limited, and what is not supported yet.

Legend: **Tested** names the suite that exercises the behaviour. Untested behaviour is marked as
such rather than assumed.

## 1. Language features

| Feature | v0.1 status | Notes | Evidence |
|---|---|---|---|
| Base declarations and CSS values | ✅ Supported | Values are preserved as balanced CSS token sequences, including `calc()`, `url()`, functions, strings, comments and escapes. | `tests/compiler/**`, golden fixtures |
| Inline media variants (`padding: 8px @md 16px`) | ✅ Supported | Expand to independent CSS declarations in authored order. | `tests/compiler/media.test.ts` |
| Combined aliases (`@xl+dark`) | ✅ Supported | Logical AND; duplicate aliases normalised. | `tests/compiler/media.test.ts` |
| Rule-scoped conditional blocks (`@md { … }`) | ✅ Supported | Nest and combine conditions. | `tests/compiler/lowering.test.ts` |
| Top-level conditional blocks | ❌ Rejected | `XESSA1001` "conditional block outside rule"; no CSS emitted for the block. | `tests/compiler/**` |
| File `@media-types` aliases | ✅ Supported | Merged over project and built-in aliases; one expression per alias. | `tests/compiler/media.test.ts` |
| Comma-list alias definitions | ❌ Rejected | `XESSA3001`; native media lists inside a native `@media` prelude still pass through. | `tests/compiler/media.test.ts` |
| Nested selectors | ✅ Supported | `&:hover`, `&::before`, `&:nth-child(2n)`, `& > .icon`, `& + .button`, `&.is-active`, bare descendant (D1). Flattened to flat CSS. | `tests/compiler/selectors.test.ts` |
| Native selectors (incl. attribute selectors) | ✅ Pass-through | Selector text is preserved for presence, quoted/unquoted equality, the `~=`, `^=`, `$=` and `*=` operators, the dash-match form, case flags `i`/`s`, namespaces and whitespace variants; values are never rewritten. Prefixing/renaming apply only to class tokens outside the brackets, attribute selectors never enter the class map, and `&[aria-expanded="true"]` composes with nesting. Exotic combinations remain tested, not complete (§4). | `tests/compiler/attribute-selectors.test.ts`, `tests/compiler/naming.test.ts`, `tests/browser/specs/interactions.pw.ts` |
| Mixed-specificity parent lists | ✅ Supported | Uses `:is(...)` where native nesting requires it; pseudo-element lists that cannot be represented are rejected rather than mis-flattened. | `tests/compiler/selectors.test.ts` |
| Compile-time variables | ✅ Supported | Token-sequence substitution; forward references; cycles and undefined tokens are `XESSA2001`. | `tests/compiler/**` |
| `@use` imports | ✅ Supported | Relative, workspace-contained, namespaced or unqualified, token-only by default, no transitive re-export, no network/executable imports. | `tests/compiler/**` |
| Rule-merge imports (`@use … styles`) | ✅ Supported | Optional `styles` clause merges the module's rules (ADR-0014): merged rules keep the module's own prefix, imported modules emit first in depth-first `@use` order, one merged map/`.d.ts`, conflicts are `XESSA4001`; `@setup { module: true }` suppresses a module's own artifacts. | `tests/compiler/merge.test.ts`, `modules.test.ts`, `tests/fixtures/modules/merge/` |
| Keyframe name references (`$keyframes.<name>`) | ✅ Supported | A top-level `@keyframes <name>` registers the name; `animation-name: $keyframes.spin` compiles to `animation-name: spin` beside the native block. Visible names are the file's own plus those of `@use … styles` modules; unknown members, bare `$keyframes` and `as keyframes` aliases are `XESSA2001` with the declaration omitted. Duplicate names across merged modules are not errors (ADR-0015). | `tests/compiler/keyframes.test.ts`, `tests/fixtures/keyframes/` |
| Runtime variables (`@runtime`) | ✅ Supported | Emit `:root` custom properties, conditional overrides and `var(--prefix-name)` references. Duplicate property names across the entry and style-imported modules resolve in merge order — entry last, later module wins — with no conflict diagnostic (ADR-0016). | `tests/compiler/runtime.test.ts`, `tests/fixtures/runtime/`, `tests/browser/specs/themes.pw.ts`, `examples/variables` |
| Class prefixing (`prefix` strategy) | ✅ Supported | Prefix applies to local classes, including nested references. Empty prefix leaves names unchanged. | `tests/compiler/**`, browser pages |
| `:global(.external)` escape | ✅ Supported (simple classes) | Removed from renaming and exports; emitted unchanged. Complex global selectors are not supported. | `tests/compiler/**` |
| Class maps + `.d.ts` | ✅ Supported | Quoted original keys, camelCase named exports, literal string types, readonly map. The map imports its stylesheet by default, so plain Node needs a CSS loader — see [known-limitations.md](known-limitations.md) §2. | `tests/compiler/**`, `examples/jsx` |
| Export collisions (`foo-bar` / `fooBar`) | ✅ Rejected | `XESSA4001`; no silent merge/omission. | `tests/compiler/**` |
| `__proto__` class key | ✅ Safe | Null-prototype map and computed-key handling. | `tests/compiler/**` |
| Minified output | ✅ Supported (opt-in) | Compacts generated whitespace; computed styles equal pretty output in all browser scenarios. | `tests/browser/specs/parity.pw.ts` |
| Safe grouping | ✅ Supported (default) | Merges adjacent compatible runs only; computed styles equal `mediaGrouping: "none"`. | `tests/browser/specs/grouping.pw.ts` |
| Merge grouping (`mediaGrouping: "merge"`) | ✅ Supported (opt-in) | Merges same-selector/same-condition conditional runs across provably disjoint property families; computed styles equal `none`/`safe` in the browser differential (ADR-0024). | `tests/browser/specs/grouping.pw.ts`, `tests/compiler/media-merge.test.ts` |
| CSS source maps | ✅ Supported (opt-in) | `source-map: true` writes a v3 `<css-name>.map` with declaration-level mappings (one per emitted selector and declaration), `sourcesContent` and a `sourceMappingURL` comment; no map when CSS emission is off. | `tests/compiler/sourcemap.test.ts`, `mapgen.test.ts`, `examples/custom-output` |
| Formatter | ✅ CLI only | `xessa format [file]` reprints sources canonically in place and is idempotent; `--check` writes nothing and exits 1 when a file would change; `--dry-run` reports. Parse errors return the input unchanged. The VS Code extension does not yet expose a formatting provider. | `tests/integration/format-cli.test.ts`, `tests/compiler/formatter.test.ts` |
| Reusable declaration groups (`@group.<name>`) | ✅ Supported | Top-level definitions plus rule-body use sites (ADR-0017, ADR-0025, SPECIFICATION §3.7). A definition emits no CSS and may compose another group; a use site expands at compile time to the definition's effective declarations (composition included) followed by the block's overrides in authored order, at the authored position, as one declaration run. Composition resolves in the defining module, expands textually on every path, and reports cycles or depth beyond 64 as `XESSA2001` at the offending statement. No new runtime concept and no generated code: the output is ordinary CSS declarations that engines cascade normally. The group Playwright scenarios (G4b) are not part of the recorded browser matrix yet. Visible names are the file's own plus those of `@use … styles` modules; token-only imports expose none; `@use … as group` and `$group.<name>` are `XESSA2001`. | `tests/compiler/groups.parser.test.ts`, `tests/compiler/groups.resolver.test.ts`, `tests/compiler/groups.expansion.test.ts` |
| Mixins / `@apply` | ❌ Deferred | `@group.<name>` ships, but only in its non-parametric form (row above). `@apply` and parameterised mixins are not in the grammar and require a future ADR. | SPECIFICATION §3.7, §13 |
| Arbitrary expressions | ❌ Deferred | Variables substitute tokens, not computed expressions. | SPECIFICATION §13 |
| Container aliases | ❌ Deferred | `@container` itself passes through natively; Xessa aliases for containers do not exist. | SPECIFICATION §13 |
| Inline pseudo-state modifiers | ❌ Deferred | Write `&:hover { … }` (supported) rather than a modifier alias such as `@hover`. | SPECIFICATION §13 |
| Hashing / file-scoped naming | ❌ Deferred | Only `none` and `prefix` strategies exist. | ADR-0010 |
| Attribute-based theme conditions | ❌ Deferred | Use `@media-types` with a media expression, or native selectors. | SPECIFICATION §13 |
| Explicit token defaults / shared runtime bundles | ❌ Deferred | Runtime tokens emit per consuming entrypoint. | SPECIFICATION §6.2 |
| Top-level conditional blocks | ❌ Deferred | D3 may be revisited by a future ADR. | ADR-0004 |
| `xessa.config.ts` | ❌ Not supported | Declarative JSON only; no executable project config. | SPECIFICATION §10 |

## 2. Native at-rules

Native CSS at-rules keep their native meaning. Xessa wrappers never rewrite their preludes.

| At-rule | Status | Notes |
|---|---|---|
| `@media` | ✅ Pass-through | Native lists (`@media screen, print`) pass through unchanged; Xessa conditions AND with the enclosing native prelude. |
| `@supports` | ✅ Pass-through | Conditions never alter Xessa alias resolution. |
| `@layer` | ✅ Pass-through | Block and statement forms; grouping never crosses a layer boundary. |
| `@container` | ✅ Pass-through | Native container queries; no Xessa container aliases. |
| `@keyframes` | ✅ Pass-through, restricted | Keyframe steps pass through; inline modifiers and conditional blocks inside are rejected (`XESSA3001`). `@keyframes <name>` also registers `$keyframes.<name>` (ADR-0015). |
| `@font-face` | ✅ Pass-through, restricted | Descriptor declarations pass through; Xessa transformations inside are rejected. |
| `@property` | ✅ Pass-through, restricted | Descriptors pass through; Xessa transformations inside are rejected. |
| `@page` | ✅ Pass-through | Classic declaration blocks pass through without diagnostics. |
| `@import`, `@charset`, statement `@layer` | ✅ Pass-through | Emitted as statements where they appear. |

Unsupported Xessa transformations inside restricted contexts are **rejected with a diagnostic**, not
silently altered.

## 3. Tooling and environments

| Area | Status | Notes |
|---|---|---|
| Compiler runtime | ✅ Node ≥ 20 and Bun | Verified on Node `24.22.3` and Bun `1.4.5`. Zero runtime dependencies. |
| CLI build/check/watch/clean | ✅ Supported | Exit codes 0/1/2; atomic writes; manifest-owned clean; debounced watch with reverse import graph. |
| CLI `format` | ✅ Supported | Canonical source reprint with `--check` and `--dry-run`; parse errors leave the file untouched. No editor formatting provider yet. |
| Node package entry | ✅ Node-compatible | `dist/index.js` is Node ESM and is the package `bin` target (no TypeScript loader); the source and built entry use the `#!/usr/bin/env node` shebang, so a symlinked `bin` runs on a Node-only machine and Bun runs the same file. |
| VS Code extension | ✅ Implemented | Language ID `xessa`, TextMate grammar, language configuration, diagnostics, completions, hover, definition/references/rename, colors, outline, six commands, preview. Tested on VS Code `1.147.0`; the manifest declares `^1.85.0`, older versions are untested. |
| Compile on save | ⚠️ Off by default | Opt-in `xessa.compileOnSave`, requires a trusted workspace; no watcher is started by the extension. |
| Restricted Mode | ✅ Read-only features only | Diagnostics, completion, hover, preview and check work; writing commands are blocked. |
| CSS language-server projection | ❌ Not implemented | The extension does not embed `vscode-css-languageservice`; hover and completion documentation use the built-in one-sentence table for 197 standard properties and 43 curated vendor-prefixed spellings, and property/value completions are curated lists. Full css-languageservice data (all properties, MDN links) is intentionally not embedded. |
| Cross-module / cross-file rename (CLI or editor) | ❌ Not implemented | Single-file `$token` rename is supported; namespace members and class rename across JSX are refused. |
| Class rename across JSX | ❌ Not implemented | Generated names change on prefix changes; update consumers manually. |
| Browser cascade verification | ✅ Chromium, Firefox, WebKit | 96/96 Playwright tests recorded pass, 32 per engine (CSSX-BROWSER-01). |

## 4. Known semantic limits worth stating plainly

- **No full CSS compatibility claim.** Xessa accepts native CSS constructs it has tested; exotic
  selector or at-rule combinations outside the test suite may fail rather than pass through.
  Unsupported input is diagnosed where the compiler understands it; it is not guaranteed to be
  diagnosed everywhere.
- **No cascade repair.** Authored order is preserved, including a later base overriding an earlier
  conditional (see [cascade.md](cascade.md)).
- **Groups are not mixins.** `@group.<name>` takes no parameters, arguments or interpolation, has no
  conditional use-site form, and composition is allowed only as a definition-body statement (never
  in a use-site block). A use site is expanded, never analysed; the full v1 exclusion list is in
  [known-limitations.md](known-limitations.md).
- **Output paths** in project mode repeat the workspace-relative source path (for example
  `dist/styles/src/deep/widget.css`). File-level `@setup` directories are exact.
- **Tokenizer coverage** is tested against `url("image@2x.png")`, strings containing `@dark`,
  `calc()`, comments and escapes; it is not a formal proof of all CSS lexical edge cases.

## See also

- [known-limitations.md](known-limitations.md) — the same gaps with operational impact.
- [grammar.md](grammar.md), [cascade.md](cascade.md), [configuration.md](configuration.md).
- [SPECIFICATION.md](../SPECIFICATION.md) §13 (Deferred).
