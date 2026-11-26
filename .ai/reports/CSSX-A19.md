# CSSX-A19 — Built-in `keyframes` namespace (`$keyframes.<name>`)

## Summary

- `@keyframes <name>` now registers `<name>` in a built-in `keyframes` namespace, so
  `animation-name: $keyframes.spin` compiles to `animation-name: spin` beside the native keyframe
  block — one authored name, no duplicated identifier.
- Visibility follows emit safety: a module sees its own top-level `@keyframes` names plus those of
  modules imported with `@use "…" styles` (transitively, ADR-0014). Token-only imports expose nothing,
  because their CSS is not emitted; referencing one is XESSA2001 instead of a broken animation.
- Unknown member, bare `$keyframes` and `@use … as keyframes` are XESSA2001 with the declaration
  segment omitted. Duplicate names across merged modules are authored CSS, never an error. No new
  diagnostic codes, no parser/lexer or frozen-contract change.
- Recorded in ADR-0015, SPECIFICATION.md §6.4/§3.6/§13, author docs, one new fixture group plus
  `tests/compiler/keyframes.test.ts`.

## Objective (as executed)

1. Collect keyframe names per module in the resolver and expose them as a per-module `keyframes`
   map on `ModuleRecord`.
2. Expand `$keyframes.<name>` in declaration values as literal text; reject unknown member, bare
   namespace and alias shadowing with the existing XESSA2001.
3. Record the owner decision and the visibility rule in ADR-0015, integrate normative text, and
   update author-facing docs.
4. Add same-file, unknown-member, bare-namespace, style-import, token-only and duplicate-name
   fixtures plus unit tests for collection/expansion/visibility.

