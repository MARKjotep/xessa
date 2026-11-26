# CSSX-A09 — Class rewrite + JS map/declaration generation (P4)

## Summary

- Implement the class-rewrite pass in `packages/compiler/src/naming/`: collect local class tokens from flattened selectors, rename per the naming table (prefix strategy), unwrap `:global(...)` while keeping its class literal.
- Implement JS class-map and TypeScript declaration generation (§3.6): quoted original keys, camelCase named exports when unambiguous, strict collision policy (XESSA4001 error), `__proto__`-safe emission, deterministic ordering, globals never exported.
- Update affected goldens: prefixed classes for fixtures whose `@setup` sets a prefix (canonical → `.ui-button` per masterplan §2) and author `expected/map.js` / `expected/map.d.ts` goldens.

## Objective

Close the class-naming stage of the pipeline: after `substitute` / `emitRuntimeTokens` and before
`groupRuns`, rewrite every selector class token through one naming table, remove simple
`:global(...)` escapes, and generate a deterministic ESM class map plus matching TypeScript
declarations. Persisted as `.ai/tasks/CSSX-A09.md`; worker log `.ai/reports/logs/CSSX-A09.log`.

## Created files

| File | Purpose |
|---|---|
| `packages/compiler/src/naming/types.ts` | Public shapes: `ClassEntry`, `ClassTable`, `RenameOptions`, `RenameResult`, `ClassMapOptions`, `ClassMapResult`, `ClassNamingOptions`. |
| `packages/compiler/src/naming/table.ts` | CSS identifier validation/decoding (`isValidCssIdentifier`, `decodeCssEscape`, `readCssIdentifier`) and the MVP naming table (`renameClassName`). |
| `packages/compiler/src/naming/scan.ts` | Class-token scanner mirroring A06's opacity rules, `:global(...)` range detection, and non-overlapping selector edits. |
| `packages/compiler/src/naming/rewrite.ts` | `renameClasses` — pure, frozen IR rebuild with class rename + global unwrap. |
| `packages/compiler/src/naming/mapgen.ts` | `generateClassMap` — ESM JS + `.d.ts`, alias/collision/reserved policies. |
| `packages/compiler/src/naming/index.ts` | Facade with the canonical pipeline position (no barrel wiring). |
| `tests/compiler/naming.test.ts` | 20 rewrite tests (prefix, global, escape, safety, fallback, purity). |
| `tests/compiler/mapgen.test.ts` | 16 map/declaration tests including six fixture goldens. |

Modified (required):

- `tests/compiler/golden.test.ts` — reads the fixture `@setup` prefix and inserts `renameClasses`
  between `lower` and `groupRuns`.
- `tests/compiler/variables.golden.test.ts` — inserts `renameClasses` between `emitRuntimeTokens` and
  `groupRuns`; canonical assertion now expects `.ui-button` / `.ui-button > .ui-icon`.
- 30 `tests/fixtures/**/expected/css` files (list below).
- 12 `tests/fixtures/**/expected/map.{js,d.ts}` files (six fixtures; previously empty placeholders).

## API

```ts
renameClasses(
  ir: StylesheetIr,
  options: { prefix?: string; naming?: { strategy?: "none" | "prefix"; prefix?: string } } = {},
): { ir: StylesheetIr; classes: ClassTable; diagnostics: Diagnostic[] };

generateClassMap(
  classes: ClassTable,
  options: { cssImport?: string | null } = {},
): { js: string; types: string; diagnostics: Diagnostic[] };
```

`ClassTable.entries` is first-appearance ordered and unique. `ClassEntry` carries the decoded
`name`, `emitted` name, `global`, `renamed` and the first-occurrence `span`.

## Naming decisions (SPECIFICATION.md §7.2, masterplan §3.5, ADR-0010)

- **Strategies:** `prefix` with a non-empty valid prefix yields `"<prefix>-<name>"`; `none` and an
  empty prefix leave names unchanged. `naming.prefix` wins over `prefix`.
- **Validation / fallback:** the prefix and the prefixed result must be valid bare CSS identifiers.
  An invalid prefix reports one XESSA4001 and leaves all classes unprefixed; an invalid per-class
  result reports XESSA4001 for that class only and leaves it unprefixed. Renamed classes never carry
  escapes, so the table key and the CSS text cannot drift.
