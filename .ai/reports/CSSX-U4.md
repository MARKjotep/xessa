# CSSX-U4 — Commands, settings and workspace matrix

**Phase:** U4 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete (the plan's phase row is left 🔴; build owns the flip)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree
**Write set used:** `packages/vscode/test/suite.js` (scenario registration), `packages/vscode/test/ui/**`
(`commands-matrix.js`, `config.js`, `workspace-probe.js`, `probe-entry.js`, `restricted.js`,
`multi-root.js`, `workspace-fixtures.js`), this report. Not touched: `packages/vscode/src/**`,
`packages/vscode/package.json`, `tests/extension/**`, `tests/fixtures/**`, `tests/stress/**`.

## Summary

- The U4 matrix is executed in **two host windows**: the main suite (palette, trusted run, no-editor,
  error surfacing, artifact-absent paths, all four settings) and a **standalone probe launcher** for the
  two states `@vscode/test-electron` cannot produce — Restricted Mode and multi-root. Both probes pass:
  **restricted 23 assertions**, **multi-root 29 assertions**.
- The plan's Restricted-Mode recipe is **wrong in direction and had to be corrected by measurement**:
  `@vscode/test-electron@2.5.2` always appends `--disable-workspace-trust` (`out/runTest.js:53`), and that
  flag *disables the trust feature* — the harness window is trusted by construction. The probe launches
  the same cached binary **without** the flag on a fresh `mkdtemp` folder + fresh profile and measures
  `workspace.isTrusted === false`, with every write path refusing and read-only features still working.
- Every setting in the manifest (4) is toggled **on → off → restored** and asserted on the behaviour it
  claims to control, including `globalValue` restoration. The inventory is read from the manifest, so a
  new setting cannot be added without failing the module.
- One plan sentence is **over-precise and corrected here**: a broken document still gets a preview (the
  tolerant compiler emits the surviving declarations); a syntactically dead document gets an *empty*
  preview tab rather than the intended warning. Pinned as candidate **CSSX-U4-A** (source is outside this
  campaign's write set).
- Host suite: **12 scenarios / 606 assertions**, green twice back-to-back; `bun run verify`
  (`1160 pass / 2 skip / 0 fail`, 85 files, host suite included) and `bun run lint` (502 files) green.

## Changed paths

| Path | Change | Assertions |
|---|---|---|
| `packages/vscode/test/suite.js` | 3 scenarios appended: `commands-matrix`, `config`, `performance` (U5) | — |
| `packages/vscode/test/ui/commands-matrix.js` | **new** — palette + trusted + no-editor + error/artifact-absent + broken/dead preview cells for all 6 commands | 101 |
| `packages/vscode/test/ui/config.js` | **new** — manifest setting inventory + 4 toggle/restore cases | 54 |
| `packages/vscode/test/ui/workspace-probe.js` | **new** — standalone launcher (cached build, own profile, `--extensionTestsPath`, `PASS/FAIL` marker) | — |
| `packages/vscode/test/ui/probe-entry.js` | **new** — in-host probe entry (`XESSA_PROBE_CASE`) | — |
| `packages/vscode/test/ui/restricted.js` | **new** — Restricted-Mode matrix (untrusted window) | 23 |
| `packages/vscode/test/ui/multi-root.js` | **new** — two-root scoping matrix | 29 |
| `packages/vscode/test/ui/workspace-fixtures.js` | **new** — `vscode`-free fixture text shared by driver and suites | — |
| `.ai/reports/CSSX-U4.md` | this report | — |

Total host assertions added by U4 in the main suite: **155** (previous 416 + 155 + U5's 35 = 606).

## Commands and results (final state)

| Command | Result |
|---|---|
| `bun test tests/extension/host.test.ts` (run 1) | green — `12 scenarios, 606 assertions` `[baseline=36, completions=98, hovers=42, diagnostics=36, colors=42, commands=26, navigation=25, quickfix=15, checklist=96, commands-matrix=101, config=54, performance=35]`, `2 pass / 0 fail` |
| `bun test tests/extension/host.test.ts` (run 2, immediately after) | **identical** — `12 scenarios, 606 assertions`, `2 pass / 0 fail` |
| `bun packages/vscode/test/ui/workspace-probe.js --all` | green — `restricted: PASS (23 assertions)`, `multi-root: PASS (29 assertions)` |
| `bun run verify` | green — `1160 pass / 2 skip / 0 fail`, 995 041 `expect()` calls, 85 files, host suite included |
| `bun run lint` | green — `biome check .`, 502 files, no fixes |

## The trust mechanism (measured, not assumed)

| # | Fact | Evidence |
|---|---|---|
| 1 | `@vscode/test-electron@2.5.2` appends `--disable-workspace-trust` to **every** launch | `node_modules/.bun/@vscode+test-electron@2.5.2/node_modules/@vscode/test-electron/out/runTest.js:53` |
| 2 | That flag **disables the trust feature**, so the workspace is trusted | `baseline.js` asserts `workspace.isTrusted === true` in the harness window; adding the flag to a direct launch keeps `isTrusted: true` (measured) |
| 3 | The harness window therefore **cannot** show Restricted Mode, whatever fixtures/settings are used | consequence of 1 + 2; recorded instead of stubbing `workspace.isTrusted` (impossible — it is a read-only getter) |
| 4 | A fresh `mkdtemp` folder + fresh profile launched **without** the flag is genuinely untrusted | `probe-entry.js` prints `start case=restricted trusted=false`; `restricted.js` asserts `isTrusted === false` and `compileFile` wrote nothing |
| 5 | The direct launch needs a **short** profile path | VS Code puts `<user-data-dir>/<version>-main.sock`; a descriptive prefix exceeded 103 characters on macOS and the window died with `Error: listen EINVAL … 1.14-main.sock` before any output. Fixed by `mkdtemp(os.tmpdir(), "xessa-p-")` + `u/`, `e/` subdirectories |
| 6 | `workspace.updateWorkspaceFolders()` on a single-folder window converts it to multi-root but **reloads the window and re-runs the extension test suite** | measured during de-risking (the suite ran twice, workspace folders grew by one each reload); therefore multi-root is a separate `.code-workspace` launch, never an in-suite mutation |

Launch recipe actually used by `workspace-probe.js` (copied from the run output):

```
<tmp>/xessa-ws-XXXX/                                   # restricted: the folder
<tmp>/xessa-ws-XXXX/xessa-two-roots.code-workspace     # multi-root: two folders
--extensionDevelopmentPath=…/packages/vscode
--extensionTestsPath=…/packages/vscode/test/ui/probe-entry.js
--user-data-dir=<tmp>/xessa-p-XXXX/u
--extensions-dir=<tmp>/xessa-p-XXXX/e
--disable-extensions --no-sandbox --disable-gpu-sandbox --skip-welcome --skip-release-notes
--disable-telemetry --disable-updates
[--disable-workspace-trust]                            # multi-root only: trusted window
env XESSA_PROBE_CASE=restricted|multi-root
```

No flag is added to `tests/extension/host.test.ts` (read-only input; no orchestrator change was needed).

## U4 — per-command matrix

Legend: **S** = main host suite (`commands-matrix.js`), **R** = restricted probe (`restricted.js`),
**M** = multi-root probe (`multi-root.js`), **U3** = rendered evidence already on disk
(`.ai/reports/logs/ui-screens/`), **API** = not readable through the `vscode` API.

| Command | Palette presence | Trusted run, `.cssx` active | No editor open | Error surfacing | Restricted Mode | Multi-root | Toast / status text |
|---|---|---|---|---|---|---|---|
| `xessa.compileFile` | S — manifest `title: "Compile File"`, `category: "Xessa"`, `onCommand:` activation, `getCommands(true)` | S — writes `<stem>.css` / `.map.js` / `.map.d.ts`, prefix applied, no other entry built | S — resolves, writes nothing, opens nothing | S — broken document writes nothing, previous `.css` byte-identical, no temp file, `XESSA1002` published | R — refused, **nothing written** (tree listing unchanged) | M — per root: `.alpha-button` in root A, `.beta-tile` in root B, no cross-root write | API — U3 `output-channel.png`, `status-bar*.png` |
| `xessa.buildProject` | S — same checks | S — builds every discovered entry, broken entry skipped and counted, clean entries written | M — folder-based path uses **workspaceFolders[0] only** (root A); root B untouched | S/M — failing entry publishes diagnostics, clean entries still build, `broken.css` never written | R — refused, nothing written for any entry | M — with no editor, only the first root is built | API — U3 |
| `xessa.previewCompiledCss` | S | S — `xessa-preview:` document, compiled CSS present, language forced to `css`, nothing written; split on/off in `config.js` (2 ↔ 1 editors) | S — no editor/source, no preview opened, nothing written | S — broken document previews the **tolerant** CSS (malformed declaration dropped) with its diagnostic; dead document previews as an empty tab (pinned, CSSX-U4-A) | R — **allowed** (in memory), correct CSS, nothing written | M — compiles against the active file's own root/config | API (warning wording) — U3 |
| `xessa.openGeneratedCss` | S | S — opens the planned CSS, `languageId === "css"`, no write | S — no editor, nothing opened, nothing written | S — artifact absent → active editor unchanged, no file created; `emit-css: false` → reports instead of opening | R — nothing generated, so reports and leaves the source active | M — opens root B's `beta.css` from a root-B document, root A's `entry.css` from a root-A document | API (info message) — U3 |
| `xessa.openClassMap` | S | S — opens `entry.map.js` as `javascript`, no write | S — no editor, nothing opened, nothing written | S — `emit-css: false` still plans a map: opens `no-css.map.js` | R — reports, source editor stays active | M — per-root artifacts (covered by the compile cells) | API — U3 |
| `xessa.checkProject` | S | S — reports, **writes nothing** (artifacts pre-seeded with `stale` stay `stale`) | M — no editor: writes nothing in either root, artifact stays `stale` | S — broken entry diagnosed, no artifacts written | R — **allowed**, diagnostics published, nothing written | M — no writes in either root | API — U3 |

Cells that are not a command call: **menus / keybindings** — the manifest contributes none
(`contributes.keybindings === undefined`, `contributes.menus === undefined`, asserted in S). The palette
is the only discovery surface, which is what the plan's U0 rows 6 and 7 record as the design.

## U4 — settings matrix

All four settings come from `manifest.contributes.configuration.properties` (the inventory assertion
fails if the manifest grows a setting this table does not cover). Target: `ConfigurationTarget.Global`
(a workspace-target write would create `test/fixtures/.vscode/settings.json`, which this campaign must
never do). Every case restores the default in a `finally`; the module ends by asserting both the effective
value and `inspect(...).globalValue`.

| Setting | Default | Off / false observed | On / true observed | Restored |
|---|---|---|---|---|
| `xessa.editor.completePropertyWithSemicolon` | `true` | property item is plain text, `insertText === "color: "` | property item is a `SnippetString` `color: $0;` | snippet body back to `color: $0;` |
| `xessa.editor.formatOnSave` | `false` | save leaves `" .card{color:red}"` untouched | save yields `".card {\n  color: red;\n}\n"` | a further save is untouched again (`" .card{color:red}"`) |
| `xessa.compileOnSave` | `false` | save writes nothing (`save-entry.css` absent over a 1.5 s window, past the 150 ms debounce) | save writes `save-entry.css` (`.cfg-button`) + `save-entry.map.js` | a pre-seeded `stale` artifact is not rewritten after turning it off again (1.5 s window) |
| `xessa.previewSplitEditor` | `true` | preview **replaces**: 1 visible editor, preview scheme | preview **beside**: 2 visible editors, preview takes focus | back to 2 visible editors |

Defaults, `type: "boolean"` and the settings-page descriptions are asserted for all four keys.

## U4 — Restricted Mode evidence (`restricted.js`, 23 assertions)

Window state: one workspace folder, `workspace.isTrusted === false`, fresh profile, no trust decision.

| Section | Asserted |
|---|---|
| State | `isTrusted === false`; exactly one folder; the driver-written sources are `broken.cssx`, `entry.cssx`, `second.cssx` |
| Activation | the entry opens with `languageId === "xessa"` and the extension becomes active (`waitFor` on `extension.isActive`) |
| Read-only surface | `broken.cssx` publishes `XESSA1002` — diagnostics are **not** trust-gated |
| Compile File | `entry.css` absent; no `.css` / `.map.js` anywhere in the root |
| Build Project | directory listing byte-identical to the source set |
| Check Project | listing unchanged; the broken entry is still diagnosed |
| Preview | `xessa-preview:` document with `.restricted-button {`; nothing written |
| Open CSS / Map | neither command opens an editor (nothing was generated); the source stays active |
| Compile-on-save | with `xessa.compileOnSave = true`, a save writes nothing over a 1.5 s window |
| Final | listing unchanged; `isTrusted` still `false` |

Not assertable here (recorded, not faked): the warning-toast wording and the output-channel line
(`controller.ts:249-252`, `347-350`, `387-390`, `455-458`). U3's CDP screens cover the status bar and the
output channel in the trusted window; the untrusted wording is source-pinned and listed for U7/PP3.

## U4 — multi-root evidence (`multi-root.js`, 29 assertions)

Window: `<tmp>/xessa-two-roots.code-workspace` → `root-a` (config `classes.prefix: "alpha"`, two clean
entries + one broken) and `root-b` (no config, `@setup prefix: "beta"`, plus `notes.md`). Trusted window
(`--disable-workspace-trust`), because this case is about scoping.

| Section | Asserted |
|---|---|
| Window shape | 2 folders named `root-a`, `root-b`; trusted; each document resolves to its own folder |
| Per-file config | `entry.css` in root A is `.alpha-button`; `beta.css` in root B is `.beta-tile`; root B's CSS contains no `alpha`; neither root's compile wrote into the other root |
| Open Generated CSS | from a root-B document opens `root-b/beta.css`; from a root-A document opens `root-a/entry.css` |
| Diagnostics | root A's broken entry publishes `XESSA1002`; root B's document has none; root A's clean entry has none; **no diagnostic exists for a file outside both roots** |
| Language scoping | `notes.md` opens as `markdown`, receives **zero** Xessa completion items (filtered by the Xessa detail strings) and **zero** diagnostics |
| Folder-based Build (no editor) | writes root A's `second.css`, never `broken.css`, and leaves root B byte-identical (the first folder only) |
| Folder-based Check (no editor) | no writes in either root; a pre-seeded `stale` root-A artifact stays `stale` |

## Not assertable through the `vscode` API (routed, never faked)

Status-bar text and tooltip (write-only `StatusBarItem`), output-channel lines (append-only),
`showInformationMessage` / `showWarningMessage` / `showErrorMessage` / `setStatusBarMessage` text
(U0 row 12/13/24). The U4 cells above assert their observable proxies (files, opened editors, diagnostics,
active editor). Rendered images for the same states already exist from U3:
`status-bar.png`, `status-bar-success.png`, `output-channel.png`, `diagnostics-squiggle.png`,
`problems-panel.png` in `.ai/reports/logs/ui-screens/`.

## Defects, observations and candidate tasks

### CSSX-U4-A — Preview of a dead document opens an empty tab instead of the warning (pinned, not skipped)

- **Measured:** `xessa.previewCompiledCss` on `.button { color: red; padding: 4px; }` with the missing
  semicolon produces `xessa-preview:broken.cssx` containing the tolerated CSS
  (`.app-button {\n  padding: 4px;\n}\n`) **and** keeps `XESSA1002`; on `!!! not a stylesheet !!!` it
  opens `xessa-preview:` with **empty** text and `XESSA1001`. The intended warning in
  `controller.ts` (`css === undefined` → "no CSS was produced …") is unreachable for all five probe
  documents (`unterminated`, `garbage`, `bad-setup`, `empty`, `comment-only` — all produced a
  `xessa-preview:` document; only `garbage`/`empty`/`comment-only` produced empty CSS).
- **Where pinned:** `commands-matrix.js` — "pinned: a dead document previews as an empty tab instead of
  the warning (CSSX-U4-A)".
- **Candidate fix (source outside this campaign's write set):** treat `""` as "no CSS" (or open the
  preview only when the compilation has no error diagnostics) and show the existing warning.
  Acceptance: that pinned assertion flips to "no `xessa-preview` document opened + warning".

### Observations (design or host behaviour, not defects)

1. **Plan §U4's Restricted-Mode recipe is inverted.** `--disable-workspace-trust` disables the trust
   *feature*; Restricted Mode is the absence of a trust decision on a fresh profile. Recorded above; the
   plan sentence is left as-is (this phase's write set does not include the plan file).
2. **Plan §U4's preview row is over-precise.** "Parse error → no CSS → warning" only holds when
   `compiled.css` is `undefined`; the tolerant compiler produces CSS for a missing semicolon and an empty
   string for dead input. Measured table above; the matrix cell asserts the actual behaviour.
3. **`workspace.updateWorkspaceFolders()` reloads the host and re-runs the extension test suite** in this
   build (VS Code 1.147.0). In-suite multi-root mutation is therefore unusable as a test technique; the
   `.code-workspace` launch is the deterministic replacement (recipe above).
4. **Resource-scoped `getConfiguration(…, uri)` objects do not refresh after `update()`.** In the probe,
   `settings.update("compileOnSave", true)` followed by `settings.get("compileOnSave")` on the *same*
   object returned `false`; re-reading through a fresh `getConfiguration` returned `true`. Both
   `config.js` and `restricted.js` therefore re-read configuration objects after an update. Worth knowing
   for any future settings test.
5. **Long `--user-data-dir` kills the window before any output** (`EINVAL` on `1.14-main.sock`, >103
   characters on macOS). Any future direct-launch driver (U3's CDP driver included) should keep the
   profile path short.
6. **`xessa.checkProject` is allowed in Restricted Mode** (as designed — it writes nothing) and does
   publish diagnostics; the trust matrix therefore has a working read-only column rather than a wall of
   refusals.

## Deviations from the plan's §U4 text

1. Plan names `packages/vscode/test/ui/matrix.js`; the task brief named `commands-matrix.js` + `config.js`
   — used the brief's names (behaviour matches the plan's matrix).
2. Restricted Mode is **not** reachable in the main harness (mechanism above); it is covered by
   `workspace-probe.js --case restricted`, and the probe's verdict is part of the evidence, run
   separately (one VS Code window at a time, plan ground rule).
3. Multi-root is **not** an in-suite mutation (reload, observation 3); it is a `.code-workspace` launch.
4. The no-editor **folder-based** Build/Check cell is not run in the main suite: the guest workspace
   folder is the committed `test/fixtures` tree and the folder-based path writes `*.css`/`*.map.js` next
   to the sources. The module asserts that precondition (`.cssx` files exist under the guest folder) and
   records the deferral; the probe covers the cell for real.
5. Two cells were added beyond the brief's table because the plan's matrix lists them: preview of a
   broken document and Build/Check with no discoverable `.cssx` entry.

## Handoff

- Completed: per-command matrix (6 × 6 states), settings matrix (4 keys, on/off/restore), Restricted Mode
  probe (23 assertions), multi-root probe (29 assertions), suite green ×2 at 606 assertions, verify +
  lint green.
- Touched: `packages/vscode/test/suite.js`, `packages/vscode/test/ui/{commands-matrix,config,workspace-probe,probe-entry,restricted,multi-root,workspace-fixtures}.js`, this report.
- Remaining for the lead: candidate task `CSSX-U4-A` (preview of dead documents), and the plan-flip for
  the U4 row. U6/U7 consume the matrix; PP3's manual list does not need to grow (the only manual residue
  is still the native colour-picker click from U2).
