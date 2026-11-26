# CSSX-A04 — Recursive-descent Xessa parser (P1)

## Summary

- Implement the recursive-descent xessa parser in `packages/compiler/src/parser/` against the frozen AST/diagnostic contracts, consuming a `readonly Token[]` stream.
- Full grammar per SPECIFICATION.md §3.2 EBNF incl. owner decisions D1–D3, per-segment `!important` (ADR-0003), semicolon recovery (XESSA1002/ADR-0011) and malformed-value recovery (XESSA1003).
- No lexer work — A03 owns `src/lexer/`; your tests drive the parser directly with token streams built from fixture sources via a small local test helper.

**Status:** implemented; `bun run verify` exit 0 (105 tests, 48 parser tests); awaiting lead
verification. No `.ai/PROGRESS.md` row touched. Frozen types and `src/index.ts` unchanged.

## Created files

| File | Contents |
|---|---|
| `packages/compiler/src/parser/index.ts` | Facade: `parseTokens(tokens, file): ParseResult`; defensive never-throw wrapper; JSDoc for all statement-depth rules. |
| `packages/compiler/src/parser/cursor.ts` | `TokenCursor` (trivia skipping, raw ranges), `isTrivia`, `tokenAt`, `textOf`, `trimWhitespace`, `lastContentIndex`, `spanOf`. Raw slices are rebuilt from token values only. |
| `packages/compiler/src/parser/diagnostics.ts` | `DiagnosticBag` (source-ordered, frozen) and `messages` carrying the fixture phrases. |
| `packages/compiler/src/parser/modifier.ts` | `readModifier`: `@alias(+alias)*` with adjacent-`+` joins, duplicate aliases preserved. |
| `packages/compiler/src/parser/value.ts` | Top-level value segmentation, per-segment `!important` detection, conditional `tokens` capture. |
| `packages/compiler/src/parser/recovery.ts` | `recoverStatement`, `skipBalancedBlock`, `skipStatementBlock`, `skipAtRule`. |
| `packages/compiler/src/parser/declaration.ts` | Declaration parse: property colon, balanced value scan, XESSA1002/1003 policy, ADR-0011 termination. |
| `packages/compiler/src/parser/rule.ts` | `classifyStatement` lookahead, `parseRule`, `parseConditionalBlock`, `parseNativeAtRule`, native at-rule table. |
| `packages/compiler/src/parser/statements.ts` | `@setup`, `@use`, `@variables`, `@runtime`, `@media-types`, top-level dispatch, `parseStylesheet`. |
| `tests/compiler/parser.test.ts` | 48 tests: local contract-faithful token scanner, all error fixtures, canonical AST, structural/lexical cases, totality checks. |
| `.ai/tasks/CSSX-A04.md`, `.ai/reports/CSSX-A04.md`, `.ai/reports/logs/CSSX-A04.log` | Task, report and worker log. |

No other files changed. No framework bug/feature records were required (this is application work, not
a framework defect).

## Public API

```ts
export function parseTokens(tokens: readonly Token[], file: string): ParseResult;
```

`ParseResult` is the frozen `{ ast: Stylesheet; diagnostics: readonly Diagnostic[] }`. There is no
`parseSource`: the parser consumes tokens only. Barrel wiring (`src/index.ts`, `parse(source, options)`)
remains a lead-directed step; the future wrapper is `parseTokens(tokenize(source, file), file)`.

## Grammar and recovery decisions

