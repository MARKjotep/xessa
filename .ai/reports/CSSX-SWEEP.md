# CSSX-SWEEP — `.cssx` extension, release identity and chick logo

## Summary

- Rename every source-file reference from `.xessa` to `.cssx`: fixtures, CLI discovery/config defaults, docs, examples, README, SPECIFICATION.md, test strings — language ID, packages, CLI command and diagnostics stay Xessa/XESSA.
- Extension identity: marketplace name `xessa`, versions 0.1.0, chick logo as marketplace icon + `.cssx` file icon, `module` setup key learned by the extension analysis.
- Release hygiene: package README/LICENSE copies, scaffold-test name update, full `release:check` green including vsce.

**Status:** 🟢 Complete. `bun run verify` exit 0 (612 pass / 0 fail / 37 files, extension host
included); `bun run test:browser` 75 passed (25 × Chromium/Firefox/WebKit); `bun run release:check`
exit 0 end to end and `vsce` produced `packages/vscode/xessa-0.1.0.vsix` (214 files, 351.31 KB).
`.ai/PROGRESS.md` and the protected files were not touched; nothing was committed or published.

## Owner decision and ADR

`docs/decisions/ADR-0013-cssx-file-extension.md` (Accepted 2026-11-25, owner decision) records that
the source extension becomes `.cssx` and that every other public name stays Xessa. ADR-0001 was
amended for its source-extension clause only (status line + one bullet + consequences); the
masterplan was deliberately left unchanged.

Two non-source artifacts follow the same token so no functional `.xessa` literal remains:

- `packages/cli` manifest file `MANIFEST_FILENAME` is now `.cssx-manifest.json` (was
  `.xessa-manifest.json`), with the `.gitignore` entry and example manifests renamed;
- the compiler/CLI/extension temporary write suffix is now `.cssx-tmp` (was `.xessa-tmp`).

Both are internal, unreleased and trivially reversible; ADR-0013 documents them. The VS Code cache
directory used by the extension-host test is now `node_modules/.vscode-test-xessa` (brand, not
extension) and the existing cache was moved so the host suite keeps running.

## Rename inventory

| Kind | Count | Where |
|---|---|---|
| `*.xessa` → `*.cssx` source files | **90** | `tests/fixtures/**` 79 (incl. 21 files under `modules/merge/**`), `examples/**` 9, `packages/vscode/test/fixtures` 2 |
| `.xessa-manifest.json` → `.cssx-manifest.json` | **5** | `examples/{basic,responsive,variables,jsx,custom-output}` |
| Files whose contents were swept (`.xessa` → `.cssx`) | **107** | 86 first pass + 21 renamed-source pass |

TextMate scope names derived from the (unchanged) language ID were protected during the sweep and
remain `source.xessa`, `meta.variant.xessa`, `keyword.control.directive.xessa`, etc. (28 distinct
scope names).

## Content sweep proof

```text
$ grep -rn "\.xessa" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
    --exclude-dir=out --exclude-dir=.ai .
96 matching lines:
  39 packages/vscode/syntaxes/xessa.tmLanguage.json      (scope names)
  25 tests/extension/grammar.scopes.test.ts             (scope assertions)
  16 tests/extension/grammar.test.ts                    (scope assertions)
   6 packages/vscode/README.md                           (scope table + feature line)
   1 packages/vscode/package.json                        (scopeName)
   1 packages/vscode/test/suite.js                       (scopeName)
   1 tests/extension/grammar-harness.ts                  (scopeName)
   5 docs/decisions/ADR-0013-cssx-file-extension.md      (historical)
   1 docs/decisions/ADR-0001-public-name.md              (historical)
   2 CHANGELOG.md                                        (historical)
Functional (non-scope, non-ADR/changelog) residual: 0
```

CLI defaults, globs, fixtures, examples, README, SPECIFICATION.md, all docs and test strings now use
`.cssx`; everything Xessa-identified is unchanged (`@xessa/*`, `xessa`, `XESSA####`,
`xessa.config.json`, language ID and aliases).

## Extension identity

`packages/vscode/package.json`:

| Field | Value |
|---|---|
| `name` | `xessa` (unscoped; `displayName` stays `Xessa`) |
| `version` | `0.1.0` |
| `icon` | `media/icon.png` |
| `contributes.languages[0]` | `id: "xessa"`, `aliases: ["Xessa","xessa"]`, `extensions: [".cssx"]`, `icon.light: ./media/file-icon.svg`, `icon.dark: ./media/file-icon-dark.svg` |
| `contributes.grammars[0].scopeName` | `source.xessa` (language-ID-derived, unchanged) |

`tests/integration/scaffold.test.ts` and `packages/vscode/test/suite.js` now expect `xessa` instead of
`@xessa/vscode`; the extension-host suite found and activated the renamed extension.

**`module` setup key (A16 deviation 5):** `src/analysis.ts` adds `module` to `SETUP_KEYS` and
`BOOLEAN_SETUP_KEYS`; `src/output.ts` decodes it and applies the ADR-0014 suppression locally
(`emit-css`, `emit-map`, `emit-types`, `import-css` off) without changing the compiler's
`ResolvedSetup` type; `src/intelligence.ts` adds its completion documentation and now demonstrates
`@use "./theme.cssx"`.

## Logo provenance

