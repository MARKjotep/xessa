# CSSX-EXAMPLE-MODULES — zero-maintenance modules example

## Summary

- Added the ninth example, `examples/modules/`: four `.cssx` files and **no `exclude` list**. The
  token, card and ribbon files declare `@setup { module: true; }`; only `src/main.cssx` emits.
- One stylesheet is merged in ADR-0014 order — tokens (values only) → card → ribbon → entry `.page` —
  and written to two `css-dir` destinations, `client/app.css` and `generated/styles/app.css`, with
  identical bytes.
- `ribbon.cssx` combines `module: true` with `map-inherit: false`: `.ribbon` is present in the CSS
  and absent from `app.map.js`. The map exports `card`, `cardIcon` and `page`.
- Committed output is minified by default (ADR-0022). Two builds, a `clean` + rebuild and
  `release:check`'s rebuild all produced identical hashes; `clean` removed only the three artifact
  records and left the hand-written `client/index.html`.
- Registered in `release:check` (nine examples), `docs/release.md`, `README.md`, `docs/usage.md`,
  `CHANGELOG.md`; `biome.json` ignores the extra generated CSS copy.

## Status: PASS

## Changed paths

New example:

- `examples/modules/xessa.config.json` — `include: ["src/**/*.cssx"]`, no `exclude`; strict compiler,
  safe media grouping.
- `examples/modules/src/tokens.cssx` — `module: true`, `@variables` only.
- `examples/modules/src/components/card.cssx` — `module: true`; `.card`, `.card:hover`,
  `.card-icon`; imports its own tokens.
- `examples/modules/src/components/ribbon.cssx` — `module: true; map-inherit: false;`; `.ribbon`.
- `examples/modules/src/main.cssx` — entry: token import, two `styles` imports, `.page`, `css-dir`
  list, map paths.
- `examples/modules/client/index.html` — hand-written page linking `app.css`; not a compiler artifact.
- `examples/modules/README.md` — six requested sections (no exclude, merged order, map inheritance,
  `css-dir` list, minified default, bundler opt-in).
- Committed build output: `client/app.css`, `generated/styles/app.css`,
  `generated/maps/app.map.js`, `.cssx-manifest.json`.

Updated:

- `package.json` — `release:check` builds `examples/modules/xessa.config.json` after `portfolio`
  (eight → nine example builds).
- `docs/release.md` — step 6 says nine examples and lists `modules`.
- `README.md` — repository-layout example list and “nine working examples”.
- `docs/usage.md` — “nine working projects”, examples index row, “nine example directories”.
- `CHANGELOG.md` — `[0.1.0]` examples bullet and release-gate count.
- `biome.json` — ignored `examples/modules/client/app.css` (generated, intentionally minified) in
  addition to the existing `examples/*/generated` pattern.
- `.ai/tasks/CSSX-EXAMPLE-MODULES.md`, this report.

No compiler, CLI or editor source changed. `.ai/plans/CSSX-PLAN-PRODUCTION.md` and the todo board
were not edited.

## Generated output inventory

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `examples/modules/client/app.css` | 512 | `1db4f978…fcf609` |
| `examples/modules/generated/styles/app.css` | 512 | `1db4f978…fcf609` |
| `examples/modules/generated/maps/app.map.js` | 93 | `8fc1969c…517a84f` |
| `examples/modules/.cssx-manifest.json` | 617 | `fd4cc419…88943ba` |

Manifest records exactly three artifacts: `client/app.css` (css), `generated/styles/app.css` (css),
`generated/maps/app.map.js` (js), all sourced from `src/main.cssx`.

`app.css` (512 B, one line):

```css
.card{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#ffffff;color:#0f172a;}.card:hover{border-color:#4f46e5;}.card-icon{width:24px;height:24px;color:#4f46e5;}.ribbon{display:inline-block;padding:4px 12px;border-radius:999px;background:#4f46e5;color:#ffffff;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;}.page{max-width:640px;margin:0 auto;padding:24px;background:#f8fafc;color:#0f172a;font-family:system-ui, sans-serif;}
```

## Map content proof

```js
export const card = "card";
export const cardIcon = "card-icon";
export const page = "page";
```

- `page`, `card`, `cardIcon` present.
- `grep -q 'export const ribbon' generated/maps/app.map.js` → no match; `grep -c 'ribbon'` → `0`.
- `grep -c 'ribbon' generated/styles/app.css` → `1` (the rule is still merged).
- No `import "…css"` line: `import-css` remains the default `false`.

## Determinism and clean evidence

- Build 1 and build 2 via `node packages/cli/dist/index.js build --config
  examples/modules/xessa.config.json` produced identical hashes for all four files (`diff` of sorted
  `shasum -a 256` output empty); each build reported `4 entries, 3 files written, 0 warnings`.
- `xessa clean --config …` reported `3 files removed, 0 skipped`; only the two CSS copies and the map
  were deleted. `client/index.html`, sources, config and README remained. The manifest became
  `files: []`.
- Rebuild restored the same hashes. `release:check` rebuilt the example again; the four hashes were
  unchanged afterwards.

## Gates

| Command | Exit | Evidence |
|---|---|---|
| `bun run --cwd packages/compiler build && bun run --cwd packages/cli build` | 0 | `tsc` for compiler and CLI |
| `node packages/cli/dist/index.js build --config examples/modules/xessa.config.json` (×2, plus restore build) | 0 | 4 entries, 3 files, 0 warnings; byte-identical |
| `node packages/cli/dist/index.js clean --config examples/modules/xessa.config.json` | 0 | 3 removed, 0 skipped; `index.html` retained |
| `bun run verify` | 0 | typecheck + lint green; **1283 pass / 2 skip / 0 fail** across 95 files, test duration 65.93 s; host 14 scenarios / 866 assertions |
| `bun run release:check` | 0 | nine example builds including `modules`; browser **96/96** (1.3 m); internal test duration 66.68 s; metadata valid; tarballs 315/89; VSIX 18 files / 136.06 KB |
| `bun run lint` | 0 | 452 files checked, no fixes (216 ms) |

## Notes for PP3/PP4

- The example intentionally proves that a build with **no `exclude`** is quiet: modules are
  discovered as entries and write nothing. A future converter-style workflow should preserve this
  property instead of relying on config exclusions.
- `client/app.css` is generated outside `generated/`, so it needs its own Biome ignore. Any tooling
  that enumerates `examples/*/generated` must also account for `examples/modules/client/app.css`.
- `.cssx-manifest.json` is gitignored repository-wide; the file is present on disk and needs the
  usual forced add when committing the example.

## Handoff

Status **PASS**. Added `examples/modules/` (sources, no-exclude config, hand-written page, committed
minified output, README) and registered it as the ninth example in `release:check`, release docs,
README, usage index and CHANGELOG; Biome ignores the extra generated `client/app.css`. Output: two
512 B identical CSS copies, a 93 B map exporting `page`/`card`/`cardIcon` with no `ribbon`, and the
617 B manifest. Two builds, clean→rebuild and `release:check` all reproduced identical hashes;
`clean` removed only the three artifact records. Gates: compiler/CLI build 0, verify 0 (1283/2/0),
release:check 0 (browser 96/96, VSIX 18 files), lint 0. PP3/PP4 should keep the no-exclude quiet-build
property and remember the extra generated CSS path for future ignore lists.