| Decision | Justification |
|---|---|
| Token-only input; raw slices rebuilt by concatenating `token.value`; spans from token offsets. | `types/token.ts` (stream reproduces source exactly; `function` omits `(` and is followed by `lparen`); ADR-0005; SPECIFICATION.md §11. |
| Skip whitespace/comment trivia between statements; whitespace only trimmed at slice boundaries, never reflowed. | §3.1 (comments/whitespace fidelity), ADR-0005 "no normalization". |
| Top-level dispatch: `@setup`, `@use`, `@variables`, `@runtime`, `@media-types`, rules, native at-rules. Directive/native names matched case-insensitively. | §3.2 EBNF; §3.5. |
| Multiple `@setup` blocks → one `SetupBlock` per block; duplicate keys preserved as separate `Setting` nodes; no duplicate/unknown-key diagnostic from the parser. | AST `SetupBlock` JSDoc ("multiple nodes … resolver merges"); `Setting` JSDoc ("configuration layer owns decoding and validation"); task requirement 2. |
| `@use "spec" [as alias];`; `path` is the raw text between the quotes (no escape decoding); alias absent when no `as`. | AST `UseImport` JSDoc; §6.1. |
| Top-level `@alias {` for an unknown non-native name → XESSA1001 at the `@alias` token, skip the balanced block, emit no node; the next statement parses. | D3, §3.4, ADR-0004; AST `Stylesheet` JSDoc. |
| Unknown top-level `@ident` with a prelude or `;` is a native at-rule passthrough; a bare `{` is treated as a conditional block (see row above). | Task requirement 2 ("unknown `@ident` … native passthrough") reconciled with D3; known native names never become conditionals (§3.4). |
| Native at-rule names: `charset, container, counter-style, document, font-face, font-feature-values, font-palette-values, import, keyframes, layer, media, namespace, nest, page, position-try, property, scope, starting-style, supports, view-transition`. | §3.4/§3.5 list; extended with common modern block at-rules so they pass through. |
| Rule vs declaration by balanced lookahead: `{` at depth 0 before `;`/`}` → rule; otherwise declaration; colon presence never decisive. | §3.4; ADR-0002; task requirement 2. |
| Bare nested selectors stay `Rule` nodes with raw selector text (D1 is lowering's job). Selector/`selectorSpan` = selector text trimmed of boundary whitespace; lists and functional pseudos stay one raw slice. | ADR-0002, ADR-0012, §7.1; AST `Rule` JSDoc. |
| Conditional block = `@alias(+alias)*` followed by `{` inside a rule or another conditional block. Native at-rule inside a conditional block → XESSA1001 at the at-rule and `skipAtRule`, no node. | §3.2 grammar; ADR-0004; AST `ConditionalBlock` JSDoc; task requirement 2. |
| Modifier segmentation at value depth 0 only; plain `at-keyword` split only when preceded by whitespace (or when the token is already `modifier`); `+` joins and duplicates preserved. | §3.1 (whitespace requirement, inert `@` in strings/URLs/functions); token `modifier` JSDoc; AST `Modifier` JSDoc. |
| Per-segment `!important`: trailing `!` + `important` (whitespace tolerant, case-insensitive) sets only that segment's `important` flag and stays in the raw value. | §3.3, §5.4, ADR-0003. |
| `tokens?` on base/variant/token declarations only when the segment contains a `dollar-ref`; covers the trimmed raw token range including internal whitespace/comments. | ADR-0005; task requirement 2. Ranges include trivia so substitution can re-emit fidelity. |
| Semicolonless final declaration before `}`/EOF accepted only when it has no modifier and no `$`; otherwise XESSA1002 with the statement span and the node is omitted. | §3.1; ADR-0011; tests/fixtures/README.md. |
| Missing semicolon *between* two declarations detected when a value reaches a new line, then `ident :` (trivia tolerant). XESSA1002 at the statement start, then the new declaration parses. | errors/missing-semicolon; README "recovery resumes at the next statement". Newline + property-colon lookahead avoids colon-in-value false positives. |
| Malformed value (unbalanced/mismatched `()`/`[]`, or depth > 0 at the terminator) → one XESSA1003 per statement spanning start→terminator; recovery consumes the next `;` (or stops before `}`/EOF). | XESSA1003 registry summary; §12 "reported once per statement"; errors/malformed-value must keep `height` parseable. |
| Unclosed block → XESSA1001 with the construct start→EOF span; the partial node is retained (for rules the closing brace is missing). | §12; ADR-0004 recovery; errors/unclosed-block points at EOF (position inside the span). |
| Declaration span = property start → last value character (excluding `;`); `Setting`/`TokenDeclaration`/`AliasDeclaration` span = key/name start → `;`; directives span through `}`; `Stylesheet` spans `0..EOF`. | Frozen AST JSDoc per node; task requirement 3. |
| `Variant.span` = the modifier span only (`@` through the last `+alias`). | `Variant extends Modifier`; the inherited JSDoc says "covers the modifier text including `@` and `+` joins". The contract has no separate variant-value span. |
| Modifier-first values (`color: @md red;`) and empty variant values are parsed tolerantly (base `""`); no parser diagnostic. | Task requirement 6 defers unknown/invalid-modifier semantics; base-required is a semantic rule (§3.3). |
| Conditional blocks are additionally allowed inside native at-rule blocks (members parsed with the rule-body grammar). | Native block contents are unspecified by §3.2; passthrough keeps authored structure. |
| Every node and collection is frozen; loop guards force progress; a defensive try/catch returns a diagnostic plus a partial stylesheet instead of throwing. | Task requirements 1, 3, 4; §12 tolerant parse. |

## Test evidence

`bun test tests/compiler/parser.test.ts` → **48 pass / 0 fail, 726 assertions**.
`bun run verify` → **exit 0** (typecheck + biome + 105 tests across 6 files).

The test file builds token streams with a local, contract-faithful scanner (whitespace/comments emitted,
`function` separate from `(` , `url(...)` atomic, escapes preserved, trailing `eof`); it does not import
A03.

Coverage highlights:

- **Parser-owned error fixtures reproduce the authored diagnostics** (code + severity + position inside
  the reported span): `errors/top-level-conditional` (XESSA1001 at `@md`), `errors/missing-semicolon`
  (XESSA1002 spanning `color: red`, `background` still parses), `errors/malformed-value` (single
  XESSA1003 spanning the `calc(` statement, `height` still parses), `errors/unclosed-block`
  (XESSA1001 at EOF with the partial rule retained), `errors/semicolonless-modifier` (XESSA1002,
  declaration omitted).
- **Semantic-only fixtures are pinned structurally** (see Contract concerns): `unknown-modifier` yields
  one Variant `["ultrawide"] → "blue"` with the variant span at line 3 col 14; `unknown-setup-key`
  keeps keys `prefix, theme`; `duplicate-setting` keeps two `prefix` settings with the second span at
  line 3 col 3.
- **Canonical button fixture**: no diagnostics; item order `setup, use, variables, rule`; exact setup /
  setting / `@use` / variables / selector / declaration / variant spans; `padding` base `$spacing` with
  `[dollar-ref]` tokens and variants `md→20px`, `xl→32px`; `background` base `$theme.primary` +
  `@dark #1e40af`; `font-size` `@md 16px`; nested `&:hover`, `&:disabled`, `& > .icon`.
- **Structural**: descendant nesting (D1), `.label .text`, multiple `&` (`& + &`, `.row &`), selector
  lists + functional pseudos, nested conditional blocks (`@md` → `@dark`), native at-rules top-level and
  in-rule, native inside conditional → XESSA1001, multiple `@setup`, `@use` without alias,
  `@media-types` raw conditions, duplicate/combined aliases, `@runtime` inline variants, per-segment
  `!important` (base only, variant only, both).
- **Lexical**: `@` in strings, quoted/unquoted `url(...)`, `12px@md` literal, `@md` inside `calc(...)`,
  whitespace-preceded `@` after `url`, comments and escaped `.status\:active`.
- **ADR-0005**: token sequences only with `$`, multi-token trimmed ranges.
- **Totality**: empty input, missing `eof`, every fixture input, garbage input, and every truncated
  prefix of the canonical token stream (0..n) parse without throwing; nodes/arrays are frozen.

Supplementary integration probe (not a committed test, because A03's lexer is outside this task's test
scope): tokenizing all 48 fixture `input.xessa` files with `src/lexer/index.ts` and feeding the real
streams to `parseTokens` reproduced the same result — lexical diagnostics empty, parser diagnostics only
for the five parser-owned error fixtures, and identical shapes for the spot-checked cases:

- `media/combined-and` aliases `[["dark"],["xl","dark"]]`, `[["md","landscape"]]`, `[["2xl"]]` even
  though the lexer emits `@xl`, `+`, `dark` as three tokens.
- `media/duplicate-aliases` keeps `["md","md"]` and `["xl","dark","dark"]`.
- `lexical/no-whitespace-modifier` value `12px@md 20px` with no variants.
- `important/per-segment` flags: base-only true, variant-only true, base+variant both true.
- `errors/top-level-conditional`: one XESSA1001 at `@md` and only the following `.card` rule.
- `canonical/button`: no diagnostics; `$spacing` + `md/xl`, `$theme.primary` + `dark`, nested
  `&:hover`, `&:disabled`, `& > .icon`.
- `errors/missing-semicolon`: XESSA1002 over `color: red` with `background` retained.

## Contract concerns / deviations (no blockers)

1. **Three `errors/*` fixtures are semantic, not parser-owned.** `errors/unknown-modifier` expects
   XESSA3001 (needs the alias registry/config), `errors/unknown-setup-key` expects XESSA1001 (needs the
   settings schema), `errors/duplicate-setting` expects XESSA1001 (needs merged `@setup`). The parser
   deliberately emits none: task requirement 2 assigns duplicate rejection to the resolver and the
   authoring rules make the configuration layer own key/value validation; `types/diagnostics.ts` makes
   XESSA3001 a media-family code. The task's own parenthetical for `unknown-modifier` and acceptance
   criterion 2's wording ("all `errors/*` diagnostics reproduce") are therefore reconciled by
   documenting these three as later-phase checks; the parser pins their AST shape and exact positions
   (line 3 col 14 / 3 col 3 / 3 col 3) so the semantic phase can reproduce them. Lead confirmation would
   close this item; nothing is needed from A04's side unless the expectation is that the parser
   hardcodes alias/settings tables (which would break configuration-dependent aliases).
2. **`Variant.span` is modifier-only.** The frozen contract inherits `Modifier.span`'s "covers the
   modifier text including `@` and `+` joins" and provides no value span. Tests pin that reading; if
   lowering needs the full segment span, that is an additive contract change requiring approval.
3. **Native at-rule detection uses a name table** so `@md {` is a conditional error while
   `@starting-style {`/`@media {` pass through. A future native at-rule absent from the table but written
   without a prelude would be diagnosed as a top-level conditional; the table is the only spec-derivable
   distinction (ADR-0004 lists native names).
4. **Semicolonless-between-declarations detection is heuristic** (newline then `ident :`). It matches the
   fixture and avoids colon-in-value false positives; a same-line missing semicolon (`color: red
   background: blue;`) parses as one value because §3.4's lookahead rule gives no other boundary.
5. **`tokens` includes internal whitespace/comments** in the trimmed range (ADR-0005 "parsed token
   sequence (literal and reference tokens)"). Downstream substitution should treat trivia as literal.
6. No lexer integration was added; `parseTokens` is internal until the barrel step. A03's `at-keyword`
   streams work unchanged (the parser does the `modifier` promotion).
7. ADR-0011 wording "a declaration whose value tokens end at `}`/EOF is accepted WITHOUT diagnostic only
   if it contains no modifier and no dollar-ref" is implemented exactly; `errors/semicolonless-modifier`
   and `lexical/final-no-semicolon` both pass.

## Blockers

None.

## Handoff

- A05/A06/A07 can consume `parseTokens` from `packages/compiler/src/parser/index.ts` now; it is pure and
  zero-dependency.
- Lead wiring step (not done here): `src/index.ts` `parse(source, options)` should become
  `parseTokens(tokenize(source, options.file), options.file)` once A03's `tokenize` lands.
- Semantic phases must implement: unknown alias (XESSA3001), unknown/duplicate setup keys (XESSA1001),
  inline variant without a base or with an empty value (§3.3), and the conditional-alias table.
- Files touched are exactly the allowed scope; no configs, fixtures, docs, frozen types or
  `.ai/PROGRESS.md` were modified.

## Integration (lead-directed)

**Status:** lexer → parser wired through the barrel; `bun run verify` exit 0 (157 tests / 7 files;
pipeline test 52 tests / 1,616 assertions).

- `packages/compiler/src/index.ts`: `parse(source, options)` now runs
  `tokenize(source, options.file)` → `parseTokens(tokens, options.file)` and returns the frozen
  `ParseResult`. Diagnostics merge **lexical first, then syntactic** (both XESSA1xxx, each stage
  already in source order); the JSDoc documents the ordering. `tokenize` and `TokenizeResult` are
  re-exported as A03 requested. `compile`, `compileProject` and `planOutputs` keep their
  `not implemented (P1+)` stubs. No frozen type changed.
- `tests/compiler/pipeline.test.ts` (new, owned here): discovers all 48 fixture entries and, for each,
  asserts the stream invariants through the public `tokenize` (single trailing zero-width `eof`,
  byte-exact `value` round-trip, spans ending at `source.length`), then runs the barrel `parse` and
  asserts a `Stylesheet` with the whole-file span. Non-error fixtures must be diagnostic-free; the
  five token-derivable `errors/*` fixtures must reproduce the authored **code + severity** multiset
  (messageContains/span stay in `parser.test.ts`). Additional invariants: lexical diagnostics precede
  syntactic ones regardless of offsets (unterminated string at offset 14 vs unclosed rule at 0),
  `parse` never throws for every prefix of the canonical source, empty/garbage sources still yield a
  stylesheet.
- Three `errors/*` fixtures remain semantic-only (no pipeline diagnostic today, by design, matching
  the A04 contract note): `unknown-modifier` (XESSA3001, media phase), `unknown-setup-key` and
  `duplicate-setting` (XESSA1001, configuration/setup resolution). The pipeline test pins their
  authored code lists as a drift guard and asserts zero pipeline diagnostics, so the boundary cannot
  regress silently.
- **Deviation for review:** `tests/compiler/contract.test.ts` asserted the old `parse` stub throws.
  Implementing `parse` made that phase-status assertion stale, so the single `parse` line was removed
  and the test renamed `remaining unimplemented entry points report the phase stub` (the other three
  stubs are still asserted). That file is outside the three paths named in the follow-up, but leaving
  it unchanged would fail `bun run verify`; no type, lexer, parser, fixture or `PROGRESS.md` file was
  touched. Revert/replace freely if the lead prefers a different contract-test update.