Mid-task design update from the lead (owner review) was folded in: keyframe names are importable
through `@use … styles`; token-only imports stay invisible; duplicate names produce no diagnostic.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/resolver/keyframes.ts` | **New.** `KEYFRAMES_NAMESPACE`, `collectKeyframes` (top-level, plain-identifier preludes, case-insensitive at-rule name, first-definition-wins) and `visibleKeyframes` (own + transitive `styles` closure, memoized, cycle-safe). |
| `packages/compiler/src/resolver/types.ts` | Added `KeyframeName` and `ModuleRecord.keyframes` (resolver-internal record; frozen `types/**` untouched). |
| `packages/compiler/src/resolver/graph.ts` | Collects per-module keyframe sources, computes visibility once, stores it on each record; reuses the same `styleDependencies` list. |
| `packages/compiler/src/resolver/scopes.ts` | `@use … as keyframes` is XESSA2001 at the `@use` span and never becomes a namespace. |
| `packages/compiler/src/resolver/index.ts` | Barrel exports `KEYFRAMES_NAMESPACE` and `KeyframeName`. |
| `packages/compiler/src/variables/expand.ts` | `ReferenceResolution` gains a literal `text` kind; built-in `keyframes` branch before user namespaces; bare-`$keyframes` failure; `expandValue` splices `text` verbatim. |
| `packages/compiler/src/variables/{index,substitute}.ts` | Facade/doc updates only. |
| `tests/compiler/keyframes.test.ts` | **New.** 19 tests: collection, visibility closure, expansion, section omission, alias shadowing, merged fixtures. |
| `tests/compiler/variables.golden.test.ts` | Three new `keyframes/*` cases in the deferred `$`-reference golden list. |
| `tests/fixtures/keyframes/` | **New.** `same-file`, `unknown-member`, `bare-namespace` (single-file) and `style-import`, `token-only`, `duplicate-name` (merged `entry.cssx`). |
| `tests/fixtures/README.md` | Index rows for the six new fixtures. |
| `docs/decisions/ADR-0015-keyframes-namespace.md` | **New.** Owner decision, visibility rule and rejected alternatives. |
| `SPECIFICATION.md` | New §6.4 normative section; §3.6 reserved-name note; §13 deferred item. |
| `docs/grammar.md` §7 | `$keyframes.<name>` author section. |
| `docs/compatibility.md` | Feature row + `@keyframes` note. |
| `docs/known-limitations.md` | §1 editor gap row and §4 keyframe limitation row. |

Untouched as required: `packages/compiler/src/{parser,lexer,types}/**`, `packages/vscode/**`,
`.ai/todo.md`, `.ai/PROGRESS.md`. No new diagnostics; XESSA2001 reused.

## Before/after evidence

Baseline = `git archive HEAD` (pre-change tree) compiled in a scratch directory with the same
fixture inputs.

**Before** — `tests/fixtures/keyframes/same-file/input.cssx`

```text
@keyframes spin { … }

.ui-spinner {
  animation-duration: 1s;
}
diag: XESSA2001: Unknown token namespace "$keyframes" in "…/input.cssx"; import it with @use "..." as keyframes.
```

**After** — same input, current tree

```text
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ui-spinner {
  animation-name: spin;
  animation-duration: 1s;
}
diag: (none)
```

**Before** — `keyframes/style-import/entry.cssx` (merged build): `animation-name` segment omitted
(XESSA2001 unknown namespace), keyframe block emitted.

**After** — `animation-name: spin;` present in `.app-page`, imported `@keyframes spin` block emitted
first (imported module rules before entry rules, ADR-0014).

**After** — `keyframes/token-only/entry.cssx` (token-only import of the same module):

```text
diag: XESSA2001: Unknown keyframe "$keyframes.spin" in "…/entry.cssx"; "$keyframes" exposes this
file's own @keyframes names and those of modules imported with @use "..." styles (ADR-0015).
css: ""
```

## Golden diff list

- No existing golden was modified (`git status` shows zero changes under any `expected/` directory).
- New goldens: `tests/fixtures/keyframes/{same-file,unknown-member,bare-namespace,style-import,token-only,duplicate-name}/expected/css`
  plus `diagnostics.json` (`null`) for the three single-file fixtures. Each was generated with the
  real pipeline and reviewed line by line: `same-file` = keyframe block + `animation-name: spin`;
  `unknown-member` / `bare-namespace` = keyframe block only (declaration and its empty rule pruned);
  `style-import` = imported block, `.ui-spinner`, then `.app-page` with `animation-name: spin`;
  `token-only` = empty CSS; `duplicate-name` = two `@keyframes spin` blocks plus the referencing rule.
- Fixture-catalog counts were already bumped to 52 by the parallel CSSX-A17 work (its extra `errors/`
  fixture plus these three); this task only added `keyframes/*` entries to the deferred list and the
  three golden cases.

## Validation

| Command | Result |
|---|---|
| `bun run typecheck` | ✅ 4 projects clean |
| `bun run lint` | ✅ Biome clean (373 files) |
| `bun test tests/compiler` | ✅ 516 pass / 0 fail |
| `bun test tests/compiler/keyframes.test.ts` | ✅ 19 pass / 0 fail |
| `bun run verify` | ✅ exit 0 — 656 tests / 39 files, typecheck + lint green |

Determinism: the visibility closure is memoized and computed in sorted canonical-path order; the
golden suite's repeat-run test and the merged-fixture byte comparisons pass on repeated runs. The
compiler core stays pure and filesystem-free; no dependency was added.

## Notes / blockers

- **Shared-tree concurrency:** during this task CSSX-A17 (`parser/**`, `tests/compiler/parser.test.ts`,
  fixture counts) and CSSX-A18 (`packages/vscode/**`) were editing in the same worktree. A transient
  `tsc` error in `packages/compiler/src/parser/declaration.ts` blocked the first verification attempt;
  it cleared once A17 finished. Final `bun run verify` is green on the combined tree. No parser,
  lexer, frozen-type or VS Code file was touched by this task.
- **Todo board (per lead request):** the no-import fallback already exists in v0.1 —
  `@variables { spin: spin; }` + `animation-name: $spin;` works unchanged. Add to `.ai/todo.md`
  (owned elsewhere): keyframe-name completion/hover/rename, keyframe names through token-only imports,
  string-named keyframes, and conditional keyframes inside `@media`/nested blocks.
- No `.ai/framework/` record: the change is Xessa work, not a third-party framework defect or feature.

## Handoff

Complete. `$keyframes.<name>` compiles to the plain keyframe name for same-file and
`@use … styles` declarations; every rejection is the existing XESSA2001 with segment omission.
Remaining follow-ups are the editor support items above (explicitly out of scope for A19). Ownership
of `packages/compiler/src/resolver/**` and `packages/compiler/src/variables/**` can be released.
