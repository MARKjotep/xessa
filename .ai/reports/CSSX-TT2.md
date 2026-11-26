# CSSX-TT2 — Scale and pathological inputs

**Phase:** TT2 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟢 complete for the owned scope
(TT2 row left 🔴 for build to flip after independent verification)
**Date:** 2026-11-25 · **Tree:** `main`, uncommitted · **Scope:** new files under `tests/stress/scale/**`
only + this report

## Summary

- Implemented every case in plan §TT2 as an executed, seeded case: **5 files, 17 tests, 4 247
  assertions, 11.3 s** at the default seed, plus a shared generator module. Nothing under
  `packages/**`, `tests/fixtures/**`, `package.json`, the plan or any sibling stress area changed.
- The corpus builds **10 000 selectors across 101 entries**, a **5 119-token** source, **100 media
  variants on one rule**, a **1 000-deep `@use` chain**, **500-module diamond and cycle graphs**, a
  **1 000-deep `&` chain with a 500-item selector list**, a **1 000-file CLI project** (3 000
  artifacts + manifest + `tsc --noEmit`), an isolated **memory measurement**, and a **verification of
  `scripts/benchmark.ts --json`** (weakest-10 #10).
- **One new defect** found and pinned out-of-suite: `CSSX-T4` — selector expansion is exponential in
  nesting when each level carries two `&`s (`& &`): 12 levels already emit 12 306 B and 1 000 levels
  did not finish in 180 s, with no size bound or typed diagnostic. The plan's row is implemented with
  linear `&.m<n>` nesting (semantically meaningful, valid CSS); the exponential shape is recorded as
  **not implementable as stated** and handed to TT8 (the compiler is not changed here).
- One observation for TT8: a 500-module cycle produces a single typed `XESSA2001` whose message
  embeds the whole import path (**13 936 chars**).
- Gates: `bun test tests/stress/scale/` **17 pass / 0 fail**; `bun run lint` **exit 0**;
  `bun run typecheck` **exit 0**; full `bun test` **1 122 pass / 0 fail (77 files, 35.8 s)** — no
  sibling failures on this tree.
- Memory at 1 000 files (isolated cold build): **RSS 73.1 MB / heap 12.5 MB / peak 74.8 MB**, against
  `docs/performance.md` medians of 109.0 / 22.6 / 115.1 MB. Numbers are **recorded, not compared as
  equal**: the docs figure comes from the benchmark child (five builds plus fixture generation), the
  probe from one cold build.

## Changed paths

| Path | Change |
|---|---|
| `tests/stress/scale/generate.ts` | **New.** Seeded generators for every §TT2 size, `mkdtemp` project factory + canonical cleanup, in-memory `ModuleHost`, emitted-CSS oracles (`parse()` reparse, class tokens, declaration/media order), CLI/`tsc`/benchmark subprocess runners, isolated memory probe, byte-for-byte replica of the benchmark fixture generator. |
| `tests/stress/scale/selectors.test.ts` | **New.** 3 cases — §TT2 rows 1, 2, 5. |
| `tests/stress/scale/modules.test.ts` | **New.** 3 cases — §TT2 rows 3, 4 (diamond and cycle halves). |
| `tests/stress/scale/project.test.ts` | **New.** 6 cases — §TT2 row 6 (1000-file CLI project, 1:1 class maps, manifest, `tsc`, `xessa check`, independent entry compile). |
| `tests/stress/scale/memory.test.ts` | **New.** 2 cases — §TT2 row 7. |
| `tests/stress/scale/benchmark.test.ts` | **New.** 3 cases — §TT2 row 8 / weakest-10 #10. |
| `.ai/reports/CSSX-TT2.md` | **New.** This report. |

Nothing else was touched. `tests/stress/prng.ts` and `tests/stress/corpus.ts` are imported read-only
(`readStressSeed`, `createLabelledRng`, `REPO_ROOT`); no stress file outside `scale/**` was edited.
`git status` additionally shows `M package.json`, `M .ai/plans/CSSX-PLAN-PRODUCTION.md` and the
sibling stress/report files — those were already present at task start (TT1/TT3/TT4/TT6 work), not
this phase.

## Case table

| # | Case (plan §TT2) | File:line | Assertion | Result |
|---|---|---|---|---|
| 1 | 10k-selector project, 5k-token file | `selectors.test.ts:38` | 101 entries compile with **zero error diagnostics**; 10 000 unique card selectors (10 001 class names incl. the token rule); token file is **5 119 lexer tokens** (≥ 5 000); all 101 emitted stylesheets re-parse (`parse()` → no diagnostics) | **pass** (729.85 ms) |
| 2 | One rule with 100 media variants | `selectors.test.ts:83` | Emitted CSS valid; 101 `width` declarations in authored order `value-0 … value-100`; exactly 100 `@media` blocks in the seeded shuffled alias order (`mediaGrouping: "safe"`) | **pass** (4.61 ms) |
| 3 | 1k-deep `@use` chain | `modules.test.ts:43` | 1 000 modules resolve with **0 diagnostics**, no stack overflow, **no depth limit at 1 000**; 999 dependencies; 1 000 rules emitted deepest-first; emitted CSS re-parses | **pass** (69.04 ms) |
| 4a | Diamond graph of 500 modules | `modules.test.ts:82` | 0 diagnostics; shared `c` merged exactly once; style order 499; byte-identical output across two builds; emitted CSS re-parses | **pass** (59.90 ms) |
| 4b | Cycle graph of 500 modules | `modules.test.ts:126` | Exactly one typed **`XESSA2001` "Import cycle detected"**; walk terminates (no hang); deterministic style order; byte-identical output across two builds | **pass** (45.09 ms) |
| 5 | 1k-deep `&` chain, 500-item selector list | `selectors.test.ts:106` | 500 emitted selectors, each carrying the full 1 000-level `&.m<n>` chain (first selector 4 899 chars); 1 501 class tokens; emitted CSS re-parses | **pass** (1 807.58 ms) |
| 6 | 1000-file project | `project.test.ts:86`, `:106`, `:167`, `:188`, `:197`, `:212` | CLI build exit 0, **0 error diagnostics**, 3 000 artifacts written; css/js/d.ts **1:1 per source**, map import resolves to its CSS, class sets equal, `.d.ts` literals equal map; manifest 3 000 entries (1 000 each `css`/`js`/`types`); `tsc --noEmit` exit 0; `xessa check` exit 0 on samples; independent `compile()` of one entry clean | **pass** (0.48 / 106.49 / 39.94 / 387.80 / 134.89 / 1.18 ms) |
| 7 | Memory at 1000 files | `memory.test.ts:58`, `:88` | Isolated subprocess cold build completes: 1 000 entries, 0 errors, 2 000 classes, valid CSS bytes; RSS/peak recorded against `docs/performance.md` medians with **no pass/fail on the number** | **pass** (0.11 / 0.09 ms, probe 751 ms) |
| 8 | `scripts/benchmark.ts --json` | `benchmark.test.ts:62`, `:91`, `:100` | Two `--size 100` runs exit 0; identical schema shape and key set; identical `outputBytes` **126 186** (also equal to the value recorded in `docs/performance.md`); local byte-for-byte generator replica compiles to the same 126 186 B; one generated entry recompiled independently with **0 error diagnostics** and valid CSS | **pass** (1 008.19 / 558.16 / 67.41 ms) |

## Measurements (this machine)

| Item | Value |
|---|---|
| CPU / OS | Apple M1 Pro · darwin/arm64 · `27.3.0` |
| Runtime | Bun `1.4.5` · bundled Node `26.3.0` · TypeScript `5.9.3` |
| Default seed / budget | `XESSA_STRESS_SEED=1`; sizes are fixed by the plan (budget does not shrink them) |
| 10k-selector project | 101 entries · 10 001 classes · 1 758 116 CSS chars |
| 5k-token file | 850 declarations · **5 119** non-EOF lexer tokens |
| 100-media-variant rule | 6 609 CSS chars · 100 `@media` blocks |
| 1k `@use` chain | 36 779 CSS chars · 1 000 classes · 999 dependencies |
| 1k `&` chain + 500-list | 2 451 411 CSS chars · 500 selectors of 4 899 chars each |
| 1000-file project | 1 000 sources · 3 000 artifacts · build ≈ 4.9 s · `tsc --noEmit` 0.39 s |
| Memory, 1 000 files (isolated cold build) | baseline RSS 18.3 MB · after-build RSS **73.1 MB** · heap 12.5 MB · peak RSS **74.8 MB** · peak growth 54.8 MB · build 751 ms |
| `docs/performance.md` medians, 1 000 files | RSS 109.0 MB · heap 22.6 MB · peak 115.1 MB · growth 97.1 MB |

**Why the memory numbers are not directly comparable (and are not asserted equal):** the docs row is
produced by `scripts/benchmark.ts`, whose child process generates the 1 000-file fixture, then runs
**five** full `compileProject` builds and keeps output text alive for all of them. The TT2 probe
(`generate.ts:runMemoryProbe`) generates the fixture in the parent, then runs **one** cold build in a
fresh child that only imports the compiler. The probe's lower numbers (73.1 / 74.8 MB vs 109.0 /
115.1 MB) are therefore expected, not an improvement claim. Per the plan there is **no pass/fail
threshold on the number**; the test asserts the run completes, produces 1 000 entries / 2 000 classes
/ zero errors, and that the recorded values are real finite measurements. A runaway ceiling
(`peak < 4 096 MB`) guards against an OOM-shaped regression, not against slow-machine variance.

