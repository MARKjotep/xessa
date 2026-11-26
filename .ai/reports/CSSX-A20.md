# CSSX-A20 — Runtime token merge-order override (ADR-0016)

## Summary

- Runtime tokens (`@runtime` → `:root` custom properties) now resolve duplicate post-prefix property
  names in **merge order** instead of failing with XESSA2001 first-wins. Style-imported modules come
  first in canonical DFS `@use` post-order, other reachable token modules follow in graph order, and
  the entry is last — so the entry's `@runtime` definition overrides a style-imported module's
  same-named property, and a later module overrides an earlier one.
- Conditional `:root` overrides follow the same order per query group: base first, then one `:root`
  per resolved query; the winning definition supplies its base and its variants, so the entry's
  `@dark` value beats an imported module's same-query value.
- Compile-time semantics are unchanged: a local `@variables` definition wins over unqualified
  imports (already true, now pinned), namespaces disambiguate, and `$name` ambiguity / duplicate
  locals / cross-kind clashes stay XESSA2001. No new diagnostic codes.
- Recorded normatively in ADR-0016, `SPECIFICATION.md` §6.1–§6.3 and author docs; pinned by five new
  fixtures and new/updated unit tests. `bun run verify` is green.

## Objective (as executed)

1. Added `docs/decisions/ADR-0016-runtime-token-override.md` (owner decision of 2026-11-25, merge
   order, rationale, rejected alternatives).
2. Reworked `variables/runtime.ts`: per-property slots ranked by module merge order, later rank
   replaces the value, no conflict diagnostic. Removed the now-unused `error` import.
3. Kept every other XESSA2001 semantic; improved the ambiguous-unqualified-import message to name
   each clashing module path plus its symbol kind (`compile-time`/`runtime`) and the recovery.
4. Verified the compile-time "ambiguous imports + local definition" case already resolves to the
   local with no diagnostic (`resolveUnqualified` skips providers when a local exists); pinned it with
   a fixture rather than changing behavior.
5. Updated normative/author text: `SPECIFICATION.md` §6.1/§6.2/§6.3, `docs/cascade.md` new
   "Runtime custom properties merge in emission order" subsection, `docs/compatibility.md`,
   `docs/known-limitations.md`, `variables/index.ts` facade docs.
6. Added fixtures/goldens (a)–(e) and unit tests; bumped catalog counts only for the two new
   `input.cssx` fixtures (52 → 54) while leaving A17/A19 entries untouched.
