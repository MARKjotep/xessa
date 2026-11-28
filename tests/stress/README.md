# tests/stress — deterministic stress harness

Purpose: hold the adversarial, size and reliability evidence that `.ai/plans/CSSX-PLAN-TESTING.md`
phases TT1–TT7 produce. The existing suites (`tests/compiler/`, `tests/integration/`,
`tests/extension/`, `tests/browser/`) are example-shaped: hand-written inputs and frozen fixtures.
Everything here applies pressure instead — mutated bytes, pathological size, hostile filesystems,
runtime and editor matrices, time — while staying **reproducible byte-for-byte on any machine**.

Coverage map and the reason each case below outranks the others: `.ai/reports/CSSX-TT0.md`
(verified module → suite matrix in the plan's §TT0).

## Ground rules

| Rule | Contract |
|---|---|
| Deterministic seeds | Every generated case derives from `XESSA_STRESS_SEED` (default `1`). No wall-clock, PID, `Math.random()` or OS entropy. The PRNG is hand-rolled in `tests/stress/prng.ts`; a failure prints the seed plus the input hash so it is replayable. |
| Bounded default budgets | `XESSA_STRESS_BUDGET` (default `200` cases) keeps `bun test` fast enough for `bun run verify`. Long runs are opt-in through the same variable or the standalone `tests/stress/fuzz/runner.ts --budget`. |
| Fixtures are read-only | `tests/fixtures/**` is an input, never an output. Mutants are derived in memory from a frozen copy of the fixture bytes; nothing under `tests/fixtures/`, `examples/` or the repository root is written by a stress case. |
| Temp dirs only | Every filesystem case builds in a `mkdtemp` directory under the OS temp dir and cleans up. |
| No assertion weakening | A stress finding lands as a **new** test asserting the correct behavior (red) plus a dedicated task prompt for the fix. No existing test, golden or fixture is relaxed, skipped or deleted to make a stress case pass. |
| Full gates before "done" | Each phase closes only after `bun run verify` (and `bun run test:browser` when emitted CSS changes). |
| No new dependencies by default | No `fast-check`, no third-party CSS parser; both need owner approval and a decision record. |

## Case-selection checklist — the weakest 10

Ranked most-weak first by blast radius × genuine absence of coverage. TT1–TT7 implement these before
anything else; each line lists the concrete missing cases, not "more tests".

| # | Area (module) | Missing cases to implement | Phase |
|---|---|---|---|
| 1 | `packages/language-service/src/index.ts` | The package is a 3-line stub (`export {};`) — nothing imports it, so the plan's "language service at 10k lines" has no subject. (a) assert the stub's public surface is either implemented or explicitly re-scoped; (b) retarget the latency cases at `packages/vscode/src/{analysis,intelligence,service,controller}.ts`. | TT6 |
| 2 | `packages/cli/src/{manifest,writer}.ts` | (a) two concurrent `build` processes on one project — last-writer-wins, no torn artifact; (b) `SIGKILL` mid-write, then a clean build leaves no half-written artifact; (c) tampered manifest (truncated JSON, wrong hashes, foreign paths) → typed diagnostic, not a crash; (d) manifest copied from a different project. | TT3, TT4 |
| 3 | `packages/compiler/src/host/node.ts` | Every compiler suite injects an in-memory fake host, so real-fs errors are never exercised: (a) EACCES on read; (b) ENOENT appearing mid-walk; (c) ELOOP / dangling symlink; (d) a directory where a file is expected. | TT3 |
| 4 | `packages/cli/src/{config,glob,paths}.ts` | (a) paths with spaces, NFC/NFD pairs, emoji, 200-char segments, deep nesting, `..` escapes; (b) multi-segment and nested-brace globs (`**/**/**/*.cssx`, `{a,{b,{c,d}}}.cssx`) — today only single-segment patterns are asserted; (c) `exclude` matching against a unicode path. | TT3 |
| 5 | `packages/compiler/src/{resolver,naming,selectors}/**` | (a) 1k-deep `@use` chain — no stack overflow, or a depth diagnostic if a limit exists; (b) 500-module diamond **and** 500-module cycle graph — deterministic resolution or a typed cycle diagnostic, no hang; (c) 10k-selector project and one 500-selector rule; (d) 10k-class table with camel-collision at scale. | TT2 |
| 6 | `packages/compiler/src/index.ts` (public `compile()`) | No property/fuzz loop exists anywhere. (a) mutated fixture projects through `compile()`: never throws, diagnostics bounded per input, every span `0 <= start <= end <= source.length`; (b) byte-identical output across shuffled module-read order; (c) a frozen in-memory mutation corpus derived from the 68 fixtures (none exists today). | TT1 |
| 7 | `packages/compiler/src/parser/**` | (a) 10k-deep `{` / at-rule nesting; (b) unbalanced quote, comment and bracket at **every** depth level; (c) prefix-truncation fuzz today covers one source (`parser.test.ts:1136`) — run it over all 68 fixtures; (d) diagnostic count bounded per nesting depth. | TT1, TT2 |
| 8 | `packages/compiler/src/lexer/**` | (a) BOM `U+FEFF` at offset 0 (`grep -c 'uFEFF'` over `tests/` = 0); (b) lone/unpaired surrogates (`\uD800`, `\uDC00`); (c) a CRLF/LF/CR mixed document — only one `\r\n` whitespace token is tested; (d) 1 MB single token and 100k-line file (max today: 20 000-char runs). | TT1, TT2 |
| 9 | `packages/vscode/src/{groups,keyframes,property-docs,positions}.ts` + editor | (a) `groups.ts` (320 lines) and `keyframes.ts` (436) re-implement compiler resolver rules with no differential test — assert symbol sets match `resolver/{groups,keyframes}.ts` over the shared fixture corpus; (b) completion/hover/rename p50+p95 on a 10k-line file; (c) 1000-file index build measured; (d) keystroke storm replaying A45–A51 documents one character at a time. | TT6 |
| 10 | `scripts/benchmark.ts` | No test at all, and `await main(process.argv.slice(2))` runs on import (`:395`), so it is subprocess-only. (a) `--json` schema stability; (b) fixture bytes identical across two runs; (c) independently re-check the reported "zero error diagnostics" claim; (d) exit code 0 for `--size 100`. | TT2 |

Ranked below the top 10 (real but lower blast radius, or dependency-blocked — see
`.ai/reports/CSSX-TT0.md`): emitter independent-parser validation (needs an owner decision on a
third-party CSS parser), sourcemap decoding at scale, formatter on malformed/large input,
`args.ts` reverse flag order + NDJSON golden, browser 1k-node DOM scenario.

## Planned directory layout

Matching the phase write scopes in `.ai/plans/CSSX-PLAN-TESTING.md`; nothing here exists yet.

| Path | Status | Contents |
|---|---|---|
| `tests/stress/prng.ts`, `tests/stress/corpus.ts` | planned | Hand-rolled seeded PRNG, env/CLI seed plumbing, frozen in-memory fixture mutation corpus |
| `tests/stress/fuzz/` | planned | TT1: `lexer`, `parser`, `compile`, `roundtrip`, `determinism` property suites + `runner.ts` long-run entry |
| `tests/stress/scale/` | planned | TT2: 10k selectors, 1k-deep imports, 500-module graphs, 100k-line file, 1000-file memory ceiling |
| `tests/stress/fs/` | planned | TT3: path/unicode/symlink matrix, planner safety, manifest tamper, interrupted write, watch churn |
| `tests/stress/cli/` | planned | TT4: exit-code matrix, `--json`/NDJSON goldens, `format --check` safety, two-process concurrency |
| `tests/stress/consumer/` | planned | TT5: Node 20/22/24 + Bun import matrix, `.d.ts` literal inference, minify parity, VLQ sourcemap spot-check |
| `tests/stress/editor/` | planned | TT6: 10k-line latency, 1000-file index, keystroke storm, malformed mid-edit, provider/controller re-activation |
| `tests/stress/soak/` | planned | TT7: `XESSA_SOAK=1`-gated watch soak, 20× cold-build identity, 5× flake run |
