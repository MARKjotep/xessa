# CSSX-TT3 — Filesystem and output-planner stress

**Phase:** TT3 of `.ai/plans/CSSX-PLAN-TESTING.md` · **Status:** 🟡 complete, awaiting build verification (TT3 row left 🔴 — build flips it)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted · **Scope:** new files under `tests/stress/fs/**` only + this report

## Summary

- Implemented every row of plan §TT3 as an executed case: **9 files, 54 tests, 690 assertions, ~5.5 s**,
  all deterministic (`mkdtemp` projects, bounded polling, no wall-clock seeds) and repeated **3×** with
  54/54 pass each time.
- The plan's four "Paths/Links/Planner/Manifest/Rebuild/Interruption/Watch" areas are covered, plus the
  weakest-10 **#2**, **#3** and **#4** case lists assigned to TT3 (manifest/writer interruption +
  tamper, real-fs errors on `host/node.ts`, and the unicode/glob path matrix).
- **One requirement was already covered** and is not duplicated: read-only output directory
  (`tests/integration/cli-build.test.ts:209`). **Three defects/risks** are recorded with repros — two
  are pinned in-code as current behaviour with `CSSX-TT3 defect` comments and belong to TT8.
- Gates: `bun test tests/stress/fs/` **54/54**, `bun test tests/integration/` **55/55**,
  `bun run lint` **exit 0**, `bun run typecheck` **exit 0**. `bun run verify` is **red only because of a
  sibling worker's in-flight file** (`tests/stress/cli/concurrency.test.ts` → `ReferenceError: spawnCli
  is not defined`), not this change — details in *Gate results*.

## Changed paths

| Path | Change |
|---|---|
| `tests/stress/fs/helpers.ts` | **New.** Temp-project factory (canonicalized roots), CLI subprocess runner, `--json` report parser, manifest reader, recursive lister, bounded `waitFor`, and a cursor-based NDJSON watch harness (`awaitReady`/`nextBuild`/`nextBuildMatching`/`quietNextBuild`/`stop`). |
| `tests/stress/fs/paths.test.ts` | **New.** 6 cases — plan row "Paths". |
| `tests/stress/fs/glob.test.ts` | **New.** 7 cases — weakest-10 #4b/#4c glob + `exclude` matrix. |
| `tests/stress/fs/links.test.ts` | **New.** 6 cases — plan row "Links". |
| `tests/stress/fs/planner.test.ts` | **New.** 6 cases — plan row "Planner safety". |
| `tests/stress/fs/host-errors.test.ts` | **New.** 7 cases — weakest-10 #3 (real-fs errors on `host/node.ts`). |
| `tests/stress/fs/manifest.test.ts` | **New.** 9 cases — plan row "Manifest" + weakest-10 #2c/#2d. |
| `tests/stress/fs/rebuild.test.ts` | **New.** 5 cases — plan row "Rebuilds". |
| `tests/stress/fs/interrupt.test.ts` | **New.** 3 cases — plan row "Interruption" + weakest-10 #2b. |
| `tests/stress/fs/watch.test.ts` | **New.** 5 cases — plan row "Watch". |
| `.ai/reports/CSSX-TT3.md` | **New.** This report. |

Nothing else was touched: no source, no `package.json`, no plan, no existing test/fixture, no repo-tree
writes. (`git status` also shows `package.json` modified and `tests/stress/cli/**`,
`tests/stress/fuzz/**`, `.ai/reports/CSSX-TT4.md`, `CSSX-TT6.md` — all sibling workers' changes, not
mine. The `package.json` diff is TT1's `stress`/`stress:fuzz` scripts.)

## Cases implemented

### Paths — `paths.test.ts` (plan §TT3 "Paths", weakest-10 #4a)

| Case | file:line | Assertion |
|---|---|---|
| Spaces, emoji, NFC, 200-char segment, 30-level nesting build and mirror into `out/` | `paths.test.ts:50` | `success`, zero diagnostics, entries in discovery order, artifact set == manifest set == expected, every artifact contains the expected declaration, second build byte-identical |
| NFD directory name round-trips exactly as `readdir` reports it | `paths.test.ts:98` | stored name ∈ {NFC, NFD}; entry path, manifest path and artifact path all use the stored bytes |
| No NFC/NFD folding in `exclude` | `paths.test.ts:121` | on a folding volume (APFS here) the composed `exclude` matches and only `kept.cssx` builds; on a preserving volume the decomposed source still builds |
| `include: ["../outside/*.cssx"]` | `paths.test.ts:152` | discovery surfaces `../outside/escaped.cssx`, planner rejects it with **XESSA5001** "outside the workspace root", exit 1, sibling entry still builds, nothing written outside |
| `..` / absolute / `@setup` output directories | `paths.test.ts:186` | each escape → **XESSA5001** "escapes the workspace root", exit 1, no path created outside `ws/` |
| `@use "../../outside/tokens.cssx"` | `paths.test.ts:232` | **XESSA2001** "resolves outside the workspace root", exit 1, no artifact |

### Glob / exclude matrix — `glob.test.ts` (weakest-10 #4b/#4c)

| Case | file:line | Assertion |
|---|---|---|
| Multi-segment `**/**/**/*.cssx` at every depth incl. zero segments | `glob.test.ts:44` | matches `a.cssx`, `src/a.cssx`, `src/deep/er/a.cssx`; rejects `.css`/`.cssx.bak`; `staticDirectoryPrefix` = `""` |
| Nested braces `src/{a,{b,{c,d}}}.cssx` | `glob.test.ts:57` | expands to 4 patterns; matches c/d; root-anchored form does not match `src/c.cssx`; prefix = `src` |
| Unicode / whitespace / `?` segments | `glob.test.ts:72` | composed `é` matched by `caf?`, decomposed not; emoji and space directories match `src/**/*.cssx` |
| Lexical exclude (no folding) | `glob.test.ts:82` | NFC matches NFC, NFD does **not** match NFC; bare names match any segment; `node_modules_x` ≠ `node_modules` |
| Separator/`./` normalization | `glob.test.ts:94` | `./src/` → `src`, backslashes → `/` |
| Nested-brace discovery | `glob.test.ts:101` | `discoverSources` returns exactly `a,b,c,d`; `**/**/**` + exclude returns 5 |
| Unicode `exclude` end-to-end | `glob.test.ts:127` | excluded unicode file is absent from entries and from `out/` |

### Links — `links.test.ts` (plan §TT3 "Links", weakest-10 #3c)

| Case | file:line | Assertion |
|---|---|---|
| Symlinked source **directory** | `links.test.ts:39` | skipped by discovery (`glob.ts:216`), no warning, only the real sibling builds |
| Symlinked import **inside** workspace | `links.test.ts:58` | resolves through the link, 1 dependency, `padding: 4px` emitted |
| Symlinked import **outside** workspace | `links.test.ts:75` | **XESSA2001** "escapes the workspace root through …", no artifact |
| Self-referential + two-link symlink cycle | `links.test.ts:95` | two **XESSA2001** "cannot be resolved … does not exist", healthy entry still builds, completes < 30 s (anti-hang bound) |
| Dangling symlink import | `links.test.ts:129` | **XESSA2001** "cannot be resolved", no crash |
| Cyclic symlink as explicit file argument | `links.test.ts:145` | exit **2** with `{command, success:false, exitCode:2, error:"Source file not found: …"}` in `--json` |

### Planner safety — `planner.test.ts` (plan §TT3 "Planner safety")

| Case | file:line | Assertion |
|---|---|---|
| Output dir == source dir (`css-dir: "."`) | `planner.test.ts:40` | artifact beside source, manifest owns it, rebuild stable, generated `.css` never re-discovered |
| Output inside `exclude` | `planner.test.ts:63` | builds; a stray `.cssx` inside the excluded output dir is not a source; manifest is a valid v1 document |
| Existing non-artifact file at the target | `planner.test.ts:89` | overwritten with no warning (documented at `docs/known-limitations.md:41`), ownership taken, `clean` then removes it |
| Directory at the artifact path | `planner.test.ts:113` | **XESSACLI001** "Failed to write gen/a.css", exit 1, directory and its contents untouched, no `.cssx-tmp` residue |
| Two entries, one target | `planner.test.ts:134` | **XESSA5001** "collides with the already-planned target" on the second entry, exactly one artifact written |
| `css-name` == source name | `planner.test.ts:158` | **XESSA5001** "must end in .css", source untouched, nothing written |

**Skipped (already covered):** read-only output directory → `tests/integration/cli-build.test.ts:209`
(`chmod 0o555` → exit 1 + `XESSACLI001` + previous artifact byte-identical, root-skipped). Re-implementing
it would duplicate existing coverage; the plan row is satisfied.

### Real-fs host errors — `host-errors.test.ts` (weakest-10 #3)

| Case | file:line | Assertion |
|---|---|---|
| `readFile` ENOENT / EISDIR, `fileExists` semantics | `host-errors.test.ts:54` | rejection `code` is `ENOENT` / `EISDIR`; `fileExists` is false for a directory and a missing file, true for a file |
| `readFile` EACCES on an unreadable file | `host-errors.test.ts:71` | `code === "EACCES"` while `fileExists` still true (present-but-unreadable) — skipped only when root |
| `canonicalize` fallback + workspace root | `host-errors.test.ts:92` | root round-trips; symlink resolves to its target; ELOOP and ENOENT fall back to the lexical path; cyclic link is not a file |
| Missing entry + directory import through `compileProject` | `host-errors.test.ts:111` | **XESSA2001** "file not found" / "cannot be resolved", promise resolves (no throw) |
| **ENOENT mid-walk** | `host-errors.test.ts:133` | dependency deleted between the last existence check and the real read → **XESSA2001** ``Cannot read module "<path>".`` |
| EACCES through the CLI | `host-errors.test.ts:165` | **XESSA2001** *and* **XESSACLI002** (`build.ts:119`), exit 1, sibling artifact still written — skipped only when root |
| Directory named `*.cssx` | `host-errors.test.ts:193` | not a source; single-entry run exits 2 "Source file not found" |

### Manifest — `manifest.test.ts` (plan §TT3 "Manifest", weakest-10 #2c/#2d)

| Case | file:line | Assertion |
|---|---|---|
| Deleted manifest | `manifest.test.ts:80` | build succeeds, zero warnings, manifest recreated with the entry and its real hash |
| Truncated JSON | `manifest.test.ts:94` | warning "invalid JSON", exit 0, manifest rewritten, previous artifact **kept as an orphan** (ownership lost) |
| Tampered hash + `clean` | `manifest.test.ts:112` | `skipped[… "modified"]`, file kept, warning, manifest emptied |
| Tampered hash + prune | `manifest.test.ts:128` | "Not removing … modified since generation; ownership released", file kept, manifest drops it |
| Tampered paths (`../../outside`, `/etc/hosts`) | `manifest.test.ts:148` | two "Ignoring unsafe … path" warnings, outside file untouched, `clean` deletes only the real artifact |
| Malformed entries + unknown version | `manifest.test.ts:180` | three "malformed" warnings; "unsupported manifest version" warning; nothing crashes |
| Manifest from a different project | `manifest.test.ts:204` | exit 0, `errors` empty, foreign records reconciled, final manifest holds only this project's artifacts |
| Manifest path replaced by a directory | `manifest.test.ts:238` | `errors` "Could not update .cssx-manifest.json", exit 1, artifacts written, no temp residue |
| In-workspace tampered record, matching hash | `manifest.test.ts:253` | `clean` deletes the user file → **recorded risk**, pinned with a comment |

### Rebuilds — `rebuild.test.ts` (plan §TT3 "Rebuilds")

| Case | file:line | Assertion |
|---|---|---|
| `@setup` destination change | `rebuild.test.ts:61` | stale `a.css` pruned, `b.css` written with identical bytes, manifest holds only `b.css` |
| Hand-edited obsolete artifact | `rebuild.test.ts:79` | kept with "ownership released" warning, no longer in the manifest, stable on a third build |
| `clean` vs hand-edited output | `rebuild.test.ts:106` | owned artifact deleted, edited artifact skipped + reported, manifest emptied but still present |
| `clean` with a missing artifact | `rebuild.test.ts:129` | `skipped[… "missing"]`, exit 0, record dropped |
| Two identical builds | `rebuild.test.ts:141` | CSS and manifest bytes identical |

### Interruption — `interrupt.test.ts` (plan §TT3 "Interruption", weakest-10 #2b)

| Case | file:line | Assertion |
|---|---|---|
| SIGKILL mid-write, then clean build | `interrupt.test.ts:121` | `signal === "SIGKILL"`; 0 < rewritten < 120; every surviving artifact is **byte-equal to its pre-edit or final bytes**; the rebuild converges to 120 artifacts + a 120-record manifest; only dot-prefixed `.cssx-tmp` residue allowed |
| Killed **first** build | `interrupt.test.ts:202` | each artifact present at kill time is byte-identical to the file a clean build produces (per-file atomicity under SIGKILL) |
| Orphaned `.cssx-tmp` | `interrupt.test.ts:240` | survives a rebuild **and** `clean` → **defect pinned** (see below) |

### Watch — `watch.test.ts` (plan §TT3 "Watch")

| Case | file:line | Assertion |
|---|---|---|
| ≥20 rapid edits in one tick | `watch.test.ts:60` | last edit lands; total builds ≤ 3 (initial + ≤2 coalesced cycles); every build succeeds; ≤1 entry per rebuild; other artifact untouched |
| Rename in place | `watch.test.ts:99` | new artifact written, old one pruned, full-rediscovery build contains both entries |
| File created in a watched dir / dir deleted | `watch.test.ts:127` | new artifact appears; deleting the directory prunes every artifact below it; final tree is exactly the two survivors |
| Brand-new **nested** directory | `watch.test.ts:160` | no rebuild at all (bounded 600 ms probe), artifact absent, touching another source does not help, **config edit recovers** → **defect pinned** |
| File inside `exclude` touched | `watch.test.ts:209` | no build within 400 ms, build count stays 1, no artifact for it |

## Behaviour notes recorded by these cases

- **Exotic paths build.** Spaces, emoji (`U+1F3A8`), composed `é`, a 200-character segment and 30-level
  nesting all build in one project; artefact paths, manifest paths and `readdir` agree byte for byte.
  Project-layer output is `out/src/<dir>/<stem>.css` — the `src/` segment is repeated because the CLI
  passes only directories as `projectConfig`, so `sourceRootFor` never sees `include`
  (`docs/known-limitations.md` §3 already documents the repetition).
- **Unicode is lexical everywhere; nothing normalizes.** `packages/compiler/src/output/paths.ts` and
  `packages/cli/src/glob.ts` compare strings exactly. On this APFS volume the filesystem *folds*
  composed/decomposed names, so the tests assert "mirror what `readdir` reports" rather than a fixed
  form, and the exclude case branches on the volume policy. On a preserving volume an authored NFC
  `exclude` silently misses an NFD directory — recorded as behaviour, not changed.
- **Discovery is not confined to the workspace root.** An `include` of `../outside/*.cssx` walks the
  parent directory and returns `../outside/…` entries; the *planner* then rejects them with `XESSA5001`,
  so the escape never reaches a write.
- **Symlink matrix.** Source *directories* are skipped silently (`glob.ts:216`); import targets are
  canonicalized, so inside-workspace links work and outside-workspace links are `XESSA2001`; cycles
  (self and two-link) degrade to `realpathSync` ELOOP → lexical fallback → `fileExists` false →
  `XESSA2001`, never a hang or a stack overflow.
- **Host-error matrix.** `readFile` propagates the raw `fs` error (`ENOENT`/`EISDIR`/`EACCES`);
  `fileExists`/`canonicalize` swallow errors (`host/node.ts:60-76,79-85`); the module graph converts
  every case into `XESSA2001`, and the CLI adds `XESSACLI002` for its own source read (`build.ts:119`).
  An ENOENT injected mid-walk still yields `Cannot read module`, i.e. there is no unwrapped throw path.
- **Manifest matrix.** Classification is warn-and-ignore for: invalid JSON, non-object document, wrong
  `version`, non-array `files`, malformed record, escaping path, and duplicate path. All leave the build
  succeeding (exit 0) with a rewritten manifest. The one hard failure is a manifest path that cannot be
  written (directory in the way) → `errors[]` + exit 1, artifacts already on disk.
- **Ownership matrix.** `build` overwrites configured destinations regardless of ownership
  (`docs/known-limitations.md:41`); deletion (prune or `clean`) requires a byte-identical hash; a
  modified file is kept, reported and released. Consequence: a truncated manifest permanently orphans
  previously generated artifacts.
- **Rebuild matrix.** Changing a `@setup` destination prunes the old artifact in the same run; a
  hand-edited old artifact survives and is dropped from the manifest.
- **Interruption reliability.** Killing on "the first artifact changed" is reliable: **5/5** runs killed
  with 2–3 of 200 entries written in the discovery probe, and 5/5 in the final 120-entry shape (4–8
  written). Rename-based per-file atomicity held in every run: no artifact was ever a prefix or a
  mixture. The *temporary* file's survival is timing-dependent — **1 of 5** runs at 120 tiny entries,
  **4 of 5** at 200 larger entries — so the defect is pinned twice: conditionally on the SIGKILL
  observation, and deterministically by planting the orphan and asserting no sweep (see Defect 1).
- **Watch matrix.** 20 edits coalesce into ≤2 cycles (a cycle that is invalidated mid-build is
  discarded as stale and costs one extra event); rename triggers a full rediscovery and prunes; files
  added/removed inside a watched directory behave incrementally; an `exclude`d file produces no event
  at all because its directory is never watched.

## Defects found (TT8 task candidates)

### Defect 1 — an interrupted build leaves a `.cssx-tmp` orphan that nothing ever removes (low severity)

- **Where:** `packages/cli/src/writer.ts:38-57` — `atomicWrite` creates
  `.<name>.<pid>.<counter>.cssx-tmp` in the destination directory and removes it only inside its own
  `catch` (`:52`). Nothing sweeps stale temporaries, and `clean` only walks manifest records
  (`commands/clean.ts:59-87`).
- **Repro (deterministic, `interrupt.test.ts:240`):**
  1. build a project once;
  2. create `out/src/.a.css.999999.1.cssx-tmp` with any partial content (exactly what a killed process
     leaves);
  3. `xessa build` → exit 0, no warning, no artifact at that path, the orphan is still there;
  4. `xessa clean` → exit 0, `out/src/a.css` removed, the orphan is still there.
- **Observed under real SIGKILL:** 1/5 runs (120 small entries) and 4/5 runs (200 larger entries) left
  such a file; it survived the following clean build every time.
- **Why it matters:** dot-prefixed litter inside `dist/` is published by naive copy steps; nothing
  reconciles it, and `clean` gives a false "workspace is clean" impression.
- **Not fixed here:** source is outside this worker's write set. Asserted as pinned current behaviour
  with a `CSSX-TT3 defect` comment.
- **Suggested fix (TT8):** sweep `*/.cssx-tmp` under each output directory at the start of a build, or
  age them out; a `clean --force`-style sweep would need a spec/plan decision.

### Defect 2 — a brand-new nested directory is never discovered by a running watcher (medium severity)

- **Where:** `packages/cli/src/commands/watch.ts:144` — `if (!filename.endsWith(".cssx")) return;`
  drops the parent directory's event for the new directory name, and `syncWatchers` (`:159-176`) only
  attaches watchers for directories that already hold a known source.
- **Contradicts:** `docs/known-limitations.md:44` ("A brand-new deep directory is picked up through its
  parent's event").
- **Repro (`watch.test.ts:160`):** start `xessa watch --json` on `include: ["src/**/*.cssx"]` with
  `src/one.cssx`; `mkdir src/fresh` + write `src/fresh/five.cssx`; no build event within 600 ms and no
  `out/src/fresh/five.css`; editing `src/one.cssx` rebuilds only `one.cssx` and the new source stays
  invisible; only a config edit (full rediscovery) or a restart picks it up.
- **Impact:** a developer adding a component directory sees stale output until they touch the config or
  restart the watcher — the exact workflow a watcher exists to remove.
- **Not fixed here:** source is outside this worker's write set. Asserted as pinned current behaviour
  (including the recovery path) with a `CSSX-TT3 defect` comment.
- **Suggested fix (TT8):** schedule a full rediscovery for directory events (or on any non-`.cssx`
  filename that is not a known output), keeping the current output-feedback guard by matching the
  known output directory names rather than the extension alone.

### Recorded risk (not classified as a defect, no task proposed)

`clean` trusts any **in-workspace** manifest record whose hash matches, so a corrupted or hand-edited
manifest can delete a non-artifact user file (`manifest.test.ts:253`: `notes.txt` with its true hash is
removed). Escaping paths are rejected (`manifest.ts:108`), but in-workspace paths are indistinguishable
from real artifacts by design (`docs/known-limitations.md:41` documents the conservative direction only).
Pinned as current behaviour; a stronger ownership marker (e.g. recording the artifact `kind` +
extension) would be a specification change, not a bug fix.

## Sharp edge found while building the harness (not a defect claim)

`compileProject(entries, host, { projectRoot })` compares the entries' canonical paths against the
*lexical* `projectRoot`. On macOS `os.tmpdir()` yields `/var/folders/…` while the real path is
`/private/var/folders/…`, so passing a lexical temp root produced a spurious
`XESSA2001 Import "./dep.cssx" resolves outside the workspace root "/tmp/…"` in the first probe.
`helpers.ts` therefore canonicalizes every temp root with `realpathSync` before use. The CLI is immune
(`process.cwd()` is already canonical); API consumers under a symlinked workspace path are not. Worth a
sentence in the API docs; no test asserts it, because asserting the lexical root would pin a sharp edge
rather than the intended contract.

## Skips and limitations

| Item | Status | Reason |
|---|---|---|
| Read-only output dir (EACCES → typed diagnostic + exit 1) | **Skipped — already covered** | `tests/integration/cli-build.test.ts:209` (chmod `0o555` → exit 1, `XESSACLI001`, previous artifact byte-identical, root-skipped). |
| `EACCES` cases (`host-errors.test.ts:71`, `:165`) | `test.skipIf(isRoot)` | `chmod` cannot deny reads to root, so the case would be vacuous; the same guard exists in the integration suite. Not a defect skip. |
| Deterministic "temp file must exist after SIGKILL" | **Not assertable** | Whether the kill lands between `writeFile` and `rename` is a timing window (observed 1/5 at 120 entries, 4/5 at 200). The SIGKILL case asserts the *safe* properties unconditionally (no torn artifact, convergence) and pins the orphan conditionally; the defect itself is pinned deterministically by the planted-orphan case. |
| `bun test` budget | Bounded as required | 54 tests / ~5.5 s, no `XESSA_SOAK`-style gating needed. |
| Browser gate | Not run | No emitted-CSS change in this phase (tests only). |

## Commands run and outcomes

| Command | Outcome |
|---|---|
| `bun test tests/stress/fs/paths.test.ts` | 6 pass — first harness validation (3 assertion bugs fixed: discovery sort order, `listFiles` prefix, baseline) |
| `bun test tests/stress/fs/` (×3, incl. after biome formatting) | **54 pass / 0 fail / 9 files**, 690 expect() calls, 6.37 s / 5.58 s / 5.41 s / 5.35 s — no flakes |
| `bunx biome check --write tests/stress/fs` | 10 files checked, 9 formatted |
| `bun run lint` | ✅ exit 0, `Checked 458 files … No fixes applied` |
| `bun run typecheck` | ✅ exit 0 |
| `bun test tests/integration/` (4 runs) | ✅ **55 pass / 0 fail / 6 files** in 3 runs (5.4 s, 5.5 s, 30.6 s); 1 run had a single transient failure while the suite took 30.6 s — timeout-shaped and matching the pre-existing `cli-watch` flake recorded in `.ai/reports/CSSX-TT0.md` (1/3 full runs there). This phase touches no package source, so it cannot be causal. |
| `bun run verify` (run 1) | ❌ `1101 pass / 2 fail / 72 files` — both failures are `tests/stress/cli/concurrency.test.ts` (**sibling worker's in-flight file**, `ReferenceError: spawnCli is not defined` at `:96`); `typecheck` and `lint` inside the same `verify` both passed |
| `bun run verify` (run 2, final) | ❌ `1103 pass / 2 fail / 72 files`, same two failures only |
| `bun test tests/stress/cli/concurrency.test.ts` (isolated) | ❌ `0 pass / 2 fail` — reproduces without this change, confirming the failure is that file's own state |
| `bun /tmp/temp-residue-probe.ts` | 5× SIGKILL probe: 5/5 killed, 4–8 of 120 artifacts written, 1/5 left a `.cssx-tmp` |

Pre-existing/sibling failures are reported separately and were **not** touched (they live in
`tests/stress/cli/**`, owned by the TT4 worker). A TT4/TT8 follow-up should confirm
`concurrency.test.ts` is green before the campaign closes.

## Acceptance criteria

| Criterion | Status |
|---|---|
| Every plan §TT3 row implemented or recorded as not-implementable | ✅ 8/8 rows executed; read-only output dir recorded as already covered with file:line evidence |
| `bun test tests/stress/fs/` green | ✅ 54/54, 3 consecutive runs |
| Existing suites unaffected | ✅ `tests/integration/` 55/55; `bun run lint`/`typecheck` clean |
| `bun run verify` green | ❌ blocked by a sibling worker's file (`tests/stress/cli/concurrency.test.ts`, reproduced in isolation as `0 pass / 2 fail`); everything this phase owns is green, re-run needed once TT4 lands |
| No file outside `tests/stress/fs/**` (+ this report) modified | ✅ |

## Handoff

**Done:** all nine files under `tests/stress/fs/**`, 54 deterministic cases covering every TT3 row plus
weakest-10 #2/#3/#4; two defects pinned with `CSSX-TT3 defect` comments and repros; one recorded risk;
this report.

**Remaining for build:** confirm the case table against the files, then flip the TT3 row in
`## Implementation Progress` to 🟢 **after** `bun run verify` is re-run on a tree where the TT4 concurrency
file compiles.

**Next action for TT8:** create `.ai/tasks/CSSX-TT3-defects.md` (or two task files) from Defect 1 and
Defect 2 above, and add `.ai/todo.md` entries; decide whether `docs/known-limitations.md:44` should be
corrected to match the watcher's actual behaviour if Defect 2 is not fixed in this campaign.

**Touched files:** `tests/stress/fs/{helpers,paths,glob,links,planner,host-errors,manifest,rebuild,interrupt,watch}.test.ts`
(plus `helpers.ts`), `.ai/reports/CSSX-TT3.md`.
