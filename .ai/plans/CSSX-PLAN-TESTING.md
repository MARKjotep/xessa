# Xessa Plan — Stress-testing campaign (pre-production)

**Status:** complete 🟢 — TT0–TT8 executed, reported and lead-verified (campaign closed 2026-11-26).
Created 2026-11-26 against the editor-intelligence handover `.ai/HANDOVER.md` and the verified state
`bun run verify` 892 pass / 0 fail across 45 files, `bun run test:browser` 75/75 on
Chromium/Firefox/WebKit, `tests/extension/` 192 pass / 0 fail across 10 files.

The v0.1 language, compiler, CLI and editor surface are feature-complete and the existing suites are
green, but every suite is **example-shaped**: hand-written inputs, fixed fixtures, no size or
adversarial pressure. `bun run release:check` proves the packaging works; it proves nothing about what
happens on a 100k-line file, a corrupted manifest, a lone surrogate, a 500-module cycle or a
half-written output directory. This plan buys that evidence **before** the release plan executes.
Release engineering (packaging, publish, post-release installs) is owned by
`.ai/plans/CSSX-PLAN-PRODUCTION.md`, which is parked pending this campaign; its PP0 baseline gate must
be re-run after TT7.

Ownership: every phase is executed by `code` with lead verification of the recorded results; no phase
is closed from an agent claim alone. Write sets are exclusive per phase and additive — no existing
test file is edited to make a new stress case pass.

**Campaign closed 2026-11-26.** All nine phases are executed, reported and lead-verified on this tree:
final gates `bun run verify` **1 160 pass / 0 fail / 85 files** (1 162 tests including the **2 gated soak
tests**), `bun run test:browser` **96 tests** green on Chromium/Firefox/WebKit with **0/5 flakes** across
five runs, `bun run lint` exit 0. Thirteen defect task specs (`CSSX-T01`–`CSSX-T13`) and
`.ai/todo.md` items 21–33 carry the findings, `.ai/reports/CSSX-TT0.md`–`CSSX-TT7.md` carry the evidence,
and `.ai/plans/CSSX-PLAN-PRODUCTION.md` PP0 must re-run its baseline gate on this post-campaign tree.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| TT0 · Coverage map | Source-module → suite matrix with explicit gap notes, produced by reading the suites (draft below, re-verified at execution) | Every `packages/*/src` module and `scripts/benchmark.ts` has a row; each gap is concrete (named missing case), not "more tests needed" | 🟢 |
| TT1 · Compiler fuzz | Deterministic property/fuzz harness under `tests/stress/fuzz/` over `parse()` and `compile()` | Fixed seed budget green: no crash, hang, unbounded diagnostic count; every diagnostic has a valid span; format↔parse round trip and generator determinism hold | 🟢 |
| TT2 · Scale inputs | Pathological-size corpus (10k selectors, 1k-deep imports, 500-module graphs, 100k-line file) with validity/class-map/type assertions + memory ceiling | Outputs parse as valid CSS, class maps match emitted files 1:1, generated `.d.ts` typechecks; memory recorded against `docs/performance.md` medians with no unexplained regression | 🟢 |
| TT3 · Filesystem/planner | Path, symlink, permission, manifest-tamper, interrupted-write and watch-churn cases under `tests/stress/fs/` | Each case records the actual behavior; half-written artifacts never survive into the next build; tampered manifest yields a typed diagnostic, not a crash | 🟢 |
| TT4 · CLI/config surface | Exit-code matrix + `--json`/NDJSON golden snapshots + concurrent-build behavior record under `tests/stress/cli/` | Full 0/1/2 matrix covered with golden output; `format --check` never rewrites a parse-error file; concurrent two-process build behavior documented and asserted | 🟢 |
| TT5 · Runtime/consumer | Node 20/22/24 + Bun consumer matrix and external-CSS-parser / sourcemap spot-check gate under `tests/stress/consumer/` | Generated map + `.d.ts` import cleanly on every runtime/engine listed; literal types inferred; decoded sourcemap mappings land on the right positions | 🟢 |
| TT6 · Editor stress | Latency/stability harness for language service at 10k lines and 1000 files; keystroke-storm and malformed-mid-edit models | Recorded latencies with thresholds; no throw/unhandled rejection across the storm corpus; host-only checks marked manual and cross-linked to PP3 | 🟢 |
| TT7 · Soak | 30–60 min watch soak, 20× cold-build byte-identity, 5× full-gate flake run | Memory growth bounded and recorded; identical outputs every run; flake rate 0/5 with any flake documented | 🟢 |
| TT8 · Reports/follow-up | `.ai/reports/CSSX-TT0…TT7.md` plus the close-out recorded in `.ai/todo.md`, `docs/` and `.ai/PROGRESS.md`; task specs for real defects; test-inventory refresh | Every phase has a report with commands + actual numbers; every failure has a task spec and/or `.ai/todo.md` entry; no phase closed without full gates | 🟢 |

