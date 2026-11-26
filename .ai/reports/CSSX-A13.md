# CSSX-A13 — VS Code providers, commands and extension-host smoke (P6)

## Summary

- Implement the language providers in `packages/vscode/src/`: diagnostics (tolerant compiler parse, debounced, stale-version discard), completions (properties, values, media aliases, `$variables` + namespace members, setup keys, import paths, selectors/pseudos), hover (resolved token value, condition expression, generated class), definition + references for `$tokens`, single-file token rename, color provider, outline.
- Implement the commands from the spec: Compile File, Build Project, Preview Compiled CSS (in-memory, never writes), Open Generated CSS, Open Class Map, Check Project; status bar, output channel, compile-on-save OFF by default, workspace-trust respect, multi-root nearest-config.
- Make the extension loadable in the Node extension host (tsc build to `out/`) and add extension-host smoke tests via `@vscode/test-electron` (graceful fallback if the environment cannot run them).

**Status:** implemented and locally verified; `bun run verify` exit 0 on three consecutive runs
(547 pass). Pending lead verification (`.ai/PROGRESS.md` untouched).

## Outcome

`packages/vscode` is now a loadable VS Code extension: the A12 grammar/manifest are unchanged, and
A13 adds a pure analysis/intelligence core plus thin provider adapters, six commands, a status bar,
a `Xessa` output channel, workspace-trust gating, multi-root nearest-config resolution and a
read-only `xessa-preview:` document for compiled CSS. All compiler access goes through the public
barrel (`parse`, `compile`, `planOutputs`); no compiler, CLI or root config file was modified.

The extension was loaded in a real VS Code 1.147.0 extension host: activation, grammar registration,
six commands, diagnostics on a broken document, alias completion, `Compile File` writes and
`Preview Compiled CSS` all passed.

## Created / changed files

