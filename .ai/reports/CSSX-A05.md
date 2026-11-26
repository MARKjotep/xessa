# CSSX-A05 — Media IR + lowering (P2)

## Summary

- Define the immutable CSS IR (rules, declarations, condition contexts, native at-rule stacks, origin spans) in `packages/compiler/src/ir/`.
- Implement AST→IR lowering in `packages/compiler/src/lowering/`: inline-variant expansion in authored order, media alias resolution (built-ins < project < file, ADR-0006), combined-alias AND semantics, XESSA3001 rejections, and safe grouping as a pure utility.
- Golden IR snapshots for the media fixtures; no CSS text emission (A06 owns the emitter) and no variable substitution (A08 owns it).

**Status:** implemented; `bun run verify` exit 0 (232 tests / 10 files; A05 suite 46 tests / 243
assertions). Awaiting lead verification. `.ai/PROGRESS.md` untouched; no frozen type, lexer, parser,
barrel, fixture, doc or config changed.

**Follow-up (lead review):** the IR contract with all three additive fields was approved as the A06
handoff. Structurally invalid constructs that were previously dropped silently now produce XESSA1001
diagnostics (see "Contract concerns" item 2, resolved).

## Created files

| File | Contents |
|---|---|
| `packages/compiler/src/ir/types.ts` | IR node contracts (`DeclarationIr`, `MediaConditionIr`, `AtRuleContextIr`, `RuleIr`, `NativeBlockIr`, `StylesheetIr`, `NativeBlockChild`) with order/no-dedup JSDoc. |
| `packages/compiler/src/ir/factories.ts` | Frozen constructors; copies and freezes arrays; never sorts or normalizes. |
| `packages/compiler/src/ir/index.ts` | IR facade (types + factories). |
| `packages/compiler/src/lowering/media.ts` | Built-in table, ADR-0006 merge, expression classifier, combined-alias resolution and XESSA3001 factories. |
| `packages/compiler/src/lowering/spans.ts` | Segment-span tiling, modifier alias spans, condition/context/ancestor equality. |
| `packages/compiler/src/lowering/lower.ts` | Pure AST→IR walk: runs, flush rules, conditional blocks, native at-rule stack, restricted contexts. |
| `packages/compiler/src/lowering/group.ts` | `groupRuns` safe/none utility. |
| `packages/compiler/src/lowering/index.ts` | Lowering facade (`lower`, `groupRuns`, alias helpers, IR type re-exports). |
| `tests/compiler/media.test.ts` | 18 tests: five fixture IR goldens, span tiling, alias precedence, XESSA3001 rejections, native list passthrough. |
| `tests/compiler/lowering.test.ts` | 28 tests: cascade order, flush boundaries, ancestors, native contexts, restricted contexts, structural XESSA1001 cases, grouping, determinism/freeze, directive scope. |
| `.ai/tasks/CSSX-A05.md`, `.ai/reports/CSSX-A05.md`, `.ai/reports/logs/CSSX-A05.log` | Task, report, worker log. |

No framework bug/feature records: this is application work, not a framework defect.

## Public API

```ts
export function lower(
  ast: Stylesheet,
  options: CompileOptions,
): { ir: StylesheetIr; diagnostics: Diagnostic[] };

export function groupRuns(ir: StylesheetIr, mode?: MediaGroupingMode): StylesheetIr;

export function buildMediaAliasTable(
  ast: Stylesheet,
  project?: Readonly<Record<string, string>>,
): MediaAliasTable;

export function resolveMediaCondition(
  entries: readonly ConditionAlias[],
  table: MediaAliasTable,
  wholeSpan: Span,
): ConditionResolution;
```

All functions are pure, zero-dependency and frozen-output. The barrel (`src/index.ts`) is untouched;
lead-directed integration exports lowering when A06 lands.

## Alias-merge table (SPECIFICATION.md §4, ADR-0006)

Layer precedence, later wins per key, distinct keys accumulate:

