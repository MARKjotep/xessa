# CSSX-A27 — Report: FRAMEWORK.md §2 repo-map counts for `tests/compiler/` and `tests/fixtures/`

## Summary

- Observed tree: **25** `*.test.ts` files in `tests/compiler/`, **54** `input.cssx` goldens spread
  over **13** fixture groups (15 top-level dirs; `cli/` and `modules/` hold no `input.cssx`).
- `FRAMEWORK.md` §2 rows now read `54 input.cssx goldens in 13 groups` and `25 files`; every other
  word in both rows is unchanged.
- `bun run verify` green: typecheck + Biome + **679 pass, 0 fail, 679 tests across 41 files**,
  including the VS Code extension-host smoke.
- Only the two count strings changed, plus this task's three `.ai` records. No tests, fixtures,
  goldens, sources, configs, `README.md`, `PROGRESS.md` or todo files touched.

## Status

🟢 Complete.

## Objective (restated)

The §2 repo map still carried pre-A17 counts. Observe the real tree, replace only the stale counts
in the `tests/fixtures/` and `tests/compiler/` rows, and re-run the gate.

## Observed numbers (commands run)

```text
$ ls tests/compiler/*.test.ts | wc -l
      25

$ find tests/fixtures -name "input.cssx" | wc -l
      54

$ for d in tests/fixtures/*/; do find "$d" -name input.cssx | wc -l; done
  canonical 1, config 1, errors 9, global 1, important 1, keyframes 3, lexical 7, media 5,
  naming 4, nesting 3, output 8, runtime 3, variables 8  -> 13 groups, sum 54
  cli 0, modules 0

$ ls -d tests/fixtures/*/ | wc -l
      15
```

Group semantics follow `tests/fixtures/README.md`: `tests/fixtures/<group>/<fixture>/input.cssx` is
the golden entry, matched by `tests/compiler/golden.test.ts`, which walks directories that contain
`input.cssx`. `cli/` (project fixtures) and `modules/merge/` (merged `entry.cssx` builds) are not
`input.cssx` groups and stay described separately in the row.

## Changed files

| File | Change |
|---|---|
| `.ai/framework/xessa/FRAMEWORK.md` | §2 line 56: `48 input.cssx goldens in 12 groups` → `54 input.cssx goldens in 13 groups`. §2 line 57: `24 files:` → `25 files:`. |
| `.ai/tasks/CSSX-A27.md` | Task prompt (written before implementation). |
| `.ai/reports/CSSX-A27.md` | This report. |
| `.ai/reports/logs/CSSX-A27.log` | Worker log. |

`git diff --stat .ai/framework/xessa/FRAMEWORK.md` moved from `18 insertions(+), 8 deletions(-)` to
`20 insertions(+), 10 deletions(-)` — exactly the two owned lines on top of earlier uncommitted
ADR-0015/0016 and examples-list hunks from CSSX-A19/A20/A26.

## Verification

`bun run verify` (this run):

```text
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error),
1 diagnostic(s), completion 11 item(s), compile+preview commands
[xessa host] test-electron=installed cached=1.147.0 runnable=true
 679 pass
 0 fail
 788498 expect() calls
Ran 679 tests across 41 files. [14.20s]
```

Post-edit scan confirms the old strings are gone from the file:

```text
$ grep -n "24 files\|48 `input.cssx`\|12 groups" .ai/framework/xessa/FRAMEWORK.md
(no matches)

$ sed -n '56,57p' .ai/framework/xessa/FRAMEWORK.md
| `tests/fixtures/` | 54 `input.cssx` goldens in 13 groups + `cli/` project fixtures + `modules/merge/` 7 goldens using `entry.cssx`. |
| `tests/compiler/` | 25 files: unit + golden suite (lexer, parser, lowering, media, modules, merge, naming, output, planner, runtime, selectors, sourcemap, substitute, formatter, pipeline, contract). |
```

## Blockers

None.

## Handoff

Completed state: §2 fixture/compiler counts match the observed tree; gate green.

Remaining steps / observations for the lead (out of scope, not changed):

1. The row's trailing note mentions only `modules/merge/` 7 `entry.cssx` goldens, but 13 `entry.cssx`
   entries exist: 7 under `modules/merge/` plus 3 under `keyframes/` and 3 under `runtime/`. The note
   undercounts merged-style fixtures even though the primary `input.cssx` count is now exact.
2. The `tests/compiler/` row's parenthetical suite list is a partial legacy list (it omits
   `compile`, `golden`, `keyframes`, `mapgen`, `resolver`, `variables.golden`,
   `lexer.fixtures`/`lexer.invariants`) while including `contract`/`emitter`.
3. `.ai/PROGRESS.md` P8 · A27 row is still marked 🟡 in progress; that file is lead-owned and was not
   edited here.

Touched files: `.ai/framework/xessa/FRAMEWORK.md` (two lines), `.ai/tasks/CSSX-A27.md`,
`.ai/reports/CSSX-A27.md`, `.ai/reports/logs/CSSX-A27.log`.
