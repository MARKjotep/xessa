# CSSX-A47 — CSS function tooltips and richer function documentation

## Summary

- The extension now documents the 25 curated CSS functions in two places from one source: hovering a
  call name (`calc`, `var`, `color-mix`, gradients, transforms, filters, …) shows
  `**calc()** — CSS function`, a one- or two-sentence usage description (what it does plus its
  argument shape) and `Example: \`calc(100% - 20px)\``, and the `value`-context completion item shows
  the same usage sentence followed by the sample call instead of the old thin
  ``CSS function, for example `…`.`` line.
- Detection is lexical and deliberately conservative: the name word under the cursor must be a known
  `CSS_FUNCTIONS` name **and** be immediately followed by `(` in the authored text. Bare keywords
  (`steps`, `brightness`), a `min` inside `min-width`, unknown names, string literals, comments and
  `url(...)` arguments never produce a function hover; the `url` name itself does, because its own `(`
  opens the call.
- Editor only: `packages/vscode/src/intelligence.ts` + `tests/extension/provider.intelligence.test.ts`
  (6 new tests, no existing test changed). No compiler, parser, formatter, fixture, golden, grammar,
  ADR or specification change; no completion item list added, removed or reworded.
- Verification: `bun test` **871 pass / 0 fail across 45 files** (865 baseline + 6 new),
  `bun run typecheck` exit 0, `bun run lint` exit 0 (422 files); extension suite 171/171, intelligence
  suite 73/73.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Data · `usage` per function | `CssFunction.usage` plus one or two sentences for all 25 `CSS_FUNCTIONS` entries; `example`/`insertText` untouched | 25/25 entries documented, no entry added or removed | 🟢 complete |
| Completion documentation | `cssFunctionDocumentation(fn)` shared by both surfaces; `value` case renders `${usage}\n\nExample: \`${example}\`` | one format for every function, old "CSS function, for example" string gone | 🟢 complete |
| Hover · function branch | `cssFunctionAt()` text check + branch in `hoverAt` after token/alias and before the declaration-property branch | name + usage + example hover; range covers only the name word | 🟢 complete |
| Hover · false positives | `(` adjacency, `enclosingString()` (strings and comments), `insideUrl()` guards | bare keyword, `min-width`, unknown name, string, comment and `url(...)` argument all return `undefined` | 🟢 complete |
| Tests | 6 tests in a new `describe("CSS function tooltips (A47)")` block | assertions match the post-fix values only (the before-probe below returned `undefined` / the old wording for every pinned case); S1–S7, A45 and A46 tests unchanged | 🟢 complete |
| Records | task, this report, `P8 · A47` row, todo item 12 extension | records persisted and lint-clean | 🟢 complete |

## Changed paths

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `CssFunction.usage` field (`:363`) with a JSDoc naming the shared contract; new `cssFunctionDocumentation()` (`:374`) returning `${usage}\n\nExample: \`${example}\``; `CSS_FUNCTIONS` (`:383`) now carries `usage` for all 25 entries (`calc`…`counter`, `example`/`insertText` unchanged); the `value` completion item uses `documentation: cssFunctionDocumentation(fn)` (`:1995`); new `cssFunctionAt()` (`:2168`) resolves the name word at the cursor and requires `text[end] === "("`, rejecting strings/comments via the existing `enclosingString()` and `url(...)` arguments via the existing `insideUrl()`; new branch in `hoverAt` (`:2278`–`:2293`, call at `:2284`) returning `` `**${name}()** — CSS function\n\n${cssFunctionDocumentation(fn)}` `` with `rangeAt(…, start, end)` over the name word only; `hoverAt` JSDoc updated. |
| `tests/extension/provider.intelligence.test.ts` | New `describe("CSS function tooltips (A47)")` block at `:920` with **6 tests** (`:953`, `:978`, `:1016`, `:1033`, `:1098`, `:1108`). |
| `.ai/tasks/CSSX-A47.md`, `.ai/reports/CSSX-A47.md` | **New.** Task prompt and this report. |
| `.ai/PROGRESS.md`, `.ai/todo.md` | `P8 · A47` row 🟢; bug item 12 extended with the function-tooltip note. |

No compiler/parser/lexer/resolver/formatter, TextMate grammar, example, fixture, golden, ADR,
`SPECIFICATION.md`, plan, framework record, navigation, symbols or analysis file was touched. No
dependency change, no commit, push, reset or stash.

## Design notes

- **One source of truth.** `cssFunctionDocumentation(fn)` builds the body once; the completion item and
  the hover render the same string, so the two surfaces cannot drift. The hover title is the only
  surface-specific part: `**calc()** — CSS function` matches the existing `**display** — CSS property`
  and `**$primary** — compile-time token` shapes.
