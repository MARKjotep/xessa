# CSSX-A37 — G4b: `@group` cross-browser computed-style gate

## Summary

- Phase **G4b** of `.ai/plans/CSSX-PLAN-GROUPS.md` is implemented: one `groups` browser scenario
  (plus the base-only `chip` group used twice) and `tests/browser/specs/groups.pw.ts` assert D1–D5
  with real computed styles at 320/767/768/1279/1280 in **Chromium, Firefox and WebKit**.
- The two "by design, do not fix" cases are pinned: **D2** (a use-site base `padding: 20px` beats
  the group's `12px @md 24px` default at *all* widths, while the un-overridden `.tile` still
  switches at 768) and **D4** (a group `display: flex !important` is not beaten by a plain
  `display: block`). D3 pins non-overridden group values under `@dark`/reduced motion; D5 pins
  pretty/minify and safe/`none` grouping equality for the expanded rules, including a merged
  two-use-site `.badge` rule.
- The scenario is part of `SCENARIOS`, so the existing `parity.pw.ts` and `grouping.pw.ts` specs
  automatically cover it at every viewport and both color schemes — D5 is therefore both explicitly
  named in the new spec and enforced by the broad parity suites.
- `bun run test:browser` is **96 passed** (32 per engine; 1.7m final rerun) and `bun run verify` is
  **798 pass / 0 fail across 45 files**. No compiler, fixture, docs, example or board file changed;
  the plan's G4b task row and aggregate G4 row are now 🟢.

## Objective (as executed)

1. Read `AGENTS.md`, the plan (§7 G4b, §8 D1–D5, §9), ADR-0017 item 3, G4a's report/fixtures and the
   whole existing browser harness.
2. Add a group scenario to `tests/browser/harness/scenarios.ts` compiled by the existing
   `build.ts`/`global-setup.ts` path (pretty, minified, `mediaGrouping: "none"`).
3. Author `tests/browser/specs/groups.pw.ts` in the established `support.ts` style: `data-testid`
   locators, `readComputed`/`readStyle`/`readScenario`, auto-waiting, no fixed sleeps.
4. Prove the expected cascade by compiling the candidate source with the public `compile()` API and
   reading the emitted order before asserting it.
5. Run the new spec per engine, then the full three-engine gate and `bun run verify`; write the
   records and update only the plan's G4b + G4 rows.

## Changed files

| File | Change |
|---|---|
| `tests/browser/harness/scenarios.ts` | **New `groups` scenario** appended after `nesting`: groups `chrome` (base defaults, inline `@md`, `@dark` and `@reduced` variants, `display: flex !important`) and base-only `chip`; use sites `.panel`/`.tile` with different overrides and two merged `.badge` use sites. `testIds: panel, tile, badge`; `compareProperties` = `BASE_COMPARE_PROPERTIES` + `border-radius`. |
| `tests/browser/specs/groups.pw.ts` | **New (5 tests).** D1–D5 computed-style assertions; the shared `page` fixture keeps console errors/page errors/failed requests/HTTP ≥400 as failures. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | §6 **G4b** row now carries 🟢 with A37 evidence; the **aggregate G4** row is 🟢 (G4a/G4b/G4c all complete). No other row touched. |
| `.ai/tasks/CSSX-A37.md`, `.ai/reports/CSSX-A37.md`, `.ai/reports/logs/CSSX-A37.log` | **New.** |

`git status --porcelain tests/browser .ai/plans/CSSX-PLAN-GROUPS.md` → `M scenarios.ts`,
`?? specs/groups.pw.ts`, `M .ai/plans/CSSX-PLAN-GROUPS.md` only (plus these records).

## Scenario and expectations (all derived from ADR-0017 item 3)

The `groups` source (virtual path `tests/browser/scenarios/groups.cssx`):

```xessa
@group.chrome {
  padding: 12px @md 24px;
  border-radius: 8px;
  color: black;
  background: white @dark #181818;
  display: flex !important;
  transition-duration: 120ms @reduced 0s;
}

@group.chip {
  padding: 6px;
  border-radius: 4px;
  color: black;
}

.panel {
  @group.chrome {
    padding: 20px;
    border-radius: 0;
    color: navy;
    display: block;
  }
}

.tile {
  @group.chrome {
    color: rgb(1, 2, 3);
  }
}

.badge {
  @group.chip { margin-top: 2px; }
}

.badge {
  @group.chip { border-radius: 0; }
}
```