## Ground rules for the campaign

- **Failing repro test first.** A stress case that finds a defect lands as a test asserting the
  correct behavior (red), then a separate task prompt owns the fix, then TT8 re-runs it.
- **No assertion weakening.** Existing tests and goldens are not relaxed to accommodate stress
  findings; a finding either becomes a task or is recorded as a documented limitation.
- **Two budgets, one gate.** Every stress file runs a small deterministic budget inside `bun test`
  (default 200 cases, fixed seed) so `bun run verify` stays fast; long budgets run only via the
  dedicated script and `XESSA_STRESS_BUDGET`/`XESSA_STRESS_SEED` environment variables.
- **Deterministic only.** No wall-clock, PID or OS-entropy seeds in committed tests; the PRNG is
  hand-rolled (`tests/stress/prng.ts`) so results are reproducible on any machine.
- **Temp dirs only.** Every filesystem case builds inside `mkdtemp` under the OS temp dir and cleans
  up; no case writes into the repository, `examples/` or `tests/fixtures/`.
- **Fixtures are read-only inputs.** `tests/fixtures/**` is never mutated by a stress case; mutants
  are derived in memory from a frozen copy of the fixture bytes.
- **Full gates before "done".** Each phase closes only after `bun run verify` and, when it touches
  emitted CSS, `bun run test:browser` are green on the phase's final diff.

## TT0 — Coverage map

Deliverable: this matrix, verified by reading every suite (not by inference from file names), plus a
short "weakest 10" list that seeds TT1–TT7 case selection. Rows are module-level; a module with only
indirect coverage is stated as such.

