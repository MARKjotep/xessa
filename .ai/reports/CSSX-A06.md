# CSSX-A06 — Selector flattening + CSS emitter (P2)

## Summary

- Implement selector flattening (nested `&`/descendant rules → flat selectors per ADR-0002/ADR-0012) in `packages/compiler/src/selectors/`.
- Implement the deterministic CSS emitter in `packages/compiler/src/emitter/`: pretty and `minify` modes, native at-rule composition with Xessa conditions, declaration order preserved.
- Author golden CSS for the fixture catalog (fixtures without `$` references) and pin the emitter with unit tests. Browser cascade validation follows this task via the lead.

**Status:** implemented; `bun run verify` exit 0. A06 suite 59 tests / 324 assertions; full
workspace 346 tests / 16 files (includes concurrent A08 work). Awaiting lead verification.
`.ai/PROGRESS.md` untouched; no frozen type, lexer, parser, resolver, lowering, barrel, doc, config,
map golden or diagnostics golden changed.

## Created / modified files

| File | Contents |
|---|---|
| `packages/compiler/src/selectors/scan.ts` | Structural selector scanner: strings, comments, escapes, parentheses, attribute selectors, top-level commas/combinators, pseudo-element detection; never throws. |
| `packages/compiler/src/selectors/specificity.ts` | Conservative specificity estimator (`:is`/`:not`/`:has`/`:where`/`:nth-*`, attributes, namespaces); `null` means "fall back to `:is(...)`". |
| `packages/compiler/src/selectors/flatten.ts` | `flattenSelector` (pure, diagnostics-carrying result) and `flattenIr` pipeline step; ADR-0002 descendant and ADR-0012 `&` semantics. |
| `packages/compiler/src/selectors/index.ts` | Selector facade. |
| `packages/compiler/src/emitter/index.ts` | Pure `emitCss` with pretty/minify formatting, wrapper composition, structural validation. |
| `tests/compiler/selectors.test.ts` | 26 flattening tests (matrix, `:is` policy, cross-product order, rejections, `flattenIr`). |
| `tests/compiler/emitter.test.ts` | 30 emitter tests (pretty/minify pairs, at-rule composition, statements/descriptors/keyframes, XESSA1001, token preservation, adversarial IR, determinism, CRLF bytes). |
| `tests/compiler/golden.test.ts` | 3 golden tests: catalog split, byte-exact 38 goldens, minify whitespace-only check over all 48 inputs. |
| `tests/fixtures/**/expected/css` (38 files) | Authored pretty-mode goldens for every non-`$` fixture; one sentinel file for the only empty output. |
| `.ai/tasks/CSSX-A06.md`, `.ai/reports/CSSX-A06.md`, `.ai/reports/logs/CSSX-A06.log` | Task, report, worker log. |

No framework bug/feature record applies: this is application work, not a framework defect.

## Public API

```ts
// selectors
export function flattenSelector(
  selector: string,
  ancestors: readonly string[],
): FlattenResult; // { ok: true; selector } | { ok: false; reason }

export function flattenIr(ir: StylesheetIr): {
  ir: StylesheetIr;
  diagnostics: readonly Diagnostic[];
};

// emitter
export interface EmitOptions { readonly minify: boolean }
export interface EmitResult { readonly css: string; readonly diagnostics: readonly Diagnostic[] }
export function emitCss(ir: StylesheetIr, options?: Partial<EmitOptions>): EmitResult;
```

All functions are pure, zero-dependency and deterministic. `flattenSelector` preserves authored
token order; `flattenIr` rewrites selectors, clears `ancestors`, preserves declarations, conditions,
context and spans, and drops only rules that cannot be flattened (XESSA1001). `emitCss` flattens
again defensively, so callers may skip the explicit step without producing nested CSS.

## Selector policy (`:is(...)`, cross-product, rejections)

