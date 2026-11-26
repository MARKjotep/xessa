# CSSX-A10 — Output planner (P4)

## Summary

- Implement the pure output planner in `packages/compiler/src/output/`: resolve every artifact destination from setup/config/CLI inputs per SPECIFICATION.md, with full validation (overlap, duplicate targets, traversal, symlink escapes, extension rules) before anything is written.
- Compute the CSS side-effect import path relative to the JS map directory (forward slashes, `./` when needed) and the manifest entries for watch/clean ownership.
- Cover every acceptance case listed in the spec as unit tests with an in-memory host; the planner never writes.

## Status

🟢 Complete for this task. `bun run verify` exits 0 with the full workspace (423 tests). A09 was
editing naming/mapgen files concurrently during development, but those files settled and the final
verify is green. The barrel was intentionally left untouched, so `planOutputs` remains a stub in
`packages/compiler/src/index.ts` until the lead wires it; `contract.test.ts` still passes.

## Created files

- `packages/compiler/src/output/index.ts` — public facade and planning pipeline.
- `packages/compiler/src/output/resolve.ts` — precedence merge, source probing, directory/name
  resolution and project subdirectory mirroring.
- `packages/compiler/src/output/paths.ts` — pure POSIX/drive-letter path normalization, joining,
  relative paths and containment.
- `packages/compiler/src/output/importPath.ts` — relative CSS import specifier plus JS string-literal
  escaping.
- `packages/compiler/src/output/validate.ts` — name rules, duplicate targets, overlap, workspace and
  symlink containment, suppressed-types warning.
- `packages/compiler/src/output/manifest.ts` — deterministic manifest entries.
- `tests/compiler/output.test.ts` — every §9.3 acceptance case (26 tests).
- `tests/compiler/planner.test.ts` — precedence, project configuration, safety boundaries, path and
  import helpers (16 tests).
- `.ai/tasks/CSSX-A10.md`, `.ai/reports/CSSX-A10.md`, `.ai/reports/logs/CSSX-A10.log`.

No frozen type, barrel, fixture, doc or config file was modified.

## Public API

```ts
planOutputs(input: PlanOutputsInput, context?: OutputPlannerContext): PlanOutputsResult
```

`context` is additive and optional; the one-argument call still satisfies the frozen `PlanOutputs`
type:

```ts
interface OutputPlannerContext {
  readonly host?: OutputPlannerHost;        // canonicalize(path): string
  readonly occupiedTargets?: readonly string[]; // prior entries' targets
}
```

`planOutputs` is synchronous, deterministic, free of `node:fs`/`node:path`, and never writes. Any
error produces an empty plan plus XESSA5001 diagnostics so a caller cannot write a partial plan;
warnings leave the valid plan intact.

## Resolution and precedence implementation

Layer application is explicit and deterministic:

| Layer | Directory base | Filename | Flags |
|---|---|---|---|
| Built-in defaults | source directory, exact | `<stem>.css`, `<stem>.map.js` | §9 defaults |
| Project config (`projectConfig.output`) | workspace root + mirrored source subdirectory | as authored | as authored |
| File `@setup` (`input.setup`) | source directory, exact | as authored | as authored |
| Explicit CLI (`cliOverrides`) | workspace root, exact (absolute respected) | as authored | as authored |

- **Defaults:** artifacts sit beside the source; the CSS import is `./<stem>.css`.
- **Project mirroring:** a project directory resolves against the workspace root and appends the
  source's subdirectory relative to the source root inferred from the common static prefix of
  `projectConfig.include` (for example `src/**/*.xessa` → `<ws>/src`). This yields
  `dist/styles/pages/dashboard.css` for `src/pages/dashboard.xessa`. When include has no common
  prefix, or the source is outside it, the mirror falls back to the workspace-relative source
  directory.
- **File directories are exact:** no mirrored subtree is appended.
- **Independent overrides:** directory-only keeps the default name; name-only keeps the effective
  directory; both compose. `classes.js` derives `classes.d.ts`; `theme.css` with source maps reserves
  `theme.css.map`.
- **CLI paths:** explicit and single-entry only (masterplan §7). A relative CLI directory resolves
  against the workspace root because the pure API has no working directory; an absolute CLI
  directory is honored but still containment-checked.