| Order | Layer | Source |
|---|---|---|
| 1 | Built-ins | `BUILTIN_MEDIA_ALIASES` (§4.1) |
| 2 | Project | `options.media` |
| 3 | File | every top-level `@media-types` block, document order (later same-key wins) |

Built-ins: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px (all `min-width`), `dark` /
`light` `prefers-color-scheme`, `portrait` / `landscape` `orientation`, `print` (media type),
`reduced` `prefers-reduced-motion: reduce`.

Combination rules for one Xessa condition (block aliases + inline variant aliases):

| Rule | Outcome | Citation |
|---|---|---|
| Duplicate alias names | Normalized, first authored occurrence wins; `@md+md` → `(min-width: 768px)`, keys `["md"]` | §4.3 "Duplicate aliases in one modifier are normalized"; fixture `duplicate-aliases` |
| Single alias | `query` is the definition text (trimmed), never a list | §4.3 |
| Multiple aliases | Logical AND, joined with ` and `, keys in authored order | §4.3 |
| Media type present | Emitted first: `@p+md` → `print and (min-width: 768px)` | CSS media-query grammar; AND is commutative, so this is query normalization, not declaration reordering |
| Two media-type-bearing parts | Rejected (`print` + `screen`, also `print` + `print`) | §4.3 "incompatible media types … rejected with XESSA3001" |
| `not`/`only` definition | Valid standalone; rejected in any combination (cannot be joined with `and`) | §4.3 "aliases that cannot be combined" |
| Definition containing top-level `or` | Valid standalone; rejected in any combination | §4.3 single-expression MVP rule |
| Comma-list definition | Rejected even standalone | see decision below |

## Decisions with spec citations

1. **Comma lists are rejected for every Xessa alias, including standalone use.**
   SPECIFICATION.md §4.3: "MVP supports one media-query expression per alias. Unsupported combinations
   (incompatible media types, comma-list combinations, aliases that cannot be combined) are rejected
   with XESSA3001-family diagnostics." ADR-0006 repeats "comma lists" as a rejection and reserves
   lists for native preludes ("Native media lists pass through unchanged and are not alias-merged").
   Native `@media screen, print` therefore stays a native prelude, verbatim, and is never parsed into
   a Xessa condition (test: `native media lists pass through unchanged as a native prelude`).
2. **Xessa condition vs native context.** `RuleIr.condition` holds only the Xessa alias combination;
   native wrappers live on `RuleIr.context` outermost-first. A06 ANDs them at emission time. This keeps
   alias resolution and native passthrough independent (§3.5, §4.3, ADR-0006) and prevents native
   lists from entering alias logic.
