# CSSX-A51 — Hex colors, color-kind items, inline swatches and the A50 filterText follow-up

## Summary

- Color intellisense now matches the built-in CSS support. A color-accepting property lists the 148
  A49 named colors **and** a curated 35-entry hex palette, and every color item is kind `color`
  (adapter -> `vscode.CompletionItemKind.Color`), so the suggest widget renders swatches.
- `#` is a registered completion trigger with its own value state: `color: #|` lists the colors,
  `color: #f0|` narrows them (`#f0` -> `aliceblue`, `azure`, `honeydew`, `khaki`, `lightcoral`),
  accepting replaces the typed `#...` prefix (`color: #` + `red` -> `color: red`), and `#` outside a
  color-accepting property offers nothing.
- The existing `DocumentColorProvider` now serves **named** colors as well as hex ones through a new
  pure `colorsAt(text, analysis)` helper (`color: red`, `border-color: navy`, `--brand: teal`), and
  the native picker still writes lowercase `#rrggbb` (alpha only when it is not 1), so an authored
  named value is rewritten only when the author actively picks.
- A50 follow-ups fixed: `CompletionSuggestion.filterText` passthrough (`(clamp` for the paren state,
  `#red`/`#ff0000` for the `#` state) and the stale `providers/completion.ts` trigger comment.
- Verification: `bun test` **892 pass / 0 fail across 45 files** (886 baseline + 6 new),
  `bun test tests/extension/` 192/0 (186 baseline), `bun test tests/extension/provider.intelligence.test.ts`
  94/0 (88 baseline), `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files, no fixes applied).

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Color kind | `SuggestionKind` `"color"` (`intelligence.ts:37`), adapter case (`adapter.ts:76`) | named and hex items are kind `color`; `toCompletionKind` returns `CompletionItemKind.Color` | 🟢 complete |
| Named->hex knowledge | `CSS_NAMED_COLOR_HEX` (`intelligence.ts:512`, 148 frozen entries) | exactly the A49 name set, all `#rrggbb` lowercase | 🟢 complete |
| Hex palette | `CSS_HEX_COLORS` (`:689`, 35 frozen entries) | neutrals-first authored order, unique values | 🟢 complete |
| Hex items | `hexColorItems()` (`:768`), pushed for an empty value word (`:2710`) | `detail "CSS color #hex"`, `sortText 0-#hex`, no snippet, shared range | 🟢 complete |
| `#` state | `hashColorStart()` (`:790`), `hashColorItems()` (`:806`), branch (`:2687`) | colors only, per-item `replaceStart` at `#`, typed digits narrow both families, non-color property -> empty | 🟢 complete |
| Trigger | `"#"` in the registration (`controller.ts:129`) | 8 trigger characters | 🟢 complete |
| Decorations | `colorsAt()` (`intelligence.ts:3226`), `DocumentColor` (`:3195`), `acceptsNamedColor()` (`:3212`), provider (`providers/color.ts:27`) | named + hex entries with ranges/rgba; provider registered at `controller.ts:147` | 🟢 complete |
| Presentations | `provideColorPresentations` (`providers/color.ts:36`) | lowercase `#rrggbb`, alpha only when non-1, ranges replaced exactly | 🟢 complete |
| A50 follow-ups | `filterText` field (`intelligence.ts:84`), paren items (`:1190`), adapter passthrough (`providers/completion.ts:55`), header comment (`:6`) | paren/`#` items carry filter text; no ordinary item does; comment names `(`, `/`, `#` | 🟢 complete |
| Tests | 6 tests in `describe("hex colors, color kind, decorations and filter text (A51)")` (`tests/...:2624`) | before-probe showed 201 items / no hex / `#aliceblue`; tests pin the new behaviour | 🟢 complete |
| Records | task, this report, `P8 · A51` PROGRESS row 🟢, todo items 19 + 20 | persisted, lint-clean | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `SuggestionKind` gained `"color"` (`:37`); `CompletionSuggestion.filterText` (`:84`); `CSS_NAMED_COLOR_HEX` (`:512`, 148 frozen `name: "#rrggbb"` entries); `CSS_HEX_COLORS` (`:689`, 35 frozen hex strings); `namedColorItems`/`namedColorItem` now emit `kind: "color"` (`:744`); new `hexColorItems()` (`:768`), `hashColorStart()` (`:790`), `hashColorItems()` (`:806`), `namedColorRuns()` (`:828`), `acceptsNamedColor()` (`:3212`), exported `DocumentColor` + `colorsAt()` (`:3195` / `:3226`); `functionItems()` sets `filterText` in the paren state (`:1190`); the `value` case gained the `#` branch (`:2687`) and the hex palette for an empty word (`:2710`); `completionsAt` JSDoc trigger/state list (`:2474`). |
| `packages/vscode/src/adapter.ts` | `case "color":` -> `vscode.CompletionItemKind.Color` (`:76`). |
| `packages/vscode/src/controller.ts` | `"#"` appended to the completion trigger characters (`:129`). |
| `packages/vscode/src/providers/completion.ts` | `item.filterText = suggestion.filterText ?? suggestion.label` (`:55`); header comment now lists `@`, `$`, `.`, `:`, `/`, `&`, `(`, `#` (`:6`). |
| `packages/vscode/src/providers/color.ts` | `provideDocumentColors` maps the pure `colorsAt()` result (named + hex) into `ColorInformation`s (`:27`); `provideColorPresentations` behaviour unchanged, documented (`:36`). |
| `tests/extension/provider.intelligence.test.ts` | New `describe("hex colors, color kind, decorations and filter text (A51)")` at `:2624` with **6 tests**; one A49 assertion (`red.kind` `"value"` -> `"color"`) and one A50 count (201 -> 236 + a hex-family assertion) updated because the new spec changes those two contracts (see "Spec-mandated test updates"). `colorsAt` added to the import list. |
| `.ai/tasks/CSSX-A51.md`, `.ai/reports/CSSX-A51.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A51` row 🟢; feature item 19 (hex + color kind + picker) and bug item 20 (A50 filterText + stale comment). |

