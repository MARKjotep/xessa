# CSSX-0.1.4-RELEASE-PREP

## Summary

- **PASS** — release metadata for the group-composition / group-keyframe-navigation / media-`+`
  work is prepared (`@xessa/compiler` and `@xessa/cli` `0.1.4`, VS Code extension `0.1.2`, private
  workspace root `0.1.1`), and the stress corpus expectations now include the new
  `tests/fixtures/groups/composed/` fixture without weakening any invariant.
- `bun run release:check` is green end to end: verify (1445 pass / 2 skip / 0 fail, 100 files),
  Playwright 96/96, compiler/CLI builds, metadata assertions, compiler 437 / CLI 89 file pack
  dry-runs, all nine examples, and `xessa-0.1.2.vsix` (17 files, 231.8 KB).
- Seeded mutation pins were re-chosen so the same two defect classes are still exercised: an at-rule
  prelude swallowing its terminator (`@u[se "./a.cssx";`) and adjacent variant markers in a value
  (`20px@md@xl`, `calc(… @md@md …)`). No test, assertion or invariant was deleted, skipped or
  loosened.
- Nothing was committed, tagged, pushed or published.

## Version Changes

| File | Change |
|---|---|
| `packages/compiler/package.json:3` | `0.1.3` → `0.1.4` |
| `packages/cli/package.json:3` | `0.1.3` → `0.1.4` |
| `packages/cli/package.json:23` | dependency pin `@xessa/compiler` `0.1.3` → `0.1.4` |
| `packages/vscode/package.json:5` | `0.1.1` → `0.1.2` (private, local VSIX) |
| `package.json:3` | unchanged, private workspace root stays `0.1.1` |
| `package.json:30` | `release:check` assertions: compiler `0.1.4`, CLI `0.1.4`, CLI pin `0.1.4` (and error text), extension `0.1.2` |
| `bun.lock:15/20/25/33` | workspace versions/pin match the manifests (`0.1.4`, `0.1.4`, `0.1.4`, `0.1.2`) |
| `CHANGELOG.md:7-33` | new `## [0.1.4] - 2026-11-28` entry above `0.1.3`; compiler = nested `@group` composition in definitions, defining-module scope, cycle/depth `XESSA2001`, formatter, ADR-0025; editor = composed defaults/hover/hints, definition/references/rename through composition sites, definition-only composition completion, group/keyframe definition+references, keyframe rename from `animation-name`, `@group`/`$keyframes.`/`$alias.` suggest retrigger, `@lg+` media chain; status words `not yet published` / local VSIX `0.1.2` |
| `packages/vscode/CHANGELOG.md:3-11` | new `0.1.2 — 2026-11-28` extension entry (local VSIX only) |
| `docs/release.md:6-15` | "Current status (2026-11-28)": 0.1.2 still live, 0.1.4 prepared and **not published**, root `0.1.1`, extension `0.1.2` local-only; 0.1.2 registry audit untouched |
| `docs/release.md:32` | metadata assertion sentence now `0.1.4`, `0.1.4`, `0.1.2` |
| `docs/release.md:60-64` | next-release CLI pin example/tarball now `0.1.4` |
| `docs/release.md:111-113` | versions table: live 0.1.2 plus prepared 0.1.4 rows; extension `0.1.2` |
| `docs/release.md:139` | recorded packaging output now `xessa-0.1.2.vsix` (17 files, 231.8 KB) |
| `docs/release.md:161-162` | prepared 0.1.4 dry-run tarball sizes (437 / 89) |
| `.ai/HANDOVER.md:3-18` | opening paragraph and status table: compiler/CLI `0.1.4` prepared, extension `0.1.2` local, root `0.1.1`, all new versions unpublished; published 0.1.2 history kept |
| `.ai/HANDOVER.md:27/42/124` | local VSIX name `xessa-0.1.2.vsix`; extension stays `0.1.2` in the current instructions |
| `README.md:19/131` | current claim fixed: extension `0.1.2`, gate produces `xessa-0.1.2.vsix`; the true "0.1.2 is live on npm" statement kept |
| `docs/known-limitations.md:29` | extension version claim `0.1.0` → `0.1.2` (local VSIX) |

Deliberately untouched historical records: `docs/release.md` 0.1.2 registry audit and published
tarball table, `.ai/reports/XESSA-0.1.2-PUBLISHED.md`, the `0.1.3` changelog entry (still an
unpublished working-tree entry), `.ai/plans/CSSX-PLAN-PRODUCTION.md`.

## Stress Expectation Updates

The new `groups/composed` fixture joins the shared corpus (68 fixtures; 7 711 code units; 27
groups+keyframes differential entries).

