# Xessa rename — report

**Status:** 🟢 PASS (2026-11-27)

## Baseline

- Branch `main`, commit `b31ea374aea002be6a78bf392dec6c1f052c3bde`.
- Remote: `origin https://github.com/MARKjotep/<old-name>.git` (fetch/push). No commit, push, tag,
  reset or stash was performed.
- Working tree was **dirty before this task**: 21 modified paths (`.ai/PROGRESS.md`,
  `.ai/reports/CSSX-PP4B-VSIX-CHECKLIST.md`, `.ai/todo.md`, `AGENTS.md`, `CHANGELOG.md`, `README.md`,
  `docs/compatibility.md`, `docs/known-limitations.md`, `docs/usage.md`, four `examples/**` sources,
  `packages/vscode/README.md`, `packages/vscode/src/intelligence.ts`,
  `packages/vscode/src/property-docs.ts`, two `packages/vscode/test/ui/*.js`,
  `tests/extension/provider.intelligence.test.ts`) plus untracked
  `.ai/reports/CSSX-EDITOR-PROPS-VENDOR.md`. Those user changes were preserved; the rename was applied
  over them. Generated artifacts present: `packages/*/dist`, a stale `packages/vscode/<old-name>-0.1.0.vsix`,
  workspace links and `node_modules/.vscode-test-<old-name>`.

## Decisions applied

1. Full public rebrand to Xessa: packages, CLI/bin, config filename, language ID, TextMate scopes,
   diagnostic codes, env vars, extension identity, repository URLs, filenames and prose.
2. Kept `.cssx`, `.cssx-manifest.json`, `.cssx-tmp`, the `cssx` token, `CSSX-*` report names and CSSX
   history.
3. Rewrote historical records (CHANGELOG, `.ai/reports`, plans, ADRs) under the clean-slate decision.
4. Root package is a private, unpublished workspace root; the CLI is `@xessa/cli`, compiler
   `@xessa/compiler`, language service `@xessa/language-service` (npm rejected the unscoped root name).
5. Repository URLs → `https://github.com/MARKjotep/xessa.git`,
   `https://github.com/MARKjotep/xessa#readme`, `https://github.com/MARKjotep/xessa/issues`.
6. VS Code extension: `name`/`displayName`/`publisher` `xessa`, language ID `xessa`, aliases
   `["Xessa","xessa"]`, scope `source.xessa`, grammar `./syntaxes/xessa.tmLanguage.json`, activation
   `onLanguage:xessa`, commands/config keys `xessa.*`.
7. Diagnostic codes `XESSA####`, CLI codes `XESSACLI###`, env vars `XESSA_*`.
8. `.git` retained for independent verification.

## Replacement and file changes

Ordered replacement applied to 417 tracked/untracked text files: old scoped root name → `xessa`,
old scope prefix → `@xessa/`, old uppercase env prefix → `XESSA_`, old uppercase brand token →
`XESSA`, title-case brand → `Xessa`, lowercase brand → `xessa`. Excluded `node_modules/`, `.git/`,
`dist/`, `out/`, `coverage/`, `playwright-report/`, `test-results/`, `.vscode-test/`, `*.vsix`,
binary image/font assets, `.DS_Store` and `bun.lock`.

Renamed: `bin/<old>.js`→ a root `xessa` pointer stub (later removed on 2026-11-27 when the
unscoped root publish was rejected);
`packages/vscode/syntaxes/<old>.tmLanguage.json`→`xessa.tmLanguage.json`;
`examples/{overrides,groups}/<old>.config.json`→`xessa.config.json`;
`tests/fixtures/cli/{basic,broken,config-unknown-key}/<old>.config.json` and
`tests/fixtures/config/project-json/<old>.config.json`→`xessa.config.json`; cached
`node_modules/.vscode-test-<old>`→`.vscode-test-xessa`. Deleted the stale
`packages/vscode/<old>-0.1.0.vsix` and stale workspace links (`node_modules/@<old>`,
`packages/cli/node_modules/@<old>`, `node_modules/.bin/<old>`).

## Key corrections

- Root `package.json`: `name: xessa`, `bin.xessa` (both `bin` and the pointer stub were later removed;
  the root is now private and unpublished), release assertions expect `@xessa/compiler`,
  `@xessa/cli`, extension `xessa`, language `xessa`, `.cssx`.
