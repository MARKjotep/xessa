# Xessa Handover — 2026-11-28

**Read this file first.** `@xessa/compiler@0.1.2` and `@xessa/cli@0.1.2` are **live on npm** (published
2026-11-27, `gitHead 2e2febe`). The publish is complete and clean-install verification passed; see
`.ai/reports/XESSA-0.1.2-PUBLISHED.md`. Published versions are immutable; nothing in 0.1.1 or 0.1.2
needs republishing. The repository prepares `@xessa/compiler` and `@xessa/cli` at `0.1.4` and the
VS Code extension at `0.1.2`; these are **committed and pushed to `origin/main` but not published**
to npm or the Marketplace (the extension is a local VSIX only). The private workspace root stays at
`0.1.1`.

## Release status (registry checked 2026-11-27; repo 2026-11-28)

| Artifact | Version | State | Tarball / files | Notes |
|---|---|---|---|---|
| `@xessa/compiler` | `0.1.4` | 🟡 prepared in repo — committed/pushed, **not published** | 437 (dry-run) | supersedes live `0.1.2`; ships `SPECIFICATION.md` + full `docs/**` |
| `@xessa/cli` | `0.1.4` | 🟡 prepared in repo — committed/pushed, **not published** | 89 (dry-run) | supersedes live `0.1.2`; pins `@xessa/compiler@0.1.4` |
| `xessa` (workspace root) | `0.1.1` | 🔴 npm 404 — stays private | n/a | npm rejected the unscoped name as too similar; no bin/files/publishConfig |
| `@xessa/language-service` | `0.1.0` | ⚪ private | n/a | internal editor service, not an npm artifact |
| VS Code extension `xessa` | `0.1.2` | 🟡 local VSIX; Marketplace publication deferred | 17 files / 231.8 KB | publisher `xessa`; PP4b revisited after owner acceptance |

The published compiler tarball for 0.1.1 predates packaged docs (403 files); 0.1.2 carries them (436
files), and the prepared 0.1.4 tarball is 437 files (adds ADR-0025). The published 0.1.2 tarball
READMEs were packed from `2e2febe` and still say "release-ready, not yet published" — cosmetic only;
the 0.1.4 publish packs the refreshed package READMEs. **Never unpublish.**

## Post-release state — 0.1.2 published

> **Do not publish the VSIX to the Marketplace yet.** The owner installed a local
> `packages/vscode/xessa-0.1.2.vsix` directly and is testing it for a few days (started 2026-11-27).
> Wait for acceptance before revisiting PP4b.

- **Publish: done.** `@xessa/compiler@0.1.2` and `@xessa/cli@0.1.2` are on npm (2026-11-27,
  `gitHead 2e2febe`, 436 / 89 files, both `latest`). A clean install outside the workspace passed:
  `npx @xessa/cli --version` and `bunx @xessa/cli@0.1.2 --version` both report `0.1.2`, the compiler
  payload includes `SPECIFICATION.md`, `docs/grammar.md` and the ADRs, and `npx @xessa/cli build`
  emitted CSS + map. Evidence: `.ai/reports/XESSA-0.1.2-PUBLISHED.md`.
- **Package README refresh (historical note).** The published 0.1.2 READMEs still say "release-ready,
  not yet published" because they were packed from `2e2febe`. The repository READMEs are current and
  the 0.1.4 publish will carry them; this is cosmetic, not a functional defect.
- **Optional:** `npm deprecate` 0.1.1 for the compiler and CLI with a message pointing at 0.1.2
  (0.1.1 lacks the packaged docs, media aliases and rewritten READMEs). **Never unpublish.**
- **Do not publish the root `xessa`.** It stays private at `0.1.1`. The VSIX step
  (`cd packages/vscode && npx @vscode/vsce publish`) is separate and **on hold** until the owner
  accepts the local VSIX; the extension stays `0.1.2`.

Also stale and worth reconciling: `.ai/plans/CSSX-PLAN-PRODUCTION.md`'s earlier alias/tag record.

## 0.1.4 release-prep state (2026-11-28)

- **Compiler:** group definitions accept nested `@group.<base> { overrides }` composition
  ([ADR-0025](../docs/decisions/ADR-0025-group-composition.md)); composition resolves in the defining
  module's scope, cycles and depth over 64 report `XESSA2001`, and the canonical formatter
  round-trips composition blocks. Selector use sites stay declarations-only.
- **Editor, composition:** composed group defaults flow into ghost override hints, hover and
  derived-definition labels; definition, references and rename follow composition sites; completion
  offers group names in definition bodies and stays definition-only inside use-site blocks.
- **Editor, navigation:** definition and references cover `@group.<name>` and `@keyframes <name>`
  (declarations plus references, locally and across `styles` imports); keyframe rename works from an
  exact `animation-name` value; accepting `@group`, `$keyframes.` or an imported `$alias.` retriggers
  the member list.
- **Editor, media:** `@lg+` / `@lg+dark+` continues the media alias chain and inserts the bare alias
  name.
- **Commits:** `31a1015` (feature + `0.1.4`/`0.1.2` release metadata + stress corpus updates),
  `b2b1bb8` (release-prep report), and `docs: update handover for 0.1.4 release prep` (this
  document).