- **Emit consistency:** `emit-css: false` with `import-css: true` is XESSA5001. `emit-map: false`
  suppresses types with a XESSA5001 warning unless types were explicitly false. Source maps are
  never planned when CSS is disabled.

### Frozen-shape ambiguity in the precedence merge

`ResolvedSetup` is `Required<OutputOptions>` and its documentation calls it “effective after
merging … project configuration, file `@setup` and explicit CLI overrides”, but it carries no
provenance for whether each value was authored or copied from a default. `PlanOutputsInput` also
carries `projectConfig` separately. The planner therefore uses these rules:

1. Apply project values first.
2. Apply a file-layer directory only when it is not the built-in default for this source (`.`, empty,
   the workspace-relative source directory, an absolute source directory, or any form that resolves
   to the source directory). If the authored file value equals the authored project value, project
   provenance is retained so the workspace-root base and mirroring still apply.
3. Apply a file-layer filename only when it differs from `<stem>.css` / `<stem>.map.js`.
4. Apply a file-layer boolean only when it differs from its built-in default.
5. Apply every defined CLI override last.

Consequences, recorded as a contract gap rather than silently guessed:

- A file explicitly setting a boolean back to its default (`true` for `emit-*`/`import-css`, `false`
  for `source-map`/`minify`) cannot override a non-default project value. Example: project
  `emitMap: false` plus file `emitMap: true` is read as “file left it at the default”, so project
  wins.
- A file explicitly choosing the same directory string as the project is treated as project-level
  (workspace-root base, mirrored), not source-relative.
- A file explicitly setting a default filename cannot override a project filename.

These cases need an explicit per-key provenance field (for example `fileSetupKeys` or an explicit
`undefined`-able file layer) before they can be resolved exactly.

## Safety validation

All checks run before the plan is returned:

- **Names:** basenames only; `/`, `\`, `.`/`..`, NUL and wrong extensions are XESSA5001. Spaces and
  quotes are legal; quotes are escaped in the import literal.
- **Workspace escape:** absolute destinations must remain under `workspaceRoot`; `..` climbing out is
  rejected.
- **Symlink escape:** `host.canonicalize` is applied to both the workspace root and each destination;
  a canonical path outside the canonical root is XESSA5001. A throwing host becomes XESSA5001, not an
  exception. The default host is lexical identity.
- **Input/output overlap:** an artifact equal to the current source path is XESSA5001.
- **Duplicate targets:** two planned artifacts with the same absolute destination are XESSA5001.
- **Cross-entry collision:** `occupiedTargets` from earlier plans is compared by absolute path and
  reported as XESSA5001, enabling the “two sources → same target” acceptance case without adding a
  frozen field.
- **External output:** always rejected; the frozen contracts carry no `trustedPolicy` flag, so no
  escape hatch exists (ADR-0007).

## CSS import and manifest

- The import specifier is computed from `dirname(mapArtifact)` to the CSS artifact. Same directory
  yields `./button.css`; sibling directories yield `../styles/button.css`; nested relative paths
  retain their subdirectories. Backslashes never appear.
- The returned specifier is ready to place between double quotes: `\`, `"`, control characters and
  U+2028/U+2029 are escaped. Ordinary paths are unchanged.
- `ManifestEntry` is emitted once per artifact in stable kind order (CSS, JS, types, CSS source map)
  with `kind`, `workspacePath` and `sourceFile`. `contentHash` is correctly absent until a successful
  write.

## Frozen-shape gaps and blockers

1. **No host in `PlanOutputsInput`.** `ModuleHost` is injected at the project layer, but the frozen
   planner input has no host. Added optional `OutputPlannerContext.host`; default is lexical identity.
   The lead should pass `host.canonicalize` when wiring the barrel.
2. **No multi-entry context.** `PlanOutputsInput` plans one source and cannot see another entry's
   targets. `OutputPlannerContext.occupiedTargets` is the additive channel; `compileProject`/CLI must
   accumulate prior `workspacePath`s (and optionally source paths) and pass them. Without this, the
   planner can only detect within-plan duplicates.
3. **No explicit/default provenance in `ResolvedSetup`.** Required fields erase whether a value was
   authored; the merge rules above are the deterministic workaround. Exact per-key precedence for
   file-value-equals-default and file-dir-equals-project-dir needs a frozen contract change.
4. **No trusted-output policy.** External output is always rejected. Supporting an explicit trusted
   policy requires a frozen input flag; none exists.
