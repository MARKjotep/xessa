# CSSX-A30 — G0: ADR-0017 and normative `@group` specification

## Summary

- Wrote `docs/decisions/ADR-0017-reusable-declaration-groups.md` as **accepted** (owner sign-off
  2026-11-25), recording the definition/use-site grammar, the splice-then-override expansion rule,
  styles-only visibility, the compile-time-only default rule, XESSA2001 reuse and recovery, the nine
  v1 exclusions and the five rejected alternatives.
- Integrated the normative text into `SPECIFICATION.md`: new **§3.7** (grammar, splice semantics with
  the `.panel`/`.tile` lowering, visibility/precedence, tokens/spans, diagnostics, out-of-scope),
  §3.2 productions, §3.6 reserved `group` and §13 no longer deferring `@group`.
- Flipped the plan's G0 row to 🟢 with an evidence note; nothing else in
  `.ai/plans/CSSX-PLAN-GROUPS.md` changed.
- Docs-only: zero source, test, fixture, golden, diagnostic-registry or board edits.
  `bun run verify` is green with counts identical to the pre-change baseline (681 pass / 0 fail,
  41 files). G1 is now unblocked.

## Objective (as executed)

1. Read `.ai/plans/CSSX-PLAN-GROUPS.md` (design §2, exclusions §3, owner decisions §4, authoring
   details §5, G0 acceptance §7), ADR-0015 as the format template, `SPECIFICATION.md` §3/§5/§13 and
   `.ai/framework/xessa/FRAMEWORK.md` §7 invariants 10/11.
2. Author ADR-0017 in ADR-0015's exact structure (Status, Context, Decision, Rejected alternatives,
   Consequences, related links in Status), written as an accepted record — no decision is re-opened.
3. Add the normative spec text without renumbering existing sections.
4. Verify docs-only state: `bun run verify`, golden/`tests/**` untouched, file-set delta reviewed.

## Owner decisions recorded verbatim (2026-11-25)

| # | Decision | ADR location |
|---|---|---|
| a | **styles-only** visibility: own top-level definitions plus transitive `@use "…" styles;` (ADR-0014); token-only imports expose no groups; mirrors ADR-0015 | ADR-0017 Decision 4, spec §3.7 "Visibility and precedence" |
| b | **compile-time only** defaults: a `@runtime` reference in a group default is XESSA2001 with the declaration segment omitted (§5.5); runtime customization is authored at the use site | ADR-0017 Decision 6, spec §3.7 "Tokens and spans" |
| c | **reuse XESSA2001**: no new subcode in v1; messages name the group and, for ambiguity, the two defining modules | ADR-0017 Decision 5 and 7, spec §3.7 "Diagnostics" |

## Changed files

| File | Change |
|---|---|
| `docs/decisions/ADR-0017-reusable-declaration-groups.md` | **New** (252 lines). Status line `Accepted (owner sign-off 2026-11-25; decisions (a) styles-only, (b) compile-time-only defaults, (c) reuse XESSA2001)`. Decision 1 definition grammar (top-level, declarations only, non-parametric, contiguous dotted form, emits nothing, empty legal/inert); Decision 2 use-site grammar (any rule body/depth, block required, declarations only); Decision 3 splice semantics (defaults in definition order then overrides in authored order at the authored position, `.panel` lowering, no filter/reorder/dedupe/rewrite, invariant 3, `!important` per segment ADR-0003, §5.2 by-design consequences, grouping unchanged); Decision 4 visibility (a); Decision 5 names/precedence/failures (c) incl. local shadow, ambiguity, duplicate, `@use … as group`, `$group.<name>`, message wording; Decision 6 token resolution and spans, runtime rejection (b), naive-AST-copy engineering consequence, source maps on authored text; Decision 7 the plan §2.5 matrix verbatim (unknown-group row updated to the decided visibility) plus the rejected default-less recovery; Decision 8 authoring details (inline variants, whitespace, empty, duplicate span, element order, formatter layout); Decision 9 the nine v1 exclusions with "recorded in `docs/known-limitations.md` at G4c". Rejected alternatives: (a)-ii, (b)-ii, (c)-ii, filtering/deduping, default-less emission. Consequences: phases G1–G6, G5 formatter release blocker, G6 follow-up release, frozen registry untouched. Related: ADR-0003/0005/0011/0014/0015, masterplan §12, FRAMEWORK §7, plan, CSSX-A23, CSSX-A30, todo item 8. |
| `SPECIFICATION.md` | New **§3.7 Reusable declaration groups** (normative, ADR-0017): EBNF, definition rules, use-site rules, splice expansion with the plan's `.panel`/`.tile` example lowered to equivalent authored CSS, visibility/precedence (styles-only, local-shadow, ambiguity, duplicate, alias rejection, `$group.`, `@group.keyframes`), token scope and runtime rejection, authored spans, XESSA1001/XESSA2001 diagnostics, v1 out-of-scope list. §3.2 EBNF gains `groupDefinition`/`groupUseSite` (wrapped `file`/`rule` productions) and lists `@group` definitions as top-level only, with a pointer to §3.7. §3.6 reserves `group` and states `@use … as group` is XESSA2001 at the `@use`. §13 drops the group half of the mixin bullet and states after the list that `@group` is no longer deferred (specified by ADR-0017 in §3.7 with its v1 exclusions). `+121/−7` lines, no renumbering. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G0 row only: 🔴 → 🟢 with the evidence note (ADR-0017 + §3.7/§3.6/§13 written; owner answers (a) styles-only, (b) compile-time-only defaults, (c) reuse XESSA2001 recorded 2026-11-25). `1` line changed. |
| `.ai/tasks/CSSX-A30.md` | **New.** This task's prompt (summary, objective, files, dependencies, constraints, acceptance, validation). |
| `.ai/reports/CSSX-A30.md` | **New.** This report. |
| `.ai/reports/logs/CSSX-A30.log` | **New.** Worker log. |

