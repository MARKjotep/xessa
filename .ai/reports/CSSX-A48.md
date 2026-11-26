# CSSX-A48 — CSS-native property semicolon and unit completions

## Summary

- Accepting a CSS property completion now inserts `property: ;` and parks the cursor between the
  colon and the semicolon (`color` → `color: ;`, caret before `;`), matching the built-in CSS
  language server. It is gated by a new setting `xessa.editor.completePropertyWithSemicolon`
  (default **on**); with it off the previous plain `color: ` insert is returned unchanged.
- Typing a number in a declaration value now suggests CSS units and appends them after the digits:
  `margin: 1|` → accepting `rem` gives `1rem`, `1r` filters the list down to `rem`/`rad`, `.5|` and
  `0.5|` behave the same, and the typed digits are never replaced or deleted.
- Both behaviours are editor-only and stay in the pure layer (`CompletionSuggestion.snippet`,
  `CompletionSuggestion.replaceStart`, `CSS_UNITS`, `unitItems()`); the adapter only translates the
  snippet to a `vscode.SnippetString` and the per-item start to a `Range`. No compiler, parser,
  formatter, fixture, golden, grammar, ADR or specification file was touched.
- Verification: `bun test` **877 pass / 0 fail across 45 files** (871 baseline + 6 new),
  `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files); extension suite 177/177,
  intelligence suite 79/79.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Snippet insert form | `CompletionSuggestion.snippet` (`:64`) plus adapter precedence in `providers/completion.ts` (`:45`–`:49`) | `item.insertText` is a `SnippetString` when `snippet` is set, `insertText` otherwise | 🟢 complete |
| Property `;` insert | `case "property"` (`:2054`) carries `${property}: $0;` (`:2070`) on the shared replace range; `insertText` stays `${property}: ` | accepting `color` / `col`→`color` yields `color: ;` with the caret before `;` | 🟢 complete |
| Setting gate | `xessa.editor.completePropertyWithSemicolon` (`packages/vscode/package.json:78`), read in `provideCompletionItems` (`providers/completion.ts:31`–`:33`), consumed as `IntelligenceOptions.completePropertyWithSemicolon` (`intelligence.ts:158`) | option `false` → no snippet, `color: ` insert; absent → on (setting default) | 🟢 complete |
| Units data | `CssUnit` (`:324`) + `CSS_UNITS` (`:337`), 27 units with one-sentence descriptions | all 27 required units present, each with a description | 🟢 complete |
| Units wiring | `unitItems()` (`:376`) called from `case "value"` (`:2092`–`:2093`) | number prefix only, suffix filter, own replace start, `0~` sort key | 🟢 complete |
| Tests | 6 tests in `describe("semicolon and unit completions (A48)")` (`tests/extension/provider.intelligence.test.ts:1131`) | before-probes below returned no snippet / 0 items for every pinned case | 🟢 complete |
| Records | task, this report, `P8 · A48` PROGRESS row, todo feature item 15 | records persisted and lint-clean | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `CompletionSuggestion.snippet` (`:64`, JSDoc names the `$0` contract and the adapter precedence) and `CompletionSuggestion.replaceStart` (`:70`, per-item replacement start); `IntelligenceOptions.completePropertyWithSemicolon` (`:158`, absent = on); `CssUnit` (`:324`) and `CSS_UNITS` (`:337`, 27 entries with one-sentence descriptions); `unitItems()` (`:376`, suffix filter + `replaceStart` after the number prefix + `0~` sort key); `case "property"` (`:2054`) builds `${property}: $0;` when the option is on (`:2060`, `:2070`); `case "value"` (`:2075`) detects `/^\d*\.?\d+/` and pushes the unit items before the function loop (`:2092`–`:2093`). |
| `packages/vscode/src/providers/completion.ts` | Reads `xessa.editor.completePropertyWithSemicolon` via `vscode.workspace.getConfiguration("xessa", document.uri)` (`:31`–`:33`, `formatOnSave` pattern) and passes it to `completionsAt` (`:38`); `item.insertText = new vscode.SnippetString(suggestion.snippet)` when a snippet is present (`:45`–`:49`); `item.range` honours a per-item `replaceStart` (`:57`–`:61`). |
| `packages/vscode/package.json` | One new `contributes.configuration` property `xessa.editor.completePropertyWithSemicolon` (`:78`–`:82`), `boolean`, default `true`, description naming the cursor placement. |
| `tests/extension/provider.intelligence.test.ts` | New `describe("semicolon and unit completions (A48)")` block at `:1131` with **6 tests** (`:1208`, `:1242`, `:1278`, `:1319`, `:1352`, `:1393`); no existing test changed, weakened or deleted. |
| `.ai/tasks/CSSX-A48.md`, `.ai/reports/CSSX-A48.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A48` row 🟢; new feature item 15 describing both behaviours. |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan, navigation, symbols or analysis file was touched. No dependency change, no
commit, push, reset or stash.

## Diagnosis

### Behaviour 1 — property completion inserted no semicolon

Before the change every property item was
`{ label, kind: "property", detail: "CSS property", documentation, insertText: `${property}: ` }`,
so accepting `color` left `color: ` and the author had to type the value, the semicolon and the
XESSA1002 recovery by hand. The pure layer had no way to express "insert this text but put the cursor
in the middle of it": `insertText` is a plain string and the adapter assigned it verbatim
(`item.insertText = suggestion.insertText`). A snippet was the only missing concept, and VS Code's
own CSS support solves the same problem that way (`css.completion.completePropertyWithSemicolon`
inserts `property: ;` via a snippet while keeping the semi after the caret).

### Behaviour 2 — no suggestions while a number is typed

`case "value"` filters the keyword values and the curated functions with
`value.startsWith(context.word)`. At `margin: 1|` the word is `1`, no keyword value and no function
name starts with a digit, so the result was an empty item list (probe: `items: 0`) — a dead
completion popup in the most common value position. Units are the only thing that can legally follow
a number, and Xessa values are raw CSS (SPECIFICATION.md §3.3), so the list is property-agnostic.

## Design notes

- **Snippet as pure data.** `snippet?: string` holds VS Code snippet syntax (`${property}: $0;`);
  the intelligence layer never imports `vscode`, and the adapter is the only place that turns it into
  a `SnippetString`. `insertText` keeps the old `color: ` text so non-snippet consumers, the existing
  A29 test (`display?.insertText === "display: "`) and any plain-string fallback stay valid.
- **Default on.** `IntelligenceOptions.completePropertyWithSemicolon` absent means **enabled**,
  matching the setting default `true` in `package.json`; the adapter always passes the resolved
  value (`get<boolean>("editor.completePropertyWithSemicolon", true)`), so the pure default only
  matters for direct callers such as the tests. With the setting off the property item carries no
  snippet and the adapter falls back to `insertText`, i.e. the exact pre-change behaviour.
- **Replace range, not append.** The property snippet rides the shared range
  (`offset - word.length` … `offset`), so the typed prefix `col` is replaced whole and can never be
  appended to (`color: ;`, not `colcolor: ;`).
- **Per-item `replaceStart`.** A `CompletionResult` carries one replacement range, and the value list
  legitimately mixes digits-keyword values with units: `font-weight: 4` offers `400` (which must
  replace the typed `4`) next to the units (which must keep it). A single range therefore cannot be
  correct for both, so unit items carry their own `replaceStart = offset - suffix.length` (the
  cursor minus the already-typed unit suffix) while keyword values and functions keep the shared
  range. This is the same intent as A46's typed-dot handling, expressed per item instead of per
  context. `result.replaceStart` is unchanged, so A46-style assertions on the result range still
  hold.
- **Number detection.** The prefix is `/^\d*\.?\d+/` on the typed word: `1`, `10`, `1r`, `.5` and
  `0.5` match; the remainder after the prefix (`r` in `1r`) is the unit filter, compared
  case-insensitively because CSS units are case-insensitive. `1r` legitimately matches two units
  (`rem`, `rad`) — `rem` is offered first in `CSS_UNITS` order, not forced to be the only match.
  `0.` matches only the `0` prefix, leaving the suffix `.`; no unit starts with `.`, so no unit is
  offered and the half-typed decimal is left untouched rather than becoming `0.rem`.
- **`%` (already typed).** `%` is not in `scanBackWord`'s character set
  (`/[A-Za-z0-9_@$.-]/`), so at `margin: 10%|` the word is `""`: there is no number prefix, hence no
  unit items, and the value list keeps its pre-change shape with `result.replaceStart === offset`
  (nothing is replaced in front of the authored `%`). No duplicate `%` item, no `10%%`, no broken
  range. The same holds for `margin: 10 %|`. `%` is offered as a unit only from the number side
  (`10|` → `%` → `10%`).
- **Ordering.** Keyword values use `0-…` and functions `1-…`; units use `0~…`. `~` (0x7E) sorts
  after `-` (0x2D) and after any letter, so every unit sorts after every keyword value and before
  every function without renumbering the two existing families.
- **Units are property-agnostic.** No per-property filtering: `margin: 1` and `rotate: 1` offer the
  same 27 units, consistent with Xessa values being raw CSS.
- **`kind: "value"`, `detail: "CSS unit"`.** Units join the existing value family in the editor
  (`toCompletionKind("value")` is unchanged) but stay distinguishable in tests and in the popup.

## Evidence

The probe (`/tmp/probe-a48.ts`, deleted after use) ran the same documents through `completionsAt`
before and after the change, simulated the editor accept for each item (snippet `$0` → caret, own
`replaceStart` when set) and printed the resulting document text. "Before" is the pre-change
behaviour on the untouched working tree (recorded before the first edit); "After" is the same probe
re-run twice on the final files (byte-identical output).

| Probe | Before | After |
|---|---|---|
| `color` typed fully, accepting `color` (setting on) | `insertText "color: "`, `snippet undefined`, text `.a {\n  color: \n}` | `snippet "color: $0;"`, text `.a {\n  color: ;\n}`, caret 14 → `text[13..14] === " ;"` |
| `col` filtered, accepting `color` (setting on) | replaceStart 7, text `.a {\n  color: \n}` | replaceStart 7 (word replaced whole), text `.a {\n  color: ;\n}`, caret 14 |
| `col`, accepting `color` (setting **off**) | text `.a {\n  color: \n}` | text `.a {\n  color: \n}`, `snippet undefined`, `insertText "color: "` (unchanged) |
| `margin: 1` | 0 items | **27 unit items** `px,rem,em,%,vh,vw,vmin,vmax,ch,ex,cm,mm,in,pt,pc,q,fr,deg,grad,rad,turn,s,ms,hz,khz,dpi,dppx`; `rem` replaceStart 16 (= cursor) → `.a {\n  margin: 1rem\n}` |
| `margin: 1r` | 0 items | units `rem,rad`; `rem` replaceStart 16 (replaces only `r`) → `.a {\n  margin: 1rem\n}` |
| `margin: .5` | 0 items | 27 units; `rem` replaceStart 17 (= cursor) → `.a {\n  margin: .5rem\n}` |
| `margin: 0.5` | 0 items | 27 units → `.a {\n  margin: 0.5rem\n}` |
| `margin: 0.` | 0 items | 0 items (prefix `0`, suffix `.` matches no unit; half-typed decimal untouched) |
| `margin: 10%` | 53 items, no units | 53 items, no units, `replaceStart 18 = cursor`, no `%` item, authored `%` kept |
| `margin: 10 %` | 53 items, no units | 53 items, no units, `replaceStart 19 = cursor` |
| `padding: ` / `margin: r` (no number) | 28 keyword values + 25 functions | identical 28 + 25, zero unit items |
| `font-weight: 4` | 1 item (`400`) | `400` keeps the shared range → `font-weight: 400`; 27 units with own range → `font-weight: 4rem` |
| `margin: 1` sort order by `sortText` | — | `%[0~%] ch[0~ch] … vw[0~vw]` — all units between `0-auto` (keyword values) and `1-calc` (functions) |
| unit item description, e.g. `rem` | — | `detail "CSS unit"`, `documentation "Root em: relative to the root element's font size."`, `insertText "rem"`, `sortText "0~rem"` |
| A46 pseudo `&:` → `:hover` | replaceStart delta 1, text `&:hover` | unchanged |
| A46 class `&.te` | replaceStart delta 2 | unchanged |
| A47 `calc(` completion documentation | usage + blank line + ``Example: `calc(100% - 20px)` `` | unchanged |
| `width: ` keyword/function shape | `auto` `0-auto`, 28 values + 25 functions | unchanged |

Probe transcript excerpt (final run, identical to the run before the test block was added):

```text
=== Behaviour 1: property completion ===
typed fully: insertText: "color: "
typed fully: snippet: "color: $0;"
typed fully: accepted(on): ".a {\n  color: ;\n}"
typed fully: cursor(on): 14
typed fully: accepted(off): ".a {\n  color: \n}"
filtered col: replaceStart: 7
filtered col: snippet: "color: $0;"
filtered col: accepted(on): ".a {\n  color: ;\n}"

=== Behaviour 2: unit suggestions in value context ===
margin: 1: items: 27
margin: 1: unit labels: "px,rem,em,%,vh,vw,vmin,vmax,ch,ex,cm,mm,in,pt,pc,q,fr,deg,grad,rad,turn,s,ms,hz,khz,dpi,dppx"
margin: 1: rem replaceStart: 16
margin: 1: rem sortText: "0~rem"
margin: 1: rem documentation: "Root em: relative to the root element's font size."
margin: 1: accepted(rem): ".a {\n  margin: 1rem\n}"
margin: 1r: unit labels: "rem,rad"
margin: 1r: accepted(rem): ".a {\n  margin: 1rem\n}"
margin: .5: accepted(rem): ".a {\n  margin: .5rem\n}"
margin: 0.: items: 0
margin: 10%: unit labels: ""
font-weight: 4: unit labels: "px,rem,…,dppx"
font-weight: 4: keyword values: "400"
font-weight: 4: accepted(rem): ".a {\n  font-weight: 4rem\n}"

=== A46/A47 regressions ===
pseudo accepted: ".a {\n  &:hover\n}"
class replaceStart delta: 2
calc documentation: "Math expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)`"
auto sortText: "0-auto"
keyword value count: 28
```

Scope of the evidence: the probes and the test suite exercise the pure intelligence layer, which is
where both behaviours are produced. The adapter change (`SnippetString`, config read, per-item
`Range`) is covered by `bun run typecheck` only — this repository's extension tests run without the
`vscode` module, so no unit test can instantiate a `CompletionItem`. That limitation is pre-existing
and unchanged by A48.

### Tests added (`tests/extension/provider.intelligence.test.ts`, A48 describe block)

| Test | Pins |
|---|---|
| `accepting a property inserts the semicolon and parks the cursor before it` | `snippet === "color: $0;"`, `insertText === "color: "` unchanged, accepted text `color: ;`, caret sits between `" "` and `";"`; the same for `col` filtered through the word-covering range |
| `the semicolon insert is gated by the setting and leaves other contexts alone` | option `false` → no snippet and the `color: ` insert; explicit `true` equals the default; `value`, `pseudo` and `selector` items never carry a snippet |
| `a typed number offers CSS units that append without deleting the digits` | `margin: 1` → exactly the 27 units in `CSS_UNITS` order, `rem` replaceStart at the cursor, `1rem`/`1px` results, and `.5` → `.5rem`, `10` → `10rem`, `0.5` → `0.5rem` |
| `the typed unit suffix filters the units and the digits stay intact` | `1r` → `["rem","rad"]`, `rem` replaceStart one character back, `1rem` result; no units without a number (`margin: r`, `margin: `) and only value/function families remain |
| `unit items carry a description and sort between the values and the functions` | `font-weight: 4`: `400` keeps the shared range (`font-weight: 400`) while `rem` appends (`4rem`); every unit has `detail "CSS unit"`, a 10+ char description, `sortText 0~<unit>`, sorts after `0-auto` and before `1-calc`, and inserts its bare label; `width: ` has no units and keeps `0-auto`/`1-calc` |
| `a typed percent keeps the authored unit and adds no unit suggestions` | `margin: 10%` and `margin: 10 %`: value context with word `""`, zero unit items, no `%` label, `replaceStart === offset` (nothing replaced in front of the authored `%`) |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 79 pass / 0 fail, 767 `expect()` calls, 1 file (was 73 before A48; +6) |
| `bun test tests/extension/` | 🟢 177 pass / 0 fail, 1504 `expect()` calls, 10 files (was 171) |
| `bun test` | 🟢 877 pass / 0 fail, 790125 `expect()` calls, 45 files (10.55 s) (was 871) |
| `bun run typecheck` | 🟢 exit 0 — `compiler`, `cli`, `language-service`, `vscode` projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, no fixes applied |

No pre-existing failure was observed in this task and no test was weakened, skipped or deleted.

## Notes

- `1r` filters to `rem` **and** `rad` because both units start with `r`; the curated order puts `rem`
  first. Forcing a single match would need a ranking heuristic the spec does not ask for.
- `margin: 0.` (a trailing dot) intentionally yields no units: the number prefix stops at the digit,
  the remaining `.` matches no unit, and appending would produce the invalid `0.rem`. Typing the
  fractional digit (`0.5`) restores the full list.
- `%` typed by hand is never removed and never doubled; it is only offered as a unit from the number
  side.
- Vendor-prefixed or custom units are not suggested (curated list only), same deliberate limitation as
  the curated function list in A47.

## Blockers

None.

## Handoff

- Completed: `CompletionSuggestion.snippet` + `CompletionSuggestion.replaceStart` in the pure layer,
  property items inserting `${property}: $0;` behind the new
  `xessa.editor.completePropertyWithSemicolon` setting (default on), the `CSS_UNITS`/`unitItems()`
  unit family wired into `case "value"`, and the adapter's `SnippetString`/config/per-item-range
  plumbing; 6 new tests in `tests/extension/provider.intelligence.test.ts`.
- Verification: `bun test` 877 pass / 0 fail across 45 files, `bun run typecheck` exit 0,
  `bun run lint` exit 0 (422 files). Task record `.ai/tasks/CSSX-A48.md`, this report, the
  `P8 · A48` row in `.ai/PROGRESS.md` and todo feature item 15 are written. No file outside the
  owned set was modified; no commit or push performed. No model override was applied by this worker.
- Remaining steps: none for A48. Natural follow-ups, not started and not scoped: unit suggestions
  when a value starts with a function or a token (`calc(` → length units), a snippet placeholder for
  multi-dash properties that could reuse the same `snippet` field, and per-property unit ranking if
  the curated alphabetical order ever becomes a problem.
