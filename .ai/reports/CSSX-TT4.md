# CSSX-TT4 — CLI and config surface: exit-code matrix, JSON/NDJSON goldens, concurrency

**Phase:** TT4 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟡 complete, awaiting build verification (TT4 row left 🔴 — build flips it)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted (`.ai/plans/CSSX-PLAN-PRODUCTION.md` modified; `.ai/plans/CSSX-PLAN-TESTING.md`, `.ai/reports/CSSX-TT0.md`, `tests/stress/` untracked before this task)

## Summary

- **65 tests across 6 files** under `tests/stress/cli/**`, plus **9 byte-stable goldens** under
  `tests/stress/cli/golden/**`. Every remaining §TT4 matrix cell is covered; **6 rows are skipped as
  already covered**, with the exact evidence cited instead of duplicated work.
- Exit-code matrix: **0 / 1 / 2** all exercised; the new cells are missing flag value, duplicate
  `--config`, extra positional, boolean flag with `=value`, five configuration-schema cells, git-style
  `--` positional, missing include match, and the `--json`-before/after-failure asymmetry.
- JSON/NDJSON envelopes are now **golden-pinned** (`report.ts` shapes were previously field-asserted
  only, per TT0): `build`, `build --dry-run`, `check`, `check` failure, `clean`, `clean --dry-run`,
  `format --check`, invocation error after `--json`, and the `watch --json` NDJSON stream.
- `format --check` on a parse-error file **never rewrites** the file (asserted with frozen bytes *and*
  frozen mtime); `format` normalizes CRLF→LF; an already-canonical file is **not written at all**.
- Two simultaneous `build` processes: overlap observed, no torn artifact, manifest byte-identical to a
  sequential build's, no `.cssx-tmp` leftovers, reproduced over two rounds.
- **4 findings recorded for TT8** (each asserted as current behavior — no red test, no `it.skip`, no
  weakened assertion), including a `clean` provenance hole and a silent-green empty include.

## Changed paths

| Path | Change |
|---|---|
| `tests/stress/cli/helpers.ts` | **New.** Temp-project harness (`mkdtemp` + frozen fixture copy + cleanup registry), `runCli`/`runCliAsync`/`spawnCli`, `normalizeOutput` (`<ROOT>` placeholder), `tempRootPrefixes` leak guard, `hashOfFile`, `listFiles`, `freezeMtime`/`mtimeMs`, golden read/write, `startWatchJson` NDJSON harness with bounded awaits. |
| `tests/stress/cli/exit-codes.test.ts` | **New.** 25 tests — exit 2/0 cells listed below. |
| `tests/stress/cli/precedence.test.ts` | **New.** 14 tests — minify order both ways, duplicate flags, `--check` misuse, `--dry-run`×`--json`, `--json`+`watch`, success codes. |
| `tests/stress/cli/json-golden.test.ts` | **New.** 11 tests — 8 JSON goldens (each executed twice per run), watch NDJSON golden, diagnostic key-order pin. |
| `tests/stress/cli/format-safety.test.ts` | **New.** 7 tests — parse-error `--check`, mixed project, CRLF normalization, canonical no-write. |
| `tests/stress/cli/clean-manifest.test.ts` | **New.** 6 tests — tampered hash, ownership release + no-op rerun, foreign/escaping manifest, matching-hash trust, missing files, empty output dir. |
| `tests/stress/cli/concurrency.test.ts` | **New.** 2 tests — two simultaneous builds, two rounds. |
| `tests/stress/cli/golden/*.txt` (9 files) | **New.** `build-json`, `build-dry-run-json`, `check-json`, `check-error-json`, `clean-json`, `clean-dry-run-json`, `format-check-json`, `invocation-error-json`, `watch-ndjson`. |
| `.ai/reports/CSSX-TT4.md` | **New.** This report. |

Nothing outside `tests/stress/cli/**` and this report was written. No `package.json`, no CLI/compiler
source, no fixture, no existing test, no plan file.

## Golden determinism policy

