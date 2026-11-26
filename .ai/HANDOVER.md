# Xessa Handover — 2026-11-27

**Read this file alone to run the remaining release steps when they are authorized.** It is
self-contained for status and validation; the publish runbook, plan, board and reports are linked at
the end for detail.

## Release status

**0.1.1 ⏳ release-ready, not yet published.**
`@xessa/compiler@0.1.1` and `@xessa/cli@0.1.1` (compiler pinned `0.1.1`) are prepared for
publication. **Publish order: compiler → CLI**, then ship the VSIX, with explicit owner
authorization; see [`docs/release.md`](../docs/release.md). The repository root is **private and
unpublished**: npm rejected the unscoped `xessa` name as too similar to an existing package. No npm
publish, tag or push has happened for this release.

| Artifact | Version | Prepared state |
|---|---|---|
| `@xessa/compiler` | `0.1.1` | tarball 403 files; ships `dist/**` + `src/**` |
| `@xessa/cli` | `0.1.1` | depends on `@xessa/compiler@0.1.1`; tarball 89 files; `bin.xessa` |
| `xessa` (workspace root) | `0.1.1` | `private: true`; not published (npm rejected the unscoped name as too similar); no bin/files/publishConfig |
| `@xessa/language-service` | `0.1.0` | `private: true`; internal editor service, not an npm artifact |
| VS Code extension | `0.1.0` | publisher `xessa`; PP4b (Marketplace) deferred; local VSIX 18 files / 144.93 KB |

**PP4b and PP5b remain 🔴 deferred by the owner.** The extension stays at `0.1.0`; the local VSIX
from `release:check` is the interim extension distribution. Registry post-checks (PP5a) run only
after the owner publishes.

### Historical evidence links

- 0.1.0/0.1.1 packaging history and staging audit: `.ai/reports/CSSX-0.1.1-STAGING.md`,
  `.ai/reports/CSSX-PP4A-COMPILER-PUBLISHED.md`.
- Registry post-release report for the earlier published line: `.ai/reports/CSSX-PP5A.md`.
- Pre-publication report for this release: `.ai/reports/XESSA-0.1.1-PREPUBLISH.md`.

## State

- **0.1.1 contains one compiler correction plus packaging/metadata prep.** Runtime-token merge order
  now matches `SPECIFICATION.md` §6.2/§6.3 and ADR-0016 for unqualified `styles` imports; see
  `.ai/framework/bugs/runtime-token-merge-order-first-wins.md`.
- **Final gates, re-run on 2026-11-27:**
  - `bun run verify` exit 0 — **1366 pass / 2 skip / 0 fail** (1368 tests, **99 files**); typecheck and
    Biome green.
  - Browser **96/96** — 32 per engine (Chromium, Firefox, WebKit).
  - `bun run release:check` exit 0 — **nine** examples built, compiler tarball **403 files**, CLI
    tarball **89**, VSIX **18 files / 144.93 KB**.
- **Working tree is intentionally open for independent verification.** Do not commit, push, tag,
  reset or stash without owner authorization.
- **Runtime:** Node.js **≥ 20** (`engines`) or Bun. Gates ran on Bun 1.4.5; only Node 26.3.0 was
  installed here, so **Node 20/22 are unverified**. The CLI entry is ESM with a node shebang.
- **Media variant colour:** variants (`@md`, `@dark`, `@xl+dark`, block headers, `@media-types`
  captions) use the `@`-directive keyword colour via the `keyword.control.media.xessa` TextMate scope
  plus a contributed `configurationDefaults` entry (`#C586C0`, matching directives); user
  `editor.tokenColorCustomizations` rules override it.
- **Completion fixes:** accepting a property reopens the value list (`retriggerSuggest` →
  `editor.action.triggerSuggest`), and digits `0`–`9` are trigger characters so units appear in the
  real editor (`margin: 1` → `1rem`).
- `opencode.jsonc` is present and carries the agent registrations; it is not deleted. `.ai/agents/`
  exists but is an empty directory.
