# CSSX-DEFAULTS — zero-config defaults

## Handoff

**Status:** PASS, with one reported pre-existing drift in `examples/basic` (see “Output evidence”).

- **Defaults flipped:** `compiler.strict` → `true` and `mediaGrouping` → `"safe"` in
  `packages/cli/src/config.ts` (`parseConfigDocument`/`readCompiler`) and documented in
  `packages/compiler/src/types/options.ts`; `include` now defaults to `["**/*.cssx"]`.
- **Config optional:** `packages/cli/src/project.ts` no longer errors on a missing config; it uses
  the `package.json` workspace root (ADR-0007) and the default include. Explicit empty `include` and
  empty discovery still exit 2.
- **Examples:** seven boilerplate configs deleted, module markers added, `overrides`/`groups` keep
  only `classes.prefix`, and config-less examples carry a minimal `package.json` so discovery stays
  scoped to the example directory.
- **Tests/docs/records:** new config-less/default/strict tests; ADR-0023, README, configuration,
  usage, release, CHANGELOG, task/report/board/plan updated.
- **Gates:** `verify` exit 0 (1:11.84, 1288 pass / 2 skip / 0 fail, host 14 scenarios / 872
  assertions); `release:check` exit 0 (2:41.64, browser 96/96, nine examples, VSIX 18 files /
  136.13 KB); `lint` exit 0 (0.27 s).
- **PP4 inherits:** the release gate now builds config-less examples from their directory; the only
  outstanding reconciliation is the pre-existing `basic` working-tree source/output drift, which is
  unrelated to the config/module change.

## Status: PASS

## Default flips and exact locations

| Contract | New default | Where |
|---|---|---|
| `compiler.strict` | `true` | `packages/cli/src/config.ts` — `parseConfigDocument` computes `strict = !(compiler.strict === false)`; `readCompiler` returns `strict` default `true`. Docs in `packages/compiler/src/types/options.ts` and `packages/cli/src/compiler-api.d.ts`. |
| `compiler.mediaGrouping` | `"safe"` | `readCompiler` always resolves `"safe"` unless `"none"` is authored; compiler already used `options.mediaGrouping ?? "safe"`. Docs updated. |
| `include` | `["**/*.cssx"]` | `DEFAULT_INCLUDE` exported from `packages/cli/src/config.ts`; `parseConfigDocument` applies it when `include` is omitted; `project.ts` uses it for config-less runs. |
| `exclude` | `[]` | Unchanged, but examples no longer use it; modules self-declare. |
| Missing config (project run) | allowed | `packages/cli/src/project.ts` resolves root via `findWorkspaceRoot` and discovers with `DEFAULT_INCLUDE`. |

`"strict": false` preserves the warning path (`configWarnings` / `Ignoring unknown configuration
key ...`). Explicit `"include": []` still exits 2, and empty discovery still exits 2 with
`No .cssx sources matched the project include globs.`

## Per-example changes

| Example | Config | Module markers added |
|---|---|---|
| `basic` | deleted | `src/theme.cssx` |
| `responsive` | deleted | — |
| `variables` | deleted | `src/tokens.cssx`, `src/layout.cssx` |
| `jsx` | deleted | — |
| `custom-output` | deleted (its non-default settings are file-level `@setup`, not config keys) | — |
| `overrides` | kept minimal: `classes.strategy/prefix` only | `src/theme-base.cssx`, `src/theme-alt.cssx`, `src/tokens.cssx` |
| `groups` | kept minimal: `classes.strategy/prefix` only | `src/chrome.cssx`, `src/theme.cssx` |
| `portfolio` | deleted | `src/tokens.cssx`, `src/theme.cssx`, `src/components.cssx`, `src/sections.cssx` (`layout.cssx` already had it) |
| `modules` | deleted | already `module: true` on tokens/card/ribbon |

Config-less examples (`basic`, `responsive`, `variables`, `jsx`, `custom-output`, `portfolio`,
`modules`) gained a minimal `package.json` (`private: true`). Without it, ADR-0007 would pick the
repository root and a config-less example would discover every example in the monorepo. The marker
keeps the old discovery set exactly (`src/**/*.cssx`), so deleting the configs does not change entry
lists. `overrides`/`groups` keep a config, so their root is unchanged.

