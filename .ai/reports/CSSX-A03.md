# CSSX-A03 — Stateful xessa tokenizer (P1)

## Summary

- Implement the stateful xessa tokenizer in `packages/compiler/src/lexer/` against the frozen Token/Span/Diagnostic contracts.
- Recognize modifier tokens only at rule-body value/block depth, per the frozen token JSDoc; `@` inside strings/comments/urls/parens stays ordinary CSS content.
- Full unit tests pinning every lexical fixture; no parser work — A04 owns `src/parser/`.

**Status:** implemented; `bun run verify` exit 0 (typecheck → lint 190 files clean → 105 tests pass, 6
files), lexer suites 49 pass. No `.ai/PROGRESS.md` row was touched.

## Objective delivered

`packages/compiler/src/lexer/` now contains a pure, dependency-free, single-pass tokenizer with the
frozen public shape:

```ts
tokenize(source: string, file: string): {
  tokens: readonly Token[];
  diagnostics: readonly Diagnostic[];
}
```

Every stream ends with exactly one zero-width `eof` at `source.length`; token spans are contiguous
half-open offsets starting at 0, so concatenating `source.slice(token.start, token.end)` reproduces the
input byte for byte; `file` is copied into every diagnostic span. The tokenizer never throws, recovers
at a resumable boundary for every malformed construct, and is linear in the input length with a hard
structural bound of `source.length + 1` tokens.

No file outside the allowed scope was modified: `src/types/**` is untouched, `src/index.ts` is
untouched, `src/parser/**` is untouched, and no fixture, config or doc was edited.

## Created files

| File | Lines | Responsibility |
|---|---|---|
| `packages/compiler/src/lexer/index.ts` | 37 | Facade: `tokenize`, `TokenizeResult`. Documents losslessness, eof, purity and the parser-owned `modifier`. |
| `packages/compiler/src/lexer/scanner.ts` | 199 | Stateful main loop: whitespace runs, comments, strings, `@`, `$`, `#`, numbers, idents/functions/urls, punctuation, illegal characters, recovery, `eof`. |
| `packages/compiler/src/lexer/characters.ts` | 82 | Code-unit classification (whitespace, newline, digit, hex, name, illegal) and `escapeEnd` (hex escapes, whitespace terminator, CRLF, invalid escapes). |
| `packages/compiler/src/lexer/names.ts` | 49 | `nameEnd`, `isIdentStartAt`, `identEnd` — used by idents, units, hashes, `@` and `$`. |
| `packages/compiler/src/lexer/numbers.ts` | 59 | `isNumberStartAt`, `numberEnd` — sign, fraction, exponent, `%` and identifier unit. |
| `packages/compiler/src/lexer/strings.ts` | 52 | `scanString` — quotes, escapes, escaped line continuation, unterminated-at-newline recovery. |
| `packages/compiler/src/lexer/comments.ts` | 27 | `scanComment` — linear `indexOf` close, unterminated-at-EOF. |
| `packages/compiler/src/lexer/urls.ts` | 63 | `isUrlName`, `scanUrl` — quoted and unquoted paths, one token, resumable failure end, `unterminated`/`malformed`. |
| `packages/compiler/src/lexer/at-keywords.ts` | 29 | `scanAtKeyword` — `@` + name only; states why classification is parser-owned. |
| `packages/compiler/src/lexer/dollar-refs.ts` | 23 | `scanDollarRef` — `$name` and at most one `.member`; bare `$` stays a `delim`. |
| `packages/compiler/src/lexer/diagnostics.ts` | 42 | `XESSA1001` factory, message catalog, illegal-character message. |
| `tests/compiler/lexer.test.ts` | 358 | API/stream invariants, strings/comments/urls, functions/numbers/hashes/references, diagnostics/recovery, adversarial termination. |
| `tests/compiler/lexer.fixtures.test.ts` | 510 | All 7 lexical fixtures: pinned kind sequences, losslessness, eof, no diagnostics, and `@`-boundary position facts replayed from the token stream. |
| `tests/compiler/lexer.invariants.test.ts` | 180 | Exhaustive hostile alphabet (11 110 sources), 1 500 deterministic pseudo-random sources, large single-token runs. |

Plus `.ai/tasks/CSSX-A03.md`, this report and `.ai/reports/logs/CSSX-A03.log`.

## Token-classification decisions

Each row names the frozen JSDoc sentence that justified it. Line numbers refer to
`packages/compiler/src/types/token.ts`.