5. **`ManifestEntry` has no stale/owned-state field.** The planner can only record ownership
   (`kind`, `workspacePath`, `sourceFile`); marking the last successful outputs stale after an error
   belongs to the build/watch layer, which owns failure state.
6. **Async `ModuleHost.fileExists` vs synchronous result.** The planner is synchronous by contract,
   so it cannot call the async host. Overlap is checked against the entry source and caller-supplied
   occupied targets; project code should include all known source paths in that set if it needs
   full cross-source overlap detection.
7. **Source map with CSS disabled.** SPECIFICATION.md §9.2 says no source map is written when CSS is
   disabled; it does not define a diagnostic. The planner silently omits the artifact. If the lead
   prefers a warning/error, that is a small policy addition in `index.ts`.

No framework bug or feature record was created; this is application behaviour, not a framework
defect.

## Acceptance case coverage

`tests/compiler/output.test.ts` (names match §9.3):

| §9.3 case | Test assertion |
|---|---|
| no setup | CSS/JS/types beside source, `./button.css`, manifest |
| only CSS dir | exact file-level CSS dir, default map dir, `../out/styles/button.css` |
| only map dir | default CSS dir, exact map dir, `../../src/button.css` |
| only names | `theme.css`, `classes.js`, `classes.d.ts`, dirs retained |
| both dirs and names | independent dirs/names, `../styles/theme.css` |
| nested source | `src/pages/dashboard.*`, `./dashboard.css`; project mirroring case adds `dist/styles/pages/...` |
| spaces in paths | `out/styles here` + `src/my pages`, correct `../../` import |
| Windows separators | `C:\project` + `..\out\styles` normalized to `C:/project/out/styles` |
| output collision | second source with first plan's target in `occupiedTargets` → XESSA5001 |
| invalid extension | `.scss` / `.ts` → XESSA5001, empty plan |
| traversal | `../evil.css` name and `../../outside` dir → XESSA5001 |
| symlink | fake canonicalize to `/outside` → XESSA5001 |
| disabled outputs | map off → warning + CSS only; CSS off + import on → XESSA5001; both off → JS/types, no source map |
| renamed source | `renamed.*` names and `./renamed.css` |
| custom source map URL | `theme.css` → `theme.css.map` |
| relative import across siblings | `styles/` vs `modules/` → `../styles/button.css` |

Additional named tests cover only-name retaining its directory, CLI precedence, `import-css: false`,
quote escaping, input/output overlap, determinism, project mirroring/fallback, drive-letter escapes,
source/workspace validation, host failures and duplicate-target detection.

## Evidence

- `bun test tests/compiler/output.test.ts tests/compiler/planner.test.ts` → **42 pass, 0 fail**, 121
  expectations.
- `bun run typecheck` → exit 0.
- `bunx biome check packages/compiler/src/output tests/compiler/output.test.ts
  tests/compiler/planner.test.ts` → exit 0, no fixes.
- `bun test` → **423 pass, 0 fail** across 20 files (full suite, including A09).
- `bun run lint` → exit 0, 241 files checked, no fixes.
- `bun run verify` → **exit 0** (typecheck, lint and full test suite).
- A09's naming/mapgen files were edited concurrently during this task and briefly failed; the final
  workspace state is green. No planner test ever failed.

## Barrel integration (lead-directed)

Follow-up after A09 landed: the full public API is now wired and `bun run verify` is green.

### Changes

- **`packages/compiler/src/host/node.ts`** — `createNodeHost(root?: string): ModuleHost`.
  - Reads and existence checks use `node:fs/promises`; path joining/resolution uses `node:path`.
  - Workspace root is the explicit `root`, else `process.cwd()` resolved **at host creation
    time**; paths crossing the boundary are absolute POSIX-style with forward slashes.
  - `canonicalize` uses `path.resolve` plus guarded `realpathSync`, falling back to the lexical
    path when the target does not exist or the platform refuses resolution. The frozen
    `ModuleHost.canonicalize` signature is synchronous, so `fs/promises.realpath` (async) cannot
    back it; this is the one `node:fs` import and the deliberate exception to the
    “promises-only” wording. Reads/checks remain `node:fs/promises`.
  - `resolvePath(from, to)` resolves relative to the importing file; `workspaceRoot()` returns the
    canonical root.
