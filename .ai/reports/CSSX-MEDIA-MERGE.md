# CSSX-MEDIA-MERGE — Opt-in merge grouping

**Status:** PASS (2026-11-26)

## Summary

- Added opt-in `mediaGrouping: "merge"`; **`safe` remains the default** in the compiler, CLI config
  and editor. `none` and `safe` output are unchanged.
- Added `@setup { media-grouping: merge | safe | none; }` with defaults < project config < file
  precedence, `XESSA1001` (in-bounds value span) on invalid values, editor value completion with
  per-mode detail, and a Markdown hover card pinned by tests.
- Frozen and tested the property-family data; every allowed and blocked merge boundary is pinned by
  unit tests.
- Browser differential now compiles every scenario with `safe`, `none` and `merge` and requires
  computed-style equality at every viewport/scheme/engine.
- Default-output goldens and all nine examples are byte-identical to the pre-change baseline; no
  golden regeneration was needed (the default did not change).

## Merge algorithm (`packages/compiler/src/lowering/merge.ts`)

`groupRuns(ir, "merge")` first runs the existing safe adjacent pass, then applies the cross-run pass
to a fixpoint (greedy, lowest source index then lowest destination index; each merge removes one
node):

1. A run is a `(selector chain, condition string, native context, declarations[])` in output order.
2. Source `i` and destination `j > i` must have identical `selector`, `ancestors`, normalized
   condition string (both non-empty), and native context.
3. Every node strictly between them must be a rule with **no wildcard** and no property family
   shared with source `i`'s declarations. A native block or descriptor declaration is a hard
   barrier.
4. Neither source nor destination may contain a wildcard (`all`, or a value containing `var(`).
5. Source declarations move into the destination block *before* its declarations, preserving
   source-then-destination order; the source node is deleted. The merged node keeps the
   destination's selector, context, condition and span.
6. Native block children merge among themselves; sibling native blocks never merge across.

Unconditional runs never merge across a gap. The safe adjacent pass still merges adjacent identical
runs (including unconditional ones), so `merge` is a strict superset of `safe`.

**Proof.** A winner is decided per property. If every crossed declaration is in a family disjoint
from the moved run's declarations, no crossed declaration competes for the moved properties. The
moved declarations preserve their relative order before the destination's declarations, and
selector specificity, condition overlap, `@layer` order and `!important` are identical or untouched,
so every property's winner is unchanged.

## Frozen family data (`packages/compiler/src/lowering/property-families.ts`)

Base rule:

1. A declaration value containing `var(` is a wildcard.
2. `--custom` properties keep their full, case-sensitive name.
3. `all` is a wildcard.
4. Strip one `-webkit-`, `-moz-`, `-ms-` or `-o-` prefix.
5. Take the segment before the first `-` (`background-color` → `background`,
   `border-left-color` → `border`, `grid-template-columns` → `grid`, `margin-block` → `margin`).

Frozen cross-prefix exception groups (deliberately over-blocking, never under-blocking for a known
shorthand): `inset` + `top/right/bottom/left`; physical/logical sizing (`width`, `height`,
`inline-size`, `block-size` → `size`, min/max logical → min/max); `place-*` with `align-*` and
`justify-*`; `gap` with row/column/grid gaps; `columns` with width/count; `line-clamp` with
max-lines/block-ellipsis/continue; `white-space` with `text-wrap*`; `font` with `line-height`;
`break-*` with `page-break-*` and `column-break-*`; `overflow-wrap` with `word-wrap`;
`print-color-adjust` with `color-adjust`; `inset-area` with `position`; `motion*` with `offset*`;
legacy `-ms-flex-*`/`-webkit-box-*` spellings.

Unknown cross-prefix shorthands are the documented limit (ADR-0024): extend the frozen table when
such a property enters the language; a missed merge is acceptable, a wrong cascade is not.

## Blocked-case tests

`tests/compiler/media-merge.test.ts`:

- same property family
- shorthand and longhand in one family
- different selector
- different condition
- different native context (constructed IR)
- intervening `all` wildcard
- intervening `var()` value
- source run containing a wildcard
- destination run containing a wildcard
- unconditional runs across a gap
- native block between siblings
- `none`/default `safe` leave the authored runs untouched

