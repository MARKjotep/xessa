# Release checklist (v0.1)

This page records what `bun run release:check` validates, how to release, and the remaining manual
steps for the package owners.

**Current status (2026-11-26):** **`@xessa/compiler@0.1.1`, `@xessa/cli@0.1.1` and the root package
`xessa@0.1.1` are all published** (owner publishes, 2026-11-26) and live at `latest` on the
public registry. The compiler was published first (the CLI pins it to the exact version), then the
CLI, then the root package. **PP5a passed** on 2026-11-26 against the registry: clean install,
`npx`/`bunx` versions, and the `docs/usage.md` quick start end to end with
`xessa build`/`check`/`format --check` ([report](../.ai/reports/CSSX-PP5A.md)). **PP4b — the VS Code
Marketplace extension — remains deferred by the owner**; the extension stays at `0.1.0` and the local
VSIX is the interim distribution. Publishing anything further needs new explicit owner authorization.
The root package was approved and published via npm's staged publishing
([Root package](#root-package)).

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

1. **Metadata URLs are final.** On 2026-11-26 the placeholder repository/homepage/bugs URLs were
   replaced with `https://github.com/MARKjotep/xessa` (repository `.git` URL, `#readme` homepage and
   `/issues` bugs). `release:check` asserts the extension manifest has a repository URL, homepage and
   bugs URL; no placeholder remains.
2. **Tag and publish**:
   - **2a · npm (PP4a, executed 2026-11-26):**
     `npm publish --workspace @xessa/compiler --access public`, then
     `npm publish --workspace @xessa/cli --access public` (compiler first).
     The CLI pins the compiler to an exact version (currently `"@xessa/compiler": "0.1.1"`): npm does
     not rewrite the `workspace:` protocol at pack/publish, so **every new compiler release requires
     bumping the CLI dependency in `packages/cli/package.json` to the same version, rebuilding and
     re-packing the CLI before its own publish**. Confirm the packed manifest before publishing:
     `tar -xzOf xessa-cli-0.1.1.tgz package/package.json | grep '@xessa/compiler'`.
     **0.1.1**: `@xessa/compiler@0.1.1` (tarball byte-identical to the local pack, 398 files) and
     `@xessa/cli@0.1.1` (89 files, pinned to `0.1.1`) were published by the owner on 2026-11-26;
     `npm view` reports `0.1.1` for both.
   - **2b · VS Code Marketplace (PP4b, deferred by owner 2026-11-26):**
     `cd packages/vscode && vsce publish` (publisher `xessa`; needs a PAT with Marketplace *Manage*
     scope via `npx @vscode/vsce login xessa` or `VSCE_PAT`). Until then the local VSIX is
     self-contained and can be distributed by hand.
3. Install the VSIX locally (or open the folder in an Extension Development Host) and smoke-test
   activation, diagnostics, completion, preview and Compile File.

## Versions, names and identity

| Artifact | Value |
|---|---|
| Repository root | unscoped `xessa` pointer stub, `0.1.1` (no code; `bin/xessa.js` only) |
| `@xessa/compiler` | `0.1.1`, MIT, `dist/**` + `src/**` payload plus package `README.md`/`LICENSE` |
| `@xessa/cli` | `0.1.1`, MIT, `dist/**` + `src/**` plus package `README.md`/`LICENSE`; `bin.xessa` → `dist/index.js` |
| VS Code extension | marketplace `name: xessa`, `version: 0.1.0`, publisher `xessa`, `icon: media/icon.png`, language `xessa` with `.cssx` |
| Diagnostics | `XESSA####` (unchanged) |

## Root package

The unscoped name `xessa` is available, so the repository root publishes as `xessa`, a minimal
public package (`0.1.1`) that only reserves the name. It ships no code: `files` is limited to
`README.md`, `LICENSE` and `bin`, the sole bin is `bin/xessa.js`, and that stub prints a pointer to
`@xessa/cli` and exits 1. It is **not** the CLI and must not be used as one. The tarball is
constrained by `files` (the authoritative allowlist) with a root `.npmignore` as a second guard; npm
ignores `.npmignore` whenever `files` is present.

The root package was **approved and published by the owner on 2026-11-26 via npm's staged
publishing** (`npm stage publish`). Published versions are immutable; the tarball is functionally
correct (4 files, no dependencies, `bin.xessa`). `0.0.0-stage` in the root package (and compiler)
version list is npm's staged-publishing placeholder: it is expected and must **not** be deprecated or
unpublished.

To publish a future version (owner, from the repository root):

```sh
npm pack --dry-run --json   # must list exactly package.json, README.md, LICENSE, bin/xessa.js
npm publish --access public
```

Unscoped packages publish publicly by default; `--access public` is passed explicitly and
`publishConfig.access` is also `"public"`. The root has no dependencies and no build step; this is a
name reservation, not a release of the compiler or CLI.

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

## Tarball contents (recorded)

| Package | Files | Root files included |
|---|---|---|
| `@xessa/compiler` | 398 | `package.json`, `README.md`, `LICENSE` (+ `dist/**`, `src/**`) |
| `@xessa/cli` | 89 | `package.json`, `README.md`, `LICENSE` (+ `dist/**`, `src/**`) |
| `xessa` (root package) | 4 | `package.json`, `README.md`, `LICENSE` (+ `bin/xessa.js`) |

Package-level `README.md` and `LICENSE` copies exist so npm tarballs are self-describing;
`release:check` fails if either is missing.

## Framework note

The extension-host smoke suite depends on `@vscode/test-electron 2.5.2`. On macOS with VS Code
1.147.0, the package's default launcher resolution looks for `…/MacOS/Electron`, but VS Code 1.147
ships only `…/MacOS/Code`. The repository test orchestrator resolves the executable itself and
passes `vscodeExecutablePath`.

## Rollback

Artifacts are generated deterministically. To revert a bad build, restore the previous source and run
`xessa build` again; last-good outputs are retained on errors. `xessa clean` removes only
manifest-owned files that have not been edited. Publishing cannot be rolled back — use a new version.
