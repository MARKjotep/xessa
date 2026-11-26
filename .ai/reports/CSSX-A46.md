# CSSX-A46 — editor completion range/context bugfixes (three bugs)

## Summary

- Fixed three completion bugs in the extension's pure intelligence layer: accepting a pseudo-class
  after typing `:` behind `&` duplicated the colon (`&::hover`, owner-visible `&:::hover`),
  accepting a class after `&.` deleted the typed dot (`&.test > a` became `&test > a`), and no CSS
  property completions were offered on a bare-word/empty line written directly above a line
  starting with `&`.
- Root causes: the `pseudo` replacement range started *after* the typed colon(s) while every
  `PSEUDOS` entry carries its own colon; the `selector` replacement range covered the typed dot
  (`.` is a word character) while class items insert the bare name; and the tolerant parser glues
  the statement line and the following `&` line into one multi-line selector, so the cursor sat
  inside a `selectorSpan` and was classified `selector`.
- Editor only: `packages/vscode/src/intelligence.ts` plus `tests/extension/provider.intelligence.test.ts`
  (five new tests, no existing test changed). No compiler, parser, formatter, fixture, golden,
  grammar, ADR or specification change; no completion item list added, removed or reworded.
- `@fn` (author-function namespace) is recorded as a feature item **deferred by owner decision**
  (2026-11-25) — not implemented, no language surface claimed; revisit only if Xessa adopts its own
  callables.