| Module | Exercising suite(s) / fixture area | Gap (verified by reading, TT0) |
|---|---|---|
| `packages/compiler/src/lexer/**` | `tests/compiler/lexer.test.ts`, `lexer.fixtures.test.ts`, `lexer.invariants.test.ts`, `tests/fixtures/lexical/**` | Fuzz **is** present: exhaustive hostile alphabet (11 110 cases) + 1 500 seeded pseudo-random sources incl. NUL/U+0007/`é` (`lexer.invariants.test.ts:131,144`); NUL diagnostic `lexer.test.ts:290`. Missing: BOM `U+FEFF` at 0, lone/unpaired surrogates, CRLF/LF/CR mixed document (only one `\r\n` token, `lexer.test.ts:69`), 1 MB single token, 100k-line file (max run 20 000 chars, `lexer.invariants.test.ts:167`) — **closed by TT1** (`tests/stress/fuzz/lexer.test.ts`) |
| `packages/compiler/src/parser/**` | `tests/compiler/parser.test.ts`, `groups.parser.test.ts`, `tests/fixtures/errors/**` | Prefix/truncation fuzz exists for **one** source (`parser.test.ts:1136`, `pipeline.test.ts:186`). Missing: 10k-deep block/at-rule nesting, unbalanced quote/comment at every depth, prefix fuzz across all 67 fixtures, bounded diagnostic count per depth — **closed by TT1** (`tests/stress/fuzz/parser.test.ts`) |
| `packages/compiler/src/lowering/**` | `lowering.test.ts`, `media.test.ts`, `groups.expansion.test.ts`, `keyframes.test.ts` | Confirmed: no combinatorial pressure (one rule × 100 media variants, 1k-deep `&` chain) — no `repeat(` in any of the four files |
| `packages/compiler/src/resolver/**` | `resolver.test.ts`, `modules.test.ts`, `merge.test.ts`, `groups.resolver.test.ts`, `keyframes.test.ts` | Missing: 1k-deep `@use` chain, 500-module diamond/cycle graph, unicode/space source dirs. Symlink escape **is** covered (`resolver.test.ts:594`, `output.test.ts:280`) — **closed by TT2/TT3** (`tests/stress/scale/modules.test.ts`, `tests/stress/fs/paths.test.ts`) |
| `packages/compiler/src/variables/**` | `substitute.test.ts`, `runtime.test.ts`, `variables.golden.test.ts` | Confirmed: no `$`/`@` abuse fuzz, no adversarial namespace/member collisions at scale |
| `packages/compiler/src/naming/**` | `naming.test.ts`, `mapgen.test.ts`, `keyframes.test.ts`, `tests/fixtures/naming/**` | Missing: 10k-class table; camel-collision is one hand-built case (`mapgen.test.ts:130`) + one fixture. Run-to-run determinism **is** covered (`naming.test.ts:194`, `mapgen.test.ts:211`); iteration-order shuffle is not |
| `packages/compiler/src/selectors/**` | `selectors.test.ts`, `tests/fixtures/nesting/**` | Confirmed: no pathological selector lists (10k selectors, 500-selector rule), no specificity pressure at scale |
| `packages/compiler/src/emitter/**` | `emitter.test.ts`, `golden.test.ts`, `sourcemap.test.ts`, `tests/browser/specs/parity.pw.ts` | No independent CSS-parser validation. Whitespace-normalized minify/pretty equality **is** covered (`emitter.test.ts:141`) and in-browser parity over 10 scenarios (`parity.pw.ts`); neither reaches 1k-rule scale |
| `packages/compiler/src/formatter/**` | `formatter.test.ts`, `tests/extension/provider.formatting.test.ts`, `tests/extension/formatter.current-grammar.test.ts` | `format(format(x)) == format(x)` **is** covered for every fixture (`formatter.test.ts:137,425`) and `parse(format(x))` group-shape equality holds (`:404`). Missing: full-IR equality after reparse, malformed/large input (all inputs are fixture-sized) — **closed by TT1** (`tests/stress/fuzz/roundtrip.test.ts`); two formatter defects found there are open as `CSSX-T01`/`CSSX-T02`, one more (`CSSX-T05`) came from TT7 |
| `packages/compiler/src/sourcemaps/**` | `sourcemap.test.ts` | Confirmed: in-test VLQ decoder (`:43`), 5 hand-built position checks; no adversarial line/column, no spot-check of emitted CSS at scale |
| `packages/compiler/src/output/**` | `output.test.ts`, `planner.test.ts`, `tests/fixtures/output/**` | Missing: output dir == source dir, output inside `exclude`, planner-level manifest tamper/deletion, interrupted write, changed `@setup` destination across builds. Read-only output dir **is** covered at CLI level (`cli-build.test.ts:209`, chmod 0555 → XESSACLI001) |
| `packages/compiler/src/integration` (`src/index.ts`, `src/types/**`, `src/ir/**`) | `compile.test.ts`, `contract.test.ts`, `pipeline.test.ts` and every other suite indirectly | Public `compile()` has no fuzz/property loop (fixture-driven only, `compile.test.ts:112`) — **closed by TT1** (`tests/stress/fuzz/compile.test.ts`; its `$`-prefix span defect is open as `CSSX-T03`). Parse-level prefix fuzz is at `pipeline.test.ts:186`. IR invariants are asserted only as node/collection freezing (`parser.test.ts:1160`) plus the export surface (`contract.test.ts:39`) |
| `packages/compiler/src/host/node.ts` | `tests/integration/cli-*.test.ts` (indirect only) | Confirmed: every compiler suite injects an in-memory fake host (`groups.expansion.test.ts:31`, `modules.test.ts:29`), so EACCES, ENOENT mid-walk, ELOOP/dangling symlink are never exercised against the real host — **closed by TT3** (`tests/stress/fs/host-errors.test.ts`) |
| `packages/cli/src/args.ts` | `tests/integration/cli-helpers.ts`, `cli-config.test.ts`, `cli-build.test.ts`, `format-cli.test.ts` (subprocess) | Exit-2 matrix is largely covered (11 invocation cases, `cli-config.test.ts:35-190`) and `--minify --no-minify` is covered one-way (`cli-build.test.ts:150`). Missing: reverse flag order, duplicated flags (`--config` twice), NDJSON schema golden; cross-command flag misuse **is** covered (`format-cli.test.ts:44`) — **closed by TT4** (`tests/stress/cli/{precedence,json-golden}.test.ts`) |
| `packages/cli/src/commands/**` | `tests/integration/cli-build.test.ts`, `cli-config.test.ts`, `cli-watch.test.ts`, `format-cli.test.ts`, `scaffold.test.ts`, `tests/fixtures/cli/**` | Confirmed: no two-process concurrent build, no mid-build kill (watch `SIGINT`/`SIGKILL` at `cli-watch.test.ts:189,197` is teardown only), no watch rename/dir-churn storms. `scaffold.test.ts` covers only workspace manifests, not command behavior |
| `packages/cli/src/{index,compiler,formatter,project,report,setup}.ts` | subprocess via `cli-*.test.ts` + `node-smoke.test.ts`; `setup.ts` also unit-imported (`tests/compiler/modules.test.ts:3`) | Added row (was missing). Missing: `report.ts` NDJSON/JSON shape is field-asserted only, never golden-pinned; `compiler.ts` loader fallback chain (bare → `dist` → `src`) undriven; `project.ts` walker only at fixture size |
| `packages/cli/src/{config,glob,paths}.ts` | `cli-config.test.ts` (direct `glob.ts` imports at `:10`) | `scaffold.test.ts` does **not** cover these. Missing: unicode / spaces / 200-char segments / `..` escapes, multi-segment and nested-brace pathological globs (`cli-config.test.ts:218` covers single-segment only) |
| `packages/cli/src/{manifest,writer}.ts` | `cli-build.test.ts`, `cli-watch.test.ts` (subprocess only; no direct import) | Confirmed: no manifest corruption/tamper classification (truncated JSON, wrong hashes, foreign paths), no interrupted-write recovery assertion — **closed by TT3** (`tests/stress/fs/{manifest,interrupt}.test.ts`); the `.cssx-tmp` orphan is open as `CSSX-T07` |
| `packages/language-service/src/index.ts` | **none** — the file is a 3-line stub (`export {};`); only `tests/integration/scaffold.test.ts:41` reads its `package.json` name | Draft row was **wrong**: the "10 files / 192 tests" figure is `tests/extension/**` exercising `packages/vscode/src/**` (6 `provider.*` files / 150 tests, 10 files / 192 total). The package has no implementation, so TT6 must target `packages/vscode/src` until it is populated |
| `packages/vscode/src/analysis.ts` + `positions.ts` | `provider.analysis/intelligence/navigation/quickfix/project` suites (6 direct imports of `analysis.ts`) | Malformed mid-edit states are hand-picked single snapshots; A51 `#`/`(` typing is asserted per offset, never under rapid typing. `positions.ts` has no direct suite (indirect via `analysis.ts:32`) |
| `packages/vscode/src/{adapter,providers/**,controller,service}.ts` | Unit suites; `packages/vscode/test/suite.js` via `tests/extension/host.test.ts` | Several assertions read source **text** rather than behavior (`provider.intelligence.test.ts:2966-2986`). Host paths run only with a cached VS Code build — cache present here (1.147.0, `runnable=true`); suggest-widget/picker behavior stays manual (PP3) |
| `packages/vscode/src/{config,formatting,glob,output,quickfixes}.ts` | Direct imports from `provider.project/formatting/quickfix` suites | Added row (was missing). All five are well covered at fixture size; no path/encoding matrix behind `glob.ts` |
| `packages/vscode/src/{groups,keyframes,property-docs,positions,paths}.ts` | Indirect via `analysis.ts:26-32` and `intelligence.ts:29-34` only | Added row (was missing). `groups.ts` (320 lines) and `keyframes.ts` (436) re-implement compiler `resolver/{groups,keyframes}.ts` with **no differential test** against the compiler — **closed by TT6** (`tests/stress/editor/differential.test.ts`; cyclic-graph divergence open as `CSSX-T13`); `property-docs.ts` (169) and `paths.ts` (87) have no direct suite |
| `packages/vscode/src/extension.ts` | `packages/vscode/test/suite.js` via `host.test.ts` | 25-line activation wrapper; only observable in the extension host |
| `packages/vscode/test/suite.js` | `host.test.ts` orchestrator | Confirmed: skipped with an explicit reason when `@vscode/test-electron` or the cached build is absent; no stress assertions |
| `scripts/benchmark.ts` | none (no test anywhere in `tests/`) | Confirmed: harness itself unverified; `await main(process.argv.slice(2))` at module top level (`:395`) executes on import, so it can only be driven as a subprocess. Fixture determinism and the "zero error diagnostics" claim untested — **closed by TT2** (`tests/stress/scale/benchmark.test.ts`) |
| `tests/browser/specs/**` | Playwright: `playwright test --list` = **96 tests in 7 files** (32 per engine × Chromium/Firefox/WebKit), not 75 | Computed-style only. Pretty-vs-minified parity **is** asserted per scenario (`parity.pw.ts`, 10 scenarios); missing: 1k-rule / 1k-node DOM scenario and any independent CSS-text diff |
| `tests/fixtures/**` | `golden.test.ts`, `pipeline.test.ts:116` (catalog pinned at 67), `groups.golden.test.ts`, family goldens | Confirmed: 67 `input.cssx` entries, no frozen mutation corpus for fuzzing |

