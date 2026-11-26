# CSSX-STALE-DIAGS · stale importer diagnostics

**Status:** 🟢 PASS (2026-11-26)

## Summary

- After renaming a `$token` or `@runtime` member in a defining module, an open importing document
  did not refresh its diagnostics until the importer itself was edited.
- Root cause: `AnalysisService` cached per document/version and the controller only scheduled the
  edited document. Imported module content is read from disk both by the synchronous analysis reader
  and by `compile()`, so the importer's cached result remained valid by version while the module on
  disk had changed. `groups.ts`/`keyframes.ts` closure memos are per-call (rebuilt on each analysis),
  so the stale state was the service cache, not the memos.
- Fix: `.cssx` change/save/close invalidates every cached analysis and pending debounce and
  re-schedules all open `.cssx` documents on the existing 150 ms debounce. A generation guard makes an
  analysis that spans the invalidation unable to cache or notify.
- Compiler/CLI source unchanged; the CLI side is pinned by an importer-with-missing-member test.

## Root cause

`packages/vscode/src/service.ts` caches `DocumentState` keyed by path and accepts it only when
`state.analysis.version === source.version`. A dependency rename does not change the importer's
document version, and the controller's change/save listeners re-analyzed only the edited module.
`adapter.readModuleSync` and the compiler's default Node host both read the module from disk, so save
is the point where the importer's inputs change. Closing a dirty module also changes the effective
input (open buffer → disk).

## Changes

- `packages/vscode/src/service.ts`
  - `invalidateAll()` clears cache, latest versions and pending timers, and bumps a generation.
  - `analyzeNow()` and `runScheduled()` discard results from an older generation.
- `packages/vscode/src/controller.ts`
  - `isCssxDocument()` and `scheduleOpenCssxDocuments(except?)` helpers.
  - Change: invalidate all, re-schedule every open `.cssx` document.
  - Save: invalidate all, refresh the saved document immediately, debounce the other open documents.
  - Close: clear the closed document's diagnostics, invalidate all, re-schedule the remaining open
    documents (a dirty module falls back to disk).
- Tradeoff: no reverse-import index in 0.1.0. Every `.cssx` edit invalidates all states, so open
  documents re-analyze after the debounce even when they do not import the edited file. This is the
  correctness-first choice for 0.1.0; a reverse-import index can replace it later without changing the
  invalidation contract.
- No watcher, poller or compiler/CLI source change.

## Repro evidence

Host scenario `packages/vscode/test/ui/module-refresh.js` (registered as the 15th suite scenario):

- **Before the fix (red):** after saving the renamed module, the untouched importer timed out after
  20 000 ms waiting for `XESSA2001`:
  `[xessa host] timed out after 20000 ms waiting for XESSA2001 for …/main.cssx`.
- **After the fix (green):** importer reports `XESSA2001` naming `$t.space` (and `$t.colors` for the
  `@runtime` case), clears after the importer references `$t.gap` / `$t.palette`, and the module's own
  `XESSA2001` still appears/clears on its own edit. Host summary: `module-refresh=11`, suite
  `15 scenarios, 923 assertions`.
- CLI pin `tests/integration/cli-build.test.ts` → `an importer with a missing $ member is XESSA2001
  and exits 1`: `check --json` exits 1, JSON diagnostic `XESSA2001` in `src/main.cssx`, message names
  `$t.missing`, no CSS or manifest written.
- Unit pins in `tests/extension/provider.analysis.test.ts`: `invalidateAll` forces an unchanged
  importer version to re-analyze; an analysis spanning invalidation is neither cached nor notified.

## Gates

- `bun test tests/extension/host.test.ts` — PASS, 15 scenarios / 923 assertions.
- `bun run verify` — exit 0, **1348 pass / 2 skip / 0 fail** (1350 tests, 99 files, 71.54 s).
- `bun run release:check` — exit 0 (verify + browser 96/96 + nine examples + VSIX 18 files /
  139.2 KB). One earlier attempt stopped on the stress watch test `discovers a brand-new nested
  directory without a restart` (10 s timeout); it passed on the rerun with no code change.
- `bun run lint` — exit 0.

## Records

`docs/known-limitations.md` §5, `CHANGELOG.md` `[0.1.0]` Fixed, `.ai/todo.md` bug 26,
`.ai/plans/CSSX-PLAN-PRODUCTION.md` row `FIX · stale importer diagnostics`.
