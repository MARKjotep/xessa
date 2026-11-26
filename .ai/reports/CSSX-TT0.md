# CSSX-TT0 — Coverage map, verified

**Phase:** TT0 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟡 complete, awaiting build verification (TT0 row left 🔴 — build flips it)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted (`.ai/plans/CSSX-PLAN-PRODUCTION.md` modified, `.ai/plans/CSSX-PLAN-TESTING.md` + `tests/stress/` untracked before this task)

## Summary

- Read all 45 `bun test` suites plus `playwright` specs, `packages/*/src`, and `scripts/benchmark.ts`;
  re-verified all 24 draft matrix rows one by one, **corrected 12** that were wrong or overstated and
  added 5 that were missing.
- **12 draft "gaps" were already covered** by existing tests: lexer fuzz, lexer NUL, formatter
  idempotence, formatter `parse(format(x))` reparse, resolver symlink escape, naming determinism, CLI
  `--minify --no-minify`, CLI exit-code matrix, CLI read-only output dir, emitter minify/pretty equality,
  browser pretty/minified parity, and the parser's truncation fuzz. Implementing those as new TT1 cases
  would have been duplicate work.
- **Biggest finding:** `packages/language-service/src/index.ts` is a 3-line stub (`export {};`). Nothing
  imports it. The draft credited it with the whole `tests/extension/` suite; TT6's headline case
  ("language service at 10k lines") currently has no subject.
- Added 5 previously missing module rows (CLI runtime/project/report modules, two `packages/vscode/src`
  groups, `extension.ts`) so the matrix meets its own "every `packages/*/src` module has a row" bar.
- Produced the "weakest 10" case-selection checklist in `tests/stress/README.md` (new).
- No test, fixture, or source file was modified. Gates: `bun run lint` green, `bun run verify`
  892/892 across 45 files — plus **one pre-existing watch flake observed (1 of 3 runs)**, recorded below.

## Changed paths

| Path | Change |
|---|---|
| `.ai/plans/CSSX-PLAN-TESTING.md` | §TT0 matrix rewritten: 12 rows corrected, 5 rows added, evidence citations added per row. TT0 status **not** flipped (build owns that). |
| `tests/stress/README.md` | **New.** Purpose, ground rules (seed/budget/fixtures/temp-dirs/no-weakening), weakest-10 checklist, planned `fuzz/ scale/ fs/ cli/ consumer/ editor/ soak/` layout marked "planned". |
| `.ai/reports/CSSX-TT0.md` | **New.** This report. |

Nothing else touched. No `package.json`, no existing test, no fixture, no source edit.

## Verification method

For each draft row: (1) confirm the named suite files exist under `tests/`, (2) grep the suite for
the specific case the draft claims is absent, (3) read the surrounding assertions before recording a
verdict. "Refuted" below always means *a test for that exact case exists*; file:line is cited so the
claim is checkable without re-running the search.

## Corrections made — draft row → correction

### Refuted gaps (the draft said "missing", the test exists)