- **Not done:** no tag, no `npm publish`, no VSIX/Marketplace publication. Publishing `0.1.4` and
  the extension still needs explicit owner authorization.

## What changed in 0.1.2 (`80df584..2e2febe`)

| Commit(s) | Area | Change |
|---|---|---|
| `80df584` | Compiler | Runtime-token merge order fixed; 0.1.1 packaging prep. **This is what is live.** |
| `06d9dc1` | Release | Root workspace is private; root bin/files/publishConfig removed after npm rejected `xessa`. |
| `001ea10` | Compiler + editor | Default aliases `smd` `(min-width: 624px)`, `no_hover`/`mobile` `(pointer: coarse)`, `screen`; docs and tests. |
| `ad7ccfe` | VS Code | Green X/S monogram replaces the chick mascot; app icon and logo refreshed. |
| `a14742f` | Docs | CLI README rewritten as a complete command/ops manual; compiler and extension READMEs expanded. |
| `193271c` | Packaging | `scripts/sync-package-docs.mjs` + compiler `prepack` ship the spec and docs; tarball 403 → 436. |
| `cb297fb` | Docs | README and `docs/release.md` record the packaged compiler docs. |
| `2147974` | VS Code | `.cssx` file icon becomes the blue/indigo main logo; old SVG file icons removed. |
| `2b32777`, `d4dc9e6` | Examples | Portfolio `hero-grid`: valid `minmax(0, 1fr)` columns and `gap: $space.loose`; generated CSS has no `gap:3`/`grid-template-columns:3`. |
| `f35480a` | Board | Formatter `@use` spacing and `@setup` completion semicolon recorded as open items 30/31. |
| `d8e291e` | Compiler + editor | Consecutive top-level `@use` lines stay contiguous with one blank line before the next construct; `@setup` value completions append `;` unless one follows. Unit, extension-host and doc coverage. |
| `fabcb49` | Board | Items 30/31 archived as done with `d8e291e`; `.ai/todo.md` is now a slim live board. See `.ai/reports/TODO-ARCHIVE-2026-11-27.md`. |
| `2e2febe` | Release | **0.1.2 published 2026-11-27** (compiler 436 files, CLI 89 files, both `gitHead 2e2febe`): manifests, CLI pin, `release:check` assertions, docs/CHANGELOG/handover; root stays private at `0.1.1`. |
| `0b2b0b3` | Docs | Local VSIX testing window noted; publish status later recorded in this docs commit. |

## Current validation (2026-11-28, 0.1.4 release-prep commit)

- `bun run release:check` **exit 0**: verify **1445 pass / 2 intentional soak skips / 0 fail**
  (1447 tests, 100 files); Playwright **96/96**; compiler/CLI builds; metadata assertions (compiler,
  CLI, CLI pin and extension); pack dry-runs; nine examples; VSIX packaging.
- Compiler tarball **437 files** (adds ADR-0025); CLI tarball **89 files**; VSIX
  `xessa-0.1.2.vsix` **17 files / 231.8 KB**.
- Extension host: **15 scenarios / 1006 assertions**; typecheck and Biome exit 0.
- Historical — 0.1.2 release (2026-11-27): `bun test` 1369 pass / 2 skip / 0 fail (1371 tests, 99
  files), Playwright 96/96, compiler tarball 436 files, CLI 89, VSIX 17 files / 225.99 KB, and a
  post-publish clean install of `@xessa/cli@0.1.2` (`npx`/`bunx` → `0.1.2`, `build` emitted CSS +
  map, spec and 24 ADRs present). Details: `.ai/reports/XESSA-0.1.2-PUBLISHED.md`.
- Known load-sensitive `cli-watch` flake: rerun that test isolated, then the full gate once. Not a
  release blocker.
- Gates ran on **Bun 1.4.5 / Node 24.22.3**. Node 20 and 22 remain unverified.

## Documentation architecture / packaged docs

- **Compiler owns the language and compiler contract.** It ships `SPECIFICATION.md` + the complete
  `docs/` tree (including all **25** ADRs at 0.1.4) at pack time. `scripts/sync-package-docs.mjs` is
  run by the compiler's `prepack` (and `bun run sync:docs`); the generated copies are gitignored,
  never committed, and refreshed from repository source.
- **CLI owns usage and operations:** install, commands, flags, configuration, outputs, exit codes.
- **Extension owns editor behavior:** registration, completion, diagnostics, navigation, commands,
  settings, theming, preview.
- Package READMEs use absolute GitHub links plus installed paths such as
  `node_modules/@xessa/compiler/SPECIFICATION.md`; repository-relative links do not work from npm.
- The **VSIX intentionally does not bundle docs**. Editor users link online or read the compiler
  package when it is installed.

## Release checklist (next release)

`0.1.2` was published with these commands on 2026-11-27; substitute the next version. Preconditions:
clean `main` in sync with `origin/main`, owner authorization, npm rights for `@xessa`, and the
version/docs edits committed and pushed.

