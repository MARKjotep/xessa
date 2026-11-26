# CSSX-ID-COMPLETE — Selector `#` id completion

**Status:** PASS (2026-11-26) · **Board:** feature 26 · **Scope:** editor intelligence only

## Summary

- Added document id-selector collection beside the class analysis: every `#name` in selector
  position, deduped by name (first appearance wins), recorded as `{ name, range }` with a name-only
  range.
- Selector `#` now offers one `selector` item per id: label `#name`, detail `id selector`, adapter
  kind `CompletionItemKind.Class`, first-appearance order. Accepting replaces the typed `#…` word
  range, so `#pan` + `#panel` yields `#panel`, never `##panel`; `#pan` narrows correctly.
- Collection covers base selectors, `&` nesting, comma lists and `:is()`/`:not()`/`:has()`
  arguments, and includes `:global(#x)`. String, selector-comment, attribute-value and
  declaration-value `#` runs are excluded.
- Both no-leak directions are pinned: a value `#` on a colour property remains the colour/hex state;
  a selector `#` offers no colours, classes, starters or directives.
- Ids stay document-global and byte-for-byte: no cross-file suggestions, no rename, no map or
  `.d.ts` change.

## Collected / offered shapes

- Collection: `collectIdSelectors(analysis): readonly IdOccurrence[]`, where
  `IdOccurrence = { name, range }` and `range` covers the name text after `#`.
- Suggestion: `{ label: "#name", kind: "selector", detail: "id selector", insertText: "#name",
  replaceStart: <typed #>, sortText: undefined }`.
- The scanner is `scanSelectorIds()` in `intelligence.ts`; `hashPrefixStart()` is shared with the
  existing colour `#` state.

## No-leak evidence

- Selector `#`: 3 intelligence cases assert no `color` kind, no `CSS color` detail, no `.`/`&`
  labels and no `@` labels; host row asserts no `Class` colour items and no starters/classes.
- Value `color: #`: still 183 items, all `kind: "color"`, no `id selector` detail and no `#panel`;
  host row repeats colours-only and no ids.
- Existing class, `&` and pseudo tests are untouched and pass.

## Tests and gates

- `bun test tests/extension/provider.intelligence.test.ts` → **108 pass**, 3742 expect calls.
- `bun run verify` → **exit 0**, **1326 pass / 2 skip / 0 fail** (98 files, 67.0 s); host **14
  scenarios / 899 assertions** (completions 158).
- `bun run release:check` → **exit 0**, **165.0 s**; browser **96/96**; nine examples; VSIX **18 files
  / 138.75 KB**; compiler tarball 323 files, CLI 89.
- `bun run lint` → **exit 0**, 457 files in 0.31 s.

## Records

- `.ai/todo.md` feature 26 → 🟢.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` → `IDS · selector completion` 🟢 row with actuals.
- `docs/usage.md` §5.1/§5.2, `packages/vscode/README.md`, `CHANGELOG.md` `[0.1.0]`.
- `.ai/tasks/CSSX-ID-COMPLETE.md`, this report.

## Handoff

**Status:** PASS. Selector `#` offers `#name` `selector` items (Class, detail `id selector`) from
this document's ids in first-appearance order; typing `#pan` narrows and accepting replaces the typed
range, leaving one `#`. Collection uses `collectIdSelectors()`/`scanSelectorIds()`: base, `&`, comma,
`:is()`/`:not()`/`:has()`, `:global(#x)`; strings, selector comments, attribute values and
declarations excluded. Pinned no-leak: value `color: #` stays colours only; selector `#` offers no
colours/classes/starters/directives. Host assertion green. Gates: verify exit 0 — 1326 pass / 2 skip /
0 fail (98 files; host 14/899); release:check exit 0 — 165.0 s, browser 96/96, nine examples, VSIX
18 files / 138.75 KB; lint exit 0. Records: todo 26 🟢, plan row, CHANGELOG, task/report. The
class-rename task inherits `IdOccurrence` name-only ranges and the collector; ids are currently never
renamed or mapped.
