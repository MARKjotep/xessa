# CSSX keyframe navigation and namespace suggest retrigger

## Summary

- Go to Definition now resolves an `@keyframes <name>` header, a
  `$keyframes.<name>` reference and an exact `animation-name: <name>` value to
  the defining module's name range, locally and through `@use "…" styles`.
- Find All References from any of those positions returns the declaration, every
  resolving `$keyframes.<name>` and every exact `animation-name: <name>` value,
  in both directions. `includeDeclaration: false` omits only the declaration.
- The same exact `animation-name` value is now a full keyframe cursor, so hover,
  `prepareRename` and rename work from it with the same plan as the definition
  and `$keyframes` reference (declaration + all resolving references + values).
- Unknown, ambiguous, token-only-imported and later-duplicate definitions add no
  false target or reference; the shorthand, comma lists and strings are not
  cursors.
- Accepting `$keyframes.`, an imported `$alias.` or `@group` now sets
  `retriggerSuggest`, so VS Code reopens the member list immediately.
- VS Code extension only: no compiler, CLI, language-service, dependency,
  import/fixture or package-version changes. The uncommitted group-navigation
  work is preserved.

## Changes

- `packages/vscode/src/intelligence.ts`
  - `keyframeAt` (`:2433`) now ends with the exact `animation-name` cursor, so
    every consumer (definition, references, hover, prepareRename, rename) shares
    one cursor path. `@keyframes` headers and `$keyframes.<name>` handling are
    byte-identical to before.
  - `animationNameKeyframeAt` (`:2583`) returns the shared `"reference"` cursor
    shape (name range = value range = keyword range) from
    `analysis.keyframes[*].symbol.animationNames`; only resolved entries are
    considered, so shorthand, comma lists, strings, unknown/ambiguous names and
    token-only imports never match.
  - `keyframeDefinitionAt` (`:2556`) now only resolves the shared cursor through
    `analysis.keyframes`, rejects unresolved/later-duplicate positions and has no
    duplicate `animation-name` lookup.
  - `referencesToKeyframe` (`:4067`) mirrors `referencesToGroup`: it identity-
    checks the resolved symbol by normalized file + declaration range and emits
    only this module's declaration, `$keyframes` name ranges and
    `animation-name` value ranges.
  - `definitionsAt` / `referencesAt` fall back token → group → keyframe.
  - `retriggerSuggest: true` added to the `@group` directive item (`:3179`), the
    `$keyframes.` item (`:3223`) and every imported `$alias.` item (`:3237`).
  - `CompletionSuggestion.retriggerSuggest` docs updated.
- `packages/vscode/src/providers/navigation.ts`
  - `XessaReferenceProvider` resolves a third `"keyframe"` kind (`:99`–`:107`)
    and dispatches `occurrencesIn` to `referencesToKeyframe` (`:142`).
    `prepareRename` already reads `keyframeAt`, so it now reports the value
    bytes. Scan limit, excludes, open-document priority, dedupe and sort
    unchanged.
- `packages/vscode/src/providers/completion.ts`
  - Header comment now documents namespace/directive retriggering (code path was
    already generic).
- `tests/extension/provider.navigation.test.ts`
  - New `keyframe definition and references` describe (`:669`) with virtual
    motion/entry/shadow/other/ambiguous/token-only modules covering all
    definition/reference acceptance cases and a token/group regression.
  - New rename test (`:1636`): the plan from an exact `animation-name` value
    equals the definition plan (3 edits, same placeholder), and `keyframeAt`
    exposes the reference cursor over the value bytes.
- `tests/extension/provider.intelligence.test.ts`
  - New retrigger test (`:743`) for `$keyframes.`, `$theme.`, `@group`, plus
    negative assertions for token, member, setup and group-member families.
  - New hover test (`:2499`): an exact `animation-name` value shows the existing
    keyframe hover at the value range; shorthand, comma list and unknown names
    have none.
- `packages/vscode/test/ui/navigation.js`
  - Public-command keyframe scenarios (`:316`): local definition/reference/value
    and cross-module definition plus the full 3- and 4-location reference sets.
  - `vscode.prepareRename` from the value reports the value bytes (`:396`) and
    `vscode.executeDocumentRenameProvider` from the value matches the definition
    plan with the same 3 edits (`:434`).
- `packages/vscode/test/ui/completions.js`
  - Host assertions for `editor.action.triggerSuggest` on `@group`,
    `$keyframes.` and `$theme.`; the `$keyframes.` item is applied and the
    member list requested at the new cursor.

## Validation

| Command | Result |
| --- | --- |
| `bun test tests/extension/provider.navigation.test.ts` | PASS — 49 tests, 269 assertions |
| `bun test tests/extension/provider.intelligence.test.ts` | PASS — 122 tests, 5497 assertions |
| `bun run typecheck` | PASS — compiler, CLI, language-service and VS Code tsc |
| `bun run lint -- <changed files>` | PASS — Biome checked, no fixes applied |
| `bun test tests/extension/host.test.ts` | PASS — cached VS Code 1.147.0, 15 scenarios, 979 assertions (navigation 63, completions 181) |
| `git diff --check` | PASS — no whitespace errors |

`git status --short` after validation shows the expected extension source/test
files, the new report and the pre-existing `examples/portfolio/src/layout.cssx`
and `examples/portfolio/src/theme.cssx` edits (present before this task, left
untouched).

## Handoff

- Group navigation and its report are unchanged.
- Keyframe definition, references, hover, `prepareRename` and rename now cover
  headers, `$keyframes.<name>` references and exact `animation-name` values.
- Host `vscode.executeReferenceProvider` still takes only `(uri, position)` and
  always includes the declaration, so the `includeDeclaration: false` host path
  stays unverifiable; the pure tests cover it directly.
- No remaining rename limitation from an `animation-name` value.