7. Updated `.ai/todo.md` per the lead: item 3 🟢 done in CSSX-A19, item 4 🟡 in progress (CSSX-A20),
   appended item 6 (backlog), item 7 (later flipped to 🟢 done in CSSX-A22 per the lead) and item 8
   (CSSX-A23 `@group` plan).

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/variables/runtime.ts` | Added `moduleMergeRanks`; slots replace on higher merge rank; conflict diagnostic removed; header/result docs cite ADR-0016. |
| `packages/compiler/src/variables/index.ts` | Facade doc notes merge-order resolution. |
| `packages/compiler/src/resolver/scopes.ts` | Ambiguous-unqualified-import XESSA2001 names both sources **and** their kinds, plus recovery guidance. Scope policy itself unchanged. |
| `tests/compiler/runtime.test.ts` | Reworked the two-namespace test to later-wins/no-diagnostic; new ADR-0016 unit block (entry override, later module, variant override, determinism) and merged-fixture golden block. |
| `tests/compiler/variables.golden.test.ts` | Added `variables/duplicate-local` (XESSA2001) and `variables/local-overrides-ambiguous-import` (clean) cases. |
| `tests/compiler/{golden,pipeline,formatter,sourcemap}.test.ts` | Catalog counts 52 → 54; deferred list gained the two new `$` fixtures. |
| `tests/fixtures/runtime/override-entry/` | **New.** Entry `@runtime primary` over `@use "./theme.cssx" styles` (merged `entry.cssx`). |
| `tests/fixtures/runtime/override-modules/` | **New.** Two namespaced style modules defining `accent`; later wins (merged `entry.cssx`). |
| `tests/fixtures/runtime/override-variants/` | **New.** Entry `@dark surface` beats the style import's `@dark` (merged `entry.cssx`). |
| `tests/fixtures/variables/duplicate-local/` | **New.** Duplicate compile-time local stays XESSA2001, first value kept. |
| `tests/fixtures/variables/local-overrides-ambiguous-import/` | **New.** Local `spacing` overrides two ambiguous unqualified imports; no diagnostic. |
| `tests/fixtures/README.md` | Index rows for the five new fixtures. |
| `docs/decisions/ADR-0016-runtime-token-override.md` | **New.** Owner decision, merge-order rule, rationale, rejected alternatives, consequences. |
| `SPECIFICATION.md` | §6.1 local-override/ambiguity wording; §6.2 normative merge order and variant rule; §6.3 tokens bullet. |
| `docs/cascade.md` | New precedence subsection with a worked runtime-property override. |
| `docs/compatibility.md` | `@runtime` row now documents merge order. |
| `docs/known-limitations.md` | Runtime-token row now states merge order within a build; cross-output gaps unchanged. |
| `.ai/tasks/CSSX-A20.md`, `.ai/reports/CSSX-A20.md`, `.ai/reports/logs/CSSX-A20.log` | Task, report, worker log. |
| `.ai/todo.md` | Board status updates and items 6–8 (owner/lead wording preserved). |

Not touched: `packages/compiler/src/{parser,lexer,types}/**`, `packages/vscode/**`, `examples/**`,
`.ai/PROGRESS.md`, `.ai/framework/**`. No framework bug/feature record applies (this is Xessa work,
not a third-party dependency issue).

## Before/after evidence

**Before** (pre-change `runtime.ts` contract and the removed unit-test expectation): two runtime
definitions for one property produced one diagnostic and kept the first value:

```text
XESSA2001: Runtime custom property "--ui-primary" would be defined by both ".../theme.cssx" and
".../entry.cssx"; the first definition wins (SPECIFICATION.md §6.2).
css: :root { --ui-primary: #111111; }   /* theme import */
```

**After** — `tests/fixtures/runtime/override-entry` (entry local + style import, same property):

```css
:root {
  --ui-primary: #2563eb;   /* entry wins */
}

.theme-card {
  color: var(--ui-primary);
}

.ui-app-page {
  color: var(--ui-primary);
}
```

No diagnostic; the imported module's `#111111` never wins.

**After** — `tests/fixtures/runtime/override-modules` (two namespaced style modules, same property):
`a` defines `#111111 @md #222222`, `b` defines `#aaaaaa @md #bbbbbb`; merge order is `a` then `b`:

```css
:root { --ui-accent: #aaaaaa; }
@media (min-width: 768px) { :root { --ui-accent: #bbbbbb; } }
```

`b` wins both the base and the query group, and `diagnostics` is `[]` where it previously reported
XESSA2001 and kept `#111111`.

**After** — `tests/fixtures/runtime/override-variants` (entry vs style import, same `@dark` query):
the entry's `#0f172a` appears in the `@media (prefers-color-scheme: dark)` `:root`, not the import's
`#111111`, and base declarations still come first.

**After** — `variables/local-overrides-ambiguous-import`: two unqualified imports export `spacing`
(`8px`, `12px`) and the file defines `spacing: 24px`; output is `.ui-card { padding: 24px; }` with no
diagnostic. `variables/duplicate-local` still reports one XESSA2001 and emits the first `gap: 8px`;
`runtime/collision-with-compile-time` still reports XESSA2001 (cross-kind local).

**After** — ambiguous unqualified import message (names both paths and kinds):

