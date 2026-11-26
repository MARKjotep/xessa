# CSSX-A33 — G3: `@group.<name>` expansion, token attribution, spans and diagnostics

## Summary

- Implemented phase **G3** of `.ai/plans/CSSX-PLAN-GROUPS.md`: a pure per-module pre-pass
  (`lowering/expand-groups.ts`) replaces every `@group.<name>` use site (any depth) with the group's
  defaults in definition order followed by the use-site block's declarations in authored order, at
  the authored position. Nothing is filtered, reordered, deduplicated or rewritten; same-property
  repeats survive in both the IR and the emitted CSS.
- **Attribution design:** expansion runs per module before that module's own `lower`, and
  `substitute` selects the token scope from each declaration's authored `span.file`. Spliced
  defaults therefore resolve `$refs` in the defining module while overrides resolve in the
  consumer — no new IR field, no consumer-token leakage, spans stay authored for diagnostics and
  source maps (`cross-module-defining-tokens` pinned; `spans`, `sources` and mappings asserted).
  Reference attribution in `variables/ast.ts` now also walks use-site blocks, so a `$ref` authored
  in an override keeps its exact diagnostic span and a namespaced `@runtime` reference registers its
  custom property (both previously missed by the G1 node type; regression tests added).
- Unknown and ambiguous groups are XESSA2001 at the use-site span (the ambiguity message names the
  defining modules) and omit exactly the use-site block; an emptied rule is dropped. A `@runtime`
  reference in a default is XESSA2001 with that segment omitted (owner decision (b)); the remaining
  defaults and overrides still expand. Definitions stay inert.
- Lead-directed documentation correction applied: ADR-0017 item 5/7 and `SPECIFICATION.md` §3.7 now
  state that `@use "…" as group` invalidates the whole statement — no namespace and no tokens,
  mirroring `as keyframes` (§3.6/§6.4).
- `bun run verify` is green: **745 pass / 0 fail across 44 files** (723/43 baseline intact + 22 new
  tests), zero golden/fixture changes.

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017, `SPECIFICATION.md` §3.7, the plan (§2.2–§2.7, §6/§7/§8/§9) and the
   G1/G2 reports; treat ADR/SPEC as frozen apart from the directed wording correction.
2. Study `lowering/**`, `variables/**` and the per-module pipeline in `index.ts`; pick and document
   the ADR-0017 item 6 attribution approach.
