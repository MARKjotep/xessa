# Xessa Handover — 2026-11-27

**Read this file first.** `@xessa/compiler@0.1.1` and `@xessa/cli@0.1.1` are **live on npm**. The
repository is ahead of the published commit (`80df584`), so the next release is **0.1.2**. Published
versions are immutable; nothing in 0.1.1 is pending or needs republishing.

## Release status (registry checked 2026-11-27)

| Artifact | Version | State | Tarball / files | Notes |
|---|---|---|---|---|
| `@xessa/compiler` | `0.1.1` | 🟢 live | 403 published; **436 in the current tree** | `gitHead 80df584`, published 2026-11-26T20:21Z |
| `@xessa/cli` | `0.1.1` | 🟢 live | 89 | pins `@xessa/compiler@0.1.1`; same `gitHead` |
| `xessa` (workspace root) | `0.1.1` | 🔴 npm 404 — stays private | n/a | npm rejected the unscoped name as too similar; no bin/files/publishConfig |
| `@xessa/language-service` | `0.1.0` | ⚪ private | n/a | internal editor service, not an npm artifact |
| VS Code extension `xessa` | `0.1.0` | 🔴 not on Marketplace | local VSIX: 17 files / 225.83 KB | publisher `xessa`; PP4b remains deferred |

The published compiler tarball predates packaged docs (403 files). The current tree packs **436**
because `SPECIFICATION.md` and the complete `docs/` tree are copied at pack time. **Do not publish
0.1.1 again, and do not expect 403 files for 0.1.2.**

## ⚠ Critical next action — prepare 0.1.2

1. **Bump the two published packages:** `packages/compiler/package.json` → `0.1.2`;
   `packages/cli/package.json` → `0.1.2` **and** its dependency pin → `"@xessa/compiler": "0.1.2"`.
   The private root can stay at `0.1.1`; its version is not asserted or published.
2. **Update the inline `release:check` assertions** in the root `package.json` (compiler `0.1.2`,
   CLI `0.1.2`, extension `0.1.0`), then refresh `CHANGELOG.md`, `docs/release.md`, `README.md`, the
   compiler/CLI package READMEs and any stale "release-ready, not yet published" wording.
3. **Fix the changelog split:** the `[0.1.1]` Compiler section currently lists the `smd` /
   `no_hover` / `mobile` / `screen` aliases, which landed **after** `80df584`. Move those bullets into
   the new `[0.1.2]` entry so the published 0.1.1 record stays truthful.
4. **Pack and inspect before publishing:** the compiler tarball must contain `SPECIFICATION.md`,
   `docs/grammar.md`, `docs/cascade.md`, `docs/configuration.md`, the ADRs and `dist/**` (~436 files);
   the CLI tarball must show `"@xessa/compiler": "0.1.2"` in its packed `package.json`.
5. **Publish in order: compiler → CLI.** Confirm `npm view @xessa/compiler@0.1.2 version` before the
   CLI publish, then confirm both dist-tags.
6. **Post-checks:** clean install, `npx @xessa/cli --version`, `bunx @xessa/cli@0.1.2 --version`, and
   a quick `xessa build`/`check` against an example.
7. **Optional:** `npm deprecate` the 0.1.1 compiler and CLI with a message pointing at 0.1.2 (0.1.1
   lacks the packaged docs, media aliases and rewritten READMEs). **Never unpublish.**
8. **Do not publish the root `xessa`.** Confirm the npm `@xessa` org and the VS Code publisher `xessa`
   before any VSIX publish.

Also stale and worth reconciling: `.ai/todo.md` Quick Note 2, `.ai/framework/TRIAGE.md`'s final
"all 404" line, and `.ai/plans/CSSX-PLAN-PRODUCTION.md`'s earlier alias/tag record.

## What changed since 0.1.1 (`80df584..d4dc9e6`)

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

## Current validation (2026-11-27, baseline HEAD `d4dc9e6`)

- `bun run typecheck` exit 0; `bun run lint` exit 0 (461 files).
- `bun run test`: **1368 pass / 2 skip / 0 fail** (1370 tests, 99 files). The two skips are the
  `XESSA_SOAK=1` soak suites.
