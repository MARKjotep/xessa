# CSSX-A02 — Freeze compiler contracts and golden fixture catalog

## Summary

- Freeze the compiler's public TypeScript contracts: span, token, AST, diagnostics, options, module host, results and output-plan types in `packages/compiler/src/`.
- Create the golden fixture catalog: input fixtures plus the documented golden format and syntax-derivable expected diagnostics.
- No lexer/parser implementation — types and test data only, so the lexer and parser workers can start against frozen contracts.

**Status:** implemented; `bun run verify` exit 0; awaiting lead verification. No PROGRESS.md row was
touched.

## Objective delivered

`packages/compiler/src/types/` now holds the frozen contract modules with a single public barrel in
`packages/compiler/src/index.ts`, plus stubs for `parse`, `compile`, `compileProject` and
`planOutputs` that throw `not implemented (P1+)`. `tests/fixtures/` holds 46 fixture directories
(7 sibling token modules), a golden-format README, and authored diagnostics for the syntax-derivable
error fixtures. No lexer, parser, resolver or generator logic was added; the compiler still has zero
third-party dependencies.

## Created / changed files

Compiler contracts (`packages/compiler/src/`):

| File | Contents |
|---|---|
| `types/span.ts` | `Span` (half-open offsets, workspace-relative POSIX `file`; line/column derived, not stored). |
| `types/token.ts` | `TokenKind` (all 22 frozen kinds) and `Token { kind, value, start, end }`; freezes `modifier`, `dollar-ref`, `at-keyword`, `url`, `function` semantics and the raw-value convention. |
| `types/ast.ts` | `Stylesheet`, `StylesheetItem`, `SetupBlock`, `Setting`, `UseImport`, `VariablesBlock`, `TokenDeclaration`, `RuntimeBlock`, `MediaTypesBlock`, `AliasDeclaration`, `Rule`, `BlockItem`, `ConditionalBlock`, `ConditionalBlockItem`, `Declaration`, `Variant`, `Modifier`, `NativeAtRule`; raw slices per ADR-0005 with conditional `tokens?: Token[]`; ADR-0003 per-segment `important`; ADR-0004 no top-level conditional nodes. |
| `types/diagnostics.ts` | `Diagnostic`, `DiagnosticSeverity`, `DiagnosticFamily`, `DiagnosticCode` (`XESSA####`), `ReservedDiagnosticCode`, `DiagnosticCodeInfo`, frozen `DIAGNOSTIC_CODES`, `error()` / `warning()` factories. |
| `types/options.ts` | `ParseOptions`, `NamingStrategy`, `NamingOptions`, `MediaGroupingMode`, `OutputOptions` (all §9 settings and defaults), `CompileOptions`, `CompilerConfig`, `ProjectConfig`, `CompileProjectOptions`, `ResolvedSetup`, `CliOutputOverrides`, `ModuleHost`. |
| `types/result.ts` | `ClassMap`, `CompileResult`, `ParseResult`, `OutputKind`, `PlannedOutput`, `ManifestEntry`, `OutputPlan`, `PlanOutputsInput`, `PlanOutputsResult`, `PlanOutputs` signature. |
| `index.ts` | Barrel exporting every frozen type, the registry and factories, plus the four public stubs. |

Test and fixtures:

- `tests/compiler/contract.test.ts` — asserts the four entry points exist, all four stubs throw
  `not implemented (P1+)` (async ones reject), all seven reserved codes are registered with matching
  keys, and the factories preserve code/severity/message/span.
- `tests/fixtures/README.md` — layout, golden-artifact status, diagnostics JSON format and matching
  policy, statement-scoped span policy, per-fixture index, authoring rules.
