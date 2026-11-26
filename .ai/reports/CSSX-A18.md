# CSSX-A18 — Editor intelligence: native at-rules + missing-semicolon quick fix

## Summary

- Typing `@` outside any rule body now offers the native at-rules Xessa passes through (`@keyframes`, `@media`, `@font-face`, `@import`, `@property`, `@supports`, `@layer`, `@container`, `@page`, `@charset`, …) after the five Xessa directives, with prefix filtering intact.
- Native at-rules are only offered where the specification allows them: everything at top level, only CSS-nesting-legal at-rules inside a rule body, and nothing mid-value.
- A `XESSA1002` (missing semicolon) diagnostic gets a **Quick Fix → Add semicolon** code action that inserts `;` at the diagnostic's reported position; pure logic is unit-tested without an editor.
- `.ai/todo.md` is now the permanent bug/feature intake board with the users' original wording preserved.

**Status:** implemented. Scoped gates are green (`bun run typecheck`, Biome on `packages/vscode/src` + `tests/extension`, `bun test tests/extension` = 85 pass incl. the real extension-host smoke). Repo-wide `bun run verify` is currently red **only** on parallel workers' in-progress CSSX-A17/A19 files (see Blockers). `.ai/PROGRESS.md` untouched; no framework records needed (this is the project's own extension, not an external-framework defect).

## Changed files

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `sortText?` on `CompletionSuggestion`; `braceDepthAt` / `atStatementStart` helpers; text-based top-level classification for the `directive` context; mirror of the compiler's native at-rule list with per-rule placement + docs; directive completion now offers Xessa directives → natives → aliases, all prefix-filtered. |
| `packages/vscode/src/quickfixes.ts` | **New.** Pure `missingSemicolonFixes(analysis, selection)` and `QuickFix`/`QuickFixEdit` types; one "Add semicolon" action per insertion offset, side-effect free. |
| `packages/vscode/src/providers/code-actions.ts` | **New.** Thin `CodeActionProvider` (`quickfix` kind) over the pure fix, associating the matching reported diagnostics and setting `isPreferred`. |
| `packages/vscode/src/controller.ts` | Registers the code action provider alongside the existing providers. |
| `packages/vscode/src/adapter.ts` | `toAnalysisRange` (editor → pure range) for the code action provider. |
| `packages/vscode/src/providers/completion.ts` | Maps the new optional suggestion `sortText` onto `CompletionItem`. |
| `tests/extension/provider.intelligence.test.ts` | +5 tests: top-level natives (all ten required, detail/doc, ordering), prefix filtering, rule-body restriction, mid-value suppression, recovery-pending top level. |
| `tests/extension/provider.quickfix.test.ts` | **New.** 5 tests: real `XESSA1002` insertion at value end, the reported `&`-before-nested-rule shape, offset dedupe, line/code/file filtering, multi-line selections. |
| `.ai/tasks/CSSX-A18.md`, `.ai/reports/CSSX-A18.md`, `.ai/reports/logs/CSSX-A18.log`, `.ai/todo.md` | Task, report, worker log, bug/feature board. |

## Completion behavior

`SPECIFICATION.md` §3.4 allows native at-rules in rule blocks; §3.5 preserves `@supports`, `@layer`,
`@container`, `@keyframes`, `@font-face` and `@property` contexts. Placement is therefore:

- **Top level** (brace depth 0): the five Xessa directives (top-level-only, as before), every native
  at-rule Xessa passes through, then media aliases. The list is ordered directives → natives →
  aliases, and suggestions carry `sortText` groups `0-…` (Xessa) / `1-…` (native) so VS Code keeps
  directives visually first.
- **In a block at a statement start** (rule body or native group block): media aliases first, then
  only the conditional group rules CSS Nesting accepts (`@media`, `@supports`, `@layer`,
  `@container`, `@scope`, `@starting-style`, `@nest`). `@keyframes`, `@font-face`, `@property`,
  `@import`, `@charset`, `@page` and the rest are not suggested in an invalid nested position.
- **Mid-value** (`padding: 10px @m`): aliases only — no at-rule suggestions.

Context detection for `@` is now text-based (`braceDepthAt` ignoring strings/comments), so
recovery-pending statements cannot suppress the top-level directive list. Prefix filtering applies
to both families (`@k` → only `@keyframes`, `@me` → `@media-types` then `@media`, `@se` → `@setup`).
The native table mirrors `packages/compiler/src/parser/rule.ts` `NATIVE_AT_RULES`, which the public
barrel does not export (invariant 9: no deep imports).