Rows annotated `closed by TTn` were re-checked after the campaign landed its suites; every other gap
column records the pre-campaign tree as read in TT0 (`.ai/reports/CSSX-TT0.md`) and is kept as written.

Dependencies: none.
Exit criteria: matrix committed in this plan with lead-verified gap notes; the "weakest 10" list is
copied into `tests/stress/README.md` as the case-selection checklist.
Validation: `bun test` still 892/45 (`bun run verify`), `bun run lint`.

## TT1 — Compiler fuzz and robustness

Deliverable: a deterministic property/fuzz harness for the pure core. Every case is seeded and
reproducible from `--seed`; failures print the seed, the input hash and the minimal reproducer.

| Harness file | Covers |
|---|---|
| `tests/stress/prng.ts` | xorshift128 PRNG, `--seed` plumbed through env and CLI |
| `tests/stress/corpus.ts` | frozen mutation corpus derived in memory from `tests/fixtures/**` + synthetic grammar templates |
| `tests/stress/fuzz/lexer.test.ts` | random bytes, mutated valid tokens, BOM, NUL, lone surrogates, CRLF/mixed endings, 1MB single token |
| `tests/stress/fuzz/parser.test.ts` | 10k-deep nesting, 100k-line file, unbalanced braces/parens/strings/comments at every nesting level, `$`/`@` abuse |
| `tests/stress/fuzz/compile.test.ts` | full `compile()` on mutated projects: no throw, bounded diagnostics (≤ a fixed cap per input), every diagnostic span inside source bounds with `start <= end` |
| `tests/stress/fuzz/roundtrip.test.ts` | `parse(format(x))` IR-equal to `parse(x)`; `format(format(x)) == format(x)` |
| `tests/stress/fuzz/determinism.test.ts` | byte-identical output across repeated runs and across shuffled module-read order (hook the host's `readFile`) |
| `tests/stress/fuzz/runner.ts` | standalone long-run entry: `--area lexer,parser,compile,roundtrip,determinism --budget N --seed N`, exit 1 on any violation |

Constraints: no new dependency (no fast-check); the PRNG and shrinker are hand-rolled. A
property-testing library needs owner approval and is not assumed here.
Owned file scope: `tests/stress/{prng,corpus}.ts`, `tests/stress/fuzz/**`, `tests/stress/README.md`,
`"stress"`/`"stress:fuzz"` scripts in root `package.json`.
Dependencies: TT0.
Exit criteria: default budget green in `bun test`; a 100k-case run of every area exits 0 with no crash,
no hang (per-case timeout enforced) and no unbounded diagnostic growth; every violation found either
fixed under a TT8 task or recorded as a documented limitation.
Validation: `bun test tests/stress/fuzz/`, `XESSA_STRESS_BUDGET=100000 bun tests/stress/fuzz/runner.ts --area compile --seed 1`.

## TT2 — Scale and pathological inputs

Deliverable: correctness-under-size corpus, distinct from the speed numbers in `docs/performance.md`.

| Case | Assertion |
|---|---|
| 10k-selector project, 5k-token file | builds with zero error diagnostics; emitted CSS re-parses |
| One rule with 100 media variants | emitted CSS valid; grouped output keeps declaration order |
| 1k-deep `@use` chain | builds; no stack overflow; depth diagnostic if a limit exists |
| Diamond + cycle graph of 500 modules | deterministic resolution or a typed cycle diagnostic; no hang |
| 1k-deep `&` chain, 500-item selector list | emitted selectors remain valid CSS |
| 1000-file project | class map ↔ emitted files 1:1; `.d.ts` compiles under `tsc --noEmit` |
| Memory at 1000 files | recorded RSS/peak against `docs/performance.md` medians; regression noted |
| `scripts/benchmark.ts --json` | subprocess run: schema stable, fixture bytes identical across two runs, reported zero-error claim independently re-checked |

Validity is checked with `xessa check` on the emitted CSS **and** a lightweight independent re-parse in
the harness; a third-party CSS parser is a dependency decision (owner approval) and is not assumed.
Owned file scope: `tests/stress/scale/{generate.ts,*.test.ts}`, `tests/stress/scale/memory.test.ts`.
Dependencies: TT1 (shared PRNG/generators); can run in parallel with TT3/TT4 (disjoint paths).
Exit criteria: all cases green on the default budget; memory ceiling recorded with machine context;
every case that cannot pass becomes a task spec rather than a skipped test.
Validation: `bun test tests/stress/scale/`, `bun run benchmark`, `bun run --cwd packages/compiler build && tsc --noEmit` on a generated `.d.ts`.

## TT3 — Filesystem and output-planner stress

Deliverable: path/manifest/write-pressure cases, each asserting current behavior explicitly.

| Area | Cases |
|---|---|
| Paths | spaces, NFC/NFD unicode, emoji, 200-char names, deep nesting, `..` escapes |
| Links | symlinked source dir, symlinked import target, cyclic symlink (must yield a diagnostic, not a hang) |
| Planner safety | read-only output dir (EACCES → typed diagnostic + exit 1), output dir == source dir, output inside `exclude`, output path collision with an existing non-artifact file |
| Manifest | deleted, truncated JSON, valid JSON with tampered hashes/paths, manifest from a different project |
| Rebuilds | two sequential builds after changing `@setup` destinations (stale artifact removal), `clean` vs hand-edited outputs |
| Interruption | kill mid-write (child process + `SIGKILL` at a marker), then a clean build: no half-written artifact survives |
| Watch | rapid-fire edits (≥20 in one tick), rename in place, directory create/remove during watch, file inside `exclude` touched |

Owned file scope: `tests/stress/fs/**`.
Dependencies: TT0. Disjoint from TT4 (no shared files); can run in parallel.
Exit criteria: every row is an executed case with a recorded actual, assertions written to the
correct behavior; crashes become XESSA#### diagnostics or typed errors via TT8 tasks.
Validation: `bun test tests/stress/fs/`, `bun test tests/integration/`.

## TT4 — CLI and config surface

Deliverable: an exhaustive invocation contract, snapshot-pinned.

| Area | Cases |
|---|---|
| Exit codes | 0 = success, 1 = build/check/format failure, 2 = invocation error; one row per failure mode (unknown flag, missing value, duplicate `--config`, extra positional, unknown command, invalid config schema, missing include matches, conflicting flags) |
| Flag precedence | `--minify --no-minify` and the reverse, duplicated flags, `--check` outside `format`, `--dry-run` with `--json` |
| JSON/NDJSON | `--json` for build/check/clean and NDJSON for watch: golden snapshots (stable key order, stable diagnostic shape), including on invocation errors after `--json` |
| format safety | `format --check` on a parse-error file: exit 1, file bytes unchanged; `format` on a file with pre-existing CRLF |
| clean | `clean` against a foreign/hand-edited manifest, `clean` on an empty output dir, `clean --dry-run` |
| Concurrency | two simultaneous `build` processes on one project: assert the currently-documented single-writer behavior (last-writer-wins, no corruption) and record it in `docs/` |

Owned file scope: `tests/stress/cli/**`, golden files under `tests/stress/cli/golden/**`.
Dependencies: TT0; independent of TT2/TT3.
Exit criteria: the exit-code matrix has no uncovered cell; goldens are byte-stable across two runs;
concurrent behavior is documented rather than discovered at release time.
Validation: `bun test tests/stress/cli/`, `bun test tests/integration/cli-build.test.ts tests/integration/format-cli.test.ts`.

## TT5 — Cross-runtime and consumer matrix

Deliverable: evidence that generated artifacts work outside Bun.

| Case | Assertion |
|---|---|
| Node 20/22/24 + Bun on `packages/*/dist` | `import` of the built compiler/CLI works; `--version` per runtime |
| ESM consumers | plain ESM import of generated map + `.d.ts` under `node --input-type=module`; Vite/esbuild bundling of the same import when those tools are already present (no new dependency) |
| Type inference | `tsc` infers literal class-name keys and the map's exports; a `@ts-expect-error` on a wrong key still errors |
| CSS validity | emitted fixtures re-parsed by the independent in-harness parser from TT2 (same limitation note) |
| Minify parity | minified vs pretty output: same declarations/selectors/at-rules after normalization, beyond the existing 75-test browser gate |
| Sourcemaps | decode VLQ mappings and assert generated→original positions for hand-picked emitted declarations at 3 scales |

Owned file scope: `tests/stress/consumer/**`, `tests/stress/consumer/fixtures/**`.
Dependencies: TT2 (generated scale corpus is reused).
Exit criteria: matrix green for the runtimes actually installed here; a runtime that is unavailable is
recorded as unverified with the reason, never as passed.
Validation: `bun test tests/stress/consumer/`, `node packages/cli/dist/index.js --version`, `bun run release:check` (packaging still green).

## TT6 — Editor stress

Deliverable: latency and stability numbers for the language service, plus a hostile keystroke model.

| Case | Assertion |
|---|---|
| 10k-line file | completion, hover and rename each under the recorded threshold (completion < 100 ms cached); record p50/p95 |
| 1000-file project | index-build time recorded; symbol/alias analysis correct on a spot-checked sample |
| Keystroke storm | replay a typed document one character at a time through `parse()` + provider calls: no throw, no unhandled rejection, bounded time |
| Malformed mid-edit | corpus of every truncated prefix of the A45–A51 bug documents: providers never throw, completions degrade gracefully |
| A51 surfaces under typing | `#` hex palette, `(` functions and `&:`/`&.` replacement ranges hold while typing fast (unit-model, no host) |
| Repeated activation | controller/service teardown + re-registration loop leaks no listeners |
| Host-only behavior | suggest-widget swatches, native picker, real activation — **manual**, defer to CSSX-PLAN-PRODUCTION.md PP3 |

Owned file scope: `tests/stress/editor/**` (new files only; `tests/extension/**` and
`packages/vscode/test/suite.js` are not modified by this phase — PP3 owns the host harness).
Dependencies: TT0.
Exit criteria: recorded numbers with machine context; zero throws across the storm corpus; anything the
Bun-level harness cannot observe is listed as manual with the exact reason.
Validation: `bun test tests/stress/editor/`, `bun test tests/extension/` (192/10 unchanged).

## TT7 — Soak and reliability

Deliverable: time-based evidence, run once on the release-candidate tree.

| Case | Assertion |
|---|---|
| Watch soak | 30–60 min `xessa watch` with an edit every 30 s: memory growth bounded and recorded, no watcher stall, every edit produces a fresh artifact |
| Cold-build identity | 20 consecutive cold builds: byte-identical CSS, map, `.d.ts` and manifest each run |
| Flake detection | `bun run verify` + `bun run test:browser` ×5: flake rate recorded per suite; 0/5 expected, any flake becomes a task |
| Long fuzz | TT1 runner at the maximum budget on the release candidate |

Owned file scope: `tests/stress/soak/**`, `.ai/reports/CSSX-TT7.md` (soak logs stay in
`.ai/reports/logs/` only if the numbers are not reproducible elsewhere).
Dependencies: TT1–TT6 landed (the tree under soak must be the one the release plan will ship).
Exit criteria: all four rows executed with numbers pasted into the report; a bounded-memory claim is
backed by a recorded series, not a single sample.
Validation: `bun run verify`, `bun run test:browser`, `bun test tests/stress/soak/` (`XESSA_SOAK=1` gated).

## TT8 — Reports and follow-up

Deliverable: durable evidence and routed defects.

- `.ai/reports/CSSX-TT0.md` … `CSSX-TT8.md`: changed files, commands, actual numbers, deviations,
  unverified items with reasons.
- Defects: a task prompt for each real bug (repro, expected/actual, owned files), plus a
  `.ai/todo.md` entry; only external-tool defects (Playwright, VS Code host, Bun, Biome) get a
  framework bug record with mandatory resolved version — none exists for Xessa tools
  yet, so creating that layout needs lead approval.
- Docs: refresh `docs/performance.md` only if TT2/TT7 numbers change the recorded tables; extend
  `docs/known-limitations.md` for any behavior accepted as a documented limit; note the campaign
  outcome in `.ai/PROGRESS.md`.
- Cross-link: this plan's final row feeds `.ai/plans/CSSX-PLAN-PRODUCTION.md` PP0 (re-run the baseline
  gate on the post-campaign tree) and is a prerequisite for PP1–PP4.

