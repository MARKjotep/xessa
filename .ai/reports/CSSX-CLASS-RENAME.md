# CSSX-CLASS-RENAME — single-file class rename inside `.cssx`

**Status:** PASS (2026-11-26) · **Board:** feature 27 · **Scope:** editor intelligence only

## Summary

- F2 rename on a class token in a selector now updates every non-global occurrence of that class
  name in the current `.cssx` document. Only the name bytes change; the leading dot survives.
- Edits cover base selectors, `&` nesting, comma lists and `:is()`/`:not()`/`:has()` arguments.
  `:global(...)` occurrences are excluded from a normal rename and refused when selected.
- Invalid identifiers, a class name that already exists in the file and non-class tokens are
  refused. Renaming to the identical name is a pinned no-op edit set.
- JSX, the generated map and `.d.ts` are never edited: they follow the next build, so TypeScript
  catches a changed binding while literal `className="…"` strings are not caught.
- Token, group and keyframe rename behaviour is unchanged.

## Edit-set shapes

`renameClass(occurrence, newName, analysis)` collects `analysis.classes` entries whose `name`
matches the selected class and whose `global` flag is false, then replaces each name-only range.
The selector scanner already records base, `&`-nested, comma-list and functional-pseudo classes, so
`.card`, `&.card`, `.a, .card`, `:is(.card)`, `:not(.card)` and `:has(> .card)` all contribute their
own range. The dot is outside every range. Strings, declaration values, longer names (`card-active`,
`cardinal`) and `$card` tokens are never in the analysis class list.

## Refusals

- Selected occurrence is global → `Global classes inside \`:global(...)\` are not renamed.`
- New name is not an ASCII CSS identifier → `Class names must start with a letter or underscore and
  contain only letters, digits, \`_\` or \`-\`.`
- New name already exists in this document → `A class named ".<name>" already exists in this
  document.`
- Non-class cursor positions keep the existing token/group/keyframe paths; an id or pseudo name
  still falls through to `Place the cursor on a Xessa token to rename it.`
- `prepareRename` reports the class-name range (after the dot) with the authored name as the
  placeholder, including for a global occurrence (so rename then refuses with the global reason).

## Host evidence

`packages/vscode/test/ui/navigation.js` opens a temp `navigation-classes.cssx`:

```css
@setup { prefix: "ui"; }
.card { color: red; }
.badge {
  &:hover { color: blue; }
  .card { color: green; }
  &:global(.card) { color: black; }
}
.card-link { color: white; }
```

- `prepareRename` on `.card`: `{ placeholder: "card", line: 1, start: 1, end: 5 }` — the dot stays
  outside the range.
- Rename to `panel` returns one file with **2** edits; applying it changes exactly:

```css
.panel { color: red; }
  .panel { color: green; }
```

  while `&:global(.card)` and `.card-link` remain byte-identical.
- Renaming the `:global(.card)` occurrence rejects with `/Global classes/`.
- The token invalid-name, cross-module member and existing-name refusals stay intact.

## Tests and gates

- `bun test tests/extension/provider.navigation.test.ts` → **27 pass**, 137 expect calls (4 new
  class-rename tests: edit set + exact document, name range/global refusal, invalid/existing/
  non-class refusals, identical-name no-op).
- `bun test tests/extension/host.test.ts` → **14 scenarios / 905 assertions** (navigation 30,
  previously 899/24).
- `bun run verify` → **exit 0**, **1330 pass / 2 skip / 0 fail** (98 files, 68.08 s).
- `bun run release:check` → **exit 0**, **165 s**; browser **96/96**; nine examples; compiler tarball
  323 files, CLI 89; VSIX **18 files / 138.91 KB**.
- `bun run lint` → **exit 0**, 457 files in 1 s.

## Records

- `.ai/todo.md` feature 27 → 🟢.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` → `RENAME · class selectors (single file)` 🟢 row with
  actuals.
- `docs/usage.md` §5.2; `docs/known-limitations.md` §1 cross-module row and §5 rename-scope row;
  `CHANGELOG.md` `[0.1.0]` editor line.
- `.ai/tasks/CSSX-CLASS-RENAME.md`, this report.

## Handoff

**Status:** PASS. Class rename is single-file: `renameClass()`/`classAt()` in `intelligence.ts` and
the provided rename/prepare branches replace every non-global occurrence of the authored name
(base, `&`, comma, `:is()`/`:not()`/`:has()`); the dot survives. `:global(...)` is excluded and
refused when selected; invalid, existing and non-class targets are refused; identical names are a
pinned no-op edit set. Host rename applied through `WorkspaceEdit` with exact before/after text and
2 edits; global refusal asserted. Gates: verify exit 0 — 1330 pass / 2 skip / 0 fail (98 files; host
14/905); release:check exit 0 — 165 s, browser 96/96, nine examples, VSIX 18 files / 138.91 KB; lint
exit 0. Records: todo 27 🟢, plan row, docs, CHANGELOG, task/report. Cross-file/JSX class rename
remains deferred; literal class strings are outside TypeScript.
