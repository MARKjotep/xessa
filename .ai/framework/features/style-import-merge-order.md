# Xessa `@use … styles`: imported rules always precede local rules

**Summary:** A `styles` import merges the imported module's rules **ahead of** the importing file's own rules, depth-first in authored `@use` order. There is no local-first option and no way to interleave an import at an authored position. This is deliberate native-`@import`-like cascade behavior, but it means a module cannot override a local base rule at equal specificity merely by importing earlier; the app works around Gridy's page/module priority by pre-importing `gridy-page.cssx` and keeping page overrides in a later local block.

**Framework:** xessa

**Affected API:** Rule-merge ordering. `node_modules/@xessa/compiler/dist/resolver/rules.js:32-50` (`styleModuleOrder`, DFS post-order) and `node_modules/@xessa/compiler/dist/index.js:243-273` (module IR first, then `renamed.ir` for the entry) determine emission order.

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and `bun.lock` (`@xessa/compiler@0.1.1`).

## Use case

A page imports a shared component group but wants its page-level rules to win equal-specificity ties without a second class or extra specificity. Authors naturally expect a `@use` line placed before/after a local block to preserve that relative order, or an option to choose local-first.

## Reproduction

`tests/features/xessa-compiler.test.ts` → **"@use ... styles emits imported rules before local rules and inherits the map"**:

```xessa
// src/comp.cssx
@setup { prefix: "cmp"; }
.comp { color: red; }

// src/entry.cssx
@setup { prefix: "entry"; }
@use "./comp.cssx" styles;
.local { color: black; }
```

## Expected

Either (a) imported rules are emitted at the `@use` position, so a later local block can override at equal specificity, or (b) a documented option selects local-first ordering (with the cascade consequence spelled out).

## Actual

CSS is `.cmp-comp{color:red;}.entry-local{color:black;}` — the imported module is always first regardless of where the `@use` line sits. The merged map inherits both bindings (`comp`, `local`), so map behavior is unaffected. The spec documents this order (`SPECIFICATION.md` §6.3, "Merged CSS emits imported modules first"), so this is a capability gap rather than an implementation defect.

## Evidence

- `node_modules/@xessa/compiler/dist/resolver/rules.js:32-50`: `styleModuleOrder` pushes dependencies before the importing file.
- `node_modules/@xessa/compiler/dist/index.js:243-263` builds `moduleIr` in that order; `index.js:273` concatenates `[...moduleIr…, ...renamed.ir.rules]`.
- `tests/features/xessa-compiler.test.ts` — the repro asserts exact CSS and the merged map.
- App workaround: `src/pages/gridy/css/gridy.cssx` pre-imports `gridy-page.cssx`; `tests/features/xessa-app-contract.test.ts` verifies the resulting page bindings and single-class values.

## Workaround

Treat imported modules as the cascade base: put page overrides in a local rule after the `@use` block, raise specificity deliberately, or pre-import a page-specific module (`gridy-page.cssx`) before the shared group so the page layer is still emitted before its own local overrides. Do not reorder rules by hand in generated CSS.

## Status

Open upstream (feature request): an authored-position or local-first import mode with a documented cascade contract. Deliberate 0.1.1 behavior, not a bug. Related: `cross-prefix-class-map-union.md`, `portable-runtime-token-prefix.md`.

## Triage decision (2026-11-27)

**Deliberate cascade contract.** SPEC §6.3 emits imported rules first. **Decision: won't fix; use local overrides after imports or raise specificity.**
