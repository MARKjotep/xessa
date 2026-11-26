# Xessa `@runtime`: portable component tokens take the consuming entry's prefix

**Summary:** Runtime tokens are named with the **consuming build's** `@setup prefix`, not the prefix of the module that declares them. A portable component module that declares `@setup { prefix: "dk"; }` and `@runtime { bgc: … }` emits `--dk-bgc` only when compiled as its own entry. When a page with `prefix: "ui"` imports the module, the same token is emitted as `--ui-bgc`, so a component cannot ship a stable `--dk-*` custom-property name across arbitrary pages. The app works around this by declaring portable component palettes as native `:root`/dark-`@media` blocks with fixed names.

**Framework:** xessa

**Affected API:** `@runtime` custom-property naming in the compiler. `node_modules/@xessa/compiler/dist/variables/naming.js:2-7` (`effectivePrefix` reads only `options.naming.prefix`/`options.prefix`) and `variables/runtime.js:82,90` (property = `runtimePropertyName(token.name, prefix)`); `node_modules/@xessa/compiler/dist/index.js:274-277` passes the entry's single prefix for the whole merged build.

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and the resolved lockfile `bun.lock` (`"@xessa/compiler": ["@xessa/compiler@0.1.1", …]`); `@xessa/cli` is also 0.1.1.

## Use case

Portable component groups (Domkit `--dk-*`, iOS `--ios-*`, Gridy `--gy-*`, css.gridy `--cg-*`) need token names that stay stable when the group is hosted by different pages. A page can then theme a component by setting `--dk-bgc` without knowing which page or entry prefix compiled it.

## Reproduction

`tests/features/xessa-compiler.test.ts` → **"the consuming entry's prefix, not the defining module's, names the property"**:

```xessa
// src/theme.cssx
@setup { prefix: "dk"; }
@runtime { brand: #0f0 @dark #00f; }

// src/entry.cssx
@setup { prefix: "ui"; }
@use "./theme.cssx" styles;
.card { color: $brand; }
```

## Expected

The token keeps the defining module's identity (`--dk-brand`) so a portable palette has one name in every host, while class rules still keep the consuming entry's prefix.

## Actual

The compiler emits `--ui-brand` for both the `:root` (and dark `@media`) declaration and the `var()` reference; `--dk-brand` is absent. The app's committed `src/pages/domkit/domkit.css`, `src/pages/ios-ui/ios-ui.css` and `src/pages/gridy/gridy.css` contain only the fixed native names because the portable token files use `:root`, not `@runtime`.

## Evidence

- `node_modules/@xessa/compiler/dist/variables/naming.js:11-13`: `runtimePropertyName(name, prefix)` composes `--<prefix>-<name>` from the caller's prefix only.
- `node_modules/@xessa/compiler/dist/variables/runtime.js:82,90`: one `prefix = effectivePrefix(options)` for every registered token, regardless of `token.module`.
- Test pair in `tests/features/xessa-compiler.test.ts`: this record's repro plus **"base and @dark values emit :root, a dark @media block and var() references"** (`--ui-*` with a single file).
- App contract: `tests/features/xessa-app-contract.test.ts` → **"portable component stylesheets keep fixed --dk-*, --ios-*, --gy-* and --cg-* names"**.
- Spec context: `SPECIFICATION.md` §6.2 ("named with the consuming build's prefix"), so 0.1.1 matches the spec; this record tracks the portability limitation, not an implementation defect.

## Workaround

Author portable palettes as native `:root` and dark `@media` blocks (the project pattern in `src/components/{domkit,ios}/css/tokens.cssx`, `src/components/gridy/css/tokens.cssx`, `src/components/css.gridy/css/tokens.cssx`) and import them with `@use "…" styles`. Native custom properties are not re-prefixed and merge byte-for-byte. Use `@runtime` only for page/entry-owned theme values where the consuming prefix is acceptable.

## Status

Open upstream (feature request): allow a runtime token to opt into a fixed/definition-owned custom-property name, or let a module declare a token namespace independent of the entry prefix. Not blocking the app; the native-token workaround is committed and covered by the app-contract suite. Related: `namespaced-runtime-token-emission.md`, `style-import-merge-order.md`, `../bugs/runtime-token-merge-order-first-wins.md`.

## Triage decision (2026-11-27)

**Spec-mandated behavior.** SPEC §6.2 names runtime tokens with the consuming build's prefix. **Decision: won't fix; native `:root`/`@media` palettes remain the portable-token pattern.**
