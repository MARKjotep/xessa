# Xessa Plan — VS Code UI/UX validation campaign (U0–U7)

**Status:** complete 🟢 — U0–U7 executed, reported and verified (campaign closed 2026-11-26).
Created against the stress-campaign reports `.ai/reports/CSSX-TT0.md`…`CSSX-TT6.md` and the
editor-intelligence handover `.ai/HANDOVER.md` (both 2026-11-26), which record the verified baseline
`bun run verify` 892 pass / 0 fail across 45 files, `tests/extension/` 192 pass / 0 fail across 10
files, and a cached VS Code **1.147.0** test build with `@vscode/test-electron` **2.5.2**.

This is the **user-facing experience layer**. The sibling campaign
`.ai/plans/CSSX-PLAN-TESTING.md` (TT0–TT8) owns everything that can be proven without a VS Code
host: the pure analysis/intelligence layer, the compiler and CLI, latency at 10 000 lines, the
keystroke storm, filesystem and consumer matrices. Its §TT6 explicitly defers the host half — the
suggest widget, the native colour picker, real activation, rendered diagnostics — and its own row
says the in-extension-host harness (`packages/vscode/test/suite.js`) was **not** modified by that
phase. This plan owns that deferred half: everything that needs the real workbench, the real
renderer, or the rendered result of a provider call.

The gap is concrete. The extension contributes 6 commands, 4 settings, 1 language, 1 grammar, a
file-icon pair, a status bar item, an output channel, a virtual-document scheme, 9 language
providers and 4 trust-dependent write paths (verified in `packages/vscode/package.json` and
`packages/vscode/src/controller.ts`). The host suite that exists today
(`packages/vscode/test/suite.js`) asserts activation, the grammar scope name, manifest settings
defaults, that the 6 command ids are registered, one completion label (`@2xl`), that a broken
fixture publishes `XESSA…` error diagnostics, that Compile File writes CSS + class map, that Preview
Compiled CSS opens a `xessa-preview:` document, and the format/format-on-save behaviour. It asserts
**nothing** about completion kinds, snippets, filter text or ranges, hover cards, colour swatches,
quick fixes, outline, navigation, the status bar, the output channel, Restricted Mode, multi-root
scoping or the rendered appearance of any of it. That is the surface this plan closes.

Ownership: every phase is executed by `code` with lead verification of the recorded results; no phase
is closed from an agent claim alone. Visual inspection (U3, U6) is routed through the `vision`
specialist, whose findings `code` persists.

**Campaign closed 2026-11-26.** All eight phases are executed, reported and verified on this tree: the
in-host suite is **13 scenarios / 802 assertions**, green twice consecutively with identical output
(was 31 assertion call sites before the campaign), `bun run verify` and `bun run lint` are green, and
every phase has a report with the commands it ran (`.ai/reports/CSSX-U0.md` … `CSSX-U6.md`) plus this
close-out recorded in `.ai/todo.md` items 18–23, the §U0 table and
`.ai/PROGRESS.md` P10 rows. **Visual inspection is recorded as unavailable**, not passed: the vision
pass had no image input in this environment, so the rendered evidence stays on disk —
**16 PNGs plus the 444-node accessibility tree** and the per-screen capture manifest in
`.ai/reports/logs/ui-screens/` (untracked report logs, reproducible with
`bun packages/vscode/test/ui/capture.js --all --out .ai/reports/logs/ui-screens`) — and the reports
carry the agent-read findings with that provenance stated. Six UI defects were minted as task specs
(`CSSX-U01` sigil drop, `CSSX-U02` `&&:hover`, `CSSX-U03` `&.` starters, `CSSX-U04` rename onto an
existing name, `CSSX-U05` `@group` token hover/definition, `CSSX-U06` dead-document preview); all six
are open and each owns the removal of its host pin. **PP3's manual smoke checklist is reduced to exactly
one row** — the native colour-picker click interaction, which no `vscode` API can perform — because
`packages/vscode/test/ui/checklist.js` automates the other 7 of `.ai/HANDOVER.md`'s 7 items.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| U0 · UI surface inventory | Every user-visible element listed with its source of truth, its rendered surface, its host coverage today and its owning phase (draft table below, re-verified at execution) | Every row names a file:line or manifest key and an owning phase; every element the extension contributes appears exactly once; the "no host assertion today" set is explicit | 🟢 |
| U1 · Host harness upgrade | `packages/vscode/test/suite.js` split into a runner plus `packages/vscode/test/ui/**` modules driving providers through the public `vscode` API, with additive fixtures | The upgraded suite runs green and deterministic in the real host; assertions cover kinds/details/filter text/ranges, hover Markdown, diagnostic codes/spans/severity, DocumentColor ranges, command side effects, config toggles | 🟢 |
| U2 · 7-item checklist automated | `packages/vscode/test/ui/checklist.js` encoding `.ai/HANDOVER.md`'s manual smoke checklist | Each of the 7 rows is automated, API-pinned (returned item body pinned where acceptance cannot be replayed) or recorded manual with the exact reason — no row left as "looked fine once" | 🟢 |
| U3 · Rendered-UI inspection | CDP driver + screenshot set of the suggest widget per trigger context, hover cards, squiggles, status bar, command results, token colours | Screenshots captured and inspected by `vision`; findings recorded per screen; anything un-capturable recorded with the reason and the fallback used | 🟢 |
| U4 · Commands, settings, workspace matrix | Per-command × per-workspace-state matrix, per-setting toggle evidence, multi-root scoping evidence | Every command row has host evidence for palette presence, trusted run, Restricted Mode, no-editor-invocation and error surfacing; every setting flips an observable behaviour | 🟢 |
| U5 · Performance in host | Latency/memory table measured through the real host pipeline on the 10k-line document, compared against the TT6 pure-layer numbers | Recorded table with machine context; every regression against the TT6 pure-layer figures is either explained by the host overhead or raised as a finding | 🟢 |
| U6 · Accessibility | Keyboard/palette reachability, keybinding-conflict check, AX roles/labels of contributed UI, icon visibility in light+dark, severity appropriateness, screen-reader-readable hover | Checklist with per-item findings; a defect becomes a task, an accepted limit is recorded in `docs/known-limitations.md` via U7 | 🟢 |
| U7 · Reports and routing | `.ai/reports/CSSX-U0.md`…`CSSX-U7.md`, task prompts for real defects, framework bug records for host/tool defects, `.ai/todo.md` + `.ai/PROGRESS.md` entries, cross-links to TT8 and PP3 | Every phase has a report with the actual commands and outputs; no defect lives only in prose; PP3's manual checklist is reduced to exactly what U2 could not automate | 🟢 |

## Ground rules for the campaign

