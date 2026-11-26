# CSSX-U1 — Host harness upgrade

**Phase:** U1 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete (phase status left 🔴 in the plan; build owns flips)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree
**Write set used:** `packages/vscode/test/suite.js`, `packages/vscode/test/ui/**`,
`packages/vscode/test/fixtures/ui/**`, this report + `CSSX-U0.md`, `.ai/plans/CSSX-PLAN-UI.md` §U0 tables.
Not touched: `packages/vscode/src/**`, `packages/vscode/package.json`, `tests/extension/**`,
`tests/fixtures/**`, `tests/stress/**`.

## Summary

- The single-file host smoke test became a **runner + 9 scenario modules**, still launched exactly as
  before (`extensionTestsPath` unchanged, plain CommonJS, no build step, no TypeScript).
- The suite grew from **31 assertion call sites / 36 executed assertions** to **320 measured assertions**
  — every original assertion is preserved verbatim in `ui/baseline.js` (36 executions), plus
  **284 new host assertions** across suggest-widget, hover, diagnostic, colour, command, navigation and
  quick-fix behaviour. Target was ≥25.
- Two **UI defects** and two **API limits** were pinned instead of skipped (see *Defects*): the
  `$`-namespace sigil loss and the `&&:hover` doubling are real editor-only bugs.
- Verified twice consecutively with identical output (`320 assertions`, `2 pass / 0 fail`), inside
  `bun run verify` (`1160 pass / 2 skip / 0 fail`, host suite included) and with `bun run lint`.

## Architecture

| File | Role | Assertions |
|---|---|---|
| `packages/vscode/test/suite.js` | Runner: loads each module in order, prints one summary line per scenario, rethrows a failure with the scenario name plus the compared values | — |
| `packages/vscode/test/ui/host.js` | Shared helpers: `createAsserter()` (counts), `createWorkspace()` (`mkdtemp` + `realpath`), `openFixture`/`openDocument`, `positionOf`/`offsetOf`, `waitFor` (bounded polling), `waitForDiagnostics`, `settleDiagnostics`, `completionItems`, `byLabel`, `kindHistogram`, `rangeOf`, `insertTextOf`, `applyCompletion`, `hoversAt`, `hoverMarkdown`, `documentColors`, `colorPresentations` | — |
| `ui/baseline.js` | The original cases, unchanged in meaning: activation, grammar scope, language contribution, `formatOnSave` default, 6 command ids, `@2xl`, broken-fixture diagnostics, Compile File artifacts, Preview document, Format Document, format-on-save off/on/parse-error | 36 |
| `ui/completions.js` | 21 suggest-widget states covering the U0 12-context table: `@`, `$`, `$`-namespace pin, `.`, `&`, `:`, `/`, `(`, `#f0`, `#` (empty), `color: `, `width: `, units, `1r`, `1%`, property (setting on/off), `@setup` key, `@setup` value, `@group.`, `$keyframes.` — kinds, details, documentation, filterText, ranges, insert text, and the text after acceptance | 98 |
| `ui/hovers.js` | `executeHoverProvider` on `$brand`, `$theme`, property, `calc()`, `@md`, `.card`, `.title`, keyframe, group definition/use; Markdown-only hygiene; two negative positions | 42 |
| `ui/diagnostics.js` | `XESSA1001/1002/1003/2001/3001` with exact spans, `source`, severity, message; clean document stays clean for the whole debounce window | 36 |
| `ui/colors.js` | 6 swatches (named + hex + alpha 0.502 + custom property + non-colour property), 5 A51 negatives, 2 `executeColorPresentationProvider` presentations (lowercase hex, exact range) | 42 |
| `ui/commands.js` | All 6 commands in a temp workspace: Compile File artifacts (css/map/d.ts), Build Project (both entries), Check Project (writes nothing), Preview (virtual doc, nothing written), Open Generated CSS / Class Map (target + language), broken document writes nothing, no-editor invocation | 26 |
| `ui/navigation.js` | Definition (local + cross-module), 3 references, `prepareRename`, 2 refusal paths, applied token rename, cross-module group rename (3 edits / 2 files), conflicting rename pin | 25 |
| `ui/quickfix.js` | `XESSA1002` quick fix: kind, title, `isPreferred`, edit shape, application, diagnostics clear afterwards | 15 |
| **Total** | | **320** |

Fixtures added (additive only — the existing `fixtures/broken.cssx` and `fixtures/complete.cssx`,
including their fixed `Position(2, 15)` offset, are untouched):
`ui/clean.cssx`, `ui/theme.cssx`, `ui/colors.cssx`, `ui/navigation-entry.cssx`,
`ui/navigation-theme.cssx`, `ui/navigation-groups.cssx`, `ui/broken-semicolon.cssx`,
`ui/broken-token.cssx`, `ui/broken-alias.cssx`, `ui/broken-syntax.cssx`, `ui/broken-setup.cssx`.

