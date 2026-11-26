# CSSX-F18 — `css-dir` value lists

## Summary

- `@setup { css-dir: "../client", "../src"; }` now writes the same stylesheet (same `css-name`) to
  every listed in-workspace directory. `source-map: true` writes one map beside each destination.
- Each item resolves exactly like the single-value form (relative to the source file, no project
  mirroring), and a file list replaces project `output.cssDir`. `map-dir`, `map-name` and
  config-level `output.cssDir` stay single-valued; a CLI `cssDir` override replaces the list.
- Single authored paths are unchanged byte-for-byte. A list is a scoped exception to the §3.2
  single-scalar rule, recorded in **ADR-0019**.
- Empty/duplicate items are `XESSA2001` with a span inside the authored value; external items are
  `XESSA5001` per destination. Each destination is a separate plan artifact and manifest record, so
  `clean`, the `.cssx-tmp` sweep, watch and `--json`/NDJSON cover all copies.

## Status: PASS

## Changed paths

Compiler:

- `packages/compiler/src/setup-list.ts` (new: comma split, scalar decode, item spans, XESSA2001)
- `packages/compiler/src/index.ts` (css-dir list decode, API/CLI single override clears the list,
  export `decodeSetupList`/`decodeSetupScalar`)
- `packages/compiler/src/parser/statements.ts` + `src/types/ast.ts` (`Setting.valueSpan`)
- `packages/compiler/src/types/options.ts` (`ResolvedSetup.cssDirs`)
- `packages/compiler/src/output/resolve.ts` (per-item exact resolution, CLI override clears list)
- `packages/compiler/src/output/index.ts` (one CSS + one source-map candidate per directory)

CLI:

- `packages/cli/src/setup.ts` (list-aware `FileSetupValues.cssDirs`, precedence)
- `packages/cli/src/compiler-api.d.ts` (mirror: `valueSpan`, `cssDirs`, `decodeSetupList`)

Tests:

- `tests/compiler/output-list.test.ts` (8 planner tests)
- `tests/compiler/setup-css-list.test.ts` (8 decode/diagnostic tests)
- `tests/integration/cli-css-list.test.ts` (5 build/manifest/clean/error tests)
- `tests/integration/cli-watch.test.ts` (1 list rebuild/report test)

Docs/records:

- `docs/decisions/ADR-0019-setup-output-lists.md` (new)
- `SPECIFICATION.md` §3.2 exception, §9 table, §9.1/§9.2/§9.3
- `docs/configuration.md` (§2 table, §2.1 list section, §4 paths)
- `docs/usage.md` (§1.2 list example)
- `CHANGELOG.md` (0.1.0 Language bullet, ADR range 0001–0019)
- `.ai/todo.md` item 18 → 🟢; this task/report

## Evidence

Planner (`tests/compiler/output-list.test.ts`): `css:client/button.css`, `css:src/button.css`,
`js:src/button.map.js`; with `sourceMap` adds `cssSourceMap:client/button.css.map` and
`cssSourceMap:src/button.css.map`; map-dir/name/types stay single; project `cssDir` replaced;
duplicate resolved target → `XESSA5001` with an empty plan; external item → `XESSA5001`.

Decode diagnostics (`tests/compiler/setup-css-list.test.ts`): duplicate item span slices exactly
`"../out"`; empty middle/trailing/leading items and quoted empty value are each one `XESSA2001`;
single values stay diagnostic-free.

CLI (`tests/integration/cli-css-list.test.ts`): both `client/app.css` and `src/app.css` written
byte-identically with a source map beside each; manifest and `--json` list exactly
`client/app.css`, `client/app.css.map`, `maps/app.map.js`, `src/app.css`, `src/app.css.map`;
`clean` removes all five and empties the manifest; duplicate list exits 1 with `XESSA2001`; external
item exits 1 with `XESSA5001`; failed entries write no artifact.

Watch: list rebuild reports three outputs (`client/app.css`, `maps/app.map.js`, `src/app.css`), all
written, and both CSS copies receive the new declaration.

## Gates

| Command | Exit | Duration | Result |
|---|---|---|---|
| `bun run verify` | 0 | 79.57 s | 1248 pass / 2 skip / 0 fail across 92 files; typecheck + lint + extension host 14 scenarios / 856 assertions |
| `bun run release:check` | 0 | 178.40 s | verify green; browser 96/96; compiler/CLI builds; metadata + tarballs valid; 8 examples built; VSIX 18 files |
| `bun run lint` | 0 | 0.26 s | 467 files, no fixes |

Baseline was 1226 pass / 2 skip / 0 fail across 89 files; this change adds 22 tests across 3 files
(1248 pass, 92 files). Earlier `verify`/`release:check` attempts under load hit pre-existing timing
flakes (extension-host typing-storm change-event count; watch-churn rename/file-add probes). Each
affected file passes standalone, and the final `verify` and `release:check` runs were green without
test changes.

## Docs / ADR / CHANGELOG

- ADR-0019 records the decision, the rejected repeated-key/config-array/map-dir alternatives and the
  per-destination ownership consequences.
- SPECIFICATION documents the grammar exception, exact per-item resolution, errors and manifest
  behaviour.
- Configuration and usage docs show the list form and its limits; CHANGELOG adds the 0.1.0 feature.

## Board

`.ai/todo.md` item 18 is 🟢 with the landed reference (tests, ADR-0019, diagnostic codes).

## F20 inherits

- Config-level `output.cssDir` arrays remain unsupported (single string; project directories mirror
  the source path and participate in cross-entry collision planning).
- `map-dir` lists remain unsupported (owner scoped the request to `css-dir`).
- The editor preview/build setup decoder (`packages/vscode/src/output.ts`) still treats a list as one
  path; the editor is outside this task's write set and no editor work was required for compiler/CLI
  correctness. An editor follow-up would decode lists through `decodeSetupList`.
- `clean` can only sweep list directories recorded in the manifest or configured output dirs; an
  interrupted first build that never wrote a manifest cannot discover arbitrary list destinations.