No compiler, parser, lexer, resolver, formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan or framework record was touched. No dependency change, no commit, push,
reset or stash.

## Diagnosis and design decisions

### 1. One frozen name->hex constant serves three features (`intelligence.ts:512`)

The `#` state has to answer "which named colors start with these hex digits", and the decoration
provider needs real channels for `color: red`. Both need one name->hex table, so it is authored once,
alphabetically (the A49 order) and frozen. Values are the CSS Color 4 definitions taken from the
`vscode-css-languageservice` color table bundled in the local VS Code installation
(`.../extensions/css-language-features/server/dist/node/cssServerMain.js`); the extracted name set is
**exactly** the A49 `CSS_NAMED_COLORS` set (148 names) and every value is 6-digit lowercase hex, so the
two constants cannot drift silently. `CSS_HEX_COLORS` (`:689`) is the separate curated
palette (35 entries: 8 neutrals, 5 reds, 4 oranges/ambers, 4 greens, 6 cyans/blues, 5 purples,
3 pinks) — a palette of *values*, not names, so the popup stays small.

### 2. Items are `color`, not `value` (`intelligence.ts:37`, `adapter.ts:76`)

`CompletionItemKind.Value` renders as a text glyph; the built-in CSS support renders colors as
swatches, which needs `CompletionItemKind.Color`. The pure layer therefore names the family explicitly
(`SuggestionKind` `"color"`) and the adapter owns the single `vscode` mapping, exactly like every other
kind. `detail` stays the discriminator: `"CSS color"` for a name, `"CSS color #e74c3c"` for a palette
entry (the hex repeats in the detail so a swatch-only rendering is still self-describing and so the
A49 "named colors only" filter in the tests keeps working).

### 3. The `#` state mirrors the A50 paren state (`intelligence.ts:790`, `:2687`)

`#` is not a word character, so `scanBackWord` already stops at it (`color: #f7` -> word `f7`).
`hashColorStart()` only asks whether the character directly behind the word is `#`, and the branch then
returns the color families *before* keyword values, units and functions are built:

- `replaceStart` per item = the `#` offset (the A48 mechanism the adapter already prefers over the
  result range), so accepting always replaces exactly `#...` and never duplicates it;
- nothing else is offered in that state (no `absolute`, no `rem`, no `clamp(`);
- the guard is `COLOR_PROPERTIES.has(property)` — the same A49-derived set — so `width: #`,
  `display: #`, `margin: #`, `opacity: #` and `background: #` return an empty list instead of the
  generic values that used to appear (`width: #` listed 53 items before A51).

**Narrowing rule (stated once):** the typed text is compared case-insensitively against the hex body
(with no `#`) of every candidate, so a palette entry matches when its digits start with the typed
digits (`#f0` -> no palette entry, `#e7` -> `#e74c3c`), and a named color matches when **its name**
starts with the typed text (`#re` -> `red`, `rebeccapurple`) **or when its hex** starts with the typed
digits (`#f0` -> `aliceblue` `#f0f8ff`, `azure`, `honeydew`, `khaki`, `lightcoral`). `#` alone matches
everything: 183 items (35 hex + 148 names).

### 4. Filter text: the editor narrows what the range covers (`intelligence.ts:84`, `providers/completion.ts:55`)

VS Code derives the text it narrows against from the item's replacement range, i.e. `(cl` in the paren
state and `#e7` in the `#` state, not the typed word (`cl`, `e7`). An item whose label is `clamp(` or
`red` can therefore be hidden although the pure layer offered it. The pure layer now carries the wider
text per item and the adapter passes it through (`suggestion.filterText ?? suggestion.label` for every
other item):

- paren state: `filterText = "(" + name` -> `(clamp` (A50 follow-up);
- `#` state, name matched by its own prefix: `#red`, `#rebeccapurple`;
- `#` state, name matched by its hex only: `#ff0000` — a per-match choice, because VS Code would hide
  `red` for the typed `#ff` if the item advertised `#red`;
- `#` state hex items and every ordinary item: no `filterText` (the label already is the filter input),
  which the tests assert explicitly.

### 5. Decorations: one pure helper, thin provider (`intelligence.ts:3226`, `providers/color.ts:27`)

`colorsAt(text, analysis)` returns `{ color: { red, green, blue, alpha }, range }[]`:

- **hex** reuses `analysis.colors` (the same occurrences `colorsOf` returns), so `#rgb`/`#rgba`/
  `#rrggbb`/`#rrggbbaa` count in *any* declaration value (`box-shadow: 0 0 4px #2563eb`) and the
  pre-existing `colorsOf` contract is untouched;
- **named** colors are scanned out of `declarationSegments()` only for color-accepting declarations
  (`COLOR_PROPERTIES` plus every `--custom-property`, which is a `<color>`-bearing context by
  definition) and only as whole identifier runs. The run test rejects `$red` (token), `#red` (hex),
  `--red`/`red-500` (identifier part) and `url(red.svg)` (file name), and quoted strings are skipped,
  so `content: "black"` never decorates;
- the provider maps the result with `toEditorRange`/`vscode.Color` and nothing else; picking a color
  runs the existing `provideColorPresentations`, whose `rgbaToHex` writes `#rrggbb` lowercase with alpha
  only when it is not 1. No implicit edit ever rewrites an authored named value.

**Deviation from the task text (recorded deliberately):** the task asked for a *new* `providers/colors.ts`.
The repository already ships `packages/vscode/src/providers/color.ts` (`XessaColorProvider`, registered
at `controller.ts:147` since A13) doing hex-only decorations. Adding a second provider
would register two `DocumentColorProvider`s for `xessa` documents, so the missing capability (named
colors) was added to the existing file instead of creating a duplicate. That file is therefore written
inside the write set's spirit (editor-only provider code) but outside its literal path list; no other
unowned file was touched.

## Spec-mandated test updates (no assertion weakened)

Two pre-existing assertions encoded behaviour this task deliberately changes; both were updated, and
each change is covered more strictly by the new A51 tests:

1. `A49 > every color-accepting property offers the standard named colors`: `expect(red.kind)
   .toBe("value")` -> `.toBe("color")` (criterion 1: named colors are `color` items).
2. `A50 > editing inside an existing call keeps the ordinary value behaviour`:
   `expect(colorItems.length).toBe(201)` -> `236` plus a new `expect(hex items).toBe(35)` (criterion 1:
   the hex palette joins the named colors; the 53-item ordinary list and the 148 named colors are still
   asserted on the same lines).

No test was deleted, skipped or loosened; the other 886 pre-existing tests run unchanged.

## Evidence

Probe `/tmp/probe-a51.ts` plus a shape probe ran every document through `contextAt`/`completionsAt`/
`colorsAt`. "Before" was recorded on the untouched tree, "After" on the final files.

| Probe | Before | After |
|---|---|---|
| `color: ` | `items=201 named=148 hex=0 kinds=[value]`, `red kind=value` | **`items=236 named=148 hex=35 kinds=[color,value]`**, `red kind=color`, `hex[0]=#000000 kind=color`, accept `red` -> `color: red` |
| `width: ` / `display: ` / `margin: ` / `opacity: ` / `font-weight: ` | 53 items, 0 colors | 53 items, 0 colors, no `color` kind (unchanged) |
| `color: #` | `items=201`, generic values first (`absolute,auto,block,...`), accept `aliceblue` -> **`color: #aliceblue`** (broken) | **`items=183`, kinds `{color:183}`**, first `#000000,#111827,#374151,#6b7280`, accept hex -> `color: #000000`, accept `red` -> **`color: red`** |
| `color: #f` | `items=7` (`flex,flex-end,flex-start,firebrick,...`), accept -> `color: #firebrick` | **`items=54`** (5 palette + 49 names), hex `#ffffff,#f97316,#f59e0b,#fbbf24,#f43f5e` |
| `color: #f0` | `items=0` | **`items=5`**: `aliceblue,azure,honeydew,khaki,lightcoral` (0 palette) |
| `color: #e7` | `items=0` | **`items=1`**: `#e74c3c`, accept -> `color: #e74c3c` |
| `color: #FF` (uppercase) | `items=0` | `items=32`, first `#ffffff,bisque,blanchedalmond,coral` (digits compared case-insensitively) |
| `color: #zz` | `items=0` | `items=0` (unchanged) |
| `width: #` | 53 generic items | **`items=0`** |
| `background: #`, `display: #`, `margin: #`, `opacity: #` | generic list | **`items=0`** |
| `.a { color: # }`, `.a { &:hover { color: # } }`, `@media` one-liner, nested `.b`, `@keyframes` frame, `fill: #` | generic list | `items=183`, kinds `{color:183}` |
| `.a { # }` (selector position) | 7 starter items | unchanged (7 selector items) |
| `@setup { prefix: "#" }` | `{kind:"none"}`, 0 items | unchanged |
| `colorsAt` on `color: Red; background: #fff teal; border-color: navy; --brand: #2563eb seagreen; content: "black"; font-family: -apple-system; box-shadow: 0 0 4px #2563eb; color: $red; outline-color: url(red.svg)` | helper absent | **6 entries**: `#fff` (1,1,1,1), `#2563eb` x2 (37/255,99/255,235/255,1), `Red` (1,0,0,1), `navy` (0,0,128/255,1), `seagreen` (46/255,139/255,87/255,1); no `teal` (shorthand), no `black` (string), no `$red`, no `url(red.svg)` |
| `#2563eb80` alpha | — | `alpha ≈ 0.502` |
| `width: (cl` filter text | `filterText` absent | **`(clamp`** |
| `color: #re` names | — | `red` -> `#red`, `rebeccapurple` -> `#rebeccapurple` |
| `color: #ff` name matched by hex | — | `red` -> `#ff0000`; `#ffffff` has no `filterText` |
| `background-color: re` (A49) | `relative,revert,rebeccapurple,red,repeating-linear-gradient(` | identical; no hex item (typed word is name text) |
| `margin: 1` units (A48) | 27 | 27 |
| `width: (` functions (A50) | 25 | 25 |
| registered triggers | `"@" "$" "." ":" "/" "&" "("` | `"@" "$" "." ":" "/" "&" "(" "#"` |
| color provider registration | `registerColorProvider` + `XessaColorProvider` (hex only) | same registration, now named + hex through `colorsAt` |