| # | Decision | Justification |
|---|---|---|
| 1 | **The lexer never emits `modifier`.** Every `@` name is `at-keyword` at every depth; promotion is the parser's job. | token.ts 42–50: "The tokenizer never emits this kind on its own: the parser reclassifies `at-keyword` to `modifier` only at top-level value depth (inline variants) or in block-condition position. It must not occur anywhere else, so an `@` inside strings, comments, URLs, functions or without preceding whitespace never becomes one." Reinforced by A02's frozen decision 4 and its A03 handoff ("emit `at-keyword` (never `modifier`)"). |
| 2 | `@` followed by a name → one `at-keyword` including `@`; bare `@` → `delim`. Digits may start the name (`@2xl`). | token.ts 33–39 ("An `@` name such as `@media` or `@setup`, including the `@`") plus SPECIFICATION.md §3.2 ("Aliases may begin with digits (for example `2xl`)"), so the scan uses the name grammar, not the stricter identifier-start rule. |
| 3 | `@xl+dark` → `at-keyword("@xl")`, `delim("+")`, `ident("dark")`. The parser synthesises the single `modifier` token whose value preserves `@` and `+`. | token.ts 42–47 says a `modifier` is "such as `@md` or `@xl+dark`, with the `@` and any `+` joins preserved" while `at-keyword` is a single `@` *name*; `+` is not a name character. A04's `readModifier` already rejoins adjacent `+ alias` tokens. |
| 4 | `ident` immediately followed by `(` → `function` whose `value`/span cover the name only, then a separate `lparen`. | token.ts 18–19 ("the immediately following `(` is emitted as a separate `lparen`") and 67–72 (`function` value excludes the parenthesis). |
| 5 | `url(...)` is one `url` token covering name, parentheses, quotes and interior `@`/`$`; the name match is ASCII case-insensitive. | token.ts 16: "A complete `url(...)` construct including parentheses, quotes and any `@` or `$` inside." Case-insensitivity follows the CSS tokenizer, which treats `url(` specially in any casing. |
| 6 | Strings keep the quotes and never decode escapes; `@ $ { } ;` inside are inert. | token.ts 14 and 4–8 ("never normalizes escaped text"). |
| 7 | One `number` token absorbs an identifier unit or a trailing `%`. | token.ts 12 ("Numeric token such as `12`, `0.5` or `10px`, kept as authored") and the frozen union's lack of a percentage/dimension kind. |
| 8 | `$name` and `$name.member` are single `dollar-ref` tokens; a bare `$` is `delim`. A second member (`.c` in `$a.b.c`) stays separate. | token.ts 40: "either `$name` or `$name.member`, including the `$`" — exactly two forms are listed. |
| 9 | `#` followed by a name character → `hash` including `#`; a bare `#` → `delim`. | token.ts 31 ("A `#` name or hash value such as `#2563eb`"). |
| 10 | Whitespace runs collapse into one `whitespace` token; block comments are their own `comment` token. | token.ts 51–54, "emitted so token streams can reproduce the source exactly"; A04's cursor treats both as trivia. |
| 11 | Escapes are measured, never decoded; a hex escape consumes at most six digits plus one optional whitespace terminator, so `\31 23` stays one `ident`. | token.ts 10 ("including escaped characters (`\31 23`, `status\:active`)"). |
| 12 | `!important` stays `delim("!")` + `ident("important")`; no dedicated token and no special casing. | ADR-0003: "The tokenizer keeps `!important` in the value's raw token slice; it is not a modifier alias." |
| 13 | An unescaped line break ends an unterminated string **before** the break, so the next line lexes normally. | SPECIFICATION.md §3.1 requires recovery at safe boundaries so the editor can continue; the CSS bad-string rule ends at the newline. |
| 14 | `12px@md` yields adjacent `number` + `at-keyword` with no injected whitespace, which is the lexical fact the parser uses to reject it as a modifier. | SPECIFICATION.md §3.1: modifiers are recognized "after whitespace … outside strings, comments, URLs and functions". |
| 15 | C0 controls other than CSS whitespace (and NUL) are illegal; DEL is allowed through. | SPECIFICATION.md §3.1/§12 require a lexical family error; CSS itself only calls NUL and other control characters parse errors, so DEL is left as content. |

Classification is **positionally verified** in `lexer.fixtures.test.ts`: a helper replays brace and
parenthesis depth over the token stream and asserts, per fixture, where an `at-keyword` sits in a
position the parser may promote (`promotable`). Results: `at-mid-value` `@md` is promotable (brace
depth 1, paren depth 0, whitespace before); `calc` `@md` is not (paren depth 1); `no-whitespace-modifier`
`@md` is not (no preceding whitespace, directly adjacent to `12px`); `at-in-string`, `url-at` and
`comments-escapes` contain no `at-keyword` at all; `@setup` is never promotable (brace depth 0).