Compiled `.panel` order (verified with the public `compile()` API before writing assertions):
`padding: 12px`; `@media (min-width: 768px){padding: 24px}`; the remaining group defaults (incl.
`display: flex !important`); the `@dark` and `@reduced` blocks; then the use-site overrides
(`padding: 20px; border-radius: 0; color: navy; display: block`) last. Safe grouping merges the two
`.badge` runs into one rule; `mediaGrouping: "none"` keeps two rules with the same computed values.

| Test | Pinned contract | Expected values |
|---|---|---|
| **D1** | use-site override wins at every pinned breakpoint for width-independent properties; each use site gets its own override | `.panel` `color` = `rgb(0, 0, 128)`, `border-radius` = `0px`; `.tile` `color` = `rgb(1, 2, 3)` — at 320/767/768/1279/1280 |
| **D2** | group `@md` default + later use-site base declaration → **base wins at every width** (§5.2 by design) | `.panel` `padding-top` = `20px` at all five widths; `.tile` (no override) = `12px` at 320/767 and `24px` at 768/1279/1280, proving the default variant itself still works |
| **D3** | non-overridden properties keep the group value with `@dark` and reduced motion | `.panel` `background-color` = `rgb(255,255,255)` light / `rgb(24,24,24)` dark; `color` stays `rgb(0,0,128)`; `padding-top` `20px`; `transition-duration` = `0.12s` (no-preference) / `0s` (reduce) |
| **D4** | group `!important` default not overridden by a plain use-site declaration | `.panel` and `.tile` compute `display: flex` at all five widths |
| **D5** | pretty vs minified and safe vs `none` grouping compute identically for expanded rules | `readScenario` deep-equal across the three page variants at 320/1280 × light/dark; merged `.badge` = `padding-top 6px`, `border-radius 0px`, `color rgb(0,0,0)`, `margin-top 2px` |

`readScenario` compares `BASE_COMPARE_PROPERTIES` + `border-radius` for all three test ids; the
generic `parity.pw.ts`/`grouping.pw.ts` tests add the same scenario automatically (see evidence).

## Per-engine results

| Engine | D1 | D2 | D3 | D4 | D5 | Full gate |
|---|---|---|---|---|---|---|
| Chromium 1255 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 32/32 |
| Firefox 1572 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 32/32 |
| WebKit 2388 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 32/32 |

`bun run test:browser` → **96 passed (1.7m final rerun; 2.0m on the first full pass)**, including
`parity › groups: pretty and minified pages are computed-style equal` and
`grouping › groups: safe grouping preserves computed styles` in every engine. No engine disagreed
with the goldens; no compiler defect was found.

## Evidence (output tail)

```text
$ bunx playwright test --project=chromium tests/browser/specs/groups.pw.ts
  ✓ 1 [chromium] › group cascade › D1: the use-site override wins at every pinned breakpoint (586ms)
  ✓ 2 [chromium] › group cascade › D2: a use-site base declaration beats an @md variant default at all widths (438ms)
  ✓ 3 [chromium] › group cascade › D3: non-overridden properties keep the group value under @dark and reduced motion (471ms)
  ✓ 4 [chromium] › group cascade › D4: an !important group default is not overridden by a plain declaration (335ms)
  ✓ 5 [chromium] › group cascade › D5: pretty, minified and ungrouped pages compute identically for expanded rules (915ms)
  5 passed (4.1s)

$ bunx playwright test --project=firefox --project=webkit tests/browser/specs/groups.pw.ts
  ✓ 46 [firefox] D1–D5 all passed
  ✓ 78 [webkit] D1–D5 all passed
  10 passed (17.1s)

$ bun run test:browser
  ✓ 29 [chromium] › parity › groups: pretty and minified pages are computed-style equal (1.1s)
  ✓ 45 [firefox] › grouping › groups: safe grouping preserves computed styles (3.2s)
  ✓ 61 [firefox] › parity › groups: pretty and minified pages are computed-style equal (2.7s)
  ✓ 77 [webkit] › grouping › groups: safe grouping preserves computed styles (1.7s)
  ✓ 93 [webkit] › parity › groups: pretty and minified pages are computed-style equal (1.6s)
  96 passed (2.0m)

# Final rerun after D1 also asserted the `.tile` use-site override:
$ bun run test:browser
  ✓ 93 [webkit] › parity › groups: pretty and minified pages are computed-style equal (1.5s)
  96 passed (1.7m)

$ bun run verify
Checked 414 files in 189ms. No fixes applied.
 798 pass
 0 fail
 789269 expect() calls
Ran 798 tests across 45 files. [13.58s]
# Final rerun after the last spec edit: 798 pass / 0 fail, 45 files [12.94s], biome clean.
```

