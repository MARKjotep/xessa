# CSSX-A28 — Report: residual §2 text accuracy (`entry.cssx` goldens note, `tests/compiler/` suite list)

## Summary

- Observed **13** `entry.cssx` fixtures: **7** in `modules/merge/`, **3** in `keyframes/`
  (`duplicate-name`, `style-import`, `token-only`), **3** in `runtime/` (`override-entry`,
  `override-modules`, `override-variants`).
- Observed **25** `tests/compiler/*.test.ts` suites; the stale parenthetical named only 16 and
  omitted `compile`, `emitter`, `golden`, `keyframes`, `lexer.fixtures`, `lexer.invariants`,
  `mapgen`, `resolver`, `variables.golden`.
- Fixed exactly those two fragments in `.ai/framework/xessa/FRAMEWORK.md` §2; every other character
  in §2 (including A27's `54 input.cssx in 13 groups` / `25 files` counts) is unchanged.
- `bun run verify` green: typecheck (4 projects) + Biome clean (384 files) + **679 pass, 0 fail,
  679 tests across 41 files**.

## Status

🟢 Complete.

## Observed data (commands)

```sh
find tests/fixtures -name "entry.cssx" | sort   # 13 paths
find tests/fixtures -name "entry.cssx" | wc -l  # 13
ls tests/compiler/*.test.ts | sed 's|.*/||'     # 25 names
```

| Location | `entry.cssx` count |
|---|---|
| `tests/fixtures/modules/merge/` | 7 (`basic`, `chain`, `collision`, `cycle`, `module-flag`, `prefix-independence`, `tokens-plus-rules`) |
| `tests/fixtures/keyframes/` | 3 (`duplicate-name`, `style-import`, `token-only`) |
| `tests/fixtures/runtime/` | 3 (`override-entry`, `override-modules`, `override-variants`) |
| **Total** | **13** |

Suite files (25): `compile`, `contract`, `emitter`, `formatter`, `golden`, `keyframes`, `lexer`,
`lexer.fixtures`, `lexer.invariants`, `lowering`, `mapgen`, `media`, `merge`, `modules`, `naming`,
`output`, `parser`, `pipeline`, `planner`, `resolver`, `runtime`, `selectors`, `sourcemap`,
`substitute`, `variables.golden`.

Cross-check: `tests/compiler/` holds 25 `*.test.ts` files, matching A27's `25 files` count, so the
count string needed no change; only the enumeration was stale.

## Changed fragments (§2 repo map)

Before:

```text
| `tests/fixtures/` | 54 `input.cssx` goldens in 13 groups + `cli/` project fixtures + `modules/merge/` 7 goldens using `entry.cssx`. |
| `tests/compiler/` | 25 files: unit + golden suite (lexer, parser, lowering, media, modules, merge, naming, output, planner, runtime, selectors, sourcemap, substitute, formatter, pipeline, contract). |
```

After:

```text
| `tests/fixtures/` | 54 `input.cssx` goldens in 13 groups + `cli/` project fixtures + 13 `entry.cssx` goldens (7 `modules/merge/`, 3 `keyframes/`, 3 `runtime/`). |
| `tests/compiler/` | 25 files: unit + golden suite (`compile`, `contract`, `emitter`, `formatter`, `golden`, `keyframes`, `lexer`, `lexer.fixtures`, `lexer.invariants`, `lowering`, `mapgen`, `media`, `merge`, `modules`, `naming`, `output`, `parser`, `pipeline`, `planner`, `resolver`, `runtime`, `selectors`, `sourcemap`, `substitute`, `variables.golden`). |
```

## Changed files

| File | Change |
|---|---|
| `.ai/framework/xessa/FRAMEWORK.md` | §2 line 56: trailing `entry.cssx` note replaced with observed total and locations. §2 line 57: parenthetical replaced with the 25 actual suite names. Nothing else. |
| `.ai/tasks/CSSX-A28.md` | New task prompt. |
| `.ai/reports/CSSX-A28.md` | This report. |
| `.ai/reports/logs/CSSX-A28.log` | Worker log + full `bun run verify` transcript. |

No tests, fixtures, goldens, sources, configs, `README.md`, `PROGRESS.md`, todo or plan files were
touched. Framework dependencies and upstream repositories untouched. No commit or push.

## Validation evidence

```text
$ bun run verify
$ tsc -p packages/compiler/... && -p cli && -p language-service && -p vscode
Checked 384 files in 190ms. No fixes applied.
 679 pass
 0 fail
Ran 679 tests across 41 files. [14.47s]
```

Exit status 0. Full transcript in `.ai/reports/logs/CSSX-A28.log`.

## Blockers

None.

## Handoff

- §2 repo map is now text-accurate against the observed tree for both flagged fragments; the
  `tests/fixtures/README.md` and §3 reference to `entry.cssx` already agree (`... or entry.cssx for
  merged builds`), so no cross-file drift remains for this topic.
- Remaining known drift outside this task's scope (not touched): other `.ai`/docs strings quoting
  suite/test totals if any change again after future work; `§8`/`§11` `679 tests / 41 files` remain
  correct as verified.
