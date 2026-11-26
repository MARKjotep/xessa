# CSSX-U3 — Rendered-UI inspection (CDP driver + screenshot set)

**Phase:** U3 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete for capture; visual-inspection
routing to `vision` still open (see *Honest state*) · **Date:** 2026-11-26 · **Tree:** `main`,
uncommitted shared wave tree

## Summary

- `packages/vscode/test/ui/cdp.js` + `packages/vscode/test/ui/capture.js` launch the **cached VS Code
  1.147.0** build directly (no `@vscode/test-electron`, orchestrator untouched), attach over CDP with the
  runtime's built-in `WebSocket`, drive real input, and photograph **14 surfaces** — the suggest widget in
  7 trigger contexts, 2 hover cards, a diagnostic squiggle, the Problems panel, the status bar item in
  both states, the output channel and a grammar-highlighted document — plus a full accessibility-tree
  snapshot for U6.
- **14/14 screens captured, four consecutive complete runs**; every shot is gated on a DOM condition
  (bounded poll), never on a sleep. 16 PNGs + `ax-tree.json` + `manifest.json` in
  `.ai/reports/logs/ui-screens/`.
- This is the first pixel evidence for the U0 rows the `vscode` API cannot read: status bar text (row 12),
  output-channel content (row 13) and grammar/theme colours (row 4). The status bar item's **only**
  readable state is its `aria-label`; it is `warning Xessa (stale), 5 entries failed.` after a build with
  failing fixtures and `check Xessa, Compiled … → 3 artifact(s).` after a clean compile.
- Nothing was faked: the two screens that initially failed were fixed at the driver level and re-run; no
  placeholder image exists. Visual review was done by reading the PNGs; routing them to the `vision`
  specialist is still a lead step.

## Changed paths

| Path | Change |
|---|---|
| `packages/vscode/test/ui/cdp.js` | **new** — launch/profile/port/CDP library, cleanup guarantees |
| `packages/vscode/test/ui/capture.js` | **new** — screen definitions + CLI driver |
| `.ai/reports/logs/ui-screens/**` | **new** — 16 PNGs, `ax-tree.json`, `manifest.json` (report-log assets; `.ai/reports/logs/` is untracked, so no binary lands in a source path) |
| `.ai/reports/CSSX-U3.md` | this report |

Untouched: `packages/vscode/src/**`, `packages/vscode/package.json`, `tests/extension/host.test.ts`,
`tests/fixtures/**`. No dependency was added — `WebSocket`, `fetch`, `child_process` and `fs` are the
runtime's built-ins.

## Launch recipe (reproducible command line)

```
bun packages/vscode/test/ui/capture.js --all --out .ai/reports/logs/ui-screens
bun packages/vscode/test/ui/capture.js --screen suggest-hash --out /tmp/shots   # one screen
bun packages/vscode/test/ui/capture.js --list                                  # screen names
```

Executable (resolved exactly like the host orchestrator, first matching cache entry):

```
node_modules/.vscode-test-xessa/vscode-darwin-arm64-1.147.0/Visual Studio Code.app/Contents/MacOS/Code
```

Arguments actually passed (copied from `manifest.json` of the last run):

```
<TMP>/xessa-cdp-XXXX/workspace
--extensionDevelopmentPath=/…/packages/vscode
--user-data-dir=<TMP>/xessa-cdp-XXXX/user-data
--extensions-dir=<TMP>/xessa-cdp-XXXX/extensions      # contains a symlink xessa -> packages/vscode
--disable-extensions --disable-workspace-trust --skip-welcome --skip-release-notes
--disable-telemetry --disable-updates --new-window
--remote-debugging-port=0 --remote-allow-origins=*
```

- **Port discovery:** Chromium picks the port (`=0`) and writes `<user-data-dir>/DevToolsActivePort`
  (line 1 = port, line 2 = browser path); the driver polls that file (60 s bound), then
  `GET http://127.0.0.1:<port>/json/list` for the `page` target whose URL contains `workbench`, and
  attaches its WebSocket. Two runs never collide and nothing is hard-coded.
- **Profile isolation:** `mkdtemp` + `realpath` (macOS `/var` → `/private/var`), never the
  `@vscode/test-electron` `user-data`/`extensions` directories. The workspace is a copy of
  `packages/vscode/test/fixtures/ui/*.cssx` plus a seeded `scratch.cssx` the suggest screens type into,
  so committed fixtures are never edited.
