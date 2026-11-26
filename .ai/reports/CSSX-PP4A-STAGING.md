# CSSX PP4A — npm Staging (@xessa/compiler, @xessa/cli 0.1.0)

**Status: 🟢 READY — staged.** The packed CLI manifest now carries `"@xessa/compiler": "0.1.0"`; a
clean tarball-only consumer install, `npx xessa --version`, an ESM compiler import and a two-file
`build`/`check` all pass. Remaining gate: npm auth is the owner's step (`npm whoami` fails in this
environment; publish from the owner's authenticated terminal). Nothing was published.

Repo: `/Users/Marky/Desktop/$/xessa` @ `62aec9b` (+ this change), npm 11.19.1, Bun 1.4.5, Node 24.22.3.

## Build sanity

| Check | Result |
| --- | --- |
| `bun run --cwd packages/compiler build` | exit 0 |
| `bun run --cwd packages/cli build` | exit 0 |
| `node packages/cli/dist/index.js --version` | `0.1.0` (exit 0) |
| `bun -e 'import("@xessa/compiler")…'` in `packages/cli` | `function` (workspace link intact) |

## Resolution (2026-11-26)

Root cause: npm 11.19.1 does **not** rewrite the `workspace:` protocol at pack/publish; the previous
staging packed `"@xessa/compiler": "workspace:*"` verbatim and a clean install died with
`EUNSUPPORTEDPROTOCOL`. Applied fix and additions:

1. `packages/cli/package.json` — `"dependencies": { "@xessa/compiler": "0.1.0" }` (exact pin replaces
   `workspace:*`). A new compiler release therefore requires bumping this pin to the same version
   before the CLI is published.
2. Both manifests — `engines.node >=20`, `repository` (`https://github.com/MARKjotep/xessa.git` with
   per-package `directory`), `homepage`, `bugs`, `publishConfig.access: "public"`.
3. `bun install` refreshed `bun.lock` (only the CLI dependency spec changed); local workspace
   resolution still links `packages/cli/node_modules/@xessa/compiler → ../../../compiler`.
4. No `prepack`/`prepublishOnly` added — the release gate builds before publish.

## Tarballs (fresh `npm pack --pack-destination $TMP`, outside the repo)

| Package | Bytes | Unpacked | Files | SHA-256 |
| --- | --- | --- | --- | --- |
| @xessa/compiler | 242913 | 1036456 | 323 | `effa054ac083be0db127ce2a30061dd10fe4ed5703bf45194d4c30c50ebfc232` |
| @xessa/cli | 85551 | 387108 | 89 | `d984fc9f086d7d78877ab3fa48c691010462904f911058ad4b0abc9e88c12252` |

Packed CLI manifest (verbatim, from the tarball):

```json
"dependencies": {
  "@xessa/compiler": "0.1.0"
}
```

File counts unchanged (323 / 89), matching the recorded release table in `docs/release.md`.

## Dry-run publish (safe, nothing written to registry)

| Command | Exit | Notes |
| --- | --- | --- |
| `npm publish --workspace @xessa/compiler --access public --dry-run` | 0 | 323 files, 242.9 kB, shasum `c1918d98…`, public/latest |
| `npm publish --workspace @xessa/cli --access public --dry-run` | 0 | 89 files, 85.6 kB, shasum `4d814c16…`, public/latest |

npm repacks for publish, so the dry-run shasums differ from the recorded pack above; both exit 0 and
neither writes to the registry. Dry-run still does not prove dependency resolvability — the consumer
smoke test below does.

## Consumer smoke test (tarballs only, new temp project)

```sh
TMP=<pack destination>; C=$(mktemp -d); cd "$C"
npm init -y
npm install "$TMP/xessa-compiler-0.1.0.tgz" "$TMP/xessa-cli-0.1.0.tgz"   # exit 0
```

`added 2 packages` — no registry lookup was needed and none occurred. `npm ls --all` shows
`@xessa/cli@0.1.0 └── @xessa/compiler@0.1.0 deduped` with both packages as real directories (not
symlinks), proving the packed CLI resolves the packed compiler, not the workspace.

| Check | Result |
| --- | --- |
| `npx xessa --version` | `0.1.0`, exit 0 |
| ESM `import { compile } from "@xessa/compiler"` | `function` |
| `compile(".btn {…} .card {…}", { file: "snippet.cssx" })` | 0 diagnostics; `.btn{color:red;padding:4px;}.card{color:blue;}` |
| Two-file project (`tokens.cssx` `module: true`; `button.cssx` `@use "./tokens.cssx"`) → `npx xessa build` | exit 0, `2 entries, 2 files written, 0 warnings` |
| Generated CSS | `.button{color:#4f46e5;padding:8px;}` (token values merged from the module) |
| Generated map | `app.map.js` written; `export const button = "button";` |
| `npx xessa check` | exit 0, `2 entries checked, 0 errors, 0 warnings` |

## Blocker history (2026-11-26, before the fix — kept for the record)

Packed CLI manifest retained the protocol verbatim; a clean consumer install failed:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

No manifest was modified during that first staging pass; both candidate fixes were recorded, and the
exact-pin fix above was applied.

## Remaining owner step

`npm whoami` → `E401 Unauthorized` in this environment. The owner must authenticate and run, from the
repo root (order matters — compiler first):

```sh
npm publish --workspace @xessa/compiler --access public
npm publish --workspace @xessa/cli --access public
```

## Observations

- CLI ships TypeScript `src/` (18 files) plus `.map` files in both packages; intentional but adds
  ~40% to the CLI tarball.
- Source maps reference `../../src/*.ts` that consumers do not receive for the compiler.