```text
XESSA2001: Ambiguous unqualified import in ".../input.cssx": "$spacing" is exported by
".../a.cssx" (compile-time), ".../b.cssx" (compile-time). Import it with a namespace
(@use "..." as <alias>) or define "$spacing" locally to choose one.
```

## Golden diff list

- **No existing golden was modified** (`git status` shows zero changed files under any `expected/`
  directory).
- New goldens (generated with the real `compileProject` pipeline and reviewed line by line):
  - `tests/fixtures/runtime/override-entry/expected/css` — entry `:root` value + theme/entry rules;
  - `tests/fixtures/runtime/override-modules/expected/css` — `b`'s `--ui-accent` base and `@md`;
  - `tests/fixtures/runtime/override-variants/expected/css` — entry `--ui-surface` base and `@dark`;
  - `tests/fixtures/variables/duplicate-local/expected/css` — `.ui-card { gap: 8px; }` plus
    `expected/diagnostics.json` = `null`;
  - `tests/fixtures/variables/local-overrides-ambiguous-import/expected/css` — 24px padding plus
    `expected/diagnostics.json` = `null`.
- Expected diagnostic codes are pinned in `variables.golden.test.ts`: duplicate-local `XESSA2001`,
  local-override clean; all merged runtime fixtures are asserted clean in `runtime.test.ts`.

## Validation

| Command | Result |
|---|---|
| `bun run typecheck` | ✅ 4 projects clean |
| `bun run lint` | ✅ Biome clean (379 files) |
| `bun test tests/compiler` | ✅ 528 pass / 0 fail (25 files) |
| `bun test tests/compiler tests/integration` | ✅ 583 pass / 0 fail (31 files) |
| `bun run verify` | ✅ exit 0 — 677 tests / 41 files, typecheck + lint green |

Determinism: merge ranks are a pure projection of the graph (`styleModuleOrder` + `graph.order` +
entry last); no new I/O, no mutation of input IR, and the new golden suites assert byte-identical
output across repeated runs. Compiler core remains pure, filesystem-free and dependency-free.

## Notes / blockers

- **Concurrent workspace:** during the first verification attempts, CSSX-A22's in-progress
  `packages/vscode/**` changes (a `TextDocumentWillSaveEvent.token` type error and two Biome format
  errors) failed `typecheck`/`lint`/the extension-host test. Those are outside this task's exclusive
  scope; the final `bun run verify` run after that worker landed its fix is fully green. No VS Code,
  parser, lexer, frozen-type or example file was edited by this task.
- **Known doc drift left alone:** `.ai/framework/xessa/FRAMEWORK.md` §3 step 6 and §5.5 still describe
  runtime conflicts as "XESSA2001 first-wins". That file is outside this task's exclusive write scope;
  it should be refreshed by its owner.
- **Board:** `.ai/todo.md` now shows item 3 🟢 done in CSSX-A19, item 4 🟡 in progress (CSSX-A20),
  plus item 6 (keyframe editor follow-ups), item 7 (🟢 done in CSSX-A22, per the lead's mid-task
  update) and item 8 (🔴 planned, CSSX-A23 `@group`) exactly as requested.
- **Browser gate:** no previously successful CSS output changed (the only output changes are builds
  that previously failed with XESSA2001, plus the diagnostic wording), and no example or browser
  scenario defines conflicting runtime properties, so `bun run test:browser` was not required for
  this change. The task's required gate (`bun run verify`) is green.
- No `.ai/framework/` record: this is Xessa compiler work, not a third-party framework defect or
  feature request.

## Handoff

Complete. Runtime property overrides resolve by merge order with the entry last and no conflict
diagnostic; compile-time override/ambiguity behavior is unchanged and pinned. ADR-0016 +
`SPECIFICATION.md` + author docs are updated, five fixtures and their goldens are in place, and
`bun run verify` is green. Ownership of `packages/compiler/src/variables/**`,
`packages/compiler/src/resolver/**`, `tests/compiler/**`, `tests/fixtures/**` and `.ai/todo.md` can be
released.
