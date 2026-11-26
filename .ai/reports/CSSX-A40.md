# CSSX-A40 — G6c: TextMate scopes for `@group`

## Summary

- `@group.<name>` now has dedicated TextMate scopes: a **definition** at the top level is
  `meta.directive.group.xessa`, a **use site** inside a rule body is `meta.group.use.xessa`, and
  both share `keyword.control.directive.xessa` for `@group` and `punctuation.accessor.xessa` for the
  dot — consistent with `@setup`/`@use`/`@variables`/`@runtime`/`@media-types`.
- The member name gets its own `entity.name.type.group.xessa` scope, distinct from
  `$keyframes.<name>`'s `variable.other.member.xessa` and from media aliases'
  `entity.name.function.xessa`. `@group.keyframes` is highlighted as an ordinary group name.
- `group` is now reserved in the alias/variant matchers, so `@group.*` is never a media alias;
  `@groupie` and other lookalikes stay aliases. Bare `@group` and spaced `@group .x` degrade to the
  directive keyword without opening a construct that mis-scopes following content.
- Grammar files and tests only; compiler output is untouched. Grammar suites: **36 pass / 0 fail**
  (29 pre-existing unchanged + 7 new). Full suite: **805 pass / 0 fail across 45 files**.
  `bun run typecheck` passes. `bun run verify` cannot finish because the pre-existing, untracked
  `.pi/settings.json` fails Biome formatting; that file is outside this task's write set, so the plan
  G6c row is marked 🟡 rather than 🟢.

## Status

**PARTIAL** — implementation and all assigned tests pass; the required `bun run verify` gate is
blocked by an environmental lint error in `.pi/settings.json` (see "Blocker").

## Objective (as executed)

Add TextMate rules for `@group` definitions and use sites, scope member names distinctly, keep
malformed forms from corrupting following highlighting, and prove it with the existing grammar
harness. No compiler semantics or extension providers change.

## Changed files

| File | Change |
|---|---|
| `packages/vscode/syntaxes/xessa.tmLanguage.json` | Root patterns gain `#group-definition` (after `#directives`, before native at-rules) and `#group-keyword`; `#block-body` gains `#group-use`/`#group-keyword`; new `group-definition`, `group-use`, `group-keyword` repository rules; `group` added to the three reserved-name exclusion lists (alias, `conditional-block`, `alias-block-start`). |
| `tests/extension/grammar.test.ts` | New `group directive scoping structure` describe: containers/captures/member scope, root + block-body placement, alias/variant reservation, `@groupie` still an alias. Existing tests untouched. |
| `tests/extension/grammar.scopes.test.ts` | New rendered `@group definitions, use sites and members` describe (4 tests): definition vs use site, `@group.keyframes` vs `$keyframes.spin`, `@md`/`@setup` distinction, malformed bare/spaced forms with following-content recovery. Existing tests untouched. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G6c row carries 🟡 with A40 evidence and the verify blocker. No other row touched. |
| `.ai/tasks/CSSX-A40.md`, `.ai/reports/CSSX-A40.md`, `.ai/reports/logs/CSSX-A40.log` | New records. |

`grammar-harness.ts` was not needed. `git diff --stat` for the three code/test files:
`xessa.tmLanguage.json` +102/−3, `grammar.test.ts` +43, `grammar.scopes.test.ts` +91.

## Scope contract

| Construct | Scope |
|---|---|
| `@group` in a definition | `meta.directive.group.xessa` + `keyword.control.directive.xessa` |
| `@group` in a use site | `meta.group.use.xessa` + `keyword.control.directive.xessa` |
| `.` in `@group.<name>` | `punctuation.accessor.xessa` |
| `<name>` member | `entity.name.type.group.xessa` |
| bare/spaced malformed `@group` | `keyword.control.directive.xessa` only (no container, no variant) |
| `@md`/`@dark` aliases | unchanged `meta.variant.xessa entity.name.function.xessa` |
| `@setup` etc. | unchanged `keyword.control.directive.xessa` |
| `$keyframes.spin` | unchanged `variable.other.xessa` / `variable.other.member.xessa` |

Implementation notes:

