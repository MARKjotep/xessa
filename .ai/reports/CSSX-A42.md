# CSSX-A42 — Editor intelligence for `$keyframes.<name>`

## Summary

- Added `$keyframes.<name>` editor support mirroring the A39 `@group` pattern: a pure, `vscode`-free
  visibility resolver (`packages/vscode/src/keyframes.ts`), exposed as `AnalyzeResult.keyframes`;
  member completion after `$keyframes.` (local first, imported module marked, duplicates each
  listed); hover with defining module and frames summary (unknown cites XESSA2001, ambiguous names
  both modules); and a multi-file rename of the definition, every attributed `$keyframes.<name>`
  reference and exact `animation-name: <name>` values.
- Visibility matches the compiler exactly: own top-level plain-identifier `@keyframes` names plus
  transitive `@use "…" styles;` names; token-only imports expose nothing; a local definition shadows
  imported definitions for rename while duplicates remain valid CSS and produce no diagnostic. A test
  pins that a token-only-imported keyframe is invisible to the editor and XESSA2001 in the compiler.
- Rename refuses an ambiguous visible set (naming both modules), an invalid CSS identifier, a later
  duplicate definition header (first definition wins) and a new name already in scope. The `animation:`
  shorthand and multi-name `animation-name` values are never rewritten; token and group rename
  contracts are unchanged and asserted alongside keyframe rename.
- Validation: `bun run verify` green at **849 pass / 0 fail / 45 files** (826 baseline + 23 new
  tests); targeted suites 72 pass; extension suite 149 pass; typecheck and Biome clean. A post-review
  correction makes the `keyframes` namespace word inside `$keyframes.<name>` resolve like the `$` and
  name parts (AST reference plus a guarded textual fallback for recovery-dropped statements).
- String/escaped and nested/conditional keyframes and token-only-import keyframe names were
  explicitly out of scope (owner decisions pending an ADR-0015 amendment) and are neither implemented
  nor advertised.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| Keyframe collection | `keyframes.ts` visibility closure + `AnalyzeResult.keyframes` | Styles-only closure, token-only invisible, duplicates listed | 🟢 complete |
| Completion | `$keyframes.` member items | Local first, imported/duplicate/ambiguous details, typed filter | 🟢 complete |
| Hover | Definition and reference hover | Module + frames, unknown/ambiguous explicit, whole-reference range | 🟢 complete |
| Rename | `keyframeAt` + `renameKeyframe` + provider routing | Definition + references + exact `animation-name`, multi-file, refusals | 🟢 complete |
| Outline | Existing `@keyframes` native node | `@keyframes` block with name detail | 🟢 complete (verified, unchanged) |
| Tests and verification | Intelligence/navigation tests | Fixtures + virtual modules, `bun run verify` green | 🟢 complete |

## Changed files

