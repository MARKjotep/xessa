# CSSX-DOC — Xessa framework handover reference

## Summary

- Write `.ai/framework/xessa/FRAMEWORK.md`: the single complete handover reference for the xessa language, compiler pipeline, diagnostics, invariants, gates and bug-fixing protocol.
- Add a discovery pointer in `.ai/agents/AGENTS.md` so every agent session finds it first.
- Everything factual cross-checked against the actual code; no invented behavior.

**Status:** 🟢 complete. `bun run verify` exit 0 (typecheck 4 projects, Biome 364 files,
**612 pass / 0 fail** across 37 test files). Doc-only change; no source, test, golden or config file
was touched. `.ai/PROGRESS.md` untouched (lead flips status).

## Delivered files

| File | Change |
|---|---|
| `.ai/framework/xessa/FRAMEWORK.md` | **New** 400-line reference with all 11 required sections: identity, repository map, exact compile pipeline, frozen-contract rule, language semantics digest (setup/imports/media/cascade/variables/runtime/selectors/naming/outputs), diagnostics registry with producers, invariants, gates and commands, bug-fix protocol, documentation index (14 ADRs), current state. |
| `.ai/agents/AGENTS.md` | Appended a 6-line "Start here" pointer (heading + 4 wrapped lines) linking `../framework/xessa/FRAMEWORK.md`. No other content changed. |
| `.ai/tasks/CSSX-DOC.md` | Task record (summary, scope, acceptance, verification notes). |
| `.ai/reports/CSSX-DOC.md` | This report. |
| `.ai/reports/logs/CSSX-DOC.log` | Worker log. |

No framework bug/feature record was created: no external framework defect or feature request
surfaced, and the one existing record (`.ai/framework/vscode-test-electron/`) already documents its
exact installed version. The reference now states the mandatory version rule for future records.

## Verification evidence

| Check | Result |
|---|---|
| `bun run typecheck` | 4 projects (compiler, cli, language-service, vscode) clean. |
| `bun run lint` | `Checked 364 files in 148ms. No fixes applied.` (Biome ignores `.ai` and `docs`). |
| `bun test` | **612 pass / 0 fail**, 788150 assertions, 37 files (incl. extension host and Node smoke). |
| `bun run verify` | exit **0**. |
| Browser gate | Not rerun (no CSS output changed). Documented evidence: 75 passed = 25 × Chromium/Firefox/WebKit (`docs/cascade.md` §5). |
| Fact checks | Ran ad-hoc compiles against the real barrel to confirm XESSA1001/1002/2001/3001/5001 behavior, minify bytes, prefixing/`:global`, flatten rejection, and setup duplicate handling. No temp file was added to the repo. |

## Prompt-vs-code corrections (all found while verifying)

| # | Prompt said | Code says |
|---|---|---|
| 1 | Pipeline `substitute → emitRuntimeTokens → renameClasses → groupRuns → flattenIr → emitCss → planOutputs → generateClassMap`. | Actual `compileEntry`: per style module `lower → substitute → renameClasses`; entry `lower → substitute → renameClasses`; `mergeClassTables`; `emitRuntimeTokens`; `groupRuns(mediaGrouping ?? "safe")`; `flattenIr`; **`planOutputs`**; **`emitCss`**; `generateClassMap`. Runtime tokens are emitted **after** class rewriting, and planning happens **before** emission because the source-map comment needs the planned CSS basename. |
| 2 | A `host` module facade like the others. | There is no `host/index.ts`; only `packages/compiler/src/host/node.ts` exporting `createNodeHost` (the only `node:fs` import in the compiler). |
| 3 | CLI "17 modules: build/check/watch/clean/format, config, glob, writer, manifest". | 17 `.ts` modules **plus** `compiler-api.d.ts`: `args`, `compiler` (loader), `config`, `formatter` (loader), `glob`, `index` (`main`, exit codes), `manifest`, `paths`, `project`, `report`, `setup`, `writer`, and `commands/{build,check,clean,format,watch}`. |
| 4 | Setup keys include "media overrides". | `SETUP_KEYS` has exactly 12 keys and **no media key**. Media layers are project `CompileOptions.media` and file `@media-types` (ADR-0006). |
| 5 | "CLI/extension import ONLY the public barrel". | True for the CLI (loader tries `@xessa/compiler`, then `dist`, then `src` under Bun). The extension imports the barrel **source path** `../../compiler/src/index.js` (its `tsconfig` compiles `../compiler/src` into `dist/compiler`), in 4 files. |
| 6 | "`parseTokens` (barreled as `parse`)". | `parseTokens` is not exported from the barrel; public `parse()` wraps `tokenize` + `parseTokens`. |
| 7 | The one approved frozen addition is `UseImport.styles?: boolean`. | Correct. But the other additive fields (`RuleIr.ancestors`, `NativeBlockIr.statement`) are in `ir/types.ts`, **outside** the frozen `types/**` set — clarified in the doc. |
| 8 | "Goldens regenerate deliberately + review". | No regeneration script exists. Expectations are updated by hand and reviewed; empty-output error fixtures carry `/* no css: see expected/diagnostics.json */`. |
| 9 | "600+ tests". | 612 pass / 37 files (exact). |
| 10 | "48+ golden fixtures + modules group". | 48 `input.cssx` goldens in 12 groups; `tests/fixtures/cli` holds project fixtures (no `input.cssx`); `modules/merge` holds 7 goldens that use `entry.cssx` because the single-file runner compiles `input.cssx` without a module graph. |
| 11 | Diagnostics are `XESSA####`. | Compiler diagnostics are. The CLI adds `XESSACLI001` (write failure) and `XESSACLI002` (source read failure). |
| 12 | — | `CompileOptions.strict` is declared but never consulted in `packages/compiler/src`; strict unknown-key rejection is CLI `config.ts` behavior. Noted in the doc's diagnostic routing. |
| 13 | "XESSA1001 includes unknown setup keys, duplicates". | Produced by `decodeSetup` in `index.ts`, not the parser; the parser is tolerant. The CLI planner's `decodeFileSetup` also keeps the first duplicate silently. Documented. |
| 14 | `groupRuns` implied directly after lowering. | It runs after runtime emission and class rewriting (`compileEntry`), over a merged IR. Documented. |
| 15 | "source maps via A15a". | A15a is a task id; the module is `packages/compiler/src/sourcemaps/`. |
| 16 | "minify differs from pretty ONLY in structural whitespace". | Confirmed, including removal of the trailing newline; values/selectors/order are byte-identical. |
| 17 | "compile() injects createNodeHost". | Confirmed; root defaults to `process.cwd()` **at call time**, so pass `workspaceRoot` for stability. |
| 18 | Own draft (caught during verification): XESSA1001 from `naming/rewrite.ts` for malformed selectors. | `naming/` leaves the selector untouched; `flattenIr` and the emitter report XESSA1001. The row was removed before finalizing. |
| 19 | Own draft: `safe` grouping matched an "anchor". | It matches selector, **ancestors**, condition and native context. Corrected. |