- Definition vs use site is decided by grammar position, matching ADR-0017 item 1: the root include
  is only reachable at top level, the use rule only through `#block-body`.
- Both block rules include `#block` before `#fallback`, so a malformed nested rule/conditional inside
  a group keeps its braces balanced and the group container cannot swallow following content.
- The dotted form is contiguous (`@group` `.` identifier) in the regex, per ADR-0017 item 5; a space
  or missing name falls to `#group-keyword`.
- `group-keyword` is included before `#native-at-rule`/`at-rule-generic`, so a bare `@group` is not
  consumed as a generic at-rule prelude (which would scope the next selector as a prelude).
- No existing scope name, rule order among the six root anchors, or `#directives` membership changed;
  the existing exact-directive-list test still passes.

## Acceptance evidence

| Criterion | Result |
|---|---|
| Definition vs member scopes distinct from media aliases/other directives | **PASS** — rendered tokens: `@group` → `meta.directive.group.xessa` / `meta.group.use.xessa`, `card` → `entity.name.type.group.xessa`; never `entity.name.function.xessa`, `meta.variant.xessa` or `variable.other.member.xessa`. |
| `@group.keyframes` member is an ordinary identifier | **PASS** — `keyframes` → `entity.name.type.group.xessa`, never `keyword.control.at-rule.css`/`meta.at-rule.keyframes.css`; `$keyframes.spin` keeps `spin` → `variable.other.member.xessa`. |
| Malformed `@group` / `@group .x` degrade gracefully | **PASS** — all `@group` tokens keep `keyword.control.directive.xessa`, no group container; `.after`, `.panel`, `.tail` still class-scoped and `color`/`margin` still property-scoped after the malformed statements. |
| Existing grammar tests unchanged | **PASS** — 29 pre-existing tests untouched and green. |
| New grammar tests | **PASS** — 7 new tests green (`bun test tests/extension/grammar.test.ts tests/extension/grammar.scopes.test.ts` → 36/36). |
| Full suite | **PASS** — `bun test` → 805 pass / 0 fail, 45 files (798/45 baseline + 7). |
| Typecheck | **PASS at verification time** — `bun run verify` completed `bun run typecheck` and proceeded to lint. A later re-run hit transient TS errors in parallel A39-owned `packages/vscode/src/analysis.ts` and `src/groups.ts` while that worker was editing them (outside this task's write set). |
| `bun run verify` | **BLOCKED** — at verification time typecheck passed and lint failed on untracked `.pi/settings.json` (Biome would collapse `defaultTools` to one line); the final re-run hit the A39 transient typecheck state first. The three changed files pass `bunx biome check`. |

## Blocker

`bun run verify` stops at `bun run lint`:

```text
./.pi/settings.json format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  × Formatter would have printed the following content:
   18 -   "defaultTools": [
   19 -     "read",
   ...
        +   "defaultTools": ["read", "grep", "find", "ls", "bash"],
Found 1 error.
```

`.pi/` was already untracked in the initial working tree (initial `git status --short` showed
`?? .pi/`), is not listed in `biome.json` ignores, and is the Pi harness's own settings — outside this
task's write set and not ours to reformat. It is a pre-existing environmental lint failure, not
caused by the grammar change. Once `.pi/settings.json` is formatted or `.pi` is ignored, the lint step
is expected to pass because the three changed files are Biome-clean.

Separately, a final `bun run typecheck` re-run failed in `packages/vscode/src/analysis.ts` and
`src/groups.ts` while the parallel A39 worker was actively editing `packages/vscode/src/**` (those
files were modified/untracked in `git status` at the same time). That is transient parallel-worker
state in a write set this task must not touch; at A40 verification time the typecheck step had
completed green and the full suite was 805/45.

## Handoff

- Completed: grammar rules, structural tests, rendered-scope tests, task/report/log, plan G6c row
  (🟡 pending the environmental verify blocker).
- Verification: 36/36 grammar suite, 805/45 full suite, typecheck green, changed files Biome-clean.
- Remaining: run `bun run verify` in a tree where `.pi/settings.json` is formatted/ignored, then flip
  the plan G6c row to 🟢. No grammar or test work remains.
- Touched files: see "Changed files".