- Verification: `bun test` **865 pass / 0 fail across 45 files** (860 baseline + 5 new),
  `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files); extension suite 165/165,
  intelligence suite 67/67.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Bug A · pseudo colon range | `typedColons()` helper; `pseudo` case replaces the typed colon run; filter uses the text after the colons | `&:` + `:hover` → `&:hover`; `&::` + `::after` → `&::after`; `&:hov` filters to `:hover`; top-level `a:` → `a:hover` | 🟢 complete |
| Bug A · pseudo classification | colon run before the typed word ⇒ `pseudo` context (`selectorOrPseudo()`) | `&:h` / `&:hov` / `&::a` are pseudo contexts and filter the pseudo list | 🟢 complete |
| Bug B · class dot range | `selector` case starts the range after the last typed dot | `&.` + `.test` → `&.test`; `&.te` + `.test` → `&.test`; plain `.te` keeps its dot | 🟢 complete |
| Bug C · merged selector line | `findEnclosingRule` reports `nestedInRule`; a multi-line selector inside a rule body is classified from the authored current line | property items on bare-word/empty lines above `&`, `&:hover`, `&::after`, `&.test`; cursor on the `&` line stays selector/pseudo | 🟢 complete |
| Tests | five new tests (A46 describe block) | pre-fix red, post-fix green; S1–S7 and A45 tests unchanged | 🟢 complete |
| Records | task, report, `P8 · A46` row, todo items 13 (🟢 fixed) and 14 (`@fn`, ⚪ deferred by owner decision) | records persisted, `@fn` explicitly not implemented | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | New `typedColons()` (line 624) counts the colon run typed before the completion word and returns the replacement start that covers it; new `selectorOrPseudo()` (line 640) makes a colon run before the word a `pseudo` context. `findEnclosingRule` now returns `EnclosingRule` (line 758, function at 772) with `nestedInRule`. In the rule-body branch of `contextAt`, a selector span that crosses a line break inside a rule body is treated as a recovery artefact and classification falls back to the authored current line (`selectorSpansLines` guard, line 1508), reusing `selectorOrPseudo` for the `&:`/`&:h` line. `selector` case (line 1883) starts the replacement range after the last typed dot. `pseudo` case (line 1909) replaces the typed colon run via `typedColons().start` and filters on the pseudo name without its leading colons. |
| `tests/extension/provider.intelligence.test.ts` | New `accept()`/`suggestion()` helpers and a `describe("completion ranges and merged selector lines (A46)")` block with **5 tests**: pseudo colon range (`&:`, `&::`), typed pseudo prefixes (`&:hov`, `&::a`), declaration-shaped `a:`/`a::` plus top-level `a:` regression pins, class dot range (`&.`, `&.te`, plain `.te`, selector starters, top-level `none`), and the property-above-`&` shape matrix. |
| `.ai/tasks/CSSX-A46.md`, `.ai/reports/CSSX-A46.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A46` row; bug item 13 (🟢 fixed in CSSX-A46) and feature item 14 (`@fn`, ⚪ deferred by owner decision 2026-11-25; revisit only if Xessa adopts its own callables). |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan, framework record, hover, navigation, symbols or analysis file was touched.
No dependency change, no commit, push, reset or stash.

## Diagnosis and fix per bug

### Bug A — pseudo colon duplication

- Cause: `contextAt` returned `{ kind: "pseudo", word: "" }` after `&:` (the word scan stops at
  `:`), and the `pseudo` case used `replaceStart = offset - context.word.length` = `offset`, i.e. the
  replacement range started *after* the typed colon. `PSEUDOS` entries are full spellings
  (`:hover`, `::after`), so the typed colon stayed and the item added its own →
  `&:` + `:hover` = `&::hover` (`&::` + `::after` = `&:::after`, the owner's triple colon).
  A second defect in the same area: `&:h`/`&:hov` classified as `selector`, so a typed pseudo
  prefix matched no pseudo item at all.
- Fix (`intelligence.ts:624` `typedColons`, `:1909` `pseudo` case, `:640` `selectorOrPseudo`):
  the replacement range now starts at the first typed colon (skipping spaces between the colons and
  the word), `insertText` keeps its own colons (strategy: the range covers what was typed), and the
  filter word is the text after the colons, matched against `pseudo.slice(1)` / `pseudo.slice(2)`.
  A colon run directly before the typed word now makes the statement a `pseudo` context, so `&:hov`
  filters to `:hover` and applies over `:hov` → `&:hover`. The same path serves the
  `text[offset - 1] === ":"` cases, so the fix is uniform.

### Bug B — class dot removal

- Cause: `scanBackWord` includes `.` in `/[A-Za-z0-9_@$.-]/`, so after `&.` the word is `.`
  (after `&.te` it is `.te`). The `selector` case used `replaceStart = offset - context.word.length`,
  which covered the typed dot, while class items carry `label: ".test"` and `insertText: "test"` —
  accepting removed the dot (`&test`, `&.test > a` → `&test > a`).
- Fix (`intelligence.ts:1883-1890`): the range starts after the last typed dot
  (`context.word.lastIndexOf(".")`), so the dot stays in the buffer and only the typed name part is
  replaced: `&.` + `.test` → `&.test`, `&.te` + `.test` → `&.test`, plain `.te` in a rule body →
  `.test`. Items without a dot keep the previous range (`&` → starters unchanged), and a top-level
  `.te` (no rule body) still returns `none`.

### Bug C — no properties above an `&` line

- Cause: with a terminated preceding statement, the tolerant parser reads the bare-word line and
  the following `&` line as one selector (`co\n  &:hover`, `selectorSpan` covering both lines) and
  nests it as a rule. `contextAt`'s `offset >= rule.selectorSpan.start && offset <=
  rule.selectorSpan.end` test therefore matched the cursor on the `co` line and returned `selector`
  (7 selector items, zero properties). The same shape appears for `&::after`, `&.test` and bare
  `&` next lines; an empty current line was already `property` because it precedes the merged span.
- Fix (`intelligence.ts:772` `findEnclosingRule` returns `nestedInRule`; `:1508` guard): inside a
  rule body a selector span that crosses a line break is a recovery artefact, so classification
  falls back to the authored current line — bare word/empty → `property`, `property:` → `value`,
  `&…` → `selector`/`pseudo`. A selector *outside* any rule body (top level) keeps the selector
  path, so a top-level `a:`/`a::` still classifies as pseudo/selector text rather than a
  declaration. Nothing changes for a selector that ends on the cursor's line, so a cursor on the
  `&` line itself stays `selector` (and `&:` stays `pseudo`).

## Evidence

Before/after probes ran the same texts through `contextAt`/`completionsAt`; "accept" applies the
chosen item over `replaceStart…replaceEnd` exactly like the editor does.

| Bug / probe | Before (pre-fix) | After (post-fix) |
|---|---|---|
| A · `&:` accept `:hover` | `pseudo word:""`, range `""` → `&::hover` | `pseudo word:""`, range `":"` → `&:hover` |
| A · `&::` accept `::after` | range `""` → `&:::after` (owner's triple colon) | range `"::"` → `&::after` |
| A · `&:hov` | `selector word:"hov"`, 7 selector items, 0 pseudo items | `pseudo word:"hov"`, 1 item `[:hover]`, accept → `&:hover` |
| A · `&::a` | `selector word:"a"` | `pseudo word:"a"`, `[:active, ::after]`, accept `::after` → `&::after` |
| A · `a:` / `a::` in a rule body | `value property:"a"`, 53 values | unchanged (`value property:"a"`, 53 values) — A45 `width:` contract |
| A · top-level `a:` accept `:hover` | `pseudo`, range `""` → `a::hover` | `pseudo`, range `":"` → `a:hover` |
| B · `&.` accept `.test` | `selector word:"."`, range `"."` → `&test` | `selector word:"."`, range `""` → `&.test` |
| B · `&.te` accept `.test` | range `".te"` → `&test` | range `"te"` → `&.test` (`&.test > a` intact) |
| B · plain `.te` in a rule body | range `".te"` → `test` | range `"te"` → `.test` |
| B · `&` (no dot) | `selector word:""`, range `""`, starters offered | unchanged |
| B · top-level `.te` | `none` | `none` (unchanged) |
| C · `co` above `&:hover { }` | `selector word:"co"`, 0 property items | `property word:"co"`, 3 `co*` property items (`color`, …) |
| C · `co` above `&:hover { color: blue; }` | `selector`, 0 properties | `property`, 3 properties |
| C · `co` as first statement above `&…` | `selector`, 0 properties | `property`, 3 properties |
| C · `co` above `&::after { }` / `&.test { }` / `& { }` | `selector`, 0 properties | `property`, 3 properties |
| C · `co` above `&` with terminated and unterminated previous line | terminated line: `selector`; unterminated: `property` (A29 S2) | both `property` |
| C · empty line above `&:hover` | `property`, 113 items | unchanged (`property`, 113 items) |
| C · `co: ` above `&:hover` | `selector` (merged span) | `value property:"co"` |
| C · cursor on `&` / on `&:` | `selector` / `pseudo` | unchanged |

AST cause of bug C (probe, pre-fix):

```text
rule sel=".a" selSpan=0..2 span=0..39
  declaration prop=color value="red" span=7..17
  rule sel="co\n  &:hover" selSpan=21..33 span=21..37      ← cursor offset 23 sits in 21..33
