# CSSX-F21 — opt-in class-map CSS import (`import-css`) + build-on-demand docs

## Summary

- `@setup { import-css: true; }` (project/API `output.importCss`, including `xessa.config.json`,
  default `false`) makes the generated `map.js` start with exactly one
  `import "<stylesheet>";` for bundler-driven consumers. The default keeps the CSSX-A52 map
  byte-identical and importable by plain Node without a loader.
- The specifier is computed from the **planned** map file to the **planned** stylesheet: POSIX
  separators, `./`-prefixed when in or below the map directory (`./button.css`), authored `../`
  segments when above it (`../styles/button.css`). A `css-dir` list imports the **first listed
  destination** (every copy is still written).
- No stylesheet in the plan (`emit-css: false`, or `module: true` without a restored `emit-css`)
  means no import — never a dangling one. `.d.ts` stays pure declarations; `map-types` is untouched.
- The editor offers `import-css` as a setup key with `true`/`false` completion; the host scenario
  now expects 14 keys. `docs/usage.md` gains the owner-requested **build on demand (no watcher)**
  section covering `xessa.compileOnSave` limits and Code Runner (`xessa` executor, pre-publish forms,
  `"$fullFileName"` quoting) plus native command keybindings.

## Status: PASS

## Changed paths

Compiler:

- `packages/compiler/src/index.ts` — `import-css` in `SETUP_KEYS`/`BOOLEAN_SETUP_KEYS`, boolean
  decode/assign, `definedOutput` passthrough; `compileEntry` builds map options from the plan:
  `importCss === true` + a planned `js` and `css` output → `stylesheetImportSpecifier(...)`; the
  first `css` plan entry is canonical for lists.
- `packages/compiler/src/output/import-path.ts` (new) — `stylesheetImportSpecifier(mapFile,
  stylesheetFile)`; `./` prefix for relative targets, `..`/absolute results untouched.
- `packages/compiler/src/naming/mapgen.ts` — `ClassMapOptions.cssImport`; one import line before the
  exports; declarations unchanged; empty table + import = import-only file.
- `packages/compiler/src/naming/index.ts` — exports `ClassMapOptions`.
- `packages/compiler/src/types/options.ts` — `OutputOptions.importCss` docs; optional
  `ResolvedSetup.importCss` (absent means `false`).
- `packages/compiler/src/output/resolve.ts` — `OUTPUT_DEFAULTS.importCss: false`,
  `defaultSetupFor` carries it.

CLI / editor:

- `packages/cli/src/config.ts` — `output.importCss` known key (strict mode accepts), mapping doc row.
- `packages/cli/src/setup.ts` — file `import-css` decoding, defaults, precedence
  (`file ?? project ?? false`).
- `packages/cli/src/compiler-api.d.ts` — `OutputOptions.importCss` + optional
  `ResolvedSetup.importCss` mirror.
- `packages/vscode/src/intelligence.ts` — `import-css` key doc, key and boolean-value completion.
- `packages/vscode/test/ui/completions.js` — 13 → 14 setup keys and an `import-css` assertion.

Tests:

- `tests/compiler/import-css.test.ts` — 17 tests: mapgen shape/empty table, specifier path cases,
  same-dir/cross-dir/custom-name/`css-dir` list, default-off, `emit-css: false`, `module: true`,
  pure `.d.ts`, project-vs-file precedence, invalid value `XESSA1001`.
- `tests/integration/cli-import-css.test.ts` — 6 CLI tests: project true, strict acceptance, default
  off, file false over project true, list first destination (both CSS copies written), `emit-css:
  false` writes no import and no CSS.
- `tests/extension/provider.intelligence.test.ts` — key/value completion for `import-css`; the
  fresh-line key assertion includes it.

Docs/records:

- `docs/decisions/ADR-0021-opt-in-css-import.md` (new)
- `docs/configuration.md` — `@setup` row, §2.3 `import-css`, §3 `output.importCss`, mapping row,
  emit-flag note
- `docs/usage.md` — §3.2 opt-in import, new §5.6 **Build on demand (no watcher)**
- `SPECIFICATION.md` — §8 map bullet, §9 table row, §9.2 writing rule
- `CHANGELOG.md` — 0.1.0 Language bullet; ADR range 0001–0021; usage guide note
- `.ai/tasks/CSSX-F21.md`, this report, `.ai/todo.md` (item 21 🟢)