Harness build line for the new scenario: `groups: 1078B pretty, 841B minified, 1090B ungrouped`;
class maps are identical across pretty/minified/`none` (the build fails otherwise).

## Findings, deviations and open items

1. **Diagnosed during authoring, not a compiler bug: the first `.badge` override was not observable
   in the final computed style.** Two `.badge` rules share one selector, so the second expansion's
   `color: black` default is later in source order and correctly beats the first use site's
   `color` override (the same emergent-cascade rule D2 pins). The expectation was wrong, not the
   output. The first `.badge` use site now declares `margin-top: 2px` (which the second expansion
   does not re-declare), so both independent expansions stay observable in the merged rule. No
   assertion was relaxed and no expected value was "fixed" to pass.
2. **Plan-row interpretation.** The Implementation Progress table aggregates G4a–c under one **G4**
   row and has no separate G4b row; §6 holds the G4b task row. Both were updated as instructed: §6
   **G4b** → 🟢 with A37 evidence, Implementation Progress **G4** → 🟢. No other row changed.
3. **`tests/browser/README.md` is now stale.** Its Coverage table lists the eight pre-existing
   scenarios and does not mention `groups`. The file is outside G4b's owned scope
   (`tests/browser/harness/**`, `tests/browser/specs/**`), so it was not edited; flagged for the lead
   as a one-row doc follow-up.
4. **No framework (Rossa/Yvee/Shweet) record was created.** This is Xessa browser-test authoring; no
   framework defect or feature request exists, so no framework version applies.
5. **The G4a watch-test fs timeout did not recur** (`tests/integration/cli-watch.test.ts` passed in
   the full `bun run verify` run).

## Acceptance mapping (plan §7 G4b)

- **D1–D5 pass in Chromium/Firefox/WebKit** → 5 tests × 3 engines green; table above.
- **Pretty vs minify and safe vs `none` produce identical computed styles for an expanded rule** →
  D5 plus the auto-covered `parity.pw.ts`/`grouping.pw.ts` scenarios in all three engines.
- **No new console errors or failed requests** → the shared `page` fixture fails teardown on
  `console.error`, `pageerror`, `requestfailed` or HTTP ≥400; every test opens pages through it.
- **`bun run verify` green** → 798 pass / 0 fail / 45 files, biome clean, typecheck clean.
- **Report records per-engine results, scenario files and evidence** → above.

## Handoff

- **Completed state:** G4b is done; G4 aggregate is 🟢 (G4a A34, G4b A37, G4c A35). The group
  override semantics are now pinned by byte-exact goldens (compiler level) and real-engine computed
  styles (browser level), including the two no-fix cases D2/D4.
- **Validation:** `bun run test:browser` 96/96 and `bun run verify` 798/45; evidence in the log file.
- **Remaining steps (outside this scope):** add the `groups` row to `tests/browser/README.md`'s
  Coverage table; G6 (editor support) remains the only open phase of this plan.
- **Touched files:** the table in **Changed files**.
- Cross-links: `docs/decisions/ADR-0017-reusable-declaration-groups.md`,
  `.ai/plans/CSSX-PLAN-GROUPS.md` §7–§9, `.ai/reports/CSSX-A34.md` (G4a fixtures),
  `.ai/reports/logs/CSSX-A37.log`, `.ai/tasks/CSSX-A37.md`.