| Concern | Rule |
|---|---|
| Absolute paths (`workspaceRoot`, `configFile`, and the path embedded inside a diagnostic message) | Replaced with the documented `<ROOT>` placeholder. Both the `mkdtemp` spelling and the kernel's canonical `realpath` spelling are replaced (macOS `/var/…` vs `/private/var/…`), longest first so a nested root is never half-replaced. |
| Leak guard | Every case asserts none of `os.tmpdir()` / its realpath survives normalisation. |
| Two-run byte stability | Each JSON case runs on **two freshly copied projects** per `bun test` invocation and both snapshots must be identical *and* equal to the golden; the watch case does the same with a second watcher. Two consecutive suite runs left the golden files unmodified (`git status` clean for `golden/`). |
| Inherently nondeterministic fields | None in the pinned envelopes: no timestamps, no PIDs, no durations. `watch` pins only `{type,ready,sources,debounceMs}` plus the first `build` event. |
| Regeneration (review the diff) | `XESSA_STRESS_UPDATE_GOLDEN=1 bun test tests/stress/cli/` |

## Exit-code matrix

### Implemented here (new cells)

| Mode | Command | Exit | Assertion |
|---|---|---|---|
| Missing flag value | `build --config` | 2 | stderr exactly `xessa: --config requires a path.`, stdout empty |
| Value flag swallows a following flag | `build --config --json` | 2 | `--json` taken as the value → `Configuration file not found: --json`; report is **text** (finding 3) |
| Duplicate `--config` (space and `=` forms) | `build` / `check` | 2 | `--config may be given only once.` |
| Extra positional | `build f1 f2` | 2 | `xessa build accepts at most one file argument.` |
| Positional after `--` terminator | `build -- --minify` | 2 | `Source file not found: --minify` |
| Duplicate `--json` | `build --json --json` | 0 | exactly one report document, parses, ends with `}` |
| Boolean flag with `=value` (5 cells) | `format --{json,minify,no-minify,dry-run,check}=true` | 2 | `<flag> does not take a value.` |
| Unknown command before `--help` | `compile --help` | 2 | `Unknown command "compile".` (help does not rescue it) |
| Valid command with `--help` | `build --help` | 0 | usage text on stdout, stderr empty |
| `--help` does not suppress a later unknown option | `--help --wat` | 2 | `Unknown option "--wat".`, stdout empty |
| Config schema: `include` not an array | `check` | 2 | `"include" must be an array of glob strings.` |
| Config schema: blank include entry | `check` | 2 | `"include" entries must be non-empty strings.` |
| Config schema: empty include list | `check` | 2 | `"include" in <config> must list at least one glob.` |
| Config schema: blank media query | `check` | 2 | `"media.md" must be a non-empty media query string.` |
| Config schema: bad grouping mode | `check` | 2 | `"compiler.mediaGrouping" must be "safe" or "none".` |
| Include globs match nothing | `build` | **0** | `0 entries`, stderr warning `No .cssx sources matched the project include globs.`; `--json` `success:true`, `entries:[]`, one warning (finding 1 — plan allowed 1 or 2) |
| Parse error **after** `--json` | `build --json --wat` | 2 | JSON `{command:"build",success:false,exitCode:2,error:'Unknown option "--wat".'}` on stdout, stderr empty |
| Parse error **before** `--json` | `--wat build --json` | 2 | stderr text, stdout empty (json never parsed) |
| Unknown command with `--json` | `--json compile` | 2 | JSON `command:"compile"` (offending token becomes the label) |
| Flag-only failure with `--json` | `--json --wat` | 2 | JSON `command:"xessa"` |
| Conflicting flag: `--check` outside `format` | `build` / `check` / `watch` / `clean` | 2 | `--check is only valid for xessa format.` |
| Formatting changes pending | `format --check` | 1 | `would be reformatted` listing |

### Skipped — already covered (evidence, not re-implemented)

