# CSSX-PP2 — Metadata and docs finalization (+ PP1 shebang correction)

## Summary

- **Stage 1 (shebang):** `packages/cli/src/index.ts` now starts `#!/usr/bin/env node`; the built
  `dist/index.js` matches and `node packages/cli/dist/index.js --version` prints `0.1.0`, exit 0.
  A source-level pin in `tests/integration/scaffold.test.ts` holds before any dist build. PP1
  residual #1 is resolved; residual #2 (`bunx xessa` from the repo root) is unchanged and pre-existing.
- **PP2a:** the placeholder slug `github.com/xessa/xessa` is gone. `packages/vscode/package.json`
  keeps its three URL shapes (`…xessa.git`, `…#readme`, `…/issues`) with the owner-decided
  `MARKjotep` slug; `docs/release.md` step 1 records the 2026-11-26 replacement instead of asking
  for one.
- **PP2b:** `CHANGELOG.md` is one consolidated `[0.1.0] - 2026-11-26` entry covering the shipped
  compiler, CLI and extension, the language additions, the editor wave, the 19-defect campaign,
  CSSX-A52 as a breaking map-format change, semantic tokens, `examples/portfolio`/`docs/usage.md`
  and the known-limitations link.
- **PP2c:** `portfolio` is the eighth release example (committed output reproduced byte-for-byte),
  browser totals are 96/96 / 32 per engine, stale bin/default-object/`import-css` references are
  cleaned, and §2/usage reflect the shipped behavior and settings.

## Shebang evidence (Stage 1)

```text
$ head -1 packages/cli/src/index.ts
#!/usr/bin/env node
$ head -1 packages/cli/dist/index.js
#!/usr/bin/env node
$ node packages/cli/dist/index.js --version
0.1.0                                   # exit 0
```

Pin test: `CLI source entry uses the Node shebang so the built bin runs without Bun`
(`tests/integration/scaffold.test.ts`; targeted run 5 pass / 0 fail, 12 expects).

Rebuild: `bun run --cwd packages/cli build` exit 0 (≈0.9 s, `tsc -p tsconfig.json` clean).

## PP2a — URL proof

```text
$ grep -rn "xessa/xessa" packages docs README.md
                                        # no output, exit 1
```

`packages/vscode/package.json` now carries:

```json
"repository": { "type": "git", "url": "https://github.com/MARKjotep/xessa.git" },
"homepage": "https://github.com/MARKjotep/xessa#readme",
"bugs": { "url": "https://github.com/MARKjotep/xessa/issues" }
```

The `release:check` metadata assertion (truthy `vscode.repository.url`, `homepage`, `bugs.url`)
passed with the new slug.

## PP2b — Changelog summary

Single `[0.1.0] - 2026-11-26` entry; the former `[Unreleased]` content was folded in, not dropped.

- Naming (`.cssx`, ADR-0013) and the extension identity.
- Language: setup/media/nesting/variables/imports plus `@group` (ADR-0017), `$keyframes` namespace
  (ADR-0015/ADR-0018) and the entry-wins runtime token override (ADR-0016); minification, native
  at-rule pass-through and the source-preserving cascade.
- Compiler API, CLI (including the Node-shebang distribution claim) and the VS Code extension.
- Editor intelligence A45–A51 (completion recovery, 25 function tooltips, `property: ;`, units,
  148 named colors, 35 hex palette, swatches) and U07's `!` trigger with bang repair.
- **Changed — breaking for class-map consumers:** CSSX-A52 one named `export const` per class, no
  default export, no object literal; opt-in `map-types` with `emit-types` deprecated; no CSS
  side-effect import and `import-css`/`output.importCss` removed; `XESSA4001` collision warnings.
- Fixed: the 19-defect integration campaign list (formatter terminator/sigil, nesting/span bounds,
  CLI watch/clean/exit codes, editor analysis/completion repairs).
- Zero-config semantic token colors (CSSX-COLOR-TOKENS); eight examples incl. `portfolio`;
  `docs/usage.md`; link to `docs/known-limitations.md`.
- Verification records 1226 pass / 2 skip / 0 fail and 96/96 browser. The tag lands at PP4; bump the
  date if the owner releases later.

## PP2c — Four items

1. **Portfolio in the gate.** Root `package.json` appends
   `bun packages/cli/src/index.ts build --config examples/portfolio/xessa.config.json` after `groups`;
   `docs/release.md` says eight examples and lists `portfolio`. A temp-dir build (config rooted in the
   copy) produced `generated/styles/portfolio.css` and `generated/maps/portfolio.map.js`; `diff -r`
   against the committed output reported **IDENTICAL**. The release gate built all eight examples
   with zero warnings.