## Quick fix

`XESSA1002` reports the declaration span from the first property character to the last value
character (`parser/declaration.ts`), including in CSSX-A17's new `&`-before-nested-rule recovery
path. The fix therefore inserts `;` at `problem.range.end`, exactly the reported position, and
applies to all `XESSA1002` problems on the selected line(s) of the current file only.
`XessaCodeActionProvider` is registered for `xessa` with `providedCodeActionKinds: [QuickFix]`; it
reuses `AnalysisService` (same analysis the diagnostics provider publishes) and attaches the
matching reported diagnostics.

## Evidence

Failing-before (tests added before the fix; `bun test tests/extension/provider.intelligence.test.ts`):

```
(fail) completion contexts > native at-rules complete at top level after @ (includes @keyframes)
(fail) completion contexts > the typed prefix filters native at-rules and Xessa directives
(fail) completion contexts > rule bodies only offer CSS-nesting-legal native at-rules
(fail) completion contexts > top-level @ completion survives recovery-pending statements
 16 pass
 4 fail
```

Passing-after (`bun test tests/extension/provider.intelligence.test.ts tests/extension/provider.quickfix.test.ts`):

```
 25 pass
  0 fail
111 expect() calls
```

Other scoped validation:

- `bun run typecheck` → exit 0 (all four projects, including the VS Code project).
- `bunx biome check packages/vscode/src tests/extension` → clean.
- `bun test tests/extension` → 85 pass / 0 fail, including the real `@vscode/test-electron`
  extension-host run (activation with the new provider, grammar, commands, diagnostics, completion,
  compile+preview).

## `.ai/todo.md`

Restructured into the lead's board (`## Bug reports` / `## Feature requests`, statuses
🔴🟡🟢). Items keep the owner's wording verbatim:

1. Missing code suggest / missing-semicolon error — 🟢 fixed: compiler diagnostic via CSSX-A17,
   editor quick-fix via CSSX-A18.
2. Built-in `@` not auto-suggested outside a class body — 🟢 done in CSSX-A18.
3. `$keyframe.name` request — 🟡 in progress (CSSX-A19 / ADR-0015, fallback `@variables`; left as
   written; the proposed "see also item 4" tail was dropped as not natural).
4. Clashing/overridable variable names + `:root` strategy — 🔴 open (CSSX-A20 / ADR-0016).
5. Showcase example for runtime variables/overrides — 🔴 open (CSSX-A21).

## Blockers

Repo-wide `bun run verify` is red because of files owned by parallel workers; none were modified
here (exclusive scope respected):

- `bun run lint` → 5 Biome errors in `packages/compiler/src/resolver/keyframes.ts`,
  `packages/compiler/src/resolver/scopes.ts`, `packages/compiler/src/resolver/graph.ts`,
  `tests/compiler/keyframes.test.ts` (CSSX-A19 files).
- `bun test` → 6 failures, all CSSX-A17/A19 artifacts: four assertions expecting the frozen
  48-fixture catalog / 48 golden files now see 52 fixtures
  (`tests/compiler/pipeline.test.ts`, `tests/compiler/sourcemap.test.ts`,
  `tests/compiler/formatter.test.ts`, fixture-catalog suite) and two `tests/compiler/keyframes.test.ts`
  visibility tests from A19.

Re-run `bun run verify` after A17 and A19 land (or their fixture-count/format fixes are applied by
their owners). Nothing in this task's code is implicated; `tests/extension` and the VS Code project
are green independently.

## Handoff

- Completed: native at-rule completion (top level + legal nested positions), text-based top-level
  `@` detection, prefix filtering, directive-first ordering; pure missing-semicolon quick fix plus
  its registered provider and tests; todo board with items 1–5.
- Remaining: lead verification once CSSX-A17 (compiler `XESSA1002` for `&`-before-nested-rule) and
  CSSX-A19 (keyframes namespace) are integrated; the editor quick fix already consumes A17's
  diagnostic shape (verified against its in-progress span contract and a synthetic test).
- Touched files: see the changed-files table; no compiler, spec, ADR or `.ai/PROGRESS.md` edits.
