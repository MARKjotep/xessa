# CSSX-GROUP-COMPOSITION

## Summary

- **PASS** — group definitions now accept nested `@group.<base> { overrides }` composition
  (ADR-0025); selector use sites remain declarations-only, so a nested `@group.` there is still
  `XESSA1001`.
- Composition resolves in the **defining module's** scope, expands the base's effective
  declarations, then the composition overrides, in authored order. Diamonds and repeated targets
  expand textually and are never deduplicated.
- Cycles and depth beyond 64 are `XESSA2001` at the offending nested statement; unknown/ambiguous
  targets reuse the existing messages. Only the offending statement is omitted. Unused definitions
  stay inert.
- Parser, resolver walks, expansion, formatter, spec, grammar/usage/limitations/compatibility docs,
  ADR-0025 and a `groups/composed` golden are updated. No new diagnostic code.

## Semantics

1. A `GroupDefinition` body is an ordered list of declarations and nested composition statements.
   `declarations` still holds only the direct declarations for compatibility.
2. Composition is a definition-body construct only. A use-site block accepts declarations only; a
   `@group.` statement inside it is `XESSA1001` and only that statement is omitted.
3. Nested rules, conditional blocks and native at-rules remain `XESSA1001` in both contexts.
4. A composition target resolves with the defining module's visible group scope (own definitions,
   then transitive `styles` imports, local shadowing). Token-only imports expose no groups.
5. Expansion order: authored body order; declarations splice in place; a composition expands the
   base's effective declarations, then the composition block's overrides, then continues. A use site
   then appends its own declarations.
6. Repeated composition and diamonds expand textually; no deduplication of declarations or group
   identities.
7. A cycle is `XESSA2001` at the closing statement with the chain
   (`@group.a -> @group.b -> @group.a`). Composition depth > 64 is `XESSA2001` without recursion.
8. Unknown and ambiguous nested targets are `XESSA2001` at the nested statement using the existing
   unknown/ambiguous messages and module list style.
9. Spliced declarations keep their authored node, span and `span.file`, so tokens resolve in the
   defining module and `@runtime` defaults/overrides stay rejected.
10. Formatter round-trips composition blocks, preserves comments and is idempotent.
11. Unused definitions remain inert: unreachable cycles/unknowns produce no diagnostic.

## Changes

- `packages/compiler/src/types/ast.ts:202` — `GroupDefinition.body` plus
  `GroupDefinitionItem` (`Declaration | GroupUseSite`); `declarations` retained.
- `packages/compiler/src/parser/group.ts:171`/`:245` — `allowComposition` flag; definitions parse a
  well-formed nested group via `parseGroupUseSite`, use-site bodies keep composition disabled.
- `packages/compiler/src/lowering/expand-groups.ts:58` — depth cap, optional per-module `scopes`,
  recursive `expandDefinition` (`:189`), cycle chain, deduplicated nested diagnostics, authored
  splice order.
- `packages/compiler/src/index.ts:409` — one module → visible-scope map passed to both style-module
  and entry expansions (`:424`, `:448`).
- `packages/compiler/src/resolver/references.ts:48` — `unqualifiedReferenceNames` traverses
  definition bodies and composition overrides.
- `packages/compiler/src/variables/ast.ts:101` — `groupDefaultSegments` includes composition
  overrides, so `@runtime` references there are rejected.
- `packages/compiler/src/formatter/index.ts:377` — definitions print the ordered `body`;
  `embeddedCommentRanges` traverses nested composition declarations.
- Tests: `tests/compiler/groups.parser.test.ts` (composition parse + use-site rejection),
  `tests/compiler/groups.expansion.test.ts` (local/transitive/imported composition, shadowing,
  cycles, depth, unknown/ambiguous (with cross-use-site deduplication), token attribution in both
  the base and defining-module overrides, `@runtime`, use-site rejection),
  `tests/compiler/formatter.test.ts` (round-trip/idempotence/comments), catalog counts in
  `golden.test.ts`, `pipeline.test.ts`, `sourcemap.test.ts`.
- Fixture: `tests/fixtures/groups/composed/` (input, expected CSS, empty diagnostics).
- Docs: `SPECIFICATION.md` §3.2/§3.7, `docs/grammar.md`, `docs/usage.md`,
  `docs/known-limitations.md`, `docs/compatibility.md`, new
  `docs/decisions/ADR-0025-group-composition.md`, amendment line in ADR-0017.
- No new diagnostic code.

## Validation

| Command | Outcome |
|---|---|
| `bun test tests/compiler/groups.parser.test.ts` | PASS — 28 tests, 0 fail |
| `bun test tests/compiler/groups.expansion.test.ts` | PASS — 33 tests, 0 fail |
| `bun test tests/compiler/groups.resolver.test.ts` | PASS — 11 tests, 0 fail |
| `bun test tests/compiler/groups.golden.test.ts` | PASS — 31 tests, 0 fail |
| `bun test tests/compiler` | PASS — 784 tests, 39 files, 0 fail |
| `bun run typecheck` | PASS — exit 0 (compiler, cli, language-service, vscode projects) |
| `bun run lint -- <changed files>` | PASS — `biome check .` reported no fixes |
| `git diff --check` | PASS — exit 0 |

Pre-existing working-tree edits under `examples/portfolio/**` and `packages/vscode/**` were left
untouched. The already-verified VS Code group/keyframe navigation work was not reverted.

## Handoff

- Compiler/spec/formatter half is complete and verified.
- **Still pending:** VS Code editor support for composition (completion, hover, outline,
  navigation/rename behavior) and the media `+` alias completion follow-up. This task intentionally
  did not touch `packages/vscode/**`.
- Golden/catalog counts were raised from 67 to 68 for the new `groups/composed` fixture; no existing
  golden assertion was weakened.
