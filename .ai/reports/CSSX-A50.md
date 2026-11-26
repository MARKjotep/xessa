# CSSX-A50 — `(`-triggered function suggestions and the `@fn` board cleanup

## Summary

- Typing `(` in a declaration value now reveals the **25 curated CSS functions only** and accepting
  one **replaces the typed `(`** with the call: `width: (|` + `clamp(` → `width: clamp(`
  (before: 53 generic items and `width: (clamp(`). Keyword values, named colors and units are
  suppressed in that state, which is why the list is useful.
- The state is only the paren the author just typed. Inside an existing call nothing changes:
  `calc(100% - 2|` keeps units only, `calc(100%|` keeps the ordinary list and never offers a
  paren-replacing item, and `calc(|` keeps the ordinary list because the paren sits behind a call
  name. A second paren (`calc((`) behaves like the first.
- `(` was added to the registered trigger characters (`controller.ts:128`) so the popup opens on
  the keystroke instead of only on explicit invoke.
- Todo item 14 (the `@fn` author-function namespace) is deleted from `.ai/todo.md` by owner
  decision; the board keeps its numbers (it already has gaps) and a new feature item 18 records the
  `(` trigger.
- Verification: `bun test` **886 pass / 0 fail across 45 files** (881 baseline + 5 new),
  `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files, no fixes applied). Extension suite
  186/186 (181 baseline), intelligence suite 88/88 (83 baseline).

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Trigger registration | `"("` in the completion provider registration (`controller.ts:128`) | `bun`-free source assertion in the new test finds all seven triggers | 🟢 complete |
| Opener detection | `callOpenerStart()` (`intelligence.ts:1081`) | returns the `(` offset for `width: (`/`(cl`/`calc((`, `undefined` for `calc(`, `100%`, `- 2` | 🟢 complete |
| Function items | shared `functionItems(word, replaceStart?)` (`:844`) used by both value paths | same label/kind/detail/documentation/sortText as before, optional per-item `replaceStart` | 🟢 complete |
| Value wiring | paren branch at the top of `case "value"` (`:2336`) | paren state returns functions only; ordinary path still keyword values + colors + units + functions | 🟢 complete |
| Trigger doc | `completionsAt` JSDoc lists `(` (`:2138`) | comment matches the registration | 🟢 complete |
| Tests | 5 tests in `describe("paren-triggered function suggestions (A50)")` (`tests/…:2292`) | before-probe showed 53/201 items and `(clamp(`; the new tests pin functions-only + paren swap + inside-call guards | 🟢 complete |
| Records | task, this report, `P8 · A50` PROGRESS row, todo item 14 removed + item 18 added | persisted, lint-clean | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/controller.ts` | `"("` added to the `registerCompletionItemProvider` trigger list (`:128`); nothing else touched. |
| `packages/vscode/src/intelligence.ts` | New `functionItems(word, replaceStart?)` helper (`:844`) replacing the inline function loop in `case "value"`; new `callOpenerStart(text, offset, word)` helper (`:1081`); paren branch at the top of `case "value"` (`:2336`); `completionsAt` JSDoc trigger list now includes `(` (`:2138`). |
| `tests/extension/provider.intelligence.test.ts` | New `describe("paren-triggered function suggestions (A50)")` at `:2292` with **5 tests** at `:2368`, `:2413`, `:2464`, `:2535`, `:2607`. No existing test changed, weakened or deleted. |
| `.ai/tasks/CSSX-A50.md`, `.ai/reports/CSSX-A50.md` | **New.** Task prompt and this report. |
| `.ai/todo.md` | Feature item 14 (`@fn`) deleted; feature item 18 (`(` trigger, 🟢 CSSX-A50) appended (`:41`). |
| `.ai/PROGRESS.md` | `P8 · A50` row 🟢 (`:57`). |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan or framework record was touched. No dependency change, no commit, push,
reset or stash.

## Diagnosis and design decisions

### 1. Detection lives in `completionsAt`, not in `contextAt` (`intelligence.ts:1081`, `:2336`)

`contextAt` already reports the correct `{ kind: "value", property, word }` for every paren shape,
because `scanBackWord` stops at `(`: `width: (` has `word: ""` and `width: (cl` has `word: "cl"`.
The missing information is only *what the completion list should contain and which range it
replaces*, so `contextAt` is untouched (the A29/A46/A49 context contract cannot regress) and the
state is derived in the `value` case from the authored text.

`callOpenerStart` returns `offset - word.length - 1` when that character is `(`, and refuses when a
name character sits directly in front of the paren:

```ts
function callOpenerStart(text: string, offset: number, word: string): number | undefined {
  const paren = offset - word.length - 1;
  if (paren < 0 || text[paren] !== "(") return undefined;
  const before = text[paren - 1];
  return before !== undefined && /[A-Za-z0-9_-]/.test(before) ? undefined : paren;
}
```

The guard is what keeps `calc(` (and `(clamp(`) on the ordinary list: there the paren is part of a
call the author already named, so a range covering it would corrupt the call (`calc` + `clamp(` =
`calcclamp(`). The task asked for "the bare `(` state"; the guard is the precise definition of
"bare", and without it the paren branch would also have eaten `calc(`'s opener.

### 2. Per-item `replaceStart`, result range unchanged (`intelligence.ts:844`, `:2336`)

The paren branch returns `result(functionItems(context.word, opener), replaceStart)` where
`replaceStart` is the ordinary word range (`offset - word.length`). Every item carries its own
`replaceStart = opener`, the A48 mechanism the adapter already honours
(`providers/completion.ts` prefers `suggestion.replaceStart` over the result range). The result
range stays the plain word so nothing outside the function family depends on the wider range, and
accepting always replaces exactly the typed `(`, never text before it:

- `width: (|` + `clamp(` → `width: clamp(`
- `width: (cl|` + `clamp(` → `width: clamp(` (the range covers `(cl`)
- `width: calc((|` + `clamp(` → `width: calc(clamp(`

### 3. No snippet — plain `clamp(` (`intelligence.ts:844`)

The insert text stays the existing `name(` (or the curated `var(--` override). A `clamp($0)`
snippet was considered and rejected: it would move the closing paren into the document (the
authored text has none) and would make the acceptance criteria read `width: clamp()` instead of
`width: clamp(`, i.e. it changes typing semantics rather than helping it. The plain form keeps
"accept the function, then keep typing the arguments", which is what a CSS author expects, and it
composes trivially with the replace-the-paren range. `var(--` keeps its curated form in this state
too, so `width: (|` + `var(` yields `width: var(--`.

### 4. Families suppressed in the paren state (`intelligence.ts:2336`)

The branch returns *before* the keyword-value / named-color / unit construction, so the state is
exactly the function family:

| Family | `width: (` before | `width: (` after |
|---|---|---|
| keyword values (`CSS_VALUES`, `PROPERTY_VALUES`) | 25 | 0 |
| named colors (A49) | 148 for `color` | 0 |
| units (A48) | 0 (`""` word has no number prefix) | 0 |
| functions | 25 | 25 |

Nothing is suppressed outside the paren state, so A48 units (`margin: 1` → 27) and A49 colors
(`color: ` → 148) are unchanged.

### 5. Which value-bearing contexts are covered

Every `contextAt` path that returns `{ kind: "value" }` funnels through the same `case "value"`, so
the state is reachable everywhere the value list already was. Verified shapes: multi-line rule
body, one-line rule body (`.a { width: (| }`), nested `&:hover`, `@media (min-width: 600px) { .a {
width: (| } }` one-liner, `@keyframes` frame body, and a nested second paren (`calc((`). Positions
that are **not** forced into it, by design: `@setup` values (`{ kind: "setup-value" }` — only
boolean keys, an authored `(` lists nothing), selector/pseudo positions, and values inside a still
open string (`enclosingString` returns `none`). The task explicitly excluded `@setup`.

### 6. Filter behaviour (`tests/…:2413`)

The filter word is the text after the paren (`context.word`), and the range starts at the paren, so
`width: (cl|` → one item `clamp(` → `width: clamp(`. The pinning test asserts the exact text
because the naive "range = word" version produced `width: (clamp(` (the before-probe transcript
shows it). `margin: (re|` now lists only `repeating-linear-gradient(` — before it also listed
`relative` and `revert`, the concrete case where the paren state was actively unhelpful.

## Evidence

Probe `/tmp/probe-a50-before.ts` (also run as `-after`; both deleted after use) prints context,
item counts per family, the result range and the accepted text for one document per shape. "Before"
was recorded on the untouched tree, "After" on the final files. `items` is the whole list, `fn` the
function family, `range` the result range, `clamp` the item's own `replaceStart` (`shared` = none),
`accept` the document text after accepting `clamp(`.

| Probe | Before | After |
|---|---|---|
| `width: (\|` | `items=53 fn=25 colors=0 units=0 range=15..15`, first labels `absolute,auto,block,…`, `clamp=shared`, accept `width: (clamp(` | **`items=25 fn=25 colors=0 units=0`**, first labels `calc(,min(,max(,clamp(,var(,env(`, `clamp=14`, accept **`width: clamp(`** |
| `width: (cl\|` | `items=1 fn=1`, `clamp=shared`, accept `width: (clamp(` | `items=1 fn=1`, `clamp=14`, accept **`width: clamp(`** |
| `width: (clamp(\|` | `items=53`, `clamp=shared` | unchanged (paren behind a call name) |
| `width: calc(100% - 2\|` | `items=27`, all units, no `clamp(` | **unchanged** |
| `width: calc(100%\|` | `items=53`, `clamp=shared`, accept `calc(100%clamp(` | **unchanged** |
| `width: calc(\|` | `items=53`, `clamp=shared`, accept `calc(clamp(` | **unchanged** |
| `width: calc((\|` | `items=53`, `clamp=shared`, accept `calc((clamp(` | **`items=25 fn=25`**, `clamp=19`, accept `calc(clamp(` |
| `color: (\|` | `items=201` (148 colors), accept `color: (clamp(` | **`items=25`, 0 colors**, accept `color: clamp(` |
| `margin: (re\|` | `relative`, `revert`, `repeating-linear-gradient(` | **`repeating-linear-gradient(`** only |
| one-line `.a { width: (\| }` | `items=53`, accept `.a { width: (clamp( }` | **`items=25`**, accept `.a { width: clamp( }` |
| one-line `.a { width: (cl\| }` | `items=1`, accept `.a { width: (clamp( }` | accept **`.a { width: clamp( }`** |
| nested `&:hover { color: (\| }` | `items=201`, accept `color: (clamp(` | **`items=25`**, accept `color: clamp(` |
| `@media` one-liner, `@keyframes` frame, `grid-template-columns: (`, `transform: (` | `items` = ordinary list | **`items=25`, `details=["CSS function"]`** (second probe) |
| `@setup { prefix: (\| }` | `{"kind":"setup-value"}`, 0 items | **unchanged** |
| `@setup { prefix: "(\|" }` | `{"kind":"none"}` | **unchanged** |
| `.a { .cl(\| }` | `{"kind":"selector"}`, 7 starter items, no function | **unchanged** |
| registered triggers | `"@" "$" "." ":" "/" "&"` | `"@" "$" "." ":" "/" "&" "("` |

Probe excerpt (after):

```text
width: (                         ctx={"kind":"value","property":"width","word":""} items=25 fn=25 colors=0 units=0 range=15..15
                                 labels=[calc(,min(,max(,clamp(,var(,env(] clamp=range=14 accept=".a {\n  width: clamp(\n}"
width: (cl                       ctx={"kind":"value","property":"width","word":"cl"} items=1 fn=1 colors=0 units=0 range=15..17
                                 labels=[clamp(] clamp=range=14 accept=".a {\n  width: clamp(\n}"
width: calc(100% - 2             ctx={"kind":"value","property":"width","word":"2"} items=27 fn=0 colors=0 units=27 range=26..27
                                 labels=[px,rem,em,%,vh,vw] clamp=absent accept=-
width: calc(100%                 ctx={"kind":"value","property":"width","word":""} items=53 fn=25 colors=0 units=0 range=23..23
                                 labels=[absolute,auto,block,border-box,center,contents] clamp=range=shared accept=".a {\n  width: calc(100%clamp(\n}"
width: calc(                     ctx={"kind":"value","property":"width","word":""} items=53 fn=25 colors=0 units=0 range=19..19
                                 labels=[absolute,auto,block,border-box,center,contents] clamp=range=shared accept=".a {\n  width: calc(clamp(\n}"
width: calc((                    ctx={"kind":"value","property":"width","word":""} items=25 fn=25 colors=0 units=0 range=20..20
                                 labels=[calc(,min(,max(,clamp(,var(,env(] clamp=range=19 accept=".a {\n  width: calc(clamp(\n}"
color: (                         ctx={"kind":"value","property":"color","word":""} items=25 fn=25 colors=0 units=0 range=15..15
                                 labels=[calc(,min(,max(,clamp(,var(,env(] clamp=range=14 accept=".a {\n  color: clamp(\n}"
margin: (re                      ctx={"kind":"value","property":"margin","word":"re"} items=1 fn=1 colors=0 units=0 range=16..18
                                 labels=[repeating-linear-gradient(] clamp=absent accept=-
one-line .a { width: (           ctx={"kind":"value","property":"width","word":""} items=25 fn=25 colors=0 units=0 range=13..13
                                 labels=[calc(,min(,max(,clamp(,var(,env(] clamp=range=12 accept=".a { width: clamp( }"
nested &:hover color: (          ctx={"kind":"value","property":"color","word":""} items=25 fn=25 colors=0 units=0 range=29..29
                                 labels=[calc(,min(,max(,clamp(,var(,env(] clamp=range=28 accept=".a {\n  &:hover {\n    color: clamp(\n  }\n}"
@setup value paren               ctx={"kind":"setup-value","key":"prefix","word":""} items=0 fn=0 colors=0 units=0 range=20..20
@setup string paren              ctx={"kind":"none"} items=0 fn=0 colors=0 units=0 range=21..21
selector .a { .cl(               ctx={"kind":"selector","word":""} items=7 fn=0 colors=0 units=0 range=9..9
triggers= "\"@\" \"$\" \".\" \":\" \"/\" \"&\" \"(\""
```

Second probe (after) for the remaining value shapes:

```text
@media one-line width: ( ctx={"kind":"value","property":"width","word":""} items=25 details=["CSS function"] labels=["calc(","min(","max(","clamp("]
keyframes frame width: ( ctx={"kind":"value","property":"width","word":""} items=25 details=["CSS function"] labels=["calc(","min(","max(","clamp("]
grid-template-columns: ( ctx={"kind":"value","property":"grid-template-columns","word":""} items=25 details=["CSS function"] labels=["calc(","min(","max(","clamp("]
transform: ( ctx={"kind":"value","property":"transform","word":""} items=25 details=["CSS function"] labels=["calc(","min(","max(","clamp("]
```

No pre-existing family changed outside the paren state: the before/after transcripts are identical
for `calc(100% - 2`, `calc(100%`, `calc(`, `(clamp(`, `@setup`, the selector probe and every A46–A49
probe run in the A49 report (the A49 tests are re-run unchanged and green).

## Tests added (`tests/extension/provider.intelligence.test.ts`, A50 describe block)

| Test | Pins |
|---|---|
| `a typed paren in a value position offers only the curated functions` (`:2368`) | 6 properties (`width`, `color`, `background-color`, `margin`, `opacity`, `transform`) × exactly the 25 function labels in constant order, every item `kind "value"` / `detail "CSS function"` / `replaceStart = offset - 1`, no keyword/color/unit item, `sortText 1-calc`, `clamp` documentation, `var(` → `var(--`, and accept `clamp(` → `width: clamp(` (no duplicate paren) |
| `the word after the paren filters the functions and the range still covers the paren` (`:2413`) | `(cl` → exactly `clamp(` with range covering `(cl`, accept → `width: clamp(`; `margin: (re` → `repeating-linear-gradient(` only (the `relative`/`revert` leak); `(c` → the 6 `c`-functions in constant order; the one-line variant filters and accepts identically |
| `the paren state reaches every authored value shape` (`:2464`) | one-line rule, nested `&:hover`, `@media` one-liner, `@keyframes` frame, plus the nested `calc((` opener; `@setup` value stays `setup-value` with no items and the selector position keeps its starter list with no function item |
| `editing inside an existing call keeps the ordinary value behaviour` (`:2535`) | `calc(100% - 2` → 27 unit items and no `clamp(`; `calc(100%` → 53 items, shared range, result range at the cursor; `calc(` and `(clamp(` → ordinary 53-item list with `replaceStart` undefined and no eaten opener; A48 `width: ` 53 / A49 `color: ` 201 with 148 colors / A48 `margin: 1` 27 |
| `the completion provider registers ( as a trigger character` (`:2607`) | the `controller.ts` registration contains all seven triggers `@`, `$`, `.`, `:`, `/`, `&`, `(` |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 88 pass / 0 fail, 1454 `expect()` calls, 1 file (was 83 before A50; +5), exit 0 |
| `bun test tests/extension/` | 🟢 186 pass / 0 fail, 2191 `expect()` calls, 10 files (was 181), exit 0 |
| `bun test` | 🟢 886 pass / 0 fail, 790812 `expect()` calls, 45 files (was 881), exit 0 |
| `bun run typecheck` | 🟢 exit 0 — `compiler`, `cli`, `language-service`, `vscode` projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, `No fixes applied.` |

Intermediate results, reported honestly:

- The first run of the new tests had **1 failure** in my own test code: the property loop built
  `\`.a {\n  ${property}: \n}\`` (no `(`), so the ordinary 53-item list was offered and the
  functions-only assertion failed with `Expected: 25, Received: 53`. The test document was missing
  the paren the case is about; the source change was correct (the probe output above was already
  green). Fixed the literal to `: (` and re-ran: 88/0. No source change was involved.
- The first `bun run lint` after the edits reported **2 formatter errors** (the `functionItems`
  signature/call wrapping in `intelligence.ts` and the property array in the new test).
  `biome check --write` on the three touched files fixed exactly those two; the final
  `biome check .` is clean with no fixes applied and the intelligence suite was re-run afterwards
  (88/0).
- No pre-existing test was weakened, skipped or deleted; the entire pre-existing suite passes
  unchanged.

## Notes and limitations

- **VS Code filter text (unverified, editor-side):** the pure layer hands the adapter a range that
  starts at the `(` while the item keeps `filterText = label` (`clamp(`). VS Code derives its
  filter input from the replacement range, so in the `(cl` state the editor *may* score the `(` as
  an unmatched leading character and hide an item our layer correctly returns. The pure-layer
  contract (acceptance criteria 1–3) is independent of this and is verified; the editor behaviour is
  not covered by any test here (the extension suite runs without the `vscode` module). If the owner
  sees a missing entry after typing past the paren, the one-line fix is an adapter `filterText`
  that drops the leading paren — `packages/vscode/src/providers/completion.ts` was not in this
  task's write set.
- **Stale trigger comment (out of write set):** the header comment of
  `packages/vscode/src/providers/completion.ts` still lists `@`, `$`, `.`, `:`, `/`, `&` as the
  trigger characters. The `completionsAt` JSDoc in `intelligence.ts:2138` was updated; the adapter
  comment needs a one-line follow-up by whoever owns that file.
- `width: (1|` (a digit directly behind the paren) now lists nothing: no function name starts with
  a digit and keyword values/units are suppressed in this state by design. Such a value is not
  valid CSS outside a function call, so this was accepted rather than special-cased.
- Function items keep their pre-existing `sortText` `1-…` family (the editor sorts them after
  keyword values within this list, which is moot because they are the only family present).

## Blockers

None.

## Handoff

- Completed: `(` registered as a completion trigger; `callOpenerStart()` + the paren branch of
  `case "value"` return the 25 curated functions only, each with its replacement range over the
  typed `(`; shared `functionItems()` helper keeps the ordinary value path byte-identical;
  A46–A49 contexts and lists unchanged; todo item 14 (`@fn`) deleted and feature item 18 added;
  `P8 · A50` PROGRESS row 🟢.
- Verification: `bun test` 886 pass / 0 fail across 45 files, extension suite 186/186, intelligence
  suite 88/88, `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files, no fixes applied).
- Remaining steps: none for A50. Follow-ups found but not started and not scoped: the adapter
  `filterText` for the paren state and the stale trigger comment in
  `providers/completion.ts` (both editor-side, outside this task's write set), and the
  `@setup`-value paren state if the owner ever wants function calls allowed there.
