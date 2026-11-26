# CSSX-A08 — Compile-time substitution + runtime tokens (P3)

## Summary

- Implement compile-time variable substitution as a pure post-lowering pass: `$ref` expansion inside `DeclarationIr` values (including namespaced members and recursive token-to-token references with cycle detection), resolved against A07's module scopes.
- Implement runtime token emission: `@runtime` blocks become `:root` custom-property rules (prefix-aware) with conditional overrides, and runtime references in declarations become `var(--...)`.
- Complete the deferred `$`-reference golden fixtures (e.g. `canonical/button`) with the emitter pipeline; A06 owns the emitter, you consume it read-only.

**Status:** implemented and verified; `bun run verify` exit 0 (346 tests / 16 files at the time of the
run; A08 suite 55 tests / 171 assertions across three files). A06 landed its
`src/selectors`/`src/emitter` facades **while this task ran**, so the goldens are produced by the real
`flattenIr` + `emitCss` pipeline and match A06's output byte-exact (see "A06 coupling"). Awaiting lead
verification. No `.ai/PROGRESS.md` row touched; frozen types, lexer, parser, resolver, lowering,
selectors, emitter, barrel, docs and configs are unchanged.

## Created files

| File | Contents |
|---|---|
| `packages/compiler/src/variables/naming.ts` | `VariableNamingOptions`, `effectivePrefix`, `runtimePropertyName` (prefix naming rule). |
| `packages/compiler/src/variables/expand.ts` | Shared `$`-reference core: `splitReference`, `resolveReference` (compile/runtime/error), `expandValue` with recursion, cycle chain and depth guard. |
| `packages/compiler/src/variables/ast.ts` | AST lookups: `segmentValueTokens` (IR segment start → authored value tokens) and `astReferences` (authored refs in variables/runtime/rules). |
| `packages/compiler/src/variables/walk.ts` | `mapIrDeclarations` structural rewriter (identity preservation, container pruning) and `rootRule`. |
| `packages/compiler/src/variables/substitute.ts` | `substitute` pass + `SubstituteResult`. |
| `packages/compiler/src/variables/runtime.ts` | `emitRuntimeTokens` pass, `RuntimeEmitOptions`, `RuntimeEmitResult`. |
| `packages/compiler/src/variables/index.ts` | Facade + pipeline-position JSDoc (no barrel change). |
| `tests/compiler/substitute.test.ts` | 27 tests: fixtures, defining-module scope, namespace errors, depth guard, descriptors/keyframes, raw fidelity, exact spans, runtime refs, purity/adversarial IR. |
| `tests/compiler/runtime.test.ts` | 16 tests: `:root` emission, conditional overrides/`MediaConditionIr`, naming, emission ownership/conflicts, value expansion, XESSA3001 variants, statement-at-rule ordering, purity. |
| `tests/compiler/variables.golden.test.ts` | 12 tests: the 10 deferred `$` goldens through `lower → substitute → emitRuntimeTokens → groupRuns → flattenIr → emitCss`, determinism, canonical shape. |
| `tests/fixtures/canonical/button/expected/css` | 625-byte golden (canonical §2 shape, classes unprefixed). |
| `tests/fixtures/variables/{basic,local-overrides-imported,namespaced-members,ambiguous-import}/expected/css` | Goldens (75/23/42/26 bytes). |
| `tests/fixtures/variables/{cycle,undefined-ref}/expected/css` | Intentionally empty: the only declaration is rejected and the empty rule is pruned. |
| `tests/fixtures/runtime/{basic,with-variant,collision-with-compile-time}/expected/css` | Goldens (156/387/64 bytes). |
| `.ai/tasks/CSSX-A08.md`, `.ai/reports/CSSX-A08.md`, `.ai/reports/logs/CSSX-A08.log` | Task, report, worker log. |

No framework bug/feature records were needed: this is application work against frozen internal
contracts, not a defect in an external framework.

## Public API

```ts
// packages/compiler/src/variables/substitute.ts
export function substitute(
  ir: StylesheetIr,
  graph: ModuleGraph,
  entryFile: string,
  options?: VariableNamingOptions,
): SubstituteResult; // { ir: StylesheetIr; diagnostics: Diagnostic[] }

// packages/compiler/src/variables/runtime.ts
export function emitRuntimeTokens(
  ir: StylesheetIr,
  graph: ModuleGraph,
  entryFile: string,
  options?: RuntimeEmitOptions, // { prefix?, naming?, media? }
): RuntimeEmitResult; // { ir: StylesheetIr; diagnostics: Diagnostic[] }
```