- **Cleanup guarantees:** `handle.dispose()` (client close → `SIGKILL` the process → remove the profile)
  runs in the driver's `finally`; `installCleanup()` additionally handles `SIGINT`/`SIGTERM`/`SIGHUP`
  (kill + exit 130) and a synchronous `exit` hook that `SIGKILL`s the child, so a crash or Ctrl-C cannot
  leak a VS Code window or a debug port. `--keep-open` is the only way to leave it running (debugging).
- Domains used: `Page`, `Runtime`, `DOM`, `Input`, `Accessibility` only.

## Per-screen condition (what had to be true before the shutter)

| Screen(s) | Drive | Wait condition |
|---|---|---|
| 7 × `suggest-*` | open `scratch.cssx`, click into the editor, `Cmd+A`, `Input.insertText(prefix)`, `Ctrl+Space` | `.suggest-widget.visible` with `.monaco-list-row` count > 0; the row labels, kind icons and the `.suggest-details` panel are recorded into the manifest |
| `hover`, `hover-token` | type the document, locate the token's text node inside `.view-lines`, dispatch `Input.dispatchMouseEvent` `mouseMoved` to its box centre | a `.monaco-hover` with `height > 0`; the hover text and `code`-span presence are recorded |
| `diagnostics` | quick-open `broken-semicolon.cssx` | `.squiggly-error` present (1 element, class `cdr squiggly-error`); then `View: Toggle Problems` + `.markers-panel .monaco-list-row` rows > 0 |
| `status-bar` | open `clean.cssx`, `Xessa: Build Project`; then `Xessa: Compile File` | the `.statusbar-item` whose text/aria-label matches `Xessa` exists with width > 0, then its aria-label changes to the compiled state (`waitForStatusLabel(/Compiled|succeeded/)`) |
| `output-channel` | `clean.cssx`, `Xessa: Compile File`, `Output: Show Output Channels` → filter `Xessa` → Enter, `Output: Focus on Output View` | `.output-view` has ≥ 1 non-empty `.view-line` |
| `grammar` | close the panel (`View: Toggle Panel Visibility` when open), quick-open `clean.cssx` | ≥ 1 `.view-lines span[class*="mtk"]`; the class → computed colour map is recorded |
| `ax-tree` | — | `Accessibility.getFullAXTree` (444 nodes in the last run) |

Toasts are cleared before every shutter: the toast's close control only exists while the toast is
hovered, so the driver moves the mouse over each `.notification-toast` and then clicks the close button
(the "All installed extensions are temporarily disabled." info toast and a `Xessa: 5 entries failed.`
error toast both appeared during the campaign). `manifest.json` records `{dismissed, remaining}` per
shot — the final run is `remaining: 0` everywhere.

## Produced files (dimensions measured from the PNG IHDR)

