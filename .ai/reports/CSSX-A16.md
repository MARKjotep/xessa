# CSSX-A16 — Rule-merge imports (`@use ... styles`) (P7)

## Summary

- Extend the resolver with a `styles` import mode (rule-bearing module graph edges, per-module provenance).
- Implement per-module lowering + per-module class renaming with the module's own prefix, merged IR (imported-first order), merged class tables with strict collision detection, and the `module: true` setup key.
- New `modules/` fixture group + goldens + tests; no docs/examples work (another worker owns them).

**Status:** implemented and verified; `bun run verify` exit 0 (612 tests / 37 files; new suites 29 +
10 tests). Existing goldens are byte-identical (feature is opt-in through the new clause; no
pre-existing fixture file was modified). Awaiting lead verification. `.ai/PROGRESS.md` untouched.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/types/ast.ts` | `UseImport.styles?: boolean` — the single pre-approved additive frozen-type change, JSDoc cites ADR-0014. |
| `packages/compiler/src/parser/statements.ts` | Parse the optional `styles` clause after the alias clause; marker survives a missing `;` recovery. |
| `packages/compiler/src/resolver/types.ts` | `ResolvedImport.styles` (edge mode) and `ModuleRecord.styleDependencies` (rule-bearing targets, authored order). |
| `packages/compiler/src/resolver/graph.ts` | Fill the edge mode and `styleDependencies`; `dependencyTargets` gained an optional `"styles"` filter. |
| `packages/compiler/src/resolver/rules.ts` | **New.** `styleModuleOrder(graph, entry)` — DFS post-order over style edges. |
| `packages/compiler/src/resolver/index.ts` | Export `styleModuleOrder`; facade doc. |
| `packages/compiler/src/naming/merge.ts` | **New.** `mergeClassTables` — union of renamed tables with the strict XESSA4001 conflict policy. |
| `packages/compiler/src/naming/index.ts` | Export `mergeClassTables` + `ClassTableSource`/`MergedClassTable`; facade pipeline doc. |
| `packages/compiler/src/variables/runtime.ts` | `RuntimeEmitOptions.ruleModules` so merged modules' rule-level runtime references register custom properties. |
| `packages/compiler/src/index.ts` | `module` setup key (decode + suppression), `modulePrefix` helper, multi-module `compileEntry` pipeline, merged map/`.d.ts`/classes, JSDoc. |
| `packages/cli/src/setup.ts` | Documented/persisted `module: true` in the CLI's own setup mirror so a module entry plans no CSS/map/types (no "missing-artifact" warnings). |
| `docs/decisions/ADR-0014-rule-merge-imports.md` | **New.** Owner decision, rejected `@setup`-placement alternative, consequences. |
| `SPECIFICATION.md` | §3.2 `use` production + clause note; §6.1 token-only rule narrowed; new §6.3 "Rule-merge imports". |
| `tests/compiler/modules.test.ts` | **New.** 29 tests: parser clause, resolver modes/order/cycles, pipeline, `module: true`, merged tables, determinism, merged source maps. |
| `tests/compiler/merge.test.ts` | **New.** 10 tests: seven fixture goldens (CSS + `map.js`), determinism, imported-first order. |
| `tests/fixtures/modules/merge/**` | **New.** 7 fixtures × (entry + modules + `expected/css` + `expected/map.js`). |
| `.ai/tasks/CSSX-A16.md`, `.ai/reports/CSSX-A16.md`, `.ai/reports/logs/CSSX-A16.log` | Task, report, worker log. |

No framework bug/feature records were needed: this is application work against the project's own
specification and contracts, not a defect in an external framework.

## Pipeline order

Per entry (`compileEntry`):

```text
styleModuleOrder(graph, entry)                      # DFS post-order, authored order, entry excluded
for each style module, in that order:
  decodeSetup(module.ast) → modulePrefix(module)     # module's OWN prefix only
  lower(module.ast, options)                        # module's own @media-types apply
  substitute(ir, graph, module, { prefix: entryPrefix })
  renameClasses(ir, { prefix: modulePrefix })
entry:
  lower(entry.ast) → substitute(..., entry) → renameClasses(..., entryPrefix)
merged = stylesheetIr([...module IRs, entry IR])    # imported modules first
emitRuntimeTokens(merged, graph, entry, { prefix: entryPrefix, ruleModules })
mergeClassTables([...module tables, entry table])    # one map + .d.ts
groupRuns("safe") → flattenIr → emitCss
generateClassMap(mergedTable) → planOutputs
```

Why per-module `substitute`: §6.1 says imported values resolve in their **defining** module. A
module's own `$ref` must use that module's scope, not the entry's, so substitution runs once per
module before merging. Runtime custom properties deliberately use the **consuming build's** prefix
(A08 rule: `substitute` and `emitRuntimeTokens` receive the same effective prefix), and are emitted
once for the merged build, which keeps §6.2 dedupe and conflict detection intact.

## Prefix and collision decisions

| Decision | Rationale / citation |
|---|---|
| Module prefix = `naming.strategy === "none" ? "" : decoded @setup prefix ?? ""`. API `prefix`, `naming.prefix` and project `classes.prefix` never apply to merged rules. | Owner decision ("imported rules keep the imported module's OWN prefix"); task requirement 2 ("a module without setup uses no prefix/defaults"). |
| IR order is DFS post-order over style edges in authored `@use` order; each module once (diamond dedupe); entry last. | Owner decision (native-`@import`-like cascade, local rules win equal-specificity ties); task requirement 2. |
| Same original name + same emitted name across modules → one entry at its first position. | Owner decision ("allowed ONLY if identical naming result"). |
| Same original name + different emitted name → one XESSA4001 **error**; first result kept as documented recovery so output stays deterministic. | Owner decision (strict policy) + ADR-0010 (no silent merge/omission). |
| camelCase named-export alias uniqueness is enforced by `generateClassMap` on the **merged** table, so a module's `foo-bar` and the entry's `fooBar` collide exactly like within one file. | Task requirement 3; ADR-0010. |
| A `:global(.x)` reference and a local `.x` of the same name are not a conflict: the local definition upgrades the entry in place and globals stay unexported. | Existing `renameClasses` policy (ADR-0010), extended unchanged to the merge. |
| `module: true` suppression order: defaults < project config < `module: true` < file `emit-*`/`import-css` keys < explicit API/CLI overrides. `import-css` is suppressed too (otherwise `emit-css: false` would trip the planner's XESSA5001 requirement). | Task requirement 5 ("explicit wins"); SPECIFICATION.md §9.1 precedence; `planOutputs` "emit-css: false requires import-css: false". |
| Style-imported modules are not compiled as extra artifacts by the importing build; when they also match a project include glob they build standalone under their own flags. | Task requirement 5 and allowed-files note; verified by the `module-flag` fixture (`module.xessa` → no artifacts, `explicit.xessa` → CSS only). |
| Cycle detection is unchanged: every `@use` edge participates, so a cycle through style edges is XESSA2001; `styleModuleOrder` marks nodes before descending so the walk always terminates. | Task requirement 1/6; existing A07 behaviour. |

## Fixtures

| Fixture | What it pins | Expected diagnostics |
|---|---|---|
| `merge/basic` | entry `app` imports `card` module `card`; module rule first, entry rule second; merged map | — |
| `merge/prefix-independence` | entry prefix `admin`, module prefix `ui`; `ui-panel`/`ui-tile` keep the module prefix, `admin-page` the entry's | — |
| `merge/collision` | `a`/`b` both `ui` `.shared`/`.solo` unify (allowed); `c` unprefixed `.shared` conflicts → one XESSA4001; first result `ui-shared` wins | `XESSA4001` |
| `merge/tokens-plus-rules` | one `as t styles` import supplies `@variables gap`, `@runtime primary` and rules; `--app-primary` emitted in the consuming build, module rule uses `var(--app-primary)`, entry uses `$t.gap` | — |
| `merge/cycle` | `entry → a → b → a` style cycle: XESSA2001, merged order `b, a` | `XESSA2001` |
| `merge/module-flag` | `module: true` standalone emits nothing; explicit `emit-css: true` restores CSS only; the importing build merges normally | — |
| `merge/chain` | `entry → b styles → c styles`: DFS order `c, b, entry` | — |

Fixture entries are named `entry.xessa` (not `input.xessa`) on purpose: `tests/compiler/golden.test.ts`
is outside this task's ownership and compiles every `input.xessa` **without** a module graph, so a
merged fixture must not be picked up by that single-file runner. This keeps the "existing goldens
byte-identical" guarantee literal, and `merge.test.ts` asserts the seven-directory catalog itself.

## Test evidence

```text
bun test tests/compiler/modules.test.ts     29 pass / 0 fail,  98 expect() calls
bun test tests/compiler/merge.test.ts       10 pass / 0 fail,  61 expect() calls

bun run verify
  typecheck: compiler, cli, language-service, vscode   → exit 0
  lint:      biome check . (364 files)                 → exit 0
  test:      612 pass / 0 fail, 37 files               → exit 0
VERIFY_EXIT=0
```

Coverage highlights:

- **Parser:** `styles` absent/present/after alias, `as styles` stays an alias, missing `;` keeps the
  marker and reports XESSA1001.
- **Resolver:** `styleDependencies` vs `dependencies`, repeated styles import merges once, diamond
  order `c, a, b`, style cycle → one XESSA2001 with the walk still deterministic, self styles import
  → XESSA2001 with an empty merge order.
- **Pipeline:** imported-first CSS and per-module prefix; chain DFS order; token-only import
  contributes no rules; importing prefix never leaks into a module (and vice versa); `naming.none`
  disables all prefixes; a style module's `@setup` diagnostics surface in the consuming build;
  merged source maps list both `src/card.xessa` and `src/entry.xessa` with content.
- **`module: true`:** own build emits no CSS/map/types and no XESSA5001; explicit `emit-css: true`
  restores CSS only; importing build unaffected; `module: false` keeps defaults; the CLI's
  `resolveEffectiveSetup` mirror matches (and an authored `emit-map: true` restores the map).
- **Tables:** merged `map.js` and `.d.ts`; identical names unify; different emitted names →
  XESSA4001 with both names in the message and first-wins recovery; cross-module camelCase alias
  collision → XESSA4001 with quoted original keys and no named exports; global/local same name is
  not a conflict; two runs are byte-identical.

## Deviations and interpretation notes for lead review

1. **Requirement 6 contradicts the normative owner decision.** Requirement 6 says "same class,
   different prefixes → distinct names, no error; same class same prefix → XESSA4001". The owner
   decision (marked normative) says the opposite: same original + **identical emitted** is allowed,
   **different** emitted is XESSA4001. One map cannot key one original name to two values, so the
   normative decision was implemented; `merge/collision` pins *both* halves (identical `ui-shared`
   unifies, `ui-shared` vs `shared` errors). Documented here rather than weakening the policy.
2. **SPECIFICATION section number.** The task said "§3.4 (modules)", but `SPECIFICATION.md` §3.4 is
   *Rules, nesting and conditional blocks*; the modules section is §6.1–§6.2. The required edits
   went to §3.2 (EBNF + clause note), §6.1 (token-only rule narrowed) and a new §6.3, which is the
   only location that can state the feature normatively. No other section was touched.
3. **`emit-css`/`import-css` coupling.** `module: true` also suppresses `import-css`; otherwise the
   planner's documented `emit-css: false requires import-css: false` rule (XESSA5001) would make
   every module-only file an error.
4. **Runtime token media table.** Merged modules' `@runtime` variants resolve against the consuming
   entry's media table (`emitRuntimeTokens` keeps its single-table contract). A module's own
   `@media-types` overrides therefore apply to its *rules* (lowered per module) but not to its
   runtime token variants. Documented limitation, pinned by the `tokens-plus-rules` fixture using
   built-in aliases only.
5. **Module setup diagnostics.** Style-imported modules now have their `@setup` decoded, so an
   unknown/duplicate/invalid key in a **style-imported** module is reported in the consuming build.
   Token-only modules are still not setup-decoded (unchanged behaviour).

## Follow-ups (outside this task's file scope)

- `packages/vscode/src/analysis.ts` (and `output.ts`/`intelligence.ts`) mirror the setup key list for
  editor completions/diagnostics; `module` should be added there so the editor does not flag the new
  key. Not owned by this task (`packages/vscode/**` is out of scope).
- Docs/examples/release worker: user-facing docs for `styles` + `module: true` and a changelog entry.

## Blockers

None.

## Handoff

- The compiler barrel behaviour is final for v0.1: `compile`/`compileProject` handle any number of
  style-imported modules; `styleModuleOrder` and `mergeClassTables` are the reusable pieces for
  future hosts.
- P5/project-level cross-entry collision reporting and CLI `--report` surfaces are unchanged; a
  module-only entry now simply plans zero outputs.
- Files touched are exactly the allowed scope; existing fixtures/goldens, `tests/browser/**`,
  other docs, examples, root configs and `.ai/PROGRESS.md` were not modified.
