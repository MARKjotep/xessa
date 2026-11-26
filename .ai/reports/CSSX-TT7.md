# CSSX-TT7 — Soak and reliability

**Phase:** TT7 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟢 all four §TT7 rows executed
with real numbers; two findings routed to TT8 (one watch stall, one new formatter defect)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted. Owned write scope: `tests/stress/soak/**`,
`.ai/reports/CSSX-TT7.md`, `.ai/reports/logs/CSSX-TT7-*`. No `packages/**` source, fixture, golden,
existing suite or plan file was touched; `bun run verify` and `bun run test:browser` are green on the
final tree.

## Summary

- **Watch soak (30 min, 60 edits): PASS.** 61 builds, **60/60 fresh artifacts**, watcher RSS recorded
  as a **181-sample series**: 85.3 MB → 79.8 MB, min 42.7 / max 99.4 MB, **growth −5.5 MB**
  (peak-to-trough 56.7 MB) against a 512 MB ceiling and a 128 MB growth bound. Manifest consistent
  (400 records = 400 artifacts), 0 stale-generation discards, watcher exit 0.
- **Cold-build identity (20×1000 files): PASS.** **20/20 byte-identical** — one fingerprint
  `sha256:61fe3191a603b638140d4ee76ace796a81073d258ccd7f0e8c5c089fa0e6ce91` over 4 001 artifacts
  (CSS, `.css.map`, `.d.ts`, `js` + `.cssx-manifest.json`, 2 002 250 bytes each run), 0 mismatches,
  0 missing, per-build 7 150–7 381 ms.
- **Flake detection (5×): PASS, flake rate 0/5 and 0/5.** `bun run verify` 1 160 pass / 0 fail /
  1 162 tests / 85 files on all five runs; `bun run test:browser` 96 passed on all five runs.
- **Long fuzz (budget 100 000, seed 1): 500 042 cases.** `lexer`, `parser`, `compile` and
  `determinism` clean (exit 0, 0 violations); **`roundtrip` exit 1 with one unclassified violation**
  (`inputHash 1ba6fbd33e7b10f7`, 260 pinned) — triaged below as a **new formatter defect** (TT7-F2,
  `CSSX-T5` candidate). At **seed 3** `compile` reproduces pinned **CSSX-T3** on 3 cases (exit 1),
  which is the pin working as designed; at seed 1 the compile area is clean.
- **Two findings, no source changed:** **TT7-F1** — `xessa watch` can stall permanently after it
  discards a stale build generation, and the discarded generation leaves artifacts the manifest does
  not record; **TT7-F2** — `format` drops the `$` sigil from a namespaced variable declaration
  (`$ns.name: …`), so `parse(format(x))` loses the declaration and gains a `XESSA1001` error.
- Committed harness is `XESSA_SOAK=1`-gated: `bun test tests/stress/soak/` without the variable is
  `0 pass / 2 skip / 0 fail`; with it, both cases are green (watch 12.96 s, cold-build 170.7 s).

## Changed paths