- Full user guide: **[`docs/usage.md`](../docs/usage.md)**.

## 0.1.1 — release-ready (not yet published)

**Prepared on 2026-11-27.** Compiler/runtime behaviour changes only where 0.1.0 violated merge
order; the editor extension remains `0.1.0`.

- **Runtime fix:** all unqualified runtime providers are visible to `emitRuntimeTokens`, so later
  merge order wins with one `:root` property and no XESSA2001 when `$name` is not referenced.
  Referenced names keep the ambiguity diagnostic; compile-time duplicates are unchanged.
- Clean `dist` before every package build removes renamed stale outputs (`importPath.*`).
- Both tarballs ship `src/`, so every `.js`/`.d.ts` map `sources` entry resolves.
- The compiler README example `await`s `compile()`; the `docs/usage.md` quick start is
  formatter-clean with an ESM note for generated maps.
- Root `package.json` now carries repository/homepage/bugs metadata and is `private: true` (no `bin`,
  `files` or `publishConfig`); the language service is `private: true`; the TextMate `fileTypes` value
  is `cssx` (source extension).
- Manifests: `@xessa/compiler@0.1.1`, `@xessa/cli@0.1.1` with `"@xessa/compiler": "0.1.1"`, private
  workspace root `xessa@0.1.1` (not published), VS Code extension `0.1.0` (PP4b deferred).

Publish order when authorized: compiler → CLI, then the VSIX. There is no root publish step; npm
rejected the unscoped `xessa` name as too similar. The full command sequence and post-checks are in
[`docs/release.md`](../docs/release.md).

## What changed since the previous handover

The feature and editor waves plus production phases **PP0–PP3** landed before 0.1.1. The
authoritative per-item record is the plan's `## Implementation Progress` table
(`.ai/plans/CSSX-PLAN-PRODUCTION.md`); one line each:

| Area | Landed | Record |
|---|---|---|
| Release engineering | CLI `bin` → `dist/index.js` + node shebang; VSIX 84 → 18 files; manifest URLs → `MARKjotep/xessa`; CHANGELOG `[0.1.0]`; docs counts/limits aligned | `.ai/reports/CSSX-PP1.md`, `CSSX-PP2.md` |
| F18 `css-dir` lists | Comma-separated in-workspace stylesheet destinations, one artifact/manifest record per item | ADR-0019, `.ai/reports/CSSX-F18.md` |
| F20 `map-inherit` | Opt-out keeps a merged module's class bindings out of the importer's map/`.d.ts` | ADR-0020, `.ai/reports/CSSX-F20.md` |
| F21 `import-css` | Opt-in single side-effect CSS import at the top of `map.js` | ADR-0021, `.ai/reports/CSSX-F21.md` |
| F22 minified default | `minify` defaults true; `--no-minify` / `minify: false` opt out; CSS only | ADR-0022, `.ai/reports/CSSX-F22.md` |
| F23 group hover | Multi-line defaults list + separate use-site overrides section | `.ai/reports/CSSX-F23.md` |
| `examples/modules` | Ninth example: three modules, `map-inherit: false`, `css-dir` list, no `exclude` | `.ai/reports/CSSX-EXAMPLE-MODULES.md` |
| Zero-config defaults | Config optional, default include `**/*.cssx`, `strict: true`, safe grouping, module markers | ADR-0023, `.ai/reports/CSSX-DEFAULTS.md` |
| Media merge | Opt-in `mediaGrouping: "merge"`; `safe` stays default; browser differential **27/27** | ADR-0024, `.ai/reports/CSSX-MEDIA-MERGE.md` |
| Selector ids | `#` completion from document ids; single-file id rename (hash survives) | `.ai/reports/CSSX-ID-COMPLETE.md`, `CSSX-ID-RENAME.md` |
| Class rename | Single-file class rename, `:global(...)` excluded/refused | `.ai/reports/CSSX-CLASS-RENAME.md` |
| Attribute selectors | Full operator/flag/namespace matrix + browser proof; no behaviour change | `.ai/reports/CSSX-ATTR-TESTS.md` |
| Stale importer diagnostics | Dependency change invalidates caches and refreshes open importers | `.ai/reports/CSSX-STALE-DIAGS.md` |
| Reverse references | Find All References is bidirectional for `$token`/`@runtime`; rename stays single-file | `.ai/reports/CSSX-REVERSE-REFS.md` |
| Runtime merge fix | Unqualified `styles` runtime providers merge by order; referenced `$name` stays ambiguous | `.ai/reports/XESSA-0.1.1-PREPUBLISH.md` |
| Terminology | `@variables` vs `@runtime` note at usage §2.3/§2.4; alias deferred | `.ai/reports/CSSX-TERMINOLOGY.md` |
| Portfolio stale token | `$space.gutter` → `$space.gutters`; check 0, two byte-identical builds | `.ai/reports/CSSX-FIX-PORTFOLIO-TOKEN.md` |
| Bug 25 | Group-body (`@group.<name> {}`) CSS property completion | `.ai/reports/CSSX-FIX-GROUP-COMPLETE.md` |