Dependencies: TT0–TT7.
Exit criteria: every phase has a report with real command output; no defect is left only in prose; the
test inventory in this plan matches the tree (`bun test` file/test counts).
Validation: `bun run verify`, `bun run lint`, `bun run test:browser`, `bun run release:check`.

## How to run

| Purpose | Command |
|---|---|
| Default stress gate (bounded, part of `bun test`) | `bun test tests/stress/` |
| Long fuzz run | `XESSA_STRESS_BUDGET=100000 XESSA_STRESS_SEED=1 bun tests/stress/fuzz/runner.ts --area compile` |
| Per-area fuzz | `bun tests/stress/fuzz/runner.ts --area roundtrip --budget 5000 --seed 7` |
| Scale/pathological corpus | `bun test tests/stress/scale/` |
| Filesystem and planner | `bun test tests/stress/fs/` |
| CLI contract | `bun test tests/stress/cli/` |
| Consumer/runtime matrix | `bun test tests/stress/consumer/` |
| Editor latency/stability | `bun test tests/stress/editor/` |
| Soak (gated, long) | `XESSA_SOAK=1 bun test tests/stress/soak/` |
| Baseline benchmarks (compare against `docs/performance.md`) | `bun run benchmark` |
| Full gate | `bun run verify` then `bun run test:browser` |
| Aggregate packaging gate (release plan PP0) | `bun run release:check` |