No other file was written, modified or deleted. Cross-links: task CSSX-A23 /
`.ai/reports/CSSX-A23.md` (the plan this phase belongs to) and `.ai/plans/CSSX-PLAN-GROUPS.md`.

## Evidence

### `bun run verify` (final state)

```
$ bun run typecheck && bun run lint && bun run test
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... && tsc -p packages/vscode/tsconfig.json --noEmit
$ biome check .
$ bun test
...
 681 pass
 0 fail
 788514 expect() calls
Ran 681 tests across 41 files. [13.37s]
exit=0
```

Baseline before any edit (`bun run verify`, same tree): `681 pass / 0 fail / 788514 expect() calls /
41 files`, exit 0. Counts are identical; the only log noise is the extension-host harness's
`[AgentHostCustomizationMarketplace]`/`[ChatModelSelection]` lines emitted by the VS Code test
electron, present in both runs.

### Docs-only / golden proof

| Check | Result |
|---|---|
| `git diff --name-only -- tests` | Only `tests/extension/provider.intelligence.test.ts`, which is the parallel CSSX-A29 worker's pre-existing change (present in the start-of-session status set). No fixture or `expected/**` path changed; goldens byte-identical. |
| `git status --porcelain` delta vs start | Added: `docs/decisions/ADR-0017-…md`, `.ai/tasks/CSSX-A30.md`, `.ai/reports/CSSX-A30.md` (+ the gitignored log); modified: `SPECIFICATION.md`, `.ai/plans/CSSX-PLAN-GROUPS.md` (G0 row). Pre-existing parallel changes (`.ai/PROGRESS.md`, `.ai/todo.md`, `examples/basic/src/button.cssx`, `packages/vscode/src/{intelligence,property-docs,hover}.ts`, `tests/extension/provider.intelligence.test.ts`, `.ai/tasks/CSSX-A29.md`, `.ai/reports/CSSX-A29.md`) were not touched. |
| Plan progress | `grep -c 🔴` = 6 (G1–G6); the G0 row is the only 🟢. |
| Off-limits files | `.ai/CSSX-MASTERPLAN.md`, `.ai/PROGRESS.md`, `.ai/todo.md`, `docs/known-limitations.md`, `packages/compiler/src/types/diagnostics.ts`, `packages/**`, `tests/**`, `examples/**` — untouched by this task. |

## Acceptance (plan §7 G0)

| Criterion | Result |
|---|---|
| ADR-0017 follows ADR-0015's format (status, context, decision, rejected alternatives, consequences, related links) | ✅ |
| ADR states the definition grammar, splice semantics, visibility (a), the (b) runtime rule, diagnostics/recovery with (c), the nine v1 exclusions and all three owner answers | ✅ |
| SPECIFICATION grammar/§3.6/§13 updated consistently with the ADR; no contradiction between the documents | ✅ (§3.2, §3.6, §3.7, §13) |
| `bun run verify` green, counts unchanged (docs only) | ✅ exit 0; 681 pass / 0 fail / 41 files, identical to baseline |
| No golden diff | ✅ no `expected/**` or fixture path in `git diff` |
| Report records the verify output tail and the exact files touched | ✅ above / changed-files table |

## Notes / blockers

- **G0 gate satisfied.** ADR-0017 is accepted text and §3.7 is normative; G1 (lexer/parser) may start
  under its own task and lead approval for the additive AST nodes. Nothing in this task approved or
  changed `packages/compiler/src/types/ast.ts`; that remains a G1 lead-approved step.
- **No `.ai/framework/` record.** This is a Xessa language/spec change, not a third-party framework
  defect or feature request, so the mandatory framework-version requirement does not apply.
- **Author-facing docs are G4c.** `docs/grammar.md`, `docs/compatibility.md`,
  `docs/known-limitations.md` and `docs/cascade.md` are deliberately untouched until behaviour is
  frozen after G3; ADR-0017 item 9 and spec §3.7 already freeze the exclusion list they must state.
- **Message wording** is specified ("Unknown group \"@group.card\" …", ambiguity names the two
  defining modules) but not implemented; G2/G3 own the exact strings and fixtures.
- **Pre-existing citation gap, deliberately not "fixed" here.** `SPECIFICATION.md` has §5.1–§5.4
  only: "§5.5" (undefined member → XESSA2001 + segment omission) is shorthand used by plan §2.5,
  ADR-0015 and the existing spec §6.4, but no §5.5 subsection exists in this document. New §3.7
  therefore cites the sections that do exist (§6.1 undefined/ambiguous symbols, §12 omission), and
  ADR-0017 keeps the plan §2.5 matrix verbatim as instructed with a footnote naming the normative
  locations. Defining a §5.5 would be lead-owned spec work outside G0; it is flagged for the lead.
- No test was added by design: there is no implementation to test, and adding spec-text assertions
  would exceed the G0 scope.

## Handoff

Complete. Next owner is the G1 task: lexer/parser support for `@group.<name>` per ADR-0017 and
spec §3.2/§3.7. G1 must keep group-free sources byte-identical and may not edit `types/**` without
lead approval. Files final: ADR-0017, `SPECIFICATION.md` (§3.2, §3.6, §3.7, §13), the plan's G0 row,
this task/report pair and the worker log.
