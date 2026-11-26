# CSSX-A36 — G5: formatter round-trip for `@group.<name>`

## Summary

- Implemented phase **G5** of `.ai/plans/CSSX-PLAN-GROUPS.md`. `format()` is parse→print, so the
  formatter now prints both ADR-0017 nodes — `group-definition` at top level and `group-use-site`
  inside rule/native bodies — through a shared `Printer.printGroup` that mirrors the sibling
  at-rule printers: `@group.<name> {`, one declaration per line, authored indentation depth, and the
  existing blank-line/comment rules. Format-on-save can no longer delete an authored group.
- **G1 finding fixed and pinned:** pre-G5, formatting
  `@group.card { … } .panel { @group.card { … } }` returned `.panel {\n}\n` with zero diagnostics
  (definition and use sites silently dropped). The same source now round-trips byte-for-byte,
  `parse(format(x))` keeps all three group nodes with identical names and declaration slices, and
  `format(format(x)) === format(x)`.
- Comments are safe by the A24 calibration standard: `embeddedCommentRanges` now covers declarations
  inside both group node kinds, so an inline comment in a group value is never duplicated, while
  block comments and trailing comments keep their existing single-line placement.
- Tests: +9 in `tests/compiler/formatter.test.ts`, +1 in
  `tests/extension/formatter.current-grammar.test.ts`. All 13 `groups/` single-file fixtures keep
  every `@group.` statement and are idempotent. The 54 pre-existing fixtures format byte-identically
  to the pre-G5 formatter (before/after run recorded below). `bun run verify` is green:
  **798 pass / 0 fail across 45 files**.

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017 item 8, plan §7 G5, the formatter module and the A24 `printUse`
   precedent; reproduced the G1 finding before editing.
2. Added `printGroup(name, declarations, endOffset, level)` plus `printGroupDefinition` /
   `printGroupUseSite`, reusing `printBlockItems` so declaration printing, inline variants,
   `!important`, comment attachment and blank-line rules are exactly the rule-body behaviour.
3. Extended `embeddedCommentRanges` for `group-definition` and `group-use-site`.
4. Added the formatter tests (round trip, idempotence, never emptied, fixtures, semicolonless final
   declaration, parse-error fallback, comments, group-free no-churn, compiled-CSS invariance).
5. Added the extension format-shape test and updated that file's header.
6. Wrote this task/report/log and marked only the plan's G5 row 🟢.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/formatter/index.ts` | Imports `GroupDefinition`/`GroupUseSite`; `printItem` handles `group-definition`, `printBlockItem` handles `group-use-site`; new `printGroup` helper (documented with the ADR-0017 release-blocker rationale) plus the two thin wrappers; `embeddedCommentRanges` records declarations inside both node kinds; module JSDoc lists the group layout next to the other directive blocks. No change to any other printer, diagnostic, parse-error fallback or layout rule. |
| `tests/compiler/formatter.test.ts` | New `@group formatting (ADR-0017)` suite (9 tests) with a `groupShapes()` helper that extracts group nodes in source order plus authored declaration slices; fixture count 54 → 67 to include G4a's 13 single-file group fixtures. |
| `tests/extension/formatter.current-grammar.test.ts` | New format-on-save round-trip test for a definition + use site (1 test) and a header update naming `@group` as a shipped grammar feature. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G5 row 🔴 → 🟢 with evidence (that row only). |
| `.ai/tasks/CSSX-A36.md`, `.ai/reports/CSSX-A36.md`, `.ai/reports/logs/CSSX-A36.log` | **New.** Task prompt, this report, worker log. |

No parser, lexer, resolver, lowering, `types/**`, emitter, extension `src/**`, fixture, golden,
doc, ADR, `SPECIFICATION.md`, example, board or masterplan file was touched.

## Implementation notes

### G1 finding: before/after

Reproduction script (same source both runs), before the formatter edit:

```
input:  "@group.card {\n  padding: 12px;\n  border-radius: 8px;\n}\n\n.panel {\n  @group.card {\n    padding: 20px;\n  }\n}\n"
before: ".panel {\n}\n"     diagnostics: []
after:  "@group.card {\n  padding: 12px;\n  border-radius: 8px;\n}\n\n.panel {\n  @group.card {\n    padding: 20px;\n  }\n}\n"  diagnostics: []
```