- **Ordering.** The branch sits after group/directive/keyframe/token/media-alias handling and before
  the declaration-property branch, so it can never shadow an existing hover. It also cannot shadow the
  property branch: an enclosing declaration's property is always followed by `:`, never `(`, so a
  property word can never satisfy the `(` test. The reverse case is covered too — a CSS property that
  shares a function name (`translate`, `rotate`, `scale` are individual transform properties) keeps its
  own hover on the property word while the call word resolves to the function.
- **Cursor inside the arguments.** Deliberately restricted to the name word. Returning the same hover
  from inside the arguments would need an enclosing-call scan that ignores nested calls and strings;
  the value under the cursor (`100%`, `oklab`) is better served by leaving the position unclaimed. The
  behaviour is pinned by a test (`hoverAt(… indexOf("100%") + 1 …)` is `undefined`).
- **`url` vs `url(...)` contents.** `insideUrl(text, start)` counts parentheses from the last `url(`
  before the word, so the `url` name itself (where `lastIndexOf` lands exactly on the word start and
  the depth scan is empty) still resolves, while anything inside the argument list is rejected.
- **Lexical, not AST-based.** The check never needs the parser: the authored text around the cursor is
  the whole evidence, which keeps the branch safe for partially typed or recovery-pending documents
  (the same reason `braceDepthAt` and `keyframeReferenceFromText` are textual).

## Evidence

Probes ran the same documents through `hoverAt`/`completionsAt` before and after the change. "Before"
is the pre-change behaviour, reproduced by running the same probe against a temporary copy of
`intelligence.ts` with only the two A47 surfaces removed (the temporary file was deleted before
validation; nothing else differed). Hover output is shown as markdown plus range; ranges are
zero-based line:character.

