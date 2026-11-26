# CSSX-FIX-EDITOR-ANALYSIS — U05 and T13

**Date:** 2026-11-26 · **Worker:** `code` · **Status:** 🟢 PASS

## Summary

- **CSSX-U05 fixed.** `forEachDeclaration` now walks `@group.<name>` definition and use-site bodies, so
  `$token` references inside a group body reach `tokenAt` and therefore hover, definition, references
  and rename. Repro measured `0 → 1` hover, `0 → 1` definition, references `3 → 4`; diagnostics stay
  `[]`.
- **CSSX-T13 fixed.** The editor now resolves group/keyframe closures in sorted canonical-path order with
  one shared memo, exactly like `resolver/{groups,keyframes}.ts`. Seeded cyclic graphs (100 seeds,
  including seed 15) show zero editor/compiler visibility divergence; the differential's cyclic corpus
  now asserts set equality instead of termination only.
- Acyclic contract unchanged (26 fixture directories, 60 acyclic seeds), TT6 latency envelope unchanged,
  `tsc` clean, extension host suite green (13 scenarios / 802 assertions).

## Baseline (read-only, first command)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ...
?? .ai/tasks/CSSX-U05.md
?? .ai/tasks/CSSX-T13.md
?? tests/stress/
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Working tree already contained unrelated tracked/untracked changes (plans, reports, task specs, the
untracked `tests/stress/` tree). None were reverted or overwritten.

**Concurrent activity (outside this worker's write set):** while this task ran, another session modified
`packages/compiler/src/formatter/index.ts`, `packages/compiler/src/selectors/{flatten,index}.ts` and
`packages/cli/src/**`. Those files were only read here and are untouched by this work. The first `tsc`
run reported three pre-existing errors in `packages/compiler/src/selectors/flatten.ts`; the final run
after that external change was clean.

## CSSX-U05 — `$token` inside `@group` bodies

Changed:

| File | Change |
|---|---|
| `packages/vscode/src/analysis.ts` | `forEachDeclaration` handles `group-definition` / `group-use-site` (`item.declarations`, authored spans, no expansion) |
| `tests/extension/provider.intelligence.test.ts` | additive case: hover + definition for `$gap` in a definition body and `$radius` in a use-site body, `problems = []` |
| `tests/extension/provider.navigation.test.ts` | additive case: token rename yields 4 edits covering declaration, rule body, definition body and use-site body |

Evidence (same document as the spec repro, through the pure intelligence layer):

```
@variables { gap: 8px; radius: 3px; }
@group.card { padding: $gap; }                 hover 0 → 1, definition 0 → 1
.a { padding: $gap; ... }                      hover 1 (unchanged)
.a { @group.card { border-radius: $radius; }}  hover 0 → 1, definition 0 → 1
diagnostics                                    [] before and after
```

No O(n²) walk: the group body declarations are visited once, in the existing single pass, at their
authored offsets. No UI-host pin existed in `packages/vscode/test/ui/`, so no row was added or removed
there; acceptance criteria 1–2 are covered by the additive pure-provider cases instead.

## CSSX-T13 — cyclic group/keyframe visibility

Cause: both sides memoize partial closures, but the editor computed them lazily in *document-load*
order while the compiler iterates its source map in *sorted canonical-path* order. Inside a cycle the
first file to hit the back edge therefore memoized a different partial result on each side.

Changed:

| File | Change |
|---|---|
| `packages/vscode/src/groups.ts` | pre-compute every loaded module's closure in sorted order through the shared memo before any scope is read |
| `packages/vscode/src/keyframes.ts` | same |
| `tests/stress/editor/differential.test.ts` | cyclic corpus: set equality with a per-document compiler graph, 100 seeds, explicit seed-15 pin; termination/determinism/candidate-loaded assertions kept |

The compiler resolver was only read; it remains the single source of truth.

Evidence (seed 15, compiler graph built for the analysed document):

```
before: b.cssx compiler: card=resolved:/virtual/b.cssx
        b.cssx editor:   card=resolved:/virtual/b.cssx, panel=resolved:/virtual/c.cssx
after:  b.cssx editor:   card=resolved:/virtual/b.cssx
```

100-seed probe (groups strict, keyframes with the documented ADR-0015 ambiguous rule): 0 failures.
`docs/known-limitations.md` §5 makes no claim about cyclic editor/compiler agreement, so it needed no
change and was not edited (outside the task write set).

## Acceptance outcomes

| # | Criterion | Result |
|---|---|---|
| U05.2 | hover = 1 with value line, definition = 1, definition body + use-site body | 🟢 |
| U05.3 | rename edits the group-body occurrence; plain-rule cases unchanged | 🟢 (4 edits; existing token rename tests still pass) |
| U05.4 | no new diagnostic for the same document | 🟢 `problems = []` |
| U05.5 | extension suite green | 🟢 194 pass / 0 fail (host 13 scenarios, 802 assertions) — full `bun run verify` is owned by the integration worker |
| T13.1 | cyclic seeds agree (or documented refusal) | 🟢 set equality, 100/100 seeds |
| T13.2 | 26 fixtures + 60 acyclic seeds unchanged | 🟢 |
| T13.3 | differential asserts the decided rule; no assertion weakened elsewhere | 🟢 strengthened from termination to set equality |
| T13.4 | `docs/known-limitations.md` §5 matches shipped behaviour; suites green | 🟢 §5 already accurate; suites green |

## Validation commands and actual outcomes

```sh
bun test tests/extension/provider.intelligence.test.ts tests/extension/provider.navigation.test.ts
# 117 pass, 0 fail

bun test tests/extension/
# 194 pass, 0 fail; 4348 expect() calls
# host: 13 scenarios, 802 assertions

bun test tests/stress/editor/differential.test.ts
# 10 pass, 0 fail, 625 expect() calls

bun test tests/stress/editor/
# 50 pass, 0 fail, 177008 expect() calls
# TT6 envelope: analyzeText p95 35.7 ms (10k lines), hover p95 19.1 ms, definition p95 7.5 ms

bunx tsc -p packages/vscode/tsconfig.json --noEmit
# clean (0 errors)
```

`bun run verify` was deliberately not run: the full gate is owned by the integration worker.

## Handoff

- Completed: both defects fixed and pinned by tests; task specs updated with `## Fix record`.
- Not started (owned by a later worker): `providers/completion.ts`, `controller.ts`.
- Next action: integration worker runs the full gate (`bun run verify`) and the UI host rows if desired.