The pre-G5 output was **byte-identical to the input minus every group node**, which is exactly the
format-on-save data-loss path ADR-0017 marks as the release blocker.

### Layout

- Definition: top-level chunk (`block: true`), printed by `printItem`, so it gets the one blank line
  between top-level constructs that `@setup`/`@variables`/rules already get. Declaration lines are
  `printDeclaration` output (property, raw value, inline variants on the same line, trailing `;`).
- Use site: `printBlockItem` at the caller's `level`, so a use site nested in a rule at depth 2
  prints at depth 2 (`groups/group-position` fixture). It is `block: true`, so the existing rule
  "blank line whenever either side is a nested rule/conditional block" also separates it from
  sibling declarations — the same treatment native at-rule blocks get inside a rule body.
- Empty group: `@group.x {` + `}` only, matching empty-rule output (`groups/empty-group`).
- Trailing comments before `}` are flushed by `printBlockItems`' `endOffset` handling; comments after
  the header attach to the following declaration at `level + 1`.

### Declarations are ordinary declarations

Both group kinds hold `readonly Declaration[]`, so `printDeclaration` already emits inline `@md`
variants and per-segment `!important`. Pinned by the ADR example plus
`padding: 20px !important;` in the use site and by the `inline-variant-default` /
`important-default` fixtures in the fixture-preservation test.

### Comments (A24 calibration)

`embeddedCommentRanges` used to walk only rules/conditionals/native blocks, so a comment inside a
group value would have been printed by the free-standing comment pass **a second time**. Both group
kinds are now visited; the comment test pins `calc(1px /* in value */ + 2px)` appearing once and
`/* before */` once.

### Semicolonless final declaration

The parser produces the same `Declaration` with or without the final `;`; the printer appends `;`
exactly as it does for a rule body. Test pins definition body, use-site body and a plain rule body
in one source (ADR-0011 behaviour, unchanged).

## Verification

### Commands and results

```sh
bunx tsc -p packages/compiler/tsconfig.json --noEmit          # exit 0, no output
bun run lint                                                   # Checked 413 files. No fixes applied. (exit 0)
bun test tests/compiler/formatter.test.ts \
         tests/extension/formatter.current-grammar.test.ts     # 21 pass / 0 fail (175 expect)
bun test tests/compiler                                        # 645 pass / 0 fail (29 files)
bun test tests/extension                                       # 98 pass / 0 fail (10 files)
bun run verify                                                 # exit 0: 798 pass / 0 fail, 45 files
```

`bun run verify` tail:

```
Checked 413 files in 201ms. No fixes applied.
...
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error), 1 diagnostic(s), completion 11 item(s), compile+preview commands
 798 pass
 0 fail
 789269 expect() calls
Ran 798 tests across 45 files.
```

### Group fixture preservation (13 single-file fixtures, no loss, idempotent)

```
alias-group ok errors:0 groupRefs:0        conditional-use-site ok errors:1 groupRefs:2
duplicate-definition ok errors:0 refs:3    empty-group ok errors:0 refs:4
group-named-keyframes ok refs:2            group-position ok refs:3
important-default ok refs:2                inline-variant-default ok refs:2
nested-rule-in-definition ok errors:1 refs:2   no-override ok refs:2
same-file ok refs:2                        two-use-sites ok refs:3
unknown-group ok refs:1
bad: 0
```

The two `errors:1` fixtures are parse-error fixtures: `format()` returns them unchanged, so their
`@group.` statements are preserved by the existing safe-fallback contract, not by the printer.

### Group-free no-churn (before/after over the pre-G5 fixture set)

The pre-edit formatter was run over all fixture inputs immediately before the change (54 entries,
the complete pre-G4a catalog) and compared with the post-change formatter run over the same inputs:

```
baseline entries: 54
compared: 54, identical: 54, mismatched: 0
new fixtures (not in pre-G5 baseline): 13  (groups/*, landed by G4a during this task)
```

### Observed counts

| Measure | Before task | After task | Delta |
|---|---|---|---|
| `bun test` total | 745 pass / 44 files (A33 baseline) | 798 pass / 45 files | +53 tests / +1 file |
| `tests/compiler` | 593 pass / 28 files | 645 pass / 29 files | +52 tests / +1 file |
| `formatter.test.ts` | 8 pass | 17 pass | +9 |
| `formatter.current-grammar.test.ts` | 3 pass | 4 pass | +1 |
| Formatter code diff | — | +45 / −1 lines | printer + comment ranges + docs |
| Pre-existing fixtures byte-identical | — | 54 / 54 | none |

