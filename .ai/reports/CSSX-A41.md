# CSSX-A41 — seventh example: `examples/groups` (`@group` showcase)

## Summary

- Added `examples/groups/`, a seventh worked example for the shipped reusable declaration groups
  (`@group.<name>`, ADR-0017 / SPECIFICATION.md §3.7): a style-imported module defines `chrome`
  and `elevated` once, and entry use sites show emergent-cascade overrides with both declarations
  preserved, an inline `@md` default, a `!important` default that a plain override cannot beat,
  defining-module `$token` resolution despite an identically named entry token, and runtime
  customization authored at the use site (owner decision (b)).
- The example builds with **zero diagnostics** through the existing CLI and commits deterministic
  `generated/` CSS/JS/`.d.ts` plus `.cssx-manifest.json`; two consecutive builds are byte-identical.
- Wired like `examples/overrides`: one appended `release:check` command and the `docs/release.md`
  list now says seven and names `groups`. No compiler, test, extension, docs prose or other-example
  source changed.
- Validation: example build clean and deterministic; typecheck green; full test suite **805 pass /
  0 fail / 45 files**. Repo-wide `bun run verify` stops at Biome on the untracked agent file
  `.pi/settings.json` (not part of this task or write set — see Blockers); `biome check` on all
  touched files is clean.

## Changed files

| File | Change |
|---|---|
| `examples/groups/xessa.config.json` | **New.** Entries `src/**/*.cssx`; `src/chrome.cssx`, `src/theme.cssx` and `generated` excluded; `classes.prefix: "ui"`; strict + safe grouping. |
| `examples/groups/src/chrome.cssx` | **New.** Compile-time tokens plus `@group.chrome` (padding/radius/border/`box-sizing !important`) and `@group.elevated` (shadow, compile-time background, inline `padding: 12px @md 20px`). |
| `examples/groups/src/theme.cssx` | **New.** `@runtime surface`/`accent` (light + `@dark`), imported with `styles` so `:root` is emitted. |
| `examples/groups/src/entry.cssx` | **New.** Both `styles` imports, local `chrome-padding: 40px` shadow, and one rule per behaviour (`.card`, `.tile`, `.framed`, `.raised`, `.flush`, `.local-token`). |
| `examples/groups/README.md` | **New.** Structure, build command, rule-by-rule explanation, visibility/prefix notes, v1 exclusions, ADR-0017 link. |
| `examples/groups/generated/styles/app.css` | **New.** Built output (72 lines). |
| `examples/groups/generated/maps/app.map.js` | **New.** Class map. |
| `examples/groups/generated/maps/app.map.d.ts` | **New.** Literal declarations. |
| `examples/groups/.cssx-manifest.json` | **New.** Manifest for clean/rebuild. |
| `package.json` | `release:check` builds `examples/groups` after `examples/overrides` (one appended command). |
| `docs/release.md` | Step 6 says seven examples and lists `groups`. |
| `.ai/tasks/CSSX-A41.md`, `.ai/reports/CSSX-A41.md`, `.ai/reports/logs/CSSX-A41.log` | Task, report, worker log. |

No `packages/**`, `tests/**`, other example, root README, FRAMEWORK, PROGRESS/todo, ADR or
SPECIFICATION edit. Framework records do not apply (this is Xessa example work, not a third-party
dependency defect).

## Built-output evidence

Command (the command appended to `release:check`, run with `--json` for the recorded result):

```sh
bun packages/cli/src/index.ts build --config examples/groups/xessa.config.json --json
```

```json
{ "success": true, "exitCode": 0,
  "entries": [{ "file": "src/entry.cssx",
                "dependencies": ["src/chrome.cssx", "src/theme.cssx"],
                "diagnostics": [] }],
  "diagnostics": [], "warnings": [], "errors": [] }
```

`generated/styles/app.css` (full file, 72 lines):