2. **Browser counts.** `docs/compatibility.md` (96/96, 32 per engine), `docs/cascade.md` §5 (96
   passed, 32 each) and `README.md` (96/96) now use PP0's actuals; no `75/75` or 25-per-engine
   references remain.
3. **Stale references.** `docs/usage.md`'s source-checkout command now runs
   `bun packages/cli/dist/index.js` (no `src/index.ts` bin path). The node-shebang wording replaced
   the old Bun-shebang caveat in `docs/usage.md`, `docs/compatibility.md`, `docs/known-limitations.md`
   and `packages/cli/README.md`. Docs already described the map as named exports with no default
   export; the only `import-css` mention left is ADR-0014's historical “setting was removed”
   amendment. The README install note is clean (`dist` entry, Node or Bun).
4. **Known limits / usage.** `docs/known-limitations.md` §2 no longer presents the two fixed
   packaging blockers as gaps; it records the Node-compatible bin + node shebang and the trimmed
   VSIX. `docs/usage.md` matches the shipped CLI flags/exit codes and the four extension settings
   (`compileOnSave`, `editor.formatOnSave`, `editor.completePropertyWithSemicolon`,
   `previewSplitEditor`).

## Gates (sequential, real output)

| Gate | Exit | Elapsed | Output |
|---|---|---|---|
| `bun run verify` | 0 | 69 s | **1226 pass / 2 skip / 0 fail**, 994 864 expects, 1228 tests / 89 files; host **14 scenarios / 856 assertions** (`semantic-tokens=21`) |
| `bun run release:check` | 0 | 155 s | verify + Playwright **96 passed** (1.3 m) + builds + metadata + packs + **eight** example builds + VSIX; compiler tarball **307** files, CLI **89**; `xessa-0.1.0.vsix` **18 files / 134.59 KB** |
| `bun run lint` | 0 | <1 s | `Checked 463 files in 224ms. No fixes applied.` |

## Changed paths

| Path | Change |
|---|---|
| `packages/cli/src/index.ts` | shebang → `#!/usr/bin/env node` |
| `tests/integration/scaffold.test.ts` | source-first-line pin |
| `packages/vscode/package.json` | repository/homepage/bugs → `MARKjotep/xessa` |
| `package.json` | eighth example (`portfolio`) in `release:check` |
| `CHANGELOG.md` | consolidated `[0.1.0] - 2026-11-26` entry |
| `docs/release.md` | URL step, eight examples, VSIX 134.59 KB |
| `docs/compatibility.md`, `docs/cascade.md`, `README.md` | browser totals 96/96; node-shebang row |
| `docs/known-limitations.md` | §2 closure + node shebang; VSIX 134.59 KB |
| `docs/usage.md`, `packages/cli/README.md` | shebang wording, dist bin path |
| `.ai/reports/CSSX-PP1.md`, `.ai/plans/CSSX-PLAN-PRODUCTION.md` | residual resolved; PP1/PP2 rows |
| `.ai/tasks/CSSX-PP2.md`, `.ai/reports/CSSX-PP2.md`, `.ai/PROGRESS.md` (P12) | records |

## Residuals carried forward

- `bunx xessa` from the repository root still does not resolve the workspace package (no root install
  link); pre-existing, does not affect registry users. Unchanged from PP1 #2.
- The VSIX size is now 134.59 KB because the longer owner slug is in `package.json`; file count is
  unchanged at 18.
- Note: `bun run verify` counts moved from 1225 to **1226** pass because the new shebang pin adds one
  test (1228 total); the 89-file count is unchanged.

## Handoff

- **Stage 1:** PASS. **Stage 2:** PASS (PP2a/PP2b/PP2c).
- **Shebang:** src `#!/usr/bin/env node`, dist `#!/usr/bin/env node`;
  `node packages/cli/dist/index.js --version` → `0.1.0`; pin test
  `CLI source entry uses the Node shebang so the built bin runs without Bun`.
- **PP2a:** `grep -rn "xessa/xessa" packages docs README.md` → no output (exit 1).
- **PP2b:** single 0.1.0 entry dated 2026-11-26 with the A52 breaking change called out; tag at PP4.
- **PP2c:** portfolio is the eighth example and reproduces committed output; 96/96 (32/engine);
  stale paths/settings/shebang wording fixed; §2 and usage match shipping.
- **Gates:** verify 0 / 69 s (1226-2-0; 89 files; 14/856); release:check 0 / 155 s (eight examples,
  96 browser, 307/89 tarballs, 18-file VSIX); lint 0 / <1 s.
- **PP3 inherits:** the three manual rows (native color picker, Dark+/Light+ token colors, portfolio
  theme toggle) unchanged. **PP4 inherits:** tag/date confirmation, publish order and the current
  artifacts (CLI 89-file tarball, 18-file / 134.59 KB VSIX, `MARKjotep` URLs).
