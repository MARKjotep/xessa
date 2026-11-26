# CSSX-A29 — Report: property completion after line breaks + built-in CSS property hover docs

## Summary

- Fixed the completion context: after an unterminated declaration, a new line whose content is only
  an optional bare `[A-Za-z-]` word now classifies as `property`, so `dis` suggests `display` again
  even when the next line holds a nested `&` rule. Wrapped values (trailing comma, digits, quotes,
  punctuation, or no value before the line break) still classify as `value`.
- Added `packages/vscode/src/property-docs.ts` with one accurate sentence for all **107** supported
  properties plus `propertyDoc(name)`, and wired it into hover for declaration property names and
  into the documentation of `property` completion items.
- Verification: typecheck clean, Biome clean, extension suite 22/22, full `bun run verify` green at
  **681 pass / 0 fail across 41 files** (baseline 679 + 2 net-new tests).

## Status

🟢 Complete.

## Behaviour probes (S1–S7, observed after the fix)

| Case | Source | Context | Notes |
|---|---|---|---|
| S1 | `.card {\n  color: red\n  dis\|` | `{"kind":"property","word":"dis"}` | `display` suggested; was `value` |
| S2 | S1 plus following `  &:hover { color: blue; }` | `{"kind":"property","word":"dis"}` | `display` suggested; was `value` |
| S3 | empty line after unterminated decl | `{"kind":"property","word":""}` | unchanged |
| S4 | nested `&:hover` body after unterminated decl | `{"kind":"property","word":""}` | unchanged |
| S6 | `box-shadow: …,` wrapped continuation | `{"kind":"value","property":"box-shadow"}` | unchanged (digits/commas on the current line) |
| S7 | `display:` then `  fl\|` | `{"kind":"value","property":"display","word":"fl"}` | unchanged (`flex` still suggested) |

Cause (confirmed by probe before the fix): ADR-0011 recovery (`findSemicolonlessRuleStart`,
XESSA1002) keeps `color: red\n  dis` as one declaration span; the `findEnclosingDeclaration` branch
saw a colon before the offset and returned `value`. The fix only reclassifies the specific
line-break shape; the `findEnclosingDeclaration` branch is otherwise untouched.

## Hover and completion documentation

- Hover probe over all 107 doc keys (`.a { <prop>: red; }`) returned a `**<prop>** — CSS property`
  hover for **107/107**.
- Hover is `undefined` for the value `flex` in `display: flex`, for the misspelling `colorr`, and
  for `min-width` inside `@media (min-width: 768px)` (native at-rule, no enclosing declaration).
- Unterminated declaration property (`color` in `.card {\n  color: red\n}`) hovers correctly.
- `display` hover markdown:

  ```text
  **display** — CSS property

  Chooses the element's outer and inner display type (`block`, `flex`, `grid`, `none`, …).
  Common values: `block`, `flex`, `grid`, `inline`, `inline-block`, `inline-flex`, `none`
  ```

- Completion property items keep `detail: "CSS property"` and `insertText: "display: "` and now
  carry the same one-sentence documentation (asserted in tests).
- Stale deferral comments updated in `hoverAt`'s docblock and `providers/hover.ts` header (built-in
  one-sentence docs provided; full css-languageservice still not embedded).

## Files changed

| File | Change |
|---|---|
| `packages/vscode/src/intelligence.ts` | `contextAt` line-break reclassification with ADR-0011 comment; property hover between alias and class detection; `documentation` on property completion items; docblock refresh. |
| `packages/vscode/src/property-docs.ts` | New pure module: `CSS_PROPERTY_DOCS` (107 entries) + `propertyDoc()` with concise JSDoc. |
| `packages/vscode/src/providers/hover.ts` | Header/class comments no longer claim property docs are deferred. |
| `tests/extension/provider.intelligence.test.ts` | Replaced the deferred-hover test with definition/value/misspelling/unterminated hover cases; added S1/S2/S7/S6 completion test and property-documentation test. |
| `.ai/tasks/CSSX-A29.md`, `.ai/reports/CSSX-A29.md` | Task prompt and this report. |
| `.ai/todo.md` | Bug report 9 and feature request 10, both 🟢 done in CSSX-A29. |
| `.ai/PROGRESS.md` | `P8 · A29` row, 🟢. |

No other source, fixture, golden, config or example file was touched. `examples/basic/src/button.cssx`
(the owner's uncommitted edit) was left as-is. No commit or push.

## Validation evidence

```text
$ bun run typecheck
(tsc, 4 projects — no output, exit 0)

$ bun run lint
Checked 385 files in 216ms. No fixes applied.

$ bun test tests/extension/provider.intelligence.test.ts
 22 pass
 0 fail
 112 expect() calls
Ran 22 tests across 1 file.

$ bun run verify
 681 pass
 0 fail
 788514 expect() calls
Ran 681 tests across 41 files. [16.47s]
```

Extension-host suite inside `verify` also passed (activation, grammar, 6 commands, format-on-save,
1 diagnostic, completion 11 items, compile+preview commands). Counts: **681/41** (baseline 679/41
plus the two net-new intelligence tests; the obsolete deferral test was replaced, not kept).

## Framework records

Not applicable: this is a Xessa app/editor bug and feature, and no third-party framework
(`Rossa`, `Yvee`, `Shweet`) API or dependency is involved, so no `.ai/framework/` record was
created and no framework version applies.

## Blockers

None.

## Handoff

- All six work items are implemented and verified; S1–S7 behave as specified.
- Known limitation by design of the approved rule: a wrapped value line that consists of a single
  bare word (e.g. `font-family: Arial,\n  sans-serif`) classifies as `property`. The approved
  detector only keeps comma/digit/quote/punctuation continuations as `value`; revisit if the owner
  wants comma-aware continuation detection.
