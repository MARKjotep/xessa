# CSSX-FIX-INTEGRATION — full gate, board/docs reconciliation and final evidence

**Status:** 🟢 PASS · **Worker:** `code` (integration) · **Date:** 2026-11-26
**Scope:** the 19 defects CSSX-T01…T13 and CSSX-U01…U06 fixed by eight prior workers.

## Summary

- **Full gate is green on the integrated tree.** `bun run verify` exits 0: four per-package
  `tsc --noEmit` runs clean (the root `@types/node` caveat did **not** occur), `biome check .` clean
  over 506 files, and `bun test` reports **1 195 pass / 2 skip / 0 fail** across 88 files
  (994 737 assertions), including the extension-host suite at **13 scenarios / 826 assertions**.
- One gate failure was found and fixed before that run: three test files carried biome formatting
  drift from landed fix work. Only whitespace was reformatted; no assertion or logic changed.
- All 19 board entries are now 🟢 with a fix reference + evidence pointer; `CHANGELOG.md` and
  `.ai/PROGRESS.md` carry the fixes in their existing conventions; the T04 selector-expansion bound is
  documented in `SPECIFICATION.md` §7.1 and `docs/known-limitations.md` §4.
- Consistency sweep is clean: every task spec is 🟢 with a `## Fix record`, the fuzz runner reports
  `pinned=0`, the UI pins assert repaired behaviour, and `HANDOVER.md` checklist row 6 no longer
  documents the `&` defect.

## Baseline (read-only, first command)