## Benchmark-harness verification (weakest-10 #10)

- **Exit code**: `bun scripts/benchmark.ts --json --size 100` exits `0`, empty stderr, twice.
- **Schema stability**: top-level keys equal `{files, entries, generationMs, generationBaseline,
  coldBuild, incremental, parseProxy, memory, outputBytes, diagnostics, environment}` in both runs;
  `valueShape()` (recursive key/array/leaf-type structure) is identical. Only `environment.timestamp`
  and timing/memory leaves differ, which the test asserts explicitly (`timestamp` differs).
- **Fixture bytes identical**: `outputBytes` is identical across both runs and equals the
  `docs/performance.md` record **126 186**. Independently, `benchmarkShapedProject(100)` — a
  byte-for-byte replica of the harness's `generate()` in `generate.ts` — compiles in-memory to exactly
  **126 186** B, so the equality is proven against the generator, not just between two reports.
- **Zero-error claim re-checked independently**: the replica project is written to a temp dir and one
  middle entry (`src/file-0050.cssx`) is compiled through the public `compile()` (real Node host,
  imports resolved from disk): **0 error diagnostics**, emitted CSS re-parses. The full 100-entry
  replica also compiles with 0 errors and 0 CSS reparse diagnostics.
- The harness cannot be imported (it runs `main()` at import time), so all runs are subprocesses — a
  fact now pinned by this suite instead of assumed.