## Plans and board

- Production plan: **PP0–PP3 🟢**; **PP4a/PP5a pending** for 0.1.1 (release-ready, not published);
  **PP4b (Marketplace) and PP5b 🔴 deferred** by the owner (`.ai/plans/CSSX-PLAN-PRODUCTION.md`).
- Bug/feature board: `.ai/todo.md`; progress log `.ai/PROGRESS.md`.
- Framework records: `.ai/framework/` (`bugs/`, `features/`, `TRIAGE.md`); the confirmed runtime
  merge-order bug is fixed in 0.1.1.

## Documentation layout after the 2026-11-26 cleanup

- **`SPECIFICATION.md` is the single normative source.** `docs/usage.md` is the user guide.
  `AGENTS.md` is the workflow contract.
- Removed as superseded or redundant: the pre-rename design proposal, the original P0–P7 plan, the
  completed task prompts, the three redirect README stubs under the grammar, cascade and
  configuration directories, and raw worker `.log` files. `.ai/reports/logs/*.json` and
  `logs/ui-screens/**` remain.
- `docs/grammar.md`, `docs/cascade.md` and `docs/configuration.md` are the real references.
- Retired framework bug records were removed; the macOS launcher workaround is documented in
  `docs/release.md`, `docs/known-limitations.md` and `packages/vscode/README.md`.

## Caveats and known non-issues

- **Two skipped tests** are the opt-in soak suites (`tests/stress/soak/watch-soak.test.ts`,
  `cold-build.test.ts`, gated by `XESSA_SOAK`). Deliberate; not failures.
- **Gate flakes:** a watcher rename-prune race (`tests/stress/fs/watch.test.ts`) and extension-host
  timing can fail under load. Rerun the single test and then the full gate before investigating. If a
  timed-out `xessa watch` test leaves an orphan process, identify and kill **only** the watcher that
  test spawned.
- **`examples/basic`** holds the owner's personal-test content (kept deliberately; README updated).
  Its `@keyframes ss` emits `background-color: 8px` from a textual `$radius` substitution; this is
  authored test content, not validation, and the browser suite does not exercise that keyframe.
- **`examples/portfolio`** is placeholder CV content the owner may still edit
  (`examples/portfolio/README.md#replace-placeholder-content`). It is committed and its generated
  output is rebuilt by `release:check`. `examples/portfolio/src/sections.cssx` carries a
  pre-existing `@lg 3` invalid-CSS finding previously recorded in the framework triage; it was left
  untouched by the 0.1.1 work.
- **`examples/portfolio/src/nas.cssx`** is a scratch stylesheet; it declares `module: true` so ad-hoc
  builds emit nothing into `src/`.
- **`bunx xessa` at the repo root** cannot resolve the workspace bin (no root install link;
  pre-existing). For local runs use the built entry (`node packages/cli/dist/index.js`); the packaged
  CLI is unaffected.
