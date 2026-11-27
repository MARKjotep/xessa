# CSSX-VAR-TOKEN-NAMES — `var($runtimeToken)` naming shorthand

## Summary

- A `$` reference that is the **entire first argument** of an authored `var(` call now renders a
  `@runtime` token as its bare custom-property name: `var($primary, #333)` → `var(--ui-primary,
  #333)`, removing the old broken `var(var(--ui-primary), #333)`.
- A **compile-time** reference in that position is XESSA2001 and the declaration is omitted, with a
  message naming the authored text and offering a `@runtime` token or `var(--name)`.
- One structural detector in `variables/expand.ts` feeds both callers (`substitute` and
  `emitRuntimeTokens`) through the existing expansion hooks, so both behave identically.
- Every other position is unchanged; no fixture or golden output changed.

## Rule as implemented

> If a `$` reference is the whole trimmed first argument of a case-insensitive `var(` call, a
> runtime token emits `runtimePropertyName(token.name, effectivePrefix)` (bare name, no `var()`);
> a build-time reference emits XESSA2001 and drops the declaration. All other `$` positions keep
> today's inline/`var(--…)` behaviour.

## Changed paths

| Path | Change |
|---|---|
| `packages/compiler/src/variables/expand.ts` | `RuntimeReferenceUsage`, `varFirstArgumentKeys` structural scanner (parens/quotes/comments, case-insensitive `var(`), `varNameError`, hook pass-through in `expandValue`. |
| `packages/compiler/src/variables/substitute.ts` | Hook renders bare name for `name` usage; group-default rejection unchanged and checked first. |
| `packages/compiler/src/variables/runtime.ts` | Hook registers the token and renders bare name for `name` usage. |
| `tests/compiler/substitute.test.ts` | Plain/namespaced/nested/fallback/spacing/`VAR(`/prefix variants/compile-time rejection/hand-written `var()` cases. |
| `tests/compiler/runtime.test.ts` | Standalone rewrite, runtime-value rewrite, group-default rejection, `@setup prefix` end-to-end. |
| `SPECIFICATION.md` §6.2 | Normative paragraph for the position and its rejection. |
| `docs/usage.md` §2.4 | Author-facing shorthand section and example. |
| `docs/decisions/ADR-0016-runtime-token-override.md` | Dated 2026-11-28 amendment. |

`docs/known-limitations.md` needed no change: nothing remains limited for this feature.

## Acceptance results

| Criterion | Result | Evidence |
|---|---|---|
| `@runtime primary` + prefix `ui`: `var($primary, #333)` → `var(--ui-primary, #333)` | PASS | substitute test + `@setup prefix` compileProject test asserting CSS |
| Namespaced `var($theme.primary, black)` → `var(--ui-primary, black)` | PASS | substitute test |
| Nested `var($a, var($b, red))` → `var(--ui-a, var(--ui-b, red))` | PASS | substitute test |
| Compile-time `var($pad)` / `var($pad, 4px)` → XESSA2001, omitted, authored text in message | PASS | looped substitute test asserting code, `"$pad"`, `var(--name)`, empty IR |
| `$token` outside `var()` and hand-written `var(--x, …)` unchanged | PASS | fallback-position, hand-written and existing tests |
| No fixture/golden changes; group-default message/code unchanged | PASS | `git status` shows no `tests/fixtures` changes; golden suite green; group test asserts existing message |
| Prefix via `effectivePrefix` (`@setup`, `classes.prefix`, namespaced, empty) | PASS | empty/`app` prefix, `naming.prefix` precedence, `@setup prefix` end-to-end |
| `var(` wildcard for families/merge unchanged | PASS | `property-families.test.ts` green; no changes to `property-families.ts`/`merge.ts` |

## Validation

| Command | Exit | Outcome |
|---|---|---|
| `bun test tests/compiler/substitute.test.ts tests/compiler/runtime.test.ts tests/compiler/property-families.test.ts tests/compiler/groups.expansion.test.ts` | 0 | 98 pass, 0 fail, 301 expectations |
| Same four plus `tests/compiler/variables.golden.test.ts` (golden evidence) | 0 | 115 pass, 0 fail, 380 expectations |
| `bunx tsc -p packages/compiler/tsconfig.json --noEmit` | 0 | clean |
| `bunx biome check` on the five changed TS files | 0 | clean (Markdown is ignored by Biome: 0 files processed) |

Golden/diff evidence: `tests/fixtures` is untouched in `git status`; the read-only golden suite passes
unchanged. `git diff --stat` for this task is limited to the paths above plus unrelated
`packages/vscode/**` worktree changes owned by another worker, which were left untouched.

## Blockers

None.

## Next action

Hand off to a fresh `verify` session with the diff and the acceptance criteria above; it runs the
full gate including Playwright.
