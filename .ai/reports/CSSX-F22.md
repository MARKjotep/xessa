# CSSX-F22 — minified output by default

## Summary

- `minify` / `output.minify` now defaults to `true` in the compiler's resolved setup, the CLI's
  file-setup defaults and the editor's planning defaults. `compile()`, `compileProject()`, project
  and single-file CLI builds, watch, Compile File, compile-on-save and Preview emit compact CSS by
  default.
- The opt-outs are unchanged: `@setup { minify: false; }`, project `output.minify: false` and
  `--no-minify` reproduce the previous expanded bytes. `--minify` still forces compact output and the
  last flag wins. Precedence is untouched.
- Emitted CSS is the only changed output. `format()`, class-map generation and `.d.ts` bytes are
  unchanged. Source maps keep the same v3 generation rules and now describe the compact positions
  where applicable.
- 31 default-output fixture goldens were regenerated, 3 minified goldens added and 24 test files
  had default-output expectations updated. All eight committed example stylesheets were rebuilt
  minified and are byte-identical across repeat builds.
- ADR-0022, README/configuration/usage/SPEC/CHANGELOG, task and board item 22 are updated.

## Status: PASS

## The flip's exact locations

- `packages/compiler/src/output/resolve.ts` — `OUTPUT_DEFAULTS.minify: true`; all
  `compile()`/`compileProject()`/planner paths inherit it through `defaultSetupFor`.
- `packages/cli/src/setup.ts` — CLI `defaultSetupFor(...).minify: true`, so CLI project and
  single-file builds start compact before config/file/flag layers.
- `packages/vscode/src/output.ts` — editor `defaultSetupFor(...).minify: true`, used by Compile File,
  compile-on-save and Preview planning/compilation.
- `packages/compiler/src/types/options.ts` — public `OutputOptions.minify` docs say default `true` and
  document the opt-outs.
- `packages/vscode/src/intelligence.ts` — `@setup` completion docs say `minify` defaults to `true`.
- No new option, flag or schema key. `packages/cli/src/config.ts` needed no schema change: an absent
  `output.minify` now resolves to the flipped default.

## Golden / expectation inventory

Regenerated to default (minified) output — 31 `expected/css` files:

- `tests/fixtures/groups/*` — 19 files (all except `token-only`, whose expected output is already
  empty).
- `tests/fixtures/modules/merge/*` — 7 files.
- `tests/fixtures/keyframes/{style-import,duplicate-name}` — 2 files (`token-only` is empty).
- `tests/fixtures/runtime/{override-entry,override-modules,override-variants}` — 3 files.

Added minified companions — 3 files, keeping the existing pretty goldens for explicit pipelines:

- `tests/fixtures/canonical/button/expected/minified`
- `tests/fixtures/variables/duplicate-local/expected/minified`
- `tests/fixtures/errors/semicolonless-before-nested-rule/expected/minified`

Test files updated (24):

- Compiler: `compile.test.ts`, `golden.test.ts`, `groups.expansion.test.ts`,
  `groups.golden.test.ts`, `modules.test.ts`, `keyframes.test.ts`, `import-css.test.ts`,
  `setup-css-list.test.ts`, `single-file-duplicate.test.ts`, `formatter.test.ts` (only its embedded
  compiled-CSS snippet).
- Integration: `cli-import-css.test.ts`, `cli-watch.test.ts`, `cli-map-inherit.test.ts`.
- Extension UI host: `commands.js`, `commands-matrix.js`, `config.js`, `restricted.js`,
  `multi-root.js` — only compiled-CSS selector patterns (`\.x \{` → `\.x\{`).
- Stress/consumer: `consumer/runtimes.test.ts` (default-output probe only) and
  `fs/{planner,interrupt,links,paths}.test.ts`.

Untouched and still green: tests that explicitly pass `minify: false`
(`emitter.test.ts`, `formatter`'s own fixtures, `variables.golden.test.ts`, `sourcemap.test.ts`
golden closure), class-map/`.d.ts` goldens, and the browser pretty-vs-minified parity suite.

