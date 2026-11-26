# CSSX-A17 report — semicolonless declaration before a nested rule

## Summary

- `parse()`/`compile()` no longer swallow a declaration that runs into a nested rule's `{`. The
  reproduction `.button { color: red\n  &:hover { color: blue; } }` now reports exactly one
  **XESSA1002**, keeps the authored `color: red` declaration, keeps `&:hover` as a nested rule, and
  emits valid CSS (before the fix it emitted the invalid selector line `color: red\n  .ui-button:hover`).
- The fix is parser-only (`packages/compiler/src/parser/**`), uses the existing frozen XESSA1002 code,
  and enforces ADR-0011 as written plus invariant 2 (never silently swallow) and invariant 1 (never
  emit invalid CSS).
- The ADR-0011 allowance is intact: a plain-CSS final declaration without `;` before `}` stays
  diagnostic-free (existing `lexical/final-no-semicolon` golden plus an explicit unit test).
- New regression fixture + 6 focused parser unit tests; no existing golden `expected/css` file changed.
  `bun run verify` is green (656 tests / 39 files, typecheck and Biome clean).

## Root cause

`classifyStatement` (parser/rule.ts) decided rule-vs-declaration by balanced lookahead only: the first
top-level `{` before `;`/`}` made the statement a **rule**. For `color: red` followed by `&:hover {`,
the declaration prefix became part of the selector, so the value was dropped without any diagnostic and
the emitter printed the bogus selector. Nothing consulted ADR-0011 during that decision.

## Fix (parser module only)

| File | Change |
|---|---|
| `src/parser/value.ts` | New `findSemicolonlessRuleStart(tokens, statementStart, openIndex)`: returns the raw index where the nested rule's selector starts when the statement unambiguously begins as a declaration (`ident`, `:`, non-empty value) and a selector-start token precedes the `{`. `&` is decisive (it can never be declaration-value content); `.`, `#`, `[`, `>`, `*` count only at a line break and never directly after `,` (selector-list continuation). Paren/bracket depth is tracked, so `calc(...)`, `[full-start]` and strings stay inert. Empty-prefix candidates are skipped, so a value like `#fff` is never mistaken for the boundary. |
| `src/parser/rule.ts` | `classifyStatement` consults that helper at the top-level `{`: `declaration` when a boundary exists, `rule` otherwise. JSDoc records the ADR-0011 exception. |
| `src/parser/declaration.ts` | `scanValue` now takes the statement start. A balanced `lbrace` terminator returns the selector start as the boundary and `malformed: false`; `parseDeclaration` then reports one XESSA1002, returns the authored declaration and leaves the cursor at the nested rule. Unbalanced/ambiguous braces keep the previous XESSA1003 + `skipBalancedBlock` recovery. |
| `src/parser/cursor.ts` | `startsNewLine` moved here so `declaration.ts` and `value.ts` share it. |

No `types/**`, lexer, lowering, selector, emitter or naming change; semantics are unchanged and ADR-0011
is now actually enforced. Recovery never throws and always returns an AST (`parseTokens` guard intact,
truncated/garbage streams covered by existing tests).

### Documented heuristic limits (deliberate)

- Ambiguous selector starts (`.`/`#`/`[`/`>`/`*`) require a line break, so valid one-line nested
  selectors such as `div:hover .child { … }` and `li:nth-child(2n) > a { … }` stay rules (tests pin
  both), as does `a:hover,\n.b { … }` (comma guard). A nested selector broken *before* a combinator
  across lines (`div:hover` newline `> .child`) is the accepted ambiguous case: it now reports rather
  than silently mis-parses.
- A `{` that follows a balanced value with no selector-start char (e.g.
  `width: calc(100% - 20px) { … }`) keeps the pre-existing rule classification; that construct is out
  of this task's shape and already fails later in `flattenIr` (XESSA1001).
- At top level a declaration is still XESSA1001, so `color: red` + `&:hover {` written at top level
  reports the declaration error and then the unexpected `}` token; the nested body is not silently
  emitted.
- Kept declarations include Xessa-syntax values (`padding: 10px @md 20px`, `$x`) per the task's
  "parse it as the authored declaration and keep the following nested rule intact"; they are always
  error-gated by XESSA1002, so no invalid CSS reaches a build.

