# CSSX-A45 — editor completion bugfixes (five bugs + two additions)

## Summary

- Fixed five completion-context bugs in the extension: `@setup` lost key completion once a setting
  was complete, `@keyframes` bodies offered nothing at statement or frame-body positions, no values
  came right after `property:`, typing `&` did not reopen completions, and six animation longhands
  were missing from the property list.
- Added the two items from the same evaluation: a curated CSS function list in `value` context
  (keyword values first, functions after them, `var(` inserting `var(--`) and the built-in
  `$keyframes.` namespace item in `$` token completion.
- Only behavioural side effect: rules nested inside `@media`/`@supports` now get rule-body completion
  (property/value/selector) instead of `none`, because the enclosing-rule search traverses native
  at-rule blocks so that `@keyframes` frame blocks behave like rule bodies.
- The `@fn` namespace idea was evaluated and **deferred**: editor-only discovery ships in v0.1; a real
  namespace is only worth it if Xessa adopts its own callables later. Editor-only change — no
  compiler, parser, formatter, fixture, golden, grammar, ADR or specification edit.
- Verification: `bun test` **860 pass / 0 fail across 45 files**, `bun run typecheck` exit 0,
  `bun run lint` exit 0 (422 files); extension suite 160/160, intelligence suite 62/62.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| `@setup` boundary | statement-boundary colon check in the setup branch | fresh line after `prefix: "ui";` completes keys; second setting still completes booleans | 🟢 complete |
| `@keyframes` bodies | `blockMembers` traversal, `findEnclosingNativeAtRule`, `keyframe-selector` context, frame-selector list | body line completes frames; frame block completes property then value; `@` inside stays directive | 🟢 complete |
| Value after colon | current-line `property:` classification inside an enclosing rule | `width: `, `width: `+newline and `width:` are values; `wid` stays property; `&:hover` stays selector | 🟢 complete |
| `&` trigger | controller trigger-character list | registration contains `@ $ . : / &` | 🟢 complete |
| Animation longhands | +6 `CSS_PROPERTIES` entries and docs | all eight `animation*` names offered with `detail: CSS property` and documentation | 🟢 complete |
| CSS functions | `CSS_FUNCTIONS` in the `value` case | values sort `0-`, functions `1-`, docs show an example, `var(` inserts `var(--`, typed filter works | 🟢 complete |
| `$keyframes.` item | `token` case push | offered beside imported aliases and filtered by the typed word | 🟢 complete |
| Tests and verification | one test per fix/addition | targeted suites green, full `bun test` 860/45, typecheck + lint exit 0 | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | Setup branch takes `max(lastIndexOf(";"), lastIndexOf("{"))` as the statement boundary and returns `setup-value` only for a colon after it. New `blockMembers()` helper feeds `findEnclosingRule`/`findEnclosingDeclaration`, so native at-rule `block` members are traversed and a `@keyframes` frame block is an ordinary rule body; new `findEnclosingNativeAtRule()`. New context kind `keyframe-selector` plus `KEYFRAME_FRAME_SELECTORS` (`from`, `to`, `0%`, `25%`, `50%`, `75%`, `100%`) and the `%`-aware `frameSelectorWord()` so the replacement range covers `50%`; the branch requires the at-rule name `keyframes` and `braceDepthAt(text, offset) > braceDepthAt(text, atRule.span.start)` so the closing `}` stays out and non-keyframes blocks never offer frames. New `currentLineStatement()` (statement bounded to the current line, so ADR-0011 multi-line statements are not misread) and the `^\s*([A-Za-z-]+)\s*:(\s.*)?$` check that classifies a `property:` statement as `value` even when the AST dropped the declaration. New `CssFunction`/`CSS_FUNCTIONS` (25 entries) consumed by the `value` case; `token` case pushes `$keyframes.`; six animation longhands added to `CSS_PROPERTIES`; `keyframe-selector` completion case. |
| `packages/vscode/src/controller.ts` | `"&"` added to the completion trigger characters (`@`, `$`, `.`, `:`, `/`, `&`). |
| `packages/vscode/src/providers/completion.ts` | Header comment now names `&` and explains that nested-selector starters are not word characters. |
| `packages/vscode/src/property-docs.ts` | Six new one-sentence entries: `animation-direction`, `animation-fill-mode`, `animation-iteration-count`, `animation-name`, `animation-play-state`, `animation-timing-function` (107 → 113 docs, covering every completion property). |
| `tests/extension/provider.intelligence.test.ts` | **+11 tests** for the five bugs and two additions (details below). Existing contexts unchanged. |
| `.ai/tasks/CSSX-A45.md`, `.ai/reports/CSSX-A45.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A45` row; bug report 12. |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan, hover (beyond the shared docs data), navigation, symbols or analysis file
was touched. No dependency or framework record is involved (Xessa editor work). No commit or push.