| File | Size | Content |
|---|---|---|
| `suggest-at.png` | 2880×1800 | `@` at top level: 12 rows visible of the directive/alias list, `Xessa directive` doc panel with `@group` ADR-0017 text, keyword icons |
| `suggest-token.png` | 2880×1800 | `$` after `@variables`: `$brand`, `$gap`, `$keyframes.` with variable icons |
| `suggest-paren.png` | 2880×1800 | `width: (`: function list (`attr(`…), every label keeps its `(`, doc panel "CSS function … Example: attr(data-label)" |
| `suggest-hash.png` | 2880×1800 | `color: #f0`: 5 rows, each with a **colour swatch** and the `CSS color` detail |
| `suggest-color-values.png` | 2880×1800 | `color: ` (Ctrl+Space): hex palette rows (`#000000`, `#0891b2`, …) with swatches |
| `suggest-amp-colon.png` | 2880×1800 | `&:`: 19 pseudo entries (`::after`…), method icons |
| `suggest-amp-dot.png` | 2880×1800 | `&.`: `&`, `& +`, `& >`, `&:disabled`, `&:focus-visible`, `&:hover`, `.badge` |
| `hover-calc.png` | 2880×1800 | hover card `calc() — CSS function` + description + `Example: calc(100% - 20px)` code span |
| `hover-token.png` | 2880×1800 | hover card `$brand — compile-time token` / `Value: #2563eb` |
| `diagnostics-squiggle.png` | 2880×1800 | `broken-semicolon.cssx` with the squiggle on line 5 |
| `problems-panel.png` | 2880×1800 | Problems panel: `missing semicolon after a declaration; … xessa XESSA1002 [Ln 5, Col 3]` |
| `status-bar.png` | 262×76 | clip: `$(warning) Xessa (stale)` |
| `status-bar-success.png` | 182×76 | clip: `$(check) Xessa` |
| `status-bar-full.png` | 2880×1800 | full window with the item in context (language item "Xessa" sits beside it — two `Xessa` texts, the right-hand one is the extension's) |
| `output-channel.png` | 2880×1800 | Output panel, channel `Xessa`: 15 lines, `wrote <abs path>` ×3 + earlier build lines, status message `Xessa: wrote 3 artifact(s) for clean.cssx` |
| `grammar-clean.png` | 2880×1800 | `clean.cssx`: 165 token spans / 16 distinct token colours, inline swatches (`navy`, `red`, `#fff`, `#2563eb80`), `colorpicker-color-decoration` class present |
| `ax-tree.json` | 296 KB | 444 nodes, full accessibility tree (`version: 1.147.0`) |
| `manifest.json` | 14 KB | per-screen: file, dimensions, elapsed ms, DOM evidence, toast state; plus the launch args and executable |

## Findings from the captured states

1. **Status bar item (U0 row 12) — readable only through the DOM.** After `Build Project` on a workspace
   with 7 clean and 5 failing entries: `$(warning) Xessa (stale)` with
   `aria-label: "warning  Xessa (stale), 5 entries failed."` and `title: null` (the tooltip is exposed via
   the aria-label, not `title`). After a clean `Compile File`:
   `$(check) Xessa` with `aria-label: "check  Xessa, Compiled <path> → 3 artifact(s)."`. Both states are
   visually correct (icon + text, right-aligned, distinguishable in the default dark theme).
   *Observation (not a defect):* a build where **all** entries fail reports `stale` rather than `error`
   once any earlier compile succeeded — that is the documented `hasSuccessfulBuild` behaviour
   (`controller.ts:497-509`), not a bug; recorded so U4 does not read it as a regression.
2. **Output channel (U0 row 13).** Lines are `[ISO-timestamp] wrote /private/var/…/clean.css`, `.map.js`,
   `.map.d.ts` — full absolute paths, nothing truncated, and `Build complete: 7/12 entries clean.` is
   readable. The channel picker lists `Xessa` beside the built-in channels, so the contribution is
   discoverable by name.
3. **Suggest widget per context (U0 row 18).** Colour items render a real swatch plus `CSS color`; `@`
   and `(` open the documentation panel with formatted Markdown (code span in `Example:`); `(` labels
   keep their opening paren; pseudo items use the method icon, directives the keyword icon, tokens the
   variable icon, classes the class icon. Truncation was not observed at 2880 px.
4. **`&.` state lists `&`-prefixed starters** (`&`, `& +`, `& >`, `&:hover`, `&:disabled`,
   `&:focus-visible`) **next to `.badge`**. Accepting one of those after a typed `&.` would yield
   `&.&:hover` — the same "empty/leftover punctuation" family as the pinned `&&:hover` defect (U1-B).
   Candidate task material; asserted nowhere yet because it needs an acceptance run, not a screenshot.
5. **Hover cards (U0 row 17)** render as compact cards with a title line, prose and a code span; no
   clipped code, no bare links, no images — consistent with U1's Markdown-only assertion.
6. **Diagnostics (U0 row 15)** show one `cdr squiggly-error` squiggle and a Problems row carrying the
   `xessa` source and `XESSA1002` code badge.
7. **Grammar (U0 row 4)** produces 16 distinct token colours (e.g. `rgb(197,134,192)`, `rgb(156,220,254)`,
   `rgb(255,123,114)`) and inline colour swatches, i.e. the shipped grammar actually colours a document in
   the workbench — the host half TT6 could not prove.

## Driver traps worth knowing (measured, documented in `capture.js`)

| Trap | Symptom | Fix in the driver |
|---|---|---|
| `Input.insertText` lands in the editor | quick open stays unfiltered, the document gets the text | focus the quick input's `input` element and verify the value before typing |
| The palette field carries a `>` prefix | select-all + replace → "No matching results" for a real title | append instead of replacing, verify the value *ends with* the text |
| Palette fuzzy ranking | `toggle primary` ranked "Side Bar **Position**" above "…**Visibility**" | click the row whose title *starts with* the exact command title, never blind Enter |
| A command that opens a picker reuses the same `.quick-input-widget` | "wait for the widget to close" never succeeds | `runCommandOpeningPicker()` waits for the *new* row set instead |
| Quick open lists "recently opened" first | accepting too early picks nothing | wait for a row that starts with the requested file name |
| The output panel has two `.output` elements | `.output` is empty and has 0 view lines | read `.pane-body.output-view` (recorded: 15 lines) |
| Toast close button only exists on hover | dismissal reported `remaining: 1` | mouse-move onto each toast, then click the close codicon |
| Template-literal escapes in evaluated snippets | `'\n'` / `\d` are eaten or become raw newlines → `Runtime.evaluate` throws and the poll silently retries | join with `String.fromCharCode(10)`, spell digit classes `[0-9]` |

## Honest state / failures during the campaign

- The first two driver runs captured **12/14**: `status-bar-success` waited on `aria-label` matching
  `/success/`, but the label is `check  Xessa, Compiled … → 3 artifact(s).`; and `output-channel` timed
  out because (a) the channel picker reuses the palette's widget element, (b) the extension's channel only
  exists after activation, and (c) the panel's content lives in `.pane-body.output-view`, not `.output`.
  Both were fixed at the driver level (waits widened to the measured conditions, `waitForStatusLabel`
  reports the observed labels on timeout) and re-run; the last four runs are 14/14.
- No screenshot is claimed that was not taken. There is no `vision` pass yet: the PNGs were reviewed by
  reading them in this session (findings above), and the same files are the input for the `vision`
  specialist (`--out .ai/reports/logs/ui-screens`), which the lead routes. If `vision` is unavailable,
  this report's per-screen findings are the delivered inspection and must be marked as agent-read, not
  specialist-verified.
- Screens deliberately **not** attempted here (not in this phase's assigned list): toast/notification
  capture (the notifications were used only to be dismissed), light-theme variants (U6 needs both
  themes), file-icon rendering in the Explorer (U6), Restricted-Mode screens (U4).

## Candidate tasks routed from U3

| # | Candidate | Evidence | Acceptance |
|---|---|---|---|
| U1-B | `&` starters replace an empty caret range → `&&:hover` | U1 pin + checklist row 6 + screenshot `suggest-amp-dot.png` showing `&`-prefixed starters offered after `&.` | range covers the typed punctuation; the checklist pin flips |
| U3-A | `&.` context offers `&`-prefixed starters that would produce `&.&:hover` | `suggest-amp-dot.png`, manifest `labels: ["&","& +","& >","&:disabled","&:focus-visible","&:hover",".badge"]` | screenshot/DOM list no longer mixes `&`-starters into a `&.` context (or accepting one is safe) |
| U1-A | `$`-namespace completion drops the sigil | U1 pin (not re-captured; no screen drives acceptance) | U1's pin flips |
| — | Status-bar/listener observation, no task: `$(warning) Xessa (stale)` after a build whose entries all fail once a previous build succeeded | `status-bar.png` + aria-label | documented as intended (`hasSuccessfulBuild`), U4 must not read it as a regression |

## Reproduce

```
bun packages/vscode/test/ui/capture.js --all --out .ai/reports/logs/ui-screens
```

Output ends with `[xessa cdp] done: 14/14 screens captured`, `[xessa cdp] ax-tree: <n> nodes` and the
`manifest.json` path; exit code 0. A missing cached build exits 1 with the exact cache path and the
`XESSA_EXTENSION_HOST_DOWNLOAD=1 …` hint — visual inspection is then *unavailable*, not faked.

## Handoff

- Completed: `cdp.js` + `capture.js`, 14/14 screens, `ax-tree.json`, manifest, three consecutive green
  capture runs, driver traps documented.
- Touched: `packages/vscode/test/ui/cdp.js`, `packages/vscode/test/ui/capture.js`,
  `.ai/reports/logs/ui-screens/**`, `.ai/reports/CSSX-U3.md`.
- Remaining: lead routes the PNGs to `vision`; U6 consumes `ax-tree.json`; U3-A needs a task spec.