- The root pointer stub (removed 2026-11-27) stated the CLI is `@xessa/cli`; the unscoped root is
  private and unpublished, so the unscoped root cannot serve as a CLI entry point.
- README/release/HANDOVER/todo/usage now state the root is a private, unpublished workspace package
  and the CLI is `@xessa/cli` (npm rejected the unscoped root name as too similar).
- `docs/release.md`: "npm alias" → "Root package", root row updated, old tag/commit claims removed.
- ADR-0001 directory reference `chiky` → `xessa`; root package wording corrected. ADR-0013 keeps
  `.cssx` and reads coherently for Xessa (historical old-extension prose only; no functional
  `.xessa` extension was introduced).

## Validation

| Command | Exit | Result |
|---|---|---|
| `bun install` | 0 | Lockfile regenerated with root name `xessa`; workspace links repaired |
| text search for old brand (excludes as specified) | 1 | No matches (grep returns 1 for no match) |
| filename search for old brand (tracked tree) | 0 | No matches |
| `bun run typecheck` | 0 | All four packages clean |
| `bun run lint` | 0 | Biome, 460 files, no fixes |
| `bun run test` | 0 | **1362 pass / 2 skip / 0 fail**, 99 files |
| `bun run release:check` | 0 | Verify green, **Playwright 96/96**, metadata valid, compiler tarball 398 files, CLI 89, nine examples built, VSIX produced |
| VSIX check | 0 | `packages/vscode/xessa-0.1.0.vsix` (18 files, 144.67 KB); extension name/publisher/language/grammar all `xessa`; no stale-brand VSIX |
| `bun.lock` scan | 1 | No old scope or old brand names |

The current environment lacks `rg`; the prescribed `rg` checks were run with equivalent `grep`/`find`
commands and identical excludes. No tracked text or filename leftovers remain.

## Post-verification version correction

Independent verification found the root manifest at `0.0.1`. Read-only Git evidence:

```text
$ git show HEAD:package.json | sed -n '1,10p'   # name line elided in this report
  "version": "0.1.1",

$ git diff HEAD -- package.json
-  "version": "0.1.1",
+  "version": "0.0.1",
```

So `HEAD` and the pre-rename worktree were `0.1.1`; the `0.0.1` edit was accidental. A repository
search found `0.0.1` only in root `package.json` (other hits were `127.0.0.1`); compiler `0.1.1`,
CLI `0.1.1`, language service `0.1.0` and extension `0.1.0` were unchanged, and examples declare no
version. The same stray edit had also expanded the one-line `files` and `workspaces` arrays, which
made `bun run lint` fail Biome formatting; those arrays were restored to their `HEAD` one-line form.
The version was restored to `0.1.1`; no other field was changed.

Re-run results after the fix:

| Command | Exit | Result |
|---|---|---|
| `bun run typecheck` | 0 | Clean |
| `bun run lint` | 0 | Biome, 460 files |
| `bun run test` | 0 | **1362 pass / 2 skip / 0 fail**, 99 files |
| `bun run release:check` | 0 | Playwright **96/96**, metadata valid, tarballs 398/89, nine examples, VSIX 18 files / 144.67 KB |
| old-brand text/filename scans | 1 / 1 | No matches |

## Final working tree

- `git status --porcelain`: 435 entries — 6 renames plus 2 rename/modify (staged), 425 modified, this
  report intent-to-add, and the pre-existing untracked `CSSX-EDITOR-PROPS-VENDOR.md`.
- `git diff HEAD --stat`: 435 files changed, 5060 insertions(+), 3970 deletions(-).
- The baseline was dirty, so `git add -A` was not used; `git mv` staged the renames and `git add -N`
  registered this report. Nothing was committed, pushed, tagged, reset or stashed.

## Exceptions / caveats

- `packages/vscode/media/logo-source.png` (binary, retained per instructions) still contains the
  literal string; binary assets were excluded from replacement. SVG metadata text was updated without
  changing artwork.
- `node_modules/.vscode-test-xessa/**` retains old-brand `1-<Brand>.log` filenames from earlier test
  runs; `node_modules` is ignored and outside the tracked tree.
- `bun.lock` regeneration moved `@types/node` from `22.20.5` to `22.20.7` (within its declared `^22`
  range). No dependency was added, removed or declared differently; this was unavoidable to replace
  the stale old scoped root workspace name using `bun install` rather than hand-editing the lockfile.