## Per-fix evidence

Every case below is a test in `tests/extension/provider.intelligence.test.ts` (pure intelligence
layer, no `vscode` import).

| Bug | Test | Pinned behaviour |
|---|---|---|
| 1 · `@setup` statement boundary | `@setup keeps completing keys after a completed setting` | `@setup { prefix: "ui"; \|` is `{kind: "setup-key", word: ""}` with all `SETUP_KEYS` (was `setup-value` with no items, because the finished line's colon was the nearest one); `emit-css: ` still yields `["true", "false"]`. |
| 2 · `@keyframes` body frames | `a fresh line inside an @keyframes body completes frame selectors` | `@keyframes spin { \|` is `{kind: "keyframe-selector", word: ""}` and lists `from`, `to`, `0%`, `25%`, `50%`, `75%`, `100%`; percentage items insert their `%`; `from`/`to` carry documentation. |
| 2 · frame prefix + range | `the typed keyframe frame prefix filters frame selectors` | `fr` is `keyframe-selector` with `word: "fr"` → `["from"]`; `50%` keeps `word: "50%"` and `offset - replaceStart === "50%".length`. |
| 2 · frame body = rule body | `a keyframe frame block behaves like a rule body` | `from { \|` is `property` with `opacity` suggested; `opacity: \|` is `{kind: "value", property: "opacity"}` containing `inherit` and `blur(`. |
| 2 · no over-reach | `directives inside an @keyframes body and other native at-rules are unchanged` | `@keyframes spin { @\|` stays `{kind: "directive", inSelector: true}` with `@media`; a bare line in `@media (min-width: 10px) { }` gains no `from`/`50%` candidates. |
| 3 · value after colon | `value completion starts as soon as the property colon is typed` | `.button {\n  width: ` (unterminated), the same with a following line, and `.button {\n  width:` all return `{kind: "value", property: "width", word: ""}` with non-empty value items containing `auto`; `.button {\n  wid` still returns `{kind: "property", word: "wid"}`. |
| 4 · `&` trigger | `the completion provider registers & as a trigger character` | reads `packages/vscode/src/controller.ts` and asserts the registration block contains `"@"`, `"$"`, `"."`, `":"`, `"/"`, `"&"`. Nesting context itself is covered by the selector case of `property, value, selector and pseudo contexts are distinguished` (`&` → `selector`, `&:hover` suggested). |
| 5 · animation longhands | `animation longhands complete with documentation` | `animation-` offers all eight names (`animation-delay`, `-direction`, `-duration`, `-fill-mode`, `-iteration-count`, `-name`, `-play-state`, `-timing-function`), each with `detail: "CSS property"` and non-empty documentation. |
| Add. 1 · CSS functions | `value context offers CSS functions after the keyword values` | `calc(` is `kind: "value"`, `detail: "CSS function"`, `insertText: "calc("`, documentation contains `calc(100% - 20px)`, sortText prefixed `1-`; `color-mix(` documents `color-mix(in oklab, red, blue)`; `var(` inserts `var(--`; `auto` keeps sortText `0-auto`; the first `CSS function` detail precedes the last `CSS value`. |
| Add. 1 · filtering | `CSS functions filter by the typed word and ignore the property` | `ca` → `["calc("]`, `col` → `["color-mix("]`, and `padding: @md ca` (behind a variant modifier segment) → `["calc("]`. |
| Add. 2 · `$keyframes.` | `$ completion offers the built-in keyframes namespace beside imported aliases` | `$` in a declaration value is `{kind: "token", word: ""}` and includes `$keyframes.` with `detail: "built-in keyframe namespace"`, `insertText: "$keyframes."` and documentation containing `$keyframes.<name>`; `$key` filters to `["$keyframes."]`. |

Observed probe output (same code path, ad-hoc run during this task):

```text
rule in @media: {"kind":"property","word":""} items=113
keyframes frame body: {"kind":"property","word":""} items=113
@keyframes body: {"kind":"keyframe-selector","word":""} items=7 first=["from","to","0%","25%","50%","75%"]
setup after setting: {"kind":"setup-key","word":""} items=12
value right after colon: {"kind":"value","property":"width","word":""} items=53
$ empty: {"kind":"token","word":""} items=1 first=["$keyframes."]
```

## Notes

### Behavioural side effect (rules nested in `@media`/`@supports`)

`findEnclosingRule` and `findEnclosingDeclaration` now descend into any node's `block` members (the
`@keyframes` frame blocks live there, not in `body`). Native at-rule blocks therefore resolve to their
nested style rules, so a statement inside `.card { | }` nested in `@media (min-width: 10px) { … }` or
`@supports (display: grid) { … }` is now `{kind: "property"}` (113/113 property items) instead of
`none`. That matches CSS nesting semantics and needs no compiler change; it is the only result change
outside the five reported bugs, and it is recorded here rather than silently shipped. A bare statement
directly inside a non-keyframes native block (no rule around it) still completes nothing.