- **Identity vs spelling:** class names are escape-decoded for the table (`.\31 23` → `123`,
  `.status\:active` → `status:active`). A renamed class is emitted as a valid bare identifier
  (`.ui-123`); an unprefixed class keeps its authored selector bytes, so escape style is preserved.
- **Rewrite boundary:** every `.` + identifier token outside `:global(...)`, strings, comments and
  attribute selectors is renamed. Class tokens inside functional pseudos (`:is(.a)`, `:not(.a)`,
  `:has(> .a)`) are real class selectors and therefore renamed; ids, type selectors, pseudo names,
  pseudo-element names, attribute values and comments are untouched.
- **Flattening:** `renameClasses` calls A06's `flattenSelector` read-only, so ancestor class
  references enter the same table and the emitted rule is flat (`.ui-button > .ui-icon`). A selector
  that cannot flatten keeps its authored nested form (classes still rewritten) and the emitter reports
  the same XESSA1001 as before.
- **`:global(...)`:** a simple single-class argument escapes renaming and the wrapper is removed from
  the emitted selector; the class is recorded with `global: true` and never exported. A complex
  argument (comma list, combinator, several classes) is left wrapped and unrenamed because MVP only
  supports simple global escapes and naive unwrapping would change selector-list meaning.
- **Mixed local/global name:** if the same name occurs locally and globally, the local entry wins the
  table position and export; the global occurrence still emits its literal class and is not exported
  separately. Documented on `ClassEntry`.
- **Empty rules:** classes in authored rules that emit no declarations are still tabled (the table is
  the naming table); no fixture depends on this.

## Alias and export decisions (SPECIFICATION.md §8, masterplan §3.6, ADR-0010)

- **Named exports:** camelCase of the original name, converted at `-` separators
  (`card-header` → `cardHeader`; underscores are left alone because they are already valid JS). Emitted
  only when the alias is a valid non-reserved JavaScript binding and unique.
- **Default object:** original names are the keys. A class with a named export uses the §2 forms —
  shorthand when the key equals its alias (`button`), quoted original plus alias when they differ
  (`"card-header": cardHeader, cardHeader`). A class without a named export keeps the original key with
  a literal emitted value. Keys that are valid IdentifierNames are written bare (`fooBar`, `default`);
  other names are quoted (`"foo-bar"`, `"2col"`). Values are always literal emitted names, so a
  collision never removes a class from the default map.
- **Collisions (strict, MVP = error):** `foo-bar` and `fooBar` both alias to `fooBar`. One XESSA4001
  error is reported at the first colliding class; named exports are omitted for **both**; the default
  map keeps only the original keys (`{ "foo-bar": "ui-foo-bar", fooBar: "ui-fooBar" }`). Recovery is
  explicit — no silent merge, no partial API — and the declaration file mirrors it.
- **Reserved / invalid identifiers:** `default`, `delete`, `2col` keep their original key and get a
  XESSA4001 **warning**; their named export is omitted. (`2col` is authored as `.\32 col`; a literal
  `.2col` is not a valid CSS class selector and is deliberately not recognized.)
- **`__proto__`:** the default object always uses a computed key (`["__proto__"]: ...`), which is an
  own data property: it never invokes `Object.prototype`'s prototype setter and never changes the
  object's prototype. Computed keys are preferred over a null-prototype construct because the module
  stays a plain object literal with no runtime helper.
- **Globals:** excluded from named exports, the default object and the declaration file.
- **Declarations:** `export declare const <alias>: "<emitted>";`, `declare const map: { readonly ... }`,
  `export default map`. Literal string types, readonly properties, identical named exports/omissions,
  no `any`. The JS CSS import line is emitted only for a string `cssImport`.
- **Ordering:** class-table order for named exports and map properties; aliases immediately follow
  their original key. Byte-identical across runs.

### Formatter-compatibility note (flagged for the lead)

