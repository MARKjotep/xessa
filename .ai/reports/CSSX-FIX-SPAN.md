# CSSX-FIX-SPAN — T03 out-of-bounds `XESSA2001` span

**Worker:** code · **Task spec:** `.ai/tasks/CSSX-T03.md` · **Status:** 🟢 PASS · **Date:** 2026-11-26

## Summary

- **T03 fixed:** an invalid `@setup prefix` containing `$` no longer produces a diagnostic span past
  the end of the file. `substitute` correctly turns `$p` into `var(--$-p)`; the bug was the defensive
  re-expansion in `emitRuntimeTokens`, which re-lexed that generated text with the authored value
  offsets and reported the invented `$-p` as an undefined token at `40 + 6 = 46..49` (44-char file).
  `$p` is not undefined — that XESSA2001 was a false positive on text no author wrote.
- **Fix at the emission point:** `referenceSpan` now rejects a computed absolute span that falls
  outside the origin's authored fallback span, and `expandValue` skips such tokens. Authored
  references keep their exact offsets; generated `$` characters are never treated as references.
- **Classification hygiene landed:** the `CSSX-T1`/`CSSX-T2` round-trip classifier and the stale
  runner note are gone (those shapes are hard failures now), and a `$ns.name` fixed-point case covers
  the just-landed `$`-sigil formatter fix (T05).
- **No diagnostic codes added, no assertion weakened, no emitted CSS changed** for unchanged valid
  sources (verified by the golden/substitute/runtime suites).

## Baseline (before edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ... (unrelated AI/plan/cli/vscode/selectors/formatter work in the tree; preserved untouched)
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Repro before the fix (`compile('@setup{prefix:"$";}@runtime{p:red;}.c{c:$p;}')`, 44 chars):

```
XESSA2001 Undefined token "$-p"  46..49   <- out of bounds
XESSA4001 Invalid class prefix "$"  38..42
```

## Evidence and root cause

| Step | Text | Offsets |
|---|---|---|
| Authored | `.c{c:$p;}` | `$p` = 40..42 |
| `substitute` output | `c: var(--$-p)` | IR value, span still 38..42 |
| Re-lex of the IR value | `$-p` at text offset 6 | `40 + 6 = 46..49` |

`emitRuntimeTokens` step 3 assumes "after `substitute` there are no `$` left", which an invalid `$`
prefix violates because it leaks into `var(--<prefix>-<name>)`. The lexer is not at fault: it reports
offsets relative to the text it was given; the caller must only trust them while the text is still
the authored slice.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/variables/expand.ts` | `referenceSpan` returns `null` when the absolute span leaves `origin.fallback`; `expandValue` skips those tokens. JSDoc explains generated-`$` text. |
| `tests/stress/fuzz/compile.test.ts` | T03 pin + "still reports out-of-bounds" guard deleted; replaced with positive in-bounds assertions, exact `["XESSA4001"]`, no `"$-p"` message, and `compileViolations(...) === []`. |
| `tests/stress/fuzz/areas.ts` | Removed `DEFECT_FORMAT_IDEMPOTENCE`, `DEFECT_FORMAT_ROUNDTRIP`, `hasUnbalancedDelimiters`, `walkAst`, `hasUnbalancedAtRulePrelude`, `hasMarkerPrefixedVariantValue`, `classifyRoundTripDefect`; `roundTripViolations` returns `{ problems }` and every problem is a violation. `limitation`/`limitations` retained (documented reserved, always empty) to keep the runner/tests contract stable. |
| `tests/stress/fuzz/runner.ts` | Removed the CSSX-T1/T2/T3 "pinned defects" note; header says `pinned=` is expected to stay 0. |
| `tests/stress/fuzz/roundtrip.test.ts` | Additive `CSSX-T05` describe: `$layout.margin` and `$space.sm` declarations plus a `$space.sm` reference are fixed points with equal IR. |
| `tests/stress/soak/long-fuzz.ts` | Removed `expectedFailure`/`expectedCssxT3` classification (field, parse, log suffix, summary `expectedFailures`); any failing area is now unexpected. `outOfBoundsSpans` counters kept as a regression signal. |
| `tests/compiler/setup-span-bounds.test.ts` | New focused suite: repro bounds/no `$-p`, leading-text value, authored undefined ref next to a `$` prefix (`$nope` at 40..45), and `red $nope` at 9..14. |

## Validation (actual outcomes)

| Command | Outcome |
|---|---|
| `bun test tests/compiler/setup-span-bounds.test.ts tests/stress/fuzz/compile.test.ts tests/compiler/parser.test.ts tests/compiler/compile.test.ts` | 76 pass, 0 fail (2390 expect calls) |
| `XESSA_STRESS_BUDGET=100000 XESSA_STRESS_SEED=3 bun tests/stress/fuzz/runner.ts --area compile` | `pass compile cases=100000 violations=0 pinned=0` (32.7 s) |
| `bun tests/stress/fuzz/runner.ts --area roundtrip --budget 2000 --seed 7` | `PASS … cases=2010 violations=0 pinned=0` |
| `bun test tests/stress/fuzz/` | 47 pass, 0 fail |
| `bun test tests/compiler/variables.golden.test.ts tests/compiler/substitute.test.ts tests/compiler/runtime.test.ts tests/compiler/golden.test.ts tests/compiler/groups.golden.test.ts` | 102 pass, 0 fail |
| `bunx tsc -p packages/compiler/tsconfig.json --noEmit` | clean (exit 0) |
| `bunx biome check` on the seven changed files | clean |
| `bun tests/stress/soak/long-fuzz.ts --help` | runs (driver parses; full soak not run) |

After the fix the repro reports only `XESSA4001 Invalid class prefix "$"` at `38..42`; every
diagnostic satisfies `0 <= start <= end <= source.length`.

## Acceptance outcomes

1. ✔ Seed-3 repro yields zero out-of-bounds spans; bounded 100 000-budget run reports 0 violations.
2. ✔ Pin and guard test deleted; the property checker reports no violation (asserted positively).
3. ✔ `compile` exits 0 at seed 3 / 100 000 with `pinned=0`; `long-fuzz.ts` no longer needs an expected
   failure.
4. ✔ Targeted `tests/compiler/` suites unchanged and green; `bun run verify` is owned by the
   integration worker and was not run here.

## Residual / handoff for the integration worker

- 🟡 **Write-set deviation (disclosed):** the dispatch listed `parser/**` + `lowering/spans.ts`, but
  neither owns this emission point; the task spec assigns
  `packages/compiler/src/variables/{expand,runtime}.ts` to T03 and that directory has no other
  worker. Only `expand.ts` was changed (`runtime.ts` was not needed). `long-fuzz.ts` is required by
  acceptance #3 and was changed. No forbidden path was touched.
- ⚪ `substitute`/`emitRuntimeTokens` still emit `--$-p` (invalid CSS) for an invalid prefix by
  design; `XESSA4001` documents the fallback and naming/sanitization is owned by P4/A09, not this
  span fix.
- ⚪ Full `bun run verify` and the TT7 long-fuzz driver over all areas remain with the integration
  worker. `tests/stress/fuzz/` still exports the now-always-empty `limitation`/`limitations` fields so
  future owner-approved pins have a home; remove them if the team prefers no reserved surface.
- Untouched: concurrent `packages/cli`, `packages/vscode`, `formatter/**` and `selectors/**` edits in
  the tree belong to other workers.