## Documentation drift found (read-only; not edited)

1. `docs/grammar.md` §2 EBNF (`use = "@use" string [ "as" identifier ] ";"`) and §3 ("`@use` imports
   **tokens** only; stylesheet rules are never imported") are stale relative to ADR-0014,
   `SPECIFICATION.md` §3.2/§6.3 and the implementation (`UseImport.styles`). Recommended follow-up:
   add `[ "styles" ]` to the EBNF and the merge rule.
2. `docs/compatibility.md` likewise describes `@use` as token-only and does not list
   `@use ... styles`.
3. `.ai/plans/CSSX-PLAN.md` still says "ADR-0001–ADR-0010" and "Status: P0 in progress" while 14 ADRs
   exist and P0–P7/A16 are 🟢 in `.ai/PROGRESS.md`.
4. `.ai/PROGRESS.md` lists A16 but not the A14/A15 sub-tasks separately; acceptable as-is.

These are documentation-only; the code is correct. `FRAMEWORK.md` records 1–2 explicitly so no agent
"fixes" the code to match stale prose.

## Blockers

None. No source change was needed, so no correction attempts were used. Framework-record rule
(exact version from package metadata/lockfile, else `unknown` + reason) is now part of the bug-fix
protocol in §9 of the reference.

## Handoff

- Read `.ai/framework/xessa/FRAMEWORK.md` before any Xessa task; use §9 for routing and §7 for the
  safety constitution.
- Lead: flip `.ai/PROGRESS.md` after verifying this report; optionally schedule the
  `docs/grammar.md` / `docs/compatibility.md` drift fix (owner: a doc task, not `code`).

## Drift fixes (lead-directed)

Follow-up after the lead verified and committed `FRAMEWORK.md`. Exactly three doc files changed; the
"not edited" drift list above is superseded for items 1–3:

| File | Change |
|---|---|
| `docs/grammar.md` | EBNF `use` now includes `[ "styles" ]`; the directives table row and the "imports tokens only" paragraph now state ADR-0014 semantics (token-only default, `styles` merges rules with the module's own prefix, imported-first order, one merged map, `XESSA4001` conflicts, `module: true` suppression, no transitive/network import). |
| `docs/compatibility.md` | `@use` row no longer says "tokens only"; new "Rule-merge imports (`@use … styles`)" ✅ Supported row with the one-line semantics and merge-suite evidence. Source maps now state declaration-level mappings (one per emitted selector and declaration, `sourcesContent`, comment); formatter row states `xessa format` + `--check`/`--dry-run`, idempotence and the unchanged-on-parse-error guarantee, with the formatter unit suite added. |
| `.ai/plans/CSSX-PLAN.md` | Header now cites ADR-0001–0014; status now "P0–P7 complete (🟢), including A16 rule-merge imports" with per-task verification pointing at `.ai/PROGRESS.md`. |

Validation after the fixes: `bun run verify` **exit 0** — 4 typecheck projects, Biome 364 files,
612 pass / 0 fail across 37 files. No code, test, golden or config file was touched.
