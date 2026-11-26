# CSSX-A44 — keyframes semantics decisions (ADR-0018)

## Summary

- Recorded the owner's three keyframes-semantics answers of 2026-11-25 in new
  `ADR-0018-keyframes-visibility-and-exclusions.md`: styles-only visibility is permanent (ADR-0015
  unchanged), string-named keyframes are rejected, and conditional keyframes are rejected for v0.1
  and deferred beyond it. The emit-safety rationale is spelled out in the ADR.
- Closed todo item 11 and the compiler-semantics half of item 6: one blunt known-limitations §4 row,
  a minimal `SPECIFICATION.md` §6.4 rejected-constructs note plus §13 wording, and the plan's stale
  near-top status line now says complete and shipped (G0–G6).
- Decisions only — no language, compiler, parser, formatter, test, fixture or example change. ADR-0015
  stands as shipped. `bun run verify` green at **849 pass / 0 fail / 45 files**.

## Changed files

| File | Change |
|---|---|
| `docs/decisions/ADR-0018-keyframes-visibility-and-exclusions.md` | **New.** ADR-0015's structure: Status (`Accepted`, 2026-11-25, (i) styles-only confirmed, (ii) string-named rejected, (iii) conditional rejected/deferred); Context (the three open questions plus A42 editor parity making them load-bearing); Decision — (i) styles-only permanent with the emit-safety rationale (a token-only import contributes tokens but no CSS, so the target `@keyframes` block is never emitted and the reference would animate nothing; the editor hover cites this), XESSA2001 unchanged; (ii) string-named rejected (not valid CSS, no engine support, string decoding in a `dollar-ref` member for no value); (iii) conditional/nested keyframes rejected for v0.1, top-level-only rule restated, revisiting needs a new ADR with fixtures and a three-engine gate; editor parity as a consequence. Rejected alternatives: emit-on-reference for token-only imports (blurs the token/`styles` line from ADR-0017 (a)), string-name normalization (reference and emitted block would live in different name spaces), conditional lowering with a three-engine browser gate. Consequences: no language/compiler change, exclusions documented, todo item 11 closes, editor and compiler cannot drift. Related links: ADR-0015, ADR-0017, SPECIFICATION §6.3/§6.4/§13, A19/A42 reports, todo 6/11. |
| `docs/known-limitations.md` | §4 gains one row, "String-named and conditional keyframes": `@keyframes "fade"` is rejected and nested `@keyframes` blocks are not collected; both stay native-only and cannot be referenced, no v0.1 change (ADR-0018). The neighbouring "Keyframe references need a rule-merge import" row keeps the styles-only/emit-safety and duplicate-name text, drops the now-duplicated string/nested tail, and links both ADRs. |
| `SPECIFICATION.md` | §6.4 gains a one-paragraph "Rejected constructs" bullet naming both exclusions and citing ADR-0018 (no normative behaviour change). The stale "Editor support … not part of v0.1" bullet now states that the VS Code extension provides completion/hover/rename over exactly the visible set (CSSX-A42). §13's keyframe bullet now separates the permanent styles-only rule from the two rejected constructs and records that keyframe editor support is no longer deferred. |
| `.ai/todo.md` | Item 11 🟢 done in CSSX-A44 with the decision summary and doc references; item 6 remains the editor-half record. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | The near-top `**Status:** planned, **not implemented**.` paragraph now reads complete and shipped (G0–G6; editor release A39/A40/A42), retained as the historical design record with ADR-0017 normative. No other plan content touched. |
| `.ai/PROGRESS.md` | A44 row appended: ADR-0018 decisions, doc/board updates, docs-only 849/45. |
| `.ai/reports/CSSX-A43.md` | Handoff gains a follow-up note: the plan status observation is fixed and the keyframes semantics half is closed here; nothing else in A43 changed. |
| `.ai/tasks/CSSX-A44.md`, `.ai/reports/CSSX-A44.md`, `.ai/reports/logs/CSSX-A44.log` | New task, this report, worker log. |

## Verification

| Command | Outcome |
|---|---|
| `bun run verify` | 🟢 exit 0 — typecheck + lint green (422 files), **849 pass / 0 fail across 45 files** |

Docs-only change set, so the count equals the A42/A43 baseline (849/45); no test was added, weakened
or skipped.

## Accuracy notes

- ADR-0018 records the decisions; ADR-0015's text, the compiler implementation, the XESSA codes, the
  goldens and the A42 editor behaviour are untouched.
- Spec §6.4's "Editor support … not part of v0.1" bullet and §13's deferred-editor clause were false
  after A42; both were corrected minimally as part of the same §6.4/§13 note rather than left
  contradicting the shipped extension.
- The new limitation row and the trimmed neighbour row describe exactly what the compiler does today
  (top-level plain identifiers + transitive `styles`; token-only names XESSA2001).

## Blockers

None.

## Handoff

- Completed: ADR-0018, limitations row, spec notes, todo closure, plan status line, PROGRESS row,
  A43 follow-up note, task/report/log.
- Touched files: the table above; nothing else. No commit or push performed.
- Next action: none required for A44.