Both are exported from `packages/compiler/src/variables/index.ts` with pipeline JSDoc, together with
`effectivePrefix`, `runtimePropertyName` and the option/result types. Barrel wiring stays
lead-directed.

**Deviations from the task sketch (documented in JSDoc):**

1. `emitRuntimeTokens` takes the IR as its first parameter. The prescribed `(graph, entryFile,
   options)` shape can emit `:root` rules but cannot rewrite declaration values to `var(...)`
   without re-reading the AST, so the pass consumes the (substituted) IR like every other pipeline
   stage.
2. `substitute` accepts the naming options because a runtime reference must be rendered as
   `var(--<prefix>-<name>)` immediately (leaving `$name` behind would lose provenance). Callers must
   pass the **same** effective prefix to both passes; the golden test does.
3. `resolveReference`/`expandValue`/`astReferences` are internal module exports (facade exports only
   the two passes plus naming helpers).

## Policies with citations

| Decision | Rationale / citation |
|---|---|
| Resolve `$name` with compile scope first, then runtime scope; `$ns.member` only via namespace member maps. | SPECIFICATION.md §6.1 namespaced independence, §6.2 single-symbol-space rule; A07 handoff items 1–4. |
| Local definitions shadow unqualified imports; imported modules are never mutated; expansion is textual per use. | §6.1 "Local definitions override unqualified imported definitions… Imported values resolve in their defining module; local overrides do not mutate imported modules." Verified by `local-overrides-imported` (imported `gap` stays `8px`). |
| Nested references inside a token value resolve in the **declaring** module's scope (recursively, token by token). | §6.1 "Imported values resolve in their defining module"; test "an imported token's nested references resolve in its defining module" (`4px` vs entry override `99px`). |
| Undefined token, unknown namespace, unknown member, bare namespace: XESSA2001 at the reference span and the **declaration segment** is omitted. | §6.1 "Undefined symbols and cycles are errors with source locations"; §12 "Invalid CSS is never emitted; affected constructs are omitted after an error diagnostic." A literal `$` never reaches CSS. |
| Reference cycles and chains > 64: XESSA2001 whose message contains the chain (`$a -> $b -> $a`) and the segment is omitted. | §6.1 cycles are errors; depth guard is the documented defence for adversarial chains. |
| Only the failing **segment** is omitted, not sibling variant segments. | §3.3/D2 and §5.1: each inline variant segment is an independent CSS declaration. |
| A rule/block is dropped only when **this pass** removed its last declaration/child; authored empty blocks (e.g. `@layer a {}`) are preserved; statement at-rules always survive. | §5.3/§9 "never silently change semantics"; empty `@layer` still declares layer order. |
| Substitution preserves everything except reference text (whitespace, `calc()` spacing, `!important`, strings/URLs, comments). | §3.1 "Raw CSS token sequences and custom property values MUST be preserved"; ADR-0005. |
| Spans never change; diagnostics use the authored reference token when available, else the segment span. | ADR-0005/§11 spans preserved through stages; the IR has no value-offset field, so the AST's parsed value tokens (present exactly when `$` is authored) provide offsets, keyed by segment start (A05 tiling). |
| Runtime property name is `--<prefix>-<name>`, or `--<name>` for an empty prefix; `naming.prefix` wins over `prefix`; the prefix is not sanitized here. | §6.2 example (`--ui-primary`), §7.2 prefix precedence/validation ownership. `CompileOptions.naming` JSDoc. |
| Runtime inline variants become conditional `:root` overrides; conditions use A05's `buildMediaAliasTable` + `resolveMediaCondition`, so query text and keys are identical to lowering. | §6.2 example and §4.2/§4.3/ADR-0006. |
| Override rules are grouped per resolved query in first-appearance order: base `:root` first, then one `:root` per condition. Same-property segments keep their authored relative order, and conditions only compare within one property, so the native custom-property cascade is unchanged. | §5.3 "Grouping MUST NOT change computed styles"; §6.2 "native custom property cascade handles it". |
| Runtime references are emitted as `var(--...)` with **no condition splitting** in declarations. | §6.2 ("Runtime variables emit native custom properties and references"), requirement 2 policy note. |
| Emission ownership (MVP): entry's unqualified runtime surface (locals authored, then unqualified imports) plus every runtime token referenced by the entry or by a reachable token module; deduplicated by custom-property name; two distinct definitions for one name → XESSA2001, first wins. | §6.2 "Imported runtime tokens must have a defined emission owner; in the MVP they are emitted in each consuming entrypoint, deduplicated within that entrypoint". Cross-entrypoint conflicts remain P5 project work. |
| Runtime rules are inserted after leading statement at-rules (`@charset`, `@import`, `@layer a, b;`) and before authored rules. | CSS at-rule ordering (`@import` must precede qualified rules); deterministic output. |
| Token order is the A07 scope order for the entry (locals in authored order, then unqualified imports) and `ModuleGraph.order` for reachable modules. | §6.2 dedupe within the entrypoint; §11 deterministic output. Authored order across files is undefined by the spec, so the documented deterministic order stands. |
| Compile-time and runtime symbols sharing a name stay a resolver (A07) error; substitution resolves the compile-time value and runtime emission still emits the authored `@runtime` property. | §6.2 "Compile-time and runtime symbols cannot share a local name" — the error owns rejection; recovery is documented and pinned by `runtime/collision-with-compile-time`. |
| Pipeline position documented, not wired: `parse → buildModuleGraph → lower → substitute → emitRuntimeTokens → (P4: class rewrite → groupRuns) → emitCss`. | §11 pipeline; masterplan §6. Barrel changes are lead-directed. |