| File | Change |
|---|---|
| `tests/stress/fuzz/parser.test.ts:5,169` | "all 67 fixtures" → 68 in the header comment and `describe` name |
| `tests/stress/fuzz/parser.test.ts:10` | measured cost comment → `7 779` character prefixes / `3 268` token prefixes |
| `tests/stress/fuzz/parser.test.ts:172` | corpus length `67` → `68` |
| `tests/stress/fuzz/parser.test.ts:185-186` | character-prefix total `7_602` → `7_779`; comment now "68 fixtures / 7 711 code units ⇒ 7 779 prefixes, plus one per fixture" |
| `tests/stress/fuzz/parser.test.ts:202` | token-prefix total `3_197` → `3_268` |
| `tests/stress/fuzz/lexer.test.ts:117` | corpus length `67` → `68` |
| `tests/stress/fuzz/compile.test.ts:56` | corpus length `67` → `68` |
| `tests/stress/fuzz/roundtrip.test.ts:7,66,68` | same `67` → `68` in the comment, test name and length assertion |
| `tests/stress/fuzz/roundtrip.test.ts:139-146` | CSSX-T01 pin re-chosen: seed 5, budget 500, hash `56d5fa2b05643fdc`, fixture `variables/ambiguous-import` — the `imbalance` operator put `[` inside an `@use` prelude (`@u[se "./a.cssx";`), so the terminator is swallowed by the prelude; the formatter must not grow a second `;` |
| `tests/stress/fuzz/roundtrip.test.ts:162-174` | CSSX-T02 pins re-chosen: seed 7, budget 800, hash `f62cbd16e9f034d7`, fixture `media/inline-variants` (`20px@md@xl` in a padding value) and seed 6, budget 800, hash `be30d1b887f02576`, fixture `lexical/calc` (`@md@md` twice inside `calc()`); both keep adjacent markers adjacent across the round trip |
| `tests/stress/editor/differential.test.ts:240-241` | total `26` → `27`, `groups/` `20` → `21` (keyframes stays 6) |
| `tests/stress/README.md:36-37` | weakness rows #6/#7 corpus description `67` → `68` |

Before-and-after evidence for the pins (computed against the new 68-fixture corpus): both T02
sources parse with zero diagnostics and format idempotently; the T01 source formats as
`@u [se "./a.cssx";` on the first pass and is unchanged on the second (the pre-fix defect grew one
`;` per pass). The tests still assert `expectFixedPoint` plus the exact fixture id and hash, so a
shifted corpus or a re-broken formatter fails rather than silently passing.

## Validation

| Command | Outcome |
|---|---|
| `bun test tests/stress/fuzz` | PASS — 47 pass, 0 fail, 19 274 assertions (5 files) |
| `bun test tests/stress/editor/differential.test.ts` | PASS — 10 pass, 0 fail, 625 assertions |
| `bun test tests/stress` | PASS — 273 pass, 2 skip, 0 fail, 258 896 assertions (275 tests, 40 files), twice consecutively. One earlier run of the same command reported a single failure that did not reproduce in either clean run or in the gate (timing-sensitive stress threshold under load). |
| `bun run release:check` | **PASS (exit 0)** — all seven steps; verify 1445 pass / 2 skip / 0 fail across 1447 tests in 100 files; host suite 15 scenarios / 1006 assertions |
| ↳ `bun run test:browser` | PASS — 96/96 (Chromium, Firefox, WebKit) |
| ↳ compiler/CLI builds | PASS |
| ↳ metadata assertions | PASS — `package metadata: compiler, cli and vscode valid` |
| ↳ pack dry-runs | PASS — compiler `xessa-compiler-0.1.4.tgz` 437 files; CLI `xessa-cli-0.1.4.tgz` 89 files |
| ↳ nine examples | PASS — basic, responsive, variables, jsx, custom-output, overrides, groups, portfolio, modules |
| ↳ VSIX | PASS — `packages/vscode/xessa-0.1.2.vsix` (17 files, 231.8 KB) |
| `git diff --check` | PASS — exit 0 |

Gate log: captured in the session temp directory for this run (`release-check-0.1.4-final.log`); it is
not a committed artifact.

## Handoff

- Release metadata and the stress corpus expectations are complete and the full gate is green; the
  tree is ready for independent verification.
- No commit, tag, push, npm publish or Marketplace publication was performed. Explicit owner
  authorization is still required for the actual release.
- `examples/portfolio/generated/styles/portfolio.css` was regenerated by the gate from the owner's
  `layout.cssx`/`theme.cssx` edits and is intentionally left as generated output.
- Constraint compliance: only release metadata/docs (previous pass) and stress tests/comments (this
  pass) were edited; compiler/editor source, fixtures and dependencies are unchanged.
