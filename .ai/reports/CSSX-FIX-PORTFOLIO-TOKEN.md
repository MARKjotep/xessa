# CSSX-FIX-PORTFOLIO-TOKEN — report

## Summary

- Fixed the single stale token reference in `examples/portfolio/src/layout.cssx:84`:
  `calc(100% - 2 * $space.gutter)` → `calc(100% - 2 * $space.gutters)`. The definition in
  `src/tokens.cssx:33` already reads `gutters: 20px`; the importer was left behind by the owner
  rename test, and `XESSA2001` ("does not export `$space.gutter` through namespace `$space`")
  surfaced it through the config-less example check.
- Provenance: owner rename test → stale importer reference → XESSA2001 surfaced by
  `tests/integration/cli-config.test.ts` "config-less examples…". The catcher behaved correctly;
  **no compiler, CLI or editor change** was needed, and the `gutters` definition was not reverted.
- Rebuilt the portfolio example config-less after rebuilding `@xessa/compiler` + `@xessa/cli`.
  `xessa check --json` now exits **0** with zero diagnostics, and the generated CSS resolves the
  token (`min(1160px, calc(100% - 2 * 20px))`).
- Two consecutive builds produced **byte-identical** `portfolio.css` and `portfolio.map.js`.
- All gates green: `verify` 1345 pass / 2 skip / 0 fail (99 files), `release:check` exit 0 with
  96 browser tests passed, `lint` exit 0 (458 files).

## Changed files

| Path | Change |
| ---- | ------ |
| `examples/portfolio/src/layout.cssx` | one reference `$space.gutter` → `$space.gutters` |
| `examples/portfolio/generated/styles/portfolio.css` | rebuilt (561 bytes→ current, minified) |
| `examples/portfolio/generated/maps/portfolio.map.js` | rebuilt |
| `.ai/tasks/CSSX-FIX-PORTFOLIO-TOKEN.md` | new task record |
| `.ai/reports/CSSX-FIX-PORTFOLIO-TOKEN.md` | this report |

Nothing else was edited. Top-level `package.json` was not touched; `release:check` regenerated the
usual ignored gate artifacts (`packages/vscode/xessa-0.1.0.vsix`, per-example generated output) as
part of its normal run.

## Baseline → after

| Check | Before | After |
| ----- | ------ | ----- |
| `xessa check --json` in `examples/portfolio` | exit 1, 1 × XESSA2001 at `layout.cssx:84:38` | exit 0, 0 diagnostics |
| `bun run verify` | 1344 pass / 2 skip / 1 fail | 1345 pass / 2 skip / 0 fail |
| `bun run release:check` | n/a (blocked by verify) | exit 0 |
| `bun run lint` | green | exit 0 |

## Evidence

```
# after fix
CHECK_EXIT=0  success true errors 0

# build 1 and build 2
BUILD1_EXIT=0  BUILD2_EXIT=0
562ba7cbda0625ae509e015bd8220c290e1be02817650f433d96bbe4d8749a60  generated/styles/portfolio.css
2d4283c3a1b80184c77bc7327645396a631211f1d043dc3bb98c490b5f4028cd  generated/maps/portfolio.map.js
  (identical hashes on both runs; unchanged again after release:check)

VERIFY_EXIT=0  1345 pass  2 skip  0 fail  (99 files, 996325 expect() calls)
RELEASE_EXIT=0  browser: 96 passed (1.6m); metadata + tarball + all 9 examples + vsix OK
LINT_EXIT=0     Checked 458 files in 319ms. No fixes applied.
```

### Pre-existing flake observed (not caused by this task)

One intermediate full-suite run reported 1344 pass / 1 fail in
`tests/stress/fs/watch.test.ts:113` ("handles a rename in place by rediscovering and pruning the
old artifact"), asserting the pruned `out/src/two.css` is gone. The test passed **3/3 in isolation
immediately afterwards**, and the next full `verify` (plus `release:check`'s verify) was green. This
is a load-sensitive watcher timing race in a file outside this task's write set, unrelated to the
CSSX token reference. Reported separately rather than "fixed" here; no assertion was weakened.