3. **Restricted native contexts.** `@keyframes`, `@font-face` and `@property` (task list, §3.5
   "Unsupported Xessa transformations inside them MUST be rejected with diagnostics rather than
   silently changing semantics") reject inline modifiers and conditional blocks with XESSA3001
   containing the exact phrase "Unsupported Xessa transformation in this context". Plain declarations
   pass through. Restriction propagates into nested blocks and keyframe steps.
4. **`@runtime` emits no IR.** Explicitly out of scope per the task; external custom properties are
   P3/A08 (§6.2). Documented on `lower` and in `tests/compiler/lowering.test.ts`.
5. **Runs and flushing (§5.1).** Each declaration's base segment, then each variant, is appended in
   authored order. A run is opened by the first segment and flushed when the condition changes, when a
   conditional block starts, when a nested rule appears and when a native at-rule appears. Two
   conditional blocks with the same alias stay separate runs; `groupRuns` is the only merging step.
6. **No reordering or dedup (§5.2).** A later base after an earlier conditional stays later; duplicate
   shorthand/longhand declarations are preserved. Tests pin `red → @md green → blue` and
   `margin/margin-top/margin @md`.
7. **`!important` per segment (D2/§5.4).** `important` is copied from the exact segment; base and
   variant flags are independent and the raw `!important` text stays in `value` (ADR-0003).
8. **Spans.** `DeclarationIr.span` is the segment origin: base runs from the property to the first
   modifier; a variant runs from its modifier to the next modifier or the declaration end. Segments
   tile `Declaration.span` with no gaps/overlaps (`segment spans tile the declaration exactly`).
   `RuleIr.span` is the run's first declaration segment. Diagnostics point at the exact alias text for
   unknown/invalid definitions, at the whole modifier chain for combination errors, and at the
   declaration or block for restricted-context errors.
9. **Selectors stay authored.** `RuleIr.selector` is the raw AST selector; flattening is A06, prefixing
   is P4/A09 (§7, masterplan §6). A leading `&` descendant rule keeps its authored text.
10. **Grouping after class rewriting.** `groupRuns` merges by exact string equality, so the pipeline
    must run it after P4 renaming; documented in the JSDoc (task requirement, §5.3).
11. **Structurally invalid constructs are diagnosed, never dropped silently.** A selector-less
    declaration directly inside a native block that is not a descriptor at-rule, and a conditional
    block directly inside a native block with no enclosing rule, are invalid CSS structure
    (SPECIFICATION.md §3.4, ADR-0004; masterplan §4/§9 "no silent invalid CSS"). Lowering emits
    XESSA1001 with the exact declaration/block span and skips the construct. Descriptor at-rules
    `@font-face`, `@property` and classic `@page` keep their `DeclarationIr` children without a
    diagnostic: their declarations are representable native CSS, so they pass through untouched.

## IR contract additions (no frozen type changed)

`packages/compiler/src/ir/**` is new, not frozen, and three additions were required to make the IR
expressive without re-reading the AST. The prescribed fields are unchanged; A06 must be told about
these three:

| Field | Why it is required |
|---|---|
| `RuleIr.ancestors` | A flat `RuleIr` list cannot represent nesting. A06 needs the raw enclosing selectors to flatten `.card > .icon` and to keep mixed-specificity behavior; otherwise it must re-walk the AST. Empty for top-level rules. |
| `NativeBlockIr.children` also accepts `DeclarationIr` | `@font-face`/`@property` descriptors and classic `@page` boxes contain declarations that are not selector-bound; the task requires "plain declarations pass through". With the prescribed `RuleIr | NativeBlockIr` union they could not be represented. |
| `NativeBlockIr.statement?: true` | Statement at-rules (`@import`, `@charset`, `@layer a, b;`) have no block. Without a marker, `@import "a.css";` and `@layer a {}` are indistinguishable and the emitter would produce invalid CSS. |

If the lead prefers the smaller shape, all three can be dropped only by re-walking the AST or by
hard-coding at-rule name tables in A06; recommend keeping them and documenting them in A06's task.

## Test evidence

```text
bun test tests/compiler/media.test.ts tests/compiler/lowering.test.ts
 46 pass / 0 fail, 243 expect() calls (18 media + 28 lowering)

bun run verify
 typecheck: tsc -p packages/compiler, packages/cli, packages/language-service  → pass
 lint:      biome check . (207 files)                                          → pass
 test:      232 pass / 0 fail across 10 files
```

Fixture goldens (order, resolved query, keys, declarations) match the expected values inline in
`tests/compiler/media.test.ts`:

| Fixture | Runs (query) |
|---|---|
| `inline-variants` | base → `(min-width: 768px)` → `(min-width: 1280px)` → base → `(prefers-color-scheme: dark)` → `(min-width: 1280px) and (prefers-color-scheme: dark)` → `(min-width: 1280px)` block (2 declarations) → `(max-width: 500px)` |
| `combined-and` | base → dark → `(min-width: 1280px) and (prefers-color-scheme: dark)` → base → `(min-width: 768px) and (orientation: landscape)` → base → `(min-width: 1536px)` |
| `block-conditions` | base → `(min-width: 768px)` (2) → `(min-width: 768px) and (prefers-color-scheme: dark)` → `print` |
| `custom-alias-override` | base → `(min-width: 700px)` → `(min-width: 600px) and (max-width: 900px)` |
| `duplicate-aliases` | base → `(min-width: 768px)` (keys `["md"]`) → `(min-width: 1280px) and (prefers-color-scheme: dark)` (keys `["xl","dark"]`) |

Rejection coverage: unknown alias (inline and block, exact alias span), comma-list standalone and
combined, `print`+`screen`, empty definition, `not`/`only` combination, conditional block and inline
modifier inside `@keyframes`/`@font-face`, native list passthrough. Structural coverage: XESSA1001 for
a declaration outside a rule (`@media`, direct `@keyframes` declaration) and for a conditional block
outside a rule, each with its exact span; descriptor blocks stay diagnostic-free.

Grouping coverage: adjacent identical runs merge with first span and preserved order; different
conditions, different ancestors, different native contexts and intervening nested rules block a merge;
children inside one native block merge; `none` returns the same instance.

Determinism coverage: same AST lowered twice is deeply equal and JSON-identical; AST unchanged; IR
nodes and arrays frozen; rule spans stay in range and equal their first declaration span.

## Blockers

None.

## Contract concerns / handoff notes

1. **Variant value spans are absent from the AST** (A04 contract note #2: `Variant.span` is modifier
   only). Segment origins are therefore derived by tiling the declaration span; a variant span covers
   its modifier plus the value and separator whitespace that follow it. Source maps built by A06 will
   point at the modifier, which is the closest authored origin available.
2. **Resolved: selector-less constructs are now diagnosed with XESSA1001.** A top-level native block
   such as `@media X { color: red; }` cannot form CSS; the declaration is skipped *and* reported as
   XESSA1001 "declaration outside a rule" at its exact span. A conditional block directly inside a
   native block with no enclosing rule (parser tolerance, A04) is reported as XESSA1001 "conditional
   block outside a rule" at its span and skipped. Descriptor at-rules — `@font-face`, `@property` and
   classic `@page` — keep their `DeclarationIr` children without a diagnostic; `@page { margin: 1cm }`
   is valid classic CSS and passes through (`passes classic @page declarations through without
   diagnostics`). Tests: `reports XESSA1001 for a declaration outside a rule and skips it` (covers
   `@media` and a direct `@keyframes` declaration), `reports XESSA1001 for a conditional block outside
   a rule and skips the block`, and the diagnostic-free descriptor tests.
3. **§3.3 semantic validation is still unowned here:** an inline variant without a base value and an
   empty value segment are not diagnosed by lowering (no reserved code assigned). A06/A08 or the lead
   should decide the diagnostic; lowering preserves the authored text so the decision stays open.
4. **A06 must not double-emit native wrappers.** `RuleIr.context` includes the enclosing
   `NativeBlockIr` (it is the full outermost-first stack), while the block node itself carries the
   wrapper. A06 emits the wrapper once from `NativeBlockIr` and uses `context` only for inner rules.
5. **Barrel wiring is lead-directed.** `src/index.ts` still exposes only `parse`; consumers import
   `packages/compiler/src/lowering/index.ts` until integration.
6. **`mediaGrouping` option is not consumed by `lower`.** Configuration validation/clamping is P5; the
   pipeline calls `groupRuns(ir, options.mediaGrouping ?? "safe")` after class rewriting.

## Handoff

- A06: consume `StylesheetIr`; flatten with `ancestors` + `selector`, AND `condition.query` with the
  native `context` preludes at emission, emit `@import`/`@charset` from `statement`, emit descriptor
  `DeclarationIr` children directly (`@font-face`, `@property`, `@page`), and keep keyframe step
  `RuleIr`s untouched.
- A08: substitute `$` references into `DeclarationIr.value`, re-freeze nodes, and leave spans intact.
- P4/A09: rewrite classes in `selector`/`ancestors` before calling `groupRuns`.
- Lead: confirm the three additive IR fields with A06, then wire the lowering export into the barrel.
