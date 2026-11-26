# CSSX-A38 — record close-out for the `@group` compiler phase (G0–G5)

## Summary

- Closed out the completed `@group` compiler phase (plan G0–G5, CSSX-A30 through CSSX-A37) in the
  project records only: added the missing `groups` row to the browser README coverage table,
  appended eight `PROGRESS` rows (`A30`–`A37`) matching the existing style, and flipped
  `.ai/todo.md` item 8 from 🔴 planned to 🟢 done in CSSX-A30–A37.
- Records were written against `.ai/reports/CSSX-A30..A37.md`, not from memory: counts, fixture
  totals, test files and the three G4c follow-ups all match those reports.
- `bun run verify` is green: **798 pass / 0 fail / 45 files** (lead baseline unchanged). No source,
  test, docs, example, fixture, plan or `button.cssx` file was touched.

## Objective (as executed)

1. Read `AGENTS.md`, the browser README coverage table, `.ai/PROGRESS.md`, `.ai/todo.md`, the plan's
   G0–G6 rows and the A30–A37 reports.
2. Add the `groups` coverage row (G4b explicitly left the README out of its scope).
3. Append one terse `PROGRESS` row per task with the observed evidence.
4. Update todo item 8, keeping the owner's original request text.
5. Run `bun run verify`; write this report plus the task and log.

## Changed files

| File | Change |
|---|---|
| `tests/browser/README.md` | Coverage table gains a `groups` row: `@group.<name>` D1–D5 in `specs/groups.pw.ts` — override wins at 320/767/768/1279/1280, base override beats an `@md` default at every width (by design), `@dark`/`@reduced` keep un-overridden defaults, a group `!important` survives a plain override, pretty/minify and safe/`none` grouping agree. Same two-column format as the neighbouring scenario rows. |
| `.ai/PROGRESS.md` | Eight rows appended after A29: A30 (G0 ADR-0017 + §3.2/§3.6/§3.7, docs-only 681/41), A31 (G1 grammar/AST, 27+4 tests, 712/42), A32 (G2 resolver, 11 tests, position-decides correction, 723/43), A33 (G3 expansion, 22 tests, cross-module token pin, 745/44), A34 (G4a 20 fixtures, 30 golden tests, catalogue 54→67, 798/45), A35 (G4c docs, 3 lead-directed follow-ups, 745/44), A36 (G5 formatter release blocker, 54 pre-existing + 13 group fixtures preserved, 798/45), A37 (G4b browser gate, 96/96 three engines, 798/45). |
| `.ai/todo.md` | Item 8: 🔴 planned → 🟢 done in CSSX-A30–A37 (ADR-0017; plan G0–G5 complete: compiler expansion, resolver, goldens, browser gate and formatter landed; editor intelligence is a follow-up release per ADR-0017/G6). Owner request text unchanged. |
| `.ai/tasks/CSSX-A38.md`, `.ai/reports/CSSX-A38.md`, `.ai/reports/logs/CSSX-A38.log` | **New.** Task prompt, this report, worker log. |

No other file was modified. Pre-existing working-tree changes from A29–A37 (the A29 `PROGRESS` row
and todo items 9/10, compiler/vscode/docs/fixtures/browser harness) were present before this task
and left untouched.

## Verification

### Commands

```sh
bun run verify
git diff --stat tests/browser/README.md .ai/PROGRESS.md .ai/todo.md
git status --porcelain
```

### Output tail — `bun run verify`

```
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... && tsc -p packages/vscode/tsconfig.json --noEmit
$ biome check .
$ bun test
...
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error), 1 diagnostic(s), completion 11 item(s), compile+preview commands

 798 pass
 0 fail
 789269 expect() calls
Ran 798 tests across 45 files. [15.18s]
```

Exit code 0. Identical to the lead-run baseline (798/0/45); no golden, fixture or generated artifact
changed (`git status --porcelain tests/fixtures` shows only A34's pre-existing `groups/` additions).

### Diff scope

```
 .ai/PROGRESS.md         | 9 +++++++++
 .ai/todo.md             | 6 +++++-
 tests/browser/README.md | 1 +
 3 files changed, 15 insertions(+), 1 deletion(-)
```

The 9 `PROGRESS` insertions are the pre-existing A29 row plus my eight rows; the todo `+6/−1`
includes the pre-existing A29 items 9/10. My own delta is the eight rows, item 8's line and the
README row.

### Browser gate

`bun run test:browser` was **not re-run**: nothing under `tests/browser/**` changed except the
README (prose), and the lead had just run the suite at 96 passed in three engines. The last
recorded browser evidence remains `.ai/reports/CSSX-A37.md` (96/96; 32 per engine). No browser
assertion was added, changed or weakened here.

## Accuracy checks against the A30–A37 reports

- Counts per row: 681/41 (A30), 712/42 with 27 parser + 4 lexer tests (A31), 723/43 with 11 resolver
  tests (A32), 745/44 with 22 expansion tests (A33), 798/45 with 30 golden tests and catalogue
  54→67 (A34), 745/44 docs-only (A35), 798/45 with 54 pre-existing fixtures byte-identical and
  13/13 group fixtures preserved (A36), 96/96 browser + 798/45 verify (A37).
- The A35 row's "3 lead-directed follow-ups" matches the report's follow-up section and the current
  docs: `docs/known-limitations.md` §5 property-docs row corrected (A29), `docs/compatibility.md` §3
  CSS-projection row corrected (A29), and `docs/known-limitations.md` §4 formatter sentence dropped
  after G5/A36.
- No stale 🔴 for the groups compiler phase remains: the only 🔴 in `.ai/plans/CSSX-PLAN-GROUPS.md`
  is the G6 editor row (correctly deferred), and todo item 8 is now 🟢. The A23 `PROGRESS` row's
  parenthetical "phases G0–G6, 🔴 table" is a historical A23 deliverable statement and was left
  unchanged deliberately.

## Constraints and scope compliance

- Owned files only: `tests/browser/README.md`, `.ai/PROGRESS.md`, `.ai/todo.md`, task/report/log. No
  plan, source, test, docs, example or fixture edit; `button.cssx` untouched.
- No UI decision changed and no test weakened; no test was run under a modified assertion set.
- No framework record was created: this is project record-keeping for Xessa, not a defect or feature
  request in Rossa/Yvee/Shweet, so no framework version applies.

## Final state and handoff

- **State:** `@group` phase G0–G5 is recorded as complete (🟢) in `PROGRESS` and the todo board, with
  the browser README now documenting the `groups` scenario. G6 (editor intelligence) remains the
  only deferred item and is correctly 🔴 in the plan.
- **Validation:** `bun run verify` green at 798/0/45; browser evidence is the lead-run 96/96.
- **Remaining steps:** none for this task. If G6 is scheduled later, its records should extend these
  eight rows rather than edit them.
- **Touched files:** the table in **Changed files**.
- Cross-links: `.ai/plans/CSSX-PLAN-GROUPS.md`, `docs/decisions/ADR-0017-reusable-declaration-groups.md`,
  `.ai/reports/CSSX-A30.md`–`.ai/reports/CSSX-A37.md`, `.ai/tasks/CSSX-A38.md`,
  `.ai/reports/logs/CSSX-A38.log`.
