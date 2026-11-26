# CSSX-A49 — Property-aware named colors, one-line rule bodies and duplicate classes

## Summary

- Color-accepting properties now offer the **148 standard CSS named colors** in a value position:
  `color: |`, `background-color: |`, `border-color: |`, the four `border-*-color` sides,
  `outline-color`, `text-decoration-color`, `accent-color`, `caret-color`, `column-rule-color`,
  `fill` and `stroke`. The color-property set is **derived** from the offered `CSS_PROPERTIES` list
  (the `color` property, every `*-color` longhand and the SVG paint properties), so `width: |`,
  `display: |`, `margin: |`, `opacity: |` and the shorthands (`background`, `border`, `outline`)
  keep their exact pre-change lists. Ten missing color properties were added to `CSS_PROPERTIES`
  with one-sentence docs.
- **One-line rule bodies already classify correctly.** 40+ single-line shapes were probed against
  their multi-line equivalents and are identical (value before `;`, empty value, typed value,
  property typing, second declaration after `;`, nested `&:hover`, `@media` one-liners, tight
  `.a{col}`, unclosed rules, CRLF/tabs). A46's authored-current-line fallback in `contextAt` covers
  them, so this item ships as a **parity regression test** and no classifier change.
- Typing `&.cl` showed `.class` twice when the class was defined and referenced again (or defined
  twice). Class suggestions are now deduped by name: one item per distinct name, with the
  useful `generated class .<prefixed>` detail preferred over a bare duplicate in either authored
  order. The analysis occurrence list is untouched.
