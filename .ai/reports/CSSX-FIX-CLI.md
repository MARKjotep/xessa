# CSSX-FIX-CLI — seven CLI defect fixes (T06–T12)

**Status:** 🟢 complete · **Worker:** `code` · **Date:** 2026-11-26
**Scope:** `packages/cli` defects specified in `.ai/tasks/CSSX-T06.md` … `CSSX-T12.md`.

## Baseline (read-only, first command)

```text
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 D .ai/framework/vscode-test-electron/bugs/macos-electron-launcher-missing.md
 M .ai/plans/CSSX-PLAN-PRODUCTION.md
 M .ai/todo.md
 D .pi/agents/*.md
 D .pi/settings.json
 D .pi/subagents.json
 M AGENTS.md
 M docs/compatibility.md
 M docs/known-limitations.md
 M examples/basic/src/button.cssx
 M package.json
 M packages/vscode/test/suite.js
?? .ai/plans/CSSX-PLAN-TESTING.md
?? .ai/plans/CSSX-PLAN-UI.md
?? .ai/reports/CSSX-*.md
?? .ai/reports/logs/
?? .ai/tasks/CSSX-T01.md … T13.md, U01…U06
?? opencode.jsonc
?? packages/vscode/test/fixtures/ui/
?? packages/vscode/test/ui/
?? tests/stress/
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

No commits, pushes, resets, stashes or dependency changes were made. Unrelated working-tree changes
were preserved.

## Summary

- **T06** watch stalls: wakeups are latched (`pendingWake`) and a build that starts writing always
  persists a manifest for what landed, so no edit is dropped and tree/manifest agree after a discard.
- **T07** `.cssx-tmp` orphans: `sweepTemporaries()` removes only the writer's own pattern, from every
  planned output directory on `build` and from manifest/config directories on `clean`.
- **T08** new nested directory: any non-artifact directory event triggers full rediscovery, so a new
  source tree is watched and built without a restart; own artifacts/temporaries/manifest stay ignored.
- **T09** empty include match: owner decision applied — configuration error, exit 2 (text + JSON),
  docs and pins updated; watch `ready` untouched.
- **T10** forged manifest record: `clean` and obsolete-output pruning require an artifact-shaped path
  for the record's kind and an in-workspace `.cssx` source; `notes.txt` is skipped as `untrusted`.
- **T11** `--config --json`: value flags no longer consume a following option; the usage error is
  reported as JSON when `--json` came first.
- **T12** `check --dry-run`: rejected in the args layer with exit 2 (matching the `--check` family).

## Per-defect evidence and acceptance

### CSSX-T06 — watch stall / stale-generation manifest desync

- Files: `packages/cli/src/commands/watch.ts`, `packages/cli/src/commands/build.ts`,
  `tests/stress/soak/helpers.ts`, `tests/stress/soak/watch-soak.test.ts`.
- `notify()` sets `pendingWake` when no waiter exists; `waitForWork()` consumes it. The generation is
  checked immediately before the first artifact rename; once writes start, the manifest is always
  written for the set that landed (removing the "skip manifest after late invalidation" desync).
- Committed soak cadence restored to 250 ms (race-reaching) with an explanatory comment.
- Validation:
  - `XESSA_SOAK=1 XESSA_SOAK_WATCH_EDITS=5 XESSA_SOAK_WATCH_INTERVAL_MS=250 bun test tests/stress/soak/watch-soak.test.ts`
    → pass; edits=5 builds=6 staleDiscards=0, manifest records=artifacts=400, problems=0.
  - Same with `XESSA_SOAK_WATCH_EDITS=20` → pass; edits=20 builds=20 staleDiscards=0, problems=0.
  - `bun test tests/stress/fs/watch.test.ts tests/integration/cli-watch.test.ts` → 8 pass.
- Full `bun run verify` intentionally not run (integration worker owns the gate).

### CSSX-T07 — interrupted-build `.cssx-tmp` orphans

- Files: `packages/cli/src/writer.ts`, `packages/cli/src/commands/build.ts`,
  `packages/cli/src/commands/clean.ts`, `tests/stress/fs/interrupt.test.ts`,
  `docs/known-limitations.md`, `docs/configuration.md`.
- `sweepTemporaries(directories)` matches `/^\..+\.[0-9]+\.[0-9]+\.cssx-tmp$/` only. Build sweeps the
  root plus every planned output dir before writing; clean sweeps root, configured output dirs and
  record dirs. Silent by design; documented.
- Pinned case flipped: planted `out/src/.a.css.999999.1.cssx-tmp` is gone after rebuild and after
  `clean`; the SIGKILL case now asserts zero residue after the rebuild.
- Validation: `bun test tests/stress/fs/interrupt.test.ts` → pass; `tests/stress/fs/` → 54 pass;
  `tests/integration/` → 55 pass.

### CSSX-T08 — new nested directory never discovered

- Files: `packages/cli/src/commands/watch.ts`, `tests/stress/fs/watch.test.ts`,
  `docs/known-limitations.md`.
- Event classification now ignores known artifacts, `.cssx-manifest.json` and `*.cssx-tmp`, schedules
  incremental work for `.cssx`, and schedules full rediscovery for any other entry (directory
  create/remove). New sources are discovered and `syncWatchers` attaches to the new tree.
- Pinned case flipped: `mkdir src/fresh` + `src/fresh/five.cssx` produces `out/src/fresh/five.css`
  and a build event naming `src/fresh/five.cssx`; prune/excluded cases unchanged.
- Validation: `bun test tests/stress/fs/watch.test.ts` → pass; `tests/integration/cli-watch.test.ts`
  → pass.

### CSSX-T09 — empty include match exits 0

- Owner decision: **exit 2** (configuration error). Rationale: exit 1 is compile/validation; a
  moved/typo'd source tree must fail CI loudly. No opt-out flag was added.
- Files: `commands/build.ts`, `commands/check.ts`, `commands/watch.ts`,
  `tests/stress/cli/exit-codes.test.ts`, `docs/configuration.md`, `docs/known-limitations.md`,
  `README.md`.
- Text: stderr `xessa: No .cssx sources matched the project include globs.` JSON:
  `{command, success:false, exitCode:2, error}`. Watch `ready` NDJSON and single-file mode unchanged.
- Goldens: none covered the empty case; `tests/stress/cli/golden/*` byte-identical (no regeneration
  needed).
- Validation: `bun test tests/stress/cli/` → 69 pass; `bun test tests/integration/` → 55 pass.

### CSSX-T10 — `clean` manifest-provenance delete primitive

- Files: `packages/cli/src/manifest.ts`, `commands/clean.ts`, `commands/build.ts`,
  `tests/stress/fs/manifest.test.ts`, `tests/stress/cli/clean-manifest.test.ts`,
  `docs/known-limitations.md`.
- New `isArtifactRecord()`: path suffix must match `kind` (`.css`, `.js`, `.d.ts`, `.map`) and `source`
  must be a workspace-relative `.cssx`. `clean` additionally requires the source inside the workspace;
  failures are `skipped` with reason `untrusted`, warned, and dropped from the manifest. The same shape
  check guards obsolete-output pruning in `build`.
- Genuine artifacts keep today's behaviour (unmodified deleted, modified kept); `--dry-run` reports the
  same `skipped`/`would-delete` split; `--json` unchanged in shape.
- Validation: `bun test tests/stress/fs/manifest.test.ts` → pass;
  `bun test tests/stress/cli/clean-manifest.test.ts` → pass; full `tests/stress/fs/` + `tests/stress/cli/`
  → 123 pass.

### CSSX-T11 — `--config --json` misparse

- Files: `packages/cli/src/args.ts`, `tests/stress/cli/exit-codes.test.ts`.
- A value flag refuses a following token that starts with `-` (except a bare `-`), yielding
  `xessa: --config requires a path.` at parse time. `build --json --config` emits the JSON invocation
  error; `build --config --json` stays text. `--config=` and duplicate `--config` keep their usage
  errors.
- Validation: `bun test tests/stress/cli/` → 69 pass; `tests/integration/` → 55 pass.

### CSSX-T12 — `check --dry-run` ignored

- Decision: reject in the args layer, matching `--check is only valid for xessa format.`.
- Files: `packages/cli/src/args.ts`, `tests/stress/cli/precedence.test.ts`,
  `docs/configuration.md`, `README.md`.
- `check --dry-run` → exit 2 `xessa: --dry-run is not valid for xessa check.`; with `--json` the
  standard JSON invocation error. `check --json`, `build/clean/format --dry-run` goldens unchanged.
- Validation: `bun test tests/stress/cli/precedence.test.ts` → pass; `tests/stress/cli/` → 69 pass.

## Typecheck

`tsc -p packages/cli/tsconfig.json --noEmit` fails in this checkout before reading the changed code:
`node_modules/@types` is absent at the workspace root (only `packages/vscode/node_modules/@types`
exists), so every `node:*` import is unresolved. Exposing that installed copy reproduces a clean
typecheck with no errors in the changed files:

```sh
tsc -p packages/cli/tsconfig.json --noEmit \
  --typeRoots packages/vscode/node_modules/@types --types node
# exit 0
```

This is an environment/install state, not a code change; no dependency or tsconfig edits were made.

## Not run

- `bun run verify` (full gate) — owned by the integration worker; concurrent full builds violate the
  resource rule.
- `XESSA_SOAK=1 bun test tests/stress/soak/` in full (cold-build/1000-file cases) — the T06 watch soak
  was run directly at 5 and 20 edits instead.