```

Post-fix probe output (excerpt, `/tmp` probe over the same shapes):

```text
A &::   pseudo word:""  range=":"   items=19  accept(::after) -> "  &::after"
A &:hov pseudo word:"hov" range=":hov" items=1 accept(:hover)  -> "  &:hover"
A a: (top level) pseudo range=":" items=19 accept(:hover) -> "a:hover"
B &.    selector word:"."  range=""    items=8 accept(.test) -> "  &.test"
B &.te  selector word:".te" range="te" items=8 accept(.test) -> "  &.test"
C co above &::after property word:"co" range="co" items=3 accept(color) -> "  color: "
C cursor on &       selector word:"" items=7
C cursor on &:      pseudo word:"" range=":" items=19
```

### Tests added (`tests/extension/provider.intelligence.test.ts`, A46 describe block)

| Test | Pins |
|---|---|
| `accepting a pseudo after a typed colon replaces the colon instead of duplicating it` | `&:`+`:hover` → `&:hover`, `&::`+`::after`/`::before` → `&::after`/`&::before`, exact `replaceStart` |
| `typed pseudo prefixes filter the pseudo list and stay single-colon` | `&:hov` → `[:hover]` → `&:hover`; `&::a` → `[:active, ::after]` → `&::after` |
| `declaration-shaped a: lines and top-level a: selectors keep their context` | `a:`/`a::` in a rule body stay `value property:"a"` with no pseudo items; top-level `a:` + `:hover` → `a:hover` |
| `accepting a class after &. keeps the typed dot` | `&.`→`&.test`, `&.te`→`&.test` (`&.test > a` intact), plain `.te`→`.test`, starter range unchanged, top-level `.te` stays `none` |
| `a line directly above a & selector still completes CSS properties` | seven bare-word shapes (`&`, `&:hover` empty/filled, `&::after`, `&.test`, terminated/unterminated previous line) → `property word:"co"` + `color`; empty line → 113 items; `co: ` → `value`; cursor on `&` → `selector`, on `&:` → `pseudo`, second `&` line (`co\n  &:h`) → `pseudo word:"h"` → `[:hover]` |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 67 pass / 0 fail, 361 `expect()` calls, 1 file (was 62 before A46; +5) |
| `bun test tests/extension/` | 🟢 165 pass / 0 fail, 1098 `expect()` calls, 10 files |
| `bun test` | 🟢 865 pass / 0 fail, 789719 `expect()` calls, 45 files (10.36 s) |
| `bun run typecheck` | 🟢 exit 0 — `compiler`, `cli`, `language-service`, `vscode` projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, no fixes applied |

Pre-existing flake, reported separately: the first full `bun test` run in this task failed
`xessa watch > removes owned outputs after a watched source is deleted`
(`tests/integration/cli-watch.test.ts`, 10 055 ms against its 10 s timeout) under parallel load.
That file passes alone (3/3, 101 ms) and the immediately following full run was fully green
(865/0), so it is a timing-sensitive CLI watch test unrelated to the intelligence layer. No test
was weakened, skipped or deleted; the new tests are the five named above and S1–S7 plus the A45
tests are unchanged and green.

## Notes

- Behavioural change beyond the reported bugs: a completed selector that ends in a pseudo
  (`&:hover`, `.a:hover`) typed *up to the cursor* now classifies as `pseudo` instead of `selector`
  on single-line selector spans, because a colon run before the word is a pseudo position. The
  offered pseudo list is the same list filtered by the typed name; selector starters remain
  available one keystroke earlier (`&`) and for `.`/`#`/tag prefixes.