- 46 fixture directories:
  - `canonical/button` (+ `theme.xessa`)
  - `lexical/{at-in-string,url-at,calc,comments-escapes,no-whitespace-modifier,at-mid-value}`
  - `media/{inline-variants,combined-and,block-conditions,custom-alias-override,duplicate-aliases}`
  - `nesting/{descendant-bare,pseudo-combinators,multiple-amp}`
  - `important/per-segment`
  - `errors/{top-level-conditional,unknown-modifier,unclosed-block,unknown-setup-key,duplicate-setting,missing-semicolon,malformed-value}`
  - `variables/{basic,local-overrides-imported,ambiguous-import,cycle,undefined-ref,namespaced-members}`
    (7 sibling modules: `tokens.xessa`, `a.xessa`/`b.xessa` twice, `layout.xessa`)
  - `runtime/{basic,with-variant,collision-with-compile-time}`
  - `global/escape`
  - `naming/{prefix,empty-prefix,camel-collision,reserved-js-identifier}`
  - `output/{no-setup,only-css-dir,only-map-dir,only-names,dirs-and-names,nested-source,disabled-emit,custom-import-css-false}`
    (`nested-source` also has `source-path.txt`)
  - `config/project-json` (+ `xessa.config.json` with every §10 key)
- Every fixture has `expected/{css,map.js,map.d.ts,diagnostics.json}`. The three artifact files are
  empty placeholders until P2/P3/P4; `diagnostics.json` is `null` unless authored below.

Authored diagnostics (9 files):

- `errors/top-level-conditional` XESSA1001, `errors/unknown-modifier` XESSA3001,
  `errors/unclosed-block` XESSA1001, `errors/unknown-setup-key` XESSA1001,
  `errors/duplicate-setting` XESSA1001, plus the owner additions `errors/missing-semicolon`
  XESSA1002 and `errors/malformed-value` XESSA1003.
- `lexical/no-whitespace-modifier` and `lexical/at-mid-value` use an explicit `[]` (no diagnostics)
  because SPECIFICATION.md §3.1 pins their inertness.

## Owner addendum compliance

| Item | Result |
|---|---|
| Reserve `XESSA1002` (missing semicolon; documents the v0.1 Xessa-declaration requirement vs the MAY for ordinary CSS final declarations before `}`) | ✅ registered with that exact distinction in its summary |
| Reserve `XESSA1003` (malformed declaration/block, unbalanced parentheses/braces) | ✅ registered; XESSA1001 remains the general anchor |
| `errors/missing-semicolon` with XESSA1002 and statement-boundary recovery documented | ✅ two consecutive declarations; README expects recovery at the next statement |
| `errors/malformed-value` with XESSA1003 | ✅ `width: calc(100% - 20px;` |
| `lexical/no-whitespace-modifier` (`12px@md` literal) | ✅ with `[]` diagnostics |
| `lexical/at-mid-value` (URL `@` literal, whitespace-preceded `@md` recognized) | ✅ with `[]` diagnostics |
| Confirm `minify` stays in `CompileOptions` default `false`, opt-in `@setup` | ✅ in `OutputOptions` (inherited by `CompileOptions`), default documented as `false`, JSDoc states it only compacts generated structural whitespace and preserves authored tokens/order |

## Contract decisions frozen here

1. **`kind` discriminants on every AST node.** Masterplan §6 only shows `Declaration.kind`, but
   `BlockItem`/`StylesheetItem` narrowing needs discriminants. Added additively; `Declaration.kind`
   stays the masterplan literal `"declaration"`.
2. **`Modifier` base type.** `Variant extends Modifier` (`aliases` + `span`) with `value`, `tokens?`
   and `important?`; `ConditionalBlock.variant: Modifier`, adding `Modifier` while keeping the
   masterplan `Variant` shape intact.
3. **Token value convention.** `Token.value` is the exact source slice for every kind except
   `function`, whose value is the name without the `(` (the `(` is a separate `lparen`). `url(...)`
   is one token, so `@`/`$` inside it never become Xessa tokens. `at-keyword` includes `@`,
   `dollar-ref` includes `$`, `modifier` includes `@`/`+`.