The jump above 745 is not all this task's: G4a landed the 13 single-file `groups/` fixtures, their
goldens and catalog assertions in parallel during this task, and the fixture-count assertions in
`formatter.test.ts` (54 → 67) were updated here because that file is G5-owned. This task's own new
tests are the +10 listed above. The formatter change alone does not alter any existing test count.

## Acceptance mapping (plan §7 G5)

- **`format(format(x)) === format(x)` for sources with definitions and use sites** → dedicated
  idempotence test on the ADR example plus the fixture-wide idempotence test, which now includes all
  13 `groups/` fixtures.
- **A file with a group is never emptied or structurally changed** → the round-trip test compares
  group nodes in source order and the authored declaration slices (`source.slice(span.start,
  span.end)`) before/after; asserts exactly one definition then two use sites, all named `card`, with
  the four defaults and the two overrides byte-identical. The fixture-preservation test asserts the
  `@group.` count is unchanged for every group fixture. The G1 `.panel {\n}\n` output is explicitly
  cited in the regression test comment.
- **Parse-error input returned unchanged** → pinned twice with group syntax present: a malformed
  dotted form (`@group .card`) and a valid definition alongside an invalid top-level `@md` block;
  both return the original source byte-identical and report an error diagnostic.
- **Group printing matches sibling at-rule layout** → exact-output test with one declaration per
  line, 2-space indent, blank line between the definition and the rule, inline use-site expansion to
  a block, `!important` and inline `@md` segment preserved; group-free canonical layout is pinned
  byte-for-byte against the pre-G5 output.
- **`bun run verify` green** → 798 pass / 0 fail across 45 files, lint 413 files clean, typecheck
  clean.

## Constraints and scope compliance

- `format` remains a pure parse→print pass; diagnostics logic, the error fallback and every
  non-group printer branch are untouched. `printGroup` only runs for the two new node kinds.
- Group-free output is byte-identical: verified by the 54/54 before/after comparison and the pinned
  canonical-layout test. No existing expectation was regenerated or weakened; the only edited
  existing assertion is the formatter's fixture-count guard, which G4a's landed fixtures require.
- No framework record was created. This is a compiler-application formatter fix, not a defect or
  feature request in Rossa/Yvee/Shweet, so no framework version applies and no framework dependency
  or upstream repository was touched.
- Browser validation is not part of G5 (§9 lists `bun run test:browser` for G3 completion and G4b)
  and the compiled CSS of group sources is unchanged by formatting (asserted in the new
  compiled-CSS invariance test). Browser rendering remains G4b's gate, not claimed here.

## Blockers, findings and handoff

- **No blockers remain for G5.** During the task the worktree was briefly red from the parallel G4a
  fixture integration (fixture-catalog counts and two test files failing `biome check`); G4a fixed
  those in its own scope before the final `bun run verify` above. No file outside G5's ownership was
  edited to make the gate pass.
- **Finding for G4c (docs, out of scope here):** `docs/known-limitations.md` was written while G5
  was open and words formatter support as "must be verified in your release". Now that G5 is green,
  that qualifier can be dropped; the file is G4c-owned and was not edited by this task.
- **Handoff to G6 (editor):** format-on-save is now safe for group sources; hover/outline/rename can
  use the printed node shapes without a formatter guard. Formatting a use site inside a rule body
  adds the same blank lines native at-rule blocks get — editor tests that pin exact formatted text
  for group sources should expect that layout.
- **Handoff to build:** the fixture count in `tests/compiler/formatter.test.ts` is now 67 and must
  move with any future single-file fixture addition (merged fixtures use `entry.cssx` and are not
  counted).
- Cross-links: `docs/decisions/ADR-0017-reusable-declaration-groups.md` item 8 and Consequences,
  `.ai/plans/CSSX-PLAN-GROUPS.md` §7 G5, `.ai/reports/CSSX-A33.md` (carried release blocker),
  `.ai/tasks/CSSX-A36.md`, `.ai/reports/logs/CSSX-A36.log`.