| Path | Change |
|---|---|
| `tests/stress/soak/helpers.ts` | **New.** Shared plumbing: `SOAK_ENABLED` gate, `XESSA_SOAK_*` knob readers, TT2-generator project factory with `sourceMap: true`, temp-dir lifecycle (canonicalized `mkdtemp`), seeded edit recipe with a unique per-revision marker, `sha256:` file/artifact hashing + fingerprint, `ps`-based RSS sampler (`sampleRssMb`), `analyseRss`, bounded `waitFor`, `xessa watch --json` harness exposing the child pid, build-report parsing, manifest-vs-artifact-tree checker, consecutive cold-build runner, machine context, flag helpers. |
| `tests/stress/soak/watch-soak-case.ts` | **New.** The shared watch-soak loop used by the test and the driver: scheduled edits over an 8-file hot set, per-edit marker confirmation (stall = throw with the edit's source/artifact), continuous RSS sampling, `WATCH_RSS_CEILING_MB = 512`, `WATCH_RSS_GROWTH_MB = 128`, build-health and stale-discard accounting, bounded manifest settle. |
| `tests/stress/soak/watch-soak.test.ts` | **New, gated.** `describe.skipIf(!SOAK_ENABLED)` watch soak: 100 files / 12 edits / 1 000 ms (knobs `XESSA_SOAK_WATCH_{FILES,EDITS,INTERVAL_MS,SAMPLE_MS,TIMEOUT_MS}`), asserts freshness, build health, RSS bounds and manifest consistency. |
| `tests/stress/soak/cold-build.test.ts` | **New, gated.** `describe.skipIf(!SOAK_ENABLED)` identity case: **20 cold builds × 1 000 files**, `dist/**` + manifest hashed per run, one fingerprint, `4 × files + 1` artifacts (knobs `XESSA_SOAK_COLD_{BUILDS,FILES}`, `XESSA_SOAK_SEED`). |
| `tests/stress/soak/soak-watch.ts` | **New driver.** `--minutes 30 --edit-interval-s 30` release soak; JSON summary (config, 60 edits, 181 samples, RSS analysis, manifest, builds) + `--out`; exit 1 on any soak bound. |
| `tests/stress/soak/cold-build.ts` | **New driver.** `--builds 20 --files 1000`; per-build time/artifacts/bytes/fingerprint, identity verdict, `--out`. |
| `tests/stress/soak/flake-run.ts` | **New driver.** Drives `bun run verify` and `bun run test:browser` `--runs` times, parses pass/fail counts, 0/5 flake rate, writes a failing run's output verbatim to the log dir. |
| `tests/stress/soak/long-fuzz.ts` | **New driver.** Runs the TT1 runner per area at `--budget 100000`, records exit/cases/time/violations/pinned, classifies the pinned `CSSX-T3` reproduction as expected, writes per-area raw logs. |
| `.ai/reports/logs/CSSX-TT7-watch-soak.json` | 30-minute soak evidence: 60 edits + 181 RSS samples (~31 KB). |
| `.ai/reports/logs/CSSX-TT7-cold-build.json` | 20-run identity evidence (per-run time, artifact count, bytes, fingerprint). |
| `.ai/reports/logs/CSSX-TT7-flake.json` | 10 gate runs with per-run counts and durations. |
| `.ai/reports/logs/CSSX-TT7-long-fuzz.json`, `CSSX-TT7-fuzz-<area>.log`, `CSSX-TT7-fuzz-compile-seed3.log` | Long-fuzz summary + raw per-area runner output (incl. the seed-3 `CSSX-T3` reproduction). |
| `.ai/reports/CSSX-TT7.md` | This report. |

Nothing else changed: `git status` shows only the pre-existing campaign files plus `tests/stress/` and
`.ai/reports/logs/`.

## Case 1 — Watch soak

`bun tests/stress/soak/soak-watch.ts --minutes 30 --edit-interval-s 30 --files 100 --seed 1 --sample-interval-s 10 --out .ai/reports/logs/CSSX-TT7-watch-soak.json`

| Measurement | Value |
|---|---|
| Project | 100 generated sources, `cssDir dist/styles`, `mapDir dist/maps`, `sourceMap: true`, `emitMap`/`emitTypes`/`importCss`, `strict`, `mediaGrouping: safe` (TT2 1000-file recipe, 100 files, seed 1) |
| Edits | **60** (one source rewritten every 30 s, rotating over an 8-file hot set; each revision writes `color: rgb(<revision>, 0, 17)` as a unique marker) |
| Duration | **1 811 294 ms (30 min 11 s)**; first edit at +30 112 ms, last at +1 801 254 ms |
| Readiness | `sources=100`, `debounceMs=40`, ready RSS 85.3 MB |
| Builds | **61** (initial + one per edit), `buildsHealthy=true`, 0 error diagnostics, **0 stale-generation discards**, watcher exit 0 |
| Fresh artifacts | **60/60** — every edit's marker landed **and** every confirmation produced a **distinct artifact hash** (`distinctArtifacts=60`) |
| Watcher latency (write → artifact contains marker) | min **110 ms**, p50 **462 ms**, p95 **1 254 ms**, max **1 564 ms** |
| RSS series | **181 samples** at 10 s intervals over 1 800 859 ms: first **85.3 MB**, last **79.8 MB**, min **42.7 MB**, max **99.4 MB**, growth **−5.5 MB**, peak-to-trough **56.7 MB** (bounds: ceiling 512 MB, growth 128 MB) |
| Manifest | **400 records = 400 artifacts**, sorted, unique, every hash matches the file on disk, no orphans (`problems=[]`) |

Series endpoints (MB): `0s:85.3 10s:85.2 20s:85.2 30s:85.2 40s:85.8 … 1760s:83.6 1771s:78.2 1781s:78.8 1791s:79.3 1801s:79.8`.
The claim is bounded, not flat: RSS oscillates by ≤ 57 MB with no upward trend across 30 minutes
(the collector sawtooth dominates), which is the recorded series the plan's exit criterion asks for.
The full series (181 samples) and all 60 edit records are in `CSSX-TT7-watch-soak.json`.

Committed short form (`XESSA_SOAK=1 bun test tests/stress/soak/`): 100 files / 12 edits / 1 000 ms →
`builds=13`, `edits=12`, `distinctArtifacts=12`, latency p50 236 ms / max 331 ms,
RSS 85.8 → 107.1 MB (49 samples, growth 21.3 MB), manifest 400/400, **green in 12.96 s**.

## Case 2 — Cold-build identity

`bun tests/stress/soak/cold-build.ts --builds 20 --files 1000 --seed 1 --out .ai/reports/logs/CSSX-TT7-cold-build.json`

| Measurement | Value |
|---|---|
| Builds | **20** consecutive cold builds, each in a brand-new `mkdtemp` project holding byte-identical generated sources (no manifest, no warm cache) |
| Artifacts hashed per build | **4 001** = 1 000 × (`css` + `css.map` + `.map.d.ts` + `.map.js`) + `.cssx-manifest.json`; **2 002 250 bytes** |
| Identity | **20/20 identical** — one fingerprint `sha256:61fe3191a603b638140d4ee76ace796a81073d258ccd7f0e8c5c089fa0e6ce91`; **0 hash mismatches, 0 missing paths, 0 extra paths**, every build exit 0 with `errors=[]` |
| Per-build time | min **7 150 ms**, median **7 223 ms**, max **7 381 ms**, total **144 500 ms** (wall clock 157 309 ms / 2 min 37 s) |
| Coverage of "CSS, map, `.d.ts`, manifest" | all four kinds are inside the fingerprint; source maps are byte-stable across temp roots (`sources:["src/file-0000.cssx"]`, no absolute paths) |

The same case runs as a committed gated test (`XESSA_SOAK=1 bun test tests/stress/soak/`, 2 pass / 0 fail in
**171.1 s**): cold-build identity **1 pass, 20/20 identical**, same fingerprint, 158.1 s (170.7 s when run
on its own; the difference is hashing/IO overhead, not build behavior).

## Case 3 — Flake detection ×5

`bun tests/stress/soak/flake-run.ts --runs 5 --suites verify,browser --out .ai/reports/logs/CSSX-TT7-flake.json`

| Run | `bun run verify` | `bun run test:browser` |
|---|---|---|
| 1 | exit 0 — 1 160 pass / 0 fail / 1 162 tests / 85 files, 47 230 ms | exit 0 — **96 passed**, 89 035 ms |
| 2 | exit 0 — 1 160 pass / 0 fail, 46 739 ms | exit 0 — **96 passed**, 87 718 ms |
| 3 | exit 0 — 1 160 pass / 0 fail, 46 106 ms | exit 0 — **96 passed**, 87 927 ms |
| 4 | exit 0 — 1 160 pass / 0 fail, 46 851 ms | exit 0 — **96 passed**, 90 279 ms |
| 5 | exit 0 — 1 160 pass / 0 fail, 46 710 ms | exit 0 — **96 passed**, 89 224 ms |
| **Flake rate** | **0/5** | **0/5** |

Total campaign wall clock 677 828 ms (11 min 18 s). No flake occurred, so no failing test or error had
to be captured. `verify` reports 1 162 tests because the two gated soak tests are counted as skipped
(`1 160 pass + 2 skip`); the pre-TT7 baseline was 1 160 pass / 83 files. The browser gate ran
Chromium + Firefox + WebKit (96 tests = 32 × 3), matching the campaign baseline.

## Case 4 — Long fuzz at maximum budget

`bun tests/stress/soak/long-fuzz.ts --budget 100000 --seed 1 --out .ai/reports/logs/CSSX-TT7-long-fuzz.json`

| Area | Cases | Time | Violations | Pinned | Exit | Verdict |
|---|---|---|---|---|---|---|
| lexer | 100 010 | 549 ms | 0 | 0 | 0 | clean |
| parser | 100 010 | 1 008 ms | 0 | 0 | 0 | clean |
| compile | 100 000 | 30 528 ms | **0** | 0 | 0 | clean at seed 1 (see deviation) |
| roundtrip | 100 010 | 4 525 ms | **1** | 260 | **1** | 1 unclassified violation → TT7-F2 |
| determinism | 100 012 | 86 625 ms | 0 | 0 | 0 | clean |
| **total** | **500 042** | **123 372 ms (2 min 3 s)** | **1** | **260** | — | 4/5 areas clean |

**Pinned `CSSX-T3` evidence (seed 3):**
`XESSA_STRESS_SEED=3 bun tests/stress/fuzz/runner.ts --area compile --budget 100000 --seed 3` →
**exit 1, `cases=100000 time=30831ms violations=3 pinned=0`**, all three `out-of-bounds span … for
XESSA2001` (`CSSX-T3`, the defect TT1 pinned and deliberately did not exempt). The exact cases and
spans (full output in `CSSX-TT7-fuzz-compile-seed3.log`):

| Case | Out-of-bounds span | Source length | inputHash |
|---|---|---|---|
| `runtime/basic [dollar-at-abuse] inserted @variables { $$$: 1; } \| $$$$$` | `122..133` | 124 | `238cccfef402d033` |
| `runtime/with-variant [dollar-at-abuse] inserted @variables { $$$: 1; } \| @runtime { --a: @b$c; }` | `218..220`, `237..239` | 217 | `48636492a05f3010` |
| `runtime/collision-with-compile-time [dollar-at-abuse] inserted @runtime { --a: @b$c; } \| $$$$$ \| $a.b.c.d` | `154..163` | 152 | `0f531622ffbf3c9f` |

The driver reports `compile` at **seed 1** as clean, so "the long compile run always exits 1" is a
seed-dependent statement (see Deviations). At the seed where the defect lives the pin behaves exactly
as TT1 documented: deterministic reproduction, exit 1, replay command printed.

## Findings

### TT7-F1 — `chix watch` stalls permanently after discarding a stale build generation (medium-high)

- **Where:** `packages/cli/src/commands/watch.ts:96-108` (`notify()` clears `wake` and resolves it;
  while `runCycle` awaits, `wake` is `undefined`, so the debounce notification is **dropped**) and the
  dispatch loop at `watch.ts:191-260` (after a stale generation is discarded the loop returns to
  `waitForWork()`; the change that invalidated the build is still in `pending` but nothing wakes the
  loop again).
- **Observed:** with a 250 ms edit cadence (writes land inside the ~300 ms incremental build) the
  watcher logs `xessa watch: discarded a stale build generation` and then **never builds again** —
  10 s of silence, no `build` event, the edited file's artifact still shows the previous content. Any
  later filesystem event resumes work, i.e. the queued change is not lost *permanently* but is lost
  **until an unrelated event arrives**.
- **Second consequence (soak row "manifest stays consistent"):** the discarded build has already
  renamed some artifacts into place but never rewrites the manifest, so `checkManifest` reports
  `hash mismatch for dist/{styles,maps}/src/file-00N…` for the entries it wrote — `xessa clean`
  ownership tracking is then wrong until the next successful cycle.
- **Repro (3/3 reproductions, deterministic in practice):**
  `XESSA_SOAK=1 XESSA_SOAK_WATCH_EDITS=5 XESSA_SOAK_WATCH_INTERVAL_MS=250 bun test tests/stress/soak/watch-soak.test.ts`
  → stalls on edit 3 (`src/file-002.cssx`) with `error: [watch soak edit 3 (src/file-002.cssx ->
  dist/styles/src/file-002.css) timed out after 30000ms (possible watcher stall)`.
- **Not fixed here:** `packages/cli/**` is outside this phase's write set; the behaviour is not pinned
  as a test because the trigger is a filesystem-event race (`fs.watch` sometimes delivers a second
  event for the same write that self-heals the loop), so a committed pin would be flaky. The
  committed soak case therefore uses **1 000 ms** (3× one build) and documents why in
  `tests/stress/soak/helpers.ts`; the 30 s release cadence is three orders of magnitude clear of it.
- **Suggested fix (TT8):** make the wakeup latch — either set a `pendingWake` flag in `notify()` when
  `wake` is `undefined` and check it before awaiting, or skip `await waitForWork()` whenever
  `pending`/`pendingUnknown`/`pendingConfig` are non-empty. Secondarily, a discarded generation
  should not have written anything yet (check `isCurrent()` before the first rename) so the manifest
  can never disagree with the tree.

### TT7-F2 — `format` drops the `$` sigil of a namespaced variable declaration, so formatting loses it (medium)

- **Found by:** TT7 long fuzz, `roundtrip` area, seed 1, budget 100 000 —
  `parse(format(x)) IR differs from parse(x) IR`, `inputHash 1ba6fbd33e7b10f7`, case
  `variables/namespaced-members [token-splice] swap tokens 25 and 47` (fixture
  `tests/fixtures/variables/namespaced-members/input.cssx`, operator `token-splice`). It is **not**
  `CSSX-T1` (no unbalanced `[`/`(` in a native at-rule prelude) and **not** `CSSX-T2` (no declaration
  variant whose value starts with `@`): `classifyRoundTripDefect(source, file) === undefined`.
- **Offending input** (the mutation turns the fixture's `gap: $layout.spacing;` into an authored
  `$layout.margin` declaration; the document parses with **zero diagnostics**):

  ```cssx
  @setup { prefix: "ui"; }
  @use "./layout.cssx" as layout;
  @variables {
    $layout.margin: $layout.spacing;
  }
  .card {
    padding: $gap;
    margin: gap;
  }
  ```

- **Observed:** `format()` returns `@variables {\n  layout.margin: $layout.spacing;\n}` — the `$` is
  gone. Reparsing that output yields **0 token declarations** and one new error:
  `XESSA1001 syntax error: expected ':' after property 'layout'` at offset 21. Before/after IR
  (position-normalized) differ only in `items[2].tokens`: one `token-declaration {name:"layout.margin",
  value:"$layout.spacing", tokens:[dollar-ref]}` versus `[]`.
- **Minimized repro (no mutation needed):**
  `format("@variables {\n  $layout.margin: 4px;\n}\n")` → `"@variables {\n  layout.margin: 4px;\n}\n"`
  → `parse(...)` = `XESSA1001` at the `.`, `@variables` block empty.
- **Root cause (read-only):** `packages/compiler/src/parser/statements.ts:374` strips the sigil into the
  IR (`name = nameToken.value.startsWith("$") ? nameToken.value.slice(1) : nameToken.value`), and
  `packages/compiler/src/formatter/index.ts:433-435` (`printTokenDeclaration` →
  `` `${token.name}: ${token.value};` ``) prints that name verbatim, so the `$` is never re-emitted.
  For single-segment names the loss is invisible to the IR check (`@variables { margin: 4px; }`
  reparses to an equal declaration), which is why the 67-fixture round-trip suite and TT1's
  budget-200/500 runs never saw it; a **dotted** name is only valid with the `$`, so there it becomes
  an error plus a lost declaration.
- **Impact:** `xessa format` (and the VS Code formatting provider) silently rewrites a valid
  namespaced variable declaration into an invalid one; `format --check` cannot help because the
  formatted output is the broken one. Idempotence still holds, so `format(format(x)) === format(x)`
  does not catch it.
- **Classification:** **unclassified roundtrip violation — needs a TT8 fix task** (`CSSX-T5`
  candidate). Not pinned as a test (fixing the formatter is outside this phase); the TT1 runner
  reproduces it deterministically from `seed=1 budget=100000` and `inputHash 1ba6fbd33e7b10f7`.
- **Suggested fix (TT8):** keep the authored sigil in the IR (e.g. `name` plus `sigil: "$"`/flag) or
  have `printTokenDeclaration` re-add `$` when the declaration came from a `$`-prefixed name; then
  re-run `roundtrip` at budget 100 000 and add a fixture with `$ns.name:` declarations.

## Deviations and limitations

| Item | Deviation / limitation |
|---|---|
| `compile` long run at seed 1 | The brief expected `--area compile --budget 100000 --seed 1` to exit 1 via `CSSX-T3`. It exits **0** (0 violations, 30.5 s): at seed 1 the 100 000-case corpus does not reach the `$`-prefix span shift. The pin is demonstrated at **seed 3** (3 `XESSA2001` out-of-bounds spans, exit 1) instead, and the seed-3 log is committed. No assertion was weakened: the driver classifies the pinned reproduction as expected and would fail on any other non-zero area. |
| Committed soak cadence | `SOAK_DEFAULTS.watchEditIntervalMs = 1 000` (not 250) because of TT7-F1; the release soak uses the plan's 30 s and the defect does not trigger. Documented in code and above. |
| Cold-build per-build time | 7.2 s vs 4.6 s for a single 1000-file build without maps: the soak project enables `sourceMap: true` so the identity row covers **CSS, map, `.d.ts` and manifest**. |
| `verify` test count | 1 162 tests / 85 files (1 160 pass + 2 skip) vs the TT0/TT1 baseline 1 160/83: the two gated soak tests add two skips to the default gate; nothing is executed. |
| Watch-soak memory bound | The 512 MB ceiling / 128 MB growth bound are justified relative to `docs/performance.md` (1000-file cold build peaks ≈ 115 MB); the recorded series (max 99.4 MB over 30 min) is two orders away from the ceiling, so the bound is a runaway detector, not a tight threshold. |
| Not re-run | `bun run release:check` stays with the production plan's PP0 gate; no packaging artifact was touched. |

## Machine context

| Field | Value |
|---|---|
| CPU | Apple M1 Pro, 8 cores |
| Memory | 16 GB |
| OS | darwin 27.3.0 (macOS 27.3), arm64 |
| Bun | 1.4.5 |
| Node (reported by Bun) | 26.3.0 |
| Repo | `/Users/Marky/Desktop/$/xessa`, branch `main`, uncommitted working tree |

## Commands and outcomes

| Command | Outcome |
|---|---|
| `bun tests/stress/soak/soak-watch.ts --minutes 30 --edit-interval-s 30 --files 100 --seed 1 --sample-interval-s 10 --out .ai/reports/logs/CSSX-TT7-watch-soak.json` | **PASS, exit 0** — 60 edits, 61 builds, 60/60 fresh, RSS 42.7–99.4 MB (growth −5.5 MB, 181 samples), manifest 400/400, 30 min 11 s |
| `bun tests/stress/soak/cold-build.ts --builds 20 --files 1000 --seed 1 --out …cold-build.json` | **PASS, exit 0** — 20/20 identical, 4 001 artifacts, fingerprint `sha256:61fe3191…`, 0 mismatches, 157 309 ms |
| `bun tests/stress/soak/flake-run.ts --runs 5 --suites verify,browser --out …flake.json` | **PASS, exit 0** — verify 0/5, browser 0/5; 1 160 pass / 0 fail and 96 passed on every run; 677 828 ms |
| `bun tests/stress/soak/long-fuzz.ts --budget 100000 --seed 1 --out …long-fuzz.json` | **exit 1** — lexer/parser/compile/determinism clean (500 042 cases total), roundtrip 1 unclassified violation (TT7-F2); 123 372 ms |
| `XESSA_STRESS_SEED=3 bun tests/stress/fuzz/runner.ts --area compile --budget 100000 --seed 3` | **FAIL, exit 1 (expected)** — 3 `XESSA2001` out-of-bounds spans (`CSSX-T3` pin), 30 831 ms |
| `XESSA_SOAK=1 bun test tests/stress/soak/` | **PASS** — **2 pass / 0 fail**, 171.06 s across 2 files (watch soak 12.96 s, cold-build identity 158.07 s); cold-build also verified alone at 170.66 s |
| `bun test tests/stress/soak/` (gate unset) | **PASS** — `0 pass / 2 skip / 0 fail`, default gate stays fast |
| `bun run lint` | **PASS** — `biome check .`, 481 files, no diagnostics |
| `bun run verify` | **PASS** — typecheck + lint + `1 160 pass / 2 skip / 0 fail`, 1 162 tests across 85 files, 42.67 s |
| `bun run test:browser` (×5 inside the flake case) | **PASS** — 96 passed every run (Chromium/Firefox/WebKit) |
| `git status --short` | Only `tests/stress/` and `.ai/reports/` additions from this phase; `packages/**`, `scripts/**`, `examples/`, `tests/fixtures/**` untouched |

## Handoff

- **Owned scope complete:** `tests/stress/soak/{helpers,watch-soak-case,watch-soak.test,cold-build.test,soak-watch,cold-build,flake-run,long-fuzz}.ts`,
  `.ai/reports/CSSX-TT7.md`, `.ai/reports/logs/CSSX-TT7-*`. The plan's TT7 row can move to 🟢 once the
  lead re-runs the gated suite and the two gates.
- **TT8 task candidates:**
  1. **TT7-F1** — latch the watch wakeup (`watch.ts:96-108`) and check `isCurrent()` before the first
     artifact rename so a discarded generation cannot desync the manifest. Repro recipe above.
  2. **TT7-F2 (`CSSX-T5` candidate)** — formatter must preserve the `$` sigil of a namespaced
     `token-declaration` (`parser/statements.ts:374` + `formatter/index.ts:433-435`); minimized repro
     `format("@variables {\n  $layout.margin: 4px;\n}\n")`. When fixed, `roundtrip` at budget 100 000 /
     seed 1 should exit 0 and the long-fuzz driver will report `unexpectedFailures=[]`.
  3. **CSSX-T3** remains open (TT1); the seed-3 run in this report is its long-budget evidence.
- **Reproduction knobs:** watch soak `--minutes/--edit-interval-s/--files`; identity
  `--builds/--files`; flake `--runs/--suites`; fuzz `--budget/--seed/--areas`; committed tests honour
  `XESSA_SOAK_*` (see `helpers.ts` `SOAK_DEFAULTS`).