Probe excerpts (after):

```text
=== 1. plain value state ===
color:  items=236 named=148 hex=35 kinds=[color,value]
  named[0]=aliceblue kind=color detail=CSS color
  hex[0]=#000000 kind=color
width:  items=53 named=0 hex=0 kinds=[value]

=== 2. hash state ===
color: # ctx={"kind":"value","property":"color","word":""} items=183 named=148 hex=35 kinds=[color]
  red kind=color detail=CSS color replaceStart=14 filterText=#red
  accept named aliceblue -> { color: aliceblue }
color: #f0 items=5 named=5 hex=0 kinds=[color] first=[aliceblue,azure,honeydew,khaki,lightcoral]
color: #e7 items=1 named=0 hex=1 kinds=[color] first=[#e74c3c]
width: # items=0 named=0 hex=0 kinds=[]

=== 3. colorsAt ===
count=6  "#fff"  "#2563eb"  "#2563eb"  "Red"  "navy"  "seagreen"

=== 4. filterText ===
  paren items=1 filterText=(clamp
  hash items=1 filterText=          (hex item: label is the filter text)

=== 5. triggers ===
 "@", "$", ".", ":", "/", "&", "(", "#",

=== 6. A49/A50 regression probes ===
  background-color: re labels=relative,revert,rebeccapurple,red,repeating-linear-gradient(
  margin: 1 items=27
  width: ( items=25
```

## Tests added (`tests/extension/provider.intelligence.test.ts`, A51 describe block)

| Test | Pins |
|---|---|
| `a color property offers named colors and the curated hex palette` | 11 color properties x (148 named + 35 hex + 183 `color` items), palette order, `#e74c3c` shape (`detail "CSS color #e74c3c"`, `sortText 0-#e74c3c`, no snippet, shared range) and accept; A49 named shape kept (`0-red`), keyword/function families in place (`0-auto`, `1-calc`); word filtering (`color: re` -> `rebeccapurple`, `red`, no hex); 5 non-color properties offer no `color` item at all |
| `a typed # lists the colors and replaces the typed prefix` | `color: #` -> 183 `color` items with `replaceStart` at `#`, accept hex -> `color: #e74c3c`, accept `red` -> `color: red` (no `#red`); narrowing matrix `#f`, `#f0`, `#e7` incl. the by-name/by-hex rule and the absent `blue`/`olive`; accepting after `#e7`/`#re` replaces the typed prefix; `#` offers nothing for `width`, `display`, `margin`, `opacity`, `background`; one-line rule and space-less colon still list 183 |
| `colorsAt finds named and hex colors in declaration values` | exact entry list and channels (hex property-agnostic incl. `box-shadow` and a custom property, named only in color-accepting declarations), authored line/character offsets, shorthand `background` named value excluded, string/`$token`/`url(red.svg)`/`-apple-system` excluded, 8-digit alpha channel |
| `items that replace a prefix carry filterText for the editor` | paren state `(clamp`; `#re` -> `#red`/`#rebeccapurple`; `#ff` -> `red` filtered as `#ff0000`; hex item has none; ordinary items have none |
| `picking a color writes lowercase hex back` | `#ff0000`, `#E74C3C` -> `#e74c3c`, alpha only when non-opaque (`#ffffff80`), opaque -> 6 digits |
| `the color provider, kind and trigger are wired in the extension` | `registerColorProvider` + `XessaColorProvider` registered, 8 trigger characters incl. `#`, adapter `case "color"` -> `CompletionItemKind.Color`, provider uses `colorsAt`/`rgbaToHex`/`provideColorPresentations`, adapter passthrough line, header comment lists `(` and `#` |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 94 pass / 0 fail, 3596 `expect()` calls, 1 file (was 88; +6) |
| `bun test tests/extension/` | 🟢 192 pass / 0 fail, 4333 `expect()` calls, 10 files (was 186) |
| `bun test` | 🟢 892 pass / 0 fail, 792954 `expect()` calls, 45 files (was 886) |
| `bun run typecheck` | 🟢 exit 0 — compiler, cli, language-service, vscode projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, `No fixes applied.` |