- **`packages/compiler/src/index.ts`** — `compile`, `compileProject` and `planOutputs` are wired;
  the phase stub is gone. `createNodeHost`, `planOutputs` and the planner context types are
  re-exported from the public barrel.
- **`tests/compiler/contract.test.ts`** — stub assertions replaced with behaviour checks:
  `compile` returns CSS/classes, `compileProject([])` returns `{}`, and `planOutputs` plans
  CSS/JS/types with `./sample.css`.
- **`tests/compiler/compile.test.ts`** — new end-to-end suite.

### Pipeline and decisions

- `compile` runs `parse` → graph → `lower` → `substitute` → `emitRuntimeTokens` →
  `renameClasses` → `groupRuns` → `flattenIr` → `emitCss` → `planOutputs` →
  `generateClassMap`. Artifacts are returned frozen; nothing is written. `sourceMap` remains
  `undefined` for P7.
- **Graph policy:** with `@use`, `buildModuleGraph` runs through a Node host wrapped so the
  in-memory entry source overrides the on-disk entry while imports still read from disk. Without
  `@use`, a memory-only single-file graph is built so `substitute`/`emitRuntimeTokens` still see the
  entry and its `@variables`/`@runtime` scopes; no filesystem read is needed for that source.
- **`compileProject`:** one graph is built for all entries; each entry gets its own pass chain.
  Project-level `options.output` forms the project layer and file `@setup` wins. `projectRoot`
  overrides `host.workspaceRoot()` through a thin host wrapper. `configFile` is intentionally not
  read (P5 project loader); `output` directories are passed to `planOutputs` as project-level
  provenance so they resolve against the workspace root instead of the source directory.
- **Prefix precedence:** `options.prefix` → `options.naming.prefix` → file `@setup prefix` → `""`.
  Strategy `none` disables prefixing. In `compileProject`, file `@setup prefix` wins over the
  project-level `options.naming.prefix`.
- **`@setup` decoding:** `prefix`, `css-dir`, `css-name`, `map-dir`, `map-name`, `emit-css`,
  `emit-map`, `emit-types`, `source-map`, `import-css` and `minify`. Quoted scalars are CSS-string
  decoded; booleans require `true`/`false`. The parser does not currently emit unknown/duplicate
  setup diagnostics, so `compile` adds XESSA1001 for unknown keys, duplicates and invalid boolean
  values at the setting span, with first-occurrence-wins decoding. This closes the authored
  `errors/unknown-setup-key` and `errors/duplicate-setting` expectations without touching the
  parser.
- **Emit flags:** `emit-css: false` omits `css`; `emit-map: false` omits `js`/`types` and the
  planner emits its documented warning; source maps are planned but `CompileResult.sourceMap` stays
  undefined until P7. CSS/JS/types are still returned when a plan error is unrelated to generation,
  so editors get best-effort artifacts plus the XESSA5001 diagnostic.
- **Classes:** the result `classes` object is a frozen null-prototype record of non-global names →
  emitted names. Global classes stay out of the map, matching ADR-0010.
- **Dependencies:** workspace-relative POSIX paths of every reachable `@use` module, excluding the
  entry, sorted deterministically.

### Evidence

- `bun test tests/compiler/contract.test.ts tests/compiler/compile.test.ts` → **8 pass, 0 fail**.
- `bun test` → **428 pass, 0 fail** across 21 files.
- `bun run lint` → **exit 0**, 243 files checked.
- `bun run verify` → **exit 0** (typecheck, lint, full test suite).
- Canonical integration asserts byte-identical `expected/css`, `expected/map.js`,
  `expected/map.d.ts`, zero diagnostics, dependencies `fixture/button/theme.xessa`, a null-prototype
  `{ button: "ui-button", icon: "ui-icon" }` map, and no generated files in the temporary workspace
  or in the repository fixture directories.


## Handoff

- The public barrel is wired: `compile`, `compileProject` and `planOutputs` are implemented, and
  `createNodeHost` is exported for embedders.
- P5 still owns reading `xessa.config.json`/`xessa.config.ts`; `compileProject` accepts
  `options.output`/`options.naming`/`options.media` and `projectRoot`, but does not read
  `configFile`.
- P7 still owns CSS source-map text; the planner already plans the `.css.map` artifact when
  requested, while `CompileResult.sourceMap` stays `undefined`.
- Do not mark `.ai/PROGRESS.md` from this worker; the lead flips statuses after verification.
