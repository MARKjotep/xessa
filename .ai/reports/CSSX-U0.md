# CSSX-U0 — UI surface inventory (re-verification)

**Phase:** U0 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 inventory verified (phase status left 🔴 in the plan; build owns flips)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree (TT0–TT8 closed)
**Write set used:** `.ai/plans/CSSX-PLAN-UI.md` §U0 tables, this report. Read-only: `packages/vscode/package.json`, `packages/vscode/src/**`, `packages/vscode/test/suite.js`, `tests/extension/host.test.ts`.

## Summary

- Every row of the plan's draft inventory was checked against `packages/vscode/package.json` and
  `packages/vscode/src/**`; **11 rows carried wrong line numbers** and were corrected in the plan with
  file:line evidence (table below). All 24 contributed elements exist exactly as described; nothing the
  extension contributes was missing from the draft and no row was invented.
- The draft's "no keybindings / no menus" claim is **confirmed**: the manifest's `contributes` object
  holds only `languages`, `grammars`, `commands` and `configuration`
  (`packages/vscode/package.json:33-90`) — there is no `keybindings`, `menus` or `iconThemes` section.
- The draft's counts were **re-derived, not copied**: 148 named colours (`intelligence.ts:351`, name→hex
  map at `:512`), 35 hex (`:689`), 27 units (`:876`), 25 functions (`:1018`), 19 pseudos (`:938`),
  12 `@setup` keys, 236 items on `color: ` (148 named + 35 hex + 28 keywords + 25 functions) and 53 on
  `width: ` (28 keywords + 25 functions). Three draft statements were wrong and are corrected in the
  plan: the `#` palette detail string, the `width: ` item composition, and the outline kind list.
- Two **new UI defects** were found while re-verifying (both are host-observable only, pinned in the U1
  suite, source untouched — the plan forbids edits): the `$`-context import-namespace item drops the
  `$` sigil, and the `&` selector starters carry an empty replacement range so accepting one doubles
  the ampersand. Both are listed under *Defects* with candidate task specs.
- The "host assertion today" column was rewritten to name the module that now covers each element
  (U1 landed in the same task, so the draft's "none" cells for rows 5, 9, 10, 14, 15, 16, 17, 18, 19, 21
  and 22 are no longer true).

## Corrections applied to `.ai/plans/CSSX-PLAN-UI.md` §U0

| # | Row | Draft | Verified | Evidence |
|---|---|---|---|---|
| 1 | 8 · `xessa.compileOnSave` read site | `controller.ts:246-253` | `controller.ts:247-250` | `configuration.get<boolean>("compileOnSave", false)` at 247, early return 248, trust check 249-252 |
| 2 | 9 · `xessa.editor.formatOnSave` read site | `controller.ts:230-241` | `controller.ts:228-232` | getter 228-230, `if (!enabled) return;` 231, focus-out guard 232; 233-236 is `waitUntil` |
| 3 | 10 · `completePropertyWithSemicolon` read site | `providers/completion.ts:35-37` | `providers/completion.ts:32-34` | `getConfiguration("xessa", document.uri).get<boolean>("editor.completePropertyWithSemicolon", true)`; 35-40 is the `completionsAt` call |
| 4 | 11 · `previewSplitEditor` read site | `controller.ts:414-418` | `controller.ts:413-415` | `getConfiguration("xessa", document.uri).get<boolean>("previewSplitEditor", true)` |
| 5 | 12 · status bar item | `controller.ts:100-102` | `controller.ts:101-103` | `createStatusBarItem(Right, 100)` 101, `name = "Xessa"` 102, `command = COMMANDS.buildProject` 103 |
| 6 | 12 · status text mapping | `controller.ts:565-582` | `controller.ts:565-581` | `setStatus` switch: success 567-569, error 570-572, stale 573-575, idle 576-579 |
| 7 | 14 · preview provider | `controller.ts:66-92` | `controller.ts:61-92` | class declaration 61, `provideTextDocumentContent` 68, `set` 73; `previewCss` is 397-422 (draft 396-427) |
| 8 | 15 · severity map | `adapter.ts:50-60` | `adapter.ts:43-54` | `toEditorDiagnostic` 43-54; severity ternary 47-49; `code` 51; `source = "xessa"` 52 |
| 9 | 19 · colour helpers | `intelligence.ts:3195,3226` | `intelligence.ts:3180` (`rgbaToHex`), `:3226` (`colorsAt`) | `colorsOf` is 3190; `documentSymbols` 3253 |
| 10 | 20 · outline kinds | `Namespace/Module/Variable/EnumMember/Interface/Class/Property` | the same **plus `Object` as the fallback** | `providers/symbols.ts:30-32` — native at-rule blocks (`@keyframes`) report `kind: "native"` and map to `Object` |
| 11 | 22 · formatting registration | `controller.ts:155-158` | `controller.ts:155-157` | `registerDocumentFormattingEditProvider` |
| 12 | 23 · Restricted Mode sites | `249-253, 347-351, 386-390, 454-458` | `249-252, 347-350, 387-390, 455-458` | compile-on-save log 250; trust throw 348-350; compile warning 387-390; build warning 455-458 |
| 13 | 24 · notification sites | 14 line numbers | **all 14 confirmed** | `263, 271, 387, 402, 428, 434, 449, 455, 479, 499, 505, 513, 531, 544` |
| 14 | §U0 suggest table · `#` row | "`CSS color` / `CSS color #hex`" | **`CSS color`** for named, **`CSS color #rrggbb`** per hex entry | `hashColorItems`/`hexColorItems` in `intelligence.ts:770,811`; measured in host (35 distinct details on `color: `) |
| 15 | §U0 suggest table · value-word row | "keywords + property values … 236 total" | 236 = **148 named + 35 hex + 28 keywords + 25 functions**; `width: ` = **53** (28 keywords + 25 functions) | measured through `executeCompletionItemProvider` (U1 `completions.js`) |
| 16 | §U0 suggest table · `&` row | "typed `:`/`.` kept in the repair range" | only the **pseudo** state repairs the typed colon; the `&` starters replace an **empty range at the caret** (accepting `&:hover` after `&` yields `&&:hover`) | `intelligence.ts:2737-2746` (`selector` case: `replaceStart = offset - word.length`, `word === ""` after `&`); pinned in `completions.js` |