| Row | Draft claim | Reality | Evidence |
|---|---|---|---|
| lexer | "No random-bytes fuzz" | 1 500 seeded pseudo-random sources over a hostile alphabet (`\u0000`, `\u0007`, `é`, grammar chars) plus exhaustive alphabet³/⁴ (11 110 cases), each asserting eof-termination, losslessness, span well-formedness | `tests/compiler/lexer.invariants.test.ts:131-166` |
| lexer | "no NUL" | U+0000 → `XESSA1001`, span `{1,2}`, token kept as `delim` | `lexer.test.ts:290-297`; alphabet at `lexer.invariants.test.ts:144` |
| formatter | "No property: `format(format(x)) == format(x)`" | Idempotence asserted for **every** fixture (incl. 13 group fixtures) and again in the provider suite | `formatter.test.ts:137-146`, `:425-445`; `provider.formatting.test.ts:42` |
| formatter | "no `format → parse → same IR`" | `parse(format(x))` re-parsed and compared as group-shape IR | `formatter.test.ts:398-420` |
| resolver | "no symlinked … source dirs" | Canonical-target symlink escape rejected; planner-level symlink escape too | `resolver.test.ts:594-600`; `output.test.ts:280-296` |
| naming | "no determinism" | Repeated-run byte-identity of IR + class table asserted for both `renameClasses` and `generateClassMap` | `naming.test.ts:194-207`; `mapgen.test.ts:211-220` |
| cli/args | "no flag-order combinations (`--minify --no-minify`)" | Exactly that case: `--no-minify` last wins over `--minify`, and CLI-vs-`@setup` override both directions | `cli-build.test.ts:150-185` |
| cli/args | "No exhaustive exit-code matrix" | 11 distinct exit-2 invocation modes (unknown flag, missing/unknown command, file arg to `clean`, missing source, missing config, invalid JSON, wrong type, strict unknown key, no config, `--check` misuse) + `--json` machine-readable failure | `cli-config.test.ts:35-190`; `format-cli.test.ts:44-50`; `:171-190` |
| cli/output | "No read-only output dir" | `chmod 0o555` on the output dir → exit 1, `XESSACLI001`, previous artifact byte-identical (root-skipped) | `cli-build.test.ts:209-225` |
| emitter | "no minify/pretty semantic diff" | Whitespace-normalized equality across every `emitter.test.ts` IR case | `emitter.test.ts:141-158` |
| browser | "no semantic minify/pretty diff" | Pretty-vs-minified computed-style equality per scenario (10 scenarios × viewports × schemes) | `tests/browser/specs/parity.pw.ts:15-30` |
| parser | "recovery asserted per fixture but not …" (implying no truncation fuzz) | Every token-stream prefix and every character prefix parsed without throwing | `parser.test.ts:1136-1143`; `pipeline.test.ts:186-195` |

### Factual errors (wrong suite, wrong number, wrong module)

| Row | Draft said | Correction | Evidence |
|---|---|---|---|
| `packages/language-service/src/index.ts` | "`tests/extension/provider.*.test.ts` (10 files, 192 tests)" | **Nothing imports it.** The file is `export {};` (3 lines, P0 stub). The only reference anywhere in `tests/` is a `package.json` name check. The "10 files / 192 tests" figure is `tests/extension/**`, which exercises `packages/vscode/src/**` — and of those 10 files only 6 are `provider.*` (150 tests). | `packages/language-service/src/index.ts:1-3`; `scaffold.test.ts:41-43`; `grep -rn language-service tests/` = 1 hit; `bun test tests/extension` = 192 pass / 10 files |
| `tests/browser/specs/**` | "75 tests × 3 engines" | **96 tests in 7 files**, 32 per engine × Chromium/Firefox/WebKit. 16 authored `test()` blocks, two of which are scenario-parameterised (10 scenarios each). | `playwright test --list` → `Total: 96 tests in 7 files`; per-engine `32 32 32` |
| `packages/compiler/src/formatter/**` | `formatter.current-grammar.test.ts` (bare) | Lives at `tests/extension/formatter.current-grammar.test.ts` | path |
| `packages/cli/src/{config,glob,paths}.ts` | "`cli-config.test.ts`, `scaffold.test.ts`" | `scaffold.test.ts` tests **workspace package manifests only** — it covers none of these three. The real coverage is direct `glob.ts` imports plus subprocess runs. | `scaffold.test.ts:15-46`; `cli-config.test.ts:10` |
| `packages/vscode/test/suite.js` | "Not part of the default gate when the download is unavailable" | Accurate as a condition, but it **does** run on this machine: cached VS Code 1.147.0, `runnable=true`, 2 pass | `bun test tests/extension/host.test.ts` → `[xessa host] test-electron=installed cached=1.147.0 runnable=true`, 2 pass |

### Rows added (missing from the draft, required by the matrix's own bar)

