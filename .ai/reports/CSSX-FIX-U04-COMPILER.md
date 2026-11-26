# CSSX-FIX-U04-COMPILER — single-file duplicate keys now report XESSA2001

## Summary

- `compile()`'s no-`@use` branch no longer discards resolver diagnostics: it keeps the caller's parse
  diagnostics and merges the memory graph's `XESSA2xxx`+ diagnostics via the new
  `singleFileDiagnostics` helper.
- A single-file document with duplicate `@variables` keys (`@variables { gap: 8px; gap: 16px; }`)
  now reports exactly one `XESSA2001` with the resolver's message, later-declaration span and file
  label — identical to `buildModuleGraph()` and to the editor's `tokenNameConflict` diagnostic.
- Duplicate `@runtime` keys and compile-time/runtime name collisions on the single-file path are
  restored by the same merge. The `@use` module-graph path is untouched and still reports one copy.
- Emitted CSS is unchanged (first value wins); no diagnostic codes were added.

## Baseline (read-only, before edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ...
 M packages/compiler/src/formatter/index.ts
 M packages/compiler/src/selectors/flatten.ts
 M packages/compiler/src/variables/expand.ts
 M packages/vscode/src/analysis.ts
 ...
?? .ai/tasks/CSSX-U04.md
?? tests/stress/
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Landed edits across `.ai/`, `packages/cli`, `packages/compiler/src/{formatter,selectors,variables}`,
`packages/vscode` and the test tree were preserved; this lane wrote only its declared files.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/index.ts` | No-`@use` branch calls `singleFileDiagnostics(parsed.diagnostics, diagnosticsForEntry(graph, entryKey))`. New helper drops the graph's redundant syntax (`XESSA1xxx`) copies and merges all resolver diagnostics (`XESSA2xxx`+). |
| `tests/compiler/single-file-duplicate.test.ts` | New focused suite: exact message/span/file for `@variables`, `@runtime` and compile/runtime collision; byte-equality with `buildModuleGraph()`; first-value CSS; `@use` single-report case; `variables/duplicate-local` golden CSS. |
| `.ai/tasks/CSSX-U04.md` | Status set to 🟢 fixed; compiler half appended to `## Fix record`. |

## Evidence

- Root cause confirmed at `packages/compiler/src/index.ts` (former line 246): `baseDiagnostics =
  parsed.diagnostics` after building the memory graph, so the entry record's resolver diagnostics were
  dropped. The `hasUse` branch already used `diagnosticsForEntry(graph, canonicalEntry)`.
- The graph reparses the same source, so its syntax diagnostics duplicate `parse()`'s; filtering
  `XESSA1xxx` avoids adding a second copy under an absolute label. Resolver output (`XESSA2001`) exists
  only in the graph, so it survives.
- Measured compiled diagnostic for `@variables { gap: 8px; gap: 16px; }`:
  `XESSA2001`, message `Duplicate local compile-time variable "$gap" in "/virtual/xessa-single-file/single.cssx".`,
  span `27..37` at the later declaration, CSS `.card { padding: 8px; }` (first value).
- `buildModuleGraph()` with an identity-canonicalizing host returns the identical diagnostic object
  (pinned by `toEqual`).

## Acceptance outcomes

1. Single file, duplicate key, no `@use` → exactly one `XESSA2001` with resolver message/span/file —
   ✅ new test (`single-file-duplicate.test.ts`).
2. `@use` module-graph path still exactly one diagnostic, first value wins — ✅ new test plus existing
   `compile.test.ts`/`modules.test.ts` green.
3. Emitted CSS for existing fixtures byte-identical — ✅ `golden.test.ts` and
   `variables.golden.test.ts` green; `variables/duplicate-local` now asserted through public `compile()`.
4. Bounded compile fuzz green — ✅ `tests/stress/fuzz/compile.test.ts` 9 pass / 0 fail.

## Validation (actual)

| Command | Outcome |
|---|---|
| `bun test tests/compiler/single-file-duplicate.test.ts tests/compiler/compile.test.ts tests/compiler/modules.test.ts tests/compiler/contract.test.ts tests/compiler/variables.golden.test.ts tests/compiler/golden.test.ts` | 68 pass, 0 fail, 446 `expect()` calls |
| `bun test tests/stress/fuzz/compile.test.ts` | 9 pass, 0 fail, 1492 `expect()` calls |
| `bunx tsc -p packages/compiler/tsconfig.json --noEmit` | exit 0, no output |
| Extra targeted: `bun test tests/compiler/formatter.test.ts tests/compiler/groups.expansion.test.ts tests/compiler/setup-span-bounds.test.ts tests/compiler/nesting-bound.test.ts tests/compiler/groups.golden.test.ts` | 83 pass, 0 fail |

## Constraints observed

- No edits to `packages/vscode/**`, `packages/cli/**`, `packages/compiler/src/{formatter,selectors,parser,variables}/**`,
  emitter, `.ai/todo.md` or `CHANGELOG.md`.
- `DIAGNOSTIC_CODES` untouched (`contract.test.ts` green); no new codes.
- No git commits/pushes/stashes/resets, no dependency changes, no weakened assertions.
- Full `bun run verify` not run (campaign instruction).
