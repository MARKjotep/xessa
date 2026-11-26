# CSSX-A11 — CLI, project config, writer, manifest and watcher (P5)

## Summary

- Implement the `xessa` CLI in `packages/cli/src/`: build, check, watch, clean (format accepts and defers to P7), with exit codes 0/1/2 and the full flag set.
- Add `xessa.config.json` loading with schema validation (strict unknown-key rejection) and the project include/exclude glob engine.
- Atomic writes (temp file + rename, per-file), manifest-tracked `clean` (owned + unmodified only), debounced watch with reverse import graph and stale-generation guard; Node smoke test proves runtime compatibility.

## Status

🟢 Complete for this task, including the 2026-11-25 lead corrections and watch-test stabilization.
`bun run verify` exits 0: typecheck (three packages), `biome check .` (292 files), and `bun test`
**501 pass / 0 fail** across 27 files. A11 contributes 44 integration tests (16 build, 21 config,
3 watch, 4 Node smoke); the scaffold suite and A12 additions are untouched.

Documented integration gaps are listed under [Blockers and gaps](#blockers-and-gaps); the lead
corrections resolved the minify-precedence and package-dependency items. No compiler source was
changed.

## Created files

CLI (`packages/cli/src`):

| File | Responsibility |
|---|---|
| `index.ts` | Entry point, command dispatch, `--help`/`--version`, signal wiring; exports `main` and the package API |
| `args.ts` | Strict argument parsing, usage text, command/flag validation |
| `config.ts` | `xessa.config.json` discovery, schema validation, kebab↔camel mapping, workspace-root walk |
| `glob.ts` | Zero-dependency glob matcher (`*`, `**`, `?`, `{a,b}`), exclusion rules, source discovery |
| `project.ts` | Workspace root, config resolution, entry list (project globs vs single file) |
| `setup.ts` | File `@setup` decoding and the effective-setup merge that mirrors the planner |
| `compiler.ts` | Compiler boundary: dynamic barrel import with monorepo fallbacks |
| `compiler-api.d.ts` | Ambient mirror of the public compiler surface used by the CLI (typecheck without `dist`) |
| `writer.ts` | SHA-256 helpers and per-file atomic writes |
| `manifest.ts` | `.xessa-manifest.json` read/write, validation, deterministic ordering |
| `report.ts` | Span→line/column positioning, text output, JSON shapes, invocation failures |
| `paths.ts` | POSIX path helpers |
| `commands/build.ts` | Shared build engine + `xessa build` |
| `commands/check.ts` | Diagnostics-only run |
| `commands/clean.ts` | Manifest-owned deletion |
| `commands/format.ts` | P7 placeholder (`formatting lands in P7`, exit 2) |
| `commands/watch.ts` | Debounced incremental watcher |

Also changed: `packages/cli/tsconfig.json` (`include` now lists `src/**/*.ts` and `src/**/*.d.ts`).
`packages/cli/package.json` was **not** changed (`bin` stays `src/index.ts` as the scaffold test
requires); Node runs `dist/index.js` directly.

Tests and fixtures:

- `tests/integration/cli-helpers.ts` — temp projects, process runners, polling, JSON shapes.
- `tests/integration/cli-build.test.ts` — 15 tests.
- `tests/integration/cli-config.test.ts` — 21 tests (including glob unit tests).
- `tests/integration/cli-watch.test.ts` — 4 tests (skip cleanly without FS events).
- `tests/integration/node-smoke.test.ts` — 4 tests (builds both `dist` packages).
- `tests/fixtures/cli/basic/` — config, `src/button.xessa`, `src/card.xessa`,
  `src/tokens/theme.xessa`, plus byte-stable goldens in `expected/`.
- `tests/fixtures/cli/broken/`, `tests/fixtures/cli/config-unknown-key/`.

## Commands, flags and exit codes

| Command | Behaviour |
|---|---|
| `xessa build [file]` | Project build from config include globs, or a single entry when `file` is given. Writes artifacts and the manifest. |
| `xessa check [file]` | Same planning/compilation and diagnostics, **never writes** artifacts or the manifest. |
| `xessa watch [file]` | Initial build, then incremental rebuilds until SIGINT/SIGTERM; text output or NDJSON with `--json`. |
| `xessa clean` | Deletes only manifest-owned files whose hash still matches; `--dry-run` lists. No file argument. |
| `xessa format [file]` | Accepts arguments, prints `formatting lands in P7`, exits 2. |
| `xessa --help`, `xessa --version` | Usage text / package version (`0.0.0`), exit 0. |

Flags: `--config <path>`, `--json`, `--dry-run`, `--minify`, `--no-minify` (last wins), `-h/--help`,
`-v/--version`. Unknown flags, missing values, duplicate `--config`, extra positionals, unknown
commands and a missing command all exit 2.

| Exit | Meaning |
|---|---|
| 0 | Success (warnings allowed; check with no errors) |
| 1 | Any `error` diagnostic (compiler or output plan), write failure, manifest failure, compiler-load failure |
| 2 | Invocation or configuration error: unknown flag/command, missing source, missing/invalid config, invalid schema, `format` |

**Decision:** a project run (no file argument) without `xessa.config.json` exits 2 with
`No xessa.config.json found…`; there are no include globs to expand. A single-file run is allowed
without config and uses the nearest `package.json` ancestor, else the file's directory, as the
workspace root (ADR-0007).

## Project configuration

`xessa.config.json` is discovered by walking up from the entry file's directory (single-file mode) or
the working directory (project mode); `--config` overrides the walk. The workspace root is the config
directory.

Schema validated keys (`$schema` is allowed and ignored):

- `include`, `exclude`: arrays of non-empty strings. `include` is required for project builds
  (missing or empty → exit 2); it is optional for single-file builds.
- `output`: `cssDir`, `cssName`, `mapDir`, `mapName` (strings) and `emitCss`, `emitMap`, `emitTypes`,
  `sourceMap`, `importCss`, `minify` (booleans). This is the camelCase mirror of the `@setup` keys;
  the full table is in the `config.ts` module JSDoc and repeated here:

  | `@setup` | JSON |
  |---|---|
  | `prefix` | `classes.prefix` |
  | `css-dir` | `output.cssDir` |
  | `css-name` | `output.cssName` |
  | `map-dir` | `output.mapDir` |
  | `map-name` | `output.mapName` |
  | `emit-css` | `output.emitCss` |
  | `emit-map` | `output.emitMap` |
  | `emit-types` | `output.emitTypes` |
  | `source-map` | `output.sourceMap` |
  | `import-css` | `output.importCss` |
  | `minify` | `output.minify` |

  `output.prefix` is not a schema key (it falls under unknown-key handling); class naming lives under
  `classes` so strategy and prefix stay together.
- `classes`: `strategy` (`prefix` | `none`, default `prefix`) and `prefix` (string).
- `media`: string→non-empty-string record merged after built-in aliases.
- `compiler`: `strict` (boolean) and `mediaGrouping` (`safe` | `none`).

Known keys are type-checked always (exit 2). **Unknown keys** are errors in strict mode
(`compiler.strict: true`) with `path.to.key` in the message, and warnings (ignored) otherwise. JSON
parse and top-level-shape failures exit 2 with the file name.

Glob engine (no dependencies): `*` (within a segment), `**` (across segments; `**/` also matches zero
segments, so `src/**/*.xessa` matches `src/button.xessa`), `?` (one non-`/` character), `{a,b}`
alternation with nesting. Character classes are literal. `exclude` also removes descendants of a
matched directory and, for a bare name such as `node_modules`, any path segment with that name.
Discovery only considers `.xessa` files, never walks `.git`/`node_modules`, skips symlinks, starts
from each include pattern's static prefix, and sorts results deterministically.

## Effective setup and the compiler boundary

`CompileResult` exposes artifacts and `dependencies` but no output plan or effective setup. The CLI
therefore rebuilds the same `PlanOutputsInput` the compiler builds internally — defaults, project
`output`, decoded file `@setup`, then `--minify` — using the public `parse` AST and calls the public
`planOutputs` (with `host.canonicalize` and accumulated `occupiedTargets` for cross-entry collisions).
Project-level directories are passed exactly as `compileProject` passes them (directories only), so
the CLI's destinations and the compiler's generated CSS import agree; a test resolves that import
against a real artifact.

Consequences and reported gaps are in [Blockers and gaps](#blockers-and-gaps).

## Writer, manifest and clean

- **Atomic writes:** `writer.atomicWrite` creates the destination directory, writes
  `.‹name›.‹pid›.‹n›.xessa-tmp` in the destination directory, then renames over the target. A failure
  removes the temp file and rethrows; the previous artifact is untouched. SHA-256 is computed from
  the exact UTF-8 bytes.
- **Manifest:** `<workspaceRoot>/.xessa-manifest.json`, fixed location (the strict schema has no
  manifest key), records sorted by path:

  ```json
  { "version": 1,
    "files": [ { "kind": "css", "path": "generated/styles/button.css",
                 "source": "src/button.xessa", "hash": "sha256:…" } ] }
  ```

  Missing/malformed/unsupported manifests are treated as empty with a warning; unsafe (`../`,
  absolute) paths are dropped. Writes are atomic and deterministic (no timestamps).
- **Manifest update:** only successfully written files are recorded. A single-entry build replaces
  records whose `source` is that entry; a fully successful project build prunes every record not
  produced now. Files rewritten in the current run are never treated as obsolete. Obsolete owned
  files are deleted only when their current hash equals the recorded hash; externally modified files
  are kept and ownership is released with a warning. If any entry failed, global pruning is skipped
  and the affected entry's previous records are retained.
- **Clean:** deletes only records whose current hash matches, drops missing files from the manifest,
  and reports `modified` files without deleting them. `--dry-run` reports `would-delete` and writes
  nothing. Empty directories are left in place. Ownership policy: `build` treats configured
  destinations as explicitly authorized and overwrites them, while only `clean` uses ownership; no
  non-manifest file is ever deleted.

## Watch architecture

- Initial full build; then one single-flight loop serializes builds. Events that arrive during a
  build are coalesced into the next cycle.
- Reverse import graph from `CompileResult.dependencies`: each dependency (and each entry itself) maps
  to the entries that must rebuild. A change rebuilds only those entries; a dependency change rebuilds
  every consumer.
- `fs.watch` on: the workspace root, the config directory, the directory of every known source, and
  each include pattern's static prefix. The watcher set is recomputed after each build, so new
  directories join automatically.
- Events are debounced with a 40 ms timer (no fixed sleeps). Every event bumps a generation counter;
  before the first write and before the manifest update a build checks `isCurrent()` and discards a
  stale result (`xessa watch: discarded a stale build generation`) instead of landing old bytes.
- Filtering: only paths ending `.xessa` and the exact config path are considered. Generated CSS, JS,
  declarations, source maps, temp files and the manifest never match, so output writes cannot feed
  back; a test waits for a stable mtime and asserts no extra rebuild.
- Config changes reload the config and rebuild the full entry set. A deleted or unknown path, or any
  unclassifiable event, triggers a full include-glob rediscovery (a deleted entry is therefore pruned
  by the successful project build). Unwatchable directories are skipped and retried on rediscovery.
- Watch accepts `--json`, emitting one NDJSON object per cycle (`{ "type": "build", …report }`).
  SIGINT/SIGTERM abort cleanly and exit 0.

## Tests and acceptance coverage

| Requirement | Test |
|---|---|
| Fixture project (2 sources + token import, `@setup` dirs/names) → byte-stable artifacts | `cli-build.test.ts` compares six artifacts with `expected/` goldens and rebuilds to prove determinism |
| `check` clean / diagnostics / no writes | `cli-build.test.ts` (`--json` asserted `XESSA2001` at `src/broken.xessa:2:10`, line/column) |
| Build error retains last successful outputs | `cli-build.test.ts` compares CSS and manifest bytes |
| Atomic write failure keeps previous artifact | `cli-build.test.ts` chmods the output directory read-only, asserts exit 1, `XESSACLI001`, unchanged bytes (skipped as root) |
| Strict config rejection / invalid JSON / wrong types | `cli-config.test.ts` exit 2 + messages |
| Nearest config / explicit `--config` | `cli-config.test.ts` |
| `--json` shape, `--dry-run` | `cli-build.test.ts` (written flags, reasons, no filesystem changes) |
| `--minify` / `--no-minify` | `cli-build.test.ts` compact bytes, last-flag-wins, and a file `@setup minify` overridden by the CLI flag with a warning |
| Project output directories mirror source subdirectories | `cli-build.test.ts` (`build/styles/src/deep/widget.css`, import `../../../styles/src/deep/widget.css`) |
| Cross-entry target collision | `cli-build.test.ts` → `XESSA5001`, exit 1, first entry's file preserved |
| Clean removes owned only, preserves edited files | `cli-build.test.ts` dry-run and real clean |
| Deleted source prunes obsolete owned outputs | `cli-build.test.ts` |
| Watch source change / config change / deletion / no feedback | `cli-watch.test.ts` (real child process, polling, skipped without FS events) |
| Node compatibility | `node-smoke.test.ts` builds both `dist`s, asserts package `main`/`exports`, runs build/check/clean under plain `node` |
| Glob engine | `cli-config.test.ts` (`**` zero segments, `*`, `?`, `{a,b}` nesting, exclusions) |

## Node/Bun compatibility evidence

- `bun --version` → **1.4.5** (`/Users/marky/.bun/bin/bun`); `bun test` banner reports v1.4.4
  (38afee6c8); `node --version` → **v24.22.3** (>= 20 asserted in the smoke test).
- `tsc -p packages/compiler/tsconfig.json` and `tsc -p packages/cli/tsconfig.json` → exit 0, emitting
  `packages/{compiler,cli}/dist`.
- `node packages/cli/dist/index.js build` in a copied fixture → exit 0, six artifacts and a six-record
  manifest; `check --json` → 0; a broken source → 1; `clean --json` → six removed.
- `bun packages/cli/src/index.ts build` → exit 0 (development path, no compiler build needed).
- Compiler loader order: bare `@xessa/compiler` → `packages/compiler/dist/index.js` → (Bun only)
  `packages/compiler/src/index.ts`. The last candidate is the compiler's public barrel file, used for
  development/tests; the CLI never imports compiler internals.
- Manifest: `node --input-type=module` imports the built compiler and verifies `compile`,
  `compileProject`, `planOutputs`, `createNodeHost` and `parse` are functions.

## Blockers and gaps

1. **No plan or effective setup on `CompileResult`.** The CLI re-derives setup from the public
   `parse` AST and calls `planOutputs`; the merge mirrors `.ai/reports/CSSX-A10.md`. A public
   `resolveSetup`/plan field would remove the duplication. Reported, not worked around with internals.
2. **`compileProject` drops `include` when planning project directories.** It passes only
   `{ output: { cssDir, mapDir } }`, so project-level destinations mirror the workspace-relative
   source directory (`build/styles/src/…`) instead of the include-relative subtree. The CLI matches
   the compiler exactly so the generated CSS import stays correct; both the mirroring test and goldens
   pin this. Fixing it belongs to the compiler (pass `include` through) and would change expected paths
   in one test.
3. **Compiler project API still has no CLI precedence layer (mitigated).** The CLI now applies
   `--minify`/`--no-minify` over a file `@setup minify` by recompiling only the conflicting entries
   through the public `compile` API (see
   [Lead corrections](#lead-corrections-2026-11-25)). A first-class CLI layer in
   `CompileProjectOptions` would remove that second compile.
4. **CSS source maps are planned but not emitted until P7.** When `sourceMap` is enabled the planner
   reserves `*.css.map`; `CompileResult.sourceMap` is `undefined`, so the CLI skips it with a warning
   (`CSS source maps land in P7`). Exit code stays 0.
5. **Package resolution.** `packages/cli/package.json` now declares
   `"@xessa/compiler": "workspace:*"`, so installs resolve the compiler without the fallback; the
   loader keeps the bare → `dist` → Bun-`src` chain for development. Published builds must still
   build the compiler `dist` before the CLI. The repository `bun.lock` needs one `bun install` to
   record the new workspace dependency edge (outside this follow-up's file scope).
6. **Manifest location is fixed** at `<workspaceRoot>/.xessa-manifest.json` because the config schema is
   strict and has no manifest key. A per-project configurable location needs a schema decision.
7. **Exotic `@setup` string escapes.** The CLI decodes simple `\x` escapes for planning while the
   compiler uses full CSS unescaping; a path authored with hex escapes could plan differently. Only
   simple escapes are supported in the mirror.
8. **Ownership on build.** `build` overwrites configured destination paths even if they were not
   previously manifest-owned (treated as explicit authorization by configuration); `clean` never
   touches non-manifest files. A stricter no-clobber policy needs an opt-in flag.
9. **Watch directory coverage.** `fs.watch` is non-recursive (portable); coverage comes from the
   source directories plus include static prefixes and is refreshed each build. A brand-new deep
   directory is picked up through its parent's event, not a recursive subscription.

No framework bug/feature record was created: this task contains no framework defect or feature
request, and `.ai/framework/` is absent. No framework dependencies or upstream repositories were
modified.

## Lead corrections (2026-11-25)

Two follow-ups from lead review were applied after the initial acceptance.

### 1. CLI minify flags now win over file `@setup minify`

SPECIFICATION.md §9.1 makes explicit CLI overrides the highest precedence layer. The compiler's
`CompileProjectOptions` has no CLI layer, so `--minify` used to lose to a conflicting file
`@setup minify` (the CLI only warned). The CLI now applies the override:

- Entries whose file `@setup` authors a conflicting `minify` value are recompiled with the public
  `compile` entry point, whose API output options override file setup, using the entry's resolved
  prefix plus project media and media grouping; only its CSS text is taken. Class maps, declarations,
  plans, dependencies and manifest records stay with the shared `compileProject` run, so destinations
  and generated CSS imports do not change.
- The informational warning is kept, now as
  `src/button.xessa: setup minify false overridden by CLI flag (--minify).`, with the `--no-minify`
  equivalent.
- `cli-build.test.ts` adds “a CLI minify flag overrides a file @setup minify with a warning”: with
  `minify: false` authored, `build --minify` writes compact CSS; with `minify: true` authored,
  `build --no-minify` writes CSS byte-identical to the pretty golden. The warning is asserted in both
  directions.

Remaining compiler-side follow-up: a CLI-precedence layer in `CompileProjectOptions` would remove the
second compile, which is only paid for conflicting entries.

### 2. Workspace dependency declared

`packages/cli/package.json` now declares `"dependencies": { "@xessa/compiler": "workspace:*" }` (Bun
workspace protocol), so installed/published CLI packages resolve the compiler without the loader
fallback. The loader chain is unchanged: bare `@xessa/compiler` → `packages/compiler/dist` →
(Bun only) the compiler `src` barrel for development.

A fresh `bun install` in a scratch copy of the repository added exactly this workspace dependency edge
to `bun.lock`; Bun links workspace packages as workspace dependencies rather than root
`node_modules` symlinks. The repository `bun.lock` was outside this follow-up's allowed file scope, so
the lead should run `bun install` once to capture the edge. The ambient compiler type mirror keeps
`bun run typecheck` working without a built `dist`.

### Verification after the corrections

- `bun run verify` → exit 0; typecheck clear; `biome check .` → 285 files; `bun test` → **473 pass,
  0 fail**, 25 files.
- Node smoke rerun under plain `node` v24.22.3 after `tsc` builds of `packages/compiler` and
  `packages/cli`: `node packages/cli/dist/index.js build` → exit 0 with six artifacts; `check` → 0;
  a broken source → 1; `build --minify` with `@setup minify: false` → compact CSS plus the warning;
  `build --no-minify` with `@setup minify: true` → expanded CSS.
- CLI integration suite → **45 pass, 0 fail**, 240 expectations.

## Watch-test stabilization (2026-11-25)

A12 landed and full-suite parallelism occasionally reproduced two different
`cli-watch.test.ts` failures that passed standalone. The suite is now event-driven and isolated; no
fixed sleeps are used for correctness.

### Mechanism

1. **Isolation.** Each watch test writes a purpose-built project into a fresh `mkdtemp` directory
   (`createWatchProject`) instead of copying the shared `tests/fixtures/cli/**` tree. The tests never
   touch repository fixtures, so parallel builds, copied `expected/` goldens or leftover generated
   files cannot influence their inputs, and their FS events cannot collide with another project.
   Directories are still removed in `afterEach`.
2. **Readiness handshake.** `xessa watch --json` now emits
   `{"type":"watch","ready":true,"sources":N,"debounceMs":40}` only after the initial build completes
   **and** the OS watchers are attached. Previously the first text line was printed before
   `syncWatchers()`, so a test could edit a file before the watcher existed — the root cause of the
   intermittent timeouts. Build events are now also emitted after watchers are refreshed.
3. **True NDJSON.** Watch JSON output was accidentally pretty-printed across multiple lines while the
   report documented NDJSON. `watch.ts` now writes one compact JSON object per line for both the
   `build` and `watch` events, so the test harness parses the stream incrementally instead of guessing.
4. **Bounded, named awaits.** The harness exposes `awaitReady()` and `nextBuild(label)`, each bounded
   at 10 s (30 s per test) and failing with the await label, the event types seen so far and the
   stderr tail. Tests await the emitted build event — which is written after artifacts and the
   manifest are settled — rather than polling mtimes or sleeping.
5. **No shared-mtime heuristics.** The old no-feedback test used a 500 ms quiet window; it was folded
   into the source-change test: a write to a generated CSS output is issued immediately before a real
   source edit, so an ignored-output regression surfaces deterministically as an unexpected full
   rebuild ahead of the incremental build (2 entries instead of 1) rather than as a timing race.
6. **Debounce constant.** `WATCH_DEBOUNCE_MS = 40` is exported from `commands/watch.ts` and reported
   in the ready event, so tests can reason about event coalescing. Tests in the file run sequentially
   and each completes its awaited effect and stops its child before the next starts.

### Evidence

- `bun test tests/integration` → three consecutive runs, each **48 pass, 0 fail**, 266 expectations
  (5 files: scaffold, build, config, watch, node smoke).
- `bun run verify` → **exit 0**; `bun test` **501 pass, 0 fail** across 27 files (the workspace now
  includes A12 additions); `biome check .` 292 files.
- Plain-Node smoke re-run: `node packages/cli/dist/index.js build` → 0, `check` → 0 (node v24.22.3);
  `node-smoke.test.ts` → 4 pass / 0 fail.

## Evidence

- `bun run verify` → exit 0; `biome check .` → 285 files, no fixes; `bun test` → **473 pass, 0 fail**,
  25 files.
- CLI integration suite alone → **45 pass, 0 fail**, 240 expectations.
- `node-smoke.test.ts` → 4 pass, 0 fail; `cli-watch.test.ts` → 4 pass on repeated runs.
- Manual atomicity run: read-only output directory → exit 1, prior CSS hash unchanged.
- Manual retention run: broken source → exit 1, prior CSS and manifest byte-identical.
- See `.ai/reports/logs/CSSX-A11.log` for the command log.

## Handoff

- The lead should independently run `bun run verify` and then flip the P5 · A11 row in
  `.ai/PROGRESS.md` (not touched by this worker).
- Run `bun install` once to record the new `@xessa/compiler` workspace dependency edge in `bun.lock`
  (outside this follow-up's allowed files).
- Release/packaging (P7/A15): build the compiler before the CLI, and document `node dist/index.js`
  (the `bin` stays Bun-native by scaffold contract).
- Compiler follow-up candidates: expose the output plan/effective setup on `CompileResult`, pass
  `include` into project planning, and add a CLI precedence layer to `compileProject`.
- P7 owns CSS source-map text and `xessa format`; the CLI already reserves/skips source-map artifacts
  and returns exit 2 from `format`.
