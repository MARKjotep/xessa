# CSSX-U6 — Accessibility

**Phase:** U6 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete (the plan's phase row is left 🔴;
build owns the flip) · **Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree
**Write set used:** `packages/vscode/test/ui/accessibility.js` (**new**), `packages/vscode/test/suite.js`
(one scenario line), this report. Not touched: `packages/vscode/src/**`,
`packages/vscode/package.json`, `tests/extension/**`, `tests/fixtures/**`, `tests/stress/**`,
`.ai/reports/logs/ui-screens/**` (read-only input from U3).

## Summary

- Six accessibility properties are now **measured in the host**, not asserted by inspection:
  `packages/vscode/test/ui/accessibility.js` adds **196 assertions** and the suite is **13 scenarios /
  802 assertions** (was 12 / 606), green twice back-to-back with identical output.
- **Keyboard:** all 6 command ids resolve through `vscode.commands.getCommands` (the palette's own
  lookup), every palette label is `Xessa: <title>` with a unique title, no entry carries an
  `enablement` condition, and the manifest declares **zero keybindings** — so the extension introduces
  **zero chord conflicts by construction**. That absence is the design, not a gap: the palette is the
  single discovery surface and every feature is reachable from it without a mouse.
- **AX tree:** the captured 444-node tree contains the extension's status bar item as **exactly one
  focusable `button`** whose accessible name comes from an explicit `aria-label`
  (`check  Xessa, Compiled … → 3 artifact(s).`), the transient `setStatusBarMessage` text, an `alert`
  live region carrying the failure toast, and **0 of 40 interactive nodes without an accessible name**.
  No Xessa-named node is `ignored`.
- **Hover Markdown:** 8 hover shapes from the U1 fixture set are plain text + bold + code spans, with
  **0 links, 0 bare URLs, 0 images, 0 raw HTML**, no headings/tables/blockquotes and no
  `isTrusted` content. One shape (the `@md` alias) is a plain expression with no bold title — recorded,
  not a defect.
- **Severity:** every committed fixture is enumerated (13 documents, one global sweep): **Error=6**,
  zero Warning, zero Information, zero Hint. The five curated rejection fixtures are Errors per code
  (`XESSA1001/1002/1003/2001/3001`), which `diagnostics.js` already pins with exact spans; the only
  warning-severity product path (`XESSA4001`/`XESSA5001`, output planner) is source-pinned and was
  **not reachable from a fixture** — three probe documents produced no diagnostic at all (measured, see
  *Unverified*).
- **Icons:** both theme variants exist, are declared in the language contribution, are 32×32 SVGs with
  inverted glyph colours (`#000000` on light, `#ffffff` on dark) and carry `role`/`aria-label`.
  **Rendered contrast is unavailable** — the vision pass had no image input in this environment; that
  is recorded here and in the summary line, never claimed.
- **No new defect was found in any of the six properties.** The five pinned UI defects from U1–U5 are
  minted as tasks by U7; two accessibility observations are routed as accepted limits (below).

## Changed paths

| Path | Change |
|---|---|
| `packages/vscode/test/ui/accessibility.js` | **new** — the six properties, 196 assertions |
| `packages/vscode/test/suite.js` | `"accessibility"` added between `config` and `performance` |
| `.ai/reports/CSSX-U6.md` | this report |

No fixture was added: the module reads the committed fixtures and the U3 capture directory, and writes
nothing anywhere (no temp workspace, no settings change, no editor content change).

## Checklist — per-item findings

### 1 · Keyboard / palette reachability — **PASS**

| Check | Method | Result |
|---|---|---|
| All 6 command ids resolvable | `vscode.commands.getCommands(false)` (the lookup the palette itself performs) | 6/6 present |
| Documented in the manifest `commands` section | `contributes.commands` entry per id | 6/6 with `title` + `category: "Xessa"` |
| Rendered palette label readable | `"<category>: <title>"` composition, both halves non-empty | 6/6 unique titles, all announce as `Xessa: …` |
| No silent dead entry | `enablement` absent on every entry | 6/6 `undefined` |
| Status bar entry mouse-free | `controller.ts:103` sets `command = xessa.buildProject`; the target is registered | present, so the click target is itself a palette command |
| Menus absent | `contributes.menus === undefined` | nothing is mouse-only |