| Mode | Evidence |
|---|---|
| Unknown flag `build --wat` | `tests/integration/cli-config.test.ts:36` |
| Missing command | `tests/integration/cli-config.test.ts:43` |
| Unknown command `compile` (text) | `tests/integration/cli-config.test.ts:49` |
| `clean` with a file argument | `tests/integration/cli-config.test.ts:57` |
| Missing source file | `tests/integration/cli-config.test.ts:64` |
| Missing explicit config / invalid JSON / wrong type / strict unknown key / no config | `tests/integration/cli-config.test.ts:71-190` |
| `--minify --no-minify` (one direction) | `tests/integration/cli-build.test.ts:150` — reverse order added here |
| Read-only output dir → `XESSACLI001` | `tests/integration/cli-build.test.ts:209` |

## Flag precedence

| Case | Exit | Observed |
|---|---|---|
| `--minify --no-minify` | 0 | equals `--no-minify` alone (last wins) |
| `--no-minify --minify` | 0 | equals `--minify` alone; compact `.ui-button{display:flex;padding:12px;}` |
| `--minify --minify` / `--no-minify --no-minify` | 0 | idempotent, byte-identical to the single-flag run |
| `--minify --no-minify --dry-run --json` | 0 | `dryRun:true`, every output `written:false`, `reason:"dry-run"`, no `generated/`, no manifest |
| `build --dry-run --json` | 0 | 6 planned outputs, `reason:"dry-run"`, disk untouched |
| `clean --dry-run --json` | 0 | 6 × `would-delete`, artifacts present, manifest bytes unchanged |
| `format --dry-run --json` | 0 | `changed:[button,card]`, all `written:false`, `reason:"not-written"` |
| `check --dry-run --json` | 0 | **`dryRun:false`**, `reason:"check"` — flag silently ignored (finding 4) |
| `watch --json` vs `build --json` | 0 | watch emits **NDJSON** (one compact object per line, first `{"type":"build"…}` then `{"type":"watch","ready":true,…}`); build emits 2-space-indented JSON |

## Goldens

| Golden | Invocation | Exit | Pinned shape |
|---|---|---|---|
| `build-json.txt` | `build --json` | 0 | top-level order `command,success,exitCode,dryRun,workspaceRoot,configFile,entries,diagnostics,warnings,errors`; 2 entries, 3 outputs each all `written:true` |
| `build-dry-run-json.txt` | `build --dry-run --json` | 0 | same order, `dryRun:true`, all outputs `written:false,reason:"dry-run"` |
| `check-json.txt` | `check --json` | 0 | same order, all outputs `reason:"check"` |
| `check-error-json.txt` | `check --json` on `broken` fixture | 1 | `XESSA2001` diagnostic `{code,severity,message,file,line:2,column:10}`, duplicated identically at entry and top level; `<ROOT>` appears inside the message |
| `clean-json.txt` | `clean --json` after build + hand-edited artifact | 0 | `removed` 5 × `deleted`, `skipped` 1 × `modified`, warning `Kept …: modified since generation; ownership released.` |
| `clean-dry-run-json.txt` | `clean --dry-run --json` | 0 | 6 × `would-delete` in manifest (path-sorted) order |
| `format-check-json.txt` | `format --check --json` | 1 | `files` 2 × `{changed:true,written:false,reason:"not-written"}`, `changed:[src/button.cssx,src/card.cssx]` |
| `invocation-error-json.txt` | `build --json --wat` | 2 | exactly `{command,success,exitCode,error}` |
| `watch-ndjson.txt` | `watch --json` | 0 | 2 compact lines: `build` event then `{"type":"watch","ready":true,"sources":3,"debounceMs":40}` |

A separate test pins the diagnostic **key set and order** (`code,severity,message,file,line,column`)
so a diagnostic-shape regression fails independently of the golden text.

## format safety

