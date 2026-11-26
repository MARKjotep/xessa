# CSSX-TERMINOLOGY — variables vs runtime terminology note

## Summary

- Docs-only: added a terminology note at the `docs/usage.md` §2.3/§2.4 boundary and one README
  cross-reference. No grammar, compiler, editor or specification change; both block names are kept
  for 0.1.0, with alias/rename deferred to v0.2 on evidence.
- Provenance: owner question 2026-11-26 — the names read inverted against casual CSS vocabulary
  ("CSS variable" usually means `var(--x)`).

## Changes

- `docs/usage.md`: bold-led note before `### 2.4`, containing:
  - the table (block / resolved when / emitted as / referenced in Xessa as) for `@variables` and
    `@runtime`;
  - the paragraph that both are `$name` in source, so moving a declaration between blocks changes
    only the declaration site and the emitted CSS shape;
  - a 8-line `$primary` before/after snippet with both emitted shapes (`#2563eb` vs
    `:root { --ui-primary: … }` + `var(--ui-primary)`);
  - the ADR-0016 rationale line (compile-time default, runtime for theming/override);
  - the blunt naming sentence: read the block name, not the word "variable".
- `README.md`: one sentence appended to the `docs/usage.md` Documentation bullet pointing at the
  note. Nothing else restructured.
- `.ai/tasks/CSSX-TERMINOLOGY.md`, `.ai/reports/CSSX-TERMINOLOGY.md`: this record.

## Verification

- `bun run lint` → **exit 1**, one formatting error in
  `packages/vscode/test/ui/module-refresh.js` (`waitForClean(…)` argument wrapping), which is the
  in-flight stale-diagnostics change and outside this task's write set. Docs are not linted by Biome
  (`bunx biome check docs/usage.md README.md` → "No files were processed"), so this task adds no
  lint surface. Not fixed here: no out-of-scope writes.
- Both edited files keep their existing `docs/verification`-free prose; links resolve relative to
  `docs/` (`decisions/ADR-0016-runtime-token-override.md` exists).

## Handoff

PASS (docs); lint red on an unrelated file. Note sits between §2.3 and §2.4 in `docs/usage.md`. Rows:
`@variables` / at build time / inlined value (`padding: 12px`) / `$name` / `$ns.name`; `@runtime` /
at runtime / `:root { --prefix-name: … }` plus conditional overrides / `$name` / `$ns.name` (the
compiler writes `var(--prefix-name)`). README cross-reference: yes, one sentence in the Documentation
list. Lint: `bun run lint` exits 1 on `packages/vscode/test/ui/module-refresh.js` (in-flight
stale-diagnostics change, outside this write set); docs add no lint surface. Records: this report +
`.ai/tasks/CSSX-TERMINOLOGY.md`. Deferred: alias/rename to v0.2 on evidence.