- Verification: `bun test` **881 pass / 0 fail across 45 files** (877 baseline + 4 new),
  `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files). Extension suite 181/181
  (177 baseline), intelligence suite 83/83 (79 baseline).

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Named-color data | `CSS_NAMED_COLORS` (`intelligence.ts:339`), 148 CSS Color 4 names, frozen, alphabetical | 148 unique names, alphabetical order, `transparent`/`currentColor` stay keywords | 🟢 complete |
| Color-property set | `COLOR_PROPERTIES` (`:499`) derived from `CSS_PROPERTIES` (`:162`) | `color`, `fill`, `stroke`, every `*-color`; shorthands excluded | 🟢 complete |
| Missing properties + docs | 10 new entries in `CSS_PROPERTIES` (`:162`) and `property-docs.ts:14`, `:48`, `:53`, `:56`, `:59`, `:69`, `:74`, `:120`, `:138`, `:143` | list stays alphabetical, every property has a one-sentence doc | 🟢 complete |
| Value wiring | `namedColorItems()` (`:517`) called from `case "value"` (`:2291`, push at `:2307`) | word filter, `detail "CSS color"`, `sortText 0-<name>`, no snippet, colors only for color properties | 🟢 complete |
| One-line parity | 12-shape parity test (`tests/…:2079`) | one-line context and labels equal the multi-line equivalent; accept only edits the cursor word | 🟢 complete (pin only, no code change) |
| Class dedupe | `classDetail()` (`:2093`), `Map` dedupe in `case "selector"` (`:2345`, `:2363`–`:2373`) | exactly one item per distinct class name, useful detail preferred | 🟢 complete |
| Tests | 4 tests in `describe("named colors, one-line rules and duplicate classes (A49)")` (`tests/…:1947`) | before-probes returned 0 colors and 2 `.class` items | 🟢 complete |
| Records | task, this report, `P8 · A49` PROGRESS row, todo items 16 + 17 | persisted and lint-clean | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `CSS_PROPERTIES` (`:162`) gained `accent-color`, `border-bottom/left/right/top-color`, `column-rule-color`, `fill`, `outline-color`, `stroke`, `text-decoration-color`; new `CSS_NAMED_COLORS` (`:339`, 148 frozen names); new `COLOR_PROPERTIES` (`:499`, derived `ReadonlySet<string>`); new `namedColorItems()` (`:517`); `case "value"` pushes the color items for a color property (`:2307`); new `classDetail()` (`:2093`); `case "selector"` dedupes `analysis.classes` by name through a `Map` (`:2363`–`:2373`). |
| `packages/vscode/src/property-docs.ts` | One-sentence docs for the 10 new properties, record kept alphabetical (`:14`, `:48`, `:53`, `:56`, `:59`, `:69`, `:74`, `:120`, `:138`, `:143`). |
| `tests/extension/provider.intelligence.test.ts` | New `describe("named colors, one-line rules and duplicate classes (A49)")` at `:1947` with **4 tests** at `:2008` (148 colors per color property, shape/sort/accept, keyword and function families intact), `:2042` (word filter + non-color guard), `:2079` (12-shape one-line ≡ multi-line parity plus accept/snippet), `:2225` (class dedupe, detail preference, A46 dot preservation). No existing test changed, weakened or deleted. |
| `.ai/tasks/CSSX-A49.md`, `.ai/reports/CSSX-A49.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A49` row 🟢; feature item 16 and bug item 17. |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan or framework record was touched. No dependency change, no commit, push,
reset or stash.

## Diagnosis

### Item 1 — color properties listed no colors (`intelligence.ts:2291`)

Before the change the `value` case built one `Set` from `CSS_VALUES` plus
`PROPERTY_VALUES[property]`, filtered it by the typed word and appended `CSS_UNITS` and
`CSS_FUNCTIONS`. No family knew which properties accept a `<color>`, so `color: ` returned the same
53 generic items as `width: ` (`colors=0`, `red=false` in the before-probe). The per-property map
existed but described only 9 keyword families.

Fix: one frozen color-name constant, one predicate-derived property set, one item helper, one push.
`COLOR_PROPERTIES` is computed from `CSS_PROPERTIES` rather than authored separately:

```ts
const COLOR_PROPERTIES: ReadonlySet<string> = new Set(
  CSS_PROPERTIES.filter(
    (property) =>
      property === "color" ||
      property === "fill" ||
      property === "stroke" ||
      property.endsWith("-color"),
  ),
);
```

That automatically covers `accent-color`, `border-color`, the four `border-*-color` sides,
`background-color`, `caret-color`, `column-rule-color`, `color`, `outline-color` and
`text-decoration-color`, plus the SVG paint properties. Properties that merely contain a color in a
shorthand stay out, and a property that is not offered can never list colors.

### Item 2 — one-line rule bodies (`contextAt` / `currentLineStatement`)

**The reported failure did not reproduce.** The premise in the task was that one-line rules
classify fine for `value` but fail for `property` typing, which would happen if the authored-line
statement were sliced only from the last line break (`.a { col` → regex miss → selector/pseudo).
The current `currentLineStatement` slices from `max(statementStart + 1, lineStart + 1)`, and
`statementStart` stops at `{`/`;`/`}`, so `.a { col` yields ` col` and the declaration regex matches.
All probes confirm it:

| One-line shape | Cursor | Context |
|---|---|---|
| `.a { color: ; }` | after `color: ` | `{"kind":"value","property":"color","word":""}` |
| `.a { color: }` | after `color: ` | `{"kind":"value","property":"color","word":""}` |
| `.a { color: re; }` | after `re` | `{"kind":"value","property":"color","word":"re"}` |
| `.a { col }` | after `col` | `{"kind":"property","word":"col"}` |
| `.a { }` | after `{ ` | `{"kind":"property","word":""}` |
| `.a { color: red; col }` | after `col` | `{"kind":"property","word":"col"}` |
| `.a { color: red; background: }` | after `background: ` | `{"kind":"value","property":"background","word":""}` |
| `.a { &:hover { color: } }` | after `color: ` | `{"kind":"value","property":"color","word":""}` |
| `.a { &:hover { col } }` | after `col` | `{"kind":"property","word":"col"}` |
| `@media (min-width: 600px) { .a { col } }` | after `col` | `{"kind":"property","word":"col"}` |
| `.a{col}` | after `col` | `{"kind":"property","word":"col"}` |
| `.a { color: red; }` | before `;` | value context (A29/A46 contract) |

Additional probe families that also matched their multi-line equivalents: unclosed rules
(`.a { col`, `.a { color: `), CRLF and tab indentation, double spaces, `;;`, `!important`, `var()`,
`url()`, strings containing `;`/`:`/`{`, `@supports`/`@container`/`@layer` and `@md` one-liners,
nested class and pseudo-element one-liners, and `@keyframes` frame one-liners. Selector replacements
were correct too (`replaceStart` always `offset - word.length` for a property/value word).

Because no code path fails, no classifier change was made (a change would risk A29 S1/S2/S7 and A46
bug C for zero behavioural gain). The new test pins 12 shapes plus an A48 snippet accept, so a
future refactor that regresses one-line rules fails loudly.

**Adjacent finding, out of scope:** a block comment between the boundary and the property
(`.a { /* note */ color: | }`) classifies as `pseudo`, because the fallback regex
`^\s*([A-Za-z-]+)\s*:(\s.*)?$` cannot skip a leading comment. The same misclassification exists in
multi-line rules (`.a {\n  /* note */ color: \n}`), so it is not one-line-specific and was left
untouched. Recorded here for a future task; no todo item was added because it is not an owner
report.

### Item 3 — duplicate class suggestions (`intelligence.ts:2345`)

`case "selector"` pushed one item per entry of `analysis.classes`, and `collectClasses` records one
occurrence per authored class token. Any class mentioned twice therefore appeared twice:

- `.a { &.class { … } }` + `.class { … }` at `&.cl` → `[..., ".a", ".class", ".class"]`;
- prefixed class plus `:global(.icon)` → `.icon` twice (one with detail, one without).

Fix: a `Map` keyed by class name; the first occurrence wins unless a later one carries the useful
`generated class .<prefixed>` detail (`classDetail()` returns `undefined` when
`generated === name`). `Map.set` on an existing key keeps insertion order, so item order follows the
first authored occurrence. `analysis.classes` is untouched (the test asserts it still contains two
occurrences for a duplicated class, proving the dedupe is a completion concern only).

## Design notes

- **No new mechanism for values.** The color family reuses the existing per-property wiring point
  (`case "value"`); `PROPERTY_VALUES` stays for keyword families.
- **Stable ordering.** Keyword values use `0-…`, units `0~…`, functions `1-…` (A48). Names use
  `0-<name>`, so the editor sorts them alphabetically together with `auto`, `inherit`, … and ahead
  of units and functions. Raw item order is: keyword values (sorted), named colors (constant order =
  alphabetical), units, functions; the editor re-sorts by `sortText`, so the families never mix.
- **`detail: "CSS color"`, no documentation.** The detail keeps colors distinguishable from
  `"CSS value"`, `"CSS unit"` and `"CSS function"` in the popup and in tests; a 148-entry per-color
  documentation string would be noise, so the item carries no markdown body.
- **Filter parity.** Color names filter with the same case-sensitive `startsWith` used by keyword
  values, so `re` → `rebeccapurple`, `red` (constant order is alphabetical) beside `relative`,
  `revert` and the `repeating-*` functions.
- **Color properties, not shorthands.** `background`, `border` and `outline` accept a color
  *component*; listing 148 names there would crowd out `url(`/gradient/width/style hints, so they
  keep their pre-change lists. Stated here as a deliberate limitation of the curated model.
- **Dedupe preference.** A generated-name detail is the only occurrence-dependent information in a
  class item, so it is the tie-breaker; label, kind and `insertText` are identical for the same name
  and the A46 dot-preserving range is unchanged.
- **One-line item = test, not classifier change.** See Diagnosis item 2; the probe matrix is the
  evidence that the existing fallback is the correct mechanism.

## Evidence

Probe `/tmp/probe-a49-before.ts` (deleted after use) ran every document through `contextAt` /
`completionsAt`; "Before" was recorded on the untouched tree, "After" on the final files. Both
transcripts are byte-identical for the item-2 contexts, the A46/A47/A48/A29 regressions and every
one-line row; only the color rows and the property first-three labels change.

| Probe | Before | After |
|---|---|---|
| `color: ` / `background-color: ` / `border-color: ` / `outline-color: ` / `text-decoration-color: ` / `accent-color: ` / `caret-color: ` / `column-rule-color: ` / `fill: ` / `stroke: ` | 53 items, `colors=0`, `red=false`, `rebeccapurple=false` (each) | **201 items**, `colors=148`, `red=true`, `rebeccapurple=true` (each) |
| `width: ` / `display: ` / `margin: ` / `opacity: ` | 53 items, 0 colors | 53 items, 0 colors, no `red` (unchanged) |
| `background-color: re` | `["relative","revert","repeating-linear-gradient("]` | `["relative","revert","rebeccapurple","red","repeating-linear-gradient("]` |
| `red` item shape | — | `kind "value"`, `detail "CSS color"`, `insertText "red"`, `sortText "0-red"`, no snippet, shared range → `background-color: red` |
| `.a { color: ; }` accept `red` | — | `.a { color: red; }` |
| `.a { &:hover { color: } }` accept `red` | — | `.a { &:hover { color: red} }` |
| `.a { col }` accept `color` | — | `snippet "color: $0;"`, range covers `col`, text `.a { color: ; }`, caret after `color: ` |
| one-line matrix (12 shapes) | context correct in every shape | identical context + identical labels to the multi-line equivalent |
| `&.cl` with `.class` defined once | `[..., ".a", ".class", ".class"]` | `[..., ".a", ".class"]` |
| `&.cl` with `.class` defined twice | `[..., ".class", ".a", ".class"]` | `[..., ".class", ".a"]` |
| `&.ic` with prefixed `.icon` + `:global(.icon)` (either order) | `.icon` twice (one detail, one bare) | `.icon` once, `detail "generated class .ui-icon"` |
| A48 property snippet | `"color: $0;"` / insert `"color: "` | unchanged |
| A48 units at `margin: 1` | 27 | 27 |
| A46 pseudo `&:` range delta | 1 | 1 |
| A46 class `&.te` range delta | 2 | 2 |
| A47 `calc` hover | full usage + example markdown | unchanged |
| A29 S1/S2 | `{"kind":"property","word":"dis"}` | unchanged |
| A29 S7 | `{"kind":"value","property":"display","word":"fl"}` | unchanged |

Probe excerpt (after; item 2 and regressions identical before/after):

```text
=== Item 1: color names ===
color: items=201 colors=148 red=true rebeccapurple=true
width: items=53 colors=0 red=false rebeccapurple=false
background-color "re": ["relative","revert","rebeccapurple","red","repeating-linear-gradient("]
=== Item 2: one-line rule bodies ===
value before ;           ctx={"kind":"value","property":"color","word":""} first=["absolute","auto","block"]
property typed           ctx={"kind":"property","word":"col"} first=["color","column-gap","column-rule-color"]
nested value             ctx={"kind":"value","property":"color","word":""} first=["absolute","auto","block"]
nested value before ;    ctx={"kind":"value","property":"color","word":""} first=["absolute","auto","block"]
=== Item 3: duplicate classes ===
ctx={"kind":"selector","word":".cl"} labels=["&",…,".a",".class"]
ctx={"kind":"selector","word":".cl"} labels=["&",…,".class",".a"]
prefixed+global labels=["&",…,".icon",".a",".b"] details=[…,"generated class .ui-icon","generated class .ui-a","generated class .ui-b"]
=== Regressions: A46/A47/A48/A29 ===
A48 property snippet="color: $0;" insert="color: "
A48 units=27
A46 pseudo replaceStart delta=1 first=[":active",":checked"]
A46 class replaceStart delta=2
A47 calc hover="**calc()** — CSS function\n\nMath expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)`"
S1 ctx={"kind":"property","word":"dis"}
S2 ctx={"kind":"property","word":"dis"}
S7 ctx={"kind":"value","property":"display","word":"fl"}
```

Scope: probes and tests exercise the pure intelligence layer, where all three behaviours are
produced. No adapter change was needed for A49 (the new items use the existing `value`/`selector`
fields), so `bun run typecheck` is the only coverage of the adapter here — same pre-existing
limitation as A48 (the extension suite runs without the `vscode` module).

## Tests added (`tests/extension/provider.intelligence.test.ts`, A49 describe block)

| Test | Pins |
|---|---|
| `every color-accepting property offers the standard named colors` (`:2008`) | 14 color properties × 148 colors, `detail "CSS color"`, `sortText 0-<name>`, plain insert (no snippet, shared range), accepted text, and that `auto` (`0-auto`) / `calc(` (`1-calc`) keep their families |
| `the typed word filters the colors and non-color properties stay color-free` (`:2042`) | `background-color: re` → exactly `rebeccapurple`, `red`, every color starts with `re`; keyword and function filtering untouched; `width`/`display`/`margin`/`opacity`/`font-weight` list no color at all |
| `one-line rule bodies classify exactly like multi-line rules` (`:2079`) | 12 one-line/multi-line pairs: equal context, equal labels, `replaceStart = offset - word.length`; accepts in a value one-liner, a nested `&:hover` one-liner and an A48 property snippet (cursor between `: ` and `;`) |
| `class suggestions list every distinct name exactly once` (`:2225`) | duplicate class (defined/referenced/second definition/plain rule-body position) yields one `.class` item while `analysis.classes` keeps both occurrences, other classes and the 6 selector starters stay single, A46 dot kept, prefixed + `:global` collapse to one item with `generated class .ui-icon` in both orders |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 83 pass / 0 fail, 1137 `expect()` calls, 1 file (was 79 before A49; +4) |
| `bun test tests/extension/` | 🟢 181 pass / 0 fail, 1874 `expect()` calls, 10 files (was 177) |
| `bun test` | 🟢 881 pass / 0 fail, 790495 `expect()` calls, 45 files (was 877) |
| `bun run typecheck` | 🟢 exit 0 — `compiler`, `cli`, `language-service`, `vscode` projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, `No fixes applied.` |

Intermediate results, reported honestly:

- The first `bun run lint` after the source edits failed with **3 formatter errors** (line wrapping
  in `property-docs.ts`, `namedColorItems()` and two long test literals). `biome check --write` on
  the three touched files fixed exactly those three and the final `biome check .` is clean with no
  fixes applied. No assertion or behaviour was changed by the formatting pass; the intelligence
  suite was re-run afterwards (83/0).
- The extension-host test `extension host activates providers and commands` failed twice in
  intermediate runs: once in a full-suite run and once while `tests/extension/` and `bun test` were
  launched concurrently (two Electron extension hosts competing for the same cached install). It
  passed when run alone (`tests/extension/` 181/0) and in the final serialized full run
  (`bun test` 881/0). This is pre-existing harness flakiness, not an A49 regression; the A49 tests
  are pure-layer and the host test's completion assertion only checks that 12 items come back.
- No pre-existing test was weakened, skipped or deleted.

## Notes

- The standard set is the 148 CSS Color 4 named colors (including `rebeccapurple`); `transparent`
  and `currentColor` are CSS-wide keywords already present in `CSS_VALUES` and are intentionally not
  duplicated. `grey`/`gray` cousins are all present as distinct CSS names.
- Color filtering is case-sensitive, matching the existing keyword-value filter; authored CSS is
  conventionally lowercase and the item always inserts the lowercase name.
- `fill` and `stroke` were added as properties because the task's minimum list names them; their
  values stay raw CSS, so the generic keyword values still apply beside the colors.
- The `(`-trigger completion feature is a separate upcoming task and was not started.

## Blockers

None.

## Handoff

- Completed: 148 frozen named colors wired through a `COLOR_PROPERTIES` set derived from
  `CSS_PROPERTIES`, 10 new color properties with docs, `namedColorItems()` in the `value` case,
  name-level class dedupe with generated-detail preference in the `selector` case, and 4 tests
  (including the one-line ≡ multi-line parity pin; no classifier change was needed).
- Verification: `bun test` 881 pass / 0 fail across 45 files, `bun run typecheck` exit 0,
  `bun run lint` exit 0 (422 files, no fixes applied); extension suite 181/181, intelligence suite
  83/83. Task record `.ai/tasks/CSSX-A49.md`, this report, the `P8 · A49` row in `.ai/PROGRESS.md`
  and todo items 16/17 are written.
- Remaining steps: none for A49. Natural follow-ups, not started and not scoped: colors for
  shorthand properties (`border`, `background`, `outline`) if the popup noise is acceptable;
  skipping a leading block comment in the rule-body statement fallback (the out-of-scope
  `/* note */ color: |` → `pseudo` misclassification); the separate `(`-trigger completion task.