## Defects and observations (no compiler/CLI source changed — TT8 owns fixes)

### CSSX-T4 — selector expansion is exponential when nested levels carry two `&`s

- **Repro (deterministic, no seed needed):** `.a { & & { … } }` nested `n` levels deep, one
  `color: red;` at the bottom. Emitted CSS length by depth (measured): `4 → 66 B`, `6 → 210 B`,
  `8 → 786 B`, `10 → 3 090 B`, `12 → 12 306 B` — roughly ×4 per two levels. At **1 000 levels the
  compile did not finish within 180 s** (the probe was killed); scaling the observed growth makes the
  output astronomically large.
- **Current behavior:** no size bound, no cap diagnostic, no typed error — the process simply grows
  and eventually hangs or OOMs.
- **Expected contract:** a bound on emitted selector complexity (or on the `&`-product) with a typed
  diagnostic, so a pathological source fails fast instead of exhausting the build.
- **Consequence for plan §TT2 row 5:** "1k-deep `&` chain, 500-item selector list" is **not
  implementable as stated** for the `& &` shape — the assertion "emitted selectors remain valid CSS"
  cannot be observed because emission never completes. The row is implemented with the linear shape
  `.chain { &.m0 { &.m1 { … } } }` (1 000 levels → one 4 899-char selector) plus a 500-item list at the
  deepest level; that is executed and green (`selectors.test.ts:106`). The exponential shape is
  recorded here as the defect/repro for TT8.