| Case | Result |
|---|---|
| Bare nested selector without `&` | Descendant: `parent + " " + child` (ADR-0002). |
| `&` leading / compound / combinator / trailing / repeated | Direct substitution (ADR-0012); e.g. `&:hover`, `& > .icon`, `.icon &`, `& + &`, `&&`. |
| Escaped `\&` | Literal, never substituted. |
| `&` in strings, comments or attribute selectors | Never rewritten. |
| Nested child selector list | Cross-product in authored order: child-major, parent alternatives in authored order (e.g. `.x, .y` under `.a, .b` → `.a .x, .b .x, .a .y, .b .y`). |
| Parent list, equal known specificity | Cross-product expansion (specificity-equivalent to native nesting). |
| Parent list, mixed or unknown specificity | `:is(<list>)` substitution; `:is()` has exactly native nesting's max specificity. |
| Parent list, mixed/unknown, containing `::before`-style or legacy `:before`-style pseudo-element | Rejected: `:is()` cannot contain pseudo-elements. |
| Single complex parent + prefix-attached `&` (`.x&`, `&&`, `.x:not(.y)&`) | Wrap the parent in `:is(...)` for all occurrences; plain concatenation would change meaning. Safe suffix forms (`&:hover`, `& > .x`, `.row &`) substitute directly. |
| Top-level `&`, empty selector/item, unbalanced string/bracket/paren, unterminated comment, trailing escape, leading combinator (`> .x`, `+ .x`, `~ .x`, `|| .x`) | Rejected with a reason; the emitter reports XESSA1001 and omits the rule. §7.1 requires `&` for complex/relative nesting. |

A rejected selector omits the whole affected rule (not just one list item). All reasons are stable,
user-facing strings cited by the emitter diagnostic.

## Emitter decisions

1. **Formatting.** Pretty: two-space indent, one declaration per line, a trailing `;` on every
   declaration (one convention everywhere), one blank line between sibling rules/blocks, final `\n`.
   Minify: same assembly with only structural whitespace removed; no trailing newline; `;` kept.
2. **Order.** Rules, declarations, native blocks and children emit in IR order. No reordering,
   merging or deduplication. Declaration order and per-segment `!important` text are preserved.
   The `DeclarationIr.important` flag is metadata only; the raw `value` already contains the
   authored `!important` (ADR-0003), so the emitter never appends it and cannot duplicate it.
3. **Native wrappers.** A `NativeBlockIr` emits its wrapper once. Child rules carry the full
   outermost-first `context`; the emitter compares it with the wrapper chain already emitted by
   ancestor blocks and emits only the non-matching suffix, so the normal lowering output never
   double-emits (A05 handoff note 4). Synthetic IR with a rule-level context is still supported.
4. **Media composition.** Remaining native `@media` preludes and `condition.query` are ANDed into
   one `@media` wrapper (`" and "`) when the parts form a valid single query: plain parenthesized
   conditions, plus at most one media type (or `only <type>`), which is placed first because media
   query grammar requires the type at the start (AND is commutative, so this is query
   normalization, not declaration reordering). `not` prefixes, comma lists and top-level `or`
   nest as separate wrappers in authored order instead, preserving native meaning (§4.3: native
   media lists pass through unchanged). Non-media contexts (`@supports`, `@layer`, `@container`)
   wrap outside the media query (§3.5). A condition inside a native block therefore appears as a
   nested `@media` under the block's wrapper, not as a second copy of the block.
5. **Native content.** Statement at-rules emit `@name prelude;`; descriptor at-rules
   (`@font-face`, `@property`) emit their `DeclarationIr` children directly; keyframe steps emit as
   rules with authored keyframe selectors; nested native blocks recurse. Empty blocks emit
   `@layer x {}` / `@layer x{}`.
6. **Structural validation (§3.1).** A `DeclarationIr` with an empty property or an empty value
   (after segment split, including the base segment of an inline variant) emits XESSA1001 and the
   declaration is omitted. SPECIFICATION.md §3.1 requires a base value for inline variants; the IR
   has no base/variant marker, so the message covers both: `Empty declaration value for "<prop>":
   inline variants require a base value (SPECIFICATION.md §3.1); the declaration was omitted.`
   Lowering deliberately leaves this decision to emission (A05 note 3, now closed here).
7. **Determinism.** Structural whitespace is always `\n` and two-space indentation; raw IR values,
   selectors and preludes are emitted as-is. CRLF or other bytes inside values are preserved, so
   output is platform-independent.

## Golden authoring policy

- **Detection.** A fixture is deferred iff its token stream contains a real `dollar-ref` token.
  Comments/strings that merely contain `$` do not defer (`lexical/comments-escapes` is plain).
- **Plain fixtures (38):** `expected/css` is exactly the pretty output of
  `parse` → `lower` → `groupRuns` → `flattenIr` → `emitCss`, byte-for-byte.