Created (`packages/vscode`, all inside this task's ownership):

- `src/analysis.ts` — pure document analysis over `{ text, path, version }`: tolerant `parse`,
  optional `compile`, line index/offset↔position mapping, diagnostics (XESSA code/severity/message,
  span→range, originating file), merged media alias table, `$` token symbols with declaration ranges
  and runtime variants, imported-module namespace tokens, `@setup` settings, selector classes with
  generated names, hex colors. No `vscode` import.
- `src/intelligence.ts` — pure completion contexts and items, hover, definition, references,
  single-file rename, hex↔RGBA, outline. No `vscode` import.
- `src/service.ts` — `AnalysisService`: 150 ms debounce with injectable timers and stale-version
  discard; `analyzeNow` for completion/hover/commands.
- `src/paths.ts` — POSIX path helpers (the compiler's `ModuleHost` path contract).
- `src/config.ts` — nearest `xessa.config.json` discovery (bounded by workspace folder) and
  non-strict validation.
- `src/glob.ts` — `**`/`*`/`?` project entry discovery with dependency/generated excludes.
- `src/output.ts` — `@setup` decoding into `ResolvedSetup`, `planOutputs` call, default
  canonicalization, temp-file-plus-rename atomic writes, problem formatting.
- `src/project.ts` — per-document config/root cache for multi-root workspaces.
- `src/adapter.ts` — all `vscode` type conversions and sync readers.
- `src/providers/{diagnostics,completion,hover,navigation,color,symbols}.ts` — provider adapters.
- `src/controller.ts` — command wiring, status bar, output channel, trust, compile-on-save, preview
  content provider, document/config events.
- `src/extension.ts` — `activate`/`deactivate` entry.
- `scripts/write-entry.mjs` — writes the `out/extension.js` manifest-entry shim.
- `tsconfig.json` — NodeNext base overridden to CommonJS-for-extension-host, compiles
  `src/**` plus `../compiler/src/**` into `dist/` with the relative layout preserved.
- `.gitignore` — ignores `out/` and `dist/`.
- `test/suite.js`, `test/fixtures/{broken,complete}.xessa` — in-host smoke suite and workspace.

Created (tests):

- `tests/extension/provider.analysis.test.ts` — canonical-fixture clean analysis + class map,
  XESSA3001/XESSA1001 positions, compile-failure containment, alias layer merge, token/runtime
  symbols, namespace module resolution, `$` reference scanning (strings/comments/url skipped), value
  segment offsets, color spans, `:global` class exclusion, debounce and stale-version guard.
- `tests/extension/provider.intelligence.test.ts` — `@2xl`/`@md`/document alias completion with
  condition detail, `$`/`ns.` completion, setup key/value, import-path listing, property/value/
  selector/pseudo contexts, token/runtime/namespace/media/class hover, property hover omitted,
  color conversion, outline nesting.
- `tests/extension/provider.navigation.test.ts` — local + cross-file definition, references counts,
  rename edits (declaration + usages only, never strings/urls/`:global`), cross-module/member/class
  refusal, runtime token rename.
- `tests/extension/provider.project.test.ts` — nearest-config boundary, config validation/warnings,
  glob discovery, `@setup` destination planning, project-layer destinations, invalid plan rejection.
- `tests/extension/host.test.ts` — best-effort `@vscode/test-electron` orchestrator (cached build or
  `XESSA_EXTENSION_HOST_DOWNLOAD=1`; otherwise `describe.skip` with the exact reason).

Changed:

- `packages/vscode/package.json` — `main: ./out/extension.js`, `onCommand:*` activation events,
  `contributes.commands` (six, category `Xessa`), `contributes.configuration`
  (`xessa.compileOnSave` default **false**, `xessa.previewSplitEditor` default true), scripts
  `build`/`watch`/`typecheck`, devDependencies `@types/node ^22`, `@vscode/test-electron ^2.4.1`
  (plus the existing `@types/vscode`, `vscode-textmate`, `vscode-oniguruma`).
- `packages/vscode/README.md` — editor features, commands/settings, build/test instructions and the
  deviations below.
- `bun.lock` — the extension's declared devDependencies resolved
  (`@types/node 22.20.5`, `@vscode/test-electron 2.5.2` and transitive packages). No root or compiler
  dependency changed.
- `.ai/tasks/CSSX-A13.md`, `.ai/reports/CSSX-A13.md`, `.ai/reports/logs/CSSX-A13.log`.

## Architecture and provider decisions

- **Two-layer design.** `analysis.ts`, `intelligence.ts` and `service.ts` are pure over
  `{ text, path, version }` and have no `vscode` import; providers only convert types. Tests import
  the pure modules directly, so the logic asserted in `bun test` is exactly what runs in the host.
- **Diagnostics.** Parse diagnostics first, then compile (semantic) diagnostics merged and
  deduplicated by code/file/range/message. `compile` is wrapped; a thrown compiler becomes a logged
  `compile failed:` line, never an editor exception. Debounce is 150 ms with injectable timers; the
  service stores the newest version only, so a late result for version *n* cannot overwrite
  *n+1* (tested with deferred promises). Dirty buffers are analyzed from `document.getText()`;
  `compile` overrides the entry source through its node host while imports still read from disk.
  Problems whose span belongs to an imported module are not published at the current document's
  offsets (they are logged instead).
- **Media aliases.** The compiler barrel does not export `BUILTIN_MEDIA_ALIASES`, so the extension
  mirrors the §3.2 table (`sm…2xl`, dark/light, portrait/landscape, print, reduced) and layers
  project config and file `@media-types` on top (last key wins). Tests assert `@2xl` detail text and
  document-over-project precedence. If the compiler later exports the table, replace the mirror.
- **Namespace members.** `@use` imports are parsed through an injected sync module reader; hover,
  completion, definition and references for `$ns.member` therefore work without a second compiler
  API. Runtime tokens hover as the emitted custom property (`--ui-primary` plus variants).
- **Rename safety.** References are collected from parser value spans only (`declarationSegments`
  reconstructs base/variant value offsets from AST spans); the scanner skips quoted strings,
  comments and `url(...)` with plain character logic, never regex. Rename edits the declaration and
  unqualified usages, refuses namespace members (cross-module rename is future work) and never sees
  selectors, so `:global(.x)` classes and string contents cannot be rewritten.
- **Generated classes.** Selector scanning records authored classes, `:global(...)` exclusions and
  prefix-generated names; hover prefers the compile's class map and falls back to the local prefix
  calculation. `:global` classes are shown as "not renamed".
- **css-languageservice deferral (deliberate).** Standard CSS property/value intelligence via
  `vscode-css-languageservice` requires projecting Xessa to ordinary CSS and mapping offsets back
  through every edit. That is a larger change with real false-diagnostic risk (SPECIFICATION §8
  explicitly warns against feeding custom syntax directly), so A13 keeps compiler-first hover:
  tokens, aliases, classes. Property hover returns nothing rather than guessed text; property/value
  completions come from a curated list. Follow-up: P7 projection layer with an offset map.
- **Commands and writes.** `Compile File`/`Build Project` compile in memory, plan destinations with
  `planOutputs` (containment, collisions, name validation), then write temp files and rename
  (`SPECIFICATION.md` §4). The exact planned directories/names/flags are fed back to `compile` as
  API-level overrides so the JS `import-css` specifier matches the files actually written.
  `Preview Compiled CSS` compiles with `emitCss: true`, stores the text in a
  `TextDocumentContentProvider` (`xessa-preview:` scheme) and opens it read-only with CSS syntax; it
  never writes. `Open Generated CSS/Map` plan and open existing artifacts; `Check Project` uses the
  same pipeline without writes and publishes problems.
- **Build Project granularity.** Entries are compiled one by one rather than through a single
  `compileProject` shared graph. Rationale: per-entry planning with exact API overrides guarantees
  the emitted import specifier and the written destinations agree for file-level overrides;
  `compileProject` remains available and can replace this when the planner exposes per-entry setup.
- **Trust and automatic builds.** `compileOnSave` is off by default; when enabled it only runs in a
  trusted workspace, and every writing command otherwise shows a Restricted Mode message. No
  watcher is started, satisfying the "one writer" guidance; diagnostics/preview/check are read-only
  and allowed when untrusted.
- **Status/staleness.** Status bar: idle `$(symbol-color)`, success `$(check)`, error `$(error)`,
  stale `$(warning) Xessa (stale)` after a failure following a successful build; click runs
  `xessa.buildProject`. The output channel logs config warnings, compiler errors, per-problem lines
  (`file:line:col severity CODE: message`) and written paths.
- **Multi-root.** The nearest `xessa.config.json` is resolved per document upward from its directory
  and stops at the workspace-folder root; a command with no active file checks the folder root. The
  config supplies media, prefix/strategy, project output and include/exclude.

## Build / loadability decisions

- `tsc` emits CommonJS (the extension host's module system) for both the extension and the compiler
  sources it imports through the relative barrel `../../compiler/src/index.js`.
- Emitted modules live in `packages/vscode/dist/`; `main` is the required `./out/extension.js`,
  a two-line generated shim requiring `../dist/vscode/src/extension.js`. This split is forced by the
  repository-root Biome config (outside this task's ownership): it ignores `dist` but not `out`, and
  `bun run verify` must stay repeatable. A15/bundling can replace both with one file and switch to
  the workspace `@xessa/compiler` dependency.
- `build` = `tsc -p tsconfig.json && node scripts/write-entry.mjs`; `watch` = shim + `tsc --watch`;
  `typecheck` = `tsc -p tsconfig.json --noEmit`.
- Installed dev versions (verified from `packages/vscode/node_modules/*/package.json`):
  `@types/vscode 1.146.0` (declared `^1.85.0`), `@types/node 22.20.5`, `@vscode/test-electron 2.5.2`,
  `vscode-textmate 9.3.2`, `vscode-oniguruma 2.0.1`. Extension host test build: VS Code `1.147.0`.

## Validation evidence

Environment: macOS arm64, Bun 1.4.5, Node 24.22.3, TypeScript 5.9.3.

```
$ bun run --cwd packages/vscode typecheck
$ tsc -p tsconfig.json --noEmit                         exit 0

$ bun run --cwd packages/vscode build
$ tsc -p tsconfig.json && node scripts/write-entry.mjs  exit 0
out/extension.js, dist/vscode/src/extension.js, dist/compiler/src/*.js present

$ bun test tests/extension
75 pass, 0 fail, 530 expect() calls, 7 files

$ bun test tests/extension/host.test.ts      (cached VS Code 1.147.0)
[xessa host] test-electron=installed cached=1.147.0 runnable=true
[xessa host] passed: activation, grammar, 6 commands, 1 diagnostic(s), completion 11 item(s),
                      compile+preview commands
Exit code: 0 — 2 pass, 0 fail

$ bun run verify
run 1: exit 0 — 547 pass, 0 fail, 32 files
run 2: exit 0 — 547 pass, 0 fail, 32 files
run 3: exit 0 — 547 pass, 0 fail, 32 files
```

`bun run verify` = root typecheck + Biome + `bun test`; the host smoke is part of the test step and
runs against the cached binary, so verify is offline-repeatable. Provider suites cover the canonical
and error fixtures read-only; no fixture, grammar or compiler file changed.

## Deviations, limitations and lead attention

1. **Extension typecheck is not part of root `bun run verify`.** The root `typecheck` script is owned
   outside this task and was not edited; `tsc -p packages/vscode/tsconfig.json --noEmit` passes and
   is reported here. Suggested follow-up: append it to the root script (owner approval).
2. **`main` is `out/extension.js` but modules are emitted to `dist/`.** Necessitated by the
   read-only root Biome config (see above); the shim keeps the manifest path required by the task.
3. **`@vscode/test-electron 2.5.2` cannot launch VS Code 1.147.0 unmodified on macOS.** VS Code
   1.147 ships `Visual Studio Code.app/Contents/MacOS/Code`, while the package resolves
   `.../MacOS/Electron` (its `downloadDirToExecutablePath` is internal/not exported). The
   orchestrator resolves the launcher itself and passes `vscodeExecutablePath`; the suite passes.
   No `.ai/framework/` record was created because that directory is outside this task's exclusive
   file scope; if the lead wants one, the affected versions are `@vscode/test-electron 2.5.2`
   (resolved) with VS Code `1.147.0`, and the workaround is in `tests/extension/host.test.ts`.
4. **Host binary cache lives under `node_modules/.xessa-vscode-test`** (instead of
   `packages/vscode/.vscode-test`) with explicit `--user-data-dir`/`--extensions-dir`, because Biome
   (read-only root config) otherwise scans the ~375 MB download and fails lint. The orchestrator
   skips with an exact reason when neither a cached build nor `XESSA_EXTENSION_HOST_DOWNLOAD=1` is
   present; it never fakes a pass.
5. **css-languageservice is deferred** (rationale above); property hover is intentionally empty and
   property/value completions are curated lists, not a full CSS database.
6. **Cross-module rename is refused** with guidance; single-file `$token` rename is implemented.
7. **Source maps are not written yet** because `compile` does not emit them in this phase; the
   planner/writer already accept a `cssSourceMap` artifact when the compiler produces one.
8. **Preview virtual documents are keyed by basename**, so two same-named files could share one
   preview URI; reopening always refreshes content. Low impact, listed for completeness.
9. **Manifest `name` remains `@xessa/vscode`** (A12 deviation: the scaffold test asserts it). `vsce`
   packaging (A15) needs `name: xessa` plus that test/lockfile update.
10. **No UI decisions were changed**; A12's grammar, scopes and language configuration are read-only
   and their 29 tests still pass.

## Handoff

- Completed: pure analysis/intelligence/service layers, seven providers, six commands, status bar,
  output channel, trust gating, compile-on-save (off by default), multi-root config, `tsc` build to
  a loadable extension, provider unit tests and a real extension-host smoke suite; verify green on
  three consecutive runs.
- Remaining for the lead: independent diff review, `bun run verify`, decide on the root typecheck
  addition and the optional `.ai/framework/` record (`@vscode/test-electron 2.5.2` / VS Code
  1.147.0), then flip A13 in `.ai/PROGRESS.md` (untouched here).
- Remaining for A15: bundling (`@vscode/vsce`), manifest `name: xessa`, switching the compiler import
  to the workspace dependency, optional ESM extension packaging.
- Touched files: `packages/vscode/{package.json,tsconfig.json,.gitignore,README.md}`,
  `packages/vscode/src/**`, `packages/vscode/scripts/write-entry.mjs`, `packages/vscode/test/**`,
  `tests/extension/{provider.analysis,provider.intelligence,provider.navigation,provider.project,host}.test.ts`,
  `bun.lock`, `.ai/tasks/CSSX-A13.md`, `.ai/reports/CSSX-A13.md`,
  `.ai/reports/logs/CSSX-A13.log`.
