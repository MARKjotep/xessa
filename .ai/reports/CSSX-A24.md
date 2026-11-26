# CSSX-A24 — Report: formatter preserves `@use … styles`

## Summary

- `printUse` in `packages/compiler/src/formatter/index.ts` now re-emits the optional `styles` clause, so `@use "./motion.cssx" as m styles;` formats to itself instead of `@use "./motion.cssx" as m;`
- This removes a silent semantics downgrade (rule-merge → token-only, ADR-0014) that would have happened on every save under format-on-save — FRAMEWORK.md §7 invariant 2, CSSX-A22 "styles blocker".
- The pinned `test.failing` in `tests/extension/formatter.current-grammar.test.ts` is now a normal passing `test`; a second round-trip case covers the alias-less clause and a literal `styles` alias.
- Pure formatter bug fix enforcing already-specified semantics: no language change, therefore **no new ADR and no SPECIFICATION.md edit**. `bun run verify` is green (678 tests / 41 files, 0 fail).

## Status

🟢 Complete.

## Objective (restated)

Make `format()` preserve the `styles` clause of `@use "<path>" [as alias] [styles];` byte-exactly
through parse→print, with canonical spacing; flip the pinned failing test; do not touch
`tests/compiler/**` (CSSX-A20 scope).

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/formatter/index.ts` | `printUse` appends ` styles` when `item.styles === true` (3-line change + comment). |
| `tests/extension/formatter.current-grammar.test.ts` | `test.failing` → `test` (assertion kept, idempotency added); new `test` covering `@use "./base.cssx" styles;`, `@use "./tokens.cssx" as styles;` and plain `@use` (negative cases). |
| `.ai/tasks/CSSX-A24.md` | Task prompt. |
| `.ai/reports/CSSX-A24.md` | This report. |
| `.ai/reports/logs/CSSX-A24.log` | Worker log. |

No other files were created or modified. All other working-tree changes present in the repo belong
to the concurrent CSSX-A20 worker.

## The fix

```diff
   private printUse(item: UseImport, level: number): Chunk {
     const alias = item.alias === undefined ? "" : ` as ${item.alias}`;
-    return { lines: [`${pad(level)}@use "${item.path}"${alias};`], block: false };
+    // `styles` is semantic, not cosmetic: dropping it would downgrade a
+    // rule-merge import to a token-only one (ADR-0014, SPECIFICATION.md §6.3).
+    const styles = item.styles === true ? " styles" : "";
+    return { lines: [`${pad(level)}@use "${item.path}"${alias}${styles};`], block: false };
   }
```

The AST already carried the flag (`UseImport.styles?: boolean`, the one sanctioned frozen-contract
addition, ADR-0014); the parser (`parseUseImport`) and resolver were correct. Only the printer dropped
it, which is why this is an emitter/printing-side bug and not a semantics change: no ADR-0014 or
SPECIFICATION.md §6.3 text moved, no diagnostic added, no grammar altered.

## Before / after evidence

Measured by importing the pre-fix printer (HEAD copy of the file) and the fixed printer side by side
in one Bun process (`src/motion.cssx`):

| Source | Before (HEAD) | After |
|---|---|---|
| `@use "./motion.cssx" as m styles;` + rule | `@use "./motion.cssx" as m;` | `@use "./motion.cssx" as m styles;` |
| `@use "./m.cssx" styles;` + rule | `@use "./m.cssx";` | `@use "./m.cssx" styles;` |
| `@use "./tokens.cssx" as styles;` | unchanged (` as styles;`) | unchanged (` as styles;`) |
| `@use "./plain.cssx";` | unchanged | unchanged |

`format(format(x)) === format(x)` confirmed for every case.

The alias-named-`styles` case is the important negative control: `as styles` is an alias, not the
clause, and must not gain a second `styles`; `item.styles` is `undefined` there, so nothing is added.

## Test changes (no weakening)

- `known bug: @use … as x styles keeps the rule-merge flag` → `@use … as x styles keeps the
  rule-merge flag`, `test.failing` → `test`. The exact expected output is unchanged; an explicit
  idempotency assertion was added.
- New `test`: `alias-less @use … styles and a literal `styles` alias both round-trip` — three
  imports (bare clause, alias colliding with the keyword, no clause) with exact expected text plus
  idempotency. This is strictly additional coverage, not a relaxation.

## Existing formatter output changes

None. `tests/compiler/formatter.test.ts` passes unchanged; its only `@use` coverage is
`@use "./theme.cssx" as theme;` (token-only), which prints identically before and after. No fixture
under `tests/fixtures/**` is formatted (they are compile fixtures), so no golden output moves.

## Coverage gap noted for a later consolidated task

`tests/compiler/formatter.test.ts` has **no** `@use … styles` case (grep: only `as theme;` at lines
106/129), and `tests/compiler/**` is owned by CSSX-A20, so it was not edited. The round-trip coverage
for this clause currently lives only in `tests/extension/formatter.current-grammar.test.ts`. A future
consolidation should move/duplicate it into the compiler formatter suite, next to the canonical-layout
`@use` case.

## Blockers

None. No `tests/compiler/**` test failed because of this fix (nothing there encoded the bug; the
existing formatter suite has no `styles` case).

## Validation

| Command | Result |
|---|---|
| `bun test tests/extension tests/compiler/formatter.test.ts` | 🟢 102 pass / 0 fail, 715 expect, 11 files |
| `bun run verify` (typecheck + lint + full test) | 🟢 678 pass / 0 fail, 788495 expect, 41 files |

The full-suite count (678/41) exceeds FRAMEWORK.md §11's recorded 612/37 because the concurrent
CSSX-A20 worker's new tests are already in the tree; all of them pass, so there are no out-of-scope
failures to report.

Note: the task prompt allowed editing `tests/compiler/**` only to add coverage — that was not needed,
and the allowed read-only check confirms the compiler formatter suite is untouched and green.

## Handoff

Completed state: formatter preserves `styles`; extension round-trip tests pin both clause forms;
verify green.

Remaining for the lead:
- Optional: fold the `@use … styles` formatter case into `tests/compiler/formatter.test.ts` (A20 scope).
- `.ai/PROGRESS.md` is lead-owned and was not touched; flip the CSSX-A24 row there.
- Consider whether `docs/known-limitations.md`'s formatter note or `docs/grammar.md`'s stale
  "token-only" wording should be refreshed — `docs/**` is outside this task's scope.

Touched files: `packages/compiler/src/formatter/index.ts`,
`tests/extension/formatter.current-grammar.test.ts`, `.ai/tasks/CSSX-A24.md`,
`.ai/reports/CSSX-A24.md`, `.ai/reports/logs/CSSX-A24.log`.
