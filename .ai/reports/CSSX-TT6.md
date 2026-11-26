# CSSX-TT6 — Editor / language-service stress

**Phase:** TT6 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟡 complete, one gate red for a reason outside this write set (see *Gates*)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted (shared wave tree: TT1 owns `tests/stress/{prng,corpus}.ts` + root `package.json`, TT3 `tests/stress/fs/**`, TT4 `tests/stress/cli/**`)
**Write set used:** `tests/stress/editor/**` (new files only) + this report

## Summary

- Retargeted TT6 at the **real** implementation after the TT0 premise error: `packages/language-service/src` is a
  3-line stub (`export {}`), so every case drives `packages/vscode/src/{analysis,intelligence,service,controller,groups,keyframes,glob,paths}.ts`
  — the modules the extension host actually runs, all of them `vscode`-free except `controller.ts`, which this
  report's activation case drives through a counting fake of the `vscode` API.
- All seven plan §TT6 rows are implemented as executable cases (48 tests / 7 files, **48 pass / 0 fail**), with one
  row (host-only behaviour) explicitly deferred to PP3 with its reason, and one genuine editor↔compiler divergence
  found and recorded as an observation for TT8 rather than red-tested.
- **Latency** at 10 000 lines: completion p95 **0.4 ms**, hover p95 **6.0 ms**, definition p95 **2.5 ms**, rename p95
  **8.5 ms**, reference p95 **5.4 ms**; cold `analyzeText` p95 **21.7 ms**; the compile-backed path p95 **173 ms**.
- **1000-file project**: discovery + full alias/symbol index p50 **13.5 ms** / p95 **25.2 ms** for 1001 modules.
- **Keystroke storm**: 6 documents × every character position = **932 keystrokes**, no throw, no unhandled
  rejection, **49.7 ms** total. **Malformed mid-edit**: **416 truncated prefixes** (390 of them malformed,
  595 parse diagnostics), every provider call well-formed on every prefix.