## Non-goals

- **No release execution.** Tagging, publishing, marketplace upload and post-release installs belong to
  `.ai/plans/CSSX-PLAN-PRODUCTION.md` (PP4/PP5); this plan only produces the evidence its PP0 gate
  consumes.
- **No new language features or semantics.** Findings that would need a language change are recorded as
  limitations or owner decisions, not implemented here.
- **No dependency additions by default.** The fuzz harness is hand-rolled (PRNG + shrinker) so
  `bun run verify` stays dependency-free; adding fast-check or a third-party CSS parser requires owner
  approval and a separate decision record.
- **No assertion weakening or golden churn.** Existing suites and fixtures are read-only inputs; stress
  findings add tests, they never relax one.
- **No performance promises.** TT2/TT7 record measurements against existing medians; targets do not
  move because a number was measured.
- **No CI/pipeline work.** The campaign runs locally against the current working tree; wiring it into a
  scheduled job is out of scope.

## Cross-references

- `.ai/plans/CSSX-PLAN-PRODUCTION.md` — PP0 baseline, PP1 packaging, PP3 manual editor smoke, PP4
  release execution (parked pending this campaign).
- `.ai/HANDOVER.md` — verified counts and the 7-item manual smoke checklist.
- `docs/performance.md` — benchmark harness, medians and machine context for TT2/TT7 comparisons.
- `docs/known-limitations.md`, `docs/cascade.md`, `docs/release.md` — claims the stress campaign
  either confirms or corrects.