### `var(` absorbs the `var(--…)` item

CSS functions are one item each; `var` is the entry whose `insertText` is `var(--`, so a single
`var(` suggestion both names the function and prefills the custom-property reference. There is no
second `var(--…)` duplicate, and keyword values stay ahead of the whole function block (`0-` vs `1-`
sort prefixes). The list is a hint, not a constraint: authored values are raw CSS slices the compiler
never rewrites, so any function an engine accepts still compiles.

### Deferred: `@fn` namespace

The evaluation considered an `@fn` directive/namespace for author-defined functions (definition,
import visibility, references such as `@fn.name`). It is **deferred and editor-only for v0.1**:

- functions already work as raw CSS, so a namespace buys discoverability only and adds a compile-time
  construct plus a resolver visibility closure, XESSA2001 paths and cross-module rules that no owner
  decision or ADR authorises;
- a real namespace is worth revisiting only if Xessa adopts its own callables (arguments, defaults,
  compile-time evaluation), which is a language decision requiring an ADR;
- the curated `CSS_FUNCTIONS` list addresses the discovery need now, with zero language surface.

No code, specification text, ADR, plan or todo item claims otherwise.

## Verification

| Command | Outcome |
|---|---|
| `bun test` | 🟢 exit 0 — **860 pass / 0 fail**, 789668 `expect()` calls, 45 files (10.95 s) |
| `bun run typecheck` | 🟢 exit 0 — 4 projects (`compiler`, `cli`, `language-service`, `vscode`), no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, no fixes applied |
| `bun test tests/extension/` | 🟢 160 pass / 0 fail across 10 files |
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 62 pass / 0 fail, 310 `expect()` calls |

No test was weakened, skipped or deleted; the new tests are the eleven named in the evidence table.

## Accuracy notes

- `@keyframes` frame selectors are offered only for the `keyframes` at-rule and only inside its
  braces (`braceDepthAt` guard), so `@media`/`@supports`/`@layer` bodies keep their existing results
  and the closing `}` of a keyframes block is not a frame position.
- Frame-body completion is not a special case in the code: the frame block parses as an ordinary
  `rule` nested in the at-rule's `block`, so it inherits the property/value/selector behaviour of any
  rule body.
- The `@setup` fix changes classification only; the setup-key and setup-value item lists themselves
  are unchanged.
- `providers/completion.ts` and `controller.ts` changes are the trigger list and its comment; item
  construction and the replacement range are untouched.
- `property-docs.ts` gained six entries; the pre-existing 107 strings are unchanged, so A29's hover
  behaviour is untouched and completion documentation and hover still share one source.

## Blockers

None.

## Handoff

- Completed: all five completion bugs and both additions are implemented and covered by tests in
  `tests/extension/provider.intelligence.test.ts`; the `@fn` namespace is documented as deferred
  (editor-only for v0.1). Task record `.ai/tasks/CSSX-A45.md`, this report, the `P8 · A45` row in
  `.ai/PROGRESS.md` and bug report 12 in `.ai/todo.md` are written.
- Verification: `bun test` 860 pass / 0 fail across 45 files, `bun run typecheck` exit 0,
  `bun run lint` exit 0. No source, test or record file outside the table above was modified; no
  commit or push performed.
- Remaining steps: none for A45. A real `@fn` namespace needs an owner decision and an ADR before any
  implementation, and string/nested keyframe or multi-name `animation-name` rewrite behaviour stays
  as decided in ADR-0015/ADR-0018.
