# CSSX-A23 — Plan: reusable declaration groups (`@group.<name>`)

## Summary

- Wrote `.ai/plans/CSSX-PLAN-GROUPS.md`: the full design for `@group.<name>` (top-level declaration
  sets, use-site override blocks, splice semantics through the existing §5.4 cascade, `styles`-based
  visibility as the default proposal, XESSA2001 recovery, separate `group` symbol kind), phases
  G0–G6 with exclusive owned scopes and acceptance criteria, fixture/browser matrices, risks, and a
  🔴-only Implementation Progress table.
- **Implementation is deferred.** No code, fixture, ADR, doc or source file was touched. G0 (ADR-0017
  + SPECIFICATION.md) is a hard gate before G1; the plan says so explicitly.
- Three owner decisions are recorded as blockers for the ADR: (a) token-only-import visibility,
  (b) `@runtime` references inside group defaults, (c) diagnostic reuse vs a new subcode. Four
  authoring details (inline variants in defaults, whitespace in `@group.<name>`, empty groups,
  duplicate-definition placement) are left to ADR-0017 authoring with proposals.
- Exactly four files changed by this task: `.ai/tasks/CSSX-A23.md`, `.ai/plans/CSSX-PLAN-GROUPS.md`,
  this report and the worker log. Everything else in `git status` pre-exists from parallel tasks.

## Deliverable

`/Users/Marky/Desktop/$/xessa/.ai/plans/CSSX-PLAN-GROUPS.md` (424 lines).

Structure: status/sanction statement → `## Implementation Progress` (G0–G6, all 🔴) → motivation with
a worked `@group.card` example → design (§2.1 definition, §2.2 use site, §2.3 emergent-cascade
override rule, §2.4 symbol kind/visibility/collisions, §2.5 diagnostics, §2.6 spans/substitution
attribution, §2.7 grammar shape) → v1 exclusions → open owner decisions → ADR authoring details →
phase/task table → per-phase acceptance criteria → fixture + browser matrix → quality gates →
concurrency → risks → non-goals.

## Design recorded (lead + owner decisions, 2026-11-25)

- Definition is top-level, declarations-only, non-parametric; no nested rules, conditionals, native
  at-rules or group chaining (the latter keeps recursion impossible).
- Use site is a rule body `@group.<name> { <overrides> }`; expansion is a **splice**: group defaults
  in definition order, then the block's declarations in authored order, at the authored position.
  Repeated properties are all emitted — the override is the ordinary later-base-declaration cascade
  (§5.4, BY DESIGN). Filtering or deduping the group's lines is explicitly forbidden (invariant 3) and
  is pinned by an IR/CSS test and a browser scenario.
- Visibility follows the ADR-0015 keyframes pattern as the proposal: own file plus transitive
  `@use "…" styles;`. The plan notes the honest difference — groups emit no CSS themselves, so there
  is no emit-safety hazard forcing the rule; hence it is an owner decision, not an inheritance.
- Errors reuse XESSA2001: unknown group → block omitted (§5.5 precedent), ambiguous imported group →
  XESSA2001 at the use site, duplicate definition → XESSA2001 first-wins, `@use … as group` →
  XESSA2001 at the `@use`. Syntax-level misuse is XESSA1001. No new subcode unless the frozen-registry
  process (§4 / FRAMEWORK §9.5) is followed — open decision (c).
- `group` is its own symbol kind and a reserved directive name; `$group.<name>` is not a thing;
  `@keyframes` (ADR-0015) and import aliases are independent.
- Out of v1: conditional/variant use sites, nested rules in groups, `@apply`, parameters/chaining,
  cross-module renaming, bare include form, `$group.` value refs, editor support in the compiler
  phase.
- Editor support is scheduled as follow-ups (completion after `@group.`, hover showing defaults plus
  the overridden properties, outline, rename, TextMate scopes) with their own file scopes.
- Quality gates: language change ⇒ ADR-0017 + SPECIFICATION.md section + fixtures/goldens +
  `bun run verify` + `bun run test:browser` (cascade-visible), golden diffs reviewed, determinism
  re-checked.

## Open decisions (owner, before G1)

| # | Question | Recommendation |
|---|---|---|
| a | Token-only-import visibility for groups | `styles` only, mirroring ADR-0015 (single visibility model) |
| b | `@runtime` references inside group defaults | Disallow in v1 (XESSA2001 segment omission); author runtime refs at the use site |
| c | XESSA2001 reuse vs new `XESSA2xxx` subcode | Reuse XESSA2001 per the ADR-0015 precedent |

Additional ADR-authoring details (proposals in plan §5): inline variants allowed in defaults;
contiguous `@group.<name>` only; empty definitions legal; duplicate diagnostic on the later
definition.

## Changed files

| File | Change |
|---|---|
| `.ai/tasks/CSSX-A23.md` | **New.** Planning prompt with summary, objective, constraints, acceptance criteria, validation. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | **New.** The plan (design, phases G0–G6, scopes, acceptance, progress table). |
| `.ai/reports/CSSX-A23.md` | **New.** This report. |
| `.ai/reports/logs/CSSX-A23.log` | **New.** Worker log (gitignored by `*.log`, present on disk by design). |

No other file was written, modified or deleted by this task.

## Validation

| Check | Result |
|---|---|
| `git status --porcelain` (before/after set comparison) | ✅ Delta is the A23 plan, task and report; the fourth file (`.ai/reports/logs/CSSX-A23.log`) is intentionally invisible to git because `.gitignore` line 25 ignores `*.log` — verified present on disk (4,296 bytes). Two unrelated entries (`.ai/reports/CSSX-A20.md`, `.ai/reports/CSSX-A22.md`) and `.ai/tasks/CSSX-A24.md` appeared from parallel workers during the session; they are not mine. |
| Worktree outside `.ai/` | ✅ Untouched: all `M` entries and feature files pre-date this task (parser/resolver/variables/vscode/tests from A17–A22). |
| Progress table | ✅ `grep -c 🔴` = 7 (G0–G6), no other status symbol in the table. |
| Plan mentions the ADR gate | ✅ Status header, §G0 task row and §9 state ADR-0017 + owner sign-off precede any code. |
| Tests/builds | ⚪ Not applicable — planning-only task, zero source changes. |

## Notes / blockers

- **Blockers for implementation:** owner answers to (a)–(c) and acceptance of ADR-0017. Until then the
  plan deliberately has no assigned phase date and no worker owns a compiler scope for it.
- **Shared-tree concurrency:** the worktree was already dirty from A17–A22 when this task started
  (including a new `tests/fixtures/keyframes/` group and ADR-0015/0016). Nothing in that set was
  touched; the plan references ADR-0015/0016 as context only.
- **No `.ai/framework/` record:** this is a Xessa language/design plan, not a third-party framework
  defect or feature request, so the framework-version requirement does not apply.
- The plan intentionally does not edit `.ai/CSSX-MASTERPLAN.md`, `.ai/PROGRESS.md` or `.ai/todo.md`;
  the board already carries item 8 as "🔴 planned (CSSX-A23 plan written to
  `.ai/plans/CSSX-PLAN-GROUPS.md` …)" from its owning worker.

## Handoff

Complete. Deliverable is `.ai/plans/CSSX-PLAN-GROUPS.md`; the next action belongs to the owner
(answers to a–c, approve ADR-0017), then to the G0 docs task. No implementation scope is owned by
A23 and nothing needs to be released; all four written files are final.