3. Implement `expandGroupUseSites` in `lowering/`; export it from the lowering barrel.
4. Change `variables/` attribution only: span-file origin scope and group-default runtime rejection.
5. Wire the pass into `compileEntry` for style-imported modules and the entry; public API unchanged.
6. Add `tests/compiler/groups.expansion.test.ts` (expansion half of `tests/compiler/groups*`).
7. Apply the ADR/spec correction; update the plan's G3 row to 🟢 (that row only).
8. Run the validation commands, then write this report plus the task and log.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/lowering/expand-groups.ts` | **New.** `expandGroupUseSites(ast, { module, groups })` → `{ ast, diagnostics }`. Walks top-level rules, native blocks, nested rules at any depth and conditional-block bodies; `resolved` splices `definition.declarations` then `site.declarations`, unknown/ambiguous emit XESSA2001 at `site.span` and omit the block. Identity-preserving (returns the input AST when a module has no use sites) and never mutates. JSDoc records why spans are the attribution mechanism. |
| `packages/compiler/src/lowering/index.ts` | Exports `expandGroupUseSites` + `GroupExpansionOptions`/`GroupExpansionResult`; module JSDoc lists the pre-pass and keeps `groupRuns` (safe grouping) distinct. |
| `packages/compiler/src/variables/ast.ts` | Additive `groupDefaultSegments(ast)`: base and inline-variant segment starts authored inside top-level `group-definition` nodes, used to identify expanded defaults in the IR. Both `segmentValueTokens` and `astReferences` now also visit `group-use-site` declarations, so an override's `$ref` keeps its exact reference offset for diagnostics and a `@runtime` reference authored at the use site registers its custom property (G1's node type was previously invisible to these walks). |
| `packages/compiler/src/variables/substitute.ts` | Per-module origin index (`segments` + `groupDefaults`) cached per call; the token scope is `declaration.span.file` when it is a graph module, else `entryFile`. An IR segment that originates inside a group definition and reaches a runtime token reports XESSA2001 at the segment span and is omitted instead of becoming `var(--…)`. Hooks are built per declaration. Module JSDoc documents the attribution rule and policy. |
| `packages/compiler/src/index.ts` | Wiring only: `expandGroupUseSites` before `lower` for every style-imported module and the entry; expansion diagnostics merged with the module's diagnostics; `NO_GROUPS` fallback when the entry record is missing; pipeline JSDoc updated. No exported shape changed. |
| `tests/compiler/groups.expansion.test.ts` | **New (22 tests, 75 expect calls).** Splice order/repeats/spans, emitted CSS, two use sites, any-depth expansion, style-imported module expansion, empty definition, `compile()` path, definition inertness + AST identity; defining-module vs consumer token scope; use-site runtime registration and exact `$ref` span; source map for spliced and override declarations; unknown (span text), emptied rule, token-only exclusion, ambiguous (both modules), local shadow, duplicate definition, `@runtime` default; inline variants in authored order; `!important` default; deterministic repeat builds (CSS + map). |
| `docs/decisions/ADR-0017-reusable-declaration-groups.md` | Item 5 sentence and item 7 matrix row for `@use "…" as group`: the rejected alias clause makes the whole statement invalid — no namespace and no tokens, mirroring `as keyframes` (§3.6/§6.4). |
| `SPECIFICATION.md` §3.7 | Visibility/precedence paragraph: same one-line correction for `@use "…" as group`. No other normative text touched. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G3 row 🔴 → 🟢 with evidence (only that row). |
| `.ai/tasks/CSSX-A33.md`, `.ai/reports/CSSX-A33.md`, `.ai/reports/logs/CSSX-A33.log` | **New.** Task prompt, this report, worker log. |

No resolver, parser, lexer, `types/**` (AST and diagnostic registry), formatter, emitter, IR type,
extension, fixture, golden, example, board or masterplan file was modified.

## Implementation notes

### Attribution: per-module expansion + authored `span.file` as the origin marker

ADR-0017 item 6 allows either per-module expansion before that module's own `substitute`, or an
origin-token table on each expanded declaration. The pipeline already lowers/substitutes per module
(`compileEntry` → `styleModuleOrder` → `substitute(ir, graph, file)`), so the chosen shape is:

1. `expandGroupUseSites(record.ast, { module, groups })` runs immediately before `lower`. Spliced
   defaults are the **defining module's own `Declaration` objects**, so they keep that module's
   `span` (including `span.file`) and parsed value tokens.
2. `substitute` picks the scope module from `declaration.span.file` instead of the module being
   substituted, and looks up segment tokens / group-default membership in that module's AST.

Why this over an explicit origin field: the IR types are frozen for this task, a per-declaration
origin field would duplicate information the authored span already carries (invariant 4), and the
span file is exactly what diagnostics and source maps must use anyway. It cannot leak consumer
tokens because the consumer's AST never authors a default's span, and for ordinary declarations
`span.file` equals the substituting module (existing behaviour, proven by the untouched suite).

Consequence recorded for the lead: `RuleIr.span` is the run's first declaration segment, so when a
run starts with a spliced default the **selector mapping** points at the definition file. That is
the pre-existing "run span = first declaration" contract (invalid to reorder), and it matches
ADR-0017 item 6 ("source maps land on the authored text"). Declaration mappings are exact: the
`padding` default maps to the definition, the `margin` override to the consumer (tested).

### Expansion and recovery

- Splice = defaults (definition order) then use-site declarations (authored order), replacing the
  node in place. Lowering then treats them as one ordinary run: the next authored statement flushes
  normally and `groupRuns` may merge adjacent identical runs exactly as before.
- Unknown (absent from `ModuleRecord.groups`, including token-only-import exclusions):
  `Unknown group "@group.<name>" in "<module>"; define it in this module or import the module that
  defines it with @use "..." styles (ADR-0017).`
- Ambiguous: `Ambiguous group "@group.<name>" in "<module>": visible definitions in "<a>" and
  "<b>"; define it locally or import only one defining module (ADR-0017).` (3+ candidates are joined
  `"a", "b" and "c"`). Both messages are XESSA2001 at the use-site span; no new code was added.
- The whole block is omitted on either rejection, the rest of the rule continues, and a rule left
  without declarations produces no IR (dropped like any other; `flush` only emits non-empty runs).

### Token scope and `@runtime` defaults

- Defaults resolve in the defining module, overrides in the consumer; `cross-module-defining-tokens`
  proves it with identically named local tokens in both modules (12px vs 40px).
- Runtime rejection is keyed on "the IR segment originates inside a `group-definition` node"
  (`groupDefaultSegments`). The hook fires inside nested compile-token expansion too, so a compile
  token whose value reaches a runtime token is rejected the same way. Message:
  `A @runtime token is not allowed in a group default: "$x" (ADR-0017); reference runtime tokens at
  the use site.` Recovery is the §6.1 segment granularity: the offending segment is omitted, the
  declaration's other segments and the rest of the group still expand. Definitions that are never
  used stay completely inert (no eager diagnostics), consistent with unused `@variables` entries and
  ADR-0017's "unused definitions are inert".

### Reference attribution for use-site blocks

G1 added `GroupUseSite` as a `BlockItem`, but the two AST walks in `variables/ast.ts` only knew
`declaration`, `rule`, `conditional-block` and `native-at-rule`. Two consequences were found while
testing expansion and fixed here (attribution only, group sources only):

- `segmentValueTokens` missed use-site declarations, so an unresolved `$ref` inside an override was
  reported at the whole segment instead of the exact reference. With the walk extension the span is
  exactly `$missing` (test: "an unresolved $ref in a use-site block reports the exact reference
  span").
- `astReferences` missed use-site declarations, so a namespaced `@runtime` reference authored at the
  use site (`gap: $t.space`) emitted `var(--space)` without ever registering `:root { --space: 4px }`
  — invalid CSS. The walk extension fixes registration (test: "a @runtime reference in a use-site
  block registers its custom property"). Bare unqualified runtime references already worked because
  runtime emission registers the entry's unqualified scope, which is why this only surfaced for
  namespaced members and for style-imported modules.

### Documentation correction evidence

`resolver/scopes.ts` `resolveUnqualified` skips every `@use` with an `as` alias (line 166) and the
namespace branch `continue`s before binding, so a rejected `as group` statement contributes neither
a namespace nor unqualified tokens; only the graph dependency edge remains. The ADR matrix row and
both prose paragraphs now say exactly that, citing the `as keyframes` precedent.

## Verification

### Commands

```sh
bunx tsc -p packages/compiler/tsconfig.json --noEmit
bunx biome check packages/compiler/src/lowering packages/compiler/src/variables packages/compiler/src/index.ts tests/compiler/groups.expansion.test.ts
bun test tests/compiler/groups.expansion.test.ts
bun test tests/compiler
bun run verify
git status --porcelain
git status --porcelain tests/fixtures
```

### Output tails

`bunx tsc -p packages/compiler/tsconfig.json --noEmit` → exit 0, no output.

`bunx biome check …` → `Checked 15 files in 24ms. No fixes applied.`

`bun test tests/compiler/groups.expansion.test.ts`:

```
 22 pass
 0 fail
 75 expect() calls
Ran 22 tests across 1 file.
```

`bun test tests/compiler`:

```
 593 pass
 0 fail
 787845 expect() calls
Ran 593 tests across 28 files.
```

`bun run verify` (typecheck + lint + full test):

```
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... && tsc -p packages/vscode/tsconfig.json --noEmit
$ biome check .
Checked 392 files in 244ms. No fixes applied.
$ bun test
...
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error), 1 diagnostic(s), completion 11 item(s), compile+preview commands

 745 pass
 0 fail
 788795 expect() calls
Ran 745 tests across 44 files.
exit=0
```

`git status --porcelain tests/fixtures` → empty. No `expected/**` file was edited or regenerated.

### Observed counts

| Measure | Baseline (A32) | After A33 | Delta |
|---|---|---|---|
| `bun test` total | 723 pass / 43 files | 745 pass / 44 files | +22 tests, +1 file |
| `tests/compiler` | 571 pass / 27 files | 593 pass / 28 files | +22 tests, +1 file |
| `groups.expansion.test.ts` | — | 22 pass | new |
| Golden/fixture changes | — | 0 | none |

## Acceptance mapping (plan §7 G3)

- Use site expands to defaults-then-overrides at the authored position → splice test asserts the IR
  order and byte-exact CSS from the ADR example; two-use-site and any-depth tests pin placement.
- Same-property repeats survive (no dedupe/filter) → `padding: 12px` **and** `padding: 20px` asserted
  in the IR list and in the emitted CSS.
- Defining-module vs consuming-module `$refs` → `cross-module-defining-tokens` (12px vs 40px, no
  leak); source-map test pins the definer file/line for the default and the entry file/line for the
  override.
- Unknown/ambiguous omit exactly the block and drop an emptied rule → tests assert the diagnostic
  span text, the surviving declarations, empty CSS for the emptied rule, both defining modules in
  the ambiguity message, inert definitions, and the token-only exclusion.
- `@runtime` default → XESSA2001, only that segment omitted; remaining defaults/overrides expand.
- Spans authored, no invented positions → IR span offsets equal `indexOf` in the source; source map
  assertions.
- Inline variants in defaults expand in authored order; `!important` default not beaten → both
  tested on the emitted CSS.
- Deterministic repeat builds; group-free byte-identical output; definitions emit nothing →
  repeat-run CSS+map equality, AST identity for group-free input, definition-only module emits no IR,
  and zero golden changes (fixtures clean, 723 baseline intact).
- `bun run verify` green; ADR/§3.7 wording corrected → evidence above.

## Constraints and scope compliance

- Owned scope only: lowering, variables attribution, `index.ts` wiring, the new expansion test, the
  two directed doc corrections, the G3 plan row and this task/report/log. No frozen type, resolver,
  parser, lexer, formatter, emitter, extension, fixture/golden, example, board or masterplan edit.
- Frozen registry untouched: only XESSA2001 is produced by the new code; messages name the group and,
  for ambiguity, every defining module.
- No test was weakened or expectation regenerated. Fix attempts: one biome `--write` pass on the new
  test file (formatting only) and one Jest-free assertion cleanup while authoring; no source
  semantics changed after the first green run.
- No framework record was created: this is compiler application work, not a defect or feature
  request in Rossa/Yvee/Shweet, so no framework version applies. No framework dependency changed.

## Blockers, findings and handoff

- **Found and fixed (attribution):** the G1 `GroupUseSite` node was invisible to the `variables/ast.ts`
  walks, so (i) an unresolved `$ref` inside an override was reported at the whole segment instead of
  the exact reference and (ii) a namespaced `@runtime` reference authored at a use site emitted
  `var(--x)` without registering `:root { --x: … }`. Both are fixed in `variables/ast.ts` and pinned
  by tests; no non-group source changes.
- **Finding (source maps):** a run whose first segment is a spliced default maps its **selector** to
  the definition file, because `RuleIr.span` is the first declaration segment. Declaration mappings
  are exact and intended; changing the selector origin needs an IR field outside this task. Flagged
  for the lead / G4b (the browser gate does not assert selector origins).
- **Finding (recovery edge):** a use site authored directly in a *top-level* native block
  (`@media { @group.card { … } }`, no enclosing rule) expands into declarations that lowering already
  rejects as "declaration outside a rule" (XESSA1001). G1 previously left such a node inert; the
  diagnostic is the existing §3.4/§3.5 rule and only affects group sources. No fixture/golden relies
  on the old silence.
- **Not run (not owned):** plan §9 lists a browser gate at "G3 completion"; the group scenarios
  D1–D5 are the G4b deliverable and `tests/browser/**` is outside this task's scope. Unit and
  integration verification is green; browser acceptance is **unverified, not passed**, and remains a
  G4b requirement.
- **Carried release blocker (from G1):** `format()` still drops `@group` nodes until G5; group
  sources must not reach format-on-save before then.
- **Handoff to G4a:** fixtures can now rely on defaults-then-overrides, the XESSA2001 rows, inline
  variants, `!important`, empty groups, duplicates, token-only/ambiguity and the runtime default
  (`runtime-ref` = XESSA2001 segment omission). Merged `style-import`/`transitive-visibility`/
  `cross-module-defining-tokens` cases are already proven in `groups.expansion.test.ts`. Note that
  `tests/compiler/golden.snapshot`-style fixture counts are G4a's file to update.
- **Handoff to G4c:** author docs should state that defaults are compile-time only (runtime refs are
  authored at the use site), groups are not values, and `as group` is a hard XESSA2001 that imports
  nothing.
- **Pre-existing worktree state:** changes from A29–A32 (parser/resolver/docs/tests), the vscode
  worker and two whitespace-only example edits were present before this task and were left untouched.
- Cross-links: `docs/decisions/ADR-0017-reusable-declaration-groups.md`,
  `.ai/plans/CSSX-PLAN-GROUPS.md`, `.ai/reports/CSSX-A31.md`, `.ai/reports/CSSX-A32.md`,
  `.ai/tasks/CSSX-A33.md`, `.ai/reports/logs/CSSX-A33.log`.
