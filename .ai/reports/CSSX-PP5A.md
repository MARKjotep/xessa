# CSSX-PP5A — clean-environment check of the published packages

- Date: 2026-11-26
- Scope: registry install + `docs/usage.md` §1.2–§1.4 in fresh temp dirs; no workspace symlinks
- Environment: macOS, Bun 1.4.5, Node 24.22.3, npm 11.19.1; npm unauthenticated (read-only queries/installs)
- Temp root: `$TMPDIR/xessa-pp5a.XY4wez` (`proj/`, `pub/`, `local/`); the 0.1.1 rerun used fresh
  `xessa-verify-*` and `xessa-alias-*` temp roots

## Status: PASS (two 0.1.0 documentation mismatches recorded as follow-ups; both fixed for 0.1.1)

## Registry audit

| Check | Result |
|---|---|
| `npm view @xessa/cli version license engines` | `0.1.0`, MIT, `node >=20` |
| `dependencies` | `{"@xessa/compiler": "0.1.0"}` (exact pin) |
| `bin` / `main` / `types` | `dist/index.js` / `./dist/index.js` / `./dist/index.d.ts` |
| `exports["."]` | types/import/default → `./dist/*` |
| `repository.directory` | `packages/cli`; homepage + bugs URLs present |
| `dist.fileCount` / `dist.integrity` | 89 / `sha512-tbRmwcP+qdZQ…rXd0/Q==` |
| `@xessa/compiler` version / dist-tags | `0.1.0` / `latest: 0.1.0` |
| Versions (both packages) | `0.0.0-stage`, `0.1.0` only — no `0.1.1` |
| Published CLI tarball SHA-256 | `53d0d5882370eeafaaeb3a58f40d00191b0fb641ac8930b7251b4b08912a0077` |
| Local staging pack (`--workspace @xessa/cli`) SHA-256 | same `53d0d588…a0077`; `cmp` → byte-identical, 89 entries, 85,550 B |

Published manifest (inside tarball): `bin.xessa: "./dist/index.js"`, `files: ["dist","src"]`,
`publishConfig.access: public`, no `workspace:` specifiers.

## Clean-environment run (`proj/`)

```text
$ npm init -y && npm i @xessa/cli@0.1.0
added 2 packages, and audited 3 packages in 571ms
$ npm ls --all
└─┬ @xessa/cli@0.1.0
  └── @xessa/compiler@0.1.0
# package-lock resolved: registry.npmjs.org/@xessa/{cli,compiler}/-/*-0.1.0.tgz
```

Version paths (all `0.1.0`, exit 0): `npx xessa --version`; `npx -y @xessa/cli@0.1.0 --version`;
`bunx @xessa/cli@0.1.0 --version`; `node node_modules/@xessa/cli/dist/index.js --version`;
`./node_modules/.bin/xessa --version`.

Project: `src/theme.cssx` (`module: true`, `$primary`), `src/button.cssx` (`@use` + `prefix: "ui"`,
`$spacing`/`$radius`, `padding: $spacing @md 20px`). No `xessa.config.json`.

```text
$ npx xessa build
wrote generated/styles/button.css
wrote generated/maps/button.map.js
wrote generated/maps/button.map.d.ts
xessa build: 2 entries, 3 files written, 0 warnings        # exit 0
$ npx xessa check
xessa check: 2 entries checked, 0 errors, 0 warnings        # exit 0
$ npx xessa clean
removed generated/maps/button.map.d.ts
removed generated/maps/button.map.js
removed generated/styles/button.css
xessa clean: 3 files removed, 0 skipped                     # exit 0; sources kept, manifest emptied
```

CSS (minified): `.ui-button{display:flex;padding:12px;}@media (min-width: 768px){.ui-button{padding:20px;}}…`
plus `.ui-button:hover` and `.ui-button > .ui-icon`. Map: `export const button = "ui-button";` and
`export const icon = "ui-icon";`; `.d.ts` literal types match.

Config rerun with `{"include": ["src/**/*.cssx"]}`: `xessa build` → 2 entries, 3 files written,
exit 0; `xessa check` → 0 errors / 0 warnings.

## Mismatches (follow-ups, not published-claim edits)

