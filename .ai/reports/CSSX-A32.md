# CSSX-A32 — G2: resolver collection, `group` symbol kind and `styles` visibility

## Summary

- Implemented phase **G2** of `.ai/plans/CSSX-PLAN-GROUPS.md`: `resolver/groups.ts` collects each
  module's top-level `@group.<name>` definitions in authored order and computes the memoized,
  cycle-safe visibility closure of the module's own definitions plus every module reached through a
  `styles` `@use` edge (owner decision (a)). Token-only imports expose no groups.
- Precedence is pinned per ADR-0017 item 5: a local definition shadows imports silently, two imported
  definitions with no local one are returned as `ambiguous` (G3 owns the use-site XESSA2001), and a
  duplicate inside one module is XESSA2001 at the later definition with the first definition winning.
  `@use "…" as group` is XESSA2001 at the `@use` and creates no namespace.
- No lowering, emitter, formatter, parser or diagnostics-registry change; `$group.<name>` stays the
  existing unknown-token-namespace XESSA2001, now pinned by a test. Group-free output is unchanged.
- Lead-directed documentation correction applied: a definition-in-rule is impossible by grammar —
  position decides (top level = definition, rule body = use site) — so ADR-0017, `SPECIFICATION.md`
  §3.7 and the plan no longer claim it is a XESSA1001 error.
- `bun run verify` is green: **723 pass / 0 fail across 43 files** (712 baseline intact + 11 new
  tests), zero golden/fixture changes.

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017, `SPECIFICATION.md` §3.2/§3.6/§3.7, the plan (§2.4–§2.7, §6 G2, §7
   G2, §8, §9) and `.ai/reports/CSSX-A31.md`; treat ADR-0017 and the spec as frozen apart from the
   lead-directed wording correction.
2. Study `resolver/keyframes.ts` (ADR-0015) and the `styles` closure/`ModuleRecord` code
   (`resolver/graph.ts`, `resolver/types.ts`) and mirror their structure and naming.
3. Add `resolver/groups.ts` with collection, the visibility closure and the reserved `group`
   directive name; add `VisibleGroup`/`GroupResolution` and `ModuleRecord.groups`.
4. Wire collection and visibility into `resolveModuleGraph`, reusing the existing `styles`
   dependency list.
5. Reject `@use … as group` in `collectNamespaceBindings` exactly like `as keyframes`, with a message
   naming the reserved directive.
6. Add resolver tests for the §2.5 rows, the transitive/token-only/cycle visibility rules, the
   shadow/ambiguity precedence and the `$group` unknown-namespace path.