Cross-reference (deliberately not repeated): `commands-matrix.js` pins the exact titles, side effects and
no-editor/error cells; this module asserts only the *keyboard* property.

### 2 · Keybinding conflicts — **PASS (by construction, recorded)**

- `manifest.contributes.keybindings === undefined`; the full contribution key set is exactly
  `commands, configuration, grammars, languages` (deep-equal assertion, so a new section — keybindings,
  menus, iconThemes, walkthroughs — fails the module).
- **Zero declared chords ⇒ zero shadowing of a core binding is possible.** `vscode` exposes no API to
  enumerate the platform keymap, so "we declare nothing" is the strongest honest form of the check; it
  is recorded as the design (U0 row 6) rather than a gap.
- The only chord mentioned in the product is `⌥⇧F` in the `xessa.editor.formatOnSave` description — that
  is **core VS Code's** Format Document binding, not a Xessa contribution.

### 3 · Roles / labels of contributed UI — **PASS**

Input: `.ai/reports/logs/ui-screens/ax-tree.json` (U3's `Accessibility.getFullAXTree`, VS Code 1.147.0,
**444 nodes**). Assertions and the numbers they were measured against:

| Surface | AX evidence | Assertion |
|---|---|---|
| Status bar item (U0 row 12) | node `1201`, role `button`, name `check  Xessa, Compiled … → 3 artifact(s).`, source `aria-label`, `focusable: true` | exactly one such button exists; name carries the state word **and** the tooltip outcome; comes from `aria-label`; does **not** expose the raw codicon glyph (`\ueab2`) |
| Transient status-bar message | node `1195`, role `button`, `Xessa: wrote 3 artifact(s) for clean.cssx` | full text preserved |
| Failure toast (U0 row 24) | node `1625` `StaticText` `Error: Xessa: 5 entries failed. See the Xessa output channel.` inside `alert` live regions (`1236`, `1237`) | ≥1 `alert` exists; the toast text is exposed and names where to look |
| Everything Xessa-named | 14 nodes (`button`/`generic`/`StaticText`/`InlineTextBox`) | none is `ignored` |
| Anonymous interaction | 40 interactive nodes (31 buttons, tabs, textbox) | **0** without an accessible name |
| Output channel (U0 row 13) | the channel lines are not in this snapshot (it was taken in the grammar state, panel closed); U3's per-screen record has `lines: 15`, `hasWroteLine: true`, `hasTimestamp: true` and a text sample | asserted from `ui-screens/manifest.json`: ≥10 lines, `wrote …` present, ISO timestamp present |

`ax-tree.json` is read as data (`readFileSync`) and is **optional**: if the capture is absent the module
prints `AX tree unavailable: …` and skips those assertions instead of passing them. The file is on disk
for this delivery, so they ran.

### 4 · Screen-reader readability of hover content — **PASS**

8 hover shapes driven on `ui/clean.cssx` (`$brand`, `$theme`, `padding` property, `calc()`, `@md`,
`.card`, `@keyframes spin`, `@group.card-base`) — the same document set as `hovers.js`:

| Property | Result |
|---|---|
| Links | 0 (acceptance allows ≤1 *labelled* link) |
| Images `![…]` | 0 |
| Bare URLs `https?://` | 0 |
| Raw HTML (`<tag …>`) | 0 |
| Headings / blockquotes / tables | 0 |
| Bold title | 7/8 shapes; the `@md` alias card is a plain expression (`@md` → `(min-width: 768px) (builtin)`) — recorded, not a defect |
| Code span for the value | 7/8 (every value/symbol/class-bearing card); the `padding` property doc is prose only |
| `MarkdownString.isTrusted` | `false` on every card (no command links) |

