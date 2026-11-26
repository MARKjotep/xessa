# CSSX-ATTR-TESTS — attribute-selector coverage

**Status:** PASS (2026-11-26) · **Scope:** pre-release coverage only, no compiler behaviour change

## Summary

- Added the missing attribute-selector coverage before the release: the full operator/flag/namespace
  matrix in compiler tests, one attribute-driven declaration proven in real browsers,
  rename/completion isolation pins, and a compatibility-matrix row.
- Additive coverage only. No compiler behaviour change was needed; the matrix passed unchanged, so
  no source file under `packages/**/src` was touched.
- Local classes outside brackets rename as usual; attribute names, operators, values and flags are
  never rewritten, never enter the class map and never supply ids.
- Gates green: `verify` 1341 pass / 2 skip / 0 fail, `release:check` exit 0 (166.23 s), `lint` exit 0.

## Compiler matrix inventory

New `tests/compiler/attribute-selectors.test.ts` (7 tests) pins, for each selector below, both pretty
and minified emission of `.card<selector>` with prefix `ui`, and the class table:

- `[attr]`
- `[attr="v"]` and `[attr='v']`
- unquoted `[attr=v]`
- `[attr~="v"]`
- `[attr|="v"]`
- `[attr^="v"]`
- `[attr$="v"]`
- `[attr*="v"]`
- case flags `[attr="v" i]` and `[attr="v" s]`
- namespaced `[ns|attr]`
- whitespace variants `[ ns | attr = "v" ]` and `[data-x = "v"  i ]`

Value-preservation cases (byte-for-byte in both modes):

`[data-x=".icon"]`, `[data-x="#id"]`, `[data-x="A & B"]`, `[data-x="$token"]`,
`[data-x="https://example.com/a?b=c#d"]`, `[data-x="a\"b"]`, `[data-x="héllo → ✓"]`,
`[data-x="a  b"]` and `[data-x=""]`.

Composition cases:

- `h1#hero > .card[data-x=".icon"]:not(#id)` renames only `.card`.
- `&[aria-expanded="true"]:hover` flattens to `.card[aria-expanded="true"]:hover`;
  `&[data-x="A & B"]` keeps the ampersand inside the value.
- Comma lists mixing `[data-a="1"]`, `.card[data-b]`, `.other[ns|attr]` and
  `[data-list="a,b"]` split only at top-level commas.

Prefixing/class-table isolation: `.card[data-x=".icon"]` → `.ui-card[data-x=".icon"]`;
`[data-y=".card"]` and `[data-z=card]` stay byte-identical; the class table contains only `card`.

`tests/compiler/naming.test.ts` adds two pins: an attribute value equal to the class name
(`.card[data-x=".card"]`) is never rewritten, and the class scanner treats quoted and unquoted
bracketed contents as opaque.

Parser rejections (`[data-x`, unterminated string) stay owned by `tests/compiler/selectors.test.ts`;
they are not duplicated.

## Rename/completion isolation

- `tests/extension/provider.navigation.test.ts` adds a class-rename pin over
  `.card[data-x=".card"]`, `[data-y=".card"], .card[class~=".card"]` and `.card[data-z=card]`:
  three name-only edits (`card`), the attribute values unchanged, and a cursor inside the quoted
  value refused with the existing non-class reason.
- `tests/extension/provider.intelligence.test.ts` adds the class direction beside the existing id
  test: a cursor inside `.card[data-x=".car"]` is `kind: "none"` with no completion items, the value
  never becomes an analysis class occurrence, while the same line outside the brackets still offers
  selector classes.

## Browser evidence

The existing `states` scenario was extended (no tenth scenario):

```xessa
.card {
  ...
  &[data-state="open"] {
    background-color: rgb(10, 20, 30);
  }
}
```

`state-base` carries `data-state="open"` in the generated HTML. `specs/interactions.pw.ts` asserts
`background-color === "rgb(10, 20, 30)"` on `state-base`, proving the attribute-driven declaration
cascades. The generated `states` stylesheet is 189 B in pretty, minified, ungrouped and merged modes.

- New browser assertion: **1 computed-style assertion per engine** (3 engine-assertions:
  Chromium, Firefox, WebKit); the test count stays **96/96** (32 per engine).
- `states` pretty-vs-minified parity and safe/none/merge grouping parity pass in all three engines.
- Full browser gate: **96 passed** (Chromium, Firefox, WebKit).

## Findings

No compiler, rename or completion defect surfaced. Every operator/flag/value case already round-trips
unchanged, and the new browser assertion passes unchanged in all three engines.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| `bun test tests/compiler/ tests/extension/` (focused) | pass | new compiler file + naming/navigation/intelligence pins |
| `bun run verify` | **exit 0**, 67.31 s | **1341 pass / 2 skip / 0 fail**, 99 files; host 14 scenarios / 905 assertions |
| `bun run release:check` | **exit 0**, 166.23 s | browser **96/96**; nine examples; compiler tarball 323 / CLI 89; VSIX **18 files / 138.91 KB** |
| `bun run lint` | **exit 0**, 277 ms | 458 files checked, no fixes |

The verify count moved from 1330 to 1341 (+11 tests: 7 compiler matrix + 2 naming + 1 rename +
1 completion) and the file count from 98 to 99 (the new compiler file). The host suite is unchanged
because no host fixture was touched.

## Records

- `.ai/tasks/CSSX-ATTR-TESTS.md`, this report.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` → `ATTR · attribute-selector coverage` 🟢 row.
- `docs/compatibility.md` §1 “Native selectors (incl. attribute selectors)” row (Pass-through,
  tested-not-complete pointer to §4) and one `docs/usage.md` §2.2 sentence.
- No CHANGELOG entry (no behaviour change) and no todo-board item (coverage task).

## Handoff

**Status: PASS.** Added 7 compiler tests covering the attribute operator/flag/namespace matrix,
byte-preserved values (class/id/token/URL/escaped-quote/unicode/spacing), composition and
prefixing/class-table isolation; 2 naming scanner pins; 1 rename and 1 completion isolation pin.
The `states` browser scenario now proves `&[data-state="open"] { background-color: rgb(10, 20, 30) }`
on `state-base` in Chromium, Firefox and WebKit, with the existing pretty/minified and
safe/none/merge parity still green (96/96). No defect surfaced and no `packages/**/src` change was
needed. Gates: verify exit 0 — 1341 pass / 2 skip / 0 fail (99 files; host 14/905); release:check
exit 0 — 166.23 s, browser 96/96, nine examples, VSIX 18 files / 138.91 KB; lint exit 0.
