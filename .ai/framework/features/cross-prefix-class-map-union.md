# Xessa merged class maps: one authored key under two prefixes is fatal XESSA4001

**Summary:** A `styles`-merged build has exactly one class map keyed by the authored class name. If a merged module emits `.comp` as `cmp-comp` and the importer also authors `.comp` as `other-comp`, compilation reports a fatal `XESSA4001` and keeps the first emitted name. There is no union binding (`"cmp-comp other-comp"`), no per-import `map-inherit`, and no way to keep both rules addressable from the same map. The app resolved this by renaming page-owned keys (`pageBrand`, `pageButton`, `pageShell`) and composing unions explicitly in TSX.

**Framework:** xessa

**Affected API:** Class-table merge and merged-map generation. `node_modules/@xessa/compiler/dist/naming/merge.js:69` raises the `XESSA4001` error; `node_modules/@xessa/compiler/dist/index.js:265-273` merges `{ table, label, mapInherit }` tables and then feeds the union into class-map generation; `naming/merge.js:35-73` is the only merge policy.

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and `bun.lock` (`@xessa/compiler@0.1.1`).

## Use case

The Gridy page imports the reusable `css.gridy` component group (`cg-*`) and the Gridy board group (`gy-*`). Before the migration both groups exported composable class strings such as `button = "gy_button cg_button"`, and the page added its own `gydemo_*` classes. A key-level union in one map would preserve that composition without renaming every TSX use site.

## Reproduction

`tests/features/xessa-compiler.test.ts` → **"one authored key under two prefixes is fatal XESSA4001"**:

```xessa
// src/prefixed.cssx
@setup { prefix: "cmp"; }
.comp { color: red; }

// src/entry.cssx
@setup { prefix: "other"; }
@use "./prefixed.cssx" styles;
.comp { color: black; }
```

## Expected

A single authored key with two different emitted names either (a) exports a union binding (or an explicitly composed pair), or (b) supports per-import/`map-inherit` opt-out so one side can stay rule-only without losing its rules, or (c) at minimum reports a recoverable diagnostic that names both call sites.

## Actual

- CSS emits both rules: `.cmp-comp{color:red;}.other-comp{color:black;}`.
- Diagnostics: one fatal `XESSA4001` — "Class \"comp\" is emitted as both \"cmp-comp\" … and \"other-comp\" …; a merged build has one class map, so the first name wins (ADR-0014)."
- `result.classes.comp === "cmp-comp"`; the merged map contains no union value and no second binding.
- `@setup { map-inherit: false; }` removes the imported bindings but keeps the imported rules; it does not give the importer a distinct binding for the same authored key.

## Evidence

- `node_modules/@xessa/compiler/dist/naming/merge.js:69`: `error("XESSA4001", … first name wins (ADR-0014))`.
- `tests/features/xessa-compiler.test.ts` — the repro above asserts the error code, both emitted names in the message, and `classes.comp === "cmp-comp"`.
- App contract: `tests/features/xessa-app-contract.test.ts` → **"the component and page maps export the renamed bindings"** and **"no map value is a multi-class union and shared keys resolve identically"**. The committed maps use `pageBrand`/`pageButton`/`pageShell` and single-class values, and shared `css.gridy` keys resolve identically in `src/components/css.gridy/css/index.js` and `src/pages/gridy/css/index.js`.
- Migration analysis: `.ai/reports/xessa-union-keys.md` records the 12+14 union keys that motivated the rename.

## Workaround

Rename page-owned keys so no two prefixes claim one authored name (`pageButton`, `pageBrand`, `pageShell`, `cssButton`, `cssStatus`, …) and compose the intended class list at the TSX use site, for example `${c.pageButton} ${c.button}`. Do not silence the collision with `map-inherit: false` unless the map is intentionally rule-only. The Gridy workaround is committed and protected by the app-contract tests.

## Status

Open upstream (feature request): a merged build could expose union bindings, a per-import map policy, or at least a documented composition helper. Not blocking; the rename is already applied. Related: `style-import-merge-order.md`, `reserved-class-binding-alias.md`.

## Triage decision (2026-11-27)

**Deliberate contract, not a bug.** One merged map with first-wins recovery is ADR-0010/ADR-0014; a union value would conflict with the existing app contract. **Decision: reject for v0.1; revisit only with a new ADR.**