Determinism: no sleep is used as evidence. Every wait is `host.waitFor`/`waitForDiagnostics` bounded
polling on an observable (`getDiagnostics` non-empty, a file appearing, an editor becoming active);
the clean-document case watches the whole 1.2 s debounce window and fails if anything appears.
Every mutating case builds its own `mkdtemp` + `realpath` workspace and removes it in `finally`;
settings are restored in `finally`; rename/edit application happens only on temp copies or in-memory
documents, never on a committed fixture on disk.

## Run command (exact)

```
bun test tests/extension/host.test.ts
```

The orchestrator (`tests/extension/host.test.ts`, read-only) rebuilds the bundle, resolves the cached
VS Code build and calls `runTests({ extensionDevelopmentPath: packages/vscode,
extensionTestsPath: packages/vscode/test/suite.js, launchArgs: [test/fixtures, --disable-extensions,
--skip-welcome, --skip-release-notes, --user-data-dir=…, --extensions-dir=…] })` with a 300 s timeout.
Cache used: `node_modules/.vscode-test-xessa/vscode-darwin-arm64-1.147.0`, launcher
`…/Visual Studio Code.app/Contents/MacOS/Code`. No orchestrator change was needed.

## Results (measured)

Run 1:

```
[xessa host] baseline: activation, grammar, 6 commands, 1 diagnostic(s), completion 12 item(s), compile+preview, format/format-on-save (36 assertions, 1003 ms)
[xessa host] completions: 21 completion states driven (suggest widget) (98 assertions, 1258 ms)
[xessa host] hovers: 9 hover shapes + 2 negative positions (42 assertions, 161 ms)
[xessa host] diagnostics: 5 code families with exact spans + 1 clean document (36 assertions, 2101 ms)
[xessa host] colors: 6 swatches (named + hex + alpha) + 5 negatives + 2 presentations (42 assertions, 38 ms)
[xessa host] commands: 6 commands: compile/build/check/preview/open-css/open-map side effects (26 assertions, 525 ms)
[xessa host] navigation: definition/references/rename incl. cross-module group rename and 2 refusal paths (25 assertions, 356 ms)
[xessa host] quickfix: XESSA1002 quick fix: title, kind, isPreferred, diagnostic link, applied edit (15 assertions, 331 ms)
[xessa host] passed: 8 scenarios, 320 assertions [baseline=36, completions=98, hovers=42, diagnostics=36, colors=42, commands=26, navigation=25, quickfix=15]
(pass) extension host activates providers and commands [7880.82ms]
(pass) host test environment summary [0.03ms]
 2 pass / 0 fail   Ran 2 tests across 1 file. [7.93s]
```

Run 2 (immediately after): identical — `320 assertions`, `2 pass / 0 fail`, `Ran 2 tests across 1
file. [7.92s]`.

Gates:

| Command | Result |
|---|---|
| `bun test tests/extension/host.test.ts` | green ×2, 320 assertions, 2 pass / 0 fail |
| `bun run verify` | green — `1160 pass / 2 skip / 0 fail`, 995 042 `expect()` calls, 85 files, 39.75 s (typecheck + Biome + all tests, host suite included) |
| `bun test` (confirms `verify` still includes the host suite) | `(pass) extension host activates providers and commands [8268.99ms]`, 1160 pass / 2 skip / 0 fail |
| `bun run lint` | green — `biome check .`, 490 files, no fixes applied |
| `bunx biome check packages/vscode/test` | green — 10 files (9 modules + the runner) |

## Defects observed (pinned, not skipped)

| # | Defect | Evidence | Pin |
|---|---|---|---|
| 1 | **`$`-context import namespace loses the sigil.** Item `label`/`insertText` are `theme.` while the replacement range covers the typed `$`, so accepting it writes `color: theme.` — an invalid reference. | `intelligence.ts:2570-2578` (token branch, `label: \`${alias}.\``), range from `replaceStart = offset - word.length - 1`; reproduced in the host by applying the item | `completions.js` — "pinned: accepting the namespace yields `theme.` (CSSX-U1)" |
| 2 | **`&` starters double the ampersand.** After typing `&` the starters carry an empty range at the caret, so accepting `&:hover` yields `&&:hover`. The `(`/`#` states repair their typed character; `&` does not. | `intelligence.ts:2737-2746`; reproduced by applying the item | `completions.js` — "pinned: accepting &:hover doubles the ampersand (CSSX-U1)" |
| 3 | **Observation:** `vscode.prepareRename` returns the caret's *reference* range including the sigil (`$accent`, 10:9-10:16) and that text as the placeholder, not the declaration range the provider returns (`accent`, 6:2-6:8). | host measurement | `navigation.js` — "pinned: prepareRename prefills the caret token including the sigil" |
| 4 | **Observation:** a rename onto an existing token name is not refused; the duplicate is reported afterwards as `XESSA2001` ("duplicate definition"). | host measurement | `navigation.js` — "pinned: the applied conflicting rename is reported as XESSA2001 afterwards" |

