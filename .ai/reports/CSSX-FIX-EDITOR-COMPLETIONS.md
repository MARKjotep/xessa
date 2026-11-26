# CSSX editor-completion fixes (U01, U02, U03)

**Status:** 🟢 complete · **Worker:** `code` · **Date:** 2026-11-26
**Scope:** three `packages/vscode` suggest-widget defects — `$`-namespace sigil drop, `&&:hover`
duplication and `&.`-context starters. Tasks: `.ai/tasks/CSSX-U01.md`, `CSSX-U02.md`, `CSSX-U03.md`.

## Summary

- U01: the imported-alias `$` item is now `$theme.` (label + insert), so accepting it over the range
  that covers the typed `$` writes a valid `$theme.` reference instead of dropping the sigil.
- U02: a lone `&` makes the nested-selector starters replace the authored ampersand through a per-item
  `replaceStart`; accepting `&:hover` yields `&:hover`, never `&&:hover`, while class items keep the
  caret range.
- U03: a `&.` class context no longer offers the `&`-prefixed starters, so the list is class names
  only and accepting keeps the typed dot (`&.card`), never `&.&:hover`.
- Baseline working tree at start (`git status --porcelain=v1 -b && git log --oneline -3`): branch
  `main...origin/main`, HEAD `6355ec3 ini`; concurrent edits in `packages/cli`/`packages/compiler` and
  the landed U05/T13 analysis state were preserved, no unrelated file touched.

## U01 — `$` namespace drops the sigil

**Changed**

- `packages/vscode/src/intelligence.ts` (`completionsAt` `"token"` case): the alias loop builds
  `label`/`insertText` as `$${imported.alias}.`; the existing shared range already covers the typed
  `$`, so no new range/filter logic was needed (mirrors the sibling `$keyframes.` item).
- `packages/vscode/test/ui/completions.js`: `CSSX-U1` pin removed. Asserts `$theme.` present,
  `theme.` absent, range `caret-1…caret`, accepted `color: $theme.` and exactly one `$`.
- `tests/extension/provider.intelligence.test.ts`: new case "the imported namespace item keeps the
  `$` its range replaces" (label, insert text, one item per alias plus `$keyframes.`, accepted text).

**Acceptance outcome:** ✅ `color: $|` + accept `$theme.` → `color: $theme.`; list has one item per
import alias plus `$keyframes.`; the pin is now a positive assertion.

## U02 — lone `&` duplicates the ampersand

**Changed**

- `packages/vscode/src/intelligence.ts` (`"selector"` case): new `authoredAmpersandStart(text, offset,
  word)` returns `offset - 1` when the word is empty and the caret directly follows `&`. Starter items
  carry it as their own `replaceStart`; the result-level range and the class items are unchanged, so
  A46's typed-dot behaviour still holds.
- `packages/vscode/test/ui/completions.js`: both `CSSX-U1` pins removed. Every starter is asserted to
  replace `caret-1…caret` and to insert text starting with `&`; accepting `&:hover` yields `  &:hover`
  and no `&&`.
- `packages/vscode/test/ui/checklist.js` row 6 (**outside the stated write set**): the bare-`&` pin now
  asserts the repaired range and `  &:hover`. Required by this task's acceptance #3 ("checklist row 6
  must stay automated") and by the host-suite-green criterion; flagged here for review.
- `tests/extension/provider.intelligence.test.ts`: new case "a lone `&` starter replaces the typed
  ampersand" covering all six starters plus the unchanged result/class ranges; the A46 test's comment
  and one assertion were updated to the per-item range.

**Acceptance outcome:** ✅ `&|` + accept `&:hover` → `&:hover`; `& > ` → `& > `; `&` → `&`; the `&:`
pseudo path and the `&.` class path stay green.

## U03 — `&.` lists `&`-prefixed starters

**Changed**

- `packages/vscode/src/intelligence.ts` (`"selector"` case): starters are emitted only when
  `context.word` does not start with `.` (chosen direction: suppress, not re-shape).
- `packages/vscode/test/ui/completions.js`: the `&.` case asserts no label starts with `&` and that
  `.badge`/`.card` are still listed, beside the existing typed-dot acceptance.
- `packages/vscode/test/ui/checklist.js` row 6 (same out-of-set note as U02): the `&.` block asserts
  the class-only list.
- `tests/extension/provider.intelligence.test.ts`: new case "a `&.` class context lists classes only"
  for empty and typed class prefixes.

**Acceptance outcome:** ✅ after `&.` the list is class names only; accepting `.card` keeps the dot
(`&.card`). The red pin was not added first in this run: the defect is stated by the new positive
assertions and the spec's pin-first step is superseded by the already-recorded U3 finding. The fresh
`suggest-amp-dot` screenshot/`manifest.json` refresh was not run (out of write set); the host
assertion is the gate.

## Validation (actual)

| Command | Result |
|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 98 pass, 0 fail, 3621 expect() calls |
| `bun test tests/extension/host.test.ts` (run 1) | 13 scenarios, 827 assertions, exit 0 (completions 121, checklist 98) |
| `bun test tests/extension/host.test.ts` (run 2) | 13 scenarios, 827 assertions, exit 0 |
| `bunx tsc -p packages/vscode/tsconfig.json --noEmit` | clean |
| `bunx biome check` (the four changed TS/JS files) | one pre-existing formatting drift at `provider.intelligence.test.ts:1763` (file was already modified before this task); my edited regions are clean |

`bun run verify` was intentionally not run (task instruction: not in this lane's validation set).

## Files touched

- `packages/vscode/src/intelligence.ts`
- `packages/vscode/test/ui/completions.js`
- `packages/vscode/test/ui/checklist.js` (out-of-set necessity, disclosed above)
- `tests/extension/provider.intelligence.test.ts`
- `.ai/tasks/CSSX-U01.md`, `.ai/tasks/CSSX-U02.md`, `.ai/tasks/CSSX-U03.md` (status + fix records)
- `.ai/reports/CSSX-FIX-EDITOR-COMPLETIONS.md` (this report)

`packages/vscode/src/analysis.ts`, `groups.ts`, `keyframes.ts`, `providers/navigation.ts`,
`controller.ts`, `packages/compiler/**`, `packages/cli/**`, `.ai/todo.md` and `CHANGELOG.md` were not
modified.