| File | Change |
|---|---|
| `packages/vscode/src/keyframes.ts` | **New pure resolver.** `KEYFRAMES_NAMESPACE`/`KEYFRAMES_KEYWORD`, `KeyframeSymbol` (name/file/declaration/frames/references/animationNames), `KeyframeVisibility` (resolved with `duplicates`, or ambiguous candidates), `collectKeyframeVisibility` (top-level plain-identifier `@keyframes`, styles-only transitive closure, memoized/cycle-safe, first definition per module wins, reference and exact `animation-name` attribution by each module's own resolution) and `keyframeDefinitionAt` (name range + frames from parser spans). No `vscode` import. |
| `packages/vscode/src/analysis.ts` | `AnalyzeResult.keyframes` and the `analyzeText` call, sharing the same parse, text and `readModule` host as groups/tokens. |
| `packages/vscode/src/intelligence.ts` | `member` completion special-cases the built-in `keyframes` namespace (local `0-`, imported `1-`, duplicate/ambiguous `2-`, frames/documentation); `keyframeAt` (definition header or `$keyframes.` reference cursor, including the `keyframes` namespace word via a guarded textual fallback for recovery-dropped statements); `keyframeHover`; `renameKeyframe`; `hoverAt` and `renameAt` delegate to them before the untouched token path. |
| `packages/vscode/src/providers/navigation.ts` | `prepareRename` accepts a keyframe definition or reference name; `provideRenameEdits` already applies `file`-carrying edits to their own `Uri`, so keyframe rename becomes one `WorkspaceEdit` with no further change. |
| `tests/extension/provider.intelligence.test.ts` | **+16 tests**: completion local/imported/typed-filter/duplicates/token-only; hover styles reference + range, definition header, percentage stops, unknown/XESSA2001, ambiguous both modules, local duplicate note, and the `keyframes` namespace word for defined and unknown references; outline `@keyframes`; styles-import agreement; token-only agreement pin; duplicate agreement. |
| `tests/extension/provider.navigation.test.ts` | **+7 tests**: same-file definition + `$keyframes.` reference + exact `animation-name` (shorthand/multi-name untouched), plan from a reference, styles-import cross-module rename with exact ranges, ambiguous refusal naming both modules, invalid identifier/unknown/collision refusals, later duplicate definition refusal, token + group contracts unchanged in a keyframe document. |
| `.ai/tasks/CSSX-A42.md`, `.ai/reports/CSSX-A42.md`, `.ai/reports/logs/CSSX-A42.log` | **New.** Task, report and log. |

No compiler, parser/lexer/types, syntax/TextMate, example, documentation, ADR, specification, plan,
todo, `PROGRESS`, fixture or `button.cssx` file was touched. No dependency or framework record is
involved (Xessa editor work, not a third-party framework defect).

## Implementation notes

### Visibility parity with the compiler (ADR-0015)

`collectKeyframeVisibility` deliberately mirrors `resolver/keyframes.ts`, which the public compiler
barrel does not export:

- per module, top-level `native-at-rule` nodes whose name is ASCII case-insensitive `keyframes`
  and whose trimmed prelude is a single plain identifier (`/^[A-Za-z_-][A-Za-z0-9_-]*$/`), first
  definition of a name wins; string/escaped/multi-token preludes and nested blocks are ignored;
- `styles` edges only (`UseImport.styles === true`), resolved relative to the importing module, walked
  depth-first in authored order with a memo and a cycle back edge that contributes nothing;
- own names collected before dependencies, so `symbols.length === 1 || first.file === file` is the
  resolved/local-shadow rule; anything else is `ambiguous` with ordered candidates; a resolved local
  definition keeps the shadowed imported symbols as `duplicates` for completion display;
- a second pass walks every reachable module's declaration and token-value `dollar-ref` tokens
  (`$keyframes.<name>`) plus declarations whose property is exactly `animation-name` and whose whole
  value equals the name, attributing each to the definition its own module resolves. Frames come from
  the definition's direct rule selectors (`from`, `to`, `50%`) in first-seen order.

The root identity is `AnalyzeResult.path` (absolute document path), the same key groups use; imported
modules are keyed by normalized absolute path.

### Completion, hover, outline

- `contextAt` already classifies `$keyframes.` as `member` with namespace `keyframes`; the member
  branch now intercepts that built-in namespace before `importByAlias`, so an (invalid) `@use … as
  keyframes` cannot shadow it, matching ADR-0015.
- Items insert only the member name; details use the same module labelling as groups (`this file`,
  `./module.cssx`) and sort keys keep local → imported → duplicate/ambiguous ordering. No diagnostic
  is produced for duplicates.
- `keyframeAt` resolves the definition header through `keyframeDefinitionAt` spans and references
  through the existing `collectTokenReferences` scanner filtered to `namespace === "keyframes"`, so
  strings, comments and URLs stay inert. When the reference is absent from the recovered AST (for
  example a dropped statement), a textual fallback locates the whole `$keyframes.<name>` construct
  with the same string/comment/`url(...)` guards, so the `keyframes` namespace word resolves exactly
  like the `$` and name parts. Hover range is the whole `$keyframes.<name>` reference.
- `documentSymbols` was not changed: `native-at-rule` nodes already surface `@keyframes` with the
  prelude as detail; a test pins that shape.

### Rename

- `renameAt` checks group cursors, then keyframe cursors, then the untouched token path.
- `KEYFRAME_NAME_PATTERN = /^-?[A-Za-z_][A-Za-z0-9_-]*$/` is the editor's CSS-identifier check for
  new names. The compiler accepts a leading `-`/`_`; invalid starts and punctuation are refused with
  a "valid CSS identifier" message.
- The plan edits the definition name, every attributed `$keyframes.<name>` name range and every
  attributed exact `animation-name` value range, each carrying its module `file`.
  `providers/navigation.ts` already maps `file` to the current document or `vscode.Uri.file`, so no
  extra provider logic was required.
- Refusals: unknown name; ambiguous set (names both defining modules); later duplicate definition
  header (`sameRange` mismatch with the first definition); collision when the new name is another
  visible keyframe name. Renaming to the current name is a no-op plan.
- Limitation (documented): `animation:` shorthand values are not rewritten; only exact
  `animation-name: <name>` whole values. Multi-name values (`spin, fade`) are not rewritten.

## Verification

| Command | Outcome |
|---|---|
| `bun run typecheck` | ✅ all four projects clean |
| `bun run lint` | ✅ Biome clean (422 files) |
| `bun test tests/extension/provider.intelligence.test.ts` | ✅ 51 pass / 0 fail (35 existing + 16 new) |
| `bun test tests/extension/provider.navigation.test.ts` | ✅ 21 pass / 0 fail (14 existing + 7 new) |
| `bun test tests/extension` | ✅ 149 pass / 0 fail, 10 files, 972 expect() calls |
| `bun run verify` | ✅ exit 0 — **849 pass / 0 fail across 45 files** (826 baseline + 23 new), typecheck + lint green |

Baseline from the task: 826 pass / 0 fail / 45 files. This task adds 23 tests, matching 849.

## Notes / blockers

- No blockers. Post-review correction (attempt 1): hover inside the `keyframes` namespace word of a
  defined or unknown `$keyframes.<name>` reference now returns the same reference/unknown hover as
  the `$` and name parts; plain `$tokens`, `$theme.member`, `@keyframes` headers, strings, comments
  and `url(...)` are unchanged (pinned by two new tests).
- Explicitly out of scope per the task and ADR-0015: keyframe names through token-only imports,
  string-named/escaped keyframes, keyframes nested in `@media` or other blocks, and any compiler
  semantic change. The editor mirrors the compiler and does not advertise those forms.
- Duplicate names across visible modules are legal and undiagnosed; the editor lists each definition
  in completion and refuses rename until the set is unambiguous, which is an editor safety choice, not
  a compiler diagnostic.
- Pre-existing working-tree changes from A29–A41 and other parallel work were left untouched; only
  the files listed above were edited. No `.ai/framework/` record applies (Xessa editor feature, not a
  third-party framework defect or request).

## Handoff

Complete. `$keyframes.<name>` completion, hover, outline verification and multi-file rename are
implemented, tested and green. Ownership of `packages/vscode/src/keyframes.ts`,
`analysis.ts` keyframes surface, `intelligence.ts` keyframe paths, `providers/navigation.ts`
prepareRename and the two provider test files can be released. Remaining item-6 work is the
compiler-semantics half owned elsewhere (token-only keyframe visibility, string-named and conditional
keyframes) subject to an ADR-0015 amendment.
