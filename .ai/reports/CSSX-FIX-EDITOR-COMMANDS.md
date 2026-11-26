# CSSX-FIX-EDITOR-COMMANDS — U04 rename collision + single-file duplicate keys, U06 empty preview

## Summary

- **U04 (rename collision):** a token rename onto a name that already exists is now refused in the
  provider before any `WorkspaceEdit` is built, with
  `A token named "$<name>" already exists in scope.`; the document stays byte-identical.
- **U04 (duplicate keys):** a single-file document with duplicate `@variables` keys (or a
  compile/runtime name collision) is now diagnosed as `XESSA2001` by the editor analysis layer; the
  message, span and file label match the compiler resolver. Module-graph documents keep their single
  compiler diagnostic (the synthetic walk is skipped when `@use` is present).
- **U04 compiler half is BLOCKED:** `compile()` discards the memory-graph entry diagnostics for
  documents without `@use`; the precise location is recorded below for the lead to route.
- **U06 (empty preview):** `Preview Compiled CSS` on a document with no producible CSS now shows the
  existing warning and opens no preview tab; tolerant documents with surviving CSS still preview.
- Host suite green: 13 scenarios, **826 assertions** (navigation 24, commands-matrix 101), exit 0.

## Baseline (read-only, before edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ...
 M packages/cli/src/args.ts
 M packages/compiler/src/formatter/index.ts
 M packages/compiler/src/selectors/flatten.ts
 M packages/vscode/src/analysis.ts
 M packages/vscode/src/groups.ts
 M packages/vscode/src/intelligence.ts
 M packages/vscode/src/keyframes.ts
 M tests/extension/provider.navigation.test.ts
 ?? .ai/tasks/CSSX-U04.md
 ?? .ai/tasks/CSSX-U06.md
 ?? packages/vscode/test/ui/
 ...
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Unrelated in-tree edits in `packages/cli`, `packages/compiler`, `intelligence.ts`,
`providers/completion.ts`, `analysis.ts`/`groups.ts`/`keyframes.ts` (U01–U03/U05/T13 lane) and
`.ai/` were preserved; this lane only touched its write set.

## CSSX-U04 — rename onto an existing name / silent single-file duplicate

### Changed files

| File | Change |
|---|---|
| `packages/vscode/src/providers/navigation.ts` | `provideRenameEdits` re-checks the cursor token after a successful `renameAt` plan and throws when `tokenNameConflict` finds an existing local name. |
| `packages/vscode/src/analysis.ts` | New `tokenNameConflict(analysis, name, renaming)` and `collectTokenNameProblems(...)`; the walk is merged into `analyzeText` problems only when the AST has no `@use`. |
| `packages/vscode/test/ui/navigation.js` | Four pins removed; refusal regex + byte-identical text + one `gap:` declaration asserted (lines 179-202). |
| `tests/extension/provider.navigation.test.ts` | Additive: conflict helper reports `gap`, ignores the renamed symbol and free names. |
| `tests/extension/provider.analysis.test.ts` | Additive: single-file duplicate is exactly one `XESSA2001` (message/range asserted), first value still wins; module-graph duplicate still exactly one. |

### Design

- `analysis.tokens` holds only the document's own compile-time and runtime declarations (imported
  members live in `analysis.imports`), and both symbol spaces share the `$name` namespace, so the
  conflict scan matches the compiler's collision rule. The renamed symbol is excluded by range
  comparison, keeping same-name renames a no-op.
- Shape validation still wins: the `renameAt` refusal reason is thrown before the collision check.
  Group and keyframe renames keep their existing checks inside `renameAt`; `tokenAt` finds nothing
  for their headers, so the new guard cannot intercept them.
- Duplicate diagnostics reuse the resolver's exact strings
  (`Duplicate local compile-time variable "$gap" in "<file>".`,
  `"$primary" cannot be both a compile-time and a runtime variable in "<file>".`) and the later
  declaration's full span, so a module-graph document would dedupe rather than double-report — the
  `@use` gate makes that moot and keeps the compiler's copy authoritative.

### Acceptance outcomes

1. Rename onto an existing name refused, document unchanged — ✅ host row (refusal + text equality)
   and unit helper test.
2. Non-conflicting renames unchanged (3 edits/1 file token; 3 edits/2 files group) — ✅ host navigation
   scenario still green (24 assertions, includes prepareRename pin and both original refusal paths).
3. Four pins removed and positively asserted — ✅ `navigation.js`.
4. Compiler-side duplicate question recorded and routed — ✅ measured silent in `compile()` for
   single-file input; editor now diagnoses it; compiler fix BLOCKED and specified below.
5. Host suite green — ✅ 13 scenarios / 826 assertions. `bun run verify` not run (campaign
   instruction).

### Compiler half — 🔴 BLOCKED

`packages/compiler/src/index.ts` `compile()` — the no-`@use` branch (lines ~237-247) builds a
memory-only module graph and then sets `baseDiagnostics = parsed.diagnostics`, discarding the
entry's graph diagnostics. Measured: `buildModuleGraph()` on the same single-file source reports the
duplicate (golden fixture `tests/fixtures/variables/duplicate-local` expects `XESSA2001`), while
`compile()` returns `[]` and emits the first value. Fix: merge the entry record's graph diagnostics
as the `hasUse` branch does via `diagnosticsForEntry`. Not edited here (`packages/compiler/**` is
outside this lane's write set).

## CSSX-U06 — dead document opens an empty preview tab

### Changed files

| File | Change |
|---|---|
| `packages/vscode/src/controller.ts` | `previewCss` guard is `css === undefined \|\| css.trim() === ""`; existing warning reused, no new string. |
| `packages/vscode/test/ui/commands-matrix.js` | Pin removed; dead document must stay the active editor and no `xessa-preview:` editor naming it may be visible (lines 223-242). |

### Acceptance outcomes

1. No preview document opened, warning branch taken, previous editor active — ✅ host row
   (`activeTextEditor` unchanged, no visible `xessa-preview` for `dead.cssx`).
2. Tolerant case unchanged — ✅ host rows: missing semicolon still previews `.app-button {` without
   `color: red` and keeps diagnostics; clean document still previews compiled CSS.
3. Pin removed and replaced — ✅ `commands-matrix.js`.
4. Host suite green — ✅ (see below). `bun run verify` not run (campaign instruction).

## Validation (actual)

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.navigation.test.ts tests/extension/provider.analysis.test.ts` | 41 pass, 0 fail, 177 `expect()` calls |
| `bun test tests/extension/host.test.ts` | 13 scenarios, 826 assertions, exit 0 (`navigation=24`, `commands-matrix=101`) |
| `bunx tsc -p packages/vscode/tsconfig.json --noEmit` | exit 0, no output |

## Constraints observed

- No edits to `packages/compiler/**`, `packages/cli/**`, `intelligence.ts`,
  `providers/completion.ts`, `packages/vscode/test/ui/checklist.js`, `.ai/todo.md`, `CHANGELOG.md`.
- No git commits/pushes/stashes/resets, no dependency changes, no weakened assertions.
