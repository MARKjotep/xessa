# CSSX-TT1 — Compiler fuzz and robustness harness

**Phase:** TT1 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟡 complete for the owned scope, one
external blocker recorded below (TT1 row left 🔴 — build flips it after its own verification)
**Date:** 2026-11-27 · **Tree:** `main`, uncommitted. Siblings own `tests/stress/{fs,cli,editor}/**`;
this phase owns `tests/stress/{prng,corpus}.ts`, `tests/stress/fuzz/**` and the two `stress*` scripts
in root `package.json`.

## Summary

- Landed the deterministic TT1 harness: hand-rolled xorshift128 PRNG (`prng.ts`), frozen in-memory
  mutation corpus derived from all 67 `tests/fixtures/**/input.cssx` (`corpus.ts`), shared check bodies
  (`fuzz/areas.ts`), five property suites and the long-run `fuzz/runner.ts`, plus `"stress"` /
  `"stress:fuzz"` scripts. No new dependency, no fixture or existing test touched.
- **46 new tests** in 5 files, all green at the default budget (200 cases/area, seed 1): `bun test
  tests/stress/fuzz/` → 46 pass / 0 fail, 18 948 `expect()` calls, 1.55 s.
- Default budget costs **377 ms** for all five areas (1 042 generated cases): lexer 19 ms, parser 8 ms,
  compile 97 ms, roundtrip 16 ms, determinism 207 ms — `bun run verify` stays fast.
- Extended (not duplicated) the two cases TT0 said were already covered: formatter idempotence and
  `parse(format(x))` reparse now hold for **full IR equality** (positions normalized) over all 67
  fixtures, 871 unicode injections, 10 templates and 200 mutants; prefix truncation now runs over
  **every character and token prefix of every fixture** (7 602 + 3 197 cases), not one source.