- **Local workspace `npx @xessa/cli` needs the built entry**: the CLI build chmods the entry to `755`,
  so run `bun run --cwd packages/cli build` once after a fresh install. Registry installs set bin
  modes from the tarball.
- **`var(--x)` / custom-property values are preserved, not validated** (SPECIFICATION §3.1).
- **Module-internal diagnostics** are logged rather than published at the importer's offsets.
  Importers refresh on dependency change/save; diagnostics are not re-based into the importer.
- **Media-merge family table** may only be extended with a documented shorthand relationship and a
  re-run of the grouping differential (27/27).
- **Class/id rename is single-file.** Literal `className="…"` / HTML `id="…"` anchors, inbound links,
  the map and `.d.ts` are not edited.
- **References are bidirectional; rename is not.** Find All References crosses files, rename does
  not.

## Deferred / v0.2

| Item | Why it waits |
|---|---|
| Cross-file `$token`/`@runtime` rename | REVERSE-REFS provides the reverse edge scan and resolution; multi-file edit application and a conflict policy remain. |
| Imported-class references/completion | Needs cross-module class resolution; prefix ownership makes the same authored name ambiguous. |
| Implicit module rule | Literal "no `@setup` → module" was rejected (breaks config-mirroring pages); an import-aware variant is the candidate. |
| Dead-declaration dedupe | Needs a shorthand-aware optimizer to stay cascade-safe. |
| Media hoist / global grouping | Rejected as cascade-unsafe. |
| `@variables` naming alias | Deferred pending user evidence (terminology note shipped instead). |
| CSS→cssx converter | Scrapped by the owner — do not resurrect. |

## Docs map

- **Normative:** [`SPECIFICATION.md`](../SPECIFICATION.md).
- **User guide:** [`docs/usage.md`](../docs/usage.md) — start here for users.
- **References:** [`docs/grammar.md`](../docs/grammar.md), [`docs/cascade.md`](../docs/cascade.md),
  [`docs/configuration.md`](../docs/configuration.md), [`docs/compatibility.md`](../docs/compatibility.md),
  [`docs/known-limitations.md`](../docs/known-limitations.md), [`docs/release.md`](../docs/release.md).
- **Decisions:** ADRs **0019–0024** in `docs/decisions/` (output lists, map inherit, CSS import,
  minify default, zero-config, media merge).
- **Reports:** `.ai/reports/XESSA-0.1.1-PREPUBLISH.md`, `CSSX-REVERSE-REFS.md`,
  `CSSX-FIX-PORTFOLIO-TOKEN.md`, `CSSX-MEDIA-MERGE.md`, `CSSX-DEFAULTS.md`,
  `CSSX-F18/F20/F21/F22/F23.md`, `CSSX-ID-COMPLETE.md`, `CSSX-ID-RENAME.md`,
  `CSSX-CLASS-RENAME.md`, `CSSX-STALE-DIAGS.md`, `CSSX-TERMINOLOGY.md`,
  `CSSX-FIX-GROUP-COMPLETE.md`, `CSSX-FIX-INTEGRATION.md`.
- **Board/plan:** `.ai/todo.md`, `.ai/plans/CSSX-PLAN-PRODUCTION.md`, `.ai/PROGRESS.md`. There is no
  task-prompt directory and no superseded design proposal.

## Where to look

- **Users:** `README.md`, `docs/usage.md`, `docs/configuration.md`, `examples/`.
- **LLMs/agents:** `AGENTS.md`, this handover, `SPECIFICATION.md`,
  `.ai/plans/CSSX-PLAN-PRODUCTION.md`, `.ai/reports/`.

## Conventions

- Roles/routing per root [`AGENTS.md`](../AGENTS.md): `build` orchestrates, `code` writes,
  specialists verify; max four workers, disjoint write sets.
- No commit, push, tag, reset or stash without owner authorization. Publishing is a separate,
  explicit authorization.
- Full gates (`bun run release:check`) before claiming done; never weaken an assertion.
- Persist reports and board records; a mismatch opens a follow-up task.
- Read before editing; keep the smallest coherent change; report pre-existing failures separately.