Rows 1-7, 16 and 18 of the contributed-surface table needed no correction (`package.json:34-44`,
`40-41`, `43`, `46-51`, `53-63`, `68-72`, `73-77`, `78-82`, `83-87`, `controller.ts:44-51`, `:53`,
`:100`, `:119-130`, `:583-585`, `quickfixes.ts:27`, `intelligence.ts:2470-2482`, `:2926` all verified
verbatim). `media/file-icon.svg` and `media/file-icon-dark.svg` exist.

## What `packages/vscode/test/suite.js` asserted before U1 (verified, not assumed)

31 assertion call sites (36 executions, because the six-command loop runs its `ok` six times):
activation + `isActive`; grammar `scopeName`/`language`; the `xessa` language contribution; the
`xessa.editor.formatOnSave` default; the six command ids; `document.languageId === "xessa"`; non-empty
diagnostics + a `XESSA` prefix + ≥1 `Error`; one completion label (`@2xl`); `isTrusted`; Compile File
writing CSS + class map; Preview's `xessa-preview:` scheme + compiled text; Format Document's provider
edits + their application; format-on-save off/on/parse-error. This matches the plan's §U0 opening
paragraph exactly; nothing else was asserted.

## Re-derived counts (source of truth, measured)

| Quantity | Value | Source |
|---|---|---|
| Named colours | 148 | `intelligence.ts:351` (array), `:512` (name→hex map) |
| Curated hex colours | 35 | `intelligence.ts:689` |
| Units | 27 | `intelligence.ts:876` |
| CSS functions | 25 | `intelligence.ts:1018` |
| Pseudo selectors | 19 | `intelligence.ts:938` |
| `@setup` keys | 12 | `SETUP_KEYS`, `analysis.ts`; measured via completion |
| Offline trigger characters | 8 | `controller.ts:122-129` |
| Colour items on `color: ` | 183 | host measurement (`completions.js`) |
| Items on `color: ` | 236 | host measurement |
| Items on `width: ` | 53 | host measurement |
| Outline symbol kinds | 9 | `providers/symbols.ts:11-33` |
| `Commands` declared | 6 | `package.json:53-63`, `controller.ts:44-51` |
| `Settings` declared | 4 | `package.json:68-87` |

## Defects found during re-verification

Both are host-only (the pure suites cannot see them) and are **pinned** in the U1 suite with a
`CSSX-U1` marker; the extension source is outside this campaign's write set, so each needs a task.

1. **`$`-context import namespace drops the sigil.** `completionsAt` token branch emits
   `label: \`${alias}.\`` / `insertText: \`${alias}.\`` while the replacement range covers the typed
   `$` (`intelligence.ts:2570-2578`), so accepting the item in a real editor writes `color: theme.`
   instead of `color: $theme.`. Candidate task: `CSSX-U1` item — label/insertText must be
   `$theme.` or the range must exclude the sigil.
2. **`&` starters double the ampersand.** The `selector` branch computes
   `replaceStart = offset - context.word.length`, and `&` is not a word character, so the range is
   empty at the caret; accepting `&:hover` after typing `&` yields `&&:hover` (same class of bug the
   `(`/`#` states fixed in A50/A51). Candidate task.
3. **Observation (not necessarily a defect):** `vscode.prepareRename` reports the caret's *reference*
   range with the sigil (`$accent`, 10:9-10:16) rather than the declaration range the provider returns
   (`accent`, 6:2-6:8), so the rename box is prefilled with `$accent`. Pinned in `navigation.js`.
4. **Observation:** renaming a token onto an existing name is **not refused** by the provider; the
   duplicate is reported afterwards as `XESSA2001` ("duplicate definition"). Pinned in `navigation.js`.

## Unverified / out of scope here

- Status bar text, output-channel lines, toast texts and the rendered widget/AX tree are not readable
  through the `vscode` API; they stay with U3 (CDP) and U4, as the draft states.
- The file icons' visibility in light/dark themes is a screenshot question (U6/U3).
- Grammar scope *assignment* remains proven outside the host (`tests/extension/grammar.scopes.test.ts`);
  the plan's `test/ui/grammar.js` idea was not part of this task's module list (see `CSSX-U1.md`
  deviations).

## Commands run

| Command | Outcome |
|---|---|
| `grep -n` / `cat -n` over `packages/vscode/package.json`, `src/{controller,adapter,project,service}.ts`, `src/providers/*.ts`, `src/intelligence.ts` | the line-number evidence above |
| `bun /tmp/xessa-probe/*.ts` (throwaway pure-layer probes, not committed) | counts, spans, hover markdown, colour ranges, rename plans quoted in this report |
| `bun test tests/extension/host.test.ts` | green ×2, 320 assertions — the measurements marked "host measurement" come from this run |