- Extension host: **15 scenarios / 939 assertions**; accessibility **190 assertions**.
- Playwright: **96/96** (32 each on Chromium, Firefox and WebKit).
- `bun run release:check` exit 0: nine examples, compiler tarball **436 files**, CLI **89**, VSIX
  **17 files / 225.83 KB**.
- Known load-sensitive `cli-watch` flake: rerun that test isolated, then the full gate once. Not a
  release blocker.
- Gates ran on **Bun 1.4.5 / Node 24.22.3**. Node 20 and 22 remain unverified.

## Documentation architecture / packaged docs

- **Compiler owns the language and compiler contract.** It ships `SPECIFICATION.md` + the complete
  `docs/` tree (33 files, including 24 ADRs) at pack time. `scripts/sync-package-docs.mjs` is run by
  the compiler's `prepack` (and `bun run sync:docs`); the generated copies are gitignored, never
  committed, and refreshed from repository source.
- **CLI owns usage and operations:** install, commands, flags, configuration, outputs, exit codes.
- **Extension owns editor behavior:** registration, completion, diagnostics, navigation, commands,
  settings, theming, preview.
- Package READMEs use absolute GitHub links plus installed paths such as
  `node_modules/@xessa/compiler/SPECIFICATION.md`; repository-relative links do not work from npm.
- The **VSIX intentionally does not bundle docs**. Editor users link online or read the compiler
  package when it is installed.

## Publish checklist for 0.1.2

Preconditions: clean `main` in sync with `origin/main`, owner authorization, npm rights for `@xessa`,
and the 0.1.2 version/docs edits committed and pushed.

```sh
bun run release:check                         # must end exit 0 with 0.1.2 assertions
npm pack --dry-run --json --workspace @xessa/compiler
npm pack --dry-run --json --workspace @xessa/cli   # inspect the pin
npm publish --workspace @xessa/compiler --access public
npm view @xessa/compiler version              # 0.1.2
npm publish --workspace @xessa/cli --access public
npm view @xessa/cli version                   # 0.1.2
```

Then, outside the workspace:

```sh
mkdir -p "$TMPDIR/xessa-0.1.2-check" && cd "$TMPDIR/xessa-0.1.2-check"
npm init -y && npm i @xessa/cli@0.1.2
npx @xessa/cli --version
bunx @xessa/cli@0.1.2 --version
```

Rollback rule: publish a new patch version. **Never unpublish** a version or move an existing tag.
The VSIX step (`cd packages/vscode && npx @vscode/vsce publish`) is separate and only after the
Marketplace publisher is confirmed; the extension stays `0.1.0` until then.

## Open items / known caveats

- `.ai/todo.md` item **30** — formatter `@use` spacing (preserve authored spacing) — 🔴 open.
- `.ai/todo.md` item **31** — accepting an `@setup` suggestion must append `;` — 🔴 open.
- `.ai/framework/TRIAGE.md`: runtime merge bug **fixed**; five feature records deferred or rejected.
  Its final "all 404" registry line predates the publish and is stale.
- The `.cssx` file icon is blue/indigo while the app icon is the green X/S monogram; optional tint.
- A VSIX without the compiler package has no local docs; README links online.
- Node 20/22 are unverified; runtime engines still declare `>=20`.
- The current repository has **no tags**; earlier tag/history was removed. The published 0.1.1
  `gitHead 80df584` is reachable in this history.
- `cli-watch` can flake under load; rerun isolated before investigating.
- Worktree is clean; only owner-authorized commits are pushed.

## Repo / workflow state

- Path `/Users/Marky/Desktop/$/xessa`; branch `main`; remote
  `https://github.com/MARKjotep/xessa.git`; validation baseline HEAD `d4dc9e6`, clean and in sync.
  This handover commit sits on top and is also pushed.
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
- **Reports:** `.ai/reports/XESSA-RENAME.md`, `.ai/reports/XESSA-0.1.1-PREPUBLISH.md`,
  `.ai/reports/CSSX-0.1.1-STAGING.md`, `.ai/reports/CSSX-MEDIA-MERGE.md`,
  `.ai/reports/CSSX-DEFAULTS.md`.
- **Board/plan:** `.ai/todo.md`, `.ai/plans/CSSX-PLAN-PRODUCTION.md`, `.ai/PROGRESS.md`,
  `.ai/framework/TRIAGE.md`.

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
