# CSSX-PP1 — Packaging fixes (CLI `bin`, VSIX payload)

## Summary

- `@xessa/cli` `bin` → `./dist/index.js` (same as `main`). No TypeScript loader is needed to reach
  the entry; `node packages/cli/dist/index.js --version` prints `0.1.0`, exit 0.
- `packages/vscode/.vscodeignore` excludes `src/`, `test/`, `tsconfig.json`. The VSIX is now
  **18 files / 134.57 KB** (was 84 files / 309.78 KB), and every manifest-contributed path still
  resolves inside the package.
- `tests/integration/scaffold.test.ts` pins `bin === { xessa: "./dist/index.js" }` and `bin.xessa ===
  main`. `bun.lock`'s workspace bin row was synced (metadata only, no dependency change).
- Docs records refreshed with actuals: `docs/release.md`, `docs/known-limitations.md` §2,
  `README.md`, plus the two pages that restated the old bin entry (`docs/usage.md`,
  `docs/compatibility.md`) and `packages/cli/README.md` (ships in the CLI tarball).
- Residual, outside the PP1 write set: the built entry keeps the source `#!/usr/bin/env bun`
  shebang. Node-only machines must use `node …/dist/index.js`; a plain symlinked `bin` needs Bun
  (measured below). **Resolved 2026-11-26 (PP2 Stage 1):** `packages/cli/src/index.ts` now declares
  `#!/usr/bin/env node`, the build and a source-level pin test enforce it; see the correction
  section below.

## Changed paths

| Path | Change |
|---|---|
| `packages/cli/package.json` | `bin.xessa`: `src/index.ts` → `./dist/index.js` |
| `packages/vscode/.vscodeignore` | new; ignores `src/**`, `test/**`, `tsconfig.json` |
| `tests/integration/scaffold.test.ts` | bin expectation + `bin === main` pin |
| `bun.lock` | workspace bin metadata synced to the manifest |
| `docs/release.md` | VSIX actual, tarball counts, CLI payload row, `.vscodeignore` note |
| `docs/known-limitations.md` | §2 blockers closed; shebang caveat recorded |
| `README.md`, `docs/usage.md`, `docs/compatibility.md`, `packages/cli/README.md` | install/bin wording |

## Gates (sequential, real output)

| Gate | Exit | Elapsed | Output |
|---|---|---|---|
| `bun run --cwd packages/cli build` | 0 | 1.0 s | `tsc -p tsconfig.json` clean |
| `node packages/cli/dist/index.js --version` | 0 | — | `0.1.0` |
| `bun packages/cli/dist/index.js --version` | 0 | — | `0.1.0` |
| `npm exec --no-install -- xessa --version` (from `packages/cli`) | 0 | — | `0.1.0` |
| `bun run verify` | 0 | 68.2 s | 1225 pass / 2 skip / 0 fail, 1227 tests / 89 files, 994 863 expects |
| `bun test tests/extension/host.test.ts` | 0 | 29.3 s | 14 scenarios / 856 assertions (`semantic-tokens=21`) |
| `bun run release:check` | 0 | 149.5 s | verify + browser 96/96 + builds + packs + examples + VSIX |
| `npm pack --dry-run --json --workspace @xessa/compiler` | 0 | — | **307** files (304 `dist/`, root 3) |
| `npm pack --dry-run --json --workspace @xessa/cli` | 0 | — | **89** files (68 `dist/`, 18 `src/`, root 3) |
| `bunx @vscode/vsce package --no-dependencies` | 0 | 0.5 s | `xessa-0.1.0.vsix (18 files, 134.57 KB)`, 137 797 bytes |

`bunx xessa --version` from the workspace root does not resolve `@xessa/cli` (no install link at the
root, so bunx queries the registry and gets 404). This predates the change; the Bun runner was
verified directly against the built entry instead.

## VSIX contents (unzip -l, excerpt)

```text
extension/changelog.md, extension/LICENSE.txt, extension/readme.md, extension/icon.png
extension/language-configuration.json, extension/package.json
extension/dist/extension.js (426 960 B), extension/out/extension.js (50 B)
extension/syntaxes/xessa.tmLanguage.json
extension/media/{file-icon-dark.svg,file-icon.svg,icon.png,logo-source.png,logo.svg}
extension/scripts/write-entry.mjs
```

No `extension/src/**`, `extension/test/**` or `extension/tsconfig.json` entries (`grep` exit 1).
Unpacked check: `main`, `icon`, language `configuration` + light/dark file icons, and the grammar
path all exist; `out/extension.js` is `module.exports = require("../dist/extension.js");`.

## Residual shebang evidence

> **Correction 2026-11-26 (PP2 Stage 1).** The shebang residual is resolved:
> `packages/cli/src/index.ts` and `packages/cli/dist/index.js` now start `#!/usr/bin/env node`.
> `tests/integration/scaffold.test.ts` pins the source first line. `node
> packages/cli/dist/index.js --version` exits 0 (`0.1.0`), and Bun executes the same file. The
> `bun run verify` count moved from 1225 to **1226 pass / 2 skip / 0 fail** (1228 tests, 89 files)
> for the new pin. After the PP2a URL change the VSIX is **18 files / 134.59 KB**; the CLI tarball
> is unchanged at **89 files**. The pre-fix measurement below is retained as history.

```text
$ ln -s …/packages/cli/dist/index.js /tmp/…/node_modules/.bin/xessa
$ env PATH=<node-dir>:/usr/bin:/bin /tmp/…/node_modules/.bin/xessa --version
env: bun: No such file or directory          # exit 127
$ head -1 packages/cli/dist/index.js
#!/usr/bin/env bun
```

`npm exec` on the same Node-only PATH returns `0.1.0` because npm's launcher calls `node` explicitly;
a raw symlink uses the shebang. Fix requires changing `packages/cli/src/index.ts` (out of this task's
write set) — recommend an owner-approved one-liner before PP4.

## Handoff

- **Status:** PASS for PP1a/PP1b/PP1 gates; the shebang residual was **resolved in PP2 Stage 1**
  (2026-11-26, see the correction section).
- **Completed state:** `bin` → built `dist`, VSIX trimmed and verified, docs/records carry actuals.
  PP2 inherited clean manifests and honest payload numbers; PP2 finalized URLs and the changelog.
- **Remaining:** PP3 manual rows; PP4 publish. (PP2a/PP2b/PP2c landed 2026-11-26.)
- **Touched:** the eight code/doc paths above plus this task/report,
  `.ai/PROGRESS.md`, and the three PP1 rows in `.ai/plans/CSSX-PLAN-PRODUCTION.md`.