Expectation changes vs real failures: **all test failures were the intended default-output contract
change; no product defect was found or fixed.** One tooling adjustment was required: Biome was
reformatting the intentionally minified example CSS, so `biome.json` now ignores
`examples/*/generated`; the three new minified test goldens use the extensionless `expected/minified`
name for the same reason.

## Example output evidence

Rebuilt through the built CLI with each example's own config
(`node packages/cli/dist/index.js build --config examples/<name>/xessa.config.json`), twice. All
eight stylesheets have identical SHA-256 hashes across the two runs and again after
`release:check`'s rebuild.

| Example | Before (B) | After (B) |
|---|---:|---:|
| `basic/generated/styles/button.css` | 945 | 733 |
| `custom-output/generated/styles/theme.css` | 169 | 143 |
| `groups/generated/styles/app.css` | 1 184 | 964 |
| `jsx/generated/styles/button.css` | 195 | 160 |
| `overrides/generated/styles/app.css` | 777 | 630 |
| `portfolio/generated/styles/portfolio.css` | 24 498 | 20 437 |
| `responsive/generated/styles/card.css` | 861 | 665 |
| `variables/generated/styles/card.css` | 375 | 302 |
| **Total** | **29 004** | **24 034** |

Example sources were not edited. `custom-output` also regenerated `theme.css.map` because its CSS
positions changed; the map is still the same v3 format and `release:check`/source-map tests pass.

## What stayed unchanged

- `format()` and format-on-save output: formatter expectations untouched.
- Class-map `.map.js` and opt-in `.d.ts` bytes: map goldens and declaration tests green.
- Source-map generation, format and content rules: no reformatting/compaction of map JSON; tests for
  pretty and minified mapping modes remain green.
- Browser parity: pretty and minified pages remain computed-style equal (96/96).

## Gates

| Command | Exit | Evidence |
|---|---|---|
| `bun run verify` | 0 | **1283 pass / 2 skip / 0 fail** across 95 files (test duration 77.73 s; wall 82.22 s); typecheck + lint green; host **14 scenarios / 866 assertions** |
| `bun run release:check` | 0 | 155.13 s wall; verify green; browser **96/96** (1.3 m); compiler + CLI builds; metadata valid; tarballs 315/89 files; 8 examples built (0 warnings); VSIX 18 files / 136.06 KB |
| `bun run lint` | 0 | 450 files checked, no fixes (0.29 s) |

## Docs / ADR / CHANGELOG / board

- New `docs/decisions/ADR-0022-minified-output-default.md` — owner request, rationale, normative
  decision, opt-outs, rejected alternatives, consequences, status Accepted for v0.1.
- `README.md` output table says `minify` default `true` and names the readable opt-out.
- `docs/configuration.md` `@setup` and `xessa.config.json` tables, examples and §5 note.
- `docs/usage.md` outputs section and editor/preview note (Compile File, compile-on-save, Preview).
- `SPECIFICATION.md` §9/§10 default rows and config example.
- `CHANGELOG.md` 0.1.0 behavior-change bullet with the opt-out.
- `.ai/todo.md` item 22 → 🟢; task and this report persisted.

## Files touched

Compiler/CLI/editor defaults and docs: `packages/compiler/src/{output/resolve.ts,types/options.ts}`,
`packages/cli/src/setup.ts`, `packages/vscode/src/{output.ts,intelligence.ts}`.
Tests/goldens: the 31 regenerated `expected/css` files, 3 new `expected/minified` files and the 24
test files listed above. Examples: the eight `examples/*/generated/styles/*.css` files (plus the
`custom-output` source map). Tooling: `biome.json`. Docs/records: ADR-0022, README,
configuration, usage, SPECIFICATION, CHANGELOG, task, report, board. No production plan edit; no git
commands.

## Handoff

An `examples/modules` task inherits minified generated CSS by default: rebuild with its own
`xessa.config.json` through the built CLI, expect compact `generated/` CSS, and use
`@setup { minify: false; }` only when readable committed output is wanted. Class maps and `.d.ts`
remain unchanged by the flip.