| Case | Exit | Assertion |
|---|---|---|
| `format --check` on a parse-error file | 1 | bytes unchanged **and** frozen mtime preserved; `reason:"parse-error"`, `written:false`, `changed:[]`, `XESSA1001` diagnostic, error line `…: not formatted because parsing reported errors.` |
| `format --check` in a mixed project | 1 | broken file untouched; the parseable file is `changed:true,written:false`; neither mtime moves |
| `format` on pre-existing CRLF | 0 | normalized to LF (`.a {\n  color: red;\n}\n`), `changed:true,written:true`; second run `changed:false,written:false` with frozen mtime intact |
| `format --check` / `--dry-run` on CRLF | 1 / 0 | flagged but bytes and mtime unchanged |
| `format` on an already-canonical file | 0 | `changed:[]`, `written:false`, frozen mtime preserved → no write at all |

"No write" is proven without timing: the case freezes mtime via `utimes` and asserts it survives (an
`atomicWrite` rename always replaces the inode).

## clean

| Case | Exit | Observed |
|---|---|---|
| Tampered manifest hash for one artifact | 0 | that file kept (`skipped:[{path,reason:"modified"}]`, ownership-released warning), other 5 deleted, manifest rewritten to `files:[]` |
| Second clean after ownership release | 0 | pure no-op: `removed:[]`, `skipped:[]`, no warnings, files and manifest bytes unchanged |
| Foreign manifest: `../outside.txt`, `/etc/hosts`, `out/../../escape.css` | 0 | three warnings (`Ignoring unsafe …` ×2, `Ignoring manifest path outside the workspace: …`), nothing deleted outside/inside, manifest emptied |
| Hand-written record with a *matching* hash (`notes.txt`) | 0 | file **deleted** — ownership is hash-based, not provenance-based (finding 2) |
| Manifest whose files are all gone | 0 | 3 × `skipped:{reason:"missing"}`, manifest emptied, output dir not created |
| Empty output directory | 0 | `xessa clean: 0 files removed, 0 skipped`, stderr empty, `out/` still absent |

## Concurrency — two simultaneous builds

Setup: two `bun <cli> build --json` processes spawned back-to-back in one copied `basic` project;
overlap is **observed, not timed** (immediately after the second spawn the first process must still be
running; bounded to 3 attempts and to `CONCURRENCY_TIMEOUT_MS = 60_000`, test timeout 120 s).
`round.overlapped` is now asserted, so a non-overlapping pair can never pass silently as the
concurrency case.

| Invariant | Result |
|---|---|
| Both processes | exit 0, empty stderr, `{success:true,exitCode:0,errors:[]}` |
| Overlap | observed and asserted in both rounds |
| Torn artifact | none — all 6 artifacts byte-identical to `tests/fixtures/cli/basic/expected/*` |
| Manifest | byte-identical to a **sequential** single-build manifest (complete 6 records, path-sorted) |
| Hash consistency | every recorded `sha256:` equals the bytes actually on disk → no writer recorded a state the other invalidated |
| Temp files | no `*.cssx-tmp` staging file anywhere in the workspace |
| Repeat | a second concurrent round reproduces identical manifest and CSS bytes |

Timing context (one observation, not asserted — load-dependent): single build 52 ms, two sequential
51 + 51 ms, concurrent pair 54 ms wall with both ≈53 ms → the two builds genuinely overlapped.

Not asserted (documented limitation): two **differently flagged** concurrent builds (`--minify` vs
`--no-minify`). With identical inputs the final state is deterministic; with different flags per-file
last-writer-wins and manifest last-writer-wins can in principle disagree. 4 exploratory trials showed
no mismatch, so no deterministic assertion was written; the race window (artifacts → manifest, no
cross-process lock) stays a TT7 soak item.

## Findings for TT8

Every finding below is pinned as **current behavior** (green test). No source fix was attempted — the
CLI is outside this phase's write set — and no assertion was weakened.

