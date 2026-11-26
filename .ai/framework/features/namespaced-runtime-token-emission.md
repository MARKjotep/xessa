# Xessa namespaced runtime tokens: unreferenced members are omitted from `:root`

**Summary:** Runtime tokens that arrive through `@use "./palette.cssx" as p` are emitted only when a rule actually references `$p.name`. The same module imported unqualified emits **all** of its runtime tokens into `:root`/dark blocks even when nothing consumes them. TypeScript-only palette consumers (a theme switch reading CSSOM custom properties) therefore lose tokens that no `.cssx` rule mentions. The app avoids this by using native `:root` token modules rather than `@runtime` for shared palettes.

**Framework:** xessa

**Affected API:** Runtime-token collection. `node_modules/@xessa/compiler/dist/variables/runtime.js:111-136` registers (1) `entry.runtimeScope.tokens` (the unqualified surface) and (2) runtime references found in the entry and reachable modules; no pass enumerates a namespaced import's unreferenced runtime exports. `variables/runtime.js:141` rewrites references to `var(...)`.

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and `bun.lock` (`@xessa/compiler@0.1.1`).

## Use case

A design-token module exports a palette (`@runtime { accent: …; surface: …; }`) and a page switch mirrors the emitted `:root` values onto `document.documentElement`. Importing the palette with a namespace keeps names clear and avoids unqualified collisions, but the switch still needs every token present in CSS.

## Reproduction

`tests/features/xessa-compiler.test.ts` → **"namespaced unreferenced tokens are omitted while unqualified imports emit all"**:

```xessa
// src/palette.cssx
@variables { spacing: 1px; }
@runtime { accent: #f00; }

// namespaced
@use "./palette.cssx" as p;
.card { color: red; }

// unqualified
@use "./palette.cssx";
.card { color: red; }
```

## Expected

Both import forms emit the palette's `:root` custom properties (the module is reachable and its runtime surface is declared), or the docs state that namespaced imports are reference-only and provide an explicit "emit all" opt-in.

## Actual

- Namespaced: CSS is `.card{color:red;}` — no `:root`, no `--accent`; no diagnostic.
- Unqualified: CSS is `:root{--accent:#f00;}.card{color:red;}`.
- When a rule references `$p.accent`, the namespaced form does emit `:root{--accent:#f00;}`.

## Evidence

- `node_modules/@xessa/compiler/dist/variables/runtime.js:111-113`: only `entry.runtimeScope.tokens.values()` seeds all-declaration emission; the namespaced table is not included.
- `variables/runtime.js:115-136`: subsequent registration is reference-driven (entry rules, reachable token references, merged rule modules).
- `tests/features/xessa-compiler.test.ts` — the repro asserts both CSS strings exactly.
- App pattern: `src/components/{domkit,ios}/css/tokens.cssx`, `src/components/gridy/css/tokens.cssx` and `src/components/css.gridy/css/tokens.cssx` declare native `:root`/dark blocks, so the app's committed CSS always contains the portable palettes regardless of references; `tests/features/xessa-app-contract.test.ts` verifies their fixed names.

## Workaround

Import token modules unqualified when every emitted token is required, or declare shared palettes as native `:root`/dark `@media` blocks (the project pattern). For namespaced-only use, add an explicit reference if a token must be emitted, but that is brittle.

## Status

Open upstream (feature request): make namespaced runtime emission consistent with unqualified imports, or add an explicit `emit-all`/module-level opt-in. Not blocking; native tokens are committed. Related: `portable-runtime-token-prefix.md`, `../bugs/runtime-token-merge-order-first-wins.md`.

## Triage decision (2026-11-27)

**Capability gap, not a spec violation.** Namespaced imports are reference-only; unqualified imports emit all. The spec does not promise emit-all for namespaced imports. **Decision: defer; add an explicit emit-all opt-in only with consumer demand.**
