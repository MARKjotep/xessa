# CSSX-A39 — G6a+G6b: editor intelligence for `@group`

## Summary

- Implemented the editor half of plan §7 G6 (phases G6a and G6b) for `@group.<name>`: completion,
  hover, outline and workspace-scoped rename, all driven by real styles-only group visibility rather
  than text patterns.
- `packages/vscode/src/groups.ts` (new) mirrors the compiler's ADR-0017 item 4/5 rule from the
  document AST plus the existing sync `readModule` host — own top-level definitions first, transitive
  `@use "…" styles;` closure, token-only imports expose nothing, local shadow wins, two imported
  definitions with no local one are ambiguous, and a duplicate in one module keeps the first
  definition. It also attributes every reachable use site to the definition its own module resolves
  to, so hover and rename work from actual scope resolution.
- Completion after `@group.` offers local names first, imported names labelled with their defining
  module and ambiguous names marked with both modules, each inserting the `name {\n  \n}` skeleton;
  the `@group` directive is offered in the top-level and rule-body `@` lists. Hover shows the resolved
  module + defaults and `Overrides in this use site: …` computed from base property names, states
  ambiguity/unknown names, and shows declarations for a definition. The outline lists definitions and
  use sites nested in their rules.
- Rename edits the definition plus every `@group.<name>` reference across the visible module set
  (multi-file `WorkspaceEdit` through `providers/navigation.ts`) and refuses ambiguous/unknown names;
  the single-file `$token` rename contract is unchanged. A39 adds 19 tests (11 intelligence, 6
  navigation, 2 analysis); `bun run verify` is green at **824 pass / 0 fail across 45 files** (798/45
  baseline plus this task's tests and parallel working-tree additions), with the extension suite at
  124 pass.

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017, `SPECIFICATION.md` §3.7, plan §6 G6a/G6b and §7 G6, the editor's
   `analysis.ts`/`intelligence.ts`/providers, the compiler's `resolver/groups.ts`, and reports
   CSSX-A31/A32.
2. Implement editor-side visibility/resolution as new pure code (no compiler changes, no public
   barrel additions). Confirm the compiler's resolver internals are not exported, so mirror them in
   `packages/vscode/src/groups.ts`.
3. Add group-member completion, the `@group` directive item, group hover, outline nodes and
   multi-file group rename while preserving every existing token path.
4. Extend the extension provider tests and run `bun run verify`.
5. Update only the plan's G6a/G6b rows and write this report, the task and the log.

## Changed files

| File | Change |
|---|---|
| `packages/vscode/src/positions.ts` | **New.** `Position`/`Range` types and `computeLineStarts`/`positionAt`/`rangeAt`, moved out of `analysis.ts` so the group resolver can use them without importing analysis (avoids a module cycle). `analysis.ts` re-exports the same helpers, so the public editor surface is unchanged. |
| `packages/vscode/src/groups.ts` | **New pure resolver.** `GroupSymbol`/`GroupReference`/`GroupVisibility` plus `collectGroupVisibility`: loads the document's transitive `styles` closure through `readModule`, computes the ADR-0017 visibility closure per module (memoized, cycle-safe, own-first, deduped per defining module), resolves local-shadow vs ambiguous, and attributes every reachable use site to the definition its module resolves to. `GROUP_KEYWORD` (`"@group."`) is the single prefix constant. No `vscode` import. |
| `packages/vscode/src/analysis.ts` | `AnalyzeResult` gains `path` (absolute document path used as the group module identity) and `groups` (visible groups with resolution kind, definitions, defaults and attributed references). `analyzeText` computes them from the same parse and `readModule`; `Position`/`Range`/line helpers now come from `positions.ts` and are still exported. |
| `packages/vscode/src/intelligence.ts` | New `group-member` completion context (word scan after `@group.`), `group` suggestion kind, `@group` directive item in both `@` lists, `groupItem` (local first via sort keys, module detail, ambiguity mark, skeleton insert), `groupAt` (AST-span definition/use-site cursor), group hover (defaults, module, computed overrides, ambiguous/unknown), `group` outline nodes for definitions and rule-nested use sites, and `renameAt` delegating group cursors to `renameGroup` (definition + attributed references, ambiguity/unknown/duplicate refusals) before the untouched token path. `RenamePlan` edits gain an optional `file`. |
| `packages/vscode/src/adapter.ts` | `group` completion kind → `CompletionItemKind.Module`. |
| `packages/vscode/src/providers/navigation.ts` | `prepareRename` also accepts a group name; `provideRenameEdits` applies each edit to its own `Uri` when `file` names another module (current document for token edits and same-file group edits). |
| `packages/vscode/src/providers/symbols.ts` | `group` outline kind → `SymbolKind.Interface`. |
| `tests/extension/provider.intelligence.test.ts` | **+11 tests** (all group): completion context/ordering/skeleton/typing filter/ambiguity/definition context/`@group` directive at top level and nested; hover use-site defaults+module+override list+range, definition declarations, ambiguous and unknown; outline definition/use-site nodes; editor/compiler ambiguity agreement and a resolved styles-import agreement case. |
| `tests/extension/provider.navigation.test.ts` | **+6 tests**: same-file definition rename (definition + both use sites), same plan from a use-site member, styles-imported multi-file rename (definition in `chrome.cssx`, reference in `entry.cssx` with exact range), ambiguous refusal naming both modules, unknown/invalid-name refusals, and an explicit assertion that token rename edits stay single-file/file-less. |
| `tests/extension/provider.analysis.test.ts` | **+2 tests** for the additive analysis surface: absolute `path` + resolved group/defaults/references for a styles import; local shadow wins and token-only imports expose no groups. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G6a/G6b rows marked 🟢 with evidence. No other plan row touched. |
| `.ai/tasks/CSSX-A39.md`, `.ai/reports/CSSX-A39.md`, `.ai/reports/logs/CSSX-A39.log` | **New.** Task, report and log. |

No compiler source, public barrel, syntax/TextMate file, fixture/golden, example, ADR, specification,
`PROGRESS`, `todo` or other plan rows were modified. Pre-existing working-tree changes from parallel
work (compiler G0–G5, `property-docs.ts`, `providers/hover.ts`, grammar tests) were left untouched.

## Implementation notes

### Visibility parity with the compiler (ADR-0017 items 4–5)

`collectGroupVisibility` is a deliberate mirror of `resolver/groups.ts`, which the public compiler
barrel does not export:

- per module, top-level `group-definition` nodes in authored order, first name wins (the compiler
  reports the later duplicate; the editor never invents a second target);
- `styles` edges only (`UseImport.styles === true`), resolved relative to the importing module, walked
  depth-first in authored order with a memo and a cycle back edge that contributes nothing;
- own definitions collected before dependencies, so `symbols.length === 1 || first.file === file`
  is exactly the compiler's local-shadow/resolved rule, and anything else is `ambiguous` with ordered
  candidates;
- a second pass walks every reachable module's `group-use-site` nodes (rules, conditional blocks and
  native blocks) and appends the use-site name range to the resolved definition, so rename is
  restricted to references whose own module actually resolves the name to that definition.