- **Empty output:** the only plain fixture with no CSS (`errors/semicolonless-modifier`) uses the
  sentinel line `/* no css: see expected/diagnostics.json */`; the golden runner treats that as an
  expectation of `""`. Every non-empty output is authored as real CSS (partial-output policy: only
  valid constructs emit).
- **Stage note:** goldens are post-flatten but **pre-A08 substitution**, **pre-A09 naming** and
  **pre-P5 project configuration**, so selectors are `".button"`, not `".ui-button"`,
  `global/escape` still contains `:global(.external-icon)` (A09 owns removal), and
  `config/project-json` uses the built-in `md` query (its config override is the same value).
  A08/A09/P5 will refresh their affected goldens.
- **Concurrency note:** A08 was writing `$` goldens while this task ran and authored 8 of the 10
  deferred files. No plain-fixture golden was overwritten; this task's code writes nothing to
  fixtures.

## Deferred fixtures (10) — reason: real `$` references, A08 substitution

| Fixture | Reason |
|---|---|
| `canonical/button` | `$spacing`, `$radius`, `$theme.primary` |
| `runtime/basic` | `$primary` runtime token |
| `runtime/collision-with-compile-time` | `$primary` collision case |
| `runtime/with-variant` | `$surface`, `$accent` runtime tokens |
| `variables/ambiguous-import` | `$spacing` ambiguous import |
| `variables/basic` | `$radius`, `$gap`, `$border` token sequences |
| `variables/cycle` | `$a` cycle error |
| `variables/local-overrides-imported` | `$gap` override |
| `variables/namespaced-members` | `$layout.spacing`, `$layout.margin`, `$gap` |
| `variables/undefined-ref` | `$missing` error |

These are excluded from A06's byte-exact assertion and listed in `tests/compiler/golden.test.ts`.

## Test evidence

```text
bun test tests/compiler/selectors.test.ts tests/compiler/emitter.test.ts tests/compiler/golden.test.ts
  59 pass / 0 fail, 324 expect() calls (26 selectors + 30 emitter + 3 golden)

bun run verify
  typecheck: tsc -p packages/compiler, packages/cli, packages/language-service → pass
  lint:      biome check . (225 files)                                          → pass
  test:      346 pass / 0 fail across 16 files                                  → pass
  exit 0
```

Coverage highlights:

- Flattening: descendant chains, all ADR-0012 positions, escaped/string/comment/attribute
  ampersands, equal/mixed/unknown parent lists, complex parents, child-list cross-product order,
  multi-level lists, pseudo-element rejection, all rejection paths, `flattenIr` inside native
  blocks and idempotence.
- Emitter: pretty/minify exact pairs; one-media-wrapper AND composition; several native media
  contexts; media-type/condition joining with the type placed first; `@supports`/`@layer` outside
  media; media-list and `not` nesting; statement at-rules; descriptor at-rules; keyframes; nested
  native blocks; empty blocks; empty value/property and inline-variant-without-base diagnostics;
  `!important` non-duplication; declaration order; minify token preservation (`@` strings, `url`,
  `calc`, custom properties, prelude text); adversarial IR; CRLF bytes; determinism.
- Goldens: 48-input catalog split (38 plain / 10 deferred), all 38 byte-exact, and
  `stripStructuralWhitespace(pretty) === stripStructuralWhitespace(minify)` for every input.

## Blockers and handoff

- **Blockers:** none.
- **Lowering/IR gaps found:** none blocking. Two notes: (a) `RuleIr` does not distinguish a base
  segment from a variant, so the emitter's empty-value message must cover both cases (documented
  above); (b) no fixture contains a native at-rule, so native composition is covered by unit tests
  rather than goldens — browser cascade validation remains the lead's follow-up.
- **A05 handoff items:** `RuleIr.ancestors` is used for flattening, `NativeBlockIr.statement` for
  `@name prelude;`, `NativeBlockChild` declarations for descriptors, and native wrappers are emitted
  once from the block node.
- **A08/A09:** `$` fixtures deferred to A08 (some already authored concurrently); class prefixing
  and `:global(...)` removal belong to A09 and will change selectors/goldens later.
- **Barrel:** `src/index.ts` untouched; lead wires `flattenIr`/`emitCss` into the pipeline at
  integration.
- **Browser verification:** not run in this task (lead-owned); mark unverified, not passed.