1. **`format --check` is not clean on the guide's own §1.2 example**: exit 1,
   `1 file(s) would be reformatted: src/button.cssx`; `xessa format` expands the inline
   `&:hover { … }` / `& > .icon { … }` blocks to multi-line. After formatting, `--check` reports
   `2 file(s) already formatted`, exit 0. Docs should show the canonical form or note it.
2. **Plain-Node import of the map needs an ESM project**: under `npm init -y` (no `"type": "module"`)
   `import("./generated/maps/button.map.js")` fails with `Unexpected token 'export'`; adding
   `"type": "module"` makes it work (`button=ui-button icon=ui-icon`). The map is ESM `.js`; usage
   §3.2 says "plain-Node importable" without stating that condition.

Node 20/22 were not installed here, so those versions are **unverified** (Node 24.22.3 only).

## 0.1.1 clean-environment rerun (appended 2026-11-26)

Status: **PASS** — all three artifacts (compiler, CLI, alias) published at `0.1.1`; tag `v0.1.1` on
`2abfbdf`. Fresh temp projects, registry installs only.

### Registry

| Check | Actual output |
|---|---|
| `npm view @xessa/compiler version dist-tags` | `0.1.1`; `{ latest: '0.1.1' }` |
| `npm view @xessa/cli version dist-tags dependencies` | `0.1.1`; `{ latest: '0.1.1' }`; `{ '@xessa/compiler': '0.1.1' }` |
| `npm view xessa version dist-tags bin` | `0.1.1`; `{ latest: '0.1.1' }`; `{ xessa: 'bin/xessa.js' }` |
| Versions (`@xessa/compiler`) | `0.0.0-stage`, `0.1.0`, `0.1.1` — the `0.0.0-stage` entry is npm's staged-publishing placeholder |

### CLI install and versions

```text
$ npm i @xessa/cli@0.1.1
added 2 packages in 303ms
$ npm ls @xessa/cli @xessa/compiler --depth=1
└─┬ @xessa/cli@0.1.1
  └── @xessa/compiler@0.1.1
$ npx xessa --version
0.1.1                       # exit 0
$ bunx @xessa/cli@0.1.1 --version
0.1.1                       # exit 0
```

### Two-file quick start

`src/tokens.cssx` (`module: true`, `$spacing`/`$radius`/`$primary`), `src/button.cssx`
(`@use "./tokens.cssx" as tokens`, `$tokens.spacing`, `padding: … @md 20px`, `@dark`), prefix `ui`
via `xessa.config.json`, `source-map: true`.

```text
$ npx xessa build
wrote dist/styles/button.css
wrote dist/maps/button.map.js
wrote dist/styles/button.css.map
xessa build: 2 entries, 3 files written, 0 warnings        # exit 0
$ npx xessa check
xessa check: 2 entries checked, 0 errors, 0 warnings        # exit 0
$ npx xessa format --check
xessa format --check: 2 file(s) already formatted.          # exit 0
```

CSS minified (`ui-button`, `@media (min-width: 768px)`, `prefers-color-scheme: dark`); map
`export const button = "ui-button";`.

### Installed source maps (0.1.1 policy)

```text
node_modules/@xessa/compiler/dist/index.js.map      sources: ["../src/index.ts"]      -> src exists
node_modules/@xessa/compiler/dist/setup-list.js.map sources: ["../src/setup-list.ts"]  -> src exists
node_modules/@xessa/compiler/dist/index.d.ts.map    sources: ["../src/index.ts"]      -> src exists
```

### Alias stub

```text
$ npm i xessa@0.1.1
added 1 package in 196ms
$ find node_modules/xessa -type f
LICENSE, README.md, bin/xessa.js, package.json              # exactly 4 files, no dependencies
$ npx xessa
The Xessa CLI is @xessa/cli — run: npx @xessa/cli --version
This package is only the npm alias xessa; it contains no compiler or CLI.
The VS Code extension is `xessa` on the Marketplace (publication deferred).
                                                            # exit 1
```

Alias observations (cosmetic, not defects to fix now): staged before the docs commit, so `gitHead` is
`417918f`; the published README still says `0.1.0`; the manifest exposes the monorepo
scripts/devDependencies/workspaces. Tarball name/version/bin are correct.

Node 20/22 remain unverified (Node 24.22.3 used). The extension stays at 0.1.0; PP4b/PP5b deferred.
