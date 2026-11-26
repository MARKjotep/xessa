# CSSX-FIX-FORMATTER — T05, T01, T02 formatter defects

**Worker:** code · **Task specs:** `.ai/tasks/CSSX-T05.md`, `CSSX-T01.md`, `CSSX-T02.md`
**Status:** 🟢 PASS (all three fixed) · **Date:** 2026-11-26

## Summary

- **T05 (data loss) fixed:** `printTokenDeclaration` re-emits the authored `$`, so
  `$layout.margin: 4px;` stays a namespaced token declaration instead of becoming the invalid
  `layout.margin: 4px;`. Fix is formatter-only (recover the sigil from `token.span` in the authored
  source); no parser/IR change, and unsigiled authored names keep their existing output.
- **T01 (idempotence) fixed:** a statement at-rule whose prelude leaves a `[`/`(` open no longer gets
  a `;` that the prelude would reabsorb, so `@x[a` → `@x [a` is a fixed point and the reparse IR
  matches (previously one `;` per pass).
- **T02 (variant split) fixed:** the formatter keeps an authored marker adjacent to a value that
  starts with `@`, so `x: 1 @a@b 2` stays one variant (`a`, value `@b 2`) instead of being printed as
  `@a @b` and reparsing as two.
- Regression pins in `tests/stress/fuzz/roundtrip.test.ts` are now positive invariants; the corpus
  test requires `run.limitations === []`.
- No existing fixture output changes: fixtures author no `$` token names, no dangling at-rule
  preludes and no marker-prefixed variant values (checked over all 130 fixture `.cssx` files), so the
  three changed branches are unreachable for them.

## Baseline (before edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ... (unrelated AI/plan/vscode work in the tree; preserved untouched)
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

## T05 — `$` sigil dropped

**Changed:** `packages/compiler/src/formatter/index.ts` (`Printer` carries `source`/`file`;
`printTokenDeclaration(token, source)` prefixes `$` when the authored span starts with `$`),
`tests/compiler/formatter.test.ts` (2 new cases).

**Evidence before:** `format("@variables {\n  $layout.margin: 4px;\n}\n")` →
`@variables {\n  layout.margin: 4px;\n}\n`; reparsing = `XESSA1001`, empty `@variables`.
**After:** output is byte-identical to the input, zero diagnostics, `token-declaration`
(`name:"layout.margin"`, `value:"4px"`), and `format(format(x)) === format(x)`.

**Acceptance outcomes**

