# CSSX-ID-RENAME — single-file id rename inside `.cssx`

**Status:** PASS (2026-11-26) · **Board:** feature 28 · **Scope:** editor intelligence only
**Gate note:** task scope, host, browser and lint are green. `bun run verify` and
`bun run release:check` are blocked by one **pre-existing, unrelated** failure in the untracked
`examples/portfolio` (`$space.gutter` read vs authored `gutters`); see **Gates**.

## Summary

- F2 rename on an id token in a selector now updates every occurrence of that id name in the
  current `.cssx` document. Only the name bytes change; the leading `#` survives.
- Edits cover base selectors, `&` nesting, comma lists, `:is()`/`:not()`/`:has()` arguments and
  `:global(#x)` — ids have no local/global split, so global occurrences are part of a normal rename.
- Invalid identifiers, an id name that already exists in the file and non-id tokens are refused.
  Renaming to the identical name is a pinned no-op edit set.
- JSX/HTML `id="…"` anchors, inbound links, the generated map and `.d.ts` are never edited, and ids
  are not in the map.
- Class, token, group and keyframe rename behaviour is unchanged; id completion still offers one
  item per distinct name in first-appearance order.

## Edit-set shapes

`collectIdOccurrences(analysis)` walks every rule selector the same way the class collector does
(nested rules, conditional blocks and native at-rule blocks included) and returns one entry per
authored id token. `renameId(occurrence, newName, analysis)` filters that list by the selected
name and replaces each name-only range; the `#` is outside every range.

`scanSelectorIds()` already treats quoted text, escapes, selector comments and attribute contents
as inert, and records every selector position: `#panel`, `#panel, .x #inner`, `&#panel`,
`:is(#panel)`, `:not(#panel)`, `:has(> #panel)` and `:global(#panel)`. Declaration values
(`content: "#panel"`), attribute values (`[data-id="#panel"]`), longer names (`#panel-header`) and
the same-named `.panel` class are never in the id list.

`collectIdSelectors()` remains the deduping facade used by completion.

## Refusals

- New name is not an ASCII CSS identifier → "Id names must start with a letter or underscore and
  contain only letters, digits, `_` or `-`."
- New name already exists in this document → `An id named "#<name>" already exists in this
  document.`
- Non-id cursor positions keep the existing token/class/group/keyframe paths; a string, attribute
  value or pseudo name falls through to `Place the cursor on a Xessa token to rename it.`
- `prepareRename` reports the id-name range (after the `#`) with the authored name as the
  placeholder.

## Host evidence

`packages/vscode/test/ui/navigation.js` opens a temp `navigation-ids.cssx`:

```css
@setup { prefix: "ui"; }
#panel { color: red; }
#panel .card { color: blue; }
.card #panel:not(#panel-header) { color: green; }
:global(#panel) .x { color: black; }
.panel { color: white; }
[data-id="#panel"] { color: grey; }
```

- `prepareRename` on `#panel`: `{ placeholder: "panel", line: 1, start: 1, end: 6 }` — the `#`
  stays outside the range.
- Renaming to `panel-header` rejects with `/An id named "#panel-header" already exists/` and leaves
  the document byte-identical.
- Rename to `main` returns one file with **4** edits; applying it changes exactly:

```css
#main { color: red; }
#main .card { color: blue; }
.card #main:not(#panel-header) { color: green; }
:global(#main) .x { color: black; }
```

  while `.panel` and `[data-id="#panel"]` remain byte-identical and every `#` survives.

## Tests and gates

- Failing repro first: `bun test tests/extension/provider.navigation.test.ts` failed with
  `Export named 'collectIdOccurrences' not found` before the implementation.
- `bun test tests/extension/provider.navigation.test.ts` → **32 pass**, 171 expect calls (4 new
  id-rename tests: full edit set + exact document, name range + completion unchanged,
  invalid/existing/non-id refusals, identical-name no-op). The old id "not a class" pin now asserts
  that ids dispatch to their own rename.
- `bun test tests/extension/host.test.ts` → **14 scenarios / 912 assertions** (navigation 37,
  previously 30).
- `bun run test:browser` → **exit 0**, **96/96** (1.6 min).
- `bun run lint` → **exit 0**, 449 files in 236 ms.
- `bun run verify` → **exit 1**: **1344 pass / 2 skip / 1 fail** (99 files, 68.84 s). The only
  failure is `configuration validation > config-less examples discover from their own package.json
  boundary`: the untracked `examples/portfolio/src/tokens.cssx` authors `gutters: 20px`, while
  `examples/portfolio/src/layout.cssx` reads `$space.gutter`, so the example `check` exits 1.
  Compiler, CLI, map generation and this task do not touch that file.
- `bun run release:check` → **exit 1** at the same `verify` step (65.56 s of tests, then the script
  stops), so the later browser/build/package segments were run separately: browser **96/96** green.

## Records

- `.ai/todo.md` feature 28 → 🟢.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` → `RENAME · id selectors (single file)` 🟢 row with
  actuals and the pre-existing gate note.
- `docs/usage.md` §5.2; `docs/known-limitations.md` §1 cross-module row and §5 rename-scope row;
  `CHANGELOG.md` `[0.1.0]` editor line.
- `.ai/tasks/CSSX-ID-RENAME.md`, this report.

## Handoff

**Status:** PASS for task scope; **BLOCKED** for a fully green repo gate by a pre-existing untracked
example. Id rename is single-file: `collectIdOccurrences()`, `idAt()` and `renameId()` in
`intelligence.ts`, with the id branch in `renameAt()` and provider `prepareRename`. Every id
occurrence is edited — base, `&`, comma, `:is()`/`:not()`/`:has()` and `:global(#x)` — and the `#`
survives. Invalid, existing and non-id targets are refused; identical names are a pinned no-op.
Host rename applied through `WorkspaceEdit` with exact before/after text and 4 edits; existing-id
refusal asserted; same-named class and attribute value untouched. Gates: targeted 32 pass; host
14 scenarios / 912 assertions (navigation 37); browser 96/96; lint exit 0 (458 files); `verify`
exit 1 — 1344 pass / 2 skip / 1 fail, the sole failure being the untracked
`examples/portfolio` `$space.gutter` vs `gutters` mismatch; `release:check` exits at that same
`verify` step. Records: todo 28 🟢, plan row, docs, CHANGELOG, task/report. Cross-file/JSX id rename
remains deferred; ids are not mapped.