4. **`modifier` ownership.** Alias tables are configuration-dependent and `ParseOptions` only
   carries `file`, so the tokenizer emits `at-keyword`; the parser promotes a recognized condition to
   `modifier` only at top-level value depth (inline variants) or in block-condition position. JSDoc
   in `token.ts` states this and that it must not occur elsewhere.
5. **`UseImport.path`** is the raw text between the quotes (escapes undecoded, per ADR-0005 spirit);
   the resolver decodes escapes. **`Setting.value`** is the raw scalar slice including quotes.
6. **`NativeAtRule`** stores `name` without `@`, trimmed raw `prelude`, and `block?: BlockItem[]`
   (parsed members) so class rewriting inside `@media`/`@supports`/`@layer` remains possible while
   `@keyframes`/`@font-face`/`@property` pass through; rejecting unsupported Xessa transformations
   remains a validation concern (§3.5), not an AST limitation.
7. **`DiagnosticCode` is `XESSA` + four digits**, so later subcodes are additive for consumers;
   `ReservedDiagnosticCode` lists the seven anchors now in the registry.
8. **`CompileOptions extends ParseOptions`** (adds the required `file` used for spans, absent from the
   brief's field list) **and `OutputOptions`**; `ProjectConfig.output` reuses `OutputOptions`.
9. **`mediaGrouping: "safe" | "none"`** — the brief said `"safe"`, but masterplan §9 requires
   comparing grouping on/off, so `"none"` is part of the frozen union.
10. **`CompileOptions.media` is the project-level layer.** The file-level layer is source
    `@media-types` (ADR-0006); this is documented on the field.
11. **`planOutputs` returns diagnostics** (`PlanOutputsResult`) instead of throwing for expected
    collisions/escapes, and is typed by `PlanOutputs`; it is pure and never writes.
12. **Diagnostic span policy:** XESSA1002 spans the declaration missing its terminator, XESSA1003 the
    malformed statement, XESSA1001 construct diagnostics point at the offending construct, and an
    unclosed block is reported at end of file. Recorded in `DIAGNOSTIC_CODES` JSDoc and the fixtures
    README so A04 has one target.

## Spec ambiguities discovered

1. **`@setup` multiplicity.** SPECIFICATION.md §3.2 says "`@setup` appears at most once per file";
   the task and masterplan §6 describe multiple `@setup` blocks producing multiple `SetupBlock`
   nodes merged later. Resolved as a tolerant parser concern: the AST allows multiple nodes and
   `ast.ts` documents that the resolver reports the duplicate and merges. The lead may want to
   confirm the diagnostic code (currently XESSA1001 per the registry summary).
2. **Native at-rules inside conditional blocks.** SPECIFICATION.md §3.2's `conditionalBlock`
   production allows `declaration | rule | conditionalBlock` only, while `rule` also allows
   `nativeAtRule`. Frozen as `ConditionalBlockItem = Declaration | Rule | ConditionalBlock`, so
   `@md { @supports ... }` is outside v0.1 grammar. Flagged for A04/A06; may need a clarification or a
   superseding ADR.
3. **Semicolon acceptance boundary.** SPECIFICATION.md §3.1 and masterplan §3.1 say Xessa
   declarations require semicolons while "ordinary CSS final declarations without a semicolon MAY be
   accepted". They do not define when a declaration counts as ordinary CSS. A04 must implement the
   distinction without weakening XESSA1002; the fixture uses two consecutive declarations where the
   missing semicolon is unambiguous.
4. **Top-level conditional recovery representation.** SPECIFICATION.md §3.4 says the parser reports
   once, recovers at the next statement boundary and emits no CSS; the task allowed error-recovery
   nodes "if at all". Frozen with **no** AST node (recovery consumes and skips the block) so
   `Stylesheet.items` contains only valid constructs.
5. **`&` position and multiplicity.** SPECIFICATION.md §3.5/§7.1 list `&:hover`, `&::before`,
   `&:nth-child(2n)`, `& > .icon`, `& + .button` and descendant nesting, and say multiple `&`
   references are validated, but do not explicitly state that `&` may be trailing (`.row &`) or
   repeated (`& + &`). `nesting/multiple-amp` pins both readings because §7.1 implies multiple
   references are supported; A06 should confirm the flattening contract.
6. **Task vs. brief mediaGrouping.** Brief says `mediaGrouping?: "safe"`; masterplan §9 compares
   grouping on/off. Added `"none"` as a contract decision (see above).
7. **Task vs. brief `CompileOptions.file`.** The brief's field list omits it, but `Span.file` and
   output resolution require a source path; inherited from `ParseOptions` and documented.
8. **`@` inside `calc()`.** SPECIFICATION.md §3.1 states modifiers are recognized only at top-level
   value depth, outside functions, so `calc(100% - @md 20px)` keeps `@md` as literal CSS. Pinned by
   `lexical/calc`; no diagnostic is expected because the text is ordinary CSS content, not an
   unknown modifier.

## Validation evidence

| Command | Result |
|---|---|
| `bun run typecheck` | Exit 0 (compiler, CLI, language-service projects; strict NodeNext). |
| `bun run lint` | Exit 0; "Checked 160 files … No fixes applied". |
| `bun test` | Exit 0; 8 pass, 0 fail, 38 `expect()` calls across 2 files (4 contract + 4 scaffold). |
| `bun test tests/compiler/contract.test.ts` | Exit 0; 4 pass, 0 fail, 28 `expect()` calls. |
| `bun run verify` | Exit 0 (typecheck → lint → test). |
| Fixture inventory check | 46 fixture directories with `input.xessa`; every one has all four `expected/*` files; 7 sibling token modules; 1 `source-path.txt`; 1 local `xessa.config.json`. |

Bun used: 1.4.5 for direct runs; the `bun run verify` banner reports 1.4.4 (same runner banner
difference noted in A01).

## Acceptance criteria

| Criterion | Status |
|---|---|
| 1. `bun run typecheck` and `bun run verify` exit 0 | 🟢 |
| 2. Barrel exports every frozen type; stubs throw; contract test passes | 🟢 |
| 3. Fixture catalog complete with documented golden format | 🟢 46 fixtures + README |
| 4. Syntax-derivable `expected/diagnostics.json` authored | 🟢 7 error fixtures + 2 lexical no-diagnostic fixtures (owner additions increase the original five) |
| 5. Report lists created files, evidence, ambiguities, blockers | 🟢 this file |

## Deviations

1. **Contract test file.** `tests/compiler/contract.test.ts` sits outside the abbreviated
   "Allowed files" bullet list but is explicitly permitted and encouraged by the task constraints and
   required by acceptance criterion 2; no other test files were touched.
2. **Additive `kind` discriminants** on AST nodes beyond `Declaration` (see Contract decision 1).
3. **`XESSA1002`/`XESSA1003` and four extra fixtures** were added per the owner note received during
   the run, taking the catalog from 42 to 46 directories and authored diagnostics from 5 to 9 files.
4. **`source-path.txt`** was introduced as a documented optional fixture file so
   `output/nested-source` can pin a nested virtual entry path without duplicating `input.xessa`.
5. **`tests/fixtures/README.md`** documents `null` as "not authored" and `[]` as an explicit
   no-diagnostic expectation; the three golden artifact files remain empty placeholders.
6. **No `tests/fixtures/classmap/`** directory was added; A09's plan mentions one, but this task's
   allowed scope is the catalog above and fixture ownership transfers with A09.

## Blockers

None.

## Framework records

No framework bug or feature record was created: the compiler has zero runtime dependencies and only
root dev tooling (TypeScript, Biome) was used, with no framework defect encountered. No framework
version record is therefore required.

## Handoff

- **A03 (lexer):** implement `TokenKind` exactly as frozen; emit `at-keyword` (never `modifier`),
  one `url` token per `url(...)`, `function` name without `(`, and keep whitespace/comment tokens for
  fidelity. Expectations are pinned by `lexical/*`.
- **A04 (parser):** build `Stylesheet.items` from `StylesheetItem`; `!important` per segment per
  ADR-0003; `tokens?` only when `$` appears; report XESSA1002/XESSA1003 with the documented spans;
  top-level conditionals produce no node; `ConditionalBlockItem` excludes native at-rules.
- **A05/A06:** `Variant`/`Modifier` and `NativeAtRule.block` are the lowering inputs; `mediaGrouping`
  accepts `"safe" | "none"`.
- **A07/A08:** `UseImport.path` is raw between quotes; `ModuleHost` is the only filesystem surface;
  token-only modules have no artifact requirement.
- **A09/A10:** `ClassMap`, `OutputOptions`, `ResolvedSetup`, `PlannedOutput`, `OutputPlan` and
  `PlanOutputsResult` are frozen; `minify` is opt-in and defaults to `false`.
- Interfaces frozen here may change only with lead approval; fixture expectations fill in during
  P2/P3/P4 and are reviewed by the lead.

## Lead decisions (2026-11-25)

The lead reviewed the frozen contracts and resolved all six recorded ambiguities. Amendments applied:

1. **`@setup` multiplicity.** Removed the stale "refuses and merges / at most one per file" JSDoc in
   `Stylesheet`. Multiple `@setup` blocks are allowed at top level; the resolver merges them in
   document order, and a duplicate setting key within or across blocks is a XESSA1001-family
   diagnostic.
2. **Native at-rules in conditional blocks.** `ConditionalBlockItem` is unchanged and correctly
   excludes `NativeAtRule`. Added a `ConditionalBlock` JSDoc sentence: a native at-rule inside a
   conditional block is invalid per the §3.2 grammar and is reported as XESSA1001 with
   statement-boundary recovery.
3. **Semicolonless final declarations (ADR-0011).** An ordinary CSS final declaration without a
   trailing semicolon before `}` is accepted only when it contains no recognized modifier and no `$`
   reference; a declaration carrying either and lacking its terminating semicolon is XESSA1002. Added
   `docs/decisions/ADR-0011-semicolonless-final-declarations.md`, one normative sentence in
   `SPECIFICATION.md` §3.1, fixtures `lexical/final-no-semicolon` (no diagnostics) and
   `errors/semicolonless-modifier` (XESSA1002), plus both rows in the fixture index.
4. **`&` substitution (ADR-0012).** `&` uses native CSS nesting substitution semantics: any position
   (including trailing `.icon &`), multiple occurrences per compound (`& + &`), escaped `\&` stays
   literal, and `&` inside strings, comments or attribute values is never rewritten. No AST change;
   selectors remain raw slices. Added `docs/decisions/ADR-0012-ampersand-substitution.md`.
5. **`mediaGrouping`.** The union was and remains exactly `"safe" | "none"`; no `"ordered"` value
   existed. The JSDoc now states these are the only accepted v0.1 values, `safe` is the default and
   `none` emits as authored, and future modes such as ordered-media grouping (masterplan §3.3) are
   absent and must be rejected as an invalid configuration value with a clear message.
6. **Verification.** `bun run verify` rerun after the amendments and exits 0. The catalog now holds
   48 fixture directories (46 at initial hand-off plus the two ADR-0011 fixtures) and 11 authored
   `diagnostics.json` files (9 plus the two ADR-0011 fixtures).

Files touched by the follow-up: `packages/compiler/src/types/ast.ts`,
`packages/compiler/src/types/options.ts`, `SPECIFICATION.md` (§3.1 only),
`docs/decisions/ADR-0011-semicolonless-final-declarations.md`,
`docs/decisions/ADR-0012-ampersand-substitution.md`,
`tests/fixtures/lexical/final-no-semicolon/**`, `tests/fixtures/errors/semicolonless-modifier/**`,
`tests/fixtures/README.md` and this report. `.ai/PROGRESS.md` was not touched; the lead flips the A02
row.
