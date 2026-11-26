# CSSX-U2 — The 7-item release checklist, automated

**Phase:** U2 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete (phase row left 🔴 in the plan;
build owns the flip) · **Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree

## Summary

- `.ai/HANDOVER.md`'s manual smoke checklist ("worth doing in the editor once") is now
  `packages/vscode/test/ui/checklist.js`: **all 7 rows driven end-to-end in the real host**, 96 assertions,
  one more scenario in `packages/vscode/test/suite.js` (8 → 9 scenarios, 320 → **416 assertions**).
- Every row is **automated**; there is no manual-with-reason row left except the *native colour-picker
  click*, which no API can perform (the picker's whole write path is asserted instead).
- Row 6 keeps the U1-pinned `&` defect **visible**: accepting `&:hover` after a lone `&` writes
  `&&:hover`. The assertion states the measured behaviour, so the checklist cannot go green while the
  bug exists; flipping the expectation is the fix's acceptance criterion.
- Two HANDOVER statements are over-precise and recorded as measured: `1r` narrows to **`rad` + `rem`**
  (not `rem` only), and `color: #f0` matches **named** colours by their hex (no literal hex label).
- Host suite green twice back-to-back with identical output (416 assertions); `bun run verify` and
  `bun run lint` green.

## Changed paths

| Path | Change |
|---|---|
| `packages/vscode/test/ui/checklist.js` | **new** — the 7 rows, `run(t)` scenario, 96 assertions |
| `packages/vscode/test/suite.js` | one line — `"checklist"` appended to `SCENARIOS` |
| `.ai/reports/CSSX-U2.md` | this report |

No source, manifest, fixture or orchestrator file was touched (`packages/vscode/src/**`,
`packages/vscode/package.json`, `tests/extension/**`, `tests/fixtures/**` untouched). No new fixture was
needed: the module writes its documents into its own `mkdtemp` workspace (realpath-resolved) and reads
the committed `test/fixtures/ui/colors.cssx` for row 7.

## Row → disposition (measured, not planned)

| # | HANDOVER row | Disposition | Assertions | Evidence |
|---|---|---|---|---|
| 1 | `color: ` → 148 names + 35 hex, kind Color; `width: ` → neither | automated | 11 | 183 `kind === Color` items; 148 `detail === "CSS color"`, 35 `detail === "CSS color #rrggbb"`; 236 items total (A51's measured 148+35+28+25); `width: ` → 53 items, **0** Color, **0** `#`-prefixed labels; `red` and `#2563eb` addressable |
| 2 | `color: #f0` narrows; accept replaces `#…` without duplication; `width: #` → nothing | automated | 16 | 5 entries, all named colours whose hex begins `f0` (`aliceblue`…`lightcoral`); every `filterText` starts `#f0`; range starts on the typed `#`; accept replaces `#f0` with one value, leaves no `#` behind. `width: #` contributes **zero** Xessa items (see *API/behaviour observations* for the 81 non-contributions) |
| 3 | `width: (` → 25 functions; accept `clamp(` → `width: clamp(`; `calc(100% - 2` keeps normal values | automated | 13 | 25 items, all `Value` + `detail === "CSS function"`, labels end with `(`, `filterText === "(" + name`; `clamp(` range covers the typed `(`; accept → `width: clamp(` with exactly one paren; inside `calc(100% - 2` → **27 `CSS unit` items**, zero function items, all ranges append at the caret |
| 4 | Property accept → `color: ;` cursor before `;` (setting toggle) | automated | 15 | snippet body `color: $0;`; acceptance reproduced with `TextEditor.insertSnippet(item range, item snippet)` → line becomes `  color: ;` and the caret sits at column 9, i.e. **before the `;`**; setting off → plain `color: `, no snippet, no semicolon |
| 5 | `margin: 1` → units; `1r` → `rem`; digits never deleted | automated (discrepancy recorded) | 11 | 27 units, every range starts **after** the digit; accept `rem` → `margin: 1rem`, no `remrem`; `1r` → **`rad` + `rem`** (HANDOVER says `rem` only — prefix filter over all 27 units, U1 already noted it); accepting `rem` over `1r` keeps the digit and replaces the `r` |
| 6 | `&:` + accept → `&:hover`; `&.` + accept keeps the dot; property completion above an `&` line | automated **+ pinned defect** | 15 | 19 pseudo items, `:hover` range covers the typed colon, accept → `&:hover` (never `&::hover`); `.card` range starts **after** the typed dot, accept → `&.card`; property list above `&` non-empty, accept edits the property line and leaves `&:hover { … }` intact. **Pin:** a lone `&` gets an empty caret range, accept → `&&:hover` (measured, CSSX-U1 defect U1-B) |
| 7 | Named/hex values show clickable swatches; picker writes lowercase hex | automated (picker *click* manual) | 14 | 6 swatches with exact ranges (`Red`, `#fff`, `navy`, `#2563eb80` α≈0.502, `--brand`, `#000`); `#ff0000` presentation, lowercase, `textEdit.newText === "#ff0000"` over exactly the authored range; alpha survives as `#2563eb80` |

Row 4 needed a new measurement rather than an assumption: `editor.action.insertSnippet` is a **no-op**
in this API-driven host, so the cursor position is observed through `TextEditor.insertSnippet`, which
runs the real snippet machinery over the item's own range. That makes row 4 fully automated — nothing
about the cursor is inferred.

Manual residue (the only one): **clicking a swatch to open the native picker**. No `vscode` API opens
it; `executeColorPresentationProvider` is the drivable half and is asserted. PP3's manual list reduces
to exactly this item (plus the two defect checks that flip with their fixes).

## Run results

Suite is `bun test tests/extension/host.test.ts` (the orchestrator rebuilds the bundle and launches the
cached VS Code 1.147.0 host; no orchestrator change was needed).

```
[xessa host]   checklist 1: `color: ` 148 names + 35 hex (Color), `width: ` neither — 11 assertions
[xessa host]   checklist 2: `color: #f0` narrows and replaces `#…`, `width: #` empty — 16 assertions
[xessa host]   checklist 3: `width: (` 25 functions, `clamp(` accept, `calc(` keeps values — 13 assertions
[xessa host]   checklist 4: property accept parks the caret before `;` (setting toggle) — 15 assertions
[xessa host]   checklist 5: `margin: 1` units, `1r` narrows, digits never deleted — 11 assertions
[xessa host]   checklist 6: `&:` accept, `&.` keeps the dot, property above `&` (+ pin) — 15 assertions
[xessa host]   checklist 7: named/hex swatches and the lowercase-hex picker write — 14 assertions
[xessa host] checklist: 7/7 HANDOVER rows automated (1:11, 2:16, 3:13, 4:15, 5:11, 6:15, 7:14) (96 assertions, 757 ms)
[xessa host] passed: 9 scenarios, 416 assertions [baseline=36, completions=98, hovers=42, diagnostics=36, colors=42, commands=26, navigation=25, quickfix=15, checklist=96]
(pass) extension host activates providers and commands [8547.13ms]
(pass) host test environment summary [0.03ms]
Ran 2 tests across 1 file. [8.61s]
```

Run 2, immediately after: identical — checklist `1:11, 2:16, 3:13, 4:15, 5:11, 6:15, 7:14`, 96
assertions, `passed: 9 scenarios, 416 assertions`, `(pass) … [8526.59ms]`, `Ran 2 tests across 1 file.
[8.58s]`.

Gates:

| Command | Result |
|---|---|
| `bun test tests/extension/host.test.ts` ×2 | green, 416 assertions, `2 pass / 0 fail`, identical output |
| `bun run lint` | green — `biome check .`, **493 files**, no fixes applied |
| `bun run verify` | green — `1160 pass / 2 skip / 0 fail`, 995 045 `expect()` calls, 85 files, 39.59 s (typecheck + Biome + `bun test` incl. the host suite) |
| `bunx biome check packages/vscode/test` | green — 13 files (11 host modules + runner + `cdp.js`/`capture.js` counted once each) |

The 2 skips are the pre-existing TT7 soak gates (`XESSA_SOAK=1`), unrelated to this phase.

## Measured behaviour that contradicts the HANDOVER wording (recorded, plan untouched here)

| HANDOVER says | Measured | Where |
|---|---|---|
| `1r` → `rem` | `rad` **and** `rem` (prefix filter over 27 units) | row 5 |
| `color: #f0` narrows to hex entries | 5 **named** colours matched by hex body (`aliceblue`, `azure`, `honeydew`, `khaki`, `lightcoral`); the curated 35-entry hex palette has no `#f0f8ff` | row 2 |
| "`&:` + accept → `&:hover`" (implies the `&` starters are fine) | true for `&:`; a **lone `&`** still doubles (`&&:hover`) — the A46 repair only covers the colon path | row 6 |

## API / host limits recorded (never faked)

- `editor.action.insertSnippet` does nothing in this API-driven host (no focused text editor claim);
  `TextEditor.insertSnippet(snippet, range)` is the drivable equivalent and is what row 4 uses.
- `executeCompletionItemProvider` **merges VS Code's own word-based suggestions** when a provider
  returns nothing: `width: #` yields 81 items with `kind === Text` (`CompletionItemKind.Text`, `detail`
  undefined) and no Xessa contribution. Assertions therefore filter on `detail`/kind/label instead of
  asserting a list length of 0. Any future "provider returned nothing" test needs the same filter.
- `vscode.prepareRename` / code-action `diagnostics` / `filterText` limits from U1 still apply and are
  not re-probed here.
- No API opens the native colour picker; `provideColorPresentations` is drivable (row 7).

## Defects pinned here (candidate tasks, source out of this campaign's write set)

| # | Defect | Assertion | Fix acceptance |
|---|---|---|---|
| U1-B (kept) | `&` starters replace an **empty range at the caret**, so accepting `&:hover` after a lone `&` yields `&&:hover` | `checklist.js` row 6, `"pinned: accepting \`&:hover\` after a lone \`&\` doubles the ampersand (CSSX-U1)"` | the range covers the typed `&` (or the insert omits it) and the pin flips to `\n  &:hover\n` |
| U1-A (carried) | `$`-context import namespace drops the sigil (`theme.` while the range covers the `$`) | `ui/completions.js` (U1 pin); not repeated in the checklist because no HANDOVER row covers it | the item keeps `$`; U1's pin flips |

## Notes for the next phases

- `checklist.js` is self-contained (own temp workspace, settings restored in `finally`, editors closed by
  the workspace removal) and runs last, so it cannot perturb earlier scenarios.
- Row 6's pin is the release-checklist tripwire for U1-B; U4's settings matrix can reuse row 4's
  `insertSnippet` technique for its "snippet ↔ plain" cell.
- The native picker click stays on PP3's manual list; the lead applies that reduction (this phase does
  not edit the production plan).

## Handoff

- Completed: `ui/checklist.js` (7/7 rows, 96 assertions), `suite.js` scenario registration, green
  suite ×2 (416 assertions) and both gates.
- Touched: `packages/vscode/test/ui/checklist.js`, `packages/vscode/test/suite.js`,
  `.ai/reports/CSSX-U2.md`.
- Remaining: the lead writes `.ai/tasks/CSSX-U1-B.md` (and U1-A) from the defect table above; PP3's
  checklist reduces to the single manual row recorded here.