The literal task wording says the default map keeps "quoted original keys". The repository's
`bun run verify` runs `biome check .`, which includes `tests/fixtures/**/expected/map.{js,d.ts}`.
Biome's formatter uses `quoteProperties: asNeeded` (unquotes valid IdentifierName keys) and its
`useLiteralKeys` lint rejects computed string keys for valid names, while its formatter also removes a
trailing semicolon from a single-line type literal. A universally quoted form therefore cannot pass
gate 1. The implementation preserves key *identity* and emits the formatter-stable spelling: bare when
the name is a valid IdentifierName (also the canonical §2 shorthand style), quoted otherwise, computed
for `__proto__`. This also required fixing generated-output formatting: objects/types stay inline when
the line fits 100 columns and otherwise use one property per line. No key, value or ordering is
changed by this decision; goldens encode the resulting bytes.

## Golden updates

CSS (all changes are prefixing and/or `:global` unwrapping only; inputs, configs and diagnostics were
not touched):

`canonical/button`, `config/project-json`, `errors/duplicate-setting`, `errors/malformed-value`,
`errors/missing-semicolon`, `errors/unclosed-block`, `errors/unknown-modifier`,
`errors/unknown-setup-key`, `global/escape`, `important/per-segment`, `lexical/at-mid-value`,
`lexical/no-whitespace-modifier`, `media/block-conditions`, `media/combined-and`,
`media/custom-alias-override`, `media/duplicate-aliases`, `naming/camel-collision`, `naming/prefix`,
`naming/reserved-js-identifier`, `nesting/descendant-bare`, `nesting/multiple-amp`,
`nesting/pseudo-combinators`, `output/dirs-and-names`, `output/nested-source`, `runtime/basic`,
`runtime/collision-with-compile-time`, `runtime/with-variant`, `variables/basic`,
`variables/local-overrides-imported`, `variables/namespaced-members`.

(`variables/undefined-ref` has prefix `ui` but emits no CSS, so its golden is unchanged. Fixtures
without a `@setup` prefix were not touched.)

Authored map/declaration goldens (12 files):

- `canonical/button` — includes the §2 line `import "../styles/button.css";`.
- `global/escape` — global class absent from both files.
- `naming/prefix` — `card` + `cardHeader` alias.
- `naming/empty-prefix` — names unchanged.
- `naming/camel-collision` — error, no named exports, original keys only.
- `naming/reserved-js-identifier` — `default`/`delete` warnings, `button` export.

Other class-bearing fixtures (config/output/etc.) keep their empty map placeholders: their import
specifier and emission flags belong to A10 and they add no naming coverage; the map generator is
covered directly by unit tests.

## Verification evidence

```
$ bun run verify
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... (cli, language-service)   # exit 0
$ biome check .
Checked 241 files in 79ms. No fixes applied.
$ bun test
 424 pass
 0 fail
 786829 expect() calls
Ran 424 tests across 20 files.
```

Targeted suites: `naming.test.ts` + `mapgen.test.ts` = 36 pass; golden suites = 15 pass.

## Decisions needing lead awareness / blockers

1. **Formatter-driven key spelling** (above): original-key identity is preserved, but valid
   IdentifierName keys are bare rather than always quoted, because `bun run verify` formats/lints the
   fixture `.js`/`.d.ts` goldens. If the lead requires universal quoting, `biome.json` would need a
   fixture ignore (config is outside this task's ownership).
2. **`errors/duplicate-setting`** uses the last authored `prefix` (`admin`) because both golden suites
   share the existing test-only `setupPrefix` helper (last setting wins). Real `@setup` duplicate
   resolution is P5 and already produces XESSA1001.
3. **Complex `:global(...)`** is left wrapped/unrenamed (MVP simple escapes); no fixture exercises it.
4. Barrel wiring (`src/index.ts`) is intentionally untouched; consumers import the naming facade until
   the lead wires the pipeline.
5. No framework bug/feature record was created; this task changes only first-party compiler code.

## Handoff

- Completed: rewrite stage, map/declaration generation, runner integration, CSS + map goldens, tests,
  `bun run verify` green.
- Remaining for the lead: wire `renameClasses`/`generateClassMap` into `src/index.ts` and the compile
  pipeline, decide the universal-quoting question if required, and wire A10's computed `cssImport`.
- Touched surface: `packages/compiler/src/naming/**`, `tests/compiler/{naming,mapgen}.test.ts`,
  `tests/compiler/{golden,variables.golden}.test.ts`, the fixture CSS/map goldens listed above,
  `.ai/tasks/CSSX-A09.md`, `.ai/reports/CSSX-A09.md`, `.ai/reports/logs/CSSX-A09.log`.