| New row | Exercising suite(s) | Gap |
|---|---|---|
| `packages/cli/src/{index,compiler,formatter,project,report,setup}.ts` | subprocess via `cli-*.test.ts` + `node-smoke.test.ts`; `setup.ts` also unit-imported at `tests/compiler/modules.test.ts:3` | `report.ts` JSON/NDJSON shape is field-asserted only, never golden-pinned; `compiler.ts` loader fallback chain (bare → `dist` → `src`) undriven; `project.ts` walker only at fixture size |
| `packages/vscode/src/{config,formatting,glob,output,quickfixes}.ts` | direct imports from `provider.project/formatting/quickfix` | well covered at fixture size; no path/encoding matrix behind `glob.ts` |
| `packages/vscode/src/{groups,keyframes,property-docs,positions,paths}.ts` | indirect only (`analysis.ts:26-32`, `intelligence.ts:29-34`) | `groups.ts` (320 lines) + `keyframes.ts` (436) re-implement compiler `resolver/{groups,keyframes}.ts` with **no differential test**; `property-docs.ts` (169) and `paths.ts` (87) have no direct suite |
| `packages/vscode/src/extension.ts` | `packages/vscode/test/suite.js` via `host.test.ts` | 25-line activation wrapper, only observable in the host |

### Confirmed-accurate rows (no change beyond wording + citations)

`lowering/**`, `variables/**`, `selectors/**`, `sourcemaps/**`, `output/**` (minus the read-only clause),
`integration` (`src/index.ts`, `types/**`, `ir/**`), `host/node.ts`, `cli/commands/**`,
`cli/{manifest,writer}.ts`, `analysis.ts`+`positions.ts`, `adapter/providers/controller/service`,
`vscode/test/suite.js`, `scripts/benchmark.ts`, `tests/fixtures/**`.

Two of these are worth naming because they are *total* coverage holes rather than thin coverage:

- **`packages/compiler/src/host/node.ts`** — every compiler suite injects an in-memory fake host
  (`groups.expansion.test.ts:31`, `modules.test.ts:29`), so the real fs host's error paths are never
  reached. Confirmed, not inferred.
- **`scripts/benchmark.ts`** — no reference in `tests/` at all, and `await main(process.argv.slice(2))`
  sits at module top level (`:395`), so importing it would run the harness. Subprocess-only, confirmed
  by reading the last statement of the file.

## Weakest 10 — evidence for the ranking

Ranked by (blast radius on release) × (genuine absence of coverage) × (a realistic input can trigger it).

| # | Area | Why it ranks here | Confirming evidence |
|---|---|---|---|
| 1 | `packages/language-service` | Not a coverage gap but a **premise error**: the package is an empty stub, so TT6's central deliverable has no subject. Highest risk because it silently invalidates a whole phase. | `index.ts:1-3` (`export {};`); zero imports from `tests/`, `packages/vscode/src` |
| 2 | `cli/src/{manifest,writer}.ts` | Only total hole touching shipped artifacts: no concurrency, no interruption, no tamper case. A torn manifest survives into the next build in production. | `grep -rniE "concurrent\|SIGKILL\|tamper\|corrupt"` over `tests/integration` → 0 real hits (watch `SIGKILL` at `cli-watch.test.ts:197` is teardown) |
| 3 | `compiler/src/host/node.ts` | Real-fs errors are the failure mode users hit first (`EACCES` output dir, dangling symlink in a mono-repo) and are structurally unexercised. | in-memory `createHost` in every compiler suite; `host/node.ts:57-63` real `readFile`/`stat` |
| 4 | `cli/src/{config,glob,paths}.ts` | Unicode/space paths are ordinary user paths; today the path surface is ASCII-only and globs are single-segment. | `cli-config.test.ts:218-240` (only `*`, `**`, `?`, one brace pair); no `é`/space path anywhere in `tests/integration` |
| 5 | `resolver`+`naming`+`selectors` at scale | Every module-graph fixture is 2–4 modules; a 1k-chain or 10k-selector build is untested behaviour, and `docs/performance.md` measures only 100/1000 files. | `modules.test.ts:146-230` (diamond, chain fixtures); no `repeat(` in `resolver/naming/selectors` tests |
| 6 | public `compile()` | Lexer/parser have fuzz; the function users actually call has none — a diagnostic-span or hang bug in lowering/emitter/naming only surfaces through fixtures. | `compile.test.ts:112-295` is 8 fixture-shaped tests, no loop; `contract.test.ts:38-99` is export/registry assertions |
| 7 | `parser` depth | Prefix fuzz covers one source; nothing covers depth, which is the classic stack-overflow shape. | `parser.test.ts:1136`, `pipeline.test.ts:186` (canonical source only); no `repeat(` in `parser.test.ts` |
| 8 | `lexer` encoding edges | Fuzz exists but the three encodings that most often break tokenizers (BOM, unpaired surrogate, mixed EOL) are absent, and runs stop at 20k chars. | `grep -rc 'uFEFF\|surrogate'` over `tests/` = 0; CRLF only as one whitespace token (`lexer.test.ts:69`); max run `"a".repeat(50000)` (`lexer.test.ts:390`) |
| 9 | `vscode/src/{groups,keyframes,property-docs,positions}` + editor latency | 756 lines of editor-side logic that *duplicates* compiler resolver rules, with no differential test — a compiler rule change silently diverges. And no latency measurement exists anywhere. | `grep -c performance.now` in `tests/extension` = 0; `groups.ts`/`keyframes.ts` imported only by `analysis.ts`/`intelligence.ts` |
| 10 | `scripts/benchmark.ts` | The gate every TT2/TT7 number is compared against is itself unverified and cannot be imported. | no `benchmark` reference in `tests/`; `scripts/benchmark.ts:395` |

