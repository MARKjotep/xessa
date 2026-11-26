# CSSX-A21 — `examples/overrides` token-strategy showcase

## Summary

- Added `examples/overrides/`, a sixth worked example demonstrating ADR-0015/0016 token strategies:
  real `--ui-*` runtime custom properties, two style-imported theme modules declaring the same
  `primary`, an entry `@runtime` override that wins over both, documented module-order resolution,
  compile-time local shadowing, namespace disambiguation and an imported keyframe reference.
- The example builds with **zero diagnostics** through the existing CLI and commits deterministic
  `generated/` CSS/JS/`.d.ts` plus `.cssx-manifest.json`, matching the other examples.
- Wired the example into `release:check` and updated the `docs/release.md` example list; refreshed
  the ADR-0016 rows in `FRAMEWORK.md` and flipped todo items 4/5.
- Validation: example build clean; `bun run verify` green (678 pass / 0 fail, 41 files; typecheck
  and Biome clean). No out-of-scope failures observed.

## Objective status

| Item | Status |
|---|---|
| Task prompt before implementation | 🟢 `.ai/tasks/CSSX-A21.md` |
| `examples/overrides` source + README | 🟢 |
| Built output committed in example | 🟢 `generated/` + `.cssx-manifest.json` |
| Release wiring + docs example list | 🟢 `package.json`, `docs/release.md` |
| FRAMEWORK §3 step 6 / §5.5 rows, §11 note | 🟢 (only the permitted rows) |
| Todo items 4/5 flipped after verification | 🟢 |
| `bun run verify` | 🟢 |

## Changed files