## Fixture goldens

All ten fixtures A06's `tests/compiler/golden.test.ts` classifies as deferred now have authored
`expected/css` and are reproduced byte-exact through
`buildModuleGraph → lower → substitute → emitRuntimeTokens → groupRuns("safe") → flattenIr →
emitCss(pretty)`:

| Fixture | Output |
|---|---|
| `canonical/button` | `.button` blocks in source order (base, `@md`/`@xl` padding runs, base again, `@dark` background, base again, `@md` font-size), then `:hover`, `:disabled`, `.button > .icon` + `@lg`; selectors WITHOUT prefix (class naming is A09). |
| `variables/basic` | `.card` with `16px`, `8px`, `1px solid 16px`. |
| `variables/local-overrides-imported` | `.card { gap: 24px }`. |
| `variables/namespaced-members` | `.card { padding: 12px; margin: 4px }`. |
| `variables/ambiguous-import` | `.card { padding: 8px }` (resolver keeps first provider; the diagnostic is graph-level). |
| `variables/undefined-ref`, `variables/cycle` | empty CSS (only declaration rejected, empty rule pruned). |
| `runtime/basic` | `:root --ui-primary` + `@dark` override + `color: var(--ui-primary)`. |
| `runtime/with-variant` | base `:root` with both tokens, then `@dark`, `@md`, `@dark+md` (`(prefers-color-scheme: dark) and (min-width: 768px)`) overrides in that order. |
| `runtime/collision-with-compile-time` | `:root --ui-primary: #0ea5e9` + `color: #2563eb` (compile-time precedence; resolver error retained). |

Remaining deferrals: nothing in A08's scope. `expected/map.js`/`map.d.ts` still need P4/A09 class naming
and `import "../styles/button.css"` path planning (P4/A09/A10); `@setup` resolution (prefix, css/map
paths) is likewise P4/P5 — the golden test reads `prefix` with a documented test-only helper.

Empty-output policy note: unlike A06's plain error fixtures there is **no** `/* no css … */` sentinel
for the two empty `$` fixtures. They are genuinely empty after a successful (diagnosed) pass, and the
golden test asserts the diagnostic codes and the empty CSS explicitly; honouring A06's sentinel would
also be possible if the lead prefers one convention for every empty golden.

## Test evidence

```text
bun test tests/compiler/substitute.test.ts tests/compiler/runtime.test.ts tests/compiler/variables.golden.test.ts
  55 pass / 0 fail, 171 expect() calls

bun run verify
  typecheck: tsc -p packages/compiler, packages/cli, packages/language-service  → exit 0
  lint:      biome check . (225 files)                                          → exit 0
  test:      346 pass / 0 fail across 16 files                                  → exit 0
VERIFY_EXIT=0
```

Coverage highlights:

- **Substitution:** `variables/basic` (incl. `border: 1px solid $radius`), defining-module recursion,
  namespace member/unknown member/unknown namespace/bare namespace/bare-name-not-visible, cycle
  (`$a -> $b -> $a`, span in `b.xessa`), 70-token depth guard, `@font-face` descriptors and
  `@keyframes` steps, `calc()` spacing + multiple refs + `!important`, strings and `url($gap.png)`
  untouched, exact reference spans for base and variant segments, runtime refs
  (`var(--ui-primary)`, empty prefix, namespaced member, compile value embedding a runtime ref),
  determinism, input-immutability, missing entry, empty stylesheet, fabricated IR.
- **Runtime:** `:root` base + four conditional overrides with exact `MediaConditionIr.query`/`keys`,
  naming precedence (`naming.prefix` > `prefix` > empty), unqualified imported token emitted,
  referenced namespaced token emitted and unreferenced sibling not, two-namespace conflict → one
  XESSA2001 and first wins, runtime value expanding compile and runtime tokens, XESSA3001 variant
  dropped while the base survives, standalone call rewriting unsubstituted IR, insertion after
  statement at-rules, no-op identity paths, determinism and input immutability.
- **Goldens:** all ten deferred fixtures byte-exact, repeat runs identical, no emitter/flatten
  diagnostics, and canonical `.button`/`.button > .icon` with unprefixed classes and the preserved
  md/xl interleaving (§5.1).

## A06 coupling (emitter in flight)

- A06's `src/selectors` + `src/emitter` landed mid-task. The golden test consumes them read-only via
  their documented facades (`flattenIr`, `emitCss(ir, { minify: false })`), not through a local
  harness; the earlier local harness was removed once the facade existed.
- Goldens were verified byte-exact against A06's pretty output (same two-space indent, blank line
  between siblings, trailing newline), including the `:root` rules and `@media` wrappers. While A06
  was mid-edit, one `bun run verify` briefly failed in `src/emitter/index.ts` (an A06-internal
  symbol mid-rename); the final run above is green and the emitter file was not touched here.
- A06's `tests/compiler/golden.test.ts` currently **skips** deferred fixtures for byte comparison and
  keeps a 48-fixture/10-deferred classification. The lead can extend that runner to these fixtures
  unchanged (same chain plus the two A08 passes); A08's own golden test already validates them.
- Internal coupling to fix if desired: `modifierAliasSpans`/`declarationSegmentSpans` are imported
  from `packages/compiler/src/lowering/spans.ts` because `lowering/index.ts` does not re-export them.
  Re-exporting them from the lowering facade would remove the one non-facade import; no duplication
  was introduced.

## Contract concerns for lead review

1. **`emitRuntimeTokens` signature** includes the input IR (see deviations). If a graph-only facade is
   required, the reference rewrite would have to move to `substitute` exclusively and the pass could
   only return new `:root` rules.
2. **Prefix coupling:** `substitute` must receive the same effective prefix as `emitRuntimeTokens`.
   `evaluate`/`compile` wiring (lead/P4) must pass it once. `effectivePrefix` centralizes the rule.
3. **Empty-block pruning:** authored empty blocks are preserved (`@layer` order), while blocks emptied
   by a rejected reference are dropped. A06's emitter currently emits empty `@layer` blocks; that is
   intentional.
4. **Diagnostic anchoring:** reference spans are exact when the AST kept value tokens; fabricated IR
   (no authored counterpart) reports the segment span. No IR field was added.
5. **Runtime-name conflicts:** XESSA2001 is also used for two reachable namespaced runtime tokens with
   the same name in one entrypoint; this is the strict reading of §6.2 "deduplicated within that
   entrypoint". Cross-entrypoint conflicts stay P5.

## Blockers

None.

## Handoff

- Lead: wire `substitute` + `emitRuntimeTokens` into `compile`/`compileProject` in the documented order
  with one shared prefix, then `groupRuns` and A06's `flattenIr`/`emitCss`; optionally extend A06's
  golden runner to the ten now-authored fixtures and re-run after A06 reports.
- A09/P4: class prefixing applies to selectors only; runtime custom properties already use the prefix
  rule of §6.2 (`--<prefix>-<name>`). Reuse `runtimePropertyName` for consistency.
- P5: cross-entrypoint runtime collision detection and whole-artifact suppression on errors.
- Files touched are exactly the allowed scope: `packages/compiler/src/variables/**`, the three new
  test files, the ten deferred `expected/css` files, and the A08 task/report/log.