## Before / after (exact, same harness)

before (`git archive HEAD packages/compiler/src`, identical source):

```
parse   diagnostics: []
parse   body: [ rule("color: red\n  &:hover") ]
compile diagnostics: []
compile css: "color: red\n  .ui-button:hover {\n  color: blue;\n}\n"     <- invalid CSS, value lost
```

after:

```
parse   diagnostics: [XESSA1002 spanStart=37 spanEnd=47]     (authored "color: red")
parse   body: [ declaration "color: red", rule("&:hover") ]
compile diagnostics: ["XESSA1002"]
compile css: ".ui-button {\n  color: red;\n}\n\n.ui-button:hover {\n  color: blue;\n}\n"
```

## Tests, fixture and goldens

- New fixture `tests/fixtures/errors/semicolonless-before-nested-rule/` (`input.cssx`,
  `expected/css`, `expected/diagnostics.json` = one XESSA1002 at line 3 col 3, `messageContains:
  "semicolon"`). The golden CSS was produced by the pinned pipeline and reviewed line by line; both
  the declaration and the flattened `&:hover` rule are present.
- `tests/compiler/parser.test.ts`: fixture added to `PARSER_ERROR_FIXTURES` (span check) plus six new
  tests — fixture/AST/span shape, inline reproduction, ADR-0011 final-declaration allowance on
  `lexical/final-no-semicolon`, one-line valid nested selectors, selector list continued after a line
  break, and `background: #fff` + `&::before` (hash-value regression).
- `tests/compiler/golden.test.ts`: new `compile()` test asserting one XESSA1002 and that the emitted
  CSS both contains `color: red` and equals the new `expected/css`; catalog totals updated.
- **No existing golden `expected/css` changed** (`git status` shows only runner catalogs, the fixture
  README and the new fixture). The three deltas in the catalog runners are counts/lists only:
  48 → 52 entries, 38 → 39 plain, 8 → 9 `errors/*`. They are required because CSSX-A19's three
  `keyframes/*` `input.cssx` fixtures are already in the tree (all `$keyframes` → deferred) and this
  task adds one plain fixture. Nothing was regenerated blindly.
- Evidence: `bun test tests/compiler/parser.test.ts` 55 pass; `bun test tests/compiler/golden.test.ts
  tests/compiler/pipeline.test.ts` 60 pass; `bunx biome check` on the touched files clean.

## Gates

| Gate | Result |
|---|---|
| `bun run typecheck` (4 projects) | 🟢 pass |
| `bun run lint` (373 files) | 🟢 clean |
| `bun run test` | 🟢 656 pass / 0 fail (39 files) |
| `bun run verify` | 🟢 pass |
| `bun run test:browser` | ⚪ not run — no existing CSS output or cascade behavior changed; no harness scenario authors a semicolonless declaration before a nested rule |

One earlier `verify` run failed `tests/extension/host.test.ts` (Electron host exited 1) while CSSX-A18/
A19 were writing `packages/vscode`/`resolver`; the isolated run and the immediate full re-run were
green, so it is recorded as a transient, not a regression.

## Handoff / coordination notes

- Shared-file collision: `tests/compiler/{golden,pipeline,formatter,sourcemap}.test.ts` and
  `tests/fixtures/README.md` are writable by CSSX-A19 too (its task claims the same catalog count/list
  updates). I preserved A19's keyframes edits and set the totals to the final tree state I observe
  (52 entries, 39 plain, 9 error fixtures). If A19 adds more `input.cssx` fixtures afterwards, only
  those four count/list blocks need a bump; the parser change is independent of them.
- Not changed and intentionally untouched: `types/**`, `SPECIFICATION.md`, ADRs, `.ai/todo.md`,
  `.ai/PROGRESS.md`, vscode package, other compiler stages.
- No `.ai/framework/<Framework>/bugs|features/` record was created: this is a defect in this
  repository's own `@xessa/compiler` parser, not in a third-party framework, and AGENTS.md limits
  framework records to external-framework defects/features (so no framework version applies).
- Nothing was committed or pushed.
