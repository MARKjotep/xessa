# CSSX-F20 — module-side map-inheritance opt-out (`map-inherit`)

## Summary

- `@setup { map-inherit: false; }` (project/API `output.mapInherit`, including
  `xessa.config.json`, default `true`) keeps a style-merged module's class bindings out of the
  importing build's `map.js`, `.d.ts` and `CompileResult.classes` while its rules still merge into
  the importing `.css` in the normal imported-first cascade order.
- The module's own entry map is unaffected, excluded bindings cannot raise `XESSA4001`, and
  `module: true` + `map-inherit: false` is allowed and silent — the documented rule-only escape
  hatch. Runtime-token merging is unchanged.
- ADR-0020 amends ADR-0014 §3's one-table lockstep with this single exception. Default output stays
  byte-identical; the editor offers the key with boolean values.
- The merge predicate lives on the merged-table source list, so JS, `.d.ts` and the `classes` record
  stay generated from one filtered table.

## Status: PASS

## Changed paths

Compiler:

- `packages/compiler/src/index.ts` — `map-inherit` in `SETUP_KEYS`/`BOOLEAN_SETUP_KEYS`, boolean
  decode/assign, `definedOutput` passthrough, per-module effective flag
  (`decoded.values.mapInherit ?? moduleMapInherit ?? true`) on the merged-table source,
  `CompileEntryInput.moduleMapInherit` wired from `compile()`/`compileProject()`.
- `packages/compiler/src/types/options.ts` — `OutputOptions.mapInherit` docs and optional
  `ResolvedSetup.mapInherit` (planner-only hosts may omit it; compile defaults it to `true`).
- `packages/compiler/src/output/resolve.ts` — `OUTPUT_DEFAULTS.mapInherit: true`,
  `defaultSetupFor` carries it.
- `packages/compiler/src/naming/merge.ts` — `ClassTableSource.mapInherit`; opted-out sources are
  skipped before any collision check, so map/`.d.ts` lockstep and XESSA4001 behaviour follow.

Editor:

- `packages/vscode/src/intelligence.ts` — completion key list adds `map-inherit`, its doc line, and
  boolean value completion.

CLI (config pair wiring):

- `packages/cli/src/config.ts` — `output.mapInherit` is a known output key (accepted in strict mode,
  no unknown-key warning), documented in the schema table.
- `packages/cli/src/setup.ts` — file `map-inherit` decoding, defaults and precedence
  (`file ?? project ?? true`).
- `packages/cli/src/compiler-api.d.ts` — mirror of `OutputOptions.mapInherit` and the optional
  `ResolvedSetup.mapInherit`.

Tests:

- `tests/compiler/modules.test.ts` — 7 `map-inherit (ADR-0020)` tests.
- `tests/integration/cli-map-inherit.test.ts` — 4 CLI tests: project false, strict-mode acceptance,
  module `true` over project false, module `false` over project true.
- `tests/extension/provider.intelligence.test.ts` — key/boolean completion for `map-inherit`;
  the existing fresh-line key assertion now includes the new key.
- `packages/vscode/test/ui/completions.js` — host scenario expects 13 setup keys and asserts
  `map-inherit` is offered (assertion strengthened, nothing removed).

Docs/records:

- `docs/decisions/ADR-0020-map-inheritance-opt-out.md` (new)
- `docs/configuration.md` — `@setup` row, §2.2 section, `output.mapInherit` row, mapping row
- `docs/usage.md` — §2.8 module bullet
- `SPECIFICATION.md` — §6.3 exception, §8 map bullet, §9 table row, §10 example
- `CHANGELOG.md` — 0.1.0 Language bullet; ADR range 0001–0020
- `.ai/tasks/CSSX-F20.md`, this report, `.ai/todo.md` (item 20 🟢, items 21–23 appended verbatim)

## Evidence

`tests/compiler/modules.test.ts`:

- `the flagged module's CSS merges but its bindings leave js, types and classes` — CSS is
  `.ui-card {…}\n\n.ui-icon {…}\n\n.app-page {…}`; `entry.js` is exactly
  `export const page = "app-page";`; `entry.types` is exactly
  `export declare const page: "app-page";`; `classes` is `{ page: "app-page" }`.
- `without the flag the module still inherits by default` — map is
  `card = "ui-card"` + `page = "app-page"` (default-true lockstep unchanged).
- `the flagged module's own entry map is unaffected` — compiling `card.cssx` as the entry yields
  `export const card = "ui-card";` and the matching declaration.
- `project output.mapInherit applies, and a file value overrides it` — `output: { mapInherit: false }`
  drops an unflagged module's binding; a module authoring `map-inherit: true` still inherits.
- CLI (`tests/integration/cli-map-inherit.test.ts`): `xessa.config.json` `output.mapInherit: false`
  writes `entry.map.js` with only `page`, `entry.css` with `.ui-card` then `.app-page`, and the
  module's own `card.map.js` keeps `card`; strict mode accepts the key with no warning; module
  `map-inherit: true` overrides a project false; module `map-inherit: false` overrides a project
  true.
- `excluded bindings never raise XESSA4001` — the same authored `.shared` with different emitted
  names and a camelCase alias collision produce zero diagnostics; both module rules still emit.
- `module: true + map-inherit: false is silent and leaves no bindings anywhere` — entry map only
  `page`; module emits no CSS/map/types; zero diagnostics on both entries.
- `map-inherit expects a boolean` — `XESSA1001` naming the key with a span inside the source.

`tests/extension/provider.intelligence.test.ts`: `map-in` filters to the `map-inherit` setup-key
item with its documentation, and `map-inherit: ` offers exactly `true`/`false`. Host scenario
`completions` asserts 13 keys including `map-inherit` (857 host assertions, 14 scenarios).

## Gates

| Command | Exit | Evidence |
|---|---|---|
| `bun run verify` | 0 | 1259 pass / 2 skip / 0 fail across 93 files (test duration 76.48 s); typecheck + lint green; host 14 scenarios / 857 assertions |
| `bun run release:check` | 0 | 177.31 s wall; verify green; browser 96/96 (1.5 m); compiler + CLI builds; metadata valid; tarballs 311/89 files; 8 examples built; VSIX 18 files |
| `bun run lint` | 0 | 468 files checked, no fixes |

Baseline was 1248 pass / 2 skip / 0 fail across 92 files; this change adds 11 tests across 2 files
(7 compiler `map-inherit` tests + 4 CLI config tests) → 1259 pass / 93 files, plus one host assertion
(856 → 857). One intermediate `release:check` attempt on the compiler-only intermediate state
reported a single transient test failure (1254/1); the host suite passed standalone and the rerun
was green with no code change, consistent with the known timing-sensitive flakes in this suite.

## Docs / ADR / CHANGELOG

- ADR-0020 records the decision, the default-true compatibility rule, the own-map/XESSA4001/token
  consequences, and rejects (deferred) per-import `styles no-map`, the `module: true` warning and
  JS-only filtering.
- Configuration reference documents the key, its precedence and a worked module/importer pair;
  usage and SPECIFICATION state the §3 exception; CHANGELOG adds the 0.1.0 feature and bumps the
  ADR range.

## Board

`.ai/todo.md` item 20 is 🟢 with the landed reference; items 21 (`import-css` opt-in), 22 (minified
default) and 23 (group hover readability) are appended verbatim with their owner requests.

## F21 inherits

- The boolean setup-key path (`SETUP_KEYS`, `BOOLEAN_SETUP_KEYS`, `assignBooleanSetting`,
  `definedOutput`, `defaultSetupFor`) is the template for `import-css`/`output.importCss`, which also
  needs map-generation plumbing rather than the merge table.
- `output.importCss` should follow the same three-layer wiring proven here: compiler
  `OutputOptions`/`ResolvedSetup`, CLI `config.ts` key + `setup.ts` decode/precedence, and the
  `compiler-api.d.ts` mirror.
