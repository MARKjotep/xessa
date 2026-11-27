# XESSA 0.1.2 — published and clean-install verified

Date: 2026-11-27
Status: 🟢 PASS — `@xessa/compiler@0.1.2` and `@xessa/cli@0.1.2` are live on npm.

## Registry facts

| Package | Version | Dist-tag | Files | `gitHead` | Published (UTC) |
|---|---|---|---|---|---|
| `@xessa/compiler` | `0.1.2` | `latest` | **436** | `2e2febe` | `2026-11-27T06:48:43Z` |
| `@xessa/cli` | `0.1.2` | `latest` | **89** | `2e2febe` | `2026-11-27T06:46:27Z` |
| `xessa` (unscoped root) | — | — | — | — | npm **404**; stays private/unpublished |

The CLI depends on exactly `@xessa/compiler: 0.1.2`.

## Clean-install verification

Run in a fresh temp directory with no workspace symlinks.

```text
$ mktemp -d ...
$ npm init -y
$ npm i @xessa/cli@0.1.2
added 2 packages, and audited 3 packages in 602ms
found 0 vulnerabilities

$ npx @xessa/cli --version
0.1.2

$ bunx @xessa/cli@0.1.2 --version
Resolving dependencies
Resolved, downloaded and extracted [8]
Saved lockfile
0.1.2

$ node -e "console.log(require('@xessa/compiler/package.json').version)"
0.1.2
```

Installed compiler payload:

```text
node_modules/@xessa/compiler/SPECIFICATION.md      # present
node_modules/@xessa/compiler/docs/grammar.md        # present
node_modules/@xessa/compiler/docs/decisions/ADR-0001-public-name.md ... ADR-0024-media-merge-grouping.md  # 24 ADRs
```

Smoke build — one-file `.cssx` project:

```text
$ npx @xessa/cli build
wrote generated/styles/button.css
wrote generated/maps/button.map.js
xessa build: 1 entry, 2 files written, 0 warnings
exit 0
```

`generated/styles/button.css`:

```css
.ui-button {
  padding: 12px;
  color: #0ea5e9;
}
```

`generated/maps/button.map.js`:

```js
export const button = "ui-button";
```

## Result

All seven clean-install checks passed: install, `npx` version, `bunx` version, compiler version,
spec/docs/ADR presence, and CSS + map build output.

## Stale published README (cosmetic)

The published 0.1.2 tarball READMEs were packed from `2e2febe` and still say "0.1.2 is release-ready,
not yet published". The repository docs now state 0.1.2 is live and note this caveat; the tarball text
cannot be corrected without a new version. **Do not republish 0.1.2** — defer an optional `0.1.3`
docs-only patch.

## Remaining manual steps

1. **VSIX:** owner continues testing the local `packages/vscode/xessa-0.1.0.vsix`; decide on the VS Code
   Marketplace after acceptance (unchanged, still `0.1.0`, local-only).
2. **Optional `0.1.3` docs patch:** refresh package README status lines (cosmetic).
3. **Optional:** `npm deprecate` 0.1.1 compiler/CLI pointing at 0.1.2. Never unpublish.
4. Root `xessa` stays private; no publish step.

## Constraints observed

No publish, deprecate, tag or republish was performed in this change. Package versions were not
modified. The private root and local-VSIX status are unchanged.