1. ✔ Fixed point + `token-declaration` with zero diagnostics (formatter test).
2. ✔ `$` round-trip covered in the formatter test; emitted CSS unchanged for `$margin` via
   `compileCss(before) === compileCss(after)`. A `tests/fixtures/**` `$ns.name` fixture was **not**
   added (outside this worker's write set).
3. ✔ `XESSA_STRESS_SEED=1 ... --budget 100000` → `PASS ... cases=100010 violations=0 pinned=0`.
   `tests/stress/soak/long-fuzz.ts` expects `unexpectedFailures=[]`, which follows from that exit 0;
   the soak driver was not run because it writes logs outside this worker's write set.
4. ✔ No fixture/golden output change (see Summary); `bun run verify` is owned by the integration
   worker and was not run here.

**Note — `format --check`:** the CLI could not be executed because concurrent in-flight edits leave
`packages/cli/src/writer.ts` without its `sweepTemporaries` export (`SyntaxError` on
`packages/cli/src/index.ts`, pre-existing in the working tree, outside this write set, and unrelated
to formatting). The formatter-level fixed point is the property `--check` tests.

## T01 — at-rule prelude swallows the terminator

**Changed:** `packages/compiler/src/formatter/index.ts` (`printNative` +
`preludeSwallowsTerminator`, tokenizing the prelude and mirroring `parseNativeAtRule`'s closer
stack), `tests/stress/fuzz/roundtrip.test.ts` (pin → invariants), header doc.

**Evidence before:** `@x[a` → `@x [a;` → `@x [a;;`; `@media[x { a: b; }` → `... };` → `... };;`.
**After:** `@x [a`, `@media [x { a: b; }`, `@x [a;`, `@x (a`; each is a fixed point and
`parse(format(x))` is IR-equal to `parse(x)`; a balanced `@x[a]` still prints `@x [a];`.

**Acceptance outcomes:** 1 ✔; 2 ✔; 3 ✔ (formatter + extension formatting + group fixtures
unchanged — no fixture reaches the branch); 4 🟡 pin deleted in `roundtrip.test.ts`, but the
`DEFECT_FORMAT_IDEMPOTENCE` constant/`hasUnbalancedAtRulePrelude` classifier branch in
`tests/stress/fuzz/areas.ts` and the `CSSX-T1` note in `runner.ts:215` remain (outside write set);
they are inert (`pinned=0`). 5 ✔ for the parts runnable here (fuzz suite green, `pinned=0`).

## T02 — adjacent `@`-markers change variant split

**Changed:** `packages/compiler/src/formatter/index.ts` (`printDeclaration` omits the separator when
`variant.value` starts with `@`), `tests/compiler/formatter.test.ts`, `tests/stress/fuzz/roundtrip.test.ts`.

**Evidence before:** `parse(".a { x: 1 @a@b 2; }")` = one variant (`a`, value `@b 2`); format printed
`x: 1 @a @b 2;` → two variants.
**After:** format prints `x: 1 @a@b 2;`; reparse = one variant; IR equal; `@a+b` still one variant
with aliases `["a","b"]`.

**Acceptance outcomes:** 1 ✔ for the repro and both corpus hashes; 2 ✔ unit test; 3 ✔
`tests/fixtures/runtime/with-variant` and `media/combined-and` bytes unchanged; 4 🟡 pin deleted,
classifier branch in `areas.ts` remains (outside write set, inert); 5 ✔ as above.

Corpus note: `8ede5396d72b69ee` occurs at seed 5 **budget 500**, not 200; the spec's budget is
corrected in the test.

## Validation (actual outcomes, in order)

| Command | Outcome |
|---|---|
| `bun test tests/compiler/formatter.test.ts` | 21 pass, 0 fail (17 before + 4 new) |
| `bun test tests/stress/fuzz/roundtrip.test.ts` | 6 pass, 0 fail (2 old pins replaced) |
| `bun test tests/compiler/formatter.test.ts tests/stress/fuzz/roundtrip.test.ts` | 27 pass, 0 fail |
| `bun test tests/stress/fuzz/` | 46 pass, 0 fail |
| `bun test tests/compiler/variables.golden.test.ts` | 17 pass, 0 fail |
| `bun test tests/extension/provider.formatting.test.ts` | 7 pass, 0 fail |
| `bun tests/stress/fuzz/runner.ts --area roundtrip --budget 5000 --seed 7` | `PASS ... cases=5010 violations=0 pinned=0` |
| `XESSA_STRESS_SEED=1 bun tests/stress/fuzz/runner.ts --area roundtrip --budget 100000` | `PASS ... cases=100010 violations=0 pinned=0` |
| `bunx tsc -p packages/compiler/tsconfig.json --noEmit` | clean |
| `bunx biome check` on the three changed files | clean |
| `bun run verify` | not run (integration worker owns the full gate) |

## Residual / handoff

- 🟡 `tests/stress/fuzz/areas.ts` (constants, `hasUnbalancedAtRulePrelude`,
  `hasMarkerPrefixedVariantValue`, classifier branch) and `runner.ts:215` note still reference
  T01/T02. Inert after the fixes; deletion needs a worker whose write set includes those files.
- 🟡 `tests/fixtures/**` `$ns.name` fixture not added (outside write set); covered by the formatter
  test.
- ⚪ `packages/cli` `format --check` unverified because of concurrent in-flight CLI edits
  (`writer.ts` missing `sweepTemporaries`).
- Untouched: `packages/compiler/src/selectors/**` modifications in the tree belong to another worker.
