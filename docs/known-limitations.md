# Known limitations (v0.1)

This page collects the gaps that matter operationally. It is intentionally blunt: v0.1 is a usable
MVP, not a finished CSS toolchain. The compatibility matrix in [compatibility.md](compatibility.md)
lists language features in more detail.

## 1. Unimplemented P7 work

| Gap | Effect | Status |
|---|---|---|
| Editor formatting | Format Document (⌥⇧F) and `xessa.editor.formatOnSave` run the compiler's canonical whole-document formatter; parse errors leave the document unchanged. Range formatting and format-on-type are not available because `format` is a document-level parse→print pass. | Document-level only |
| Editor CSS intelligence | The extension does not project Xessa onto `vscode-css-languageservice`. Hover and completion documentation come from a built-in one-sentence table for 197 standard properties and 43 curated vendor-prefixed spellings; property/value completions are curated lists, not a full CSS database. | Projection deferred |
| Cross-module rename (tokens, classes, ids) | `$token`, class and id rename stay single-file: a class rename rewrites every non-global occurrence of the same authored name in the current `.cssx`, and an id rename rewrites every occurrence of the id name in that document. Namespace members are refused, and class/id rename across files or JSX does not exist. Group and keyframe rename are the exception and span the current document's visible modules (§5). | Partial |
| LSP server | Only the VS Code extension is provided; there is no language server for other editors. | Deferred |

## 2. Release and packaging gaps

| Gap | Detail |
|---|---|
| Generated maps and style loading | Class maps contain only named exports; they never import the stylesheet, so plain Node imports them directly. The page must load the generated CSS itself (`<link rel="stylesheet">` for static sites, or an explicit `import "./x.css"` in a bundler entry). See `tests/stress/consumer/esm-consumer.test.ts`. |

The v0.1 packaging blockers are closed. `@xessa/cli`'s `bin` points at the built `dist/index.js`
(Node-compatible ESM, no TypeScript loader), and the source and build carry the
`#!/usr/bin/env node` shebang, so a symlinked `bin` runs on a Node-only machine and Bun executes the
same file. `.vscodeignore` keeps `src/`, `test/` and `tsconfig.json` out of the VSIX, which now
carries the runtime payload — `out/`, `dist/`, `syntaxes/`, `media/`, `language-configuration.json`,
`LICENSE` and `README.md` — at 18 files / 140.6 KB instead of 84 files / 309.78 KB.

Package versions (`0.1.2` live on npm for `@xessa/compiler`/`@xessa/cli`; `0.1.0` for the VS Code
extension), package-level `README.md`/`LICENSE` copies and the unscoped extension name (`xessa`) were
resolved for v0.1; `bun run release:check` asserts all three.

## 2a. Source extension

`Xessa` source files use `.cssx` ([ADR-0013](decisions/ADR-0013-cssx-file-extension.md)). The language
ID, packages, CLI command, `xessa.config.json` and `XESSA####` diagnostics keep the Xessa name. There
is no legacy extension alias, dual registration or migration path in v0.1.

## 3. Output and build behaviour

