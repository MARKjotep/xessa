# CSSX-A26 — Report: refresh stale suite counts in README and FRAMEWORK.md

## Summary

- Ran `bun run verify` myself: **679 pass, 0 fail, 788 498 `expect()` calls, 679 tests across 41
  files** (12.74 s), exit 0 including the VS Code extension-host smoke suite.
- `README.md` "Testing and quality gates" now says 679 tests across 41 files (was 573/35).
- `FRAMEWORK.md` §8 `bun test` row and §11 first bullet now say 679 tests / 41 files (was 612/37).
- Only those three count strings changed; no test, fixture, golden or config edit.

## Status

🟢 Complete.

## Objective (restated)

Consolidation only: the suite grew through today's CSSX-A17..A25 work and two docs carried stale
suite sizes. Observe the real numbers from `bun run verify` and correct the count strings without
touching anything else.

## Changed files

| File | Change |
|---|---|
| `README.md` | Line 190: `573 tests across 35 files` → `679 tests across 41 files`. |
| `.ai/framework/xessa/FRAMEWORK.md` | §8 table, `bun test` / `bun run test` row: `612 tests / 37 files` → `679 tests / 41 files`. §11 first bullet: same replacement. |
| `.ai/tasks/CSSX-A26.md` | Task prompt (written before implementation). |
| `.ai/reports/CSSX-A26.md` | This report. |
| `.ai/reports/logs/CSSX-A26.log` | Worker log. |

Nothing else was written. The working tree already carried uncommitted changes from earlier tasks
(`.ai/PROGRESS.md`, `SPECIFICATION.md`, `docs/**`, `packages/**`, tests, `README.md` example lists and
the ADR-0015/0016 hunks in `FRAMEWORK.md`); all are preserved untouched. `git diff` for the two
scoped files therefore shows those earlier hunks plus exactly this task's three count-line hunks.

## Evidence

`bun run verify` final test summary (this run):

```text
 679 pass
 0 fail
 788498 expect() calls
Ran 679 tests across 41 files. [12.74s]
```

Extension-host portion also green in the same run:

```text
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error),
1 diagnostic(s), completion 11 item(s), compile+preview commands
[xessa host] test-electron=installed cached=1.147.0 runnable=true
```

Post-edit scan:

```text
$ grep -nE '573|612|35 files|37 files|679|41 files' README.md .ai/framework/xessa/FRAMEWORK.md
README.md:190:`bun run verify` currently passes with 679 tests across 41 files, including a real VS Code
.ai/framework/xessa/FRAMEWORK.md:302:| `bun test` / `bun run test` | 679 tests / 41 files (unit, goldens, ...). |
.ai/framework/xessa/FRAMEWORK.md:397:- `bun run verify` green: 679 tests / 41 files; typecheck includes the VS Code project; Biome clean.
```

No stale count remains in either file.

## Verification

- `bun run verify` — green (typecheck, lint, 679/679 tests, 41 files, 0 fail).
- Acceptance criteria met: no `573` / `612` / `35 files` / `37 files` suite counts in the two scoped
  files; stated numbers equal the observed run.

## Blockers

None.

## Handoff

Completed state: both docs match the observed suite size; gate green.

Remaining steps: none for this task. Note for future tasks that `FRAMEWORK.md` §2 still describes
`tests/compiler/` as 24 files and `tests/fixtures/` as 48 goldens; those were out of this task's
scope (count strings for the suite summary only) and were not changed.

Touched files: `README.md` (one line), `.ai/framework/xessa/FRAMEWORK.md` (two lines),
`.ai/tasks/CSSX-A26.md`, `.ai/reports/CSSX-A26.md`, `.ai/reports/logs/CSSX-A26.log`.
