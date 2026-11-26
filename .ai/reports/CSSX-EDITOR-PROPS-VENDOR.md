# CSSX-EDITOR-PROPS-VENDOR — Property expansion and vendor-prefixed pseudo completion

**Status:** PASS (2026-11-27) · **Board:** feature 29 · **Scope:** editor intelligence, docs and records

## Summary

- The curated CSS property completion list grows from 123 to **197** entries: the 74 properties the
  owner asked for are inserted in alphabetical order, each with one accurate MDN-style sentence in
  `CSS_PROPERTY_DOCS`, and no existing entry was reformatted.
- Coverage is pinned both ways: every offered property has a non-empty sentence and every doc key
  corresponds to an offered property, so the stale 107/113 drift cannot recur silently.
- WebKit and Moz pseudo-classes/elements are offered only in the `pseudo` context, after all 19
  standard pseudos, alphabetically, with `detail: "vendor-prefixed pseudo-class|pseudo-element"`
  and a `z-…` sort key that sorts after the colon-prefixed standard labels.
- Follow-up: **43** curated WebKit/Moz vendor-prefixed **properties** (33 WebKit, 10 Moz) complete in
  property position only, surfaced beside the standard property they mirror and filtered by a typed
  engine prefix. The owner's table lists 43 entries, not 44; the data and every count follow the
  table.
- `web`/`moz` (with or without the leading `-`) filter the vendor set, accepting keeps the authored
  colon count (`&:` + `::-webkit-scrollbar` → `&::-webkit-scrollbar`), and standard filtering is
  unchanged (`hov` → `:hover`).
- Docs/CHANGELOG now state the real counts (197 standard properties plus 43 vendor spellings);
  historical reports were not touched.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
| --- | --- | --- | --- |
| Properties | 74 properties added to `CSS_PROPERTIES` (sorted, duplicate-free) plus 74 doc sentences | list sorted, no duplicates, 197 offered with `detail: "CSS property"` and non-empty docs | 🟢 |
| Vendor pseudos | 14 curated WebKit/Moz pseudos appended after `PSEUDOS` with vendor detail + `z-` sort key; `web`/`moz` prefix matching | offered only in `pseudo`, after standards, correct details/order/colon replacement | 🟢 |
| Vendor properties (follow-up) | 43 curated entries in `VENDOR_PROPERTIES` (`property`, `base`, `detail`) plus 43 doc sentences; base-name surfacing, `web`/`moz` family filter, `${base}~${property}` sort keys, vendor color longhands in `COLOR_PROPERTIES` | offered only in `property`; standard first; docs/snippet/retrigger identical; empty list still 197 with no vendor label | 🟢 |
| Follow-up tests | 5 added/extended intelligence tests (114 → 119) | `bun test tests/extension/provider.intelligence.test.ts` 119 pass / 0 fail | 🟢 |
| Tests | 5 intelligence tests added | `bun test tests/extension/provider.intelligence.test.ts` 114 pass / 0 fail | 🟢 |
| Docs and records | README, usage §5.1, compatibility, known-limitations, extension README, CHANGELOG, todo, PROGRESS, this report | every property-count mention says 197 standard + 43 vendor; no stale 107 remains outside historical reports | 🟢 |
| Full gate | typecheck, lint and `bun run verify` | exit 0 with recorded counts | 🟢 |

## Changed paths

- `packages/vscode/src/intelligence.ts` — property insertions at the sorted positions; `VENDOR_PSEUDOS`,
  `vendorPseudoMatches()`, and the `pseudo` completion case now returns standard items followed by
  vendor items (`z-` sort keys). Follow-up: `VENDOR_PROPERTIES`, `vendorPropertyMatches()`, the
  `property` case appends vendor items with `${base}~${property}` sort keys, and `COLOR_PROPERTIES`
  also derives from the vendor list.
- `packages/vscode/src/property-docs.ts` — 74 new one-sentence docs, alphabetically placed; follow-up
  adds the 43 vendor sentences at the head of the sorted table.
- `tests/extension/provider.intelligence.test.ts` — new describe block with the 5 tests below;
  follow-up adds the vendor property tests (ordering/sort keys, family filters, leaks, hover) and
  vendor color coverage in the color-property loop.
- `README.md` — extension completion bullet (curated 197 standard properties plus 43 vendor
  fallbacks, WebKit/Moz selectors).
- `docs/usage.md` §5.1 — real counts, curated-list honesty, base-name surfacing and the `web`/`moz`
  filter, vendor pseudo behaviour.
- `docs/compatibility.md`, `docs/known-limitations.md` — stale 107 replaced with 197 standard + 43
  vendor spellings.
- `packages/vscode/README.md` — Known gaps keeps the curated-list limitation, no stale count.
- `CHANGELOG.md` — three `[Unreleased] → Editor` bullets (property count, vendor pseudos, vendor
  properties).
