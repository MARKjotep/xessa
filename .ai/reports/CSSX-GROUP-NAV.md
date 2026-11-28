# CSSX-GROUP-NAV — VS Code definition/references for `@group.<name>`

## Summary

- Added editor-only Go to Definition and Find All References for `@group.<name>` definitions and use sites by reusing the existing `analysis.groups` resolver.
- Use sites jump to the definition's name bytes in the same file or a `styles`-imported module; references return the declaration plus every resolving use site (bidirectional, local and cross-module).
- Unknown, ambiguous (XESSA2001) and locally shadowed group names never contribute the shadowed target.
- No compiler, CLI, language-service, dependency or version changes. Keyframe navigation has the same gap and is recorded here as a follow-up only.

## Changes

- `packages/vscode/src/intelligence.ts:2278` — new `groupDefinitionAt(analysis, offset)`: `groupAt` cursor → resolved `analysis.groups` entry → `DefinitionTarget` with the name range (`card` in `@group.card`); ambiguous/unknown names return `undefined`.
- `packages/vscode/src/intelligence.ts:3950` — new `referencesToGroup(analysis, target, { includeDeclaration })`: identity-checks the resolved symbol by file + declaration range, then returns this module's declaration (when requested) and its own authored use sites. Resolution-based, so shadows and ambiguity are excluded.
- `packages/vscode/src/intelligence.ts:3977` — `definitionsAt` stays token-first, then falls through to group resolution, so `$token` inside a group body still resolves to the token declaration.
- `packages/vscode/src/intelligence.ts:3993` — `referencesAt` gains the same group fallback after its token path.
- `packages/vscode/src/providers/navigation.ts:94` — definition provider unchanged (`definitionsAt` now returns group targets).
- `packages/vscode/src/providers/navigation.ts:125` — reference provider resolves either a token or a group target and feeds both through one occurrence collector; candidate limit (200), excludes, open-document priority, dedupe, sorting and `includeDeclaration` are preserved.
- `tests/extension/provider.navigation.test.ts:423` — pure coverage: local definition, styles import, definition→references, use-site→same set, `includeDeclaration: false`, shadowed/ambiguous/unknown exclusion, and token-first navigation inside a group body.
- `packages/vscode/test/ui/navigation.js:153` — host scenario through the public commands on `navigation-entry.cssx` / `navigation-groups.cssx`, asserting the definition and exact 3-location reference sets from the definition and both use sites before the existing group rename mutates the fixture.

## Validation

- `bun test tests/extension/provider.navigation.test.ts` — PASS: 42 pass, 0 fail, 210 `expect()` calls (~1 file).
- `bun run typecheck` — PASS (exit 0) for compiler, CLI, language-service and VS Code projects.
- `bunx biome check packages/vscode/src/intelligence.ts packages/vscode/src/providers/navigation.ts tests/extension/provider.navigation.test.ts packages/vscode/test/ui/navigation.js` — PASS: 4 files checked, no fixes/errors.
- `bun test tests/extension/host.test.ts` — PASS: 2 pass, 0 fail; cached VS Code 1.147.0 runnable; 15 host scenarios / 957 assertions, including `navigation` 48 assertions. The group nav assertions cover definition from a use site, definition from the definition header, and exact 3-location reference sets from the definition and both use sites.
- Keyframe navigation was not changed; the same definition/references gap remains a follow-up.

## Handoff

- Working tree contains only the four allowed source/test changes plus this report. No fixture, lockfile, compiler, CLI or language-service edits.
- Next action: none for this task. Optional follow-up: apply the same `analysis.keyframes`-based targeting to `@keyframes <name>` navigation.