7. Apply the documentation correction and update the plan's G2 and §8 rows.
8. Run `bun run verify`, then write this report plus the task and log.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/resolver/groups.ts` | **New.** `GROUP_DIRECTIVE` (`"group"`), `collectGroups(file, ast, report)` (top-level `group-definition` nodes in authored order, XESSA2001 at the later duplicate, first wins) and `visibleGroups(sources)` (own + transitive `styles` closure, deduplicated per defining module, memoized with a cycle back edge contributing nothing; derives `resolved`/`ambiguous` per module). `GroupSource` is the per-module input mirroring `KeyframeSource`. |
| `packages/compiler/src/resolver/types.ts` | Additive: `VisibleGroup` (name, defining module, definition span, `GroupDefinition` node) and `GroupResolution` (`resolved` \| `ambiguous` with ordered candidates). `ModuleRecord.groups` documents collection, the styles-only visibility rule, shadowing, ambiguity ownership (G3) and inertness. No existing field changed. |
| `packages/compiler/src/resolver/graph.ts` | Computes both `keyframeSources` and `groupSources` from the same per-module `styleDependencies` list, calls `visibleGroups`, and stores `groups` on each record. Duplicate-definition diagnostics flow through the existing stably-sorted diagnostic list. |
| `packages/compiler/src/resolver/scopes.ts` | Reserved alias rejection: `alias === GROUP_DIRECTIVE` → XESSA2001 at the `@use` span, `continue` (no namespace), mirroring the `keyframes` branch exactly. |
| `packages/compiler/src/resolver/index.ts` | Barrel exports the two new public types; JSDoc notes that groups are collected/resolved here and that use-site diagnostics/expansion are G3. |
| `tests/compiler/groups.resolver.test.ts` | **New (11 tests).** Collection order/spans/nodes; duplicate at the later span with first-wins; own + transitive visibility with token-only exclusion; token-only invisibility with same-file visibility; cycle safety/determinism; local shadow (no diagnostic); ambiguous by two style imports (ordered candidates, no resolver error); direct + transitive ambiguity; diamond dedupe; `as group` rejection (span, message, no namespace, edge valid); `$group.card` XESSA2001. |
| `docs/decisions/ADR-0017-reusable-declaration-groups.md` | Item 1: definitions exist only at top level; the identical syntax in a rule body is a use site (position decides); XESSA1001 covers malformed group statements inside rules, not well-formed use sites. Item 7 matrix row renamed to "Malformed group statement …" with the same clarification. |
| `SPECIFICATION.md` §3.7 | **Definition** paragraph states that a definition exists only at the top level and that the same syntax in a rule body is a use site (position decides, §3.2); XESSA1001 recovery covers malformed group statements inside rules. No other normative text changed. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G2 progress row 🟢 with evidence; §8 fixture row `definition-in-rule` → `group-position` (same syntax = definition at top level, use site in a rule body); §2.1 design bullet and §7 G1 acceptance bullet reworded consistently (no table row other than §8/G2 touched). |
| `.ai/tasks/CSSX-A32.md`, `.ai/reports/CSSX-A32.md`, `.ai/reports/logs/CSSX-A32.log` | **New.** Task prompt, this report, worker log. |

No lowering, emitter, formatter, lexer, parser, variables, `types/diagnostics.ts`, `types/ast.ts`,
public compiler barrel, fixture, golden, extension, example, board or masterplan file was modified.
Parallel changes from A29–A31 and the vscode worker in the same worktree were left untouched.

## Implementation notes

### Collection and the `group` symbol kind

Groups live in their own symbol kind: `ModuleRecord.groups` is a separate map from
`compileScope`/`runtimeScope`/`keyframes` and never mixes with token names or namespaces. Collection
walks the top-level `ast.items` for `kind === "group-definition"` in authored order — a group
statement inside a rule is a `GroupUseSite`, so it is never collected — and keeps the first
definition of a name. A duplicate reports XESSA2001 at the **later** definition:

```text
Duplicate group definition "@group.card" in "<file>".
```

The first definition's node, span and declarations are the ones retained, matching the duplicate
local-variable recovery in `collectLocalSymbols`.

### Visibility closure (owner decision (a): styles-only)

`visibleGroups` mirrors `visibleKeyframes`: modules are visited in sorted canonical-path order with a
shared memo; a cycle back edge returns an empty map (the cycle itself is already XESSA2001 at the
closing edge), so the walk terminates deterministically. Per module the reachable set is own
definitions first, then each `styles` dependency depth-first in authored `@use` order with its
closure, deduplicated per defining module so a diamond contributes one definition. Arrays stored in
the memo are copied into the caller's local list, so an importer can never mutate another module's
closure.

Resolution is derived from that reachable set, which is the literal ADR-0017 item 4/5 reading ("its
own top-level definitions plus the definitions of every module reached through `styles`,
transitively"):

- own definition present → `resolved` to the own definition (imported same-name definitions are
  shadowed, no diagnostic);
- otherwise exactly one distinct visible definition → `resolved`;
- otherwise two or more → `ambiguous`, candidates in traversal order (own-first, then authored DFS),
  which is the order G3 should name modules in. The resolver reports **nothing** for ambiguity
  because only a use site makes it actionable.

Consequence pinned by a test: when `entry` styles-imports `a` and `a` styles-imports `b`, and both
`a` and `b` define `card`, `a` resolves its own definition (local shadow) while `entry` sees two
*imported* definitions and is `ambiguous` — `a`'s local definition is not local to `entry`, and
first-wins explicitly does not apply. The lead may veto this reading, but it follows the ADR
wording ("two visible imported definitions with no local definition") and is the reason ambiguity is
data rather than an eagerly resolved winner.

### Reserved `group` alias and `$group`

`collectNamespaceBindings` rejects `@use "…" as group` before namespace creation, in the same branch
shape as `as keyframes`:

```text
"group" is a reserved directive name (ADR-0017) and cannot be used as an @use alias in "<file>".
```

The span is the `@use` statement, no namespace is created, and the dependency edge still resolves;
a separate plain `@use` of the same target still provides its tokens (asserted). `$group.<name>` needs
no resolver work: `variables/expand.ts` already reports `Unknown token namespace "$group"` as
XESSA2001 and omits the declaration; a pipeline test pins that and that no `$` survives.

### Documentation correction

G1 proved that the token sequence for a definition and a use site is byte-identical, so only position
can decide. The ADR item 1/7, SPECIFICATION §3.7 **Definition** and the plan now say that: definitions
exist only at top level; a well-formed group block inside a rule is a use site and reports nothing;
XESSA1001 statement-scoped recovery applies to *malformed* group statements inside rules (bad dotted
form, bare `@group`, non-declaration statement). The plan's normative §2.1 bullet and §7 G1
acceptance bullet were reworded for the same reason (no table row beyond §8 and G2 touched); the §8
fixture is now `group-position`, the positive pin for both readings.

## Verification

### Commands

```sh
bunx tsc -p packages/compiler/tsconfig.json --noEmit
bunx biome check packages/compiler/src/resolver tests/compiler/groups.resolver.test.ts
bun test tests/compiler/groups.resolver.test.ts
bun test tests/compiler
bun run verify
git status --porcelain
git diff --stat -- SPECIFICATION.md .ai/plans/CSSX-PLAN-GROUPS.md packages/compiler/src/resolver
```

### Output tails

`bunx tsc -p packages/compiler/tsconfig.json --noEmit` → exit 0, no output.

`bunx biome check packages/compiler/src/resolver tests/compiler/groups.resolver.test.ts` →
`Checked 9 files ... No fixes applied.`

`bun test tests/compiler/groups.resolver.test.ts`:

```
 11 pass
 0 fail
 54 expect() calls
