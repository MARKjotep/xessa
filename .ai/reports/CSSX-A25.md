# CSSX-A25 — Report: close A21 example-count drift and A24 formatter coverage gap

## Summary

- Root `README.md` now lists all six examples (`basic`, `responsive`, `variables`, `jsx`,
  `custom-output`, `overrides`) in both places it mentioned five.
- `FRAMEWORK.md` §2 (`examples/` row), §8 (`release:check` row) and §11 (two new bullets) now describe
  the six-example tree; §6's `XESSA2001` row no longer calls same-name runtime definitions an error
  and cites ADR-0016, with the stale "first definition wins" recovery text corrected.
- `tests/compiler/formatter.test.ts` has a new round-trip case pinning `@use "./x.cssx" as m styles;`
  and `@use "./x.cssx" styles;` (plus the `as styles` alias negative control) — the coverage that
  previously lived only in the extension suite.
- `docs/release.md` already lists all six examples (verified read-only, no edit). `bun run verify`
  green: 679 tests / 41 files, 0 fail.

## Status

🟢 Complete.

## Objective (restated)

Consolidation only: fix out-of-scope documentation drift flagged by CSSX-A21 (five → six examples,
ADR-0016 runtime-override semantics) and add the compiler-suite `@use … styles` formatter case that
CSSX-A24 could not add while `tests/compiler/**` was owned by another task.

## Changed files

| File | Change |
|---|---|
| `README.md` | Repository-layout tree: `examples/` lists `overrides` (wrapped line). Documentation list: "five working examples" → "six working examples". |
| `.ai/framework/xessa/FRAMEWORK.md` | §2 `examples/` row → six examples incl. `overrides`; §6 second `XESSA2001` row → no runtime-conflict trigger, ADR-0016 merge-order note, recovery "later runtime definition wins"; §8 `release:check` row → 6 example builds; §11 → two new bullets (six examples incl. ADR-0016 showcase; formatter keeps `@use … styles`). |
| `tests/compiler/formatter.test.ts` | New `canonical layout` test for `@use … styles` round trip + idempotency. No fixture/golden change. |
| `.ai/tasks/CSSX-A25.md` | Task prompt (written before implementation). |
| `.ai/reports/CSSX-A25.md` | This report. |
| `.ai/reports/logs/CSSX-A25.log` | Worker log. |

Nothing else was written. The working tree already carried uncommitted changes from earlier tasks
(`.ai/PROGRESS.md`, `SPECIFICATION.md`, `docs/**`, `packages/**`, the §3/§5.5 ADR-0016 hunks in
FRAMEWORK.md and the `48 → 54` fixture-count assertion in the formatter test); those are preserved
untouched. `git diff` against HEAD therefore shows more than this task's hunks.

## Detail

### README

```
  examples/              basic, responsive, variables, jsx, custom-output, overrides
                         (built output committed)
...
- [examples/](examples/) — six working examples with committed output.
```

`examples/basic/xessa.config.json` references and the "complete, committed output is in
[`examples/basic/`]" sentence are unaffected — still accurate and examples are not in scope.

### FRAMEWORK.md

- §2: `` | `examples/` | `basic`, `responsive`, `variables`, `jsx`, `custom-output`, `overrides` —
  six worked examples, all built by `release:check`. | `` (the tree has six directories).
- §6: triggers reduced to `Undefined token/namespace/member, bare namespace, reference cycle,
  over-deep chain.` plus "Same-name runtime definitions are **not** an error: they resolve in merge
  order, entry last (ADR-0016)." Recovery changed from "(first runtime definition wins)" to "later
  runtime definition wins" — the old text contradicted ADR-0016 and §5.5, which already say the
  entry overrides imports. Other `XESSA2001` producer rows are untouched.
- §8: `+ 5 example builds` → `+ 6 example builds`; the CLI-surface block below the table contains no
  example count.
- §11: added the six-example bullet (`overrides` = ADR-0016 showcase, all built by `release:check`)
  and the formatter `@use … styles` bullet (CSSX-A24). No other §11 line changed.

Per the task's scope limit, the §8 `bun test` row and the §11 verify-count line still read
612 tests / 37 files; the suite is now 679 / 41. That drift is real but was explicitly out of scope
("if it mentions example counts", "touch nothing else"), so it is reported here for the lead rather
than edited. README's "573 tests across 35 files" sentence is likewise untouched (not an example
mention).

### tests/compiler/formatter.test.ts

```ts
test("@use … styles keeps the rule-merge clause (and a literal `styles` alias stays an alias)", () => {
```

Input: three imports (`as m styles`, bare `styles`, `as styles`) plus one rule. Asserts
`diagnostics === []`, the exact canonical text (blank line between imports, as the extension suite
pins), and `format(format(x)) === format(x)`. Assertions mirror `tests/extension/formatter.current-grammar.test.ts`
tests 2–3, including the negative control that `as styles` is an alias and gains no second clause.
No existing assertion was changed or removed; the pre-existing `48 → 54` fixture-count expectation
is unrelated to this case and was left as found.

Would it have failed before CSSX-A24? Yes. Verified read-only via
`git show HEAD:packages/compiler/src/formatter/index.ts`:

```ts
private printUse(item: UseImport, level: number): Chunk {
  const alias = item.alias === undefined ? "" : ` as ${item.alias}`;
  return { lines: [`${pad(level)}@use "${item.path}"${alias};`], block: false };
}
```

That printer cannot emit `" styles"`, so the new expected string fails against it. The case is a
regression pin, not a coverage placeholder.

### docs/release.md check

Read-only verification: step 6 already reads "Build all six examples … (`basic`, `responsive`,
`variables`, `jsx`, `custom-output`, `overrides`)" (A21's edit). No change made, as instructed.

## Validation

| Command | Result |
|---|---|
| `bun test tests/compiler/formatter.test.ts` | 🟢 8 pass / 0 fail, 90 expect calls |
| `bun run verify` (typecheck + lint + full test) | 🟢 679 pass / 0 fail, 788498 expect calls, 41 files |

Typecheck (4 projects) and Biome both passed inside `verify`; no gate was weakened. `release:check`
was not run (not requested; it builds all six examples and packages the VSIX, which would write
outside this task's scope). Browser tests were not run — no CSS output or cascade behavior changed.

## Blockers

None.

## Handoff

Completed state: README/FRAMEWORK example counts and XESSA2001/ADR-0016 wording are consistent with
the tree and code; compiler formatter suite pins both `styles` import forms.

Remaining for the lead (all outside this task's write scope):
- `.ai/PROGRESS.md` is lead-owned: flip the CSSX-A25 row.
- FRAMEWORK §8 `bun test` row and §11 verify line (612/37) and README's gate paragraph (573/35) are
  stale versus 679/41; needs a dedicated count-refresh task.
- FRAMEWORK §10 still marks `docs/grammar.md` as stale on `@use styles`; `docs/compatibility.md`
  likewise (already noted in §11's drift bullet).

Touched files: `README.md`, `.ai/framework/xessa/FRAMEWORK.md`, `tests/compiler/formatter.test.ts`,
`.ai/tasks/CSSX-A25.md`, `.ai/reports/CSSX-A25.md`, `.ai/reports/logs/CSSX-A25.log`.