### 5 · Diagnostic severity appropriateness — **PASS**

| Item | Value |
|---|---|
| Fixtures enumerated | 13 (11 under `test/fixtures/ui/`, plus `broken.cssx` and `complete.cssx`) |
| Severity histogram | `Error=6` — **no Warning, no Information, no Hint** |
| Publishing fixtures | `broken.cssx:1`, `ui/broken-alias.cssx:1`, `ui/broken-semicolon.cssx:1`, `ui/broken-setup.cssx:1`, `ui/broken-syntax.cssx:1`, `ui/broken-token.cssx:1` |
| Curated codes measured as Error | `XESSA1001`, `XESSA1002`, `XESSA1003`, `XESSA2001`, `XESSA3001` (asserted by set membership, spans/severity already pinned in `diagnostics.js`) |
| Severity map in the product | `adapter.ts:47-49` maps `error → Error` and everything else → `Warning`; there is **no `Information` or `Hint` path at all**, so an Information-level diagnostic is impossible by construction, and the sweep confirms it empirically |

Judgement per family (the plan's "a level that misleads becomes a task"): every curated code is a
**rejection** — the compiler does not emit the affected construct — so `Error` is correct, including
`XESSA1002` (missing semicolon), which is a deliberate ADR-0011 decision: confirmed here, not "fixed".
The warning-severity codes `XESSA4001` (class maps to a reserved/invalid JS identifier; the key stays in
the default map) and `XESSA5001` (types suppressed because `emit-map: false`) still produce output, which
is exactly the documented warning contract — **no task**.

### 6 · Icon visibility — **PASS for presence/design; contrast unavailable**

| Check | Result |
|---|---|
| Declared | `contributes.languages[0].icon.light = ./media/file-icon.svg`, `.dark = ./media/file-icon-dark.svg` |
| Present | both files exist under the extension directory, non-empty, `viewBox="0 0 32 32"` |
| Theme pairing | light glyph `#000000` on transparent (no white fill), dark glyph `#ffffff` (no black fill); the two files differ |
| Icon metadata | both carry `role="img"` + `aria-label="Xessa source file"` (inert for VS Code's per-language icon rendering, but correct if the SVG is ever inlined) |
| Not an icon theme | `contributes.iconThemes === undefined` — the light/dark pair is the only mechanism available |
| Rendered contrast | **unavailable** — no image input in the vision pass; U3's Explorer screens do not include a file-icon crop either (recorded in `CSSX-U3.md` as deliberately not attempted) |

## Recorded limits (routed to U7, not defects in this extension)

1. **Editor text is not exposed to the AX tree unless screen-reader optimized mode is on.** Node `202`
   is a `textbox` named *"The editor is not accessible at this time. To enable screen reader optimized
   mode, use Shift+Option+F1"*. This is core VS Code / Monaco behaviour, not a Xessa contribution; no
   task. It is the reason the plan asks for the *contributed* surfaces, not the editor buffer.
2. **The status bar accessible name embeds an absolute path** (`check  Xessa, Compiled
   /private/var/…/clean.cssx → 3 artifact(s).`). The tooltip is the accessible name, so a screen reader
   announces a long temp path after every build. The extension cannot shorten what VS Code composes from
   `tooltip`, and the path is genuinely useful on hover; recorded as an accepted limit for
   `docs/known-limitations.md` via U7 rather than minted as a defect.
3. **Two `alert` live regions have empty accessible names** — correct for ARIA containers whose text
   children carry the message (asserted: the toast text itself is present).
4. **`complete.cssx` publishes zero diagnostics** although it ends in a dangling `@` (`color: red @`).
   That fixture exists to drive `@` completion (its `@2xl` case is in `baseline.js`); a dangling at-marker
   producing no diagnostic is a compiler-tolerance question, outside the U6 checklist, and is recorded
   here so the lead can decide whether it deserves a task in the TT family.

## Unverified (recorded, never claimed as passed)

| Item | Why |
|---|---|
| Visual contrast of suggest/hover/status text against the theme background | needs an image; the vision pass had no image input in this environment |
| File-icon appearance in the Explorer (light + dark) | U3 deliberately did not capture the Explorer; no crop exists |
| Warning-severity diagnostics in the editor | probed three documents for the warning paths (invalid prefix `2x`, `emit-map: false`, class `.delete`) through the pure `analyzeText` layer: **zero problems** in all three, so no fixture reaches `XESSA4001`/`XESSA5001` in the editor; the mapping is source-pinned (`adapter.ts:47-49`) and unit-tested in `tests/extension/provider.analysis.test.ts:100` |
| Rendered AX tree of the *suggest widget rows* | the 444-node snapshot was taken in the grammar state; the widget's ARIA rows are the Monaco list's, already covered by U3's per-screen DOM (`labels`/`kind` icons) — not re-captured here (`.ai/reports/logs/ui-screens/**` is outside this phase's write set) |

## Commands and results

| Command | Result |
|---|---|
| `bun test tests/extension/host.test.ts` (run 1) | green — `13 scenarios, 802 assertions` `[… accessibility=196 …]`, `2 pass / 0 fail`, 30.7 s |
| `bun test tests/extension/host.test.ts` (run 2, immediately after) | **identical** — `13 scenarios, 802 assertions`, `2 pass / 0 fail`, 30.7 s |
| `bunx biome check --write packages/vscode/test/ui/accessibility.js packages/vscode/test/suite.js` | green (formatting + 2 unsafe-chain suggestions applied) |
| `bun run verify` / `bun run lint` | run by U7 on the final tree (recorded in `CSSX-U7.md`) |

Accessibility scenario output:

```
[xessa a11y] severity sweep: Error=6 across broken.cssx:1 ui/broken-alias.cssx:1 ui/broken-semicolon.cssx:1 ui/broken-setup.cssx:1 ui/broken-syntax.cssx:1 ui/broken-token.cssx:1
[xessa a11y] colour contrast: unavailable (no image input in the vision pass; U3 PNGs on disk)
[xessa host] accessibility: 6 a11y properties: palette (6 commands, 0 chords), 444 AX nodes, hover (8 shapes), severity (Error=6), icons light+dark, output channel readable (196 assertions, 236 ms)
```

## Determinism notes (measured traps)

- **Order independence is not free.** A later-scenario re-open of a fixture that a previous scenario's
  `workbench.action.closeAllEditors` had closed may resolve to a document that is closed again by a
  leftover editor restore (`document.isClosed === true`), and `onDidOpenTextDocument` then never reaches
  the diagnostics service — the first full-suite run timed out on exactly `ui/broken-setup.cssx`. The
  sweep therefore uses a bounded poll whose predicate **re-opens a closed fixture** instead of waiting
  for a timer; it passes both in isolation (196 assertions) and in the full suite.
- No sleep is used as evidence: every wait is `host.waitFor` on an observable (`getDiagnostics` for the
  curated fixtures). The AX/output-channel halves read the committed capture files synchronously.
- The module mutates nothing: no temp workspace, no settings, no document edits.

## Reproduce

```
bun test tests/extension/host.test.ts          # the accessibility scenario is one of the 13
```

Expected: `[xessa host] accessibility: 6 a11y properties: … (196 assertions, … ms)` and
`passed: 13 scenarios, 802 assertions`.

## Handoff

- Completed: `ui/accessibility.js` (196 assertions), suite registration, green ×2 at 13/802, this report.
- Touched: `packages/vscode/test/ui/accessibility.js`, `packages/vscode/test/suite.js`,
  `.ai/reports/CSSX-U6.md`.
- Remaining for U7: the five U1–U5 defect task specs, the plan flip and closing paragraph, PP3's manual
  residue, `.ai/todo.md`, `.ai/PROGRESS.md`, final gates. No new defect from U6; the four recorded
  limits go to the lead (`docs/known-limitations.md` is outside this campaign's write set).