- The workspace root `xessa` is private and unpublished, not the CLI; the CLI is `@xessa/cli`.
  Marketplace publisher `xessa` and npm `@xessa` scope must exist before future publication. Icons
  were retained.

## Next action

Independent verification of `git diff HEAD`, then removal of `.git` and publication decisions.

## Framework triage and final cleanup (2026-11-27)

- **Framework records.** The six external-consumer records under `.ai/framework/` (`bugs/` ×1,
  `features/` ×5) carried the old brand; the ordered replacement was applied to those six files only
  and a triage section was appended to each. Summary: `.ai/framework/TRIAGE.md`. Their cited
  `tests/features/xessa-compiler.test.ts` is not in this repository.
- **One confirmed bug.** `bugs/runtime-token-merge-order-first-wins.md` — unqualified `styles`
  imports: `SPECIFICATION.md` §6.2/§6.3 and ADR-0016 require later-in-merge-order wins with no
  diagnostic, but `resolveUnqualified` keeps the first provider and raises `XESSA2001`. Decision:
  add a repo-local regression fixture/test first, then fix; no behavior change in this task. The five
  feature records are closed as deliberate contract / capability gap / spec-mandated / ergonomics
  (see `TRIAGE.md`).
- **Independent gate (previously run, not rerun for this docs-only task).** Green: verify
  1362 pass / 2 skip / 0 fail, Playwright 96/96 (chromium, firefox, webkit), 9 examples built,
  tarballs 398/89 files, VSIX `xessa-0.1.0.vsix` 18 files / 144.67 KB. One known watcher flake
  appeared once under load and passed on a clean rerun.
- **`bun run lint` after the docs change.** Passes (460 files). Before it passed, root `package.json`
  had a pre-existing formatting regression (the `files`/`workspaces` arrays had been expanded
  multi-line vs. `HEAD`, making Biome fail); they were restored to the `HEAD` one-line form with no
  semantic change.
- **Left untouched:** the pre-existing uncommitted `examples/portfolio/src/sections.cssx` edit
  (`grid-template-columns: minmax(0, 1fr) @lg 3;` and `gap: $space.loose @lg 3;` at lines 38-39).
  `@lg 3` is not valid CSS inside a declaration value and the generated portfolio CSS inherits it;
  this predates the rename and was not repaired or reverted here.
- **`.git` removed** by the owner's authorization after recording the final state below. No commit,
  push, tag, reset, stash or new repository initialization was performed.

### Final state immediately before `.git` removal

Captured after this report was updated (only this appended block was still unwritten at capture time):

```text
$ git rev-parse HEAD
b31ea374aea002be6a78bf392dec6c1f052c3bde

$ git status --porcelain=v1 | head -20
 M .ai/HANDOVER.md
 M .ai/PROGRESS.md
 M .ai/plans/CSSX-PLAN-GROUPS.md
 M .ai/plans/CSSX-PLAN-PRODUCTION.md
 M .ai/plans/CSSX-PLAN-TESTING.md
 M .ai/plans/CSSX-PLAN-UI.md
 M .ai/reports/CSSX-0.1.1-STAGING.md
 M .ai/reports/CSSX-A01.md
 M .ai/reports/CSSX-A02.md
 M .ai/reports/CSSX-A03.md
 M .ai/reports/CSSX-A04.md
 M .ai/reports/CSSX-A05.md
 M .ai/reports/CSSX-A06.md
 M .ai/reports/CSSX-A07.md
 M .ai/reports/CSSX-A08.md
 M .ai/reports/CSSX-A09.md
 M .ai/reports/CSSX-A10.md
 M .ai/reports/CSSX-A11.md
 M .ai/reports/CSSX-A12.md
 M .ai/reports/CSSX-A13.md

$ git diff --stat HEAD | tail -3
 tests/stress/soak/watch-soak-case.ts               |   4 +-
 tests/stress/soak/watch-soak.test.ts               |  20 +-
 435 files changed, 5087 insertions(+), 3970 deletions(-)
```

`git status --porcelain=v1` returned 436 entries (425 modified + renames plus untracked
`.ai/framework/` and `.ai/reports/CSSX-EDITOR-PROPS-VENDOR.md`); branch `main`, nothing staged or
committed by this task.