- **Failing repro test first.** A UI defect lands as a host assertion of the correct behaviour (red),
  then a separate task prompt owns the fix, then U7 re-runs the suite. Providers and
  commands are never adjusted to make a new case pass inside this campaign (see *Ownership*).
- **No assertion weakening.** `packages/vscode/test/suite.js` keeps every assertion it has today; new
  cases are additive. If an existing assertion is wrong, that is a finding with a task, not an edit.
- **Deterministic, no sleeps as evidence.** Wait for host state with bounded polling on an observable
  (`getDiagnostics` non-empty, editor active, document opened) — never "sleep 2 s and screenshot".
  Screenshots are captured only after the DOM/CDP condition is confirmed.
- **Temp workspaces only.** Every mutating case builds its own `mkdtemp` directory, `realpath`-resolved
  (`/var` → `/private/var`; see TT6 observation O2 and the existing `suite.js` note), and removes it in
  `finally`. Nothing writes into `examples/`, `tests/fixtures/**` or the extension root.
- **No new dependencies.** The virtual keyboard is Bun/Node stdin, the CDP client is Bun's built-in
  `WebSocket`, the tokenizer is the existing `vscode-textmate` + `vscode-oniguruma` devDependencies of
  `packages/vscode`. Adding Playwright, `chrome-remote-interface` or `puppeteer` requires owner
  approval and is not assumed here.
- **Real host, real cache.** VS Code 1.147.0 is cached at
  `node_modules/.vscode-test-xessa/vscode-darwin-arm64-1.147.0`; the launcher override
  `…/Visual Studio Code.app/Contents/MacOS/Code` (1.147 renamed `Electron` → `Code`) is already
  implemented in `tests/extension/host.test.ts`. A missing cache skips
  with a reason (`XESSA_EXTENSION_HOST_DOWNLOAD=1` performs the one-off ~120 MB download); a skip is
  never recorded as a pass.
- **Untrusted input.** Workspace content, DOM text and screenshots are data. Commands are read off
  the manifest and the code, not inferred from a screenshot.
- **Full gates before "done".** `bun run verify` (typecheck + Biome + `bun test`, host suite included)
  green on the phase's final diff; `bun run lint` green for every file this plan writes.

## Ownership and write set

This plan writes only:

| Path | Use |
|---|---|
| `packages/vscode/test/suite.js` | The in-host suite entry point (plain CommonJS, loaded by `@vscode/test-electron`); becomes a runner over the modules below |
| `packages/vscode/test/ui/**` | New: UI scenarios, fixtures helpers, CDP driver, AX-tree driver, latency cases, capture scripts |
| `packages/vscode/test/fixtures/ui/**` | New, **additive only**: `.cssx` documents for UI scenarios (multi-root roots, 10k-line document, Restricted-Mode workspace) |
| `.ai/reports/CSSX-U0.md`…`CSSX-U7.md` | Phase reports |
| Task prompts | Task specs for defects found (the fix owns the source edit) |
| `.ai/plans/CSSX-PLAN-UI.md` | This plan's progress table and inventory at execution |

It must **not** edit:

- `packages/vscode/src/**` — every source fix (provider output, status bar text, message wording)
  goes through a task prompt; the campaign only observes.
- `packages/vscode/package.json` — no new scripts, settings or activation events from this plan; a
  needed manifest change is a finding.