```text
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 D .ai/framework/vscode-test-electron/bugs/macos-electron-launcher-missing.md
 M .ai/plans/CSSX-PLAN-PRODUCTION.md
 M .ai/todo.md
 D .pi/agents/advisor.md … D .pi/agents/vision.md
 D .pi/settings.json
 D .pi/subagents.json
 M AGENTS.md
 M README.md
 M docs/compatibility.md
 M docs/configuration.md
 M docs/known-limitations.md
 M examples/basic/src/button.cssx
 M package.json
 M packages/cli/src/args.ts
 M packages/cli/src/commands/build.ts
 M packages/cli/src/commands/check.ts
 M packages/cli/src/commands/clean.ts
 M packages/cli/src/commands/watch.ts
 M packages/cli/src/manifest.ts
 M packages/cli/src/writer.ts
 M packages/compiler/src/formatter/index.ts
 M packages/compiler/src/index.ts
 M packages/compiler/src/selectors/flatten.ts
 M packages/compiler/src/selectors/index.ts
 M packages/compiler/src/variables/expand.ts
 M packages/vscode/src/analysis.ts
 M packages/vscode/src/controller.ts
 M packages/vscode/src/groups.ts
 M packages/vscode/src/intelligence.ts
 M packages/vscode/src/keyframes.ts
 M packages/vscode/src/providers/navigation.ts
 M packages/vscode/test/suite.js
 M tests/compiler/formatter.test.ts
 M tests/extension/provider.analysis.test.ts
 M tests/extension/provider.intelligence.test.ts
 M tests/extension/provider.navigation.test.ts
?? .ai/plans/CSSX-PLAN-TESTING.md
?? .ai/plans/CSSX-PLAN-UI.md
?? .ai/reports/CSSX-FIX-*.md (8 area reports)
?? .ai/reports/logs/
?? .ai/tasks/CSSX-T01.md … T13.md, U01…U06
?? opencode.jsonc
?? packages/vscode/test/fixtures/ui/
?? packages/vscode/test/ui/
?? tests/compiler/nesting-bound.test.ts
?? tests/compiler/setup-span-bounds.test.ts
?? tests/compiler/single-file-duplicate.test.ts
?? tests/stress/
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Unrelated tracked/untracked changes were preserved. No commits, pushes, stashes, resets, dependency
changes or `.ai/plans/**` edits were made.

## Gate evidence

Log: `.ai/reports/logs/verify-integration.log` (the successful run).

| Command | Actual outcome |
|---|---|
| `bun run verify` | **exit 0** |
| `tsc -p packages/compiler/tsconfig.json --noEmit` | exit 0, no output |
| `tsc -p packages/cli/tsconfig.json --noEmit` | exit 0, no output |
| `tsc -p packages/language-service/tsconfig.json --noEmit` | exit 0, no output |
| `tsc -p packages/vscode/tsconfig.json --noEmit` | exit 0, no output |
| `biome check .` | `Checked 506 files in 279ms. No fixes applied.` — 0 errors |
| `bun test` | **1 195 pass, 2 skip, 0 fail**, 994 737 `expect()` calls, 88 files, 75.07 s |
| extension-host suite (inside `bun test`) | 13 scenarios, 826 assertions, exit 0 (`baseline=36, completions=121, hovers=42, diagnostics=36, colors=42, commands=26, navigation=24, quickfix=15, checklist=98, commands-matrix=101, config=54, accessibility=196, performance=35`) |

The two skips are the opt-in soak suites (`tests/stress/soak/watch-soak.test.ts` and
`cold-build.test.ts`, gated by `XESSA_SOAK`), each counted as one skip; they are deliberate,
pre-existing and not failures. The known root `@types/node` caveat from the CLI worker's report
did **not** reproduce — the root `bun run typecheck` script resolved all four packages cleanly, so no
substitute evidence was needed. The only edits after the successful gate were Markdown records (board,
changelog, progress, spec, limitations, this report); `biome check .` was re-run afterwards and stayed
clean (506 files).

### Gate failure found and fixed (disclosed)

The first `bun run verify` (log overwritten by the successful run; failure output quoted here) exited 1
at `biome check .` with three formatting-only findings:

```text
./tests/compiler/single-file-duplicate.test.ts format  × Formatter would have printed the following content
./tests/stress/editor/differential.test.ts format       × Formatter would have printed the following content
./tests/extension/provider.intelligence.test.ts format  × Formatter would have printed the following content
Found 3 errors.
```

These drifts came from landed fix work (a new U04 test file, a T13 assertion edit, and a
previously-flagged pre-existing drift in `provider.intelligence.test.ts`). Fix: `bunx biome check --write`
on exactly those three files (`Fixed 3 files`). Only line wrapping/whitespace changed; a re-run of the
full gate passed. No source behaviour, assertion or test logic was altered.

## Per-defect evidence

All rows share the full-gate evidence above; the “targeted evidence” column is the area worker's
recorded proof and is reproducible from its report.

| Defect | Fix worker / report | Changed areas | Targeted evidence |
|---|---|---|---|
| CSSX-T01 formatter at-rule terminator growth | formatter · `CSSX-FIX-FORMATTER.md` | `packages/compiler/src/formatter/index.ts`, `tests/stress/fuzz/roundtrip.test.ts` | `@x[a` fixed point + IR equality; `tests/stress/fuzz/` 47 pass |
| CSSX-T02 adjacent `@`-marker variant split | formatter · `CSSX-FIX-FORMATTER.md` | formatter, `tests/compiler/formatter.test.ts`, roundtrip corpus | one variant after format/reparse; formatter suite 21 pass |
| CSSX-T03 out-of-bounds `XESSA2001` span | span · `CSSX-FIX-SPAN.md` | `variables/expand.ts`, `tests/compiler/setup-span-bounds.test.ts`, fuzz classifier/soak | 100 000-case compile fuzz `violations=0`; all spans in bounds |
| CSSX-T04 unbounded `&` expansion | nesting · `CSSX-FIX-NESTING.md` | `selectors/flatten.ts`, `selectors/index.ts`, `tests/compiler/nesting-bound.test.ts` | 1 000-level `& &` rejected in ≈2.2 s with one XESSA1001; 12-level unchanged; `tests/compiler` 655 pass |
| CSSX-T05 `$` sigil dropped by `format` | formatter · `CSSX-FIX-FORMATTER.md` | formatter, `tests/compiler/formatter.test.ts`, roundtrip `$ns.name` case | byte-identical fixed point, zero diagnostics; 100k roundtrip `pinned=0` |
| CSSX-T06 watch stall / manifest desync | CLI · `CSSX-FIX-CLI.md` | `commands/watch.ts`, `commands/build.ts`, `tests/stress/soak/*` | soak 5 and 20 edits: 0 stale discards, manifest records = artifacts |
| CSSX-T07 `.cssx-tmp` orphans | CLI · `CSSX-FIX-CLI.md` | `writer.ts`, `commands/build.ts`, `clean.ts`, interrupt tests | planted temp gone after rebuild/`clean`; `tests/stress/fs/` 54 pass |
| CSSX-T08 new nested directory undiscovered | CLI · `CSSX-FIX-CLI.md` | `commands/watch.ts`, `tests/stress/fs/watch.test.ts` | new `src/fresh/five.cssx` builds and emits a build event |
| CSSX-T09 empty include match exits 0 | CLI · `CSSX-FIX-CLI.md` | `build/check/watch`, exit-code tests, `docs/configuration.md`, `known-limitations.md`, `README.md` | exit 2 text + JSON; `tests/stress/cli/` 69 pass |
| CSSX-T10 manifest delete primitive | CLI · `CSSX-FIX-CLI.md` | `manifest.ts`, `commands/clean.ts`, `commands/build.ts`, manifest tests | `notes.txt` skipped as `untrusted`; `tests/stress/fs+cli` 123 pass |
| CSSX-T11 `--config --json` misparse | CLI · `CSSX-FIX-CLI.md` | `args.ts`, exit-code tests | `--config requires a path.`; JSON when `--json` first |
| CSSX-T12 `check --dry-run` ignored | CLI · `CSSX-FIX-CLI.md` | `args.ts`, precedence tests, docs | exit 2 `--dry-run is not valid for xessa check.` |
| CSSX-T13 cyclic group/keyframe divergence | editor-analysis · `CSSX-FIX-EDITOR-ANALYSIS.md` | `vscode/src/groups.ts`, `keyframes.ts`, `tests/stress/editor/differential.test.ts` | 100/100 cyclic seeds set-equal to compiler; 26 fixtures unchanged |
| CSSX-U01 `$` sigil dropped in completion | editor-completions · `CSSX-FIX-EDITOR-COMPLETIONS.md` | `vscode/src/intelligence.ts`, `test/ui/completions.js`, intelligence tests | item is `$theme.`; accepting yields `$theme.` |
| CSSX-U02 lone `&` duplicated | editor-completions · `CSSX-FIX-EDITOR-COMPLETIONS.md` | `intelligence.ts`, `completions.js`, `checklist.js` row 6, intelligence tests | starters replace `caret-1…caret`; `&:hover` → one `&` |
| CSSX-U03 `&.` offers `&` starters | editor-completions · `CSSX-FIX-EDITOR-COMPLETIONS.md` | `intelligence.ts`, `completions.js`, `checklist.js` row 6 | class-only list; `.card` keeps the dot |
| CSSX-U04 rename collision / silent duplicates | editor-commands + compiler · `CSSX-FIX-EDITOR-COMMANDS.md`, `CSSX-FIX-U04-COMPILER.md` | `providers/navigation.ts`, `vscode/src/analysis.ts`, `compiler/src/index.ts`, `navigation.js`, `single-file-duplicate.test.ts` | rename refused byte-identically; single-file duplicate = one XESSA2001 |
| CSSX-U05 `$token` in `@group` bodies | editor-analysis · `CSSX-FIX-EDITOR-ANALYSIS.md` | `vscode/src/analysis.ts`, intelligence/navigation tests | hover/definition 0→1; rename covers the group body |
| CSSX-U06 empty preview tab | editor-commands · `CSSX-FIX-EDITOR-COMMANDS.md` | `vscode/src/controller.ts`, `commands-matrix.js` | dead document keeps the editor and opens no preview |

## Board and documentation changes

- `.ai/todo.md`: bug entries 5–23 (CSSX-T01…T13, U01…U06) flipped from `🔴 open: …` to
  `🟢 fixed in <task> (<short fix>; <test/report evidence>)`. Feature requests and the Quick Note were
  not touched. No `🔴 open` entry remains in the bug section.
- `CHANGELOG.md`: new `### Fixed` subsection under `## [Unreleased]` with all 19 fixes in the file's
  Keep-a-Changelog style, grouped compiler → CLI → editor, each with its task ID.
- `.ai/PROGRESS.md`: two appended rows (P9/P10 defect fixes; P9/P10 integration gate). Existing
  unrelated rows preserved.
- `SPECIFICATION.md` §7.1: per-rule bound of 8 388 608 characters / 100 000 alternatives, the exact
  reused **XESSA1001** message naming the nesting depth, and the recorded optional `XESSA1004`
  follow-up.
- `docs/known-limitations.md` §4: “Selector expansion is bounded” row with the measured growth
  (66/210/786/3 090/12 306 B at 4/6/8/10/12 levels), the cap, the single-diagnostic failure mode and
  the optional subcode; evidence points at `tests/compiler/nesting-bound.test.ts`.
- T09 docs were checked for consistency: `README.md` exit-code table (exit 2 “include globs that match
  no `.cssx` sources”), `docs/configuration.md` (`include` row and the empty-discovery paragraph) and
  `docs/known-limitations.md` (#3 “Empty discovery is an error”) all state the same exit-2 behaviour.
  No inconsistency found; no edit needed.

## Consistency sweep

- All 19 owned task specs show `**Status:** 🟢 fixed` and exactly one `## Fix record`.
- No defect pins remain: `tests/stress/fuzz/areas.ts` documents “No defect is pinned any more”,
  `long-fuzz.ts` has no expected-failure classification, and
  `bun tests/stress/fuzz/runner.ts --budget 2000 --seed 7` reported
  `PASS … cases=10042 violations=0 pinned=0` (all five areas `pinned=0`).
- UI host modules assert repaired behaviour: `completions.js` asserts `$theme.` and the lone-`&`
  replacement range, `navigation.js` asserts the rename refusal and byte-identical document,
  `commands-matrix.js` asserts no preview document for a dead file. `checklist.js` row 6 asserts
  `&:`/`&.`/lone-`&` repair (17 assertions).
- `.ai/HANDOVER.md` manual-checklist row 6 now reads “`&:` + accept → `&:hover`; `&.` + accept keeps
  the dot; property completion works above an `&` line” — the `&` duplication defect is no longer
  documented.

## Not run / deviations

- **`bun run test:browser` not required.** No worker changed emitted CSS: the formatter changes are
  unreachable for the fixture corpus (fixtures author no `$` names, no dangling at-rule preludes, no
  marker-prefixed variant values) and the formatter/golden suites pin fixture byte-identity; the
  nesting bound only rejects over-budget rules; T07–T12 are filesystem/CLI behaviour. Recorded rather
  than run, per the dispatch.
- **UI screenshot refresh is optional, not a gap.** `.ai/reports/logs/ui-screens/` already contains
  `suggest-amp-dot.png`; the `suggest-amp-dot` refresh (`capture.js --all`) was not re-run to avoid a
  second resource-intensive host launch after the gate. The host assertion in `checklist.js` row 6 is
  the behavioural evidence.
- **Observation (not edited):** `packages/vscode/test/ui/checklist.js` line 14 still describes row 6
  as “automated + the pinned `CSSX-U1` defect kept visible”, while the row's assertions now pin the
  repaired behaviour. It is a stale header comment outside this task's write set; no assertion is
  affected.
- The CLI worker's earlier `format --check` gap (caused by concurrent in-flight edits) is moot: the
  integrated tree typechecks and the full suite is green.
