# Release checklist (v0.1)

This page records what `bun run release:check` validates, how to publish, and the remaining manual
steps for the package owners.

**Current status (2026-11-27):** **`0.1.1` is release-ready, not yet published.** `@xessa/compiler`
and `@xessa/cli` are `0.1.1`; the repository root is private and is not published (npm rejected the
unscoped `xessa` name as too similar to an existing package). The local gate is green; publish in the
order **compiler → CLI**, then ship the VSIX. The VS Code Marketplace extension (PP4b) remains deferred
by the owner; the extension stays at `0.1.0` and the local VSIX is the interim distribution.
Publishing anything needs explicit owner authorization.

Source files use the `.cssx` extension; the language ID, packages, CLI command and diagnostics stay
Xessa ([ADR-0013](decisions/ADR-0013-cssx-file-extension.md)).

## Aggregate gate

```sh
bun run release:check
```

It runs, in order:

1. `bun run verify` — typecheck, Biome and the full unit/integration/extension-provider suite.
2. `bun run test:browser` — Playwright computed-style gate (Chromium required; Firefox/WebKit when
   installed).
3. `bun run --cwd packages/compiler build` and `bun run --cwd packages/cli build` — emit `dist`.
4. Package metadata assertion: compiler/CLI/extension names, versions (`0.1.1`, `0.1.1`, `0.1.0`),
   licences, entry points, extension icon and the `xessa` language contribution with `.cssx` files.
5. `npm pack --dry-run --json --workspace @xessa/compiler` and `@xessa/cli` — assert the tarball
   contains `package.json`, `README.md`, `LICENSE` and `dist/**`.
6. Build all nine examples through the CLI (`basic`, `responsive`, `variables`, `jsx`,
   `custom-output`, `overrides`, `groups`, `portfolio`, `modules`). Each example uses
   `--config examples/<name>/xessa.config.json` only when that file exists; config-less examples run
   `xessa build` from the example directory, which discovers the default `**/*.cssx` scope under the
   example's own `package.json` boundary ([ADR-0023](decisions/ADR-0023-zero-config-defaults.md)).
7. `bun run --cwd packages/vscode build` and `bunx @vscode/vsce package --no-dependencies` in
   `packages/vscode`; the gate fails if packaging fails, and the produced `xessa-<version>.vsix` is
   the release artifact.

Each sub-result is printed. `release:check` does not publish anything and does not commit.

## Manual pre-release steps

1. **Metadata URLs are final.** The repository/homepage/bugs URLs are
   `https://github.com/MARKjotep/xessa` (repository `.git` URL, `#readme` homepage and `/issues`
   bugs). `release:check` asserts the extension manifest has a repository URL, homepage and bugs URL;
   the root manifest carries the same metadata. No placeholder remains.
2. **Publish (owner only), in this order:**
   - **Compiler:** `npm publish --workspace @xessa/compiler --access public`.
   - **CLI:** the CLI pins the compiler to an exact version (`"@xessa/compiler": "0.1.1"`). npm does
     not rewrite the `workspace:` protocol at pack/publish, so a new compiler release requires
     bumping the CLI dependency to the same version, rebuilding and re-packing the CLI before its own
     publish. Confirm the packed manifest before publishing:
     `tar -xzOf xessa-cli-0.1.1.tgz package/package.json | grep '@xessa/compiler'`, then
     `npm publish --workspace @xessa/cli --access public`.
   - **VS Code Marketplace (deferred):** `cd packages/vscode && vsce publish` (publisher `xessa`;
     needs a PAT with Marketplace *Manage* scope via `npx @vscode/vsce login xessa` or `VSCE_PAT`).
     Until then the local VSIX is self-contained and can be distributed by hand.
3. Run the post-release checks below against the registry, then update this status and the docs.

## Post-release checks

From a clean environment with no workspace symlinks:

```sh
npm view @xessa/compiler version     # 0.1.1
npm view @xessa/cli version          # 0.1.1
mkdir -p /tmp/xessa-release && cd /tmp/xessa-release
npm init -y && npm i @xessa/cli@0.1.1
npx @xessa/cli --version             # 0.1.1
bunx @xessa/cli@0.1.1 --version
```