`tests/compiler/property-families.test.ts` pins representative families, vendor prefixes, custom
properties, wildcards, unknown vendor spellings and the exception groups.
`tests/compiler/media-merge-setup.test.ts` pins default `safe`, API merge, file-over-project
precedence (compiler and `compileProject`), quoted values, invalid-value `XESSA1001` span bounds and
duplicate keys.

## Wiring

- Compiler: `MediaGroupingMode = "safe" | "none" | "merge"`; `SETUP_KEYS` + decoder accept
  `media-grouping`; effective mode is `file @setup ?? project/API ?? "safe"`, passed to
  `groupRuns`.
- CLI: `compiler.mediaGrouping` accepts `merge`, still defaults `safe`; invalid values exit 2 with
  `must be "safe", "none" or "merge"`.
- Editor: `media-grouping` added to setup-key completion (15 keys), values `merge|safe|none` with
  detail, and a hover card (purpose, modes, `safe` default, ADR-0024). Host assertions updated.
- Docs: ADR-0024, SPECIFICATION §5.3/§9/§10, configuration, usage, cascade, compatibility, README,
  CHANGELOG.

## Browser differential

`tests/browser/specs/grouping.pw.ts` now loads `safe`, `none` and `merge` pages for all 9 scenarios
at 5 viewports × 2 color schemes on Chromium, Firefox and WebKit, requiring deep computed-style
equality. `block-conditions` includes an actual cross-run merge: merge CSS 320 B → 286 B, computed
styles equal. Result: **27/27 grouping tests passed**; full browser suite **96/96** in
`release:check` (1.6 min).

## Goldens and examples

- Default-output goldens regenerated: **0** (default stayed `safe`).
- Committed example CSS regenerated: **0** net changes. All nine examples built twice; hashes
  identical in both rounds and equal to the pre-change baseline:

| Example | CSS | Bytes | SHA-256 (prefix) |
|---|---|---|---|
| basic | generated/styles/button.css | 977 | `11fe95fd4815…` |
| custom-output | generated/styles/theme.css | 143 | `e9238782f063…` |
| groups | generated/styles/app.css | 964 | `a609d161c81e…` |
| jsx | generated/styles/button.css | 160 | `a6c005b72b90…` |
| modules | generated/styles/app.css + client/app.css | 512 + 512 | `1db4f978a3d0…` (both) |
| overrides | generated/styles/app.css | 630 | `abf264c9beccc…` |
| portfolio | generated/styles/portfolio.css | 20451 | `562ba7cbda06…` |
| responsive | generated/styles/card.css | 665 | `79d9e8cff4660…` |
| variables | generated/styles/card.css | 302 | `6d5f7a750a03…` |

## Gates

| Command | Result |
|---|---|
| `bun run --cwd packages/compiler build && bun run --cwd packages/cli build` | exit 0 |
| `bun test tests/compiler tests/integration tests/extension` | exit 0 — 1050 pass / 0 fail (58 files; host 14 scenarios / 880 assertions) |
| `bunx playwright test tests/browser/specs/grouping.pw.ts` | exit 0 — 27/27 (47.5 s) |
| `bun run verify` | exit 0 — 1323 pass / 2 skip / 0 fail (98 files, 65.3 s) |
| `bun run release:check` | exit 0 — 159.5 s (browser 96/96, nine examples, VSIX 18 files / 138.35 KB) |
| `bun run lint` | exit 0 |

## Handoff

Merge is opt-in and default-safe; the family table is frozen and conservative; wildcards and native
blocks are barriers; the browser differential proves neutrality. No default goldens or examples
changed. Beyond the narrow listed set, the change also updated the existing CLI exit-code test's
expected error string (now includes `merge`), the editor's project-config plumbing
(`config.ts`/`analysis.ts`/`controller.ts`) so previews honour `compiler.mediaGrouping`, and the
related cascade/compatibility/release/known-limitations docs. The next writer can extend the frozen
table only with a documented shorthand relationship and should re-run the grouping differential plus
all three gates.