**Deliberately ranked below the top 10** (real gaps, lower blast radius or dependency-blocked):
emitter independent-parser validation (requires an owner decision on a third-party CSS parser, a
plan non-goal), sourcemap decoding at scale (decoder already exists at `sourcemap.test.ts:43`), formatter
on malformed/large input (idempotence already covered), `args.ts` reverse flag order + NDJSON golden,
browser 1k-node DOM, `cli/report.ts` golden. These are recorded in the plan's corrected rows; they are
not silently dropped.

## Weakest-10 checklist

Condensed here for review; the authoritative, fuller case list is `tests/stress/README.md`.

| # | Area | Missing cases | Phase |
|---|---|---|---|
| 1 | `packages/language-service/src/index.ts` | stub has no subject — re-scope or implement; retarget latency cases at `packages/vscode/src/{analysis,intelligence,service,controller}.ts` | TT6 |
| 2 | `cli/src/{manifest,writer}.ts` | two-process concurrent build; `SIGKILL` mid-write then clean build; tampered manifest; foreign manifest | TT3, TT4 |
| 3 | `compiler/src/host/node.ts` | EACCES read; ENOENT mid-walk; ELOOP/dangling symlink; directory-where-file-expected | TT3 |
| 4 | `cli/src/{config,glob,paths}.ts` | spaces/NFC-NFD/emoji/200-char/`..`; multi-segment + nested-brace globs; unicode `exclude` | TT3 |
| 5 | `compiler/src/{resolver,naming,selectors}/**` | 1k-deep `@use`; 500-module diamond+cycle; 10k selectors / 500-selector rule; 10k-class table | TT2 |
| 6 | `compiler/src/index.ts` (`compile()`) | mutated-project property loop (no throw, bounded diagnostics, span bounds); shuffle determinism; frozen mutation corpus | TT1 |
| 7 | `compiler/src/parser/**` | 10k-deep nesting; unbalanced quote/comment at every depth; prefix fuzz over all 67 fixtures; bounded diagnostic count | TT1, TT2 |
| 8 | `compiler/src/lexer/**` | BOM `U+FEFF`; lone surrogates; CRLF/LF/CR mixed; 1 MB token + 100k-line file | TT1, TT2 |
| 9 | `vscode/src/{groups,keyframes,property-docs,positions}.ts` + editor | differential test vs `resolver/{groups,keyframes}.ts`; 10k-line p50/p95; 1000-file index; keystroke storm A45–A51 | TT6 |
| 10 | `scripts/benchmark.ts` | `--json` schema; two-run fixture byte identity; re-check "zero error diagnostics"; `--size 100` exit 0 | TT2 |

## Commands run