| File | Change |
|---|---|
| `examples/overrides/xessa.config.json` | **New.** Entries `src/**/*.cssx`; modules excluded; `classes.prefix: "ui"`; strict + safe grouping. |
| `examples/overrides/src/entry.cssx` | **New.** Both style imports, unqualified + aliased `tokens.cssx`, local `@variables`, entry `@runtime primary`, one rule per strategy. |
| `examples/overrides/src/theme-base.cssx` | **New.** Runtime `primary`/`surface`/`on-surface` + `@keyframes fade`. |
| `examples/overrides/src/theme-alt.cssx` | **New.** Clashing runtime `primary` (#dc2626), imported later. |
| `examples/overrides/src/tokens.cssx` | **New.** Compile-time `radius: 4px`, `primary: #1d4ed8`, `gap: 8px`. |
| `examples/overrides/README.md` | **New.** Structure, build command, strategy-by-strategy explanation. |
| `examples/overrides/generated/styles/app.css` | **New.** Built output (52 lines). |
| `examples/overrides/generated/maps/app.map.js` | **New.** Class map. |
| `examples/overrides/generated/maps/app.map.d.ts` | **New.** Literal declarations. |
| `examples/overrides/.cssx-manifest.json` | **New.** Manifest for clean/rebuild. |
| `package.json` | `release:check` now builds `examples/overrides` after `custom-output` (one appended command only). |
| `docs/release.md` | Step 6 says six examples and lists them. |
| `.ai/framework/xessa/FRAMEWORK.md` | §3 step 6 and §5.5 runtime-token row now describe ADR-0016 merge order; §11 notes ADR-0015/0016 landed 2026-11-25. No other rows touched. |
| `.ai/todo.md` | Item 4 → 🟢 CSSX-A20; item 5 → 🟢 CSSX-A21. Nothing else. |
| `.ai/tasks/CSSX-A21.md`, `.ai/reports/CSSX-A21.md`, `.ai/reports/logs/CSSX-A21.log` | Task/report/log. |

No compiler, parser, resolver, CLI, test or other docs source changed. No framework bug/feature
record applies (this is Xessa work, not a third-party dependency defect).

## Built-output evidence

Command (the same one `release:check` runs):

```sh
bun packages/cli/src/index.ts build --config examples/overrides/xessa.config.json --json
```

```json
{ "success": true, "exitCode": 0,
  "entries": [{ "file": "src/entry.cssx",
                "dependencies": ["src/theme-alt.cssx", "src/theme-base.cssx", "src/tokens.cssx"],
                "diagnostics": [] }],
  "diagnostics": [], "warnings": [], "errors": [] }
```

`generated/styles/app.css` (excerpt; full file is 52 lines):

```css
:root {
  --ui-primary: #0f766e;      /* entry @runtime wins over theme-base and theme-alt */
  --ui-surface: #ffffff;      /* from theme-base */
  --ui-on-surface: #0f172a;   /* from theme-base */
}

@media (prefers-color-scheme: dark) {
  :root {
    --ui-primary: #2dd4bf;    /* entry's @dark variant wins wholesale (ADR-0016) */
    --ui-surface: #0f172a;
    --ui-on-surface: #e2e8f0;
  }
}

@keyframes fade {             /* imported theme-base.cssx, emitted because of `styles` */
  from { opacity: 0; }
  to { opacity: 1; }
}

.ui-base-card {
  color: var(--ui-on-surface);
  background: var(--ui-surface);
}

.ui-alt-card {
  color: var(--ui-primary);
}

.ui-local-override {          /* local radius/gap beat imported 4px/8px */
  border-radius: 12px;
  gap: 20px;
}

.ui-namespace-disambiguation { /* alias reaches the shadowed imported values */
  outline-offset: 4px;         /* $tokens.radius */
  border-color: #1d4ed8;       /* $tokens.primary (compile-time) */
  background: var(--ui-surface); /* $base.surface (runtime) */
}

.ui-runtime-override {
  color: var(--ui-primary);    /* $primary → var(--ui-primary) */
  background: var(--ui-surface);
}

.ui-imported-keyframes {
  animation-name: fade;        /* $keyframes.fade */
  animation-duration: 240ms;
}
```

Strategy coverage:

- **Entry-wins runtime override:** `--ui-primary` is the entry's `#0f766e`, not `#2563eb` or
  `#dc2626`; the entry's `@dark` value wins the dark group as a whole.
- **Module-order resolution:** `theme-alt.cssx` is imported after `theme-base.cssx`; the source
  comment and README state it would be the module winner if the entry did not define `primary`
  (ADR-0016 entry-last rule). No conflict diagnostic.
- **Compile-time local override:** `.ui-local-override` emits `12px`/`20px`, shadowing the
  unqualified `tokens.cssx` values.
- **Namespace disambiguation:** `tokens.cssx` is imported unqualified **and** as `tokens` (the graph
  loads it once and it has no rules); `$tokens.radius`/`$tokens.primary` emit `4px`/`#1d4ed8` while
  `$radius`/`$primary` resolve locally.
- **Imported keyframe:** `@keyframes fade` from `theme-base.cssx` is emitted and
  `animation-name: fade` resolves from `$keyframes.fade`.
- **Prefixed classes:** all six entry/module classes are `ui-*`.

## Wiring and docs notes

- **Config key deviation:** the task wording said `naming.prefix: "ui"`; the CLI schema has no
  `naming` section. `packages/cli/src/config.ts` (`CLASSES_KEYS`) and `docs/configuration.md` define
  `classes: { strategy, prefix }`, and `compiler.strict: true` rejects unknown keys. The example uses
  `"classes": { "strategy": "prefix", "prefix": "ui" }`, which is what makes entry classes `ui-*`
  and runtime names `--ui-*`. This is a schema fact, not a UI decision.
- `release:check` was **not** run end-to-end (browser + VS Code packaging are outside this task's
  validation); its example command was run directly and passed.
- Still stale but out of this task's write scope: `README.md` lines ~201/224 ("five examples"),
  `FRAMEWORK.md` §2 repo-map list and §8 "5 example builds", and the §6 `XESSA2001` row that still
  says conflicting runtime definitions are first-wins. Lead may fold those into a docs pass.

## Validation

| Command | Result |
|---|---|
| Example build + `--json` | 🟢 `success: true`, 3 outputs written, `diagnostics: []`, `warnings: []`, `errors: []` |
| `bun run verify` | 🟢 typecheck, Biome (384 files), 678 tests / 0 fail across 41 files |
| Deterministic rebuild | 🟢 repeated builds produce identical output |

No blockers. Worker changes outside this scope were preserved; the concurrent formatter work passed
the full suite during verification.

## Handoff

- State: complete; example and release wiring verified.
- Touched files: the table above.
- Remaining (lead-owned, out of my scope): root README example list, FRAMEWORK §2/§8 example counts,
  FRAMEWORK §6 stale runtime-conflict row.
- Do not commit/push without owner authorization.
