# CSSX-A35 — G4c: author-facing documentation for `@group.<name>`

## Summary

- Documented the shipped `@group.<name>` feature for authors in four pages, in their existing voice:
  `docs/grammar.md` (EBNF, directive row, definition/use-site/expansion subsection),
  `docs/cascade.md` (§2 override example with the two pinned consequences), `docs/compatibility.md`
  (supported feature row replacing the stale "deferred" row, plus a mixins/`@apply` row),
  `docs/known-limitations.md` (blunt ADR-0017 item 9 exclusions, editor-intelligence gap, neutral
  formatter note).
- Only shipped G1–G3 behaviour is described: definitions emit nothing and are top-level only; use
  sites are rule-body blocks that splice defaults in definition order then overrides in authored
  order; no filtering, no reordering; overrides win by the ordinary cascade.
- No promise of `@apply`, parameters/interpolation, conditional use sites, group chaining,
  re-export/renaming or `$group.<name>` values; all are listed as exclusions.
- Docs-only change; `bun run verify` is green: **745 pass / 0 fail across 44 files**, no source or
  test diff (G4a/G4b/G5/G6 files untouched).

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017 (items 1–9), `SPECIFICATION.md` §3.6/§3.7, plan §3 and the G4c row, and
   the four target docs end to end before editing.
2. Add `@group` syntax to `docs/grammar.md` beside the sibling directives.
3. Add the `.panel`/`.tile` override example and the two pinned cascade consequences to
   `docs/cascade.md`.
4. Replace the outdated compatibility/limitation rows and add the group feature row and exclusions.
5. Verify the formatter state before keeping any formatter note (G5 runs in parallel).
6. Run validation, write task/report/log, mark the plan's G4c row 🟢 (only that row).

## Changed files

| File | Change |
|---|---|
| `docs/grammar.md` | §1 `@`-recognition paragraph now says `@group.<name>` inside a rule is a *use site*; §2 EBNF adds `groupDefinition` to `file` and `groupUseSite` to `rule` (wrapped like `SPECIFICATION.md` §3), with a note that the two productions are identical because position decides; §3 directive table gains `@group.<name>` (top level = definition, rule body = use site); new §3 subsection "Reusable declaration groups (`@group.<name>`)" with the ADR-0017 card example and four bullets: definition (top level, declarations only, contiguous dotted name, emits nothing, empty legal/inert), use site (required block, declarations only, nested rules/conditional/native at-rules are XESSA1001, points at `known-limitations.md`), expansion (defaults then overrides at the authored position, one run, no filter/reorder/dedupe, links `cascade.md#2-precedence`), and visibility (`styles` modules mirroring `$keyframes`, `as group` and `$group.` are XESSA2001). |
| `docs/cascade.md` | §1 notes that a use site expands in place within authored order; §2 new "Worked example — group defaults and use-site overrides" with the ADR-0017 `@group.card` / `.panel` / `.tile` source and its lowering (all defaults emitted, overrides appended; `.ui-panel` / `.ui-tile`), explaining that overrides win only as "later base declaration wins" at equal specificity and that nothing is filtered; then the two pinned consequences: a use-site base beats an earlier `@md` default at every width (with the `@group.heading` wording and emitted order), and a group `!important` default is not beaten by a plain override (ADR-0003 per-segment binding). Cross-links ADR-0017 and ADR-0003. |
| `docs/compatibility.md` | §1 table: stale `Mixins / @group / @apply` deferred row replaced by a ✅ `Reusable declaration groups (@group.<name>)` row (top-level definitions + rule-body use sites, no CSS for definitions, compile-time splice as one declaration run, no runtime/generated code — "ordinary CSS declarations that engines cascade normally", explicitly noting the G4b Playwright scenarios are not in the recorded matrix yet; `styles`-only visibility, `as group`/`$group.` XESSA2001; evidence cites the three compiler group test files) and a ❌ `Mixins / @apply` deferred row that no longer claims `@group` is missing. §4 gains a "Groups are not mixins" bullet (no parameters/arguments/interpolation, no conditional use site, no chaining; use sites are expanded, never analysed) linking `known-limitations.md`. |
| `docs/known-limitations.md` | §4: stale "No mixins/reusable groups" row replaced by `@group` v1 exclusions — unconditional use sites (`@group.x @md+dark { … }` and conditional definitions are XESSA1001), declarations-only blocks (nested rules/conditional blocks/native at-rules are XESSA1001), no `@apply`, no parameters/arguments/interpolation, no group chaining, no cross-module renaming or re-export, no bare include `@group.<name>;` (XESSA1001), `$group.<name>` is not a value (XESSA2001), compile-time-only defaults (`@runtime` in a default is XESSA2001), and a neutral formatter line; plus a "No mixins / `@apply`" row. §5: new "Group name intelligence" editor row (no completion/hover/outline/rename/highlighting yet; follow-up release, ADR-0017/G6). |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G4c row (only) annotated 🟢 with the task id and the verify baseline. The aggregate G4 row stays 🔴 because G4a/G4b are open. |
| `.ai/tasks/CSSX-A35.md`, `.ai/reports/CSSX-A35.md`, `.ai/reports/logs/CSSX-A35.log` | **New.** Task prompt, this report, worker log. |