No `exclude` remains under `examples/`; the only remaining word is prose explaining that it is no
longer needed.

## Output evidence

All nine examples were built twice through the release-gate logic (config present → `--config`;
absent → `cd examples/<name> && xessa build`). Run 1 and run 2 are byte-identical, and
`release:check`'s rebuild matches them.

- 24 of 25 committed `generated/` files are SHA-256 identical to the pre-change baseline.
- `examples/basic/generated/styles/button.css` differs: baseline
  `71a37611…` → `11fe95fd…`.
- Cause: the working tree's `examples/basic/src/button.cssx` was changed during the session to add
  `minify: false`, `@group.clr`, and `color: green`. That source state predates/rebuilds to the new
  bytes; it is not caused by the config deletion or module marker. Proof: a temp copy with the **old**
  config (`include` + `exclude` + `compiler`) and the **old** theme file (no `module: true`) built
  from the current `button.cssx` produces exactly `11fe95fd…` too. Removing those working-tree edits
  reproduces a 733-byte minified file, matching the F22 record's size (hash differs because the
  committed output predates later compiler output changes).
- No generated output was changed silently: the regenerated `basic` CSS is the deterministic result
  of the current working-tree source, and this report records the drift for the owner/parent to
  reconcile. All other example hashes match the baseline exactly.

## Gates (sequential)

| Gate | Exit | Duration | Actuals |
|---|---|---|---|
| `bun run verify` | 0 | 1:11.84 | 1288 pass / 2 skip / 0 fail across 95 files (1290 tests, 68.16 s); host 14 scenarios / 872 assertions |
| `bun run release:check` | 0 | 2:41.64 | verify green, browser 96/96 (1.4 m), compiler/CLI builds, metadata valid, tarballs compiler 315 / CLI 89 files, nine examples built, VSIX 18 files / 136.13 KB |
| `bun run lint` | 0 | 0.27 s | 452 files checked, no fixes |

The compiler tarball count moved 307 → 315 because the current `dist` contains the later feature
wave; it is not a packaging regression (the assertion covers `package.json`, README, LICENSE and
`dist/**`).

## Tests

Updated `tests/integration/cli-config.test.ts`:

- unknown keys are rejected by default without a `compiler` block;
- explicit `"strict": false` keeps the warning path;
- a config omitting `include` uses `**/*.cssx`;
- a config-less project build discovers `**/*.cssx` and writes default artifacts;
- a config-less project with no sources exits 2;
- the seven config-less examples `check` from their own `package.json` boundary with
  `workspaceRoot` = example directory and `configFile: null`.

No assertions were weakened. The extension parser is unchanged and still warns on unknown keys
(editor UX; outside this task's write set); no editor host assertion quoted the old missing-config
message.

## Docs and records

- New `docs/decisions/ADR-0023-zero-config-defaults.md` (owner decision, decisions, rationale,
  rejected alternatives, consequences).
- `README.md`: optional quick-start config, default table rows, config-less source-checkout command,
  strict/exit wording, updated verify counts.
- `docs/configuration.md`: config optional, `include` default, `strict: true`, config-less discovery.
- `docs/usage.md`: getting started without a config, `module: true`, CLI/exit wording, examples index.
- `docs/release.md`: conditional `--config` in the examples step.
- `CHANGELOG.md` `[0.1.0]` CLI entries.
- Per-example READMEs updated (build commands, trees, module/config wording).
- `.ai/tasks/CSSX-DEFAULTS.md`, this report, `.ai/todo.md` feature 24, and the plan's
  `DEFAULTS · zero-config defaults` row + PP2c post-consolidation note.

## What PP4 inherits

- The release checklist is accurate: config-less examples build from their own directory.
- The extension package and tarballs are unchanged in shape; VSIX remains 18 files / 136.13 KB.
- Before tagging, reconcile the `examples/basic` working-tree source/output drift if it was not
  intentional; it is the only generated file that differs from the pre-task baseline.
