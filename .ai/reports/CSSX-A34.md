# CSSX-A34 — G4a: `@group` golden fixture matrix

## Summary

- Phase **G4a** of `.ai/plans/CSSX-PLAN-GROUPS.md` is implemented: all **13 single-file** and
  **7 merged-build** cases of §8 exist under `tests/fixtures/groups/**` with byte-exact
  `expected/css` and `expected/diagnostics.json`, and every expected line was reviewed against
  ADR-0017 before being pinned.
- `tests/compiler/groups.golden.test.ts` (30 tests) compiles each case through the real
  `compileProject` build and asserts: byte-exact CSS, the catalog diagnostic policy
  (code/severity/`messageContains`/position-inside-span), that the diagnostic lives in the case's own
  entry file, deterministic repeat builds, and seven explicit ADR semantics the CSS text alone cannot
  name.
- No compiler source, doc set, example or board file changed; no pre-existing golden was edited. The
  only non-fixture edits are catalogue bookkeeping in four test harnesses that auto-discover
  `tests/fixtures/**/input.cssx` (golden/sourcemap/pipeline/parser) — see **Findings 1** for why that
  was unavoidable.
- `bun run verify` is green: **798 pass / 0 fail across 45 files**; `tests/compiler` is **645 pass /
  0 fail across 29 files**; `groups.golden.test.ts` alone is **30 pass / 163 expect calls**.

## Objective (as executed)

1. Read `AGENTS.md`, the plan (§6–§9), ADR-0017, `SPECIFICATION.md` §3.7, the fixture catalogue and
   the existing golden/merged runners.
2. Author the §8 inputs in the established fixture voice.
3. Compile them with the real compiler and **review every emitted line** against ADR-0017 before
   pinning; investigate anything surprising instead of pinning it.
4. Author `expected/diagnostics.json` in the documented catalogue format (positions inside the
   reported span, stable `messageContains` phrases).
5. Add the group runner, extend the fixture catalogue/README, and keep every pre-existing suite green.
6. Update the plan's G4 status with G4a evidence only; write this task/report/log.

## Changed files

| File | Change |
|---|---|
| `tests/fixtures/groups/**` (20 cases, 70 files) | **New.** 13 single-file cases (`input.cssx` + `expected/{css,diagnostics.json}`, plus `alias-group/tokens.cssx`) and 7 merged cases (`entry.cssx` + sibling `styles`/token modules + `expected/**`). |
| `tests/compiler/groups.golden.test.ts` | **New (30 tests, 163 expect calls).** Catalogue pin (13 single + 7 merged), per-case byte-exact CSS + diagnostics, entry-file assertion for every diagnostic, determinism, and the semantic spot checks listed below. |
| `tests/fixtures/README.md` | Group rows for all 20 cases (each names the ADR item it pins), merged-build layout note (`entry.cssx`), and the diagnostics-status note that `groups/**` author complete expectations now. |
| `tests/compiler/golden.test.ts` | Catalogue 54 → 67; group fixtures split into `groupFixtures` (13, pinned by id) and excluded from the two assertions that run a chain **without** the expansion pre-pass. Plain (39) and deferred (15) lists unchanged. |
| `tests/compiler/sourcemap.test.ts` | Catalogue 54 → 67; the byte-exact maps-off comparison runs on the 54 pre-group fixtures (the map-parity test still runs on all 67). |
| `tests/compiler/pipeline.test.ts` | Catalogue 54 → 67; `GROUP_SYNTAX_FIXTURES` pins the two group cases whose XESSA1001 is authored parser misuse. |
| `tests/compiler/parser.test.ts` | The same two ids added to the total-parsing guard's `parserOwned` set. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | Combined **G4** row 🔴 → 🟡 with the G4a evidence (the table has no separate G4a row; G4b/G4c stay open). Only that row. |
| `.ai/tasks/CSSX-A34.md`, `.ai/reports/CSSX-A34.md`, `.ai/reports/logs/CSSX-A34.log` | **New.** |

`git status --porcelain tests/fixtures` → `M tests/fixtures/README.md` and `?? tests/fixtures/groups/`
only: **no existing `expected/**` artifact changed.**

## The matrix, case by case (pinned semantic + evidence)