## Evidence

Compiler (`tests/compiler/import-css.test.ts`):

- same directory — `import "./button.css";\nexport const button = "ui-button";\n`
- `map-dir: "../maps"` — `import "../src/button.css";\nexport const button = "ui-button";\n`
- `css-name: "app.css"` — `import "./app.css";`
- `css-dir: "../client", "../src/generated"` — `import "../client/button.css";` (first destination)
- default off — `export const button = "ui-button";\n`, no `import`
- `emit-css: false` — map kept, no import, `result.css` undefined
- `module: true; emit-map: true` — map kept, no import (no planned stylesheet)
- `map-types: true` — `export declare const button: "ui-button";\n`, no import line
- invalid — one `XESSA1001` containing `@setup setting "import-css" expects true or false`
- Specifier unit cases: `./button.css`, `../src/button.css`,
  `./generated/styles/app.css`, `../styles/app.css`.

CLI (`tests/integration/cli-import-css.test.ts`): project `{"importCss": true}` writes
`import "./button.css";`; strict mode accepts the key with no warning; file `import-css: false`
overrides it; the `css-dir` list writes `client/button.css` and `src/generated/button.css` while the
map imports `../client/button.css`; `emit-css: false` writes neither CSS nor an import.

Editor: pure suite offers `import-css` with its doc and exactly `true`/`false`; host scenario
`completions` asserts 14 keys and the new key (132 assertions in that scenario).

## Gates

| Command | Exit | Evidence |
|---|---|---|
| `bun run verify` | 0 | **1282 pass / 2 skip / 0 fail** across 95 files (test duration 76.9 s); typecheck + lint green; host **14 scenarios / 858 assertions** |
| `bun run release:check` | 0 | 178.7 s wall; verify green; browser **96/96** (1.6 m); compiler + CLI builds; metadata valid; tarballs 315/89 files; 8 examples built (0 warnings); VSIX 18 files / 136.02 KB |
| `bun run lint` | 0 | 471 files checked, no fixes (0.36 s) |

Baseline was 1259 pass / 2 skip / 0 fail across 93 files; this change adds 23 tests across 2 files
(17 compiler + 6 CLI) → 1282 pass / 95 files, plus one host assertion (857 → 858). The compiler `dist`
was rebuilt with the package build script so the CLI integration suite (which prefers `dist`) exercises
the new code; `release:check` rebuilt everything afterwards.

## Docs / ADR / CHANGELOG

- ADR-0021 records the opt-in decision, the plan-derived relative specifier, the first-destination
  rule for `css-dir` lists, suppression, and rejects restoring the default, importer-side-only
  guidance, importing every list destination and dangling imports.
- §5.6 of `docs/usage.md` documents both watcher-free flows: `xessa.compileOnSave` (saved document
  only; `module: true` writes nothing; importers do not refresh) and Code Runner
  (`"code-runner.executorMap": {"xessa": "npx xessa build \"$fullFileName\""}`, `runInTerminal`,
  `saveAllFilesBeforeRun`, quoting because paths may contain `$`), with the global-link /
  `node …/packages/cli/dist/index.js` pre-publish forms and native
  `xessa.compileFile`/`xessa.buildProject` keybindings.

## Board

`.ai/todo.md` item 21 is 🟢 with the landed reference (implementation, tests, ADR-0021, usage guide
section). Items 22 (minified default) and 23 (group hover readability) remain 🔴.

## Notes / follow-ups

- An empty class table with `import-css: true` and CSS emitted yields a map containing only the
  import line; that keeps a pure-styling module loadable through its map. Default empty output is
  still the empty file.
- `packages/vscode/src/output.ts` planning does not need `import-css` (it does not affect
  destinations), and the extension's `apiOutputFromPlan` still does not forward a project-level
  `output.importCss` into `compile()` — same pre-existing gap as `output.mapInherit`. File
  `@setup { import-css: true; }` works through the compiler's own decoding. Not changed here
  (outside F21's write set).

## F22 / F23 inherit

- F22 (minify default true) must regenerate goldens and example output; `import-css` is orthogonal to
  minification and its tests pin non-minified maps, so the flip should not touch this feature.
- F23 (group hover rendering) is editor-intelligence-only; the setup-key table now has 14 keys and
  the host completion count is 14 (858 assertions).
