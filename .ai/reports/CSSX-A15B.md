# CSSX-A15B — Phase 7: docs, benchmarks and release readiness

## Summary

- Write the real documentation: full README, `docs/grammar`, `docs/cascade` (with browser-evidence
  pointers), `docs/configuration`, compatibility matrix, known limitations, and fill the five
  `examples/` directories with working, buildable examples.
- Run the masterplan §9 benchmarks (100 and 1,000 files: cold build, incremental build, memory) with
  a repeatable script and record honest numbers in `docs/performance.md` — measure, do not promise.
- Release readiness: `CHANGELOG.md`, `LICENSE` (MIT, root), package metadata validation,
  `npm pack --dry-run` tarball checks for compiler+cli, `@vscode/vsce` package for the extension, a
  `bun run release:check` aggregate script, and the `@vscode/test-electron` framework record under
  `.ai/framework/`.

**Status:** 🟢 Complete for this task's scope. `bun run verify` exit 0 (573 pass / 0 fail, 35 files);
`bun run release:check` exit 0 end to end with two documented blockers for package owners (vsce
manifest name; tarball README/LICENSE). `.ai/PROGRESS.md` untouched.

## Created / changed files

Documentation and release:

| File | Contents |
|---|---|
| `README.md` | Rewritten: one-paragraph description, canonical example, install, quick start, output table, CLI commands/flags/exit codes, extension summary, quality gates, repo layout, docs index, license. |
| `CHANGELOG.md` | 0.1.0 feature list by language/compiler/CLI/extension/verification/docs, with known issues. |
| `LICENSE` | MIT, Copyright © 2026 Marky. |
| `docs/grammar.md` | Full EBNF, lexical rules (`@` recognition, strings, escapes, semicolons), directives, declarations, nesting, media syntax, D1–D3 inline. |
| `docs/cascade.md` | Cascade contract in full with worked examples (base-then-variant, later-base-overrides-conditional, `!important` per segment, safe grouping vs `none`, flush boundaries), explicit non-promises, browser-evidence table/instructions. |
| `docs/configuration.md` | Every `@setup` and `xessa.config.json` key with defaults, precedence, kebab↔camel mapping, path/name rules, emit-flag consistency, source maps, safety/manifest/write policy, CLI flags. |
| `docs/compatibility.md` | Feature matrix (language, native at-rules, tooling), tested evidence, every v0.1 gap/deferral. |
| `docs/performance.md` | Measured §9 benchmarks, machine context, target status, caveats. |
| `docs/known-limitations.md` | Operational gaps (editor formatting/intelligence, rename, release/packaging, output paths, watch, language limits, platform). |
| `docs/release.md` | Aggregate gate, manual release steps, exact vsce blocker, tarball contents, framework note, rollback. |
| `docs/{grammar,cascade,configuration}/README.md` | Replaced stale placeholders with pointers to the new pages. |
| `packages/vscode/package.json` | Added vsce-required `repository`, `homepage`, `bugs` (publisher `xessa` and `license: MIT` already present). Scripts/dependencies untouched. |
| `packages/vscode/CHANGELOG.md` | Short 0.1.0 extension changelog. |
| `packages/vscode/README.md` | Rewritten as user-facing extension documentation (features, settings, build/test, scopes, gaps); task-phase language removed. |
| `package.json` | Added `benchmark` and `release:check` scripts only. |
| `.gitignore` | Re-includes `examples/**/generated/**` for committed outputs; ignores `.xessa-manifest.json` and `*.vsix`. |
| `scripts/benchmark.ts` | Deterministic 100/1,000-file generator and five-run benchmark harness (child process per size for peak RSS). |
| `.ai/framework/vscode-test-electron/bugs/macos-electron-launcher-missing.md` | Framework record with exact verified versions, reproduction, expected/actual, evidence, workaround, status. |
| `.ai/tasks/CSSX-A15B.md`, `.ai/reports/CSSX-A15B.md`, `.ai/reports/logs/CSSX-A15B.log` | Task, report, worker log. |

Examples (sources + READMEs + committed CLI output):

| Example | Output |
|---|---|
| `basic` | `generated/styles/button.css`, `generated/maps/button.map.js`, `.d.ts` |
| `responsive` | `card.css` with `@md`/`@xl`/`@dark`/`@xl+dark`/`@compact` and rule-scoped blocks |
| `variables` | imported + local tokens and runtime `--ui-*` custom properties |
| `jsx` | camelCase/quoted class map + `Button.tsx` usage |
| `custom-output` | `theme.css` + `theme.css.map`, `classes.js/.d.ts`, CSS-disabled `plain.js/.d.ts` |

## Documentation decisions

- **Honest scope.** The compatibility matrix separates tested support from deferrals and states that
  Xessa does not claim full CSS compatibility. Every gap from SPECIFICATION §13 and the A05/A11/A13
  reports is listed.
- **Cascade is described, not promised.** `docs/cascade.md` shows a later base overriding an earlier
  conditional, states "no reordering promises", no global bottom grouping, no ordered-media mode and
  no cascade repair.
- **Project output path gap is documented.** With `include: ["src/**/*.xessa"]`, project
  `output.cssDir` mirrors the workspace-relative source (`dist/styles/src/deep/widget.css`). This was
  verified with a scratch project and recorded in configuration/known-limitations.