| Limitation | Detail |
|---|---|
| Project output mirrors the workspace path | With `include: ["src/**/*.cssx"]` and `output.cssDir: "dist/styles"`, `src/deep/widget.cssx` becomes `dist/styles/src/deep/widget.css`. The `src/` segment is repeated. File-level `@setup` directories are exact and do not have this issue. |
| No CLI path overrides | Only `--minify`/`--no-minify` override output. `--css-dir`-style flags are not implemented; path overrides remain an API-only concept. |
| `compileProject` does not read config | It accepts `output`/`naming`/`media`/`projectRoot`; `xessa.config.json` loading belongs to the CLI. Programmatic users must load and map the file themselves. |
| CLI duplicates setup resolution | `CompileResult` exposes no output plan or effective setup, so the CLI re-derives both with `parse` + `planOutputs`. A divergence would show up as wrong destinations; the fixture tests pin the current behaviour. |
| Manifest location | Fixed at `<workspaceRoot>/.cssx-manifest.json`. The strict config schema has no key to move it. |
| Build overwrites configured destinations | `build` treats configured output paths as explicit authorisation and overwrites them even when the manifest does not own them. `clean` is conservative: it deletes only matching, unmodified, manifest-owned files whose path is artifact-shaped for its kind and whose `source` is an in-workspace `.cssx`; anything else is skipped as `untrusted` and released. |
| No external output | The specification allows a future trusted policy for writing outside the workspace; the v0.1 planner always rejects it. |
| Source-map/diagnostic gap | The CLI decodes simple `\x` escapes for planning while the compiler performs full CSS unescaping. A path authored with hex escapes could plan differently. |
| Watch is not recursive | `fs.watch` is attached per directory (portable); coverage comes from source directories and include prefixes and is refreshed after each build. A **brand-new** directory is picked up through its parent's event: a non-artifact event triggers a full rediscovery, watchers attach to the new tree, and its sources build without a restart. Generated artifacts, the manifest and writer temporaries are ignored. |
| Empty discovery is an error | A project run whose include globs match no `.cssx` file exits 2 instead of succeeding with an empty build, so a moved source tree cannot pass CI silently. Single-file runs are unaffected. |
| Interrupted writes | A crash between writing an artifact's temporary and renaming it can leave `.<artifact>.<pid>.<counter>.cssx-tmp` behind. The next `build` or `clean` sweeps that writer-owned pattern from the output directories; user files never match. |
| `compileProject` roots must be canonical | `projectRoot` is compared literally against the canonical path of each discovered entry. A lexical root that differs from the kernel's spelling (macOS `/tmp` → `/private/tmp`, `/var/folders/…` → `/private/var/folders/…`) makes an in-workspace import report `XESSA2001 … resolves outside the workspace root`. API consumers behind a symlinked workspace must pass a `realpath`ed root; the CLI is immune because `process.cwd()` is already canonical. Evidence: `.ai/reports/CSSX-TT3.md` “Sharp edge”, `.ai/reports/CSSX-TT6.md` O2. |
| Cycle diagnostics embed the whole import path | A module cycle reports one typed `XESSA2001 "Import cycle detected"` whose message lists every module in the path: a 500-module graph yields a single **13 936-character** message. Bounded and deterministic (the span already identifies the entry) but noisy in editors and logs. Evidence: `.ai/reports/CSSX-TT2.md` “Observation O1”, `tests/stress/scale/modules.test.ts:126`. |
| Single writer | The extension never starts a watcher; compile-on-save is off by default. If you enable it while a CLI watcher is running, you own the coordination. |

## 4. Language limitations

| Limitation | Detail |
|---|---|
| `@group` v1 exclusions | Groups ship only in the narrow form of [ADR-0017](decisions/ADR-0017-reusable-declaration-groups.md) and [SPECIFICATION.md](../SPECIFICATION.md) §3.7. Use sites are **unconditional**: `@group.x @md+dark { … }` and conditional definitions are `XESSA1001`. Both blocks take **declarations only**; a nested rule, conditional block or native at-rule inside a definition or use site is `XESSA1001`. There is **no `@apply`**, groups take **no parameters, arguments or interpolation** (they are not mixins), and a group **cannot reference another group**. `@use … as` never addresses groups, and groups are not re-exported: visibility is exactly the module's own top-level definitions plus the transitive `styles` closure. The **bare include `@group.<name>;`** does not exist (`XESSA1001`), and **`$group.<name>` is not a value** (`XESSA2001`). Defaults are compile-time only: a `@runtime` reference in a default is `XESSA2001`, so runtime customization is authored at the use site. |
| No mixins / `@apply` | `@apply` and parameterised mixins are deferred; `@group.<name>` is the shipped, non-parametric form. |
| No arbitrary expressions | Variables substitute token sequences; there is no computation. |
| No container aliases | Native `@container` passes through, but Xessa aliases for container queries do not exist. |
| No inline pseudo-state modifiers | Use `&:hover { … }`; a modifier alias such as `@hover` is not supported. |
| No hashing/file-scoped naming | Only `none` and `prefix` strategies exist (ADR-0010). |
| No top-level conditional blocks | Rejected by design (D3); write conditions inside rules. |
| One media expression per alias | Comma lists and some `not`/`only` combinations are rejected rather than emitted. Native media lists pass through. |
| Runtime tokens per entrypoint | Imported runtime tokens are emitted in each consuming entrypoint. Within one build, duplicate custom-property names resolve in merge order (entry last; later module wins) with no diagnostic (ADR-0016). Collision handling across separate outputs/entrypoints is not implemented yet. |
| Simple `:global` only | `:global(.class)` is supported; complex global selectors are not. |
| Export identifier collisions are warnings | `foo-bar` and `fooBar` both map to `fooBar`; the first keeps it, the later one becomes `fooBar_2`, and one `XESSA4001` **warning** names both. No class is dropped and the build does not fail (CSSX-A52). |
| Keyframe references need a rule-merge import | `$keyframes.<name>` sees the file's own top-level keyframes plus those of `@use "…" styles` modules. A token-only import's keyframes are not referenceable (`XESSA2001`) because that module's CSS is not emitted; the `@variables { spin: spin; }` fallback still works. Two merged modules may define the same name — both blocks are emitted and native cascade order decides (ADR-0015, [ADR-0018](decisions/ADR-0018-keyframes-visibility-and-exclusions.md)). |
| String-named and conditional keyframes | `@keyframes "fade"` is rejected (names are identifiers) and a `@keyframes` block nested in a rule or another at-rule block is not collected; both stay native-only and cannot be referenced as `$keyframes.<name>`. There is no plan to change this in v0.1 (ADR-0018). |
| Native CSS coverage is tested, not complete | Supported at-rules and selectors are listed in [compatibility.md](compatibility.md); exotic combinations may be rejected or pass through untested. |
| Selector expansion is bounded | Repeated `&` multiplies the flattened selector product: 4/6/8/10/12 nested `& &` levels measure 66/210/786/3 090/12 306 B. Flattening is capped at **8 388 608 characters / 100 000 selectors per rule**, so a 1 000-level `& &` chain fails in seconds instead of hanging. An over-budget rule is dropped with one **XESSA1001** whose message names the limit and nesting depth, and the rest of the file still compiles. The code reuses the syntax family anchor; a finer `XESSA1004` subcode is a recorded optional follow-up. Evidence: `tests/compiler/nesting-bound.test.ts`. |