## Lexical diagnostics

All lexical failures are `XESSA1001` / `error`, per the frozen registry summary that the anchor covers
"a lexer-level recovery" (`types/diagnostics.ts` 53–59). Spans cover the offending construct and stay
inside the source:

| Case | Message contains | Span |
|---|---|---|
| Unterminated string (EOF or unescaped line break) | `Unterminated string` | opening quote → close/line break/EOF |
| Unterminated comment | `Unterminated comment` | `/*` → EOF |
| Unterminated `url(` | `Unterminated url` | `url` name → resumable end |
| Quoted path not followed by `)` | `Malformed url` | `url` name → first offending character (not consumed) |
| Invalid escape (`\` at EOF or before a line break) | `Invalid escape` | the single backslash |
| Illegal control character | `Illegal control character U+00XX` | the single code unit |

Recovery is always forward progress of at least one code unit on a non-`eof` token, which is the
termination proof. The `url` malformed case ends *before* the offending character so that character is
lexed normally, and a string that hits a newline resumes after the break.

## Termination and purity

- Zero imports outside `../types/*`; no filesystem, no globals, no randomness, no regex.
- Single loop; every branch pushes a token with `end > start` (except `eof`) and advances `index`.
  Therefore at most `source.length + 1` tokens, asserted in the invariant suite.
- `scanComment` uses `indexOf` (one pass per comment body) and all other scanners advance monotonically.
- Malformed input never throws: verified by 11 110 exhaustive sources over `{@,$,",\,/,*,a,1,),}}` up to
  length 4, 1 500 deterministic pseudo-random sources up to 160 chars, and multi-thousand-character
  single-token runs (`"@"×5000`, `'"'×3000`, `"/*"×2000`, `"url("×1000`, `"a"×50000`, `"\\"×5000`,
  20 000-char quoted url).

## Test evidence

| Command | Result |
|---|---|
| `bun test tests/compiler/lexer.test.ts` | 28 pass, 0 fail |
| `bun test tests/compiler/lexer.fixtures.test.ts` | 18 pass, 0 fail |
| `bun test tests/compiler/lexer.invariants.test.ts` | 3 pass, 0 fail, 782 915 `expect()` calls |
| `bun test tests/compiler/lexer` | 49 pass, 0 fail, 783 298 `expect()` calls across 3 files |
| `bun test` | 105 pass, 0 fail, 784 062 `expect()` calls across 6 files (A01 scaffold + A02 contract + A03 lexer + A04 parser) |
| `bun run typecheck` | exit 0 (compiler, CLI, language-service) |
| `bunx biome check packages/compiler/src/lexer tests/compiler/lexer*.test.ts` | exit 0, 14 files, no fixes |
| `bun run verify` | **exit 0** — "Checked 190 files. No fixes applied", 105 pass / 0 fail |

Fixture pinning, per directory under `tests/fixtures/lexical/`:

| Fixture | Pinned by the tests |
|---|---|
| `at-in-string` | 25-token kind sequence; no `at-keyword`; three raw string tokens incl. `"@xl+dark"`; no promotable position. |
| `at-mid-value` | 30-token sequence; `url("a@b.png")` is one `url`; `@md` is a promotable position (whitespace before, brace depth 1, paren depth 0); `@setup` is not. |
| `calc` | 36-token sequence; both `calc` are `function`+`lparen`; `@md` sits at paren depth 1 and is not promotable. |
| `comments-escapes` | 43-token sequence; no `at-keyword`/`dollar-ref`; comment text keeps `@md`/`$radius`; `--label` and `status\:active` idents; raw `"\"quoted\" @xl"`. |
| `final-no-semicolon` | 19-token sequence; last declaration ends `number("10px")`, whitespace, `rbrace`; a single `;` in the file; no diagnostics (ADR-0011 is parser policy). |
| `no-whitespace-modifier` | 29-token sequence; `number("12px").end === at-keyword("@md").start`; not promotable; `@setup` at brace depth 0. |
| `url-at` | 33-token sequence; three `url` tokens (quoted, unquoted, quoted with slash); no `at-keyword`. |

## Contract concerns and deviations

1. **`modifier` ownership (task prompt vs frozen contract) — resolved in favour of the frozen contract.**
   The task's Requirement 2 asks the lexer to emit `modifier` inside a rule body, but
   `types/token.ts` 42–50 states the tokenizer never emits it, and A02 froze that decision and handed
   it to A03 verbatim. Implementing the prompt literally would have required changing or ignoring the
   frozen JSDoc, so I kept `at-keyword` and made the parser-visible position facts explicit in tests.
   A04's `parser/modifier.ts` already implements the promotion, so the pipeline is consistent. If the
   lead ever reverses this decision, the change is local to `scanner.ts` (track brace/paren depth and
   re-emit the kind) plus a parser simplification — but it would contradict the frozen JSDoc.
2. **`@xl+dark` token shape.** The prompt expected "separate modifier tokens for each `@alias` and
   separate `plus`/delim tokens", while token.ts 43–47 describes one `modifier` with `+` preserved.
   The frozen reading wins: the lexer emits `at-keyword`, `delim("+")`, `ident`; the parser synthesises
   the single modifier (A04 `readModifier`). Both readings are pinned in
   `lexer.test.ts` ("splits a combined alias into at-keyword, plus and ident").
3. **`$a.b.c`.** token.ts 40 lists exactly `$name` and `$name.member`, so a second member is not part of
   the reference: `dollar-ref("$a.b")`, `delim(".")`, `ident("c")`. The parser can report the malformed
   chain; the lexer does not guess.
4. **`url` case-insensitivity** is a CSS-compatibility choice; the frozen JSDoc does not state it. It has
   no effect on the fixtures and is documented in `urls.ts`.
5. **Unquoted `url(` ends at the first unescaped `)`** (CSS forbids unescaped `(`/`[` there anyway).
   Quoted paths can contain any brackets and remain one token, which satisfies the prompt's
   "parens/brackets inside it do not count for depth" for every construct CSS actually allows.
6. **Test file placement.** The frozen plan names `tests/compiler/lexer/`; this task's allowed-files
   bullet names `tests/compiler/lexer*.test.ts`. I followed the task bullet (the more specific, later
   instruction) and created three sibling files.

No frozen type was changed; no contract limitation blocked the work.

## Blockers

None remaining. `bun run verify` was temporarily red while A04 was mid-write; every failure was inside
`packages/compiler/src/parser/**` and `tests/compiler/parser.test.ts`, outside this task's allowed files,
so no A03 change was required. Retries:

| Attempt | Result |
|---|---|
| 01:04 | `lint` failed on `src/parser/{cursor,declaration,diagnostics}.ts` (format/organizeImports) |
| 01:07 | `typecheck` failed on `src/parser/rule.ts(183,57)` TS2551 (`spanRange` vs `spanOfRange`) |
| 01:10 | `typecheck` ok; `lint` failed with 8 parser-owned errors |
| 01:13 | `typecheck` ok; `lint` failed with 10 errors in `src/parser/*` and `tests/compiler/parser.test.ts` |
| 01:16 | **`bun run verify` exit 0** — 190 files linted clean, 105 tests pass across 6 files |

## Framework records

None created. The compiler has zero runtime dependencies and this task used no framework; only the
repository's dev tooling ran (TypeScript 5.9.3 resolved from `bun.lock`, Biome 1.9.4 from
`node_modules/@biomejs/biome/package.json`), and neither produced a defect worth a record. No
framework bug or feature request was encountered, so the mandatory framework-version field does not
apply.

## Handoff

- **A04 (parser):** the lexer guarantees (a) every `@` name is `at-keyword` including `@`, alias
  promotion is yours; (b) `@xl+dark` arrives as three adjacent tokens whose offsets are contiguous
  (`at-keyword.end === delim.start`, `delim.end === ident.start`) so `readModifier` works unchanged;
  (c) `function` value/span is the name only, `lparen` follows; (d) `url` is one token; (e) whitespace
  and comments are separate trivia tokens; (f) the stream ends with `eof` at `source.length`.
  `parser/cursor.ts` and `parser/modifier.ts` already match these assumptions.
- **Lead:** export `tokenize` from `packages/compiler/src/index.ts` in the barrel-integration step (not
  touched here). `bun run verify` is green at hand-off (Bun 1.4.4 banner in `bun run`, same runner
  difference A02 recorded).
- Fixture expectations were not edited; all seven lexical fixtures tokenize with zero diagnostics and
  100 % round-trip, which is the lexer-level meaning of their `[]`/`null` diagnostics files.

## Acceptance criteria

| Criterion | Status |
|---|---|
| 1. `bun run verify` exit 0; all lexer tests pass | 🟢 verify exit 0 (190 files linted, 105 tests pass); lexer suites 49 pass |
| 2. Lossless round-trip and exactly one trailing `eof` for all fixture inputs | 🟢 pinned per fixture plus exhaustive/fuzz invariants |
| 3. `@` classification matches the frozen JSDoc + §3.1 for every lexical fixture | 🟢 frozen `at-keyword`-only contract, with promotable-position facts pinned per fixture |
| 4. Report lists files, decisions with justifying JSDoc, evidence, blockers/concerns | 🟢 this report |