- **Source maps and formatter were landed by the concurrent P7 worker while this task ran.** Docs
  were updated to the observed end state: `xessa format [file] [--check]` is implemented, and
  `source-map: true` writes a v3 map end to end (verified with a rebuilt compiler `dist` and the
  `custom-output` example).
- **Framework record versions** were verified from
  `packages/vscode/node_modules/@vscode/test-electron/package.json` (`2.5.2`) and the cached
  `vscode-darwin-arm64-1.147.0` build (only `Contents/MacOS/Code` exists).

## Benchmark results

`bun run benchmark`, Apple M1 Pro / 16 GB, macOS 27.3 (Darwin 27.3.0) arm64, Bun 1.4.5 (bundled Node
compat 26.3.0), measured 2026-11-24T20:02Z. Five runs each; medians shown.

| Metric | 100 files | 1,000 files |
|---|---|---|
| Cold project build (no writes) | 63.57 ms (59.48–88.07) | 557.41 ms (539.54–681.21) |
| Single-file `compile()` incl. its imports | 2.24 ms (2.19–2.49) | 2.12 ms (2.00–3.27) |
| `parse()` proxy (in-memory) | 0.032 ms (0.024–0.056) | 0.033 ms (0.025–0.044) |
| RSS / heap after build | 59.5 / 12.8 MB | 109.0 / 22.6 MB |
| Peak RSS (baseline → after build) | 18.6 → 61.3 MB | 18.0 → 115.1 MB |
| Artifacts / error diagnostics | 126,186 B / 0 | 1,262,874 B / 0 |

§9 targets: single-file incremental under 100 ms excluding filesystem overhead — **met** (2.1–2.2 ms,
including its 11-module import reads). Completion under 100 ms for cached files — **met by the parse
proxy only**; the full editor analysis and provider path is not benchmarked, and this is stated in
`docs/performance.md` rather than claimed as completion latency.

## Release-check results

`bun run release:check` (exit 0):

| Step | Result |
|---|---|
| `bun run verify` | exit 0 — typecheck, Biome (353 files), **573 pass / 0 fail**, 35 files |
| `bun run test:browser` | **75 passed** (25 each Chromium/Firefox/WebKit) |
| compiler/cli `tsc` builds | exit 0 |
| package metadata validation | compiler, cli and vscode manifests valid (name/version/license/main/types/exports/files/publisher/engines/repository/homepage/bugs/language contribution) |
| `npm pack --dry-run` compiler | 277 files; `package.json` + `dist/**`; **README.md and LICENSE absent** |
| `npm pack --dry-run` cli | 87 files; `package.json` + `dist/**` + `src/**`; **README.md and LICENSE absent** |
| example builds | 5/5, 3/3/3/3/6 files, 0 warnings |
| `vsce package` | **blocked** — `Invalid extension "name": "@xessa/vscode"` |

One earlier release-check run failed on a `cli-watch` 10 s timeout while a concurrent worker was
compiling; the immediate `bun run verify` rerun and the final release-check run were green. Recorded
as a load-related flake, not a change from this task.

## Blockers / deviations

1. **vsce manifest name (documented blocker).** `@vscode/vsce` requires an unscoped lowercase
   `name` (`xessa`). `packages/vscode/package.json` still uses `@xessa/vscode`, pinned by a scaffold
   test, and changing it is outside this task's allowed metadata fields. `release:check` reports the
   exact error and continues; `docs/release.md` gives the fix.
2. **Tarballs lack README/LICENSE.** Root `README.md`/`LICENSE` now exist, but npm does not copy them
   into workspace-package tarballs, and package-level copies are outside the allowed file scope
   (`packages/compiler/**`, `packages/cli/**` are owned by other workers). The tarball assertion
   therefore enforces `package.json` + `dist/**` and reports the absent docs explicitly in
   `release:check`, `docs/release.md` and `docs/known-limitations.md`.
3. **Versions remain `0.0.0`.** Package manifests cannot be version-bumped in this scope; the release
   owner must bump compiler/cli/extension before publishing 0.1.0.
4. **Repository URLs are placeholders.** No git remote exists in the workspace; the extension
   manifest points at `https://github.com/xessa/xessa` and `docs/release.md` says to confirm it.
5. **Benchmark environment is Bun on Apple Silicon.** Node numbers were not measured; Node is covered
   for correctness by the smoke tests only.

## Validation commands run

```sh
bun run verify                                  # 573 pass / 0 fail -> see log
bun run release:check                           # exit 0, sub-results above
bun run benchmark                               # numbers above
bun scripts/benchmark.ts --json
bun packages/cli/src/index.ts build --config examples/<name>/xessa.config.json  # x5
bunx biome check .                              # 353 files, clean
git check-ignore examples/basic/.xessa-manifest.json  # ignored
```

## Handoff

- Completed: documentation set, five buildable examples with committed output, benchmark harness and
  measured numbers, root changelog/license, extension metadata/changelog/README, framework record,
  aggregate `release:check`.
- Remaining for the release owner: fix the extension manifest name (and its scaffold test), add
  package-level README/LICENSE, bump versions, confirm repository URLs, then publish.
- `.ai/PROGRESS.md` was not touched; the lead flips statuses after independent verification.
- Touched files are limited to this task's allowed scope (plus the `.gitignore` re-inclusion needed
  for committed example output, documented above).