- The unscoped `xessa` package is not published; `npx @xessa/cli` resolves the CLI package, and after
  installing `@xessa/cli` the local `xessa` bin is available in the project.
- Run the [usage guide](usage.md) quick start end to end with `xessa build`/`check`/`format --check`.
- Record actual outputs in `.ai/reports/`; never claim a publish before it succeeds.

## Versions, names and identity

| Artifact | Value |
|---|---|
| Repository root | private workspace package `xessa`, `0.1.1` (not published; npm rejected the unscoped name as too similar) |
| `@xessa/compiler` | `0.1.1`, MIT, `dist/**` + `src/**` payload plus package `README.md`/`LICENSE` |
| `@xessa/cli` | `0.1.1`, MIT, `dist/**` + `src/**` plus package `README.md`/`LICENSE`; `bin.xessa` → `dist/index.js` |
| VS Code extension | marketplace `name: xessa`, `version: 0.1.0`, publisher `xessa`, `icon: media/icon.png`, language `xessa` with `.cssx` |
| Language service | `@xessa/language-service` `0.1.0`, `private: true` (internal editor service, not an npm artifact) |
| Diagnostics | `XESSA####` (unchanged) |

## Root package

The repository root is a **private, unpublished workspace package** (`"private": true`). npm rejected
the unscoped `xessa` name under its name-similarity policy, so the root declares no `bin`, `files` or
`publishConfig` and has no publish step. The old root pointer stub and root `.npmignore` were removed
with the abandoned root tarball.

The CLI is **`@xessa/cli`** (`bin.xessa` → `dist/index.js`); the local `xessa` command comes from that
package after installing it. The root has no dependencies and no build step.

## Extension packaging (vsce)

`vsce` requires an unscoped lowercase extension `name` (`^[a-z0-9][a-z0-9-]*$`). The manifest is
named `xessa`; `displayName` stays `Xessa`. The extension also ships `LICENSE` and the chick brand
assets (`icon.png`, `media/icon.png`, `media/file-icon.svg`, `media/file-icon-dark.svg`).
`packages/vscode/.vscodeignore` excludes `src/`, `test/` and `tsconfig.json`; the VSIX carries the
runtime payload (`out/`, `dist/`, `syntaxes/`, `media/`, `language-configuration.json`).

Recorded output of the packaging step:

```text
$ cd packages/vscode && bunx @vscode/vsce package --no-dependencies
DONE  Packaged: packages/vscode/xessa-0.1.0.vsix (18 files, 140.6 KB)
```

The `*.vsix` pattern is gitignored.

## Tarball contents

`release:check` asserts each package tarball contains `package.json`, `README.md`, `LICENSE` and
`dist/**`; package-level `README.md` and `LICENSE` copies exist so npm tarballs are self-describing.
Only the two scoped packages are packed; the private root has no tarball.

## Framework note

The extension-host smoke suite depends on `@vscode/test-electron 2.5.2`. On macOS with VS Code
1.147.0, the package's default launcher resolution looks for `…/MacOS/Electron`, but VS Code 1.147
ships only `…/MacOS/Code`. The repository test orchestrator resolves the executable itself and
passes `vscodeExecutablePath`.

## Failure rules

- **Published versions are immutable.** Never `npm unpublish` or withdraw. A bad release is
  superseded by a new version, never removed.
- If one package succeeds and the next fails, record exactly what shipped where and retry the
  remaining package.
- If the failure is auth/transient, retry the same version. If code must change in an
  already-published package, bump that package (and the CLI, whose dependency is pinned to the
  published compiler version).
- Record the outcome, version and any partial state in `.ai/reports/` immediately.

## Rollback

Artifacts are generated deterministically. To revert a bad build, restore the previous source and run
`xessa build` again; last-good outputs are retained on errors. `xessa clean` removes only
manifest-owned files that have not been edited. Publishing cannot be rolled back — use a new version.