| # | Finding | Repro | Impact | Suggested owner |
|---|---|---|---|---|
| 1 | **A project whose include globs match nothing exits 0** (warning only). Plan §TT4 allowed exit 2 or 1; TT0 flagged silent green builds as a real risk. | `xessa.config.json` = `{"include":["nope/**/*.cssx"]}`; `bun packages/cli/src/index.ts build` → exit 0, `xessa build: 0 entries, 0 files written, 1 warning`; `--json` → `success:true, entries:[]` | A typo'd/moved source directory turns CI green on an empty build. | TT8 task + owner decision (behaviour change is a CLI contract change) |
| 2 | **`clean` trusts manifest provenance**: a hand-written record whose `hash` matches the current bytes is deleted, even though the compiler never produced the file. | Write `notes.txt`; manifest `{kind:"css",path:"notes.txt",source:"src/placeholder.cssx",hash:<sha256 of notes.txt>}`; `xessa clean --json` → `removed:[{path:"notes.txt",reason:"deleted"}], skipped:[]`, file gone | Any process that can edit `.cssx-manifest.json` can turn `clean` into a workspace-file delete primitive (in-workspace only; escaping/absolute paths are rejected with warnings). | TT3 (manifest tamper) + TT8 |
| 3 | **`--config` consumes a following flag as its value**, so `--json` is silently swallowed and the failure is reported as a config error in text mode. | `xessa build --config --json` → exit 2, stderr `xessa: Configuration file not found: --json`, stdout empty | Diagnosis quality only (exit code is still 2); a caller asking for JSON gets text. | TT8 (low) |
| 4 | **`check --dry-run` is silently ignored** — `runCheck` always calls `executeBuild({write:false, dryRun:false})`, so the report says `dryRun:false` and `reason:"check"`. | `xessa check --dry-run --json` → `dryRun:false`, all outputs `reason:"check"` | None functionally (check never writes); a consumer keying on `dryRun` sees a wrong value. | TT8 (low) |

Asserted-as-documented (not defects): `--help` only short-circuits after a full parse, so `--help --wat`
and `compile --help` exit 2; an unknown command with `--json` labels the report with the offending
token; `out/../../escape.css` is rejected by `isWithin` rather than `isEscapingPath`.

## Skips with reasons

| Row | Reason |
|---|---|
| 8 exit-code rows already in `tests/integration/cli-config.test.ts:36-190` | Duplicate work forbidden by TT0/TT4 rules; evidence cited in the matrix above. |
| `--minify --no-minify` one direction | Already in `tests/integration/cli-build.test.ts:150`; only the reverse order and duplicates added here. |
| Read-only output dir → `XESSACLI001` | Already in `tests/integration/cli-build.test.ts:209` (root-skipped there). |
| Truncated/unsupported-version manifest JSON | TT3 owns manifest tamper classification (`tests/stress/fs/**`); implementing it here would cross write sets. |
| Mixed-flag concurrent build | Inherently nondeterministic; recorded above as a documented limitation rather than a flaky assertion. |
| Watch rename/dir-churn storms, mid-build kill | TT3/TT7 ownership. |

No `it.skip`, no `skipIf`, no conditional weakening was added in this phase.

## Validation

| Command | Result |
|---|---|
| `bun test tests/stress/cli/` | **65 pass / 0 fail**, 433 `expect()` calls, 6 files, ≈4.0–4.3 s (4.02 s on the second consecutive run) |
| `bun test tests/stress/cli/` (repeat) | identical result; golden files unmodified → **byte-stable across runs** |
| per-file counts | `exit-codes` 25, `precedence` 14, `json-golden` 11, `format-safety` 7, `clean-manifest` 6, `concurrency` 2 |
| `bun test tests/integration/` | **55 pass / 0 fail**, 306 `expect()` calls, 6 files, 5.79 s |
| `bun test` (full) | **1105 pass / 0 fail**, 72 files, 26.33 s |
| `bun run typecheck` | **pass** (no diagnostics) |
| `bunx biome check tests/stress/cli` | **clean** (7 files) |
| `bun run lint` | **pass** — 458 files; the 14 wave-sibling errors recorded in the first pass of this report were fixed by their owners (`tests/stress/{fuzz,editor,fs,corpus}`), none were ever in `tests/stress/cli/**` |
| `bun run verify` | **green** (typecheck + lint + 1105/0) |

