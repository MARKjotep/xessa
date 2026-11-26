# CSSX documentation cleanup — 2026-11-26

**Status:** PASS (documentation cleanup). `bun run verify` first failed because the release gate's
example build wrote minified output into `examples/portfolio/src/` before commit `1ec431f` captured
it. Fixed at source: `src/nas.cssx` now declares `module: true` and the two artifacts are deleted;
see Validation.

## Deleted

- Redirect stubs: `docs/grammar/README.md`, `docs/cascade/README.md`, `docs/configuration/README.md`
  (and their now-empty directories).
- `.ai/CSSX-MASTERPLAN.md` (pre-rename proposal, superseded by `SPECIFICATION.md`).
- `.ai/plans/CSSX-PLAN.md` (P0–P7 plan, superseded by the production plan and `PROGRESS.md`).
- `.ai/tasks/` (106 completed one-off prompts; outcomes remain in `.ai/reports/`).
- `.ai/reports/logs/*.log` (raw worker logs). Kept `*.json` and `ui-screens/**`.

## Updated

- **Normative/user docs:** `SPECIFICATION.md` (derivation paragraph; removed masterplan clauses),
  `README.md` (v0.1 status, install/publication caveat, gate counts, benchmark wording),
  `CHANGELOG.md` (gate counts, ADR range 0001–0024 and ADR-0019–0024 features, benchmark label,
  corrected the default-vs-opt-in CSS-import claim), `docs/usage.md` (publication caveat),
  `docs/performance.md`, `docs/release.md` (current status, `--access public`, VSIX 18/140.6 KB,
  compiler tarball 323), `docs/known-limitations.md` (VSIX size, dead framework link).
- **Package READMEs:** `packages/cli/README.md`, `packages/compiler/README.md` (publication caveat);
  `packages/vscode/README.md` (dead framework link).
- **ADRs:** 0001–0013 and 0017 removed masterplan clauses; ADR-0009 now points at `PROGRESS.md`;
  ADRs 0015–0019, 0022, 0023 removed deleted task paths; ADR-0017 also dropped masterplan,
  framework-record and task-path references.
- **Source/test comments:** compiler `types/{ast,options,diagnostics}.ts`,
  `naming/{mapgen,rewrite}.ts`, `lowering/lower.ts`, `output/{resolve,index}.ts`, `ir/index.ts`;
  `packages/vscode/src/semantic-tokens.ts`; tests for mapgen, naming, browser scenarios and grammar;
  `tests/stress/README.md`; `scripts/benchmark.ts`. Diagnostic suffix now reads
  `(SPECIFICATION §3.1)`.
- **Plans/records:** `HANDOVER.md` rewritten (release status, current state, new docs layout, where
  to look, `nas.map.js` note); production plan counts and PP4/PP5 parked status; live plan files
  scrubbed of deleted paths; `.ai/todo.md` Quick Note added; `AGENTS.md` workspace bullet no longer
  names a task-prompt directory.

## Validation

| Check | Exit | Result |
|---|---|---|
| `bun run typecheck` (inside verify) | 0 | clean |
| `bun run test` | 0 | **1351 pass / 2 skip / 0 fail**, 1353 tests across 99 files, 82.47 s |
| `bunx biome check packages/compiler/src packages/vscode/src tests scripts` | 0 | 380 files clean |
| `bun run verify` | 0 | green after removing the two `examples/portfolio/src/nas.*` artifacts captured by `1ec431f` and making `nas.cssx` a `module: true` scratch file |
| Forbidden-reference grep (outside `.ai/reports/**`, `.ai/PROGRESS.md`) | 1 (no output) | clean |
| Stale-number grep in user docs (`1323 pass`, `138.35`, `307 files`, `14 scenarios / 880`, `1225 pass`) | 1 (no output) | clean |
| `bun run release:check` (run 1) | 1 | documented extension-host flake (`only 0 change events for 196 keystrokes`, `packages/vscode/test/suite.js:54`), not a real failure |
| `bun test tests/extension/host.test.ts` (rerun) | 0 | pass, 15 scenarios / 928 assertions |
| `bun run release:check` (run 2) | 0 | verify 1351 pass / 2 skip / 0 fail (1353 tests, 99 files); lint 459 files; host 15 scenarios / 928 assertions; browser 96/96 (32 per engine); compiler tarball 323, CLI 89; nine examples; VSIX 18 files / 140.57 KB |
| `git diff --check` | 0 | clean |

Remaining references to deleted paths are historical only: `masterplan` 16 files,
`.ai/tasks/` 77, `.ai/framework/` 24, `CSSX-MASTERPLAN` 3, old plan 2 — all under
`.ai/reports/**` or `.ai/PROGRESS.md`.

## Intentionally left

`.ai/reports/**` and `.ai/PROGRESS.md` (historical evidence), `docs/decisions/` ADRs, `examples/`,
`packages/` and `tests/` content, `.ai/reports/logs/*.json` and `ui-screens/**`. The empty
`.ai/agents/` and `.ai/framework/` directories remain (Git does not track empty directories).

## Definitive gate

`bun run release:check` on this tree, 2026-11-26:

- **Run 1:** exit 1 on the documented extension-host flake (`only 0 change events for 196 keystrokes`,
  `packages/vscode/test/suite.js:54`) — not a real failure.
- **Single `bun test tests/extension/host.test.ts` rerun:** pass, 15 scenarios / 928 assertions.
- **Run 2:** **exit 0**, full chain — verify 1351 pass / 2 skip / 0 fail (1353 tests, 99 files);
  lint 459 files; host 15 scenarios / 928 assertions; browser 96/96 (32 per engine); compiler
  tarball 323, CLI 89; nine examples (`basic`, `responsive`, `variables`, `jsx`, `custom-output`,
  `overrides`, `groups`, `portfolio`, `modules`); VSIX 18 files / 140.57 KB (≈140.6 KB).
- `git status` byte-identical before and after; nothing generated changed.