Candidate task specs (to be written by the lead as `.ai/tasks/CSSX-U*.md`; the source is outside this
campaign's write set):

- **U1-A** — `$`-context namespace item must keep the sigil (`label: \`$${alias}.\`` or exclude the
  `$` from the range). Repro: `@use "./theme.cssx" as theme;` then type `$` in a value and accept the
  `theme.` item; expect `$theme.`, actual `theme.`. Acceptance: host assertion in `completions.js`
  flips from the pinned `theme.` to `$theme.`.
- **U1-B** — `&` starters must replace the typed `&` (or insert without duplicating). Repro: type `&`
  in a rule body and accept `&:hover`; expect `&:hover`, actual `&&:hover`. Acceptance: the pinned
  assertion in `completions.js` flips to a single ampersand.

## API limits recorded (not defects, not faked)

- `vscode.executeReferenceProvider(uri, position)` accepts **no** `ReferenceContext` (the command
  declares `[Uri, Position]`), so `includeDeclaration: false` is not drivable from the host; the
  declaration is always included. Asserted as `3` with and without the extra argument.
- `vscode.executeCodeActionProvider(...)` does not round-trip the action's `diagnostics` association
  (`fix.diagnostics` is `undefined`); the action's `edit` is what proves the association, asserted by
  applying it and watching the diagnostic clear.
- VS Code drops `filterText` from the returned item DTO when it equals the label (returned as `null`).
  The "default" contexts therefore assert "no override", while `(` (`(calc`) and `#` (`#f0f8ff`)
  assert the exact override the A50/A51 repairs rely on.
- `vscode.executeCodeActionProvider` returns code actions from **other** host extensions too: the run
  showed Copilot's `quickfix.copilot` and `quickfix.explain.copilot` next to the Xessa fix, so the
  module selects by exact kind (`quickfix`). `--disable-extensions` does not remove the built-in agent
  host extensions.
- Status bar text, output-channel lines and toast text remain unreadable via the API — unchanged from
  the U0 gap notes; they stay with U3/U4. `commands.js` asserts their observable proxies (artifacts,
  opened editors, nothing-written) instead.

## Deviations from the plan's §U1 file table

1. **Module names are plural/singular differently** from the table: `completions.js` (plan:
   `completion.js`), `hovers.js` (`hover.js`), `colors.js` (`color.js`), plus `diagnostics.js`,
   `commands.js`, `navigation.js`, `quickfix.js`, `baseline.js`, `host.js`. This task's brief specified
   the plural names; behaviour matches the plan's intent.
2. **`symbols.js`, `config.js` and `grammar.js` from the §U1 table are not written here.** They belong to
   the U1 helper scope but were outside this task's assigned module list. Rows 20 (outline), 8/11
   (config toggles beyond `formatOnSave`/`completePropertyWithSemicolon`) and 4 (host grammar
   tokenization) therefore still have no host assertion — carried into U2/U4, recorded here rather than
   silently claimed.
3. The plan's `applyCompletionItem` name is `applyCompletion` in `host.js`; `pollUntil` is `waitFor`.
4. Plan §U2 row 5 says `1r` narrows to "`rem` only"; measured behaviour is **`rem` + `rad`** (prefix
   filter over the 27 units). The plan sentence is over-precise; `completions.js` asserts the measured
   pair. Recorded for U2's report rather than editing the plan (this phase may only edit §U0).
5. Plan §U0/§U2 call the hex completion detail "`CSS color #hex`"; the real per-entry detail is
   `CSS color #rrggbb` — corrected in §U0 and asserted as such.

## Notes for the next phases

- U2 can build `checklist.js` on `host.js` directly; the 7 checklist rows are now mostly covered
  (colours, `#f0` narrowing, `(` functions, property semicolon toggle, units, `&:`/`&.`, swatches +
  presentations). The residue is the two pinned defects and the native-picker *interaction*.
- U4 should reuse `ui/commands.js` as the trusted-workspace column and add the Restricted-Mode and
  multi-root columns; `xessa.compileOnSave` and `xessa.previewSplitEditor` still need their flip cases.
- U5 can time the same `completionItems`/`hoversAt` helpers on a large fixture.
- The host run is not extension-free (Copilot agent extensions inject code actions and log noise);
  select contributions by exact kind/id rather than by position or by "only one item".

## Handoff

- Completed: runner + 9 modules, 11 additive fixtures, 320 host assertions green ×2, gates green.
- Touched: `packages/vscode/test/suite.js`, `packages/vscode/test/ui/{host,baseline,completions,hovers,diagnostics,colors,commands,navigation,quickfix}.js`, `packages/vscode/test/fixtures/ui/*.cssx`, `.ai/reports/CSSX-U0.md`, `.ai/reports/CSSX-U1.md`, `.ai/plans/CSSX-PLAN-UI.md` (§U0 tables only).
- Remaining: two candidate task specs (U1-A, U1-B), and U2's checklist module building on `host.js`.