The image-generation tool was unavailable (`Insufficient balance` for the pay-as-you-go image
provider). Per the task's fallback instruction the artwork was hand-crafted instead of generated:

| File | What it is |
|---|---|
| `packages/vscode/media/logo.svg` | Hand-authored master (512×512), black chick silhouette on white: plump body with wing cut-out, round head, notch eye, beak, tail and legs |
| `packages/vscode/media/logo-source.png` | 1024×1024 raster of the master (`ImageMagick 7.1.2-21 -density 192`) |
| `packages/vscode/icon.png` | 256×256 marketplace icon (`sips -z 256 256`, white background) |
| `packages/vscode/media/icon.png` | Same 256×256 bytes at the manifest path `"icon": "media/icon.png"` |
| `packages/vscode/media/file-icon.svg` | Language file icon `#000000`, 32×32, `fill-rule="evenodd"` wing/eye cut-outs, filled legs (no strokes) |
| `packages/vscode/media/file-icon-dark.svg` | `#ffffff` variant for dark themes |

The logo is shown at the top of `packages/vscode/README.md`. The file icon was rendered with
ImageMagick and visually inspected at 128 px; filled paths were used because ImageMagick's internal
SVG renderer ignores `stroke`.

## Package and release hygiene

- Versions `0.1.0` in root, `@xessa/compiler`, `@xessa/cli`, `@xessa/language-service`,
  `packages/vscode`; `bun install` refreshed `bun.lock` (`xessa@workspace:packages/vscode`).
- `packages/compiler/README.md` + `LICENSE` and `packages/cli/README.md` + `LICENSE` added
  (package-level, short and pointing at the root docs). `packages/vscode/LICENSE` added too, which
  removed the vsce licence warning.
- `release:check` now: asserts versions/names/icons/language contribution, **fails** if a tarball
  lacks `README.md`/`LICENSE`/`dist`, builds the extension, and runs `vsce` without the old
  `|| echo blocked` fallback, so packaging failure fails the gate.
- `docs/release.md`, `docs/known-limitations.md`, `README.md`, `SPECIFICATION.md`, `CHANGELOG.md`,
  extension README/CHANGELOG were updated to the resolved state and cite ADR-0013.

## Validation evidence

Log: `.ai/reports/logs/CSSX-SWEEP.log`.

| Command | Result |
|---|---|
| `bun install` | exit 0, lockfile saved (`xessa@workspace:packages/vscode`) |
| `bun run verify` | exit 0 — typecheck 4 projects, Biome 364 files, **612 pass / 0 fail**, 37 files |
| `bun run test:browser` | **75 passed** (25 Chromium + 25 Firefox + 25 WebKit) |
| `bun run release:check` | **exit 0** |
| ↳ package metadata | compiler, cli and vscode valid (`0.1.0`, `xessa`, icon, `.cssx`) |
| ↳ `npm pack` compiler | 287 files, `package.json` + `README.md` + `LICENSE` + `dist/**` |
| ↳ `npm pack` cli | 89 files, `package.json` + `README.md` + `LICENSE` + `dist/**` + `src/**` |
| ↳ example builds | 5/5, `3/3/3/3/6` files, 0 warnings |
| ↳ `vsce package` | `xessa-0.1.0.vsix` (214 files, 351.31 KB) |
| Extension host | `cached=1.147.0 runnable=true`, activation/grammar/6 commands/completion/compile+preview passed |
| Plain-Node smoke | included in the 612-test run (`tests/integration/node-smoke.test.ts`, Node v24.22.3) |

Examples were rebuilt, so committed `generated/**` outputs now reference `src/*.cssx` (e.g.
`custom-output/generated/styles/theme.css.map` → `"sources":["src/panel.cssx"]`).

## Deviations and notes

1. **Manifest/temp suffix renamed** (`.cssx-manifest.json`, `.cssx-tmp`) as the only way to reach a
   zero functional `.xessa` count while keeping the Xessa name everywhere else. Documented in
   ADR-0013; revertible in one commit if the lead prefers the old manifest name.
2. **Marketplace icon exists twice** (`icon.png` and `media/icon.png`) because the task names
   `packages/vscode/icon.png` while the manifest must point at `media/icon.png`.
3. **Image generation unavailable**; hand-crafted SVG/raster fallback used, reported below.
4. **Extension build added to `release:check`** so the VSIX never contains a stale `dist`.
5. vsce still warns that no `.vscodeignore`/`files` exists; the VSIX therefore includes `src/`,
   `test/` and `tsconfig.json`. Recorded as a remaining packaging gap in `docs/known-limitations.md`,
   not changed here.

## Framework records

None created. This task changes only the project's own naming, manifests, docs and assets; no
external framework defect or feature request was involved, so no version-bearing framework record
was required.

## Blockers

1. **Image generation tool unusable** (`Insufficient balance` on the pay-as-you-go image provider).
   Resolved by the documented fallback: hand-crafted SVG master, rasterized locally with ImageMagick
   and `sips`; both marketplace PNG and file-icon SVGs ship.

## Handoff

- Completed: full `.cssx` rename (files, contents, manifest), ADR-0013 + ADR-0001 amendment,
  extension identity/version/icon/language wiring, `module` setup key, package README/LICENSE,
  tightened `release:check`, generated chick assets, updated docs/changelog.
- Lead: independently re-run the gates and flip `.ai/PROGRESS.md` rows.
- No commits, pushes or publishes were performed.