## 5. Editor limitations

| Limitation | Detail |
|---|---|
| Preview URIs keyed by basename | Two same-named files can share one `xessa-preview:` document; reopening refreshes content. |
| Diagnostics for imports | Importers re-analyze when an imported `.cssx` module changes or is saved, so a renamed or removed member is reported at the importer's own `$ns.member` offset. Problems whose spans belong to the imported module itself are still logged in the `Xessa` output channel rather than published at the current document's offsets. |
| Rename scope | Group and keyframe rename span the current document's visible module set: its own top-level definitions plus the transitive `@use "…" styles;` closure. Modules that import the current document from above are never rewritten, and token-only imports expose nothing. Find All References is bidirectional for `$token`/`@runtime` tokens across direct importers and resolution-aware (namespaced aliases and unqualified/style imports included; local shadows and ambiguous unqualified imports excluded), while cross-file rename remains deferred. Class rename is single-file: it rewrites every non-global occurrence of the same authored name in the current `.cssx` document (`:global(...)` excluded) and never touches JSX, the generated map or `.d.ts` — those follow the next build, so literal `className="…"` strings are not caught by TypeScript. Id rename is single-file too: it rewrites every occurrence of the id name (leading `#` kept, `:global(#x)` included because ids have no local/global split), but JSX/HTML `id="…"` anchors and inbound links are not updated, and ids are not in the generated map. Keyframe rename rewrites exact `animation-name: <name>` values only — the `animation:` shorthand and multi-name values are left alone — lists duplicate visible definitions in completion, and refuses until the reference is unambiguous. |
| Property docs are a built-in table | Hover and completion use one-sentence built-in descriptions for 197 standard properties and 43 curated vendor-prefixed spellings; the full `vscode-css-languageservice` data (all properties, MDN links) is intentionally not embedded. |
| Restricted Mode | Analysis and preview work; writing commands are blocked. |

## 6. Platform and environment

- Compiler and CLI verified on Node `v24.22.3` (>= 20 required) and Bun `1.4.5`. The stress campaign
  extended the recorded matrix to Node `23.1.0` / `24.22.3` / `26.13.1` and Bun `1.4.5`; Node 20 and
  Node 22 were not installed on the campaign machine and remain unverified
  (`.ai/reports/CSSX-TT5.md` F2).
- Browser cascade tests recorded on Chromium, Firefox and WebKit (96/96, 32 per engine). See
  [cascade.md](cascade.md#5-browser-evidence).
- VS Code extension tested on VS Code `1.147.0`; the manifest declares `^1.85.0` and older versions
  are untested.
- `@vscode/test-electron 2.5.2` cannot launch VS Code 1.147.0 on macOS without a manual launcher
  override; the test orchestrator resolves `…/MacOS/Code` itself.
- No telemetry. No network access at build time; imports are local and workspace-contained.