- **Three real defects found**, none fixed here (compiler source is outside this task's write set).
  `CSSX-T1` and `CSSX-T2` are pinned + structurally classified so the harness reports them without
  failing every run; `CSSX-T3` is pinned as a reproduction and deliberately **not** exempted, so long
  runs keep reporting it. Each needs a TT8 task; see "Defects" below.

## Changed paths

| Path | Change |
|---|---|
| `tests/stress/prng.ts` | **New.** xorshift128 over four 32-bit words, splitmix32 seed expansion, integer-only (`>>> 0`, `Math.imul`), unbiased `nextInt` via rejection sampling; `readStressSeed`/`readStressBudget` from `XESSA_STRESS_SEED`/`XESSA_STRESS_BUDGET` (default 1/200, strict integer validation); 64-bit FNV-style `hashString` (16 hex) and `createLabelledRng(seed, area)` so each area replays independently. |
| `tests/stress/corpus.ts` | **New.** Read-only memoized load of all 67 fixtures (`loadCorpus`, `fixtureDirectoryFiles`, `REPO_ROOT`, `FIXTURES_ROOT`); seven mutation operators (byte flip through a non-fatal UTF-8 round-trip, truncation, real-token splice, brace/quote/comment imbalance, `$`/`@` abuse, unicode injection, line-ending churn); `UNICODE_INJECTIONS` (BOM at 0/mid/suffix, lone `\uD800`/`\uDC00`, reversed pair, NUL, CRLF/CR/LF mixes, combining mark, astral); `characterPrefixes`, `tokenPrefixes`, `unicodeMutants`, `syntheticTemplates`; `mutantCorpus` is budget-prefix stable (case `i` uses fixture `i % 67`, so a smaller budget is always a prefix of a larger one). |
| `tests/stress/fuzz/areas.ts` | **New (shared implementation).** Invariant checkers (`tokenStreamViolations`, `diagnosticViolations` with a per-file length resolver, `parseViolations` with a configurable cap, `roundTripViolations`, `compileViolations`), position-normalized `structureOf`/`fingerprint`, `artifactSnapshot`, the five area runners, ordered/shuffled `ModuleHost` pair, `determinismProject`. Single source of truth so the tests and the runner cannot drift. |
| `tests/stress/fuzz/lexer.test.ts` | **New**, 12 tests: seeded mutants + templates, BOM at offset 0, lone/reversed surrogates, CRLF/CR/LF mixed document, NUL at every offset, all 871 unicode injections, 1 MB single token (×3 shapes), 100 000-line file, generator reproducibility. |
| `tests/stress/fuzz/parser.test.ts` | **New**, 11 tests: seeded mutants + templates, 10 000-deep `{` and at-rule nesting (incl. the ≥ 8 192 defensive path), unbalanced quote/comment/bracket at every depth 1–64 × 8 injections × 3 suffixes, diagnostic bound per nesting depth, `$`/`@` abuse, exhaustive character- and token-prefix sweeps over all 67 fixtures, mutant truncations. |
| `tests/stress/fuzz/compile.test.ts` | **New**, 9 tests: seeded mutants through the public `compile()`, all 67 fixtures, three truncation points per fixture, all 871 unicode injections, cross-module span bounds, the fixed diagnostic cap, and the pinned `CSSX-T3` reproduction. |
| `tests/stress/fuzz/roundtrip.test.ts` | **New**, 6 tests: full-IR equality + idempotence over all 67 fixtures, 871 unicode injections and 10 templates, the seeded corpus, and the pinned `CSSX-T1`/`CSSX-T2` current behavior. |
| `tests/stress/fuzz/determinism.test.ts` | **New**, 8 tests: seeded determinism area, 3× repeated compile per fixture, PRNG-shuffled `readFile` settlement vs ordered, entry order, generator replay, PRNG/hash stability, env parsing. |
| `tests/stress/fuzz/runner.ts` | **New.** `--area`, `--budget`, `--seed`, `--timeout-ms`, `--help`; whole-run ceiling via a cleared timer; per-case ceiling `MAX_CASE_MS` in the compile area; prints seed, area, case label, input hash, pinned-defect marker and a replay command; exit 0 clean / 1 violation / 2 usage. |
| `package.json` | Added exactly two scripts after `benchmark`: `"stress": "bun tests/stress/fuzz/runner.ts"` and `"stress:fuzz": "XESSA_STRESS_BUDGET=10000 bun tests/stress/fuzz/runner.ts"`. Nothing else reformatted or reordered. |

Nothing else touched: no `packages/**` source, no `tests/fixtures/**`, no existing suite, no plan file,
no `.ai/tasks` (defects are listed below for the TT8 task author).

## What is new coverage vs. what TT0 already had

| TT0 "already covered" | How this file extends it (new cases only) |
|---|---|
| `format(format(x)) == format(x)` for every fixture (`formatter.test.ts:137`) | Kept, and extended to **generated** inputs: 871 unicode injections, 10 templates, 200 mutants; plus **full-IR equality** after reparse (the existing check compared group shape only) and a `structureOf` normalizer that drops positions. |
| `parse(format(x))` group-shape equality (`formatter.test.ts:404`) | Replaced by a stricter property: every node kind, name, value, variant list and order must match after reparse, for the same corpus above. |
| Parser truncation fuzz over **one** source (`parser.test.ts:1136`, `pipeline.test.ts:186`) | Run over **all 67 fixtures**, exhaustively: every character prefix (7 602) *and* every token-stream prefix (3 197), plus mutant-derived prefixes. |
| Lexer NUL (`lexer.test.ts:290`), hostile alphabet + 1 500 seeded sources (`lexer.invariants.test.ts:131`) | Not re-implemented. Added only the documented missing cases: BOM at 0, lone/unpaired surrogates, CRLF/LF/CR mixed document, 1 MB single token, 100 000-line file. |
| Naming run-to-run determinism (`naming.test.ts:194`, `mapgen.test.ts:211`) | Not re-implemented. Added whole-pipeline determinism: 3× repeated `compile()` per fixture and `compileProject` under PRNG-shuffled `readFile` settlement order and reversed entry order. |

## Measurements (this machine, Bun 1.4.x, macOS arm64)

| Area run (`runArea`) | Budget 200: cases / time / violations / pinned | Budget 500: cases / time / violations / pinned |
|---|---|---|
| lexer | 210 / 19 ms / 0 / 0 | 510 / 5 ms / 0 / 0 |
| parser | 210 / 8 ms / 0 / 0 | 510 / 7 ms / 0 / 0 |
| compile | 200 / 97 ms / 0 / 0 | 500 / 163 ms / 0 / 0 |
| roundtrip | 210 / 16 ms / 0 / 2 | 510 / 28 ms / 0 / 3 |
| determinism | 212 / 207 ms / 0 / 0 | 512 / 457 ms / 0 / 0 |
| **total** | **1 042 / 377 ms** | **2 542 / 660 ms** |

Sweep and size floors (measured, not estimated):

| Measurement | Result |
|---|---|
| Fixture corpus | 67 `input.cssx`, 7 535 UTF-16 code units total (unchanged, read-only) |
| Character prefixes, all fixtures | 7 602 parses, 61 ms |
| Token prefixes, all fixtures | 3 197 parses, 23 ms |
| 1 MB single token (`a`, `@`, space) | 137 ms for all three, lossless |
| 100 000-line file (2 388 889 chars) | tokenize 117 ms, parse included in the parser suite |
| 10 000-deep `a { ` nesting | no throw; balanced 0–1 diagnostics (≥ 8 192 takes the defensive recovery path), unclosed ≤ depth |
| 10 000-deep at-rule nesting | no throw; diagnostics ≤ depth |
| Unbalanced quote/comment/bracket, depths 1–64 × 8 injections × 3 suffixes | 1 536 parses, diagnostics ≤ depth + 2, 124 ms |
| Worst compiled-input diagnostic count (10 seeds × 500 mutants) | 8, against the fixed cap of 64 |

## Defects found (no compiler source was changed — TT8 must own the fixes)

### CSSX-T1 — `format` is not idempotent for an at-rule whose prelude swallows the terminator

- **Repro:** `"@x[a"` (zero parse diagnostics) → `format` = `"@x [a;\n"` → `format` again =
  `"@x [a;;\n"`. The emitted `;` is re-read as part of the unbalanced `[` prelude, so every pass adds
  one more semicolon. Same for `@media[x { a: b; }`, `@x[a;`.
- **Corpus case:** seed 1, budget 200, input hash `c4a21866af2c9459`
  (`output/only-names [imbalance] inserted "[" "{" at [4,24]`).
- **Contract:** `format` is "pure parse→print"; canonical output must be a fixed point.
- **Pinned:** `tests/stress/fuzz/roundtrip.test.ts` ("CSSX-T1: …") asserts today's exact bytes;
  `classifyRoundTripDefect` returns `CSSX-T1` for any instance (structural: an unbalanced `[`/`(` in a
  `native-at-rule` prelude) so the area reports it as a pinned limitation instead of a failure.
  The pin goes red when the defect is fixed — that is the signal to delete it and the classifier branch.

### CSSX-T2 — `format` changes the variant split of adjacent `@`-markers

- **Repro:** `".a { x: 1 @a@b 2; }"` (zero diagnostics) parses as **one** variant
  (`aliases:["a"], value:"@b 2"`); `format` emits `"x: 1 @a @b 2;"`, which reparses as **two** variants
  (`a:""`, `b:"2"`). So `parse(format(x))` is not IR-equal to `parse(x)`.
- **Corpus case:** seed 1, budget 200, input hash `017f72c1df03f0f0`
  (`runtime/with-variant [dollar-at-abuse]`); also hit at seed 5 (hash `8ede5396d72b69ee`,
  `media/combined-and`).
- **Contract:** canonical formatting must not change semantics; a variant split is semantics.
- **Pinned:** `roundtrip.test.ts` ("CSSX-T2: …") asserts the 1-variant → 2-variant transition;
  `classifyRoundTripDefect` recognizes any declaration variant whose value starts with `@`.

### CSSX-T3 — an invalid `$` prefix pushes a `XESSA2001` span past the end of the source

- **Repro:** `'@setup{prefix:"$";}@runtime{p:red;}.c{c:$p;}'` (44 characters) through `compile()`:
  `XESSA2001 Undefined token "$-p"` reports span `46..49`, i.e. `end > source.length`.
- **Corpus case:** seed 3, budget 2 000, input hash `238cccfef402d033`
  (`runtime/basic [dollar-at-abuse] inserted @variables { $$$: 1; } | $$$$$`,
  span `122..133` in a 124-character source).
- **Suspected cause:** the runtime-token/prefix pass builds the "undefined token" span from the
  prefix-substituted declaration text rather than the authored source, so its offsets shift by the
  number of inserted characters.
- **Pinned but NOT exempted:** `compile.test.ts` ("CSSX-T3: …") asserts today's `46..49` behavior and
  a second test asserts the property checker still reports it. Consequence: long runs that reach this
  input **fail** — `XESSA_STRESS_SEED=3 bun tests/stress/fuzz/runner.ts --budget 2000` exits 1 with
  the message and replay command. That is the intended failing-repro state until TT8 fixes it.
- **Blocks:** the plan's TT1 exit criterion "a 100k-case run of every area exits 0" — it cannot be
  satisfied honestly while CSSX-T3 reproduces.

## Commands and outcomes

| Command | Outcome |
|---|---|
| `bun test tests/stress/fuzz/` | **PASS** — 46 pass / 0 fail, 18 948 `expect()` calls, 1.55 s |
| `bun tests/stress/fuzz/runner.ts --area roundtrip --budget 500 --seed 7` | **PASS, exit 0** — `cases=510 … violations=0 pinned=1`, 60 ms |
| `bun tests/stress/fuzz/runner.ts --area compile --budget 500 --seed 1` | **PASS, exit 0** — `cases=500 … violations=0 pinned=0`, 279 ms |
| `bun run stress` (seed 1, budget 200, all areas) | **PASS, exit 0** — `cases=1042 pinned=2 time=439ms` |
| `XESSA_STRESS_SEED=3 bun tests/stress/fuzz/runner.ts --budget 2000` | **FAIL, exit 1 (expected)** — one `CSSX-T3` out-of-bounds span, printed with seed, hash and replay command |
| `bun run typecheck` | **PASS** (tests are not part of the `packages/*` tsconfigs; no source touched) |
| `bun run lint` | **PASS** — `biome check .` 458 files, no diagnostics |
| `bun run verify` | **1103 pass / 2 fail** — both failures are `tests/stress/cli/concurrency.test.ts` ("two simultaneous builds", TT4/CLI wave, **outside this phase's write set**); all 46 TT1 tests pass inside that run (1 057 other tests + 46 TT1 all green). Typecheck and lint stages of the gate are green. |

## Handoff

- **Owned scope complete:** `tests/stress/{prng,corpus}.ts`, `tests/stress/fuzz/{areas.ts,
  lexer,parser,compile,roundtrip,determinism}.test.ts,runner.ts`, two `package.json` scripts,
  this report.
- **Remaining for this phase (TT8/release):**
  1. TT8 task for **CSSX-T1** (formatter must not append `;` to a statement at-rule whose prelude is
     unterminated) and **CSSX-T2** (formatter must not change the variant split; parser/formatter must
     agree on `@a@b` tokenization). When fixed, the two pins go red: delete the pins and the
     `classifyRoundTripDefect` branches.
  2. TT8 task for **CSSX-T3** (runtime-token diagnostic spans must be authored-source offsets). When
     fixed, delete the `CSSX-T3` pin in `compile.test.ts`; the property checker then passes on that
     input without any exemption, which restores the 100k-case exit criterion.
  3. `bun run verify` will not be green until the TT4/CLI sibling suite
     `tests/stress/cli/concurrency.test.ts` is fixed by its owner (2 failing tests, reproduced twice).
- **Budget knobs:** default `XESSA_STRESS_BUDGET=200`, `XESSA_STRESS_SEED=1`; long runs use
  `XESSA_STRESS_BUDGET=100000 bun tests/stress/fuzz/runner.ts --area compile --seed 1` (will fail on
  CSSX-T3 until it is fixed — by design).
