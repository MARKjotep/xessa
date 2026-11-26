# CSSX-PP4A — Published `@xessa/compiler@0.1.0` audit

- Date: 2026-11-26
- Repo HEAD: `8c4c64c` (working tree had pre-existing modifications: `bun.lock`, `package.json`, `packages/cli/package.json`, untracked `package-lock.json`; none touched)
- Method: registry queries + `npm pack` in temp dirs; no publish/tag/commit; no repo writes other than this report
- Temp roots: `$TMPDIR/xessa-audit.BqTAuA`, `xessa-local.waMQdM`, `xessa-consumer.Z7gV5o`, `xessa-cli.lqxKmj`, `xessa-cliproj.toxVmI`

## Status: PASS

Registry package is installable, self-contained and reproducible. CLI consumer path against the published compiler works end to end.

## PP4a completion — both artifacts published (2026-11-26)

- `@xessa/compiler@0.1.0` published first (323 files; integrity `sha512-aAKqebvb…kzFRqw==`).
- `@xessa/cli@0.1.0` published the same day, after this compiler audit: **89 files**, 85,550 B packed,
  387,120 B unpacked, integrity
  `sha512-tbRmwcP+qdZQeNrbkrQYL9z9QdgTKEGPI7HswmoCXFt78A93SjEXjTjesWdvqCIHiZHYjVvRUW+hPyajrXd0/Q==`.
- Published CLI tarball SHA-256 `53d0d5882370eeafaaeb3a58f40d00191b0fb641ac8930b7251b4b08912a0077` is
  byte-identical to `npm pack --workspace @xessa/cli` on `8c4c64c` (89 entries, `cmp` clean).
- Published CLI manifest pins `"@xessa/compiler": "0.1.0"` and `bin.xessa: "./dist/index.js"`.
- Registry versions for both packages: `0.0.0-stage` and `0.1.0` only — no `0.1.1`, no other extra.
- Clean-environment post-release verification: `.ai/reports/CSSX-PP5A.md` (PASS; two doc mismatches
  recorded as 0.1.1 follow-ups). PP4b (Marketplace) remains deferred.

## Registry metadata

| Field | Value |
| --- | --- |
| version / latest | `0.1.0` |
| versions | `0.0.0-stage`, `0.1.0` |
| license | MIT |
| engines | `node >=20` |
| repository | `git+https://github.com/MARKjotep/xessa.git`, `directory: packages/compiler` |
| homepage / bugs | GitHub readme / issues |
| dependencies, peer, optional | absent (no output) |
| main / types | `./dist/index.js` / `./dist/index.d.ts` |
| exports | `.` → types/import/default all `./dist/*` |
| sideEffects | `false` |
| dist | 323 files, 242,913 B packed, 1,036,456 B unpacked, shasum `c1918d98…5097692`, integrity `sha512-aAKqebvb…kzFRqw==` |
| `@xessa/cli` | E404 at audit time — later published 2026-11-26 at 0.1.0 (see completion section) |

## Published tarball audit

- 323 entries — matches `dist.fileCount`. Composition: 80 `*.js`, 80 `*.d.ts`, 160 `*.js.map`/`*.d.ts.map`, `package.json`, `README.md`, `LICENSE`.
- Manifest verbatim: no `dependencies`/`peerDependencies`/`optionalDependencies`, `files: ["dist"]`, `main`/`types`/`exports` → `./dist/*`, `engines.node >=20`, `repository.directory: packages/compiler`, `homepage`, `bugs`, `publishConfig.access: public`, `sideEffects: false`. No `workspace:*` anywhere.
- `README.md`, `LICENSE`, `dist/index.js`, `dist/index.d.ts` present. No `src/`, `test/`, `node_modules/`, `*.tgz`, `.env`, lockfiles, hidden files, or secret patterns (`npm_*`, `ghp_*`, `AKIA*`, `xox*`, private keys): none found.
- Source maps: all 80 `*.js.map` are shipped with **no** `sourcesContent`; every `sources` entry resolves outside the tarball (`../../src/...`), so debuggers cannot load original TS. Cosmetic only.

## Local vs published

`npm pack --workspace @xessa/compiler` → 323 files, 242,913 B, identical integrity **and** identical SHA-256 (`effa054ac083…ebfc232`). Sorted file lists `diff` clean. Build is byte-for-byte reproducible; no timestamp-driven divergence.

## Registry-only compiler consumer

Fresh project, `npm i @xessa/compiler@0.1.0` → 1 package. Installed manifest byte-identical to tarball; `dist/index.d.ts` present; `npm ls` shows no transitive deps. ESM `import { compile }` with `naming: { strategy: "prefix", prefix: "ui" }` on a snippet using `@variables` tokens + `@md`/`@xl` inline variants: 0 diagnostics, `classes = {"button":"ui-button"}`, tokens substituted (`12px`), `@media (min-width: 768px)` and `(min-width: 1280px)` emitted, `$spacing` absent from CSS. Assertions passed.

## CLI tarball resolution (real consumer path)

`npm pack --workspace @xessa/cli` → `xessa-cli-0.1.0.tgz`, 89 files, 85,550 B. Installed in a fresh project **without** the compiler tarball: npm resolved `@xessa/compiler@0.1.0` from `https://registry.npmjs.org/@xessa/compiler/-/compiler-0.1.0.tgz`; `npm ls` shows `@xessa/cli@0.1.0 └── @xessa/compiler@0.1.0`. `npx xessa --version` → `0.1.0`. Two-file project (`theme.cssx` module + `button.cssx` entry): `xessa check` → `1 entry checked, 0 errors, 0 warnings`, exit 0; `xessa build` wrote `button.css` + `button.map.js`, exit 0. Project mode with `xessa.config.json` (`include: ["src/**/*.cssx"]`) → `3 entries checked`, build wrote 4 files under `dist/styles` and `dist/maps`, exit 0. Multi-arg invocation correctly exits 2 (`accepts at most one file argument`).

## Discrepancies (non-blocking for the compiler)

1. Shipped `README.md` still says "Not on npm yet — the 0.1.0 publication is parked" and its sample omits `await` although `compile` returns `Promise<CompileResult>`. Misleading now that 0.1.0 is live; needs a docs-only 0.1.1.
2. Stale build artifact in the tarball: `dist/output/importPath.{js,d.ts,js.map,d.ts.map}` (≈6.2 KB) — source is `import-path.ts`, nothing imports `importPath.js`. Residue of a rename with a non-clean `dist`; harmless duplicate surface.
3. `0.0.0-stage` remains publicly installable (2 files, published 2026-11-26T14:35Z). Not `latest`; consider `npm deprecate`.
4. Source maps point at unshipped `src/` and carry no `sourcesContent`.
5. CLI-side pre-publish issue: `packages/cli` `files` includes `"src"`, so its tarball ships 25 source files (compiler deliberately ships `dist` only).

## Verdict

The compiler publication is sound: metadata, manifest, file set, hygiene and byte-reproducibility all check out, and both a registry-only library consumer and a CLI tarball consumer resolve and run correctly against it. **The CLI is safe to publish** — its pinned `@xessa/compiler@0.1.0` resolves from the registry and `build`/`check` succeed. Recommended before publishing: drop `"src"` from `packages/cli` `files`, fix the compiler README (npm status + `await`), and optionally clean the stale `dist/output/importPath.*`; none are functional blockers.