- `packages/vscode/test/ui/completions.js`, `packages/vscode/test/ui/checklist.js` — host
  assertions updated for the 33 pseudo items and the second `colo` match; follow-up adds the
  `web` → `-webkit-appearance` snippet acceptance.
- `.ai/todo.md` feature 29; `.ai/PROGRESS.md` P8 row; this report.

## Acceptance evidence

- Property list: **197** entries, 0 duplicates, sorted; 74 added, 0 removed
  (`CSS_PROPERTIES` = 123 baseline + 74).
- Doc coverage: 197 `CSS_PROPERTY_DOCS` keys, exact set equality with the offered properties.
- Vendor set: 14 entries (9 WebKit, 5 Moz) appended after the 19 standard pseudos; details and
  `sortText === "z-" + label`; `web`/`-web` each return the 9 WebKit items, `moz` the 5 Moz items;
  `&:` + `::-webkit-scrollbar` → `&::-webkit-scrollbar`; `&:` + `:hover` → `&:hover` unchanged.
- No vendor label appears in `property`, `value`, `selector` or `directive` completion.
- `bun test tests/extension/provider.intelligence.test.ts` → **119 pass / 0 fail**, 5 473 expects.
- `bun run typecheck` → **exit 0**.
- `bun run lint` → **exit 0**, 460 files.
- `bun run verify` → **exit 0**; `bun test` **1 362 pass / 2 skip / 0 fail** across 99 files
  (1 053 883 expects); extension host **15 scenarios / 945 assertions**, all green
  (completions 172, checklist 98).
- Host UI assertions updated for the new behaviour (outside the pure-intelligence write set):
  `packages/vscode/test/ui/completions.js` (33 pseudo items, 14 vendor details/`z-` keys, vendor
  after standards; `colo` now offers `color` and `color-scheme`; follow-up: `web` offers
  `-webkit-appearance` with the property snippet and accept replaces the typed prefix) and
  `packages/vscode/test/ui/checklist.js` (33 pseudo items).

## Follow-up: vendor-prefixed properties

**What.** `VENDOR_PROPERTIES` adds the owner's curated WebKit/Moz property spellings to property
completion. The supplied table contains **43** entries (33 WebKit, 10 Moz), not 44, so the data,
tests and docs use 43; no property was invented to reach 44. Each entry carries `property`, the
standard `base` it mirrors, and `detail: "vendor-prefixed property"`, with one honest sentence in
`CSS_PROPERTY_DOCS`. `COLOR_PROPERTIES` derives vendor `*-color` longhands from the same list, so
`-webkit-tap-highlight-color`, `-webkit-text-fill-color` and `-webkit-text-stroke-color` offer the
named and hex colors.

**Why curated, not mechanical.** Prefixing every property would suggest dead or never-valid spellings
(`-webkit-display`, `-moz-opacity`). The curated set is the compatibility spellings still encountered
in real stylesheets; legacy-only ones (`border-radius`, `box-shadow`, `transform`, `transition`,
`animation`) are documented as fallbacks for very old engines, and the non-standard WebKit/Moz
extensions (`font-smoothing`, `touch-callout`, `overflow-scrolling`, `line-clamp`) are labelled as
such rather than as standard.

**Surfacing rule.** Property context only: `appear` → `appearance`, `-moz-appearance`,
`-webkit-appearance`; `web`/`-web`/`webkit`/`-webkit` → the 33 WebKit entries; `moz`/`-moz` → the 10
Moz entries. The empty property position and every value/selector/pseudo/setup/directive/token
context stay vendor-free. Items use `sortText: \`${base}~${property}\`` so a variant sorts directly
after its standard property (plain label < same label with suffix, `-` < `~`), and keep the identical
`insertText`/`snippet`/`retriggerSuggest` acceptance shape, with the replacement range covering the
typed word including any leading `-`.

**Evidence.** `appear` returns exactly the three labels in that order; vendor items carry detail,
docs, snippet, retrigger and `replaceStart`; `-webkit-text-fill-color: re` offers `rebeccapurple` and
`red` and accepting writes `-webkit-text-fill-color: red`; hover on `-webkit-appearance` resolves
through `propertyDoc`; doc coverage is two-way over **240** offered names (197 standard + 43 vendor);
tests, typecheck, lint and `bun run verify` exit 0 with the counts above.

## Handoff

**Status:** PASS. The editor offers 197 curated standard properties plus 43 curated WebKit/Moz
vendor-prefixed fallbacks (240 offered names, all documented) and, in pseudo position only, 14
optional WebKit/Moz pseudos after the standard set. Tests pin list sorting/uniqueness, two-way doc
coverage over standard and vendor names, base-name surfacing and the `web`/`moz` family filter,
vendor detail/snippet/retrigger/sort-key behaviour, vendor color values, hover, colon-safe pseudo
acceptance and context isolation. The owner's table lists 43 vendor properties (not 44); that count
is used consistently. No compiler, parser, grammar, fixture, golden, example or browser-test file
changed; the owner's uncommitted edits are preserved.