- **Differential (weakest-10 #9a)**: `groups.ts` + `keyframes.ts` match `resolver/{groups,keyframes}.ts` on all
  **26 fixture directories** and on **60 seeded DAG projects**; a **documented divergence** exists for module
  *cycles* (already XESSA2001) — measured 9/100 seeds, repro in *Defects and observations*.
- **Repeated activation**: 50 × `activate()`/`dispose()` leave **0 live registrations** each cycle, exactly **27**
  disposables per cycle, and the debounced `AnalysisService` leaves 0 pending timers / 0 cache entries.

## Changed paths

| Path | Lines | Contents |
|---|---|---|
| `tests/stress/editor/documents.ts` | 325 | Seeded xorshift32 PRNG (local — TT1 owns `tests/stress/prng.ts`), 10 000-line document generator, A45–A51 mid-edit corpus, storm corpus, truncation helper, seeded module-project generator for the differential |
| `tests/stress/editor/timing.ts` | 137 | Nearest-rank p50/p95/max recorder (sync + async), generous ceilings, printable table |
| `tests/stress/editor/vscode-host.ts` | 326 | Counting fake `vscode` module + fake `ExtensionContext`; every registration/disposable is tracked |
| `tests/stress/editor/latency.test.ts` | 181 | 10k-line case: cold analysis, completion, hover, definition, references, rename, colours, outline, compile path |
| `tests/stress/editor/index.test.ts` | 263 | 1000-file project: discovery, alias index build, spot-checks, compiler agreement in a `mkdtemp` dir |
| `tests/stress/editor/storm.test.ts` | 172 | Keystroke storm through `parse()` + the four per-keystroke provider entry points |
| `tests/stress/editor/mid-edit.test.ts` | 190 | Every truncated prefix of the five representative documents |
| `tests/stress/editor/a51-surfaces.test.ts` | 296 | `#` palette, `(` opener, `&:`/`&.` repairs asserted at **every** character position |
| `tests/stress/editor/differential.test.ts` | 434 | Fixture + generated DAG + cyclic corpora vs the compiler resolver |
| `tests/stress/editor/activation.test.ts` | 223 | 50 activation cycles, per-kind registration deltas, `AnalysisService` teardown/version guard |
| `.ai/reports/CSSX-TT6.md` | this file | Report |

Nothing outside those paths was modified: no source, no fixture, no `tests/extension/**`, no
`packages/vscode/test/suite.js`, no plan, no `package.json`. Existing suites were not touched or weakened.

## Cases implemented (plan §TT6 → file)

| Plan row | Implemented in | Assertion actually made |
|---|---|---|
| 10k-line file, completion/hover/rename/definition with recorded p50/p95 | `latency.test.ts` | 10 008-line / 226 KB generated document (1 108 classes, 562 colours, 18 tokens, 0 diagnostics). Each operation measured after warm-up; every op first proves it does real work (items found, hover text, 1 definition target, 117 rename edits); p95 compared only to `HARD_CEILING_MS = 500` (compile path: 5 000) |
| 1000-file project index + spot-checked correctness | `index.test.ts` | 1001 discovered modules, alias index with 1002 names, `tok-500` → `mod-500.cssx`, `$shared.base` hover/definition crosses modules, unknown `$missing-token` → XESSA2001 + empty hover/completion/definition |
| Keystroke storm | `storm.test.ts` | 932 keystrokes; every keystroke re-parses and runs `analyzeText`/`completionsAt`/`hoverAt`/`colorsAt`/`documentSymbols`; result ranges in bounds; total time recorded; `unhandledRejection` listener asserts empty |
| Malformed mid-edit | `mid-edit.test.ts` | 416 prefixes × 3 cursors; parse diagnostic spans `0 ≤ start ≤ end ≤ length`; provider ranges in bounds; completions degrade to a valid (sometimes empty) list; no NUL/newline insert text |
| A51 surfaces under typing | `a51-surfaces.test.ts` | `#`/`#f`/`#f0`/`#f0e7` narrowing with per-item `replaceStart` at the `#`; `(`/`(c`/`(cl`/`(clamp` with per-item range at the paren; `&:`/`&::`/`&.` ranges at every position; all four repeated at a deep offset (~4.6 KB) in a generated document |
| Differential `groups.ts`/`keyframes.ts` vs compiler resolver | `differential.test.ts` | see *Differential* below |
| Repeated activation | `activation.test.ts` | 50 cycles, live registrations return to 0, identical per-cycle delta (27) and per-kind table, `AnalysisService` schedule/forget and version guard |
| Host-only behaviour (suggest-widget swatches, native picker, real activation) | **not implemented here** | deferred to CSSX-PLAN-PRODUCTION.md PP3 — see *Not observable here* |

## Recorded latency — 10 000-line generated document

Source: `bun test tests/stress/editor/` (Bun 1.4.5, macOS arm64, Darwin; nearest-rank percentiles; milliseconds).

| Case | n | p50 | p95 | max |
|---|---|---|---|---|
| `analyzeText` (cold analysis: parse + aliases + tokens + classes + colours + groups + keyframes) | 20 | 19.3 | 21.7 | 22.2 |
| `completionsAt` (`$ga` → token list) | 100 | 0.3 | 0.4 | 0.5 |
| `hoverAt` (`$gap`) | 100 | 5.0 | 6.0 | 6.7 |
| `definitionsAt` (`$gap`) | 100 | 2.2 | 2.5 | 2.9 |
| `referencesAt` (`$gap`, 117 hits) | 50 | 4.8 | 5.4 | 5.8 |
| `renameAt` (`$gap` → `gap-renamed`, 117 edits) | 50 | 7.5 | 8.5 | 8.7 |
| `colorsAt` (562 inline swatches) | 50 | 1.0 | 1.2 | 2.2 |
| `documentSymbols` (560 outline nodes) | 50 | 4.5 | 5.2 | 5.4 |
| `analyzeDocument` (parse + full in-memory compile, 1 108 classes, 406 KB CSS) | 5 | 167.9 | 173.3 | 173.3 |

Ceilings: `HARD_CEILING_MS = 500` for every editor operation, `COMPILE_CEILING_MS = 5 000` for the
compiler-backed path. The hard ceiling is ~50× the recorded p95, so a slower CI box records a larger number
instead of failing; **no case asserts an exact millisecond value**. Cross-check against the masterplan's
"completion < 100 ms cached": recorded p95 is 0.4 ms, i.e. 250× inside the budget.

### 1 000-file project index (in-memory tree, injected lister)

| Case | n | p50 | p95 | max |
|---|---|---|---|---|
| alias/symbol index over 1001 modules (1002 token symbols) | 3 | 13.5 | 25.2 | 25.2 |
| `analyzeText` over a 50-module sample | 50 | 0.6 | 1.0 | 1.4 |

`discoverProjectEntries` over the 1000-module tree: ~2–4 ms per full walk (recorded in the case, no assertion
on the number). No filesystem writes for the project itself; the one spot-check that needs real paths builds in
`mkdtemp` and removes it in `afterAll`.

## Differential — editor vs compiler resolver (weakest-10 #9a)

Compared: visible name set, resolution kind (`resolved`/`ambiguous`), defining module and ambiguity candidate
sets, for both `@group.` and `@keyframes` visibility.

| Corpus | Size | Result |
|---|---|---|
| `tests/fixtures/{groups,keyframes}/*` with an `entry.cssx`/`input.cssx` | 26 directories (20 groups, 6 keyframes) | **MATCH** on every directory, groups and keyframes |
| Seeded acyclic module projects (`generateModuleProject(seed)`, seeds 1–60) | 60 projects, 3–8 modules each, styles + token-only `@use` edges, duplicate definitions, repeated keyframe names | **MATCH** (groups strict; keyframes under the documented duplicate rule) |
| Same corpus adequacy check | — | >10 styles edges, >10 token-only edges, >0 repeated keyframe names per corpus — the corpus is not degenerate |
| Cyclic projects (seeds 1–40) | 40 projects | termination + determinism + "every candidate is a loaded module" hold; 22 `Import cycle detected` diagnostics across the corpus. **Recovered sets are not compared** — see observation O1 |

Why keyframes use a documented rule instead of strict equality: for two `styles`-imported definitions of one
name with no local one, the compiler resolves the first (ADR-0015: duplicate names across merged modules are
valid CSS, no diagnostic) while the editor deliberately reports `ambiguous` — hover says *"the compiler reports
no conflict"*, definition returns nothing and rename refuses. That is a designed editor state, so the case
asserts: the compiler's module is one of the editor's candidates, there are ≥2 candidates, and the compiler
diagnosed nothing. Groups have an `ambiguous` kind on **both** sides, so they are compared strictly.

## Keystroke storm and malformed mid-edit

| Case | Corpus | Outcome |
|---|---|---|
| Keystroke storm (`storm.test.ts`) | 6 documents (the 5 A45–A51 documents + one exercising every trigger character `@ $ . : / & ( #`), 1 438 authored characters → **932 keystrokes** | no throw, no unhandled rejection, completion ranges valid at every keystroke, **49.7 ms** for the whole replay, per-keystroke p95 **0.1 ms** |
| Malformed mid-edit (`mid-edit.test.ts`) | 5 documents → **416 truncated prefixes** (3 273 characters), 3 cursor positions each | **390 prefixes malformed**, **595 parse diagnostics**, all spans in bounds; every provider call returns a well-formed result; completions degrade to an empty list (e.g. `color: #f0e7` → 0 items) rather than an error |

The two files also install an `unhandledRejection` listener for their duration and assert it stayed empty.

## A51 surfaces under typing (unit model, pure layer)

| Surface | Typed sequence | Invariant asserted at **every** character position |
|---|---|---|
| `#` hex palette (A51) | `#`, `#f`, `#f0`, `#f0e7` | offers are colour-kind only; every item's `replaceStart` is the typed `#`, so accepting a swatch replaces the literal; the hex list narrows monotonically (`35 → 5 → 0 → 0` entries are palette matches); `#e7` → exactly `#e74c3c`; the result-level range stays the plain word range (one past the `#`) |
| `(` call opener (A50) | `(`, `(c`, `(cl`, `(cla`, `(clam`, `(clamp` | offers are curated functions only and every item's `replaceStart` is the typed paren, so accepting `clamp(` writes `width: clamp(` and never `((clamp(`; list narrows `25 → 6 → 1` |
| `&:` / `&::` (A46) | `&:`, `&:h`, `&:ho`, `&:hov`; `&::`, `&:::a…` | context stays `pseudo`; range covers the typed colons, so `:hover` yields `&:hover` (never `&::hover`) and `::after` yields `&::after` |
| `&.` (A46) | `&.`, `&.t`, `&.te` | range starts **after** the dot, so `.test` yields `&.test` (never `&test`) |

All four are repeated with the same document shape appended to a generated 200-line stylesheet, proving the
ranges are exact absolute offsets thousands of characters into a document.

## Repeated activation

`XessaController` is driven through `mock.module("vscode", …)` with a counting fake; every disposable the fake
hands out is tracked.

| Measurement | Result |
|---|---|
| 50 × (`new XessaController(ctx)` → `activate()` → `dispose()`) | live registrations after every `dispose()`: **0** |
| Disposables created per cycle | **27**, identical in all 50 cycles (output channel, status bar, diagnostic collection, 9 language providers, 6 commands, 8 workspace listeners) |
| Per-kind table for one cycle | pinned exactly (1 each for the 13 provider/collection kinds, **6** `commands.registerCommand`, 1 each for the 8 workspace listeners) |
| Re-activation | a retired controller disposed a second time does not disturb the live one (live = 27 before its own dispose, 0 after) |
| `ExtensionContext.subscriptions` | grows by the 28 pushed disposables per activation (28 → 1 400 after 50 cycles) — the `ExtensionContext` contract (the host disposes them on deactivate); recorded, not asserted as a leak, because a real host activates once |
| `AnalysisService` | 50 × `schedule()`/`forget()`: pending timers always return to 0 and the cache entry is dropped; 50 `schedule()` calls on one document cancel down to **1** pending timer; `analyzeNow` caches one entry per path and never lets a stale version overwrite a newer one |

## Defects and observations

### O1 — editor/compiler group divergence on **cyclic** module graphs (recorded, not red-tested)

- **What:** for a module cycle, `vscode/src/groups.ts` and `compiler/src/resolver/groups.ts` recover different
  sets. Measured over `generateModuleProject(seed, { cyclic: true })`, seeds 1–100: **9 seeds diverge**, 15
  module-level differences. Acyclic projects diverge on **0 of 60** seeds.
- **Minimal repro (seed 15, `/virtual/b.cssx`)**
  ```
  a.cssx: @use "./e.cssx";        @use "./f.cssx" styles;  @group.card { padding: 1px; }
  b.cssx: @use "./f.cssx";        @use "./a.cssx" styles;  @group.card { padding: 2px; }
  c.cssx: @use "./b.cssx" styles; @group.panel { padding: 3px; }
  e.cssx: @group.panel { padding: 5px; }
  f.cssx: @use "./c.cssx" styles; @use "./e.cssx";
  compiler (b): [["card","resolved:/virtual/b.cssx"]]
  editor   (b): [["card","resolved:/virtual/b.cssx"],["panel","resolved:/virtual/c.cssx"]]
  ```
- **Cause (both sides documented as "a back edge contributes nothing"):** each implementation memoizes partial
  closure results computed *inside* a cycle (`groups.ts` `closureMemo`, `resolver/groups.ts` `collect` memo), so
  which file first hits the back edge changes what later files see. Neither answer is "correct": the input is
  already `XESSA2001 Import cycle detected`.
- **Why not a red test:** the contract for an error state is termination + determinism, which the case asserts.
  Cycle correctness at scale belongs to TT2 ("diamond + cycle graph of 500 modules"). Routed to TT8 as a
  documented limitation; no assertion was weakened and no test was skipped.

### O2 — `analyzeDocument` needs a canonical temp root on macOS (environment note)

`mkdtempSync(join(tmpdir(), …))` returns `/var/folders/…`, which is a symlink to `/private/var/…`. The compiler's
workspace-containment check compares literal paths, so a document under `/var/folders/…` with
`workspaceRoot: /var/folders/…` reports `XESSA5001 Source "…" is outside the workspace root "…"` even though
the file is inside it. The TT6 cases therefore pass the temp root through `realpathSync` (documented in
`index.test.ts`). Real-editor impact is limited to documents opened through a symlinked path; symlink/path
handling is TT3's case, so this is recorded here as an observation only.

### O3 — two completion ranges, pinned deliberately (not a defect)

The A50/A51 states expose a **result-level** range (the plain typed word, which VS Code narrows against) and a
**per-item** `replaceStart` (the repair range covering the typed `(` or `#`). Every case asserts both, because a
regression that changes one but not the other produces exactly the historical `((clamp(` / `#red` bugs.

## Not observable here (deferred, with reasons)

| Item | Reason | Owner |
|---|---|---|
| Suggest-widget rendering of colour swatches, filter-text behaviour, native colour picker, hover tooltips as rendered | Needs a real VS Code renderer; `bun test` has no widget layer. The pure layer's swatch `kind`/`detail`/`filterText` are asserted here and in `tests/extension/` | CSSX-PLAN-PRODUCTION.md PP3 |
| Real extension activation, activation events, workspace trust, `Preview Compiled CSS` virtual documents | `packages/vscode/src/controller.ts` requires the `vscode` module. The counting fake observes registration/teardown only; the real host path runs through `packages/vscode/test/suite.js` (`tests/extension/host.test.ts`, cached VS Code 1.147.0 here, untouched by TT6) | PP3 |
| `packages/language-service` latency ("language service at 10k lines") | The package is a 3-line stub (`export {}`) imported by nothing (TT0 finding). Retargeted to `packages/vscode/src` as recorded in `tests/stress/README.md` row #1 | production plan / a future implementation task |
| Editor-side diagnostics in the Problems panel, decoration ranges as rendered | Requires the host renderer; the pure `AnalysisProblem` ranges are asserted here | PP3 |

## Gates (commands actually run)

| Command | Outcome |
|---|---|
| `bun test tests/stress/editor/` | **48 pass / 0 fail / 7 files** — 4.28 s |
| `bun test tests/stress/editor/latency.test.ts` | 9 pass / 0 fail |
| `bun test tests/stress/editor/index.test.ts` | 5 pass / 0 fail |
| `bun test tests/stress/editor/storm.test.ts` | 6 pass / 0 fail |
| `bun test tests/stress/editor/mid-edit.test.ts` | 5 pass / 0 fail |
| `bun test tests/stress/editor/a51-surfaces.test.ts` | 9 pass / 0 fail |
| `bun test tests/stress/editor/differential.test.ts` | 8 pass / 0 fail |
| `bun test tests/stress/editor/activation.test.ts` | 6 pass / 0 fail |
| `bun test tests/extension/` | **192 pass / 0 fail / 10 files** — unchanged |
| `bun run typecheck` | **green** (compiler, cli, language-service, vscode) |
| `bunx biome check tests/stress/editor/` | **clean** — `Checked 10 files. No fixes applied.` |
| `bun run lint` | **red — 36 errors, every one under `tests/stress/fs/**`** (TT3's concurrent write set: `helpers.ts`, `host-errors.test.ts`, `interrupt.test.ts`, `links.test.ts`, `manifest.test.ts`, `paths.test.ts`, `planner.test.ts`, `rebuild.test.ts`, `watch.test.ts`, `glob.test.ts`). Zero diagnostics in `tests/stress/editor/**` |
| `bun run verify` | **red at the lint step** for the reason above (typecheck green; `bun test` 1101 pass / 2 fail — both failures are `tests/stress/cli/**` "two simultaneous builds", TT4's concurrent write set) |
| `bun test` (whole repo) | 1101 pass / 2 fail across 72 files; the 2 failures are TT4's `tests/stress/cli/` concurrency cases, not editor cases |

**Honest status:** TT6's own acceptance criteria are met (`bun test tests/stress/editor/` green,
`bun test tests/extension/` unchanged at 192/10, my write set lint-clean). `bun run verify` / `bun run lint` are
red **only** because TT3 (`tests/stress/fs/**`) and TT4 (`tests/stress/cli/**`) are landing in the same tree
concurrently; re-running both gates after their fixes is required before this phase can be closed by the lead.
No file outside my write set was modified to work around it.

## Deviations

- The storm and mid-edit corpora use `parse()` + the pure provider entry points rather than the four
  `providers/*.ts` classes: those classes import `vscode` and are thin adapters over exactly these calls (the
  same boundary `tests/extension/` uses). No `vscode` import appears in any TT6 test except the activation case's
  fake module.
- Latency ceilings are deliberately generous (`500 ms` / `5 000 ms`) with p50/p95 recorded; per the plan's rule a
  stress finding is a number, not a flaky threshold.
- The seeded PRNG is local to `tests/stress/editor/documents.ts` because `tests/stress/prng.ts` is TT1's write set;
  the determinism contract (xorshift32, seeded, no wall clock) is identical.

## Handoff

- **Complete:** all seven plan §TT6 rows (48 tests / 7 files), differential green on fixtures + DAG corpus,
  latency/storm/mid-edit/A51/activation evidence recorded above.
- **Remaining before phase close (lead):** re-run `bun run lint` and `bun run verify` once TT3/TT4 land (their
  files carry all current lint errors and both test failures), then flip the TT6 row to 🟢 in
  `.ai/plans/CSSX-PLAN-TESTING.md`.
- **Follow-ups for TT8:** O1 (cyclic-graph group divergence, repro above, cross-link TT2's 500-module cycle
  case); O2 (symlinked temp/document paths → XESSA5001, cross-link TT3).
- **Touched files:** `tests/stress/editor/**` (10 files, new) + this report. Nothing else.