- `SELECTOR_STARTERS` keep their pre-A46 range: with no dot typed the range is still
  `offset - word.length`, so accepting a starter after a bare `&` inserts behind the typed `&`
  (`&&:hover`). That pre-existing behaviour is unchanged by this task and was deliberately not
  broadened into the A46 scope; only the class/dot range moved.
- A declaration-shaped line keeps the A45 contract: `a:`, `width:` and `co: ` inside a rule body
  are `value` contexts even directly above a `&` line, so a pseudo colon can never be duplicated
  there.
- A merged multi-line selector inside a rule body is treated as recovery text. Top-level
  (non-nested) selectors keep the selector path, so `a:`/`a::` at the top level still offer
  pseudos, now with the corrected range.
- `@fn` stays unimplemented: no directive, no namespace, no resolver visibility closure, no
  diagnostic, no specification/ADR text. It is recorded as todo feature item 14 (⚪ deferred by owner
  decision 2026-11-25; revisit only if Xessa adopts its own callables).

## Blockers

None.

## Handoff

- Completed: the three completion bugs are fixed in `packages/vscode/src/intelligence.ts` and pinned
  by five new tests in `tests/extension/provider.intelligence.test.ts`; `@fn` is recorded as a
  feature item deferred by owner decision (2026-11-25), not implemented.
- Verification: `bun test` 865 pass / 0 fail across 45 files, `bun run typecheck` exit 0,
  `bun run lint` exit 0. Task record `.ai/tasks/CSSX-A46.md`, this report, the `P8 · A46` row in
  `.ai/PROGRESS.md` (added in the A46 record close-out pass) and todo items 13 (🟢 fixed) and 14
  (⚪ deferred by owner decision) are written and lint-clean. No file outside the owned set was
  modified; no commit or push performed.
- Remaining steps: none for A46. A real `@fn` namespace stays deferred by owner decision; if it is
  ever revisited it needs answers on block emission vs value callables, arguments/defaults/compile-time
  evaluation, call-site syntax, styles-only visibility closure per ADR-0017 and diagnostic reuse, plus
  an ADR before any implementation.