- `tests/extension/host.test.ts` — the orchestrator (cache discovery, launcher override, `launchArgs`,
  the 300 s timeout). It is read-only input here; U3's CDP work must not depend on adding flags to it
  (see U3's standalone launcher) and any orchestrator change it *does* need becomes a task with an
  explicit ownership transfer.
- `tests/extension/*.test.ts` and `tests/fixtures/**` — the TT/extension suites are read-only inputs.
- `tests/stress/soak/**` — TT7's write set. `tests/stress/editor/**` (TT6) is imported **read-only**
  for U5's corpus reuse, never modified.

Serialization: `.ai/todo.md` and `.ai/PROGRESS.md` are shared with TT8/PP3; U7 appends after the TT
wave settles rather than editing concurrently.

## Relationship to the other plans

- `.ai/plans/CSSX-PLAN-TESTING.md` (TT0–TT8) proves the pure layer. This plan starts where TT6's
  "Not observable here" table stops and never re-proves a pure-layer fact — U5 explicitly *compares*
  against TT6's recorded numbers instead of recomputing them.
- **Ordering:** U0 and U1 have no dependency on TT7 (the soak) and may run in parallel with it.
  U2–U6 run after U1. U3/U6 touch the same host build as U5, so they are serialized against each
  other (one VS Code instance at a time; two concurrent launches share `--user-data-dir` state).
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` **PP3** consumes this campaign: its 7-item manual smoke
  checklist shrinks to only the rows U2 could not automate, and PP0's baseline gate runs after U7.
  PP3's "Deferred harness (optional)" row is superseded by U1/U2 and is closed by pointing at U7's
  report — this plan does not edit that plan, the lead does.
- `.ai/HANDOVER.md` "Manual smoke checklist" is the input contract for U2; its "Deferred / out of
  scope" note (A51 adapter behaviour unit-tested only) is exactly the U2/U3 target.

## U0 — UI surface inventory

Deliverable: the inventory below, re-verified by reading the manifest and the controller at
execution time (it is a draft produced from the current tree), plus a per-element gap note stating
whether **any** host-level assertion exists today. `packages/vscode/test/suite.js` is the only host
suite; its present assertions are listed in the fourth column.

### Contributed surface

| # | Element | Source of truth | Rendered surface | Host assertion today | Owner |
|---|---|---|---|---|---|
| 1 | Language `xessa` (aliases `Xessa`, extension `.cssx`) | `package.json:34-44` | Editor language, language-mode picker, `.cssx` association | `ui/baseline.js` asserts `document.languageId === "xessa"` | U1 |
| 2 | File icon light + dark | `package.json:40-41`, `media/file-icon.svg` + `media/file-icon-dark.svg` | Explorer icon for `.cssx` files (per-language icon, **not** an `iconThemes` contribution — the manifest contributes none) | none | U6 |
| 3 | Language configuration | `package.json:43`, `language-configuration.json` (line/block comment, brackets, auto-closing + surrounding pairs, indentation rules, `wordPattern`) | Typing behaviour: `//`/`/* */`, auto-close, indent, word-wise motion | none | U1 (comment/indent behaviour via edits), U6 |
| 4 | Grammar `source.xessa` | `package.json:46-51`, `syntaxes/xessa.tmLanguage.json` | Token colours in the editor | manifest scope name only; scope **assignment** is covered outside the host by `tests/extension/grammar.scopes.test.ts` (15 tests, `vscode-textmate` + `vscode-oniguruma`) | U3 (theme colour rendering) |
| 5 | Six commands, category `Xessa` | `package.json:53-63`, ids in `controller.ts:44-51` | Command Palette entries, status bar click | `ui/baseline.js` asserts all 6 ids are registered; `ui/commands.js` asserts their side effects | U4 |
| 6 | Keybindings | **none contributed** (`package.json` has no `keybindings` section) | No default chords; palette only | none (nothing to assert beyond "none declared") | U6 |
| 7 | Menus | **none contributed** (no `menus` section: no editor/context or explorer/context entries) | Nothing outside the palette | none | U4 (records the absence as the design) |
| 8 | Setting `xessa.compileOnSave` (bool, default `false`) | `package.json:68-72`, read at `controller.ts:247-250` | Save-time build; skipped in Restricted Mode with an output-channel line | none (U1 did not add a case) | U4 |
| 9 | Setting `xessa.editor.formatOnSave` (bool, default `false`) | `package.json:73-77`, read at `controller.ts:228-232` | Save-time formatting | `ui/baseline.js` asserts default `false`, off → untouched save, on → formatted save, parse error untouched | U4 |
| 10 | Setting `xessa.editor.completePropertyWithSemicolon` (bool, default `true`) | `package.json:78-82`, read at `providers/completion.ts:32-34` (35-40 is the `completionsAt` call) | Snippet body of property completions | `ui/completions.js` asserts snippet `color: $0;` on and `color: ` off (restored in `finally`) | U2 row 4 |
| 11 | Setting `xessa.previewSplitEditor` (bool, default `true`) | `package.json:83-87`, read at `controller.ts:413-415` | Preview opens beside vs replacing | none (the preview cases run with the default) | U4 |
| 12 | Status bar item | `controller.ts:101-103` (`createStatusBarItem(Right, 100)` 101, `name` 102, `command = xessa.buildProject` 103), `controller.ts:565-581` | Text `$(symbol-color) Xessa` / `$(check) Xessa` / `$(error) Xessa` / `$(warning) Xessa (stale)` + tooltip | none — and **not readable via the public API** (a `StatusBarItem` is write-only); observable only through CDP (U3) or manually | U3, U4 |
| 13 | Output channel `Xessa` | `controller.ts:100`, `controller.ts:583-585` | Output panel lines (build summary, `wrote …`, config warnings, Restricted-Mode skip, failures) | none — channel content is not readable via the public API | U3, U4 |
| 14 | Preview virtual documents (`xessa-preview:`) | `controller.ts:53`, `61-92` (provider), `397-422` (`previewCss`) | Read-only editor tab, language forced to `css` | `ui/baseline.js` asserts scheme + compiled CSS present; `ui/commands.js` asserts preview writes nothing to disk | U1 (also split-on/off) |
| 15 | Diagnostics | `providers/diagnostics.ts`, `adapter.ts:43-54` (`toEditorDiagnostic`: severity ternary 47-49, `code` 51, `source = "xessa"` 52), codes `XESSA1001/1002/1003/2001/3001/4001/5001` | Squiggles, Problems panel, code badge | `ui/baseline.js` asserts non-empty + a `XESSA` prefix + ≥1 Error; `ui/diagnostics.js` asserts code, `source`, severity and the exact span for `XESSA1001/1002/1003/2001/3001` and that a clean document stays clean | U1 (spans, codes, severity per case) |
| 16 | Quick fix `XESSA1002` | `quickfixes.ts:27`, `providers/code-actions.ts` | Lightbulb / quick-fix menu, `isPreferred` | `ui/quickfix.js` asserts kind `quickfix`, title `Add semicolon`, `isPreferred`, the single `;` insertion, its application and the diagnostic clearing | U1 |
| 17 | Hover cards | `providers/hover.ts`, `intelligence.ts:2926` (`hoverAt`) (tokens, aliases, properties, functions, groups, keyframes, classes) | Markdown hover popup | `ui/hovers.js` asserts the `MarkdownString` shape, the value text and the range for 9 shapes, plus 2 negative positions | U1, U3 |
| 18 | Completion (suggest widget) | `providers/completion.ts`, `controller.ts:119-130` triggers `@ $ . : / & ( #` | Suggest list: label, kind, detail, documentation, `filterText`, per-item range | `ui/baseline.js` asserts `@2xl` exists in the `@` list; `ui/completions.js` drives 21 states (kinds, details, filterText, ranges, acceptance) | U1, U2, U3 |
| 19 | Colour decorations + picker | `providers/color.ts`, `intelligence.ts:3180` (`rgbaToHex`), `:3226` (`colorsAt`); `colorsOf` 3190 | Inline swatch squares, native picker on click | `ui/colors.js` asserts the 6 swatch ranges/values incl. `#2563eb80` alpha 0.502, 5 A51 negatives and the lowercase-hex presentations; the picker **click** stays manual | U2 row 7, U3 |
| 20 | Outline / document symbols | `providers/symbols.ts:11-33` (Namespace/Module/Variable/EnumMember/Interface/Class/Property, plus `Object` as the fallback that native at-rules such as `@keyframes` report) | Outline view, breadcrumbs | none (U1's assigned module list omitted `symbols.js`) | U1, U2 |
| 21 | Navigation | `providers/navigation.ts` (definition, references, rename incl. multi-file group/keyframe edits) | Go-to-definition, Find All References, Rename | `ui/navigation.js` asserts cross-file definition, 3 references, `prepareRename`, 2 refusal paths, an applied token rename and a 3-edit/2-file group rename | U1 |
| 22 | Formatting | `providers/formatting.ts`, `controller.ts:155-157` | ⌥⇧F / Format Document | `ui/baseline.js` drives the provider + applies the edit (manual and save paths) | U1 (idempotence in host) |
| 23 | Restricted Mode / trust messaging | `controller.ts:249-252` (compile-on-save skip, log at 250), `347-350` (write refusal throw), `387-390` (compile warning), `455-458` (build warning) | Warning/information notifications, status bar error state | none | U4 |
| 24 | Notifications (`showInformationMessage`/`Warning`/`Error`, `setStatusBarMessage`) | `controller.ts:263,271,387,402,428,434,449,455,479,499,505,513,531,544` | Toast messages | none — toast content is not readable via the public API | U3, U4 (route through side effects + CDP) |

### Suggest-widget inventory per trigger context (the U2 subject)

Trigger characters are registered at `controller.ts:119-130` and documented at
`intelligence.ts:2470-2482`: `@`, `$`, `.`, `:`, `/`, `&`, `(`, `#`; property, value and selector
contexts also complete without a trigger. Counts below are the frozen data lengths in
`intelligence.ts` (verified by counting the literals: 148 named colours `:351`, 35 hex `:689`, 27
units `:876`, 25 functions `:1018`) and the recorded behaviour in `.ai/reports/CSSX-A51.md`.

| Context | Items | `kind` → `CompletionItemKind` | `detail` | `filterText` / range |
|---|---|---|---|---|
| `@` (directive) | directives + aliases + `@group` | `directive` → Keyword, `alias` → EnumMember | `Xessa directive` | label; replaces `@word` |
| `$` (token) | compile/runtime tokens, `$keyframes.` | `token` → Variable, `runtime-token` → Constant, `member` → Field | token kind text | label |
| `.` (selector/member) | classes, group/keyframe members | `selector` → Class, `member` → Field | `generated class …` | label |
| `:` (pseudo) | 19 `PSEUDOS` entries | `pseudo` → Method | pseudo detail | label |
| `/` (import path) | directory names | `import-path` → File | path detail | label |
| `&` | nested-selector starters | `selector` → Class, `pseudo` → Method | selector detail | only the pseudo state repairs the typed `:`; the `&` starters replace an **empty range at the caret**, so accepting `&:hover` after `&` yields `&&:hover` (pinned defect, `ui/completions.js`) |
| `(` | 25 functions **only** | `value` → Value | `CSS function` | `filterText = "(" + name`, range covers the typed `(` |
| `#` | 35 hex + matching names (183 in an empty-word colour state) | `color` → **Color** | `CSS color` (named) / `CSS color #rrggbb` (hex, the entry's own value) | `filterText = "#…"`, range covers the typed `#…`; verified in `ui/completions.js` |
| value word (no trigger) | keywords + property values; colour properties add 148 names + 35 hex — measured 236 = 148 named + 35 hex + 28 keywords + 25 functions, and `width: ` = 53 (28 + 25), A51 | `value` → Value, `color` → **Color** | `CSS value` / `CSS color` / `CSS color #rrggbb` / `CSS unit` | label; units use a suffix range after the digits |
| property | CSS property list | `property` → Property | property doc summary | label; snippet `property: $0;` when the setting is on |
| `@setup` key / value | setup keys / values | `setup-key` → Property, `setup-value` → Value | setup detail | label |
| `@group.` / `@keyframes` | group names / keyframe names | `group` → Module, `keyword` kinds | group/keyframe detail | label |

### Gap notes (to be re-verified at execution)

1. **No host assertion exists** for rows 2, 3, 6, 7, 8, 10, 11, 12, 13, 16, 17, 19, 20, 21, 23, 24 —
   half the contributed surface.
2. Rows 12, 13 and 24 are **not readable through the `vscode` API at all** (write-only status bar
   item, unreadable output channel, unreadable notifications). Their only evidence is CDP/DOM (U3)
   or a manual step; this is recorded here so nobody writes a fake assertion against a stub.
3. Row 4's scope *assignment* is already proven outside the host (`grammar.scopes.test.ts`); only the
   theme-rendered colours and contrast are open, which is a screenshot (U3) or manual question.
4. Row 18's trigger list is asserted nowhere in the host; a mis-registration of a trigger character
   would be invisible to every current suite.

### Re-verified at execution (U1 landed)

- Rows 5, 9, 10, 14, 15, 16, 17, 18, 19, 21 and 22 now have host assertions in
  `packages/vscode/test/ui/{baseline,completions,hovers,diagnostics,colors,commands,navigation,quickfix}.js`
  (320 assertions measured; see `.ai/reports/CSSX-U1.md`).
- Still without a host assertion after U1: rows **2, 3, 6, 7, 8, 11, 12, 13, 20, 23, 24** — rows 12,
  13 and 24 for the API reason in note 2, rows 2 and 6 for U6, rows 8/11/23 for U4, row 20 and the
  host half of row 4 because U1's assigned module list omitted `symbols.js`, `config.js` and
  `grammar.js` (deviation recorded in `CSSX-U1.md`).
- Measured behaviour that contradicts this table: the `$`-context import namespace drops the `$` sigil
  (accepting it writes `theme.`), the `&` starters double the ampersand, `prepareRename` prefills the
  reference text incl. the sigil, and a rename onto an existing name is only diagnosed afterwards.
  All four are pinned with `CSSX-U1` markers in the suite and need tasks; the table rows above were
  corrected where they described the intent rather than the behaviour.
- API limits recorded (never faked): `executeReferenceProvider` takes no `ReferenceContext`;
  `executeCodeActionProvider` does not round-trip the action's `diagnostics`; VS Code drops
  `filterText` from the returned item when it equals the label; other host extensions (Copilot) inject
  their own code actions, so contributions must be selected by exact kind/id.

### Re-verified at execution (U3–U6 landed)

- Rows 2, 6, 7 and 12 have rendered/AX evidence now: the file-icon pair exists with inverted glyph
  colours and the manifest declares no `iconThemes` (U6), no `keybindings` and no `menus` section exists
  (U4/U6), and the status bar item appears in the accessibility tree as **one focusable `button`** whose
  accessible name is its `aria-label`/tooltip (U3 capture, U6 assertions).
- Rows 13 and 24 (output channel, notifications) are readable through the capture, not the API: the
  channel rendered **15 readable lines** with timestamps and full paths, and the failure toast is an
  `alert` live region carrying `Error: Xessa: N entries failed. See the Xessa output channel.`
- The plan's §U4 Restricted-Mode recipe was **inverted** (`--disable-workspace-trust` disables the trust
  feature); the measured recipe is a fresh profile **without** that flag — corrected in
  `.ai/reports/CSSX-U4.md`, deliberately not edited into §U4's prose here.
- Still genuinely manual after U6: the **native colour-picker click** (no API opens it) and **colour
  contrast** (needs an image). Everything else on the contributed surface has a host assertion or a
  captured screen.

Owned scope: this plan file only (the inventory table and its gap notes); the phase reads
`packages/vscode/package.json`, `packages/vscode/src/**`, `packages/vscode/test/suite.js` and
`tests/extension/**` but writes none of them.
Dependencies: none.
Exit criteria: every row above carries an owning phase (U1–U6) and a source-of-truth reference;
the gap list is confirmed by re-reading `suite.js` and, at execution, by `git log`/`grep` for any new
host assertion; counts (148/35/27/25) re-derived from `intelligence.ts` rather than copied.
Validation: `bun run lint`; `grep`-based re-derivation of the item counts; this plan builds only
after the table's owning phases exist.

## U1 — Host harness upgrade

Deliverable: the in-host suite grows from a smoke test into a behavioural suite, still launched
exactly as today.

**Entry point (recorded, because it is not obvious):** there is **no `test` script** in
`packages/vscode/package.json` (only `build`, `watch`, `typecheck`), so `bun run --cwd packages/vscode
test` does not exist. The suite runs as `bun test tests/extension/host.test.ts`, whose orchestrator
rebuilds the bundle (`bun build src/extension.ts` + `scripts/write-entry.mjs` → `out/extension.js`,
the manifest `main`), resolves the cached VS Code build, and calls `runTests({ extensionDevelopmentPath:
packages/vscode, extensionTestsPath: packages/vscode/test/suite.js, launchArgs: [test/fixtures,
--disable-extensions, --skip-welcome, --skip-release-notes, --user-data-dir=…, --extensions-dir=…] })`
with a 300 s timeout. `suite.js` is plain CommonJS loaded by the extension host — no build step, no
TypeScript, and it must stay that way (a `.js` file, `require` only).

| File | Contents |
|---|---|
| `packages/vscode/test/suite.js` | Thin runner: finds + activates the extension, runs the scenario modules below in order, prints one summary line per scenario, fails fast with the scenario name |
| `packages/vscode/test/ui/host.js` | Shared helpers: `openXessa(uri)`, `activeEditor()`, `pollUntil(predicate, timeout)`, `applyCompletionItem(document, item)` (applies the item's own `range` + `insertText`/snippet body as a `WorkspaceEdit` and returns the resulting text), `tempWorkspace()` (`mkdtemp` + `realpath`), `writeFixture()` |
| `packages/vscode/test/ui/completion.js` | `vscode.executeCompletionItemProvider` per trigger context: total count, per-`kind` histogram, `detail`, `documentation` presence, `filterText`, per-item `range` (start offset must cover the typed `(`, `#`, `:`, `.`), `insertText`/snippet body |
| `packages/vscode/test/ui/hover.js` | `vscode.executeHoverProvider` on tokens, aliases, properties, functions, groups, keyframes, classes: at least one `MarkdownString`, the `range` covers the word, and the value text appears |
| `packages/vscode/test/ui/diagnostics.js` | `vscode.languages.getDiagnostics(uri)` for each code family: `code`, `source === "xessa"`, `severity`, and the span (start/end on the expected word) |
| `packages/vscode/test/ui/color.js` | `vscode.executeDocumentColorProvider` (`colorsAt` through VS Code): ranges for named + hex + `#rrggbbaa` alpha, and the presentation via the built-in colour-presentation command (probe: enumerate `vscode.commands.getCommands(true)` and record which `execute*ColorPresentation*` command exists rather than assuming an id) |
| `packages/vscode/test/ui/commands.js` | Each of the 6 commands through `vscode.commands.executeCommand`: side effects (files written by Compile File / Build Project in a temp workspace, `.css`/`.map.js`/`.d.ts` contents, Preview document text, Open Generated CSS/Map opening the generated file, Check Project writing nothing) |
| `packages/vscode/test/ui/config.js` | `workspace.getConfiguration("xessa").update(...)` for each of the 4 settings, assert the observable flip, restore in `finally` (the existing `formatOnSave` case already does this — it must be restored even on failure) |
| `packages/vscode/test/ui/symbols.js` | `vscode.executeDocumentSymbolProvider`: symbol kinds and nesting for a fixture exercising `@setup`, `@use`, `@variables`, `@runtime`, `@media-types`, `@group`, rules, declarations |
| `packages/vscode/test/ui/navigation.js` | `executeDefinitionProvider`, `executeReferenceProvider`, `executeDocumentRenameProvider` (`prepareRename` probe where the command exists), including one multi-file group rename applied through a `WorkspaceEdit` |
| `packages/vscode/test/ui/quickfix.js` | `vscode.executeCodeActionProvider` on a `XESSA1002` document: one `quickfix`, `isPreferred`, edit adds the semicolon, diagnostic association present |
| `packages/vscode/test/ui/grammar.js` | Tokenize the fixture with the existing `vscode-textmate` devDependency inside the host and assert representative scopes (`meta.declaration.xessa`, `support.type.property-name.css`, `variable.other.xessa`, `constant.other.color.rgb-value.hex.css`, `keyword.control.directive.xessa`) — the host path proves the shipped grammar file, not only the repo copy. If the Oniguruma WASM engine cannot load inside the extension host, the case is skipped with that reason (the same rule `tests/extension/grammar.scopes.test.ts` follows) and the scopes stay covered outside the host |
| `packages/vscode/test/fixtures/ui/*.cssx` | Additive fixtures; **existing** `broken.cssx` / `complete.cssx` are untouched (their fixed `Position(2, 15)` offsets are relied on by today's case) |

Owned scope: `packages/vscode/test/suite.js`, `packages/vscode/test/ui/**`, additive
`packages/vscode/test/fixtures/ui/**`. Not `tests/extension/host.test.ts` (read-only), not the two
existing `packages/vscode/test/fixtures/*.cssx` files.

Constraints:

- Assertions are on **provider results and their application**, not on source text. The one exception
  is the grammar file, which is data.
- Every scenario cleans up (close editors, reset config, remove its temp dir) so scenarios stay
  order-independent.
- A scenario that cannot be expressed through the public API (status bar text, output channel lines,
  toast text, widget rendering, colour picker) is **not** faked here: it is listed for U3/U4 with the
  reason.

Dependencies: none for the scaffolding; U0 for the element list.
Exit criteria: `bun test tests/extension/host.test.ts` green from a cold cache-less state (skip with
reason) **and** with the cached 1.147.0 build (real run), twice in a row with identical output; every
U0 row marked U1 has an assertion; no assertion copied from a unit suite as a stand-in for host
behaviour.
Validation: `bun test tests/extension/host.test.ts`; `bun test tests/extension/` (192/10 must stay
unchanged); `bun run lint`.

## U2 — Trigger-context UX scenarios (the 7-item checklist, automated)

Deliverable: `.ai/HANDOVER.md`'s manual smoke checklist encoded as host assertions. Every row's
disposition is one of **automated** (the API reproduces the user action), **API-pinned** (the API
exposes the returned item but not the acceptance, so the exact item body — snippet text, range,
filter text — is pinned and the visual acceptance is manual), or **manual** with the exact reason.

| # | Checklist row | Drive | Assertions |
|---|---|---|---|
| 1 | `color: ` → 148 names + 35 hex, kind Color; `width: ` → neither | `executeCompletionItemProvider` at the position after `color: ` / `width: ` | 183 items with `kind === CompletionItemKind.Color` (148 `detail === "CSS color"`, 35 `detail === "CSS color #hex"`), total list ≈ 236 as recorded in A51; `width: ` → **zero** Color items and no hex labels |
| 2 | `color: #f0` narrows; accept replaces `#…` without duplication; `width: #` → nothing | provider at `color: #f0` / `width: #`; acceptance **emulated** by applying the item's own `range` + `insertText` | every returned hex label starts with `#f0`; each item's `range.start` is the `#` offset (so applying it replaces `#f0`, never appends); applying an item yields `color: <value>` with exactly one `#`-free value; `width: #` → 0 items |
| 3 | `width: (` → 25 functions; accept `clamp(` gives `width: clamp(`; `calc(100% - 2` keeps normal values | provider at `width: (` , `width: (cl`, `width: calc(100% - 2` | exactly 25 items, all `detail === "CSS function"`, labels end with `(`; every item's `filterText` is `"(" + name` and its range starts at the typed `(`; applying `clamp(` yields exactly one `(`; inside `calc(` the list is the ordinary value list (no function-only state) |
| 4 | Property accept → `color: ;` cursor before `;` (setting toggle) | provider on `colo`; probe `editor.action.insertSnippet` with the returned snippet body to reproduce the acceptance in a real editor and read `editor.selection.active` | with `xessa.editor.completePropertyWithSemicolon` **on**: `insertText` is a `SnippetString` whose value pins `color: $0;`; **off**: the item's text is `color: ` with no `$0` and no semicolon; if `insertSnippet` cannot be driven from the host, the row is **API-pinned** (snippet body + setting toggle) and the cursor position is recorded manual |
| 5 | `margin: 1` → units; `1r` → `rem`; digits never deleted | provider at `margin: 1` / `margin: 1r` / `margin: .5` / `margin: 1%` | 27 `detail === "CSS unit"` items for `1`; `1r` → `rem` only; every unit item's range starts **after** the digits; applying yields `1rem` with the digits intact (no `remrem`, no deleted digit); `1%` offers no units (authored `%` kept) |
| 6 | `&:` + accept → `&:hover`; `&.` keeps the dot; property completion works above an `&` line | provider at `&:`, `&.`, and on the property line above a `&`-line; apply the item range | pseudo items' ranges cover the typed `:` so applying `:hover` yields exactly `&:hover`; class items' ranges leave the typed `.` so applying `test > a` yields `&.test > a`; the property list above `&` is non-empty and applying a property yields `prop: …` on the correct line |
| 7 | Named/hex values show clickable swatches; picker writes lowercase hex | `executeDocumentColorProvider`; presentation via the built-in colour-presentation command if one exists | swatch ranges for `color: Red`, `#fff`, `border-color: navy`, `--brand: #2563eb`, `#2563eb80` (alpha ≈ 0.502) and the negative cases recorded in A51 (`teal` in a shorthand, `black` in a string, `$red`, `url(red.svg)`); presentation label is lowercase `#rrggbb` (alpha only when ≠ 1) and its `textEdit` replaces **exactly** the authored range. The picker **interaction** (clicking the swatch, choosing in the native dialog) is **manual** — no API opens it |

Recorded rule for "manual with reason": the reason must name the missing capability (e.g. "no API can
open the native colour picker; `provideColorPresentations` is drivable, the click is not"), never
"complex".

Owned scope: `packages/vscode/test/ui/checklist.js` (+ fixtures it needs) and
`.ai/reports/CSSX-U2.md`.
Dependencies: U1 helpers.
Exit criteria: each of the 7 rows carries exactly one disposition with evidence in
`.ai/reports/CSSX-U2.md`; the automated/API-pinned rows are assertions in the suite; PP3's checklist is
reduced to the manual residue (recorded in the report, applied to PP3 by the lead).
Validation: `bun test tests/extension/host.test.ts`; `bun test tests/extension/`.

## U3 — Rendered-UI inspection (CDP + screenshots + `vision`)

Deliverable: pictures and DOM evidence of what the user actually sees, for the surfaces no API exposes
(suggest widget rendering, hover popups, squiggle presentation, status bar, output channel, toasts,
token colours).

Technique (documented here, **not** a repo dependency):

1. Launch the cached VS Code binary **directly** with `spawn` — not through
   `tests/extension/host.test.ts` (which stays untouched): `…/Visual Studio Code.app/Contents/MacOS/Code`
   with `--extensionDevelopmentPath=packages/vscode`, `--user-data-dir`/`--extensions-dir` inside
   `node_modules/.vscode-test-xessa/`, `--disable-extensions`, `--remote-debugging-port=<free port>`,
   `--remote-allow-origins=*` (required by current Chromium for non-browser WebSocket clients) and a
   temp workspace folder containing the U3 fixtures.
2. Attach over CDP from a Bun script (`packages/vscode/test/ui/cdp.ts`, Bun's built-in `WebSocket`):
   `GET http://127.0.0.1:<port>/json/list` → the `page` target of the workbench. Drive input with
   `Input.dispatchKeyEvent`/`Input.insertText` (typing is a user gesture, so the suggest widget opens
   exactly as for a human), wait on a DOM condition (`document.querySelector('.suggest-widget')` and
   its `.monaco-list-row` count) instead of a timer.
3. Capture with `Page.captureScreenshot` into a `mkdtemp` directory — **no screenshots committed**;
   the report records the capture command, the fixture, the DOM condition and the findings, so a run
   is reproducible without binaries in git.

| Screen | How it is reached | What `vision` is asked |
|---|---|---|
| Suggest widget · `@` | type `@` in a rule body | layout, truncation, kind icons, documentation panel readable |
| Suggest widget · `$` | type `$` after `@variables {` | sorted list, detail column visible |
| Suggest widget · `(` | type `width: (` | 25 functions visible, no unrelated keywords |
| Suggest widget · `#` | type `color: #f0` | colour swatch squares render per item, labels legible |
| Suggest widget · colour property | type `color: ` | 183 colour items distinguished from keywords (swatch + `CSS color` detail) |
| Suggest widget · `&:` / `&.` | type `&:` then `&.` | the typed punctuation is intact in the list context |
| Hover cards | hover `$token`, a property, `calc` | Markdown formatting, no clipped code spans, no bare links |
| Diagnostics | open `broken.cssx` | squiggle visible on the offending token, Problems panel entry with the `XESSA…` badge |
| Status bar | after a successful `Build Project` and after a failing one | icon (`$(check)`/`$(error)`) visible in light and dark themes, tooltip text |
| Output channel | open the `Xessa` channel after Build/Compile/failure | lines readable, no truncation of paths |
| Grammar colours | representative document (`tests/fixtures/…` or a UI fixture) | token colour distinction and contrast in light **and** dark themes |
| Toast/notification | `Compile File` with no Xessa editor active | message text and severity styling |

Fallback, recorded honestly: if CDP attachment fails in this environment (port blocked, origin
rejection, no window in a headless session), the phase reports **visual inspection unavailable** with
the exact error, keeps the U2 API-level evidence as the substitute, and leaves the corresponding rows
on PP3's manual list. No screenshot is claimed that was not taken.

Owned scope: `packages/vscode/test/ui/cdp.ts` (+ helpers it needs) and `.ai/reports/CSSX-U3.md`;
screenshots are written to a temp directory only — no binaries in the repository.
Dependencies: U1 (fixtures + helpers), U2 (the states being photographed).
Exit criteria: the screen list above has either a capture + recorded `vision` findings or an explicit
unavailable-with-reason entry; every visual defect becomes a task prompt; the report
contains the reproduction command line.
Validation: `bun packages/vscode/test/ui/cdp.ts --capture --screen suggest-hash` (proposed entry
point; the exact flag set is recorded in the report when it is first run); `bun run lint`.

## U4 — Commands, settings and workspace-state matrix

Deliverable: a per-command, per-workspace-state matrix with host evidence, and a per-setting toggle
table.

Commands (`xessa.compileFile`, `xessa.buildProject`, `xessa.previewCompiledCss`,
`xessa.openGeneratedCss`, `xessa.openClassMap`, `xessa.checkProject`; none has a keybinding or menu
entry, so the palette is the only discovery surface):

| State | `compileFile` | `buildProject` | `preview` | `openCss` / `openMap` | `checkProject` |
|---|---|---|---|---|---|
| Trusted, `.cssx` active | writes artifacts + status success | builds every discovered entry | in-memory preview beside the editor (`previewSplitEditor` on/off) | opens the generated file, or an information message when absent (@setup disabled / not built) | checks, writes nothing |
| Trusted, no editor | info message "Open a Xessa (.cssx) document first." | folder-based build | same info message | same | folder-based check |
| No `.cssx` anywhere | n/a | "no .cssx files found" message, status unchanged | n/a | n/a | same as build |
| **Restricted Mode** | warning, **no file written** | warning, no build | preview allowed (nothing written) | messages only | check allowed |
| Parse error in the document | status error, previous outputs untouched, no partial artifacts | counts failures, error toast, summary | no CSS → warning message | messages | failures counted |
| Trusted, multi-root | nearest `xessa.config.json` wins per file | builds the active editor's root, else the first folder | per-file config | per-file config | per-file config |

Evidence rules: file side effects are asserted on disk; a toast/status text that the API cannot read is
either routed through an observable side effect (files, status-driven command result) or listed in U3's
screens. `vscode.workspace.isTrusted` can be *observed*, and Restricted Mode is reproducible by
launching a second instance with `--disable-workspace-trust` — record the launch recipe; if the host
grants trust in this configuration, the row is recorded unverified with the reason (never assumed
blocked).

Settings toggles (each: set → observe → restore):

| Setting | Observable flip |
|---|---|
| `xessa.editor.completePropertyWithSemicolon` | property item snippet body `property: $0;` ↔ `property: ` (already covered by U2 row 4, repeated here as the matrix cell) |
| `xessa.editor.formatOnSave` | save untouched ↔ formatted; parse-error save untouched in both |
| `xessa.compileOnSave` | default `false` → a save writes nothing; `true` → a save writes the planned artifacts (trusted); in Restricted Mode the save is skipped and nothing is written |
| `xessa.previewSplitEditor` | preview beside (2 visible editors) ↔ replacing (1) |

Multi-root: one workspace root containing `xessa.config.json` with a prefix, one plain root — assert
that a document in each root resolves its own config (different prefixes), that `Build Project` from
a document in root A does not write into root B, and that both files publish diagnostics.

Owned scope: `packages/vscode/test/ui/matrix.js`, the multi-root and Restricted-Mode fixtures under
`packages/vscode/test/fixtures/ui/**`, and `.ai/reports/CSSX-U4.md`.
Dependencies: U1.
Exit criteria: no matrix cell is empty — each is evidence, "not reachable, reason", or a task; every
setting has a demonstrated flip and a restored default.
Validation: `bun test tests/extension/host.test.ts`; `bun test tests/extension/`.

## U5 — Performance in the host

Deliverable: latency and memory measured through the real host, compared with TT6's pure-layer
numbers (`.ai/reports/CSSX-TT6.md`: completion p95 **0.4 ms**, hover p95 **6.0 ms**, definition p95
**2.5 ms**, rename p95 **8.5 ms**, references p95 **5.4 ms**, cold `analyzeText` p95 **21.7 ms**,
compile-backed path p95 **173 ms**, 1 000-file index p50 **13.5 ms** / p95 **25.2 ms**, storm 932
keystrokes in **49.7 ms**).

| Case | Method | Recorded |
|---|---|---|
| 10k-line `.cssx` in a real editor | open a generated 10 000-line fixture from `tests/stress/editor/documents.ts` (imported read-only) or a committed additive fixture; time `executeCompletionItemProvider` / `executeHoverProvider` / `executeDefinitionProvider` / `executeDocumentRenameProvider` at N fixed offsets | p50/p95/max per provider, N recorded |
| Typing pipeline | replay a bounded keystroke sequence by applying `TextEditor.edit` insertions one character at a time (`vscode`-level, the closest API-level approximation of real typing) and measure the time from edit to a published diagnostic set | per-keystroke edit→diagnostics lag, p50/p95; the debounce is 150 ms (`service.ts`), so a lag under that is the debounce, not a defect |
| Diagnostic publication lag | `getDiagnostics` polled after each edit | lag distribution; assert the *last* document version's diagnostics win (no stale publish) |
| Memory across open/close cycles | `process.memoryUsage()` in the extension host before/after opening + closing 20 large documents | RSS/heap series; a monotonic rise across cycles is a finding |
| Comparison | the same machine, the TT6 numbers as the reference | table with a verdict column: explained (host/IPC overhead) or regression |

Constraints: no wall-clock assertions that fail the suite on a slow machine — the suite records and
asserts only generous ceilings, exactly as `tests/stress/editor/timing.ts` does; the *numbers* are the
deliverable, and regressions become findings.
Owned scope: `packages/vscode/test/ui/perf.js` (+ the additive large fixture) and
`.ai/reports/CSSX-U5.md`. `tests/stress/editor/**` is imported read-only for the corpus, never edited.
Dependencies: U1; the TT6 report as the reference baseline (not re-run here).
Exit criteria: recorded table with machine context and N; every cell has a verdict; the report states
plainly which differences are host overhead and which are regressions.
Validation: `bun packages/vscode/test/ui/perf.js` (proposed; the suite also exposes it as a
`XESSA_UI_PERF=1` gated case so `bun test` stays fast); `bun run lint`.

## U6 — Accessibility

Deliverable: checklist with findings.

| Item | Method | Pass condition |
|---|---|---|
| Keyboard reachability | every command executed via `vscode.commands.executeCommand` (equivalent to invoking the palette entry) and the keybinding contribution inspected | All 6 commands runnable without a mouse; status bar entry has a `command` (it does: `COMMANDS.buildProject`) |
| Keybinding conflicts | inspect `package.json` `contributes.keybindings` (currently **absent**) and the platform's default chords for the documented actions (⌥⇧F for Format Document) | No declared Xessa keybinding shadows a core VS Code binding; the absence is recorded as the design, not a gap |
| Roles / labels of contributed UI | CDP `Accessibility.getFullAXTree` scoped to the suggest widget, hover, status bar and the Problems panel (fallback: manual) | Suggest rows expose an accessible name equal to the item label + a kind, the status bar item exposes a name (`Xessa`) and its tooltip, no unnamed interactive element |
| Screen-reader readability of hover | inspect the Markdown the provider returns (U1 evidence) | Plain Markdown only: bold/emphasis/code, no bare links, no images, no raw HTML that a hover popup would drop |
| Severity appropriateness | every code family's mapped severity (`adapter.ts:50-60`: Error vs Warning only — there is no `Information` path) | Each code's level is justified in the report; a level that misleads becomes a task (a missing-semicolon `XESSA1002` at Error is a deliberate ADR-0011 decision — confirm, do not "fix") |
| File-icon visibility | screenshots of the Explorer in light **and** dark themes (U3), plus the manifest's `light`/`dark` pair | Icon visible and distinguishable against both themes |
| Colour contrast | `vision` review of the captured screens | No suggestion/hover/status text below readable contrast against the theme background |

Owned scope: `packages/vscode/test/ui/a11y.js` and `.ai/reports/CSSX-U6.md`.
Dependencies: U1 (Markdown evidence), U3 (screens + AX tree).
Exit criteria: each row has an outcome; findings become tasks; accepted limits are handed to U7 for
`docs/known-limitations.md`.
Validation: `bun test tests/extension/host.test.ts`; `bun run lint`.

## U7 — Reports and routing

Deliverable:

- `.ai/reports/CSSX-U0.md` … `CSSX-U7.md` — per phase: the summary bullets, the changed paths, the
  exact commands and their actual output, recorded numbers, deviations, and the unverified items with
  reasons. Screenshots stay outside the repo (temp dir); reports carry the reproduction command and
  the findings.
- a task prompt for every real UI defect (repro, expected/actual, owned files, acceptance criteria).
  Fixes are executed there, then the campaign re-runs the suite — this plan never edits
  `packages/vscode/src/**`.
- a framework bug record only for defects in the host or the harness, with the **exact resolved
  versions** (`@vscode/test-electron` 2.5.2, VS Code 1.147.0). The original launcher note named the
  older `node_modules/.xessa-vscode-test` cache path while the harness now uses
  `node_modules/.vscode-test-xessa`; record any correction in `CSSX-U7.md`.
- Cross-links: TT8 (whose report family gains the UI findings routed from here) and
  `.ai/plans/CSSX-PLAN-PRODUCTION.md` PP3 — the manual checklist shrinks to U2's manual residue, and
  PP0 re-runs its baseline gate after U7. `.ai/todo.md` / `.ai/PROGRESS.md` entries are appended in
  the same serialized slot the TT wave uses.

Owned scope: `.ai/reports/CSSX-U0.md`…`CSSX-U7.md` and serialized appends to
`.ai/todo.md` / `.ai/PROGRESS.md`. Framework records and the sibling plans are
corrected through tasks, not by this phase directly.
Dependencies: U0–U6.
Exit criteria: every phase has a report with real command output; every defect has a task or a
framework record; PP3's manual residue is written out explicitly; no phase is marked 🟢 with an
unverified required check.
Validation: `bun run verify` (typecheck + lint + `bun test`, host suite included), `bun test
tests/extension/` (must not regress from 192 pass / 0 fail / 10 files), `bun run lint`.

## How to run

| Purpose | Command |
|---|---|
| Host suite (the only current entry point — there is **no** `test` script in `packages/vscode`) | `bun test tests/extension/host.test.ts` |
| Host suite, first run without a cached VS Code (one-off ~120 MB download) | `XESSA_EXTENSION_HOST_DOWNLOAD=1 bun test tests/extension/host.test.ts` |
| Confirm the host can run at all (prints test-electron/cache/runnable) | `bun test tests/extension/host.test.ts -t "host test environment summary"` |
| Provider unit suites (pure layer, unchanged by this campaign) | `bun test tests/extension/` |
| Rendered-UI capture (U3, proposed) | `bun packages/vscode/test/ui/cdp.ts --capture --screen <name>` |
| In-host latency (U5, proposed) | `XESSA_UI_PERF=1 bun test tests/extension/host.test.ts` |
| Lint | `bun run lint` |
| Full gate | `bun run verify` |

## Non-goals

- **No new UI features and no redesigns.** Every defect found becomes a task; this campaign adds
  assertions, not behaviour. A feature idea goes to `.ai/todo.md`, not into the extension here.
- **No marketplace/packaging work.** VSIX contents, `vsce package`, publishing and post-release
  installs belong to `.ai/plans/CSSX-PLAN-PRODUCTION.md` (PP1/PP4/PP5).
- **No pure-layer re-testing.** Latency and correctness without a host are TT6's; U5 compares against
  those numbers rather than replacing them.
- **No dependency additions.** No Playwright, `puppeteer`, `chrome-remote-interface` or colour/contrast
  library; CDP is driven with Bun's built-in `WebSocket`, and grammar scopes use the existing
  `vscode-textmate`/`vscode-oniguruma` devDependencies.
- **No source edits from this plan.** `packages/vscode/src/**`, `package.json` and
  `tests/extension/host.test.ts` are read-only here; changes go through tasks with an ownership
  transfer.
- **No visual claims without a screenshot.** "Looks fine" is not evidence; a screen is either captured
  and inspected or recorded unavailable with the reason.
- **No CI/pipeline work.** The campaign runs locally against the current working tree.

## Cross-references

- `.ai/plans/CSSX-PLAN-TESTING.md` — TT0–TT8; TT6 §"Not observable here" is this plan's input, TT7's
  soak is independent, TT8 consumes the findings routed by U7.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` — PP3 (the 7-item manual checklist this campaign shrinks),
  PP0 (baseline gate re-run after U7), PP4 (release execution, owner-authorized only).
- `.ai/HANDOVER.md` — the 7-item manual smoke checklist (U2) and the A45–A51 feature list (U0/U2),
  plus its note that the host harness was untouched by that wave.
- `.ai/reports/CSSX-TT6.md` — pure-layer latencies and the deferred host-only table (U3/U5 baseline);
  `.ai/reports/CSSX-A51.md` — the colour/swatch counts pinned in U2.
- The `Code` launcher override in the host orchestrator, and the framework versions U7 must cite.
- `packages/vscode/test/suite.js`, `tests/extension/host.test.ts` — the harness this plan extends and
  the orchestrator it must not edit.
- `docs/known-limitations.md`, `docs/performance.md` — the claims U5/U6 confirm or correct.