| Command | Outcome |
|---|---|
| `bun test` | **892 pass / 0 fail / 45 files**, 14.18 s — matches the plan's stated baseline exactly |
| `bun test tests/extension` | **192 pass / 10 files** — confirms the draft's 192, refutes the "10 `provider.*` files" attribution (6 provider files = 150 tests) |
| `bun test tests/extension/host.test.ts` | 2 pass; `test-electron=installed cached=1.147.0 runnable=true` — host path is live here, not skipped |
| `bun test tests/integration/cli-watch.test.ts` | 3 pass, 424 ms — isolates the flake below |
| `playwright test --list` | **96 tests in 7 files**; 32 chromium / 32 firefox / 32 webkit — refutes "75 tests × 3 engines" |
| `bun run lint` | ✅ `Checked 422 files in 293ms. No fixes applied.` |
| `bun run verify` (run 1) | ❌ 891 pass / **1 fail** — `xessa watch > reloads configuration changes with a full rebuild` (10067 ms, timeout) |
| `bun run verify` (run 2) | ✅ **892 pass / 0 fail / 45 files**, 12.07 s |
| `grep -rniE 'BOM\|uFEFF\|surrogate\|NUL\|u0000\|CRLF\|1MB\|fuzz'` across `tests/` | Drives the lexer verdict; `uFEFF`/`surrogate` = 0 hits |
| `grep -rn 'repeat('` across `tests/compiler` | Only `lexer.test.ts` / `lexer.invariants.test.ts` — confirms no scale loops in lowering/resolver/selectors/naming/parser |
| `grep -rn language-service` over `tests/`, `packages/vscode` | 1 hit, a `package.json` name read — confirms the stub verdict |

### Observed flake (pre-existing, not caused by this change)

`tests/integration/cli-watch.test.ts:262` `reloads configuration changes with a full rebuild` failed
once at 10 067 ms under a loaded machine and passed at 113 ms in isolation and in the next full verify.
Observed rate this task: **1 / 3 full runs**. This change is markdown-only, so it cannot be causal.
It is a real TT7 input (TT7 explicitly owns "5× full-gate flake run"); recorded here so TT7 starts from
a known flake rather than a surprise, and so it is not misfiled as a TT0 regression.

## Deviations and unverified items

- **TT0 status left 🔴** by instruction: build flips it after verifying this report.
- The TT6 premise in the plan still reads "language service at 10k lines". Correcting TT6's text was
  outside the assigned scope (matrix rows only); the retarget is recorded in the matrix row, in
  `tests/stress/README.md` #1 and in the recommendation below.
- `tests/browser` specs were read and listed, **not executed** in this task (no emitted-CSS change).
  Counts come from `playwright test --list`.
- Not cheaply verifiable, therefore stated as observed-not-proven: whether `packages/vscode/src/groups.ts`
  and `keyframes.ts` are behaviourally identical to the compiler resolver — establishing that is exactly
  the TT6 differential case in weakest-10 #9, and is the reason it is ranked there rather than asserted
  as a defect.
- `tests/extension/provider.intelligence.test.ts:2966-2986` asserts on **source text** of
  `adapter.ts` / `controller.ts` / `providers/*.ts` rather than behavior. Recorded in the matrix row as a
  weak-assertion note; no change made (existing tests are not edited by this campaign).

## Handoff

**Done:** TT0 verification complete; plan §TT0 matrix corrected (12 corrected, 5 added, all rows
citation-backed); `tests/stress/README.md` created with ground rules, weakest-10 checklist and planned
layout; this report; `bun run lint` green and `bun run verify` 892/0.

**Remaining for build:** confirm the matrix corrections against the cited file:line evidence, then flip
the TT0 row in `## Implementation Progress` to 🟢 and check the plan's exit criterion
("the weakest 10 list is copied into `tests/stress/README.md`") — it is, verbatim.

**Recommended follow-up (not done, out of scope):** retarget TT6's row text from
`packages/language-service` to `packages/vscode/src/{analysis,intelligence,service,controller}.ts` before
TT6 starts, and seed TT7's flake row with the `cli-watch` observation above.

**Touched files:** `.ai/plans/CSSX-PLAN-TESTING.md`, `tests/stress/README.md`, `.ai/reports/CSSX-TT0.md`.