Single-file (`groups/<case>/input.cssx` → `expected/css`, `expected/diagnostics.json`):

| Case | Pinned ADR-0017 semantic | Golden evidence |
|---|---|---|
| `same-file` | item 3 — splice, never a filter: the definition's lines are kept even when the use site repeats the property | `.panel` emits `padding: 12px; border: 1px solid #ddd; color: black; padding: 20px; color: navy;` in that exact order (both `padding`s and both `color`s present); diagnostics `[]` |
| `no-override` | item 2 — an empty use-site block is valid and expands the defaults only | `.tile { padding: 12px; border-radius: 8px; }`; `[]` |
| `two-use-sites` | item 3 — independent expansion and unchanged safe grouping | two `.status` rules; `groupRuns("safe")` merges them into one block with both expansions in order and `border-radius: 0` last (no cross-contamination: the first rule keeps `4px`); `[]` |
| `unknown-group` | item 7 — XESSA2001, exactly the block omitted, emptied rule dropped | `.card` absent, `.kept { padding: 8px; }` present; `XESSA2001 "Unknown group \"@group.missing\""` at 2:3 |
| `duplicate-definition` | item 5 — XESSA2001 on the later definition, first wins | `padding: 12px` (not `40px`) + `color: navy`; `XESSA2001 "Duplicate group definition \"@group.card\""` at 5:1 (the later definition's start) |
| `group-position` | item 1 — position decides; no diagnostic | the same `@group.card { … }` is a top-level definition and a use site in `.panel` **and** in `.panel:hover`, both expanding (`padding: 12px`, then `padding: 16px`); `[]` |
| `nested-rule-in-definition` | items 1/7 — non-declaration statement is XESSA1001 and only it is omitted | `.title` rule gone, `padding: 12px` and `color: black` survive and expand, override `color: navy`; `XESSA1001 "…accepts declarations only…"` at 3:3 |
| `conditional-use-site` | item 7 / §9.1 — variant use site is out of v0.1 | whole statement omitted (no padding), `.panel { color: red; }`; `XESSA1001 "conditional group use site"` at 6:3 |
| `inline-variant-default` | item 8 — inline variant segments expand in authored order | base `padding: 8px`, then `@media (min-width: 768px) { padding: 12px }`, then `color: black; gap: 4px;`; `[]` |
| `important-default` | item 3 / ADR-0003 — `!important` binds per value segment | `display: flex !important;` precedes the plain `display: block;` in the same rule; `[]` |
| `empty-group` | item 1 — empty definition legal, inert, silent | no CSS from `@group.empty`; `.card { padding: 4px; }`; a non-empty group still expands through an empty use block (`.note { color: red; }`); `[]` |
| `group-named-keyframes` | item 5 — `@group.keyframes` is legal and independent of `$keyframes` | `@keyframes spin` emitted unchanged, `animation: spin 1s` resolved from `$keyframes.spin`, `@group.keyframes` expands `animation-duration: 0.5s`; `[]` |
| `alias-group` | items 5/7 — `as group` is reserved and the statement imports nothing | `.card { padding: 12px; }` (the sibling `tokens.cssx` token is not imported); `XESSA2001 "reserved directive name"` at 1:1 |

Merged (`groups/<case>/entry.cssx`, real `compileProject`):

| Case | Pinned ADR-0017 semantic | Golden evidence |
|---|---|---|
| `style-import` | item 4 — a `styles` module's group is usable in the entry | `.panel` = defining-module default `padding: 12px` (`$pad`), `border`, then override `padding: 20px`; `[]` |
| `token-only` | item 4, owner decision (a) — token-only imports expose no groups | 0-byte `expected/css` (existing `keyframes/token-only` convention); `XESSA2001 "Unknown group \"@group.card\""` at 4:3 |
| `ambiguous-import` | item 5 — two imported definitions, no local: ambiguous | only `.a-panel`/`.b-panel` emit (both definitions inert, `.panel` dropped); `XESSA2001 "Ambiguous group \"@group.card\""` at 5:3, message names `a.cssx` **and** `b.cssx` (asserted in the runner, since one `messageContains` cannot carry both) |
| `local-shadows-import` | item 5 — local wins, no diagnostic | `.panel { padding: 20px; padding: 24px; }` (never the imported `99px`), `.chrome` still merges; `[]` |
| `transitive-visibility` | item 4 — `entry styles→ b styles→ c`; C's group usable in the entry | `.c-note`, `.b-note`, `.panel { padding: 12px; padding: 20px; }` in depth-first merge order; `[]` |
| `cross-module-defining-tokens` | item 6 — defaults resolve in the defining module | `padding: 12px` (defining `$pad`) then `padding: 24px`; the entry's `pad: 40px` never appears (asserted: CSS does not contain `40px`); `[]` |
| `runtime-ref` | item 6, owner decision (b) — runtime ref in a default is XESSA2001 with that declaration omitted | `:root { --gap: 4px; }` and `.theme-note` still emit; `.panel { padding: 12px; color: navy; }` (only `gap` dropped); `XESSA2001 "@runtime token is not allowed in a group default"` at 4:3 |

## Golden review (plan §9)

Every `expected/css` was read line by line against ADR-0017 **before** it was written to disk, and
re-read after writing. Notes from that review:

- **Reviewed and accepted as intended:**
  - `two-use-sites` becomes one `.status` block. That is `groupRuns("safe")` merging two adjacent
    runs with identical selector/ancestors/condition/context while preserving declaration order —
    §5.3 unchanged by expansion, exactly what the case must pin.
  - `unknown-group`'s diagnostic span covers the whole use-site statement (2:3–4:4) and
    `nested-rule-in-definition`'s covers the offending statement's first token (3:3–3:4). Both are
    statement/construct-anchored, which is the README policy; the catalogue stores a position inside
    the span.
  - `runtime-ref` still emits `:root { --gap: 4px; }` although its only reference was rejected. That
    is the existing runtime contract (`runtime/basic`): a declared runtime token emits regardless of
    use. Not a group defect; the fixture pins both halves.
  - `group-named-keyframes` is a `dollar-ref` fixture (`$keyframes.spin`) and is therefore also
    listed as deferred by the plain catalogue — correct, since only the group suite asserts it.
- **No expectation was "fixed" to make a gate pass.** One output initially surprised me
  (`duplicate-definition` produced no diagnostic); it was investigated, found to be a
  `compile()`-path artefact rather than wrong group semantics, and the fixture pins `compileProject`
  instead (Finding 2).

## Verification

```sh
bunx tsc -p packages/compiler/tsconfig.json --noEmit      # exit 0, no output
bunx biome check .                                        # inside `bun run verify`
bun test tests/compiler/groups.golden.test.ts             # 30 pass, 0 fail, 163 expect() calls
bun test tests/compiler                                   # 645 pass, 0 fail, 29 files
bun run verify                                           # 798 pass, 0 fail, 789269 expect() calls, 45 files
git status --porcelain tests/fixtures                     # M README.md, ?? groups/ only
```

Per-file test counts after the change: `pipeline.test.ts` 71 (was 58 — the 13 group entries are now
enumerated instead of failing), `groups.golden.test.ts` 30 (new), `parser.test.ts` 55,
`golden.test.ts` 4, `sourcemap.test.ts` 8.

One full-suite run hit `tests/integration/cli-watch.test.ts` ("[button rebuild] timed out after
10000ms") under parallel load; the file passes on its own (3 pass) and the next full `bun run verify`
was 798/0. It is an fs-watch timing flake in a temporary project unrelated to fixtures, and it was not
weakened or skipped.

| Measure | Before this task (brief) | After |
|---|---|---|
| `bun test` total | 745 pass / 44 files | 798 pass / 45 files |
| `tests/compiler` | 593 pass / 28 files | 645 pass / 29 files |
| New test functions attributable to A34 | — | 30 (`groups.golden.test.ts`) plus the 13 group catalogue entries `pipeline.test.ts` now asserts successfully |
| Golden/fixture changes | — | 20 new cases; 0 pre-existing `expected/**` edited |

The remaining suite delta belongs to concurrent worker changes already present in the shared worktree
(A35 vscode/extension and the A29–A33 compiler work); none of those files were touched by this task.

## Acceptance mapping (plan §7 G4a)

- Every §8 case exists with byte-exact goldens → 13 + 7 directories; CSS compared byte-for-byte; the
  catalogue test fails if a case is missing or renamed.
- `expected/diagnostics.json` records the exact codes → eight cases carry one expectation each
  (six `XESSA2001`, two `XESSA1001`) and twelve carry `[]`; the runner enforces code, severity,
  message phrase, position-in-span and the reporting file.
- No pre-existing golden changes except the intentional fixture-catalog count → only
  `tests/fixtures/README.md` modified and `groups/` added.
- `bun run verify` green with the new fixtures counted → evidence above.
- Report lists each case with its pinned semantic and evidence → the two tables above.

## Findings, deviations and blockers

1. **Deviation (necessary, needs lead ratification): four catalogue harnesses edited.** The brief
   allowed `tests/compiler/golden.test.ts` (count row) and `groups.golden.test.ts`. Because
   `golden.test.ts`, `sourcemap.test.ts`, `pipeline.test.ts` and `parser.test.ts` all auto-discover
   `tests/fixtures/**/input.cssx`, adding the §8 single-file cases cannot leave them untouched:
   - `golden.test.ts`/`sourcemap.test.ts` byte-compare CSS through a chain that stops at `lower`, so
     they cannot observe group expansion at all (and would pin the *wrong* body if they did);
   - `pipeline.test.ts`/`parser.test.ts` hard-code the 54-entry catalogue and assume only `errors/*`
     diagnose at parse time, while §8 requires two group cases to be XESSA1001 parser errors.
   The edits are catalogue classification only (`group`-owned fixtures → new suite; 54 → 67;
   explicit allowlist for the two authored syntax cases). Net effect: every group byte-level claim is
   asserted by `groups.golden.test.ts`, which checks strictly more than the old chain could. No
   assertion was weakened, relaxed or deleted.
2. **Finding (compiler gap, out of scope): `compile()` drops resolver diagnostics for `@use`-free
   sources.** In `packages/compiler/src/index.ts` the no-`@use` memory-host branch sets
   `baseDiagnostics = parsed.diagnostics`, so `graph.diagnostics` — including the duplicate
   `@group` XESSA2001 from `resolver/groups.ts` — never reaches the result. Consequence: a
   single-file build of `duplicate-definition` via `compile()` reports nothing, while `compileProject`
   (the CLI build path) reports it correctly. `packages/**` is outside this task, so the fixture pins
   the `compileProject` path and this is handed to the lead as a follow-up; it is not a group-semantics
   defect and not pinned as intended behaviour anywhere.
3. **Diagnostic messages embed absolute canonical module paths** (`Unknown group … in "<abs>"`,
   `Ambiguous group …`). The catalogue stores only stable `messageContains` phrases; the merged
   ambiguity test asserts both defining module names (`a.cssx`, `b.cssx`). No format change was made
   (the README format has no file field, and all group diagnostics for these cases point at the
   entry).
4. **Not run (not owned):** the browser gate (`bun run test:browser`, scenarios D1–D5) is G4b. No
   unit/integration blocker remains, no compiler source change is requested, and no framework
   (Rossa/Yvee/Shweet) record was created — this is fixture authoring for Xessa, not a framework
   defect or feature request, so no framework version applies.

## Handoff

- **Completed state:** G4a is done — matrix, runners, catalogue rows, README rows, records; plan G4
  row now 🟡 with G4a evidence.
- **Validation:** see **Verification**; `tests/fixtures` clean apart from the intended additions.
- **Remaining steps:** G4b (browser harness/specs for D1–D5, 3 engines, pretty/minify, safe/none) and
  G4c (author docs). G4b can consume the semantics pinned here — in particular D2 (an inline-variant
  default beaten by a later base override) and D4 (`!important` default) are already fixed as
  compiler-level goldens in `inline-variant-default` and `important-default`.
- **Touched files:** the table in **Changed files**.
- Cross-links: `docs/decisions/ADR-0017-reusable-declaration-groups.md`, `SPECIFICATION.md` §3.7,
  `.ai/plans/CSSX-PLAN-GROUPS.md` §7–§9, `.ai/tasks/CSSX-A34.md`,
  `.ai/reports/logs/CSSX-A34.log`, `.ai/reports/CSSX-A31.md`, `.ai/reports/CSSX-A32.md`,
  `.ai/reports/CSSX-A33.md`.