```sh
bun run release:check                         # must end exit 0 with the new version's assertions
npm pack --dry-run --json --workspace @xessa/compiler
npm pack --dry-run --json --workspace @xessa/cli   # inspect the pin
npm publish --workspace @xessa/compiler --access public
npm view @xessa/compiler version
npm publish --workspace @xessa/cli --access public
npm view @xessa/cli version
```

Then, outside the workspace:

```sh
mkdir -p "$TMPDIR/xessa-release-check" && cd "$TMPDIR/xessa-release-check"
npm init -y && npm i @xessa/cli@<version>
npx @xessa/cli --version
bunx @xessa/cli@<version> --version
```

Rollback rule: publish a new patch version. **Never unpublish** a version or move an existing tag.
The VSIX step (`cd packages/vscode && npx @vscode/vsce publish`) is separate and only after the
Marketplace publisher is confirmed; the extension stays `0.1.2` until then.

## Open items / known caveats

- **No open board items.** Items 30/31 were fixed in `d8e291e` and archived in
  `.ai/reports/TODO-ARCHIVE-2026-11-27.md`; `.ai/todo.md` is a slim live board.
- Framework records were retired by the owner on 2026-11-27. The runtime merge-order bug is fixed in
  0.1.1 (`80df584`); the five remaining framework feature records were triaged deferred/rejected.
- The `.cssx` file icon is blue/indigo while the app icon is the green X/S monogram; optional tint.
- VS Code Marketplace publication deferred during local VSIX testing (started 2026-11-27); revisit
  after acceptance.
- A VSIX without the compiler package has no local docs; README links online.
- Node 20/22 are unverified; runtime engines still declare `>=20`.
- The current repository has **no tags**; earlier tag/history was removed. The published 0.1.1
  `gitHead 80df584` is reachable in this history.
- `cli-watch` can flake under load; rerun isolated before investigating.
- The worktree is clean after the handover commit; only owner-authorized commits are pushed.

## Repo / workflow state

- Path `/Users/Marky/Desktop/$/xessa`; branch `main`; remote
  `https://github.com/MARKjotep/xessa.git`. `main` is in sync with `origin/main`; the validation
  baseline is the `0.1.4` release-prep commit `31a1015` plus the report commit `b2b1bb8` and the
  handover commit. The historical published `0.1.2` baseline was `2e2febe`.
- `bun run verify` = typecheck + lint + test. `bun run release:check` = verify + browser + builds,
  tarball assertions, nine examples and VSIX packaging. Neither publishes.
- `opencode.jsonc` registers the agents; root `AGENTS.md` is the workflow contract. Max four child
  workers, disjoint write sets, native `subagent` sessions only.

## Docs map / where to look

- **Normative:** [`SPECIFICATION.md`](../SPECIFICATION.md).
- **Usage:** [`docs/usage.md`](../docs/usage.md), [`docs/configuration.md`](../docs/configuration.md).
- **Language internals:** [`docs/grammar.md`](../docs/grammar.md),
  [`docs/cascade.md`](../docs/cascade.md), [`docs/compatibility.md`](../docs/compatibility.md),
  [`docs/known-limitations.md`](../docs/known-limitations.md).
- **Release:** [`docs/release.md`](../docs/release.md); package READMEs under `packages/*/README.md`.
- **Decisions:** [`docs/decisions/`](../docs/decisions/), including
  [`ADR-0025-group-composition.md`](../docs/decisions/ADR-0025-group-composition.md).
- **Reports:** `.ai/reports/XESSA-0.1.2-PUBLISHED.md`, `.ai/reports/XESSA-RENAME.md`,
  `.ai/reports/XESSA-0.1.1-PREPUBLISH.md`, `.ai/reports/CSSX-0.1.1-STAGING.md`,
  `.ai/reports/CSSX-MEDIA-MERGE.md`, `.ai/reports/CSSX-DEFAULTS.md`,
  `.ai/reports/CSSX-GROUP-COMPOSITION.md`, `.ai/reports/CSSX-EDITOR-COMPOSITION-MEDIA.md`,
  `.ai/reports/CSSX-GROUP-NAV.md`, `.ai/reports/CSSX-KEYFRAME-NAV.md`,
  `.ai/reports/CSSX-0.1.4-RELEASE-PREP.md`.
- **Board/plan:** `.ai/todo.md`, `.ai/plans/CSSX-PLAN-PRODUCTION.md`, `.ai/PROGRESS.md`.

## Deferred / v0.2

| Item | Why it waits |
|---|---|
| Cross-file `$token`/`@runtime` rename | Reverse reference scanning exists; multi-file edit application and conflict policy do not. |
| Imported-class references/completion | Needs cross-module class resolution; prefixes make authored names ambiguous. |
| Implicit module rule | "No `@setup` → module" breaks config-mirroring pages; an import-aware variant is the candidate. |
| Dead-declaration dedupe | Needs a shorthand-aware optimizer to stay cascade-safe. |
| Media hoist / global grouping | Rejected as cascade-unsafe. |
| `@variables` naming alias | Deferred pending user evidence. |
| CSS→cssx converter | Scrapped by the owner — **do not resurrect**. |
