# CSSX-FIX-NESTING — bounded `&`-nesting expansion (CSSX-T04)

## Summary

- Deep `& &` nesting no longer grows without bound: per-rule flattened selectors are capped at
  **8 388 608 characters / 100 000 alternatives**, enforced at every expansion step.
- Over-budget rules fail fast with **one typed XESSA1001** naming the nesting depth and offending
  selector, with an in-bounds span; the rule is dropped and compilation continues.
- Legal nesting is unchanged: 12-level `& &` and the committed 1 000-deep `&.m<n>` + 500-item list
  (2.45 MB / 500 alternatives) still flatten exactly as today. No fixture/golden changes.
- 1 000-level `& &`: **≈2.2 s** and one diagnostic (was > 180 s, killed).

**Baseline (read-only, at task start):** `## main...origin/main`; HEAD `6355ec3 ini`. Tree already
had unrelated modified/untracked files from sibling workers; none were touched.

## Changed files

| Path | Change |
|---|---|
| `packages/compiler/src/selectors/flatten.ts` | `FLATTEN_LIMITS` + incremental budget checks in `substitute`, `descend`, `flattenAgainstParent`, `resolveAncestors`, `flattenSelector`; `descend` now returns `ItemResult`; docs updated. |
| `packages/compiler/src/selectors/index.ts` | Re-export `FLATTEN_LIMITS`. |
| `tests/compiler/nesting-bound.test.ts` | **New** — 6 cases: 12-level unchanged; 1 000-level fast typed failure + valid span; selector-count overflow (400² = 160 000); exact char boundary passes; one char over fails; large legal nesting unchanged. |
| `.ai/tasks/CSSX-T04.md` | Status 🟢 fixed + `## Fix record`. |

## Evidence / diagnostics

- 1 000-level probe (`.a { & & { … } }`, 12 013-char source): 2 239 ms; 1 diagnostic
  `XESSA1001 "Cannot flatten selector \"& &\": selector expansion exceeded the flattening limit … at
  nesting depth 1000 …"`; span `8001..8011` (valid, inside source); CSS empty.
- 12-level probe: 0 diagnostics, CSS emitted (6 162 B for the probe shape).
- Selector-count probe (`400`-item list squared by `& &`): rejected in ~3 ms with the
  `100000 selectors` reason, never expanded.
- Char boundary (direct `flattenSelector`): exactly 8 388 608 chars accepted; 8 388 609 rejected.

## Diagnostic code note

Reused the registered **XESSA1001** (syntax family, already the code for flatten rejections) rather
than registering a new subcode. `tests/compiler/contract.test.ts:71` asserts the exact
`DIAGNOSTIC_CODES` key set and is outside this task's write set, so adding `XESSA1004` would break an
existing green test. Recommended integration follow-up: register `XESSA1004` ("selector expansion
limit"), extend the contract test's expected keys, and emit it only for limit failures — the reason
string is already distinct, so the wiring is a one-line branch in `diagnosticFor`.

## Acceptance outcomes

| Criterion | Outcome |
|---|---|
| 12-level `& &` completes under the bound / typed failure for 1 000 | 🟢 12-level compiles unchanged; 1 000-level fails in ≈2.2 s with one typed diagnostic |
| Bound documented with growth table + cap | 🟡 code JSDoc + this report done; `SPECIFICATION.md`/`docs/known-limitations.md` pending (forbidden write set — text below) |
| Legal 1 000-deep `&.m<n>` / 500-list unchanged; no fixture output changes | 🟢 2.45 MB / 500 alternatives flatten; `tests/compiler` 655/655 pass |
| Targeted suites green | 🟢 (see below) |

## Validation (actual)

| Command | Result |
|---|---|
| `bun test tests/compiler/nesting-bound.test.ts tests/compiler/selectors.test.ts tests/compiler/groups.expansion.test.ts` | **54 pass / 0 fail** (3.49 s) |
| `bun test tests/stress/scale/selectors.test.ts tests/stress/fuzz/compile.test.ts` | **12 pass / 0 fail** (2 619 expects, 3.00 s) |
| `tsc -p packages/compiler/tsconfig.json --noEmit` | **exit 0** |
| `bun test tests/compiler` (extra) | **655 pass / 0 fail** (30 files) |
| `bunx biome check` on three touched files | clean |

Not run: full `bun run verify` (owned by the integration worker).

## Doc lines for the integration worker

`SPECIFICATION.md` §7.1 (suggested):

> Flattening is bounded per rule: a flattened selector list may not exceed 8 388 608 characters or
> 100 000 alternatives. Exceeding either limit rejects that rule with XESSA1001 (naming the nesting
> depth) and continues with the rest of the file.

`docs/known-limitations.md` §4 (suggested):

> **Selector expansion bound.** Repeated `&` duplicates the flattened product; 4/6/8/10/12 nested
> `& &` levels measure 66/210/786/3 090/12 306 B. Flattening is capped at 8 MiB / 100 000 selectors
> per rule (XESSA1001), so a 1 000-level `& &` chain fails in seconds instead of hanging.

## Blockers

None. No files outside the allowed write set were modified; no commits, dependency or Git-state
changes.