Intermediate results, reported honestly:

- The first test run after the source change showed **2 failures**, both pre-existing assertions whose
  contract this task changes (`red.kind` `"value"`; `colorItems.length` 201). Both were updated as
  described in "Spec-mandated test updates"; no other pre-existing test needed a change.
- Of the 6 new tests, one first failed on my own expectation: `#f` was assumed *not* to match
  `aliceblue`, but its hex `#f0f8ff` starts with `f`, so it correctly matches. The assertion was
  corrected to check the rule (and `blue`/`olive` as the negative cases), not a wrong assumption.
- The first `bun run lint` after the edits failed with **2 formatter errors** (`hexColorItems` wrapping
  in `intelligence.ts`, three long literals in the new test). `biome check --write` on those two files
  fixed exactly those; the final `biome check .` is clean with no fixes applied and the intelligence
  suite was re-run afterwards (94/0).

## Notes and limitations

- **Extension-host coverage.** `tests/extension/host.test.ts` does run a real VS Code
  (`@vscode/test-electron`, cached build present) but the code that executes *inside* the host lives in
  `packages/vscode/test/suite.js`, which is outside this task's write set. The color items, `filterText`
  and `colorsAt` are therefore unit-tested at the pure layer, and the adapter/provider wiring is
  asserted from source and verified by `bun run typecheck` only; no editor-side run of the suggest
  widget or the color picker was performed. A host smoke (`executeCompletionItemProvider` after typing
  `#`, `executeDocumentColorProvider`) is the natural next step in `packages/vscode/test/suite.js` once
  that file is in scope.
- **Shorthands stay out.** Because the guard is A49's derived `COLOR_PROPERTIES`, `background`,
  `border`, `outline` and `box-shadow` do not offer the `#` list and their named values are not
  decorated (`background: #fff teal` decorates `#fff` only). That is the deliberate A49 scope decision,
  applied consistently to both features.
- Named colors are decorated inside functions of a color property
  (`color-mix(in srgb, red 20%, blue)`) and in `--custom-property` values, but not in
  `@property --x { initial-value: red }`, because `forEachDeclaration` does not expose the enclosing
  at-rule's `syntax`.
- The palette is a curated 35-value set, not a hex database: `#e74c3c`-style tones are offered, while an
  arbitrary authored hex simply stays authored text (and still gets a decoration).
- `filterText` for the `#` state is chosen per match (name-prefix matches advertise `#name`,
  hex-prefix matches advertise `#hex`) so VS Code's narrowing never contradicts the pure filter.

## Blockers

None.

## Handoff

- Completed: `color` suggestion kind (named + 35-entry hex palette, adapter ->
  `CompletionItemKind.Color`); `#` trigger and `#` value state with per-item prefix replacement,
  hex/name narrowing and the non-color guard; frozen 148-entry `CSS_NAMED_COLOR_HEX` shared by
  completion and decorations; pure `colorsAt()` behind the existing `XessaColorProvider` (named + hex
  swatches, hex write-back on pick); A50 follow-ups (`filterText` passthrough for the paren and `#`
  states, stale trigger comment fixed); 6 new intelligence tests; `P8 · A51` PROGRESS row 🟢 and todo
  items 19/20.
- Verification: `bun test` 892 pass / 0 fail across 45 files, extension suite 192/192, intelligence
  suite 94/94, `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files, no fixes applied).
- Remaining steps: none for A51. Natural follow-ups, not started and not scoped: an extension-host
  smoke for the suggest-widget filter and the color picker in `packages/vscode/test/suite.js`; named
  colors for shorthand properties if the owner accepts the popup noise; `@property` `initial-value`
  decorations once an enclosing-at-rule helper exists.