| Probe (offset) | Before | After |
|---|---|---|
| `calc` in `width: calc(100% - 20px);` @ name start/middle/end | `undefined` | `"**calc()** — CSS function\n\nMath expression mixing units, e.g. percentages and pixels.\n\nExample: \`calc(100% - 20px)\`"` range `1:9-1:13` |
| `var(` in `color: var(--ui-color);` | `undefined` | `**var()** — CSS function` + "Reads a custom property at computed-value time. …" + `Example: \`var(--ui-color)\`` range `1:9-1:12` |
| `color-mix` in `background: color-mix(in oklab, red, blue);` | `undefined` | `**color-mix()** — CSS function` + "Mixes two colors in a color space. …" + example, range `1:14-1:23` |
| `linear-gradient` in `background: linear-gradient(to right, red, blue);` | `undefined` | `**linear-gradient()** — CSS function` + "Gradient along a straight line. …" + example, range `1:14-1:29` |
| `cubic-bezier` in `animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);` | `undefined` | `**cubic-bezier()** — CSS function` + "Custom easing curve. …" + example, range `1:29-1:41` |
| `steps` in `animation-timing-function: steps;` (no `(`) | `undefined` | `undefined` |
| `brightness` in `filter: brightness;` (no `(`) | `undefined` | `undefined` |
| `min` in `@media (min-width: 768px)` | `undefined` | `undefined` |
| `foo(` in `width: foo(1px);` (unknown name) | `undefined` | `undefined` |
| `calc` inside `content: "calc(100% - 20px)";` | `undefined` | `undefined` |
| `calc` inside `/* calc(100% - 20px) */` | `undefined` | `undefined` |
| `steps` inside `url("./steps(4).svg")` | `undefined` | `undefined` |
| `url` name in `url("./icon.svg")` | `undefined` | `**url()** — CSS function` + example, range `1:14-1:17` |
| `100%` argument of `calc(100% - 20px)` | `undefined` | `undefined` (name word only) |
| `filter` property word in `filter: blur(4px)` | `**filter** — CSS property` | `**filter** — CSS property` (unchanged) |
| `blur(` call word in `filter: blur(4px)` | `undefined` | `**blur()** — CSS function` + `Example: \`blur(4px)\`` range `1:19-1:23` |
| completion `calc(` documentation, `width: ` value context | ``CSS function, for example `calc(100% - 20px)`.`` | ``Math expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)` `` |
| completion `var(` documentation | ``CSS function, for example `var(--ui-color)`.`` | usage sentence + ``Example: `var(--ui-color)` `` |
| 25 curated completion items matching `/^[^\n]+\n\nExample: `.+`$/` | 0/25 (old wording) | **25/25** |
| 25-function hover matrix (name title + own example in `width: <example>`) | 0/25 | **25/25**, 25 distinct usage sentences |

Probe transcript excerpt (post-fix, temporary baseline copy removed afterwards):

```text
calc name @15
  before: undefined
  after : "**calc()** — CSS function\n\nMath expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)`" range=1:9-1:13
calc argument 100% @20
  before: undefined
  after : undefined
steps bare keyword @36         before: undefined   after: undefined
inside string @18              before: undefined   after: undefined
inside comment @11             before: undefined   after: undefined
media min-width @9             before: undefined   after: undefined
url argument text @27          before: undefined   after: undefined
url name @20                   before: undefined   after: "**url()** — CSS function\n\n…" range=1:14-1:17
translate call word @20        before: undefined   after: "**translate()** — CSS function\n\n…" range=1:13-1:22

value-context functions: 25
  before calc($: "CSS function, for example `calc(100% - 20px)`."
  after  calc($: "Math expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)`"
  items not matching the one-line usage + blank line + Example format: 0
hover matrix: 25/25 functions hover with title + example
```

### Tests added (`tests/extension/provider.intelligence.test.ts`, A47 describe block)

| Test | Pins |
|---|---|
| `hovering calc shows the usage, the example and the name-only range` | exact markdown for `calc(100% - 20px)`, range `1:9-1:13` from the name start, middle and end; `100%` argument stays `undefined` |
| `representative functions hover with their own usage sentence` | `var`, `color-mix`, `linear-gradient`, `cubic-bezier`: title line, usage sentence, trailing example |
| `every curated function hovers with a title, a unique usage and its example` | 25-function matrix; title `**<name>()** — CSS function`, own example, 25 distinct usage sentences, 25 entries |
| `non-call words, strings, comments and arguments never show a function hover` | bare `steps`, bare `brightness`, `min-width`, unknown `foo(`, string literal, comment, `url(...)` argument → `undefined`; the `url` name still hovers |
| `a property word and a function call word in the same declaration keep their own hovers` | `filter:` → property hover, `blur(` → function hover with example |
| `function completion documentation is the usage sentence plus the sample call` | item order equals the curated list, exact `calc(` documentation, every item matches `/^[^\n]+\n\nExample: `.+`$/` and ends with its example, no "CSS function, for example" text, 25 unique documentation bodies |

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 🟢 73 pass / 0 fail, 546 `expect()` calls, 1 file (was 67 before A47; +6) |
| `bun test tests/extension/` | 🟢 171 pass / 0 fail, 1283 `expect()` calls, 10 files (was 165) |
| `bun test` | 🟢 871 pass / 0 fail, 789904 `expect()` calls, 45 files (10.19 s) (was 865) |
| `bun run typecheck` | 🟢 exit 0 — `compiler`, `cli`, `language-service`, `vscode` projects, no output |
| `bun run lint` | 🟢 exit 0 — `biome check .`, 422 files, no fixes applied |

No pre-existing failure was observed in this task; the A46 CLI-watch timing flake did not recur. No test
was weakened, skipped or deleted.

## Notes

- The usage strings are authored data, not a doc projection: the full css-languageservice projection is
  still not embedded (A13 report), so each sentence is written to be accurate for the syntax the
  sample call shows (space- vs comma-separated channels, optional alpha after a slash, `in <space>`
  for `color-mix`, control-point constraints for `cubic-bezier`).
- `blur(0)` is documented as valid ("`0` leaves the element sharp"); no `min()`/`clamp()`-style
  argument-count diagnostics were added — values stay raw CSS (SPECIFICATION.md §3.3).
- Known limitation, deliberate: vendor-prefixed spelling (`-webkit-calc(`) scans as one word and is not
  a curated name, so it keeps no function hover. Xessa values are raw CSS, so a prefixed call still
  compiles; only the tooltip is missing.

## Blockers

None.

## Handoff

- Completed: `CssFunction.usage` for all 25 curated functions, one shared documentation helper, the
  `value` completion documentation switch and the `hoverAt` function branch with its guards; 6 new
  tests in `tests/extension/provider.intelligence.test.ts`.
- Verification: `bun test` 871 pass / 0 fail across 45 files, `bun run typecheck` exit 0,
  `bun run lint` exit 0 (422 files). Task record `.ai/tasks/CSSX-A47.md`, this report, the `P8 · A47`
  row in `.ai/PROGRESS.md` and the todo item 12 extension are written and lint-clean. No file outside
  the owned set was modified; no commit or push performed.
- Remaining steps: none for A47. Natural follow-ups, not started and not scoped: extending the tooltip
  coverage to functions outside the curated 25 (a generated MDN projection would replace the authored
  sentences), vendor-prefixed spellings, and hover-from-inside-arguments if the enclosing-call scan is
  ever wanted.
