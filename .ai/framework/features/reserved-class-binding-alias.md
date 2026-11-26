# Xessa reserved class names: `.switch` exports `_switch`, not `switch`

**Summary:** A class whose camelCase form is a JavaScript reserved word is still emitted in CSS (`ios-switch`) but the generated class map cannot use the bare name. Xessa renames the binding with a leading underscore and reports one `XESSA4001` warning: `.switch` → `export const _switch = "ios-switch";`. An ESM named export cannot be `switch` in a `const`, but a string-named export alias (`export { _switch as "switch" }`) is legal and would preserve the authored key for consumers. The app updated the iOS TSX to `i._switch`.

**Framework:** xessa

**Affected API:** Class-map binding generation. `node_modules/@xessa/compiler/dist/naming/mapgen.js:88-120` (camelCase alias → identifier adjustment), specifically `mapgen.js:116` (the reserved/invalid `XESSA4001` warning) and `mapgen.js:129-131` (deterministic `_`/`_N` adjustments).

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and `bun.lock` (`@xessa/compiler@0.1.1`).

## Use case

The iOS component group authors `.switch` and consumes it as `i.switch` in `src/components/ios/controls.tsx`. Reserved-word class names are ordinary CSS (`switch` is not reserved in CSS) and should keep an ergonomic JavaScript binding.

## Reproduction

`tests/features/xessa-compiler.test.ts` → **".switch exports _switch with one XESSA4001 warning"**:

```xessa
@setup { prefix: "ui"; }
.switch { color: red; }
```

## Expected

Either `export const switch = "ui-switch";` (not legal for `const`) or a legal alias that keeps the authored name addressable, for example:

```js
const _switch = "ui-switch";
export { _switch as "switch" };
```

At minimum the adjustment should be documented as a permanent binding-name change, not only a warning.

## Actual

- CSS: `.ui-switch{color:red;}`.
- Map: `export const _switch = "ui-switch";`.
- Diagnostics: one `XESSA4001/warning` — "Class \"switch\" maps to \"switch\", which is not a usable JavaScript export binding (reserved word or invalid identifier); it is exported as \"_switch\" (SPECIFICATION.md §8)."
- `classes.switch === "ui-switch"` (the authored key survives only in the class table, not in the JS export name).
- The committed app map `src/components/ios/css/index.js` contains `export const _switch = "ios-switch";`.

## Evidence

- `node_modules/@xessa/compiler/dist/naming/mapgen.js:116`: warning text and identifier adjustment.
- `tests/features/xessa-compiler.test.ts` — the repro asserts CSS, the `_switch` export, the warning code/severity, and the message.
- App contract: `tests/features/xessa-app-contract.test.ts` → **"the shell and primary page maps expose their expected keys"** includes `_switch` for the iOS page map.
- Migration note: `.ai/reports/xessa-union-keys.md` §"Reserved / invalid bindings" records the old `_x1` legacy alias and the Xessa `_switch` expectation.

## Workaround

Consume the adjusted binding (`i._switch`) and treat it as a stable public name. Do not rename the CSS class solely to avoid the warning unless the DOM contract also changes. The app has already updated `src/components/ios/controls.tsx`.

## Status

Open upstream (feature request): support a legal string-named ESM alias for reserved-word/invalid authored keys, so the map can expose `switch` while staying valid JavaScript. Low impact; `_switch` is committed. Related: `cross-prefix-class-map-union.md`.

## Triage decision (2026-11-27)

**Low-impact ergonomics request.** `_switch` is the documented recovery; a string-named ESM alias needs TypeScript/.d.ts design. **Decision: defer; document `_switch` as the stable public binding.**