## Handoff

Completed: the whole §TT4 deliverable — 65 tests, 9 goldens, all remaining matrix cells, findings,
concurrency record.
Verification: `bun test tests/stress/cli/` 65/0 (byte-stable, twice), `bun test tests/integration/` 55/0,
full `bun test` 1105/0/72, `typecheck` pass, `bun run lint` pass, `bun run verify` green.
Remaining: build flips the TT4 row to 🟢; TT8 opens tasks for findings 1–4 (1 is the only behavioural
one).
Touched: `tests/stress/cli/**` (8 source files + 9 goldens) and `.ai/reports/CSSX-TT4.md`.

## Concurrency flake follow-up (2026-11-26)

**Reported by two independent workers:** exactly 2 failures in `tests/stress/cli/concurrency.test.ts`
under `bun run verify`, reproduced twice.

**Root cause — not a race and not resource contention: a missing import.** The file called
`spawnCli(...)` while importing only `runCliAsync`. The last edit of the phase changed the helper in
`concurrentBuilds` to use `spawnCli` and to return `{results, overlapped}`, but the companion edit
(import line + three call sites) belonged to a multi-edit that was rejected as a whole because a later
hunk did not match — so the function body landed, the import and the callers did not. The two failing
tests are exactly the two tests in that file:

```
ReferenceError: spawnCli is not defined
  at concurrentBuilds (tests/stress/cli/concurrency.test.ts:96:19)
(fail) two simultaneous builds > both succeed and leave a complete, untorn workspace
(fail) two simultaneous builds > a second concurrent round reproduces the same final state
```

Failure was deterministic (100 % of runs), which is why it looked identical across workers and runs —
no timing, no manifest interleaving, no torn file was involved. The earlier "65 pass" evidence in this
report was measured *before* that refactor and the refactor was not re-run, which is how it shipped.

**Diagnosis of the suspected hypotheses:** (a) over-strict manifest byte-identity — **not** the cause;
the concurrent manifest remained byte-identical to the sequential build's in 16 post-fix runs, so that
assertion was left untouched. (b) tight bounded wait — **not** the cause; 60 s bound vs ≈60–130 ms
builds, and the case stays green under parallel `fs` + `fuzz` suites. (c) genuine CLI concurrency
defect — **not observed**; no invalid/torn manifest, no stale hash, no leftover `.cssx-tmp` in any run,
so no CSSX-T finding was opened.

**Change made (test-only, no source):** `tests/stress/cli/concurrency.test.ts`

| Line(s) | Change |
|---|---|
| 24-34 | import `spawnCli` instead of the now-unused `runCliAsync` |
| 119-124 | test 1 reads `round.results` (was `results`) and asserts `round.overlapped === true` — the overlap observation that the refactor was for |
| 168-173 | test 2 reads `firstRound.results` / `secondRound.results` (were plain arrays) |

No assertion was relaxed or removed: every artifact-validity, hash-consistency, manifest-completeness,
`overlapped` and no-`.cssx-tmp` assertion is still there and still green.

**Reproduction method:** `bun test tests/stress/cli/concurrency.test.ts` in a loop; before the fix the
first run failed 2/2 every time. After the fix:

| Run mode | Result |
|---|---|
| `bun test tests/stress/cli/concurrency.test.ts` ×10 consecutive | **10/10 green**, 0 failures |
| Same, with `bun test tests/stress/fs/` and `bun test tests/stress/fuzz/` running in parallel | **6/6 green**, 0 failures |
| `bun test tests/stress/cli/` ×2 consecutive | **65 pass / 0 fail** both runs (433 `expect()` calls), goldens unmodified (mtime 22:19) |
| `bun run verify` | **green** — 1105 pass / 0 fail / 72 files |

**Lesson for the phase record:** the failure mode was a stale-evidence gap, not a flaky test. Any edit
to a delivered suite must be followed by the owning validation command; the todo for TT8 is to treat
"suite edited after the last recorded run" as a gate failure, not a flake.