No other file was modified: `git status --porcelain` shows only these four docs, the plan and the
three record files from this task (other pre-existing working-tree changes belong to A29–A34 and the
G4a/G5 workers).

## Per-file summary of the shipped behaviour stated

- **grammar.md** — `@group.<name> { declaration… }` is a top-level definition (declarations only,
  contiguous dotted name, exact case-sensitive match, emits no CSS, empty legal); the identical form
  inside a rule is a use site with a required block (bare `@group.x;` is XESSA1001); expansion
  splices defaults in definition order then use-site declarations in authored order at the authored
  position as one declaration run with no filter/reorder/dedupe; `styles`-only visibility; `as group`
  and `$group.<name>` are XESSA2001.
- **cascade.md** — the ADR-0017 lowering is reproduced verbatim in behaviour (six declarations for
  `.panel`, five for `.tile`); overrides win only via later-at-equal-specificity ordering; the
  inline-`@md`-default and `!important`-default consequences are stated as by-design and pinned.
- **compatibility.md** — feature row describes behaviour, not an unrun matrix: "ordinary CSS
  declarations that engines cascade normally", with G4b explicitly recorded as pending.
- **known-limitations.md** — every ADR-0017 item 9 exclusion is stated in the negative; editor
  support is a follow-up release; formatter support is "verify in your release".

## Verification

```sh
bun run verify
# typecheck (4 packages) + biome check + bun test
# 745 pass, 0 fail, 788795 expect() calls, 745 tests across 44 files
```

```sh
git diff --stat docs .ai/plans
#  docs/cascade.md          | 69 +++++++++++++++++++++++++++++++
#  docs/compatibility.md    |  6 +++-
#  docs/grammar.md          | 55 +++++++++++++++++++++++++++++++--
#  docs/known-limitations.md|  4 ++-
#  .ai/plans/CSSX-PLAN-GROUPS.md | 29 +++++++-----  (16 of these lines are pre-existing A30–A33 plan edits)
git diff --check docs .ai/plans   # clean: no whitespace errors
```

Formatter check before finalizing (G5 is parallel): `grep -rn "group-definition\|group-use-site\|GroupDefinition"
packages/compiler/src/formatter` returns **no matches**, and the `index.ts` header still lists only
`@setup`, `@variables`, `@runtime`, `@media-types` directive blocks. The limitation is therefore
kept, phrased neutrally as "`format()` support for `@group` is a separate formatter work item (G5);
verify it in your release before relying on format-on-save with groups" — true whether or not G5
lands first, and it does not assert that the formatter drops groups.

## Notes for the lead

- No contradiction with ADR-0017 or §3.7 was found while writing; the docs quote the splice rule, the
  `!important`/variant consequences, the diagnostic codes and the exclusion list rather than
  paraphrasing them into new promises.
- The docs deliberately say nothing about the browser matrix beyond "G4b is not recorded yet"; when
  G4b lands, `compatibility.md`'s row and `cascade.md` §5 can cite the new spec file without changing
  any sentence written here except that pending note.
- Framework records: none created. No framework defect or feature is involved; the only outstanding
  formatter work is tracked as G5 in the plan and owned by another task.
- Handoff to G4b/G5: the four docs are final for this task; no other task needs to touch them unless
  the browser gate or formatter changes a claim (both are covered by the neutral wording above).

## Handoff

- Completed: G4c docs, records and the plan's G4c row.
- Remaining for G4: G4a fixtures/goldens (parallel) and G4b browser gate (pending) — the aggregate
  G4 plan row correctly stays 🔴.
- Touched files: the four docs, the plan's G4c row, and the three CSSX-A35 records.

## Follow-up (2026-11-25)

Corrected one stale line in `docs/known-limitations.md`: the §5 row "No property documentation
hover | Intentional until a CSS projection layer exists." was false since CSSX-A29 shipped built-in
one-sentence property documentation (`packages/vscode/src/property-docs.ts`, 107 entries) for both
hover and completion. The §5 row is now "Property docs are a built-in table | Hover and completion
use one-sentence built-in descriptions for the 107 supported properties; the full
`vscode-css-languageservice` data (all properties, MDN links) is intentionally not embedded.", and
the §1 "Editor CSS intelligence" row no longer claims "Property hover is empty" (status now
"Projection deferred"). Docs-only; `bun run verify` re-run green at 745 pass / 0 fail across 44
files. Not edited, but the same stale "property hover is intentionally empty" clause remains in
`docs/compatibility.md` §3 (CSS language-server projection row) and needs the same one-clause
correction in a follow-up.
- 2026-11-25: `docs/compatibility.md` §3's CSS language-server projection row now states the shipped
  truth — hover and completion use the built-in one-sentence table for the 107 supported properties,
  and full `vscode-css-languageservice` data (all properties, MDN links) remains intentionally not
  embedded; no other line changed.
- 2026-11-25: after G5 (CSSX-A36) landed and was lead-verified, `docs/known-limitations.md` §4's
  `@group` v1-exclusions row dropped its now-false final sentence about `format()` support being a
  pending formatter work item; every other word of the row is unchanged.