Ran 11 tests across 1 file.
```

`bun test tests/compiler`:

```
 571 pass
 0 fail
 787770 expect() calls
Ran 571 tests across 27 files.
```

`bun run verify` (typecheck + lint + full test):

```
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... && tsc -p packages/vscode/tsconfig.json --noEmit
$ biome check .
Checked 390 files in 144ms. No fixes applied.
$ bun test
...
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error), 1 diagnostic(s), completion 11 item(s), compile+preview commands

 723 pass
 0 fail
 788720 expect() calls
Ran 723 tests across 43 files.
exit=0
```

`git status --porcelain tests/fixtures` → empty. No `expected/**` file was read for regeneration or
edited; no golden changed.

### Observed counts

| Measure | Baseline (A31) | After A32 | Delta |
|---|---|---|---|
| `bun test` total | 712 pass / 42 files | 723 pass / 43 files | +11 tests, +1 file |
| `tests/compiler` | 560 pass / 26 files | 571 pass / 27 files | +11 tests, +1 file |
| `groups.resolver.test.ts` | — | 11 pass | new |
| `resolver.test.ts` / `keyframes.test.ts` | — | unchanged, green | none |
| Golden/fixture changes | — | 0 | none |

### Group-free output

Only `@group` sources exercise the new code; no goldens, examples, lowering, emitter or formatter
changed, and the pre-existing 712-test suite passes unchanged. Group definitions contribute no CSS
and `hasTopLevelRules` still ignores them, so a definitions-only module remains output-free for P4/P5.

## Acceptance mapping (plan §7 G2)

- Per-module collection in authored order → `collectGroups` + collection test with spans and nodes.
- Own + transitive `styles` closure, memoized, cycle-safe → `visibleGroups` mirrors
  `visibleKeyframes`; tested for chain, token-only exclusion, diamond and cycle.
- `@use … as group` is XESSA2001 at the `@use`, no namespace → `scopes.ts` branch + test asserting
  span, message, absent namespace and a still-valid edge.
- Duplicate/local-shadow/ambiguous exactly per ADR-0017 item 5 → collection duplicate test,
  shadow test (zero diagnostics), ambiguity tests (ordered candidates, zero resolver diagnostics),
  diamond test.
- Resolver-side §2.5 rows covered: duplicate, as-group alias, shadow-no-error, ambiguity detection,
  transitive visibility, token-only exclusion, cycle safety, plus `$group.` and `@group.keyframes`
  independence is parser-side (already pinned in `groups.parser.test.ts`).
- No use-site diagnostics, no lowering change → `GroupUseSite` is not read by any new code.
- Documentation carries no contradiction → ADR-0017 item 1/7, SPECIFICATION §3.7 and the plan
  §2.1/§7 G1/§8 state position-based semantics.
- `bun run verify` green, 712 baseline intact, zero golden changes → evidence above.

## Constraints and scope compliance

- Owned scope only: `packages/compiler/src/resolver/**`, `tests/compiler/groups.resolver.test.ts`,
  the three documentation files, and this task/report/log. No lowering/emitter/formatter/lexer/parser
  edit; `types/diagnostics.ts` and `types/ast.ts` untouched; public compiler barrel untouched.
- Frozen registry: only XESSA2001 was added in the resolver; message style mirrors the keyframes
  reserved-namespace message and the duplicate-local message. No new code, no subcode.
- No test was weakened or expectation regenerated. Fix attempts: one for this task (test helper
  returned the host directly while tests destructured `{ host }`; fixed the test call sites) plus one
  biome formatting pass; no source semantics changed after the first green run.
- No framework record was created: this is compiler application work, not a defect or feature
  request in Rossa/Yvee/Shweet. No framework dependency was added or changed.

## Blockers, findings and handoff

- **Handoff to G3:** resolve a use site through `ModuleRecord.groups` of the consuming module.
  `kind: "resolved"` gives the defining module, authored definition span and `GroupDefinition` (its
  declarations' `$refs` resolve in that module); `kind: "ambiguous"` must emit XESSA2001 at the use
  site, name the group and the candidate defining modules, omit the block and leave both definitions
  inert. Unknown (absent from the map) is the same XESSA2001 path. No expansion exists yet.
- **Finding for the lead / G4c:** the existing unknown-namespace message for `$group.card` advises
  `@use "…" as group`, which ADR-0017 makes XESSA2001. ADR-0017 item 5 deliberately reuses the
  existing path, and `variables/**` is outside this task's scope, so no message change was made.
  G4c author docs should state that groups are not values.
- **Carried release blocker (from A31):** `format()` still drops `@group` nodes until G5; group
  sources must not be exposed to format-on-save before then.
- **Residual plan wording:** the plan's §4 open-decision table and other historical rows still
  reference the pre-decision proposal wording; they were not touched except §2.1 and §7 G1 bullets
  noted above. The normative ADR and spec are corrected.
- Cross-links: `docs/decisions/ADR-0017-reusable-declaration-groups.md`,
  `.ai/plans/CSSX-PLAN-GROUPS.md`, `.ai/reports/CSSX-A31.md` (G1 grammar and the original
  contradiction finding), `.ai/reports/CSSX-A30.md` (ADR/spec integration),
  `.ai/tasks/CSSX-A32.md`, `.ai/reports/logs/CSSX-A32.log`.