The root module identity is the absolute document path (`analyzeText` exposes it as `path`); imported
modules are keyed by their normalized absolute path. Because the editor parses with the same parser
the compiler uses, ambiguity agreement is structural rather than re-implemented.

### Completion, hover, outline

- `contextAt` recognises `@group.` before the generic `@` directive branch, so `@group.ca` is a
  `group-member` context with `word: "ca"`; the replace range is the member word only and the insert
  text is `name {\n  \n}`, producing `@group.<name> { … }` at the cursor.
- Items use `sortText` `0-`/`1-`/`2-` for local/imported/ambiguous so “local first” survives VS Code's
  own sorting; the detail names the defining module (`@use` specifier or relative path).
- `groupAt` addresses only the name text (`span.start + 7 … + name.length`) and returns the keyword
  range for hover. Hover over a use site resolves `analysis.groups`, lists the definition module and
  defaults, and computes `Overrides in this use site:` by intersecting the use-site block's base
  property names with the definition's properties in authored order — analysis only, never
  compilation, per ADR-0017 item 3.
- `documentSymbols` emits a top-level `group` node per definition (declaration children) and a
  `group` child node per use site inside its rule (override declaration children), mirroring how
  conditional blocks and declarations already nest.

### Rename

`renameAt` checks for a group cursor first, then falls through to the untouched token implementation,
so every existing test and behaviour is preserved. Group rename:

- validates the new name with the existing identifier pattern;
- resolves the cursor name through the document view: ambiguous → refusal naming both defining
  modules; unknown → refusal; a later duplicate definition (first wins) → refusal;
- returns edits for the definition name plus every attributed reference range, each carrying its
  `file`; `providers/navigation.ts` maps `file` to `document.uri` or `vscode.Uri.file(file)` and
  applies them in one `WorkspaceEdit`. Token edits keep `file` undefined and remain single-file.

## Verification

| Command | Outcome |
|---|---|
| `bun test tests/extension` | **124 pass / 0 fail**, 10 files, 852 `expect()` calls (baseline run before this task: 101; A39 adds 19 tests plus parallel working-tree tests already present at verify time) |
| `bun run verify` (typecheck + lint + full test) | **green**: `824 pass / 0 fail` across **45 files**, 789,473 `expect()` calls |

Baseline recorded before the change: extension 101 pass; full suite 798 pass / 45 files. A39 adds 19
tests (11 `provider.intelligence`, 6 `provider.navigation`, 2 `provider.analysis`); the working tree
also carries parallel workers' tests (property docs, grammar) that were not modified here. No
pre-existing test was weakened, skipped or renamed.

## Acceptance criteria

- Completion after `@group.` lists visible groups with local definitions first, imported names
  labelled with their module and ambiguous names marked; each inserts a block skeleton; definition
  context completes names; `@group` completes after `@` at top level and in rule bodies. **PASS**
  (provider tests; probe against fixtures).
- Hover on a use site shows the resolved definition (module + defaults) and the base properties the
  use site overrides from real resolution; ambiguous names name both modules; unknown names are
  stated; definition hover shows declarations; range covers `@group.<name>`. **PASS**.
- Outline lists definitions and rule-nested use sites. **PASS**.
- Rename updates the definition and every reference across the visible modules (verified
  cross-file against `tests/fixtures/groups/style-import`), refuses ambiguity naming both modules,
  and leaves the token rename contract untouched. **PASS**.
- Editor and compiler agree on ambiguity (pinned with `tests/fixtures/groups/ambiguous-import`).
  **PASS**.
- Diagnostics continue to flow from the compiler; no editor-side diagnostic was added. **PASS** (no
  change needed).

## Handoff

- **Completed state:** G6a and G6b are implemented and verified in the extension layer; G6c
  (TextMate scopes) remains the parallel syntax worker's scope. The plan's G6a/G6b rows are 🟢.
- **Touched files:** `packages/vscode/src/{positions,groups,analysis,intelligence,adapter}.ts`,
  `packages/vscode/src/providers/{navigation,symbols}.ts`,
  `tests/extension/provider.{analysis,intelligence,navigation}.test.ts`, plan G6a/G6b rows, this
  report, `.ai/tasks/CSSX-A39.md`, `.ai/reports/logs/CSSX-A39.log`.
- **Remaining steps:** none for A39. Records catch-up (ADR/limitations/board) is a separate task per
  the dispatch; do not rebundle it here.
- **Known limitation:** rename covers the current document's visible module set (its own definitions
  plus the transitive `styles` closure), which is exactly the plan's visibility scope; modules that
  import the current document from above are not part of it.