```css
:root {
  --ui-surface: #ffffff;
  --ui-accent: #0f766e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ui-surface: #0f172a;
    --ui-accent: #2dd4bf;
  }
}

.ui-card {
  padding: 12px;                /* group default */
  border-radius: 8px;
  border: 1px solid #d4d4d8;
  box-sizing: border-box !important;
  padding: 20px;                /* use-site override: later, both kept */
}

.ui-tile {
  padding: 12px;
  border-radius: 8px;           /* group default */
  border: 1px solid #d4d4d8;
  box-sizing: border-box !important;
  border-radius: 0;             /* use-site override: later, both kept */
}

.ui-framed {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #d4d4d8;
  box-sizing: border-box !important;
  box-sizing: content-box;      /* plain override emitted last, still loses (ADR-0003) */
}

.ui-raised {
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  background: #ffffff;          /* compile-time group default */
  padding: 12px;                /* inline @md default, base segment */
}

@media (min-width: 768px) {
  .ui-raised {
    padding: 20px;              /* inline @md default, variant segment */
  }
}

.ui-raised {
  background: var(--ui-surface); /* runtime customization authored at use site */
  color: var(--ui-accent);
}

.ui-flush {
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  background: #ffffff;
  padding: 12px;
}

@media (min-width: 768px) {
  .ui-flush {
    padding: 20px;
  }
}

.ui-flush {
  padding: 4px;                 /* later base declaration beats the @md default by design */
}

.ui-local-token {
  margin-top: 40px;             /* entry token only; group defaults stayed 12px */
}
```

Acceptance mapping:

- **Overrides after defaults, repeats preserved:** `.ui-card` (12px → 20px), `.ui-tile` (8px → 0),
  `.ui-framed` (`box-sizing` twice). Group definitions themselves emit nothing.
- **Inline variant default:** `@group.elevated` produces the 12px base / 20px `@md` pair for
  `.ui-raised`; `.ui-flush` shows the documented base-beats-variant consequence.
- **`!important` persistence:** `.ui-framed` emits `content-box` after `border-box !important`, so
  border-box still wins per ADR-0003.
- **Defining-module token resolution:** `chrome.cssx` tokens emit 12px/8px even though `entry.cssx`
  declares `chrome-padding: 40px`; the entry's 40px appears only in `.ui-local-token`.
- **Use-site runtime customization (decision (b)):** defaults are compile-time, while `.ui-raised`
  binds `$theme.surface`/`$theme.accent` into `var(--ui-surface)`/`var(--ui-accent)`.
- **Visibility:** only the `styles` import exposes the groups; `theme.cssx` is `styles` so its
  `:root` block is present.

## Validation

| Command | Result |
|---|---|
| `bun packages/cli/src/index.ts build --config examples/groups/xessa.config.json --json` | 🟢 `success: true`, `exitCode: 0`, 3 outputs, `diagnostics: []`, `warnings: []`, `errors: []` |
| Build twice, `sha256` all generated files + manifest, `diff` | 🟢 identical (deterministic) |
| `bun run verify` | 🟡 typecheck passes; Biome fails only on untracked `.pi/settings.json` (see Blockers); tests run separately: **805 pass / 0 fail / 45 files** |
| `bunx biome check examples/groups package.json docs/release.md` | 🟢 clean |
| `git diff --check -- package.json docs/release.md` | 🟢 no whitespace errors |

The 805 count is 7 above the task's 798 baseline; the example adds no tests, and the delta comes
from pre-existing concurrent worker changes already in the working tree (modified `tests/**` and
`packages/**`), not from this task. The task's own surface adds no test file.

## Blockers / notes

- **`bun run verify` lint step:** `biome check .` reports one formatting error in untracked
  `.pi/settings.json` (Pi agent settings, outside this task's write set and not a repository source
  file). It is the only Biome error; all files touched here are clean. This is an environment
  artifact for the lead to handle (format or ignore `.pi/`), not an example defect. Typecheck and
  the full test suite pass.
- `release:check` was not run end-to-end (browser gate and VS Code packaging are outside this task
  and `packages/vscode/**` is owned by parallel workers); its appended example command was executed
  directly and passed.
- Pre-existing working-tree changes from other tasks/workers were present before this task and were
  left untouched.

## Handoff

- State: complete; example, generated output, release wiring and docs list verified.
- Touched files: the table above.
- Next action (lead-owned): resolve the untracked `.pi/settings.json` Biome failure for repo-wide
  `verify`, then run full `release:check` once parallel workers settle.
- Do not commit/push without owner authorization.