- **Suggested TT8 task:** `CSSX-T4` — bound nesting-product expansion at lowering/flattening
  (`selectors/flatten` + lowering) with a `XESSA3xxx`/`XESSA1xxx` diagnostic naming the depth and the
  selector; add a regression test at the chosen limit.

### Observation O1 — the 500-module cycle diagnostic embeds the whole import path

`cycleProject(500)` produces one `XESSA2001` whose message lists all 500 modules: **13 936 chars**
in a single diagnostic. It is typed, bounded (one diagnostic) and deterministic, so it is pinned as
current behavior (`modules.test.ts:126`); it is **not** a failure. For TT8: consider truncating very
long cycle paths in the message (the span already identifies the entry).

No TT1-pinned defect (`CSSX-T1`/`CSSX-T2`/`CSSX-T3`) surfaced in this corpus — the scale inputs do
not exercise formatter idempotence or `$` prefix spans.

## Skips

None. Every plan §TT2 row has at least one executed case; the only "not implementable as stated"
variant is the `& &` exponential shape inside row 5, recorded above with its reason and replaced by
the linear-chain case plus the `CSSX-T4` repro. TT0 rows that were already covered were not
duplicated: resolver/naming/selector scale had no coverage (TT0 row 5), and the benchmark harness had
no test at all (TT0 row 10).

## Commands and outcomes

| Command | Outcome |
|---|---|
| `bun test tests/stress/scale/` | **PASS** — 17 pass / 0 fail, 4 247 `expect()` calls, 5 files, 11.31 s |
| `bun run lint` | **PASS** — `biome check .`, 464 files, no diagnostics (after formatting the new files) |
| `bun run typecheck` | **PASS** — `tsc --noEmit` for compiler, cli, language-service, vscode, exit 0 |
| `bun test` (full) | **PASS** — 1 122 pass / 0 fail, 77 files, 35.79 s; includes all 17 TT2 tests. No sibling failure on this tree (the earlier TT4 `concurrency.test.ts` failures recorded in `CSSX-TT1.md` are no longer present). |
| `bun scripts/benchmark.ts --json --size 100` | **PASS** — exit 0, `files=100 entries=100 diagnostics=0 outputBytes=126186` (run twice inside the benchmark test) |
| `bun node_modules/typescript/bin/tsc -p <temp>/tsconfig.json` (from `project.test.ts`) | **PASS** — exit 0 over 1 000 generated `.d.ts` files, 0.39 s |

## Handoff

- **Owned scope complete:** `tests/stress/scale/{generate.ts,selectors,modules,project,memory,benchmark}.test.ts`
  and this report. Total new code 1 500 lines, 17 tests.
- **Open for TT8:** `CSSX-T4` (bound exponential `&`-product expansion with a typed diagnostic);
  optional O1 (truncate 500-module cycle path in the `XESSA2001` message).
- **Not verified here:** a third-party CSS parser (owner dependency decision) — emitted validity is
  `parse()` plus `xessa check`, as the plan permits. Browser rendering of the emitted scale CSS is
  TT5/browser scope, not TT2.
