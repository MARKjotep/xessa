# CSSX-COLOR-TOKENS — report

## Summary

- Shipped semantic colorization for Xessa: compile-time `$token` → blue `#4C8DF8`; runtime tokens and `--var`
  references (including inside `var()`) → magenta `#D6409F`; the `$ns` prefix of `$ns.member` → teal `#4EC9B0` with the
  member following the resolved kind (compile → blue, runtime → magenta); resolved `$keyframes.<name>` members → amber
  `#D18616` (prefix stays teal) per the owner addition.
- Mechanism is the ui specialist's hybrid: a new pure classifier + `DocumentSemanticTokensProvider` (parse-only, never
  throws), `contributes.semanticTokenScopes` for the grammar fallback, and the colours supplied by the user's
  `editor.semanticTokenColorCustomizations` (README “Token colors”). The initial `contributes.semanticTokenColors`
  block was inert in VS Code 1.147 and was removed during finalization; see `## Final palette`.
- Also landed the owner's `!` completion defect from the same session as `CSSX-U07`: `!` is now a trigger, `red!` /
  `4px !` offers only `!important`, and accepting repairs the typed bang (never `!!important`).
- Full gate green on the combined diff: typecheck + lint + `bun test` = **1223 pass / 2 skip / 0 fail** (1225 tests,
  89 files); extension host = **14 scenarios / 860 assertions**.

## Baseline (read-only, before edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 D .ai/framework/vscode-test-electron/bugs/macos-electron-launcher-missing.md
 M .ai/plans/CSSX-PLAN-PRODUCTION.md
 M .ai/todo.md
 ... (the landed 19-defect campaign: compiler, CLI, vscode analysis/groups/keyframes, formatter, tests)
 ?? .ai/plans/CSSX-PLAN-TESTING.md, .ai/plans/CSSX-PLAN-UI.md, .ai/reports/**, .ai/tasks/CSSX-T01…T13/U01…U06,
    packages/vscode/test/fixtures/ui/, packages/vscode/test/ui/, tests/stress/
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

Every pre-existing change was preserved; no commit, push, reset, stash or dependency change was made.

## Changed files

| File | Change |
|---|---|
| `packages/vscode/src/semantic-tokens.ts` | **New.** Legend (`variable`, `namespace`, `runtimeVariable`, `customProperty`, `keyframe`), no modifiers, `semanticTokensFor()` classifier, `customPropertyReferencesInSegment()`, `encodeSemanticTokens()`. No `vscode` import. |
| `packages/vscode/src/providers/semantic-tokens.ts` | **New.** `XessaSemanticTokensProvider`: parse-only `analyzeText` + `readModuleSync`, registers the legend, returns an empty result on any failure (grammar fallback). |
| `packages/vscode/src/controller.ts` | Registers the semantic-token provider; `!` added to completion triggers. |
| `packages/vscode/package.json` | `xessa` `semanticTokenScopes` (grammar fallback); the inert `semanticTokenColors` block was removed during finalization. |
| `packages/vscode/syntaxes/xessa.tmLanguage.json` | `#variable` split (`#variable-keyframes`, `#variable-namespaced`, `#variable-simple`); `#custom-property` in `#value`; `@property` `--x` retargeted; `#runtime-declaration` inside `@runtime`. Additive only. |
| `packages/vscode/src/intelligence.ts` | `important` completion context + `importantBangStart()`; `!important` item with bang-repair range and `filterText`. |
| `packages/vscode/src/providers/completion.ts` | Header trigger list documents `!`. |
| `tests/extension/provider.semantic-tokens.test.ts` | **New.** 19 cases: legend/manifest, kinds, namespaces, members, custom properties, keyframes, degradation, encoding. |
| `tests/extension/grammar.scopes.test.ts` | Additive suite “semantic-token fallbacks” (5 tests): namespace capture, bare token, keyframe member, custom property vs property name vs `@property`, `@runtime` declaration. |
| `packages/vscode/test/fixtures/ui/semantic.cssx` | **New host fixture**: `@use ./theme.cssx as ui`, local compile/runtime tokens, a known and an unknown `$keyframes` reference, `var(--accent)`, an unresolvable member and an unknown bare token. |
| `packages/vscode/test/ui/semantic-tokens.js` | **New host scenario** (wired into `test/suite.js` as the 14th scenario): legend, manifest colors/scopes, 9 decoded tokens, kinds, negatives, declaration sites. |
| `packages/vscode/test/ui/completions.js` | New `!` row (`!important` offer, range, accept, `!im` filter); contexts 21 → 22. |
| `packages/vscode/test/ui/accessibility.js` | Expected contribution inventory carries `semanticTokenScopes` only; the inert `semanticTokenColors` key was removed (necessary test-support edit). |
| `tests/stress/editor/vscode-host.ts`, `tests/stress/editor/activation.test.ts` | Fake `SemanticTokens`/`SemanticTokensLegend` + registration API; counts 27→28 disposables, 28→29 subscriptions, 9→10 providers (necessary test-support edits). |
| `tests/extension/provider.intelligence.test.ts` | Additive `!important completion (CSSX-U07)` suite (4 tests). |
| `.ai/tasks/CSSX-COLOR-TOKENS.md`, `.ai/tasks/CSSX-U07.md` | Task specs, 🟢 + Fix records. |
| `.ai/todo.md` | Quick Note 1 flipped to done with the report pointer; Bug report 24 added and marked 🟢 fixed. Nothing else touched. |

## Acceptance evidence

| # | Row | Evidence | Outcome |
|---|---|---|---|
| 1 | `$spacing` compile-time | unit `typeAt(SPANS, "$spacing") === "variable"`; host `$spacing` → `variable` | 🟢 unit+host |
| 2 | `$accent` local runtime | unit + host → `runtimeVariable` | 🟢 unit+host |
| 3 | `--brand` / `var(--brand)` | unit (value, `var()`, `@variables` token value, strings/comments/LHS negatives); host `var(--accent)` → `customProperty` | 🟢 unit+host |
| 4 | `$ui.primary` | unit + host: `$ui` → `namespace` (len 3), `primary` → `variable` | 🟢 unit+host |
| 5 | imported runtime member | unit `$ui.tone` → `namespace` + `runtimeVariable` (in-memory module with `@runtime`) | 🟢 unit |
| 6 | local default alias | unit `@use "./layout.cssx"` → `$layout` `namespace` + `margin` `variable` | 🟢 unit |
| 7 | `$keyframes.spin` resolved | unit + host: `$keyframes` → `namespace`, `spin` → `keyframe` | 🟢 unit+host |
| 8 | `$keyframes.nope` unresolvable | unit + host: covering spans = prefix `namespace` only | 🟢 unit+host |
| 9 | `$ui.missing` / `$ghost.member` | unit + host: prefix only, member keeps grammar styling | 🟢 unit+host |
| 10 | bare `$ghost` | unit + host: no semantic token | 🟢 unit+host |
| 11 | declaration sites | unit (`spacing:`, `accent:`, `--brand:` LHS) + host (`@runtime`/`@variables` names) → no span | 🟢 unit+host |
| 12 | parse-error document | unit: broken text classifies, spans in bounds, no throw | 🟢 unit |
| 13 | encoding | unit: exact `[2,9,4,2,0, 1,7,4,2,0]` deltas for two line-separated runtime tokens; sorted non-overlap | 🟢 unit |
| 14 | grammar `$ns` capture | `expectScoped($theme, "variable.other.namespace.xessa")`, never member | 🟢 grammar |
| 15 | grammar `--x` value | value → `variable.other.custom-property.xessa`; LHS stays property-name; `@property --gap` retargeted | 🟢 grammar |
| 16 | grammar keyframe member | `spin` has `variable.other.member.xessa` **and** `variable.other.keyframe.xessa`; old pin intact | 🟢 grammar |
| 17 | grammar `@runtime` declaration | `accent` has `variable.other.declared.runtime.xessa` inside `@runtime` only | 🟢 grammar |
| 18 | manifest | unit + host assert five legend types, five scope fallbacks and the absence of the inert colour block | 🟢 unit+host |
| 19 | rendered colors | not asserted (manual, see below) | ⚪ manual |

### Keyframe rows (owner addition)

- `$keyframes.spin` → prefix `namespace` (`#4EC9B0`) + member `keyframe` (`#D18616`): unit
  (`provider.semantic-tokens.test.ts` “a resolved keyframe member is `keyframe`…”) and host
  (`semantic-tokens.js`: both positions asserted on the live token stream).
- `$keyframes.nope` → prefix only; the member carries no semantic token (unit + host), so it keeps grammar styling.
- Grammar fallback adds `variable.other.keyframe.xessa` to the member capture; the pre-existing
  `variable.other.member.xessa` pin still passes.

### `!` completion (CSSX-U07)

- Trigger: `!` added to `vscode.languages.registerCompletionItemProvider(..., "@","$",".",":","/","&","(","#","!")`.
- Repair range: `importantBangStart()` returns the start of the whole `!` run, so `red!` → `red!important`,
  `red!!` → `red!important`, `4px !` → `4px !important` (space kept), `red!im` → `red!important`.
- Negative cases: selector `.card!`, property-name position `col!`, empty value `color: !` produce no `!important` item.
- Unit 4/4; host row applies the item and checks the exact resulting text and single `!`.

## Commands and measured outcomes

```sh
bun test tests/extension/provider.semantic-tokens.test.ts tests/extension/grammar.scopes.test.ts
# 41 pass, 0 fail (semantic tokens 19 + grammar scopes and structure)

bun test tests/extension/provider.intelligence.test.ts
# 102 pass, 0 fail

bun test tests/extension/host.test.ts
# 2 pass, 0 fail; [xessa host] passed: 14 scenarios, 860 assertions
# [baseline=36, completions=130, hovers=42, diagnostics=36, colors=42, semantic-tokens=25,
#  commands=26, navigation=24, quickfix=15, checklist=98, commands-matrix=101, config=54,
#  accessibility=196, performance=35]

bun run verify
# typecheck exit 0; biome check exit 0;
# 1223 pass, 2 skip, 0 fail — 994868 expect() calls, 1225 tests across 89 files
```

One intermediate full run hit the pre-existing timing-sensitive `tests/integration/cli-watch.test.ts`
“rebuilds only the affected entry…” with a 10 s timeout while the rest of the suite was under load; rerun in
isolation was 3 pass / 0 fail and the final full gate above is green. No assertion was changed.

## Deviations from §SPEC

1. **Provider uses parse-only `analyzeText`, not `AnalysisService.analyzeNow`.** §SPEC §5 said "vscode wrapper over the
   analysis service, `providers/hover.ts` pattern"; the binding constraint ("parse-only analysis, empty result →
   grammar fallback") requires the parse-only path, and semantic tokens run on every edit, so the provider follows
   hover's provider shape but calls `analyzeText` with `readModuleSync`. Consequence: no compile in the token path.
2. **Dedicated `#variable-keyframes` rule instead of one conditional capture.** A TextMate capture name cannot depend on
   the namespace text, so the keyframe member is handled by a specific rule inside `#variable` whose member capture is
   the multi-scope name `variable.other.member.xessa variable.other.keyframe.xessa`. This keeps the existing
   `$keyframes.spin` member pin valid (required: "update no existing pin") while adding the keyframe scope.
3. **`#runtime-declaration` duplicates `#declaration`'s begin regex** so the new
   `variable.other.declared.runtime.xessa` is additive over `support.type.property-name.css` rather than replacing it.
4. **Out-of-nominal-write-set test-support edits** (necessary to keep the gate green, reported above):
   `packages/vscode/test/ui/accessibility.js` (manifest inventory), `tests/stress/editor/vscode-host.ts` and
   `tests/stress/editor/activation.test.ts` (fake API + counts).
5. **Host completions context count 21 → 22** for the new `!` row (the owner's addition), not a weakened assertion.

## Manual items

- **Rendered colors on Dark+ `#1E1E1E` and Light+ `#FFFFFF`.** Not machine-verified: the host can observe the token
  stream and legend, but no API reports the final painted color. The final hexes measure (white / dark):
  `variable` `#4C8DF8` 3.24:1 / 5.14:1, `runtimeVariable` & `customProperty` `#D6409F` 4.12:1 / 4.04:1,
  `namespace` `#4EC9B0` 2.04:1 / 8.18:1, `keyframe` `#D18616` 2.94:1 / 5.66:1. Teal and amber are low-contrast on
  white; they remain syntax-highlighting colours (not body text) and the owner can adjust the same settings. A human
  visual pass in the editor is still recommended. Recorded as manual; no fake assertion was added.
- Native suggest-widget rendering of the `!` item (popup paint) is covered at the provider level; the popup itself is
  the same surface every other completion row already exercises.

## Pointers

- Task: `.ai/tasks/CSSX-COLOR-TOKENS.md`; `!` defect: `.ai/tasks/CSSX-U07.md`.
- Board: `.ai/todo.md` Quick Note 1 and Bug report 24.
- CHANGELOG: `[Unreleased]` → `### VS Code extension` (semantic token colorization) and `### Fixed`
  (CSSX-U07).

## Rendering diagnosis

> Historical record of the 2026-11-26 diagnosis that led to the final decision. The hexes and snippet
> below are the pre-finalization palette; `## Final palette` supersedes them.

**Verdict: cause (b) — theme precedence, plus a dead contribution.** The classifier is correct; the extension's
`contributes.semanticTokenColors` hexes never reach the renderer in VS Code 1.147.0, and the default theme colours
`variable.other.xessa` almost identically to body text, so tokens look uncoloured.

### Baseline (read-only, before any edit)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ... (the pre-existing CSSX-COLOR-TOKENS campaign working tree, unchanged)
?? .ai/reports/CSSX-COLOR-TOKENS.md
?? packages/vscode/src/semantic-tokens.ts
?? packages/vscode/src/providers/semantic-tokens.ts
?? tests/extension/provider.semantic-tokens.test.ts
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,tasks): task records, bug/feature board and handover refresh
```

Nothing was committed, reset, stashed or dependency-changed; every pre-existing change was preserved.

### Evidence (a) — classifier on the real file (not the bug)

Throwaway script under the OS temp dir imported `packages/vscode/src/analysis.ts` + `src/semantic-tokens.ts`
(`adapter.ts` imports `vscode`, so the script passed the equivalent `readFileSync` reader through `readModule`,
which is the same implementation as `readModuleSync`), opened `examples/basic/src/button.cssx` and decoded every span:

```
file: /Users/Marky/Desktop/$/xessa/examples/basic/src/button.cssx
spans: 5
legend: variable, namespace, runtimeVariable, customProperty, keyframe
  L21:11 "$spacing" -> variable (len 8)
  L22:17 "$radius" -> variable (len 7)
  L23:14 "$theme" -> namespace (len 6)
  L23:21 "primary" -> variable (len 7)
  L54:22 "$radius" -> variable (len 7)
encoded data length: 25 (tokens: 5)
$spacing    -> $spacing:variable
$radius     -> $radius:variable
$theme      -> $theme:namespace
.primary    -> $theme:namespace (offset of member: primary:variable)
.button     -> NONE
imports: [{"alias":"theme","tokens":["primary"]}]
local tokens: ["spacing:compile","radius:compile","colors:runtime"]
```

Exactly the requested classification (`$spacing`/`$radius` → `variable`, `$theme` → `namespace`, member `primary` →
`variable`, `.button` is a class selector and correctly has no token). No classifier bug, so no source/test edit.

### Evidence (b) — rendered DOM colours, with and without user settings

A CDP probe (cached build, dev extension, own temp profile, `button.cssx` opened, computed style of the rendered
`mtk` spans) measured the *actual paint*:

| run | `$spacing` | `$theme` | `primary` |
|---|---|---|---|
| default profile (owner's window) | `mtk25` `rgb(201, 209, 217)` | `mtk25` `rgb(201, 209, 217)` | `mtk25` `rgb(201, 209, 217)` |
| with the settings below | `mtk34` `rgb(31, 111, 235)` | `mtk35` `rgb(45, 164, 78)` | `mtk34` `rgb(31, 111, 235)` |

`rgb(201,209,217)` = `#c9d1d9`, which is the *default theme's* `variable.other` rule; the editor body text is
`#BBBEBF`, so the tokens were effectively invisible. Two mechanisms produce this:

1. **`contributes.semanticTokenColors` is not an extension contribution point.** In the shipped 1.147.0 bundle
   (`out/vs/workbench/workbench.desktop.main.js`) the registered token-related extension points are
   `semanticTokenTypes`, `semanticTokenModifiers` and `semanticTokenScopes`; `semanticTokenColors` appears only in
   the *colour theme file* loader/schema (`vscode://schemas/color-theme`). The manifest block is therefore ignored
   silently. The official guide agrees: extensions can only add `semanticTokenScopes` (TextMate fallback); only
   theme files and `editor.semanticTokenColorCustomizations` define semantic colours.
2. **The 1.147 default theme is "2026 Dark"** (not Dark+), inheriting `dark_modern` → `dark_plus`. It sets
   `semanticHighlighting: true` but its TextMate rules are `"variable" → #ffa657` and `"variable.other" → #c9d1d9`;
   our grammar/mapping scope `variable.other.xessa` matches the *more specific* `variable.other` rule → `#c9d1d9`.
   `namespace` resolves through the same `variable.other` prefix, hence the identical colour.

`semanticTokenColorCustomizations` outranks theme rules, which is why the forced settings produce the intended
blue/green exactly. Token delivery itself was never broken: the extension host log shows
`ExtensionService#_doActivateExtension xessa.xessa … 'onLanguage:xessa'`, the host scenario still passes, and run 2
renders the five legend types with distinct colours.

### Settings written (dev profile, not repo source)

`node_modules/.vscode-test-xessa/f5-profile/User/settings.json` (created, directories included):

```json
{
  "editor.semanticHighlighting.enabled": true,
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "variable": "#1F6FEB",
      "namespace": "#2DA44E",
      "runtimeVariable": "#D6409F",
      "customProperty": "#D6409F",
      "keyframe": "#D18616"
    }
  }
}
```

### Relaunch

Old dev host (PID 19401) had already exited (`pgrep -fl "f5-profile"` → no match), so nothing user-owned was
killed. Rebuilt once: `bun run --cwd packages/vscode build` → `Bundled 94 modules in 33ms`, `dist/extension.js`
0.43 MB, `out/extension.js` shim rewritten. Relaunched detached:

```
Code --user-data-dir=…/f5-profile --extensions-dir=…/f5-extensions \
  --extensionDevelopmentPath=…/packages/vscode --disable-extensions --skip-welcome --skip-release-notes \
  --new-window …/examples/basic        # nohup … & disown
```

New window **PID 24802**; extension host log for that session (`logs/20261126T042351`) shows `xessa.xessa` activated
on `onLanguage:xessa` with no errors.

Note: a first relaunch (PID 23762) died when the launching shell exited (extension host `exited with code: 0` at
04:23:00, no crash log), so the final launch used a double-fork + `setsid` detachment — same arguments above — which
survives the parent shell. Verified alive and activated afterwards.

### Commands and outcomes

```
bun test tests/extension/provider.semantic-tokens.test.ts   # 19 pass, 0 fail, 57 expect() calls
```

`bun test tests/extension/host.test.ts` and `bun run verify` were not re-run: no source, test or manifest file
changed in this diagnosis (the write set allowed them only for a classifier fix, and (a) was ruled out).

### Follow-up for the owner / build (outside this write set)

The manifest's `contributes.semanticTokenColors` block is inert and should not be relied on. Durable options, in
preference order: (1) ship a small colour theme contribution whose `semanticTokenColors` carries these hexes, or
(2) map `semanticTokenScopes` to scopes the default themes actually colour distinctly (e.g. `property`/`support.*`
families), and keep `editor.semanticTokenColorCustomizations` documented as the user-level override. Choose before
the next release so the acceptance table's row 19 stops being manual-only.

**Resolution (owner, 2026-11-26):** keep the semantic-token provider and `semanticTokenScopes`, remove the inert
manifest block, and document the `editor.semanticTokenColorCustomizations` snippet in the README. No colour-theme
contribution is shipped.

## Final palette

Owner-finalized palette (2026-11-26). This supersedes the hexes in the earlier summary/settings blocks; the
`## Rendering diagnosis` evidence is kept as the historical reason for the mechanism change.

| Kind | Hex | Colours |
|---|---|---|
| `variable` | `#4C8DF8` | compile-time `$token` references and resolved compile-time members (owner: lighter blue, replacing `#1F6FEB`) |
| `namespace` | `#4EC9B0` | the `$ns` / `$keyframes` prefix (owner: matches the `@use … as` styling, replacing `#2DA44E`) |
| `runtimeVariable` | `#D6409F` | `@runtime` tokens and runtime members (unchanged) |
| `customProperty` | `#D6409F` | `--var` references, including `var()` arguments (unchanged) |
| `keyframe` | `#D18616` | resolved `$keyframes.<name>` members (unchanged) |

### Mechanism (corrected)

- Removed `contributes.semanticTokenColors` from `packages/vscode/package.json`: it is not an extension contribution
  point in VS Code 1.147.0 and was silently ignored (the listeners/diagnosis above). `contributes.semanticTokenScopes`
  stays — it is a real contribution point and the grammar fallback for pre-analysis/degraded parses.
- Colours now come from the documented user settings:
  `editor.semanticHighlighting.enabled` + `editor.semanticTokenColorCustomizations.rules` with the five hexes. The
  exact `settings.json` snippet and palette table live in `packages/vscode/README.md` §“Token colors”, with a short
  pointer in the root `README.md` VS Code section. The `semantic-tokens.ts` header and the `controller.ts` comment now
  describe this mechanism instead of claiming the manifest carries the colours.
- Verification: **Developer: Inspect Editor Tokens and Scopes** on a token; the `!` completion is the freshness signal
  that the rebuilt extension is loaded.

### Baseline (read-only, before finalization edits)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 M .ai/todo.md
 ... (the same CSSX-COLOR-TOKENS campaign working tree described above, all pre-existing changes preserved)
?? .ai/reports/CSSX-COLOR-TOKENS.md
?? .ai/tasks/CSSX-COLOR-TOKENS.md
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,docs): task records, bug/feature board and handover refresh
```

No commit, push, reset, stash or dependency change; no other VS Code process was touched.

### Finalization changes

| File | Change |
|---|---|
| `packages/vscode/package.json` | Removed the inert `contributes.semanticTokenColors` block; `semanticTokenScopes` unchanged. |
| `packages/vscode/src/semantic-tokens.ts` | Legend header documents user settings + scope fallback (no manifest colours). |
| `packages/vscode/src/controller.ts` | Registration comment corrected to the user-settings mechanism. |
| `packages/vscode/README.md` | New “Token colors” section: five-kind table, final hexes, exact settings snippet, why it is needed, Inspect Tokens pointer. |
| `README.md` | One bullet in the existing VS Code section pointing at `packages/vscode/README.md#token-colors`. |
| `packages/vscode/test/ui/accessibility.js`, `packages/vscode/test/ui/semantic-tokens.js`, `tests/extension/provider.semantic-tokens.test.ts` | Manifest inventory/scenario follows the real manifest: no `semanticTokenColors`, scope fallback and legend still asserted (necessary test-support edits; no assertion weakened). |
| `.ai/tasks/CSSX-COLOR-TOKENS.md`, `.ai/reports/CSSX-COLOR-TOKENS.md`, `.ai/todo.md` (Quick Note 1), `CHANGELOG.md` | Final palette + mechanism corrected; diagnosis history retained. |
| `.ai/HANDOVER.md` | New “Token colors (CSSX-COLOR-TOKENS)” section (classification, palette, rendering requirement, verification, cross-links, current gate numbers). |
| `node_modules/.vscode-test-xessa/f5-profile/User/settings.json` | Dev-profile palette updated to the final hexes (outside the repo). |

### Validation (this finalization run)

```
bun run verify
# typecheck exit 0; Biome lint exit 0;
# 1223 pass, 2 skip, 0 fail — 994859 expect() calls, 1225 tests across 89 files (77.47s)
# extension host: passed 14 scenarios, 860 assertions [semantic-tokens=25]

bun run --cwd packages/vscode build
# Bundled 94 modules in 11ms; dist/extension.js 0.43 MB; out/extension.js shim rewritten
```

Relaunch used the same recipe (`--disable-extensions`, fresh `f5-profile`, `examples/basic`, double-fork + `setsid`)
after killing only the previous window (PID 24802). New window **PID 28643**; session log
`logs/20261126T122903/window1` shows `ExtensionService#_doActivateExtension xessa.xessa … activationEvent:
'onLanguage:xessa'`. Painted-colour inspection remains manual (no VS Code API exposes it); the dev profile now carries
the final palette, so the open window is the visual check.


## Zero-config scope fallback

> **Superseded in part:** `variable` was retuned from `storage.type` to `variable.language` in
> `## Variable scope tuning` (below), because 2026 Dark paints `storage.type` red. The rest of this
> section remains current.

Approved follow-up (2026-11-26): the token palette now works without user settings. The five kinds are
remapped in `packages/vscode/package.json` → `contributes.semanticTokenScopes` (language-qualified
`xessa`, wrapper unchanged) from the self-referential `variable.other.*.xessa` scopes to scopes the
common themes already style distinctly:

| Kind | Scope | Dark+ | Light+ |
|---|---|---|---|
| `variable` | `storage.type` | `#569CD6` | `#0000FF` |
| `namespace` | `entity.name.type` | `#4EC9B0` | `#267F99` |
| `runtimeVariable` | `keyword.control` | `#C586C0` | `#AF00DB` |
| `customProperty` | `keyword.control` | `#C586C0` | `#AF00DB` |
| `keyframe` | `entity.name.function` | `#DCDCAA` | `#795E26` |

The literal palette (`variable #4C8DF8`, `namespace #4EC9B0`, `runtimeVariable`/`customProperty`
`#D6409F`, `keyframe #D18616`) remains documented in `packages/vscode/README.md` §“Token colors” as
the `editor.semanticTokenColorCustomizations` override; those user rules outrank this scope fallback.

### Empirical painted colours (decisive)

Built once (`bun run --cwd packages/vscode build` → `Bundled 94 modules in 31ms`, `dist/extension.js`
0.43 MB). A throwaway probe
(`/var/folders/…/T/opencode/measure-zero-colors.js`, outside the repo) launched the cached 1.147.0
build with a **fresh `mkdtemp` profile and no `User/settings.json`**, the dev extension, `--disable-extensions`,
workspace `examples/basic`, opened `src/button.cssx` over CDP and read `getComputedStyle().color` on
the painted `mtk` spans:

| Run (no token settings) | `$spacing` (`variable`) | `$theme` (`namespace`) |
|---|---|---|
| default theme (“2026 Dark”, the 1.147 default) | `mtk22` `rgb(255, 123, 114)` = `#FF7B72` | `mtk18` `rgb(78, 201, 176)` = `#4EC9B0` |
| Dark+ selected at runtime in the same profile | `mtk5` `rgb(86, 156, 214)` = `#569CD6` | `mtk17` `rgb(78, 201, 176)` = `#4EC9B0` |

`$theme` matches the approved `#4EC9B0` in both. `$spacing` confirms the approved `#569CD6` mapping
under Dark+; note the measured value is `rgb(86, 156, 214)` (the task's `rgb(86,205…)` was an
approximation). **Divergence worth knowing:** the 1.147 default is “2026 Dark” (not Dark+), and that
theme styles `storage.type` red (`#FF7B72`), so the out-of-the-box paint for compile-time tokens is a
distinct red rather than blue. It is still visibly coloured (vs. the previous near-body-text
`#C9D1D9`), and `$theme` is teal. Changing the mapping to force blue on 2026 Dark would require a new
owner decision; the documented literal palette remains the exact-colour route.

The probe's first run reported `userSettingsExists: false`; the theme picker then persisted only
`{"workbench.colorTheme": "Dark+"}` for the second measurement. No settings were seeded by the test.

### Docs and tests touched

| File | Change |
|---|---|
| `packages/vscode/package.json` | `semanticTokenScopes` values remapped as above; structure/wrapper unchanged. |
| `packages/vscode/README.md` | “Token colors” leads with zero-config behaviour and the kind → scope → Dark+/Light+ table; states colours follow the theme and may vary; keeps the literal settings snippet as the override that outranks the fallback. |
| `README.md` | VS Code bullet now says no configuration, with the literal palette documented in the extension README. |
| `CHANGELOG.md` | Extension entry describes the zero-config theme scopes and the optional override. |
| `.ai/todo.md` | Quick Note 1 records the zero-config mapping and the remaining literal override. |
| `.ai/HANDOVER.md` | Token-colors section leads with the mapping table, theme variability, override and measured colours; gate numbers refreshed. |
| `tests/extension/provider.semantic-tokens.test.ts` | Manifest test now asserts the exact five-scope mapping (was only defined-per-type). |
| `packages/vscode/test/ui/semantic-tokens.js` | Host scenario asserts the exact scope map via `deepEqual`; header/comment corrected. |
| `packages/vscode/test/ui/accessibility.js` | Comment corrected (scopes provide the zero-config fallback; settings are the override). |

No assertion was weakened; the manifest pins became stricter.

### Validation and relaunch

```
bun test tests/extension/provider.semantic-tokens.test.ts tests/extension/grammar.scopes.test.ts
# 39 pass, 0 fail, 283 expect() calls (semantic tokens 19 + grammar scopes 20)

bun run verify
# typecheck exit 0; Biome lint exit 0;
# 1223 pass, 2 skip, 0 fail — 994854 expect() calls, 1225 tests across 89 files (75.01s)

bun test tests/extension/host.test.ts
# 2 pass, 0 fail; [xessa host] passed: 14 scenarios, 856 assertions
# [semantic-tokens=21; the exact-map `deepEqual` replaced five per-type checks]
```

Killed only our previous dev window (`--user-data-dir=…/f5-profile`, PID 28643; all `f5-profile`
processes gone). Relaunched detached with `start_new_session=True` (setsid-equivalent) on the fresh
settings-less profile:

```
Code --user-data-dir=…/node_modules/.vscode-test-xessa/zero-profile \
  --extensions-dir=…/node_modules/.vscode-test-xessa/zero-extensions \
  --extensionDevelopmentPath=…/packages/vscode --disable-extensions --skip-welcome \
  --skip-release-notes --new-window …/examples/basic
```

New window **PID 33619**, pgrep-verified alive; `zero-profile/User/settings.json` does not exist, so
this is the demonstrated default experience. The probe's windows were disposed by the driver.

### Baseline (read-only, before this follow-up)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/HANDOVER.md
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ... (the landed CSSX-COLOR-TOKENS finalize pass plus the 19-defect campaign, all preserved)
?? .ai/reports/CSSX-COLOR-TOKENS.md
?? packages/vscode/src/semantic-tokens.ts
?? tests/extension/provider.semantic-tokens.test.ts
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,tasks): task records, bug/feature board and handover refresh
```

No commit, push, reset, stash or dependency change; no other VS Code process was touched.

## Variable scope tuning

Owner follow-up (2026-11-26): the zero-config `variable` kind was mapped to `storage.type`, which the
1.147 default theme "2026 Dark" paints red-orange, so out-of-the-box compile-time `$token`s were red
instead of blue. One-scope fix: `variable` → **`variable.language`**, chosen empirically from the
themes shipped with the cached 1.147 build. No source/classifier change was required.

### Baseline (read-only, before this pass)

```
$ git status --porcelain=v1 -b && git log --oneline -3
## main...origin/main
 M .ai/HANDOVER.md
 M .ai/PROGRESS.md
 D .ai/framework/xessa/FRAMEWORK.md
 ... (the CSSX-COLOR-TOKENS campaign working tree, all pre-existing changes preserved)
6355ec3 ini
4785b03 chore(ai,tests): complete task records and extension-host harness wiring
a0b0432 chore(ai,records): task records, bug/feature board and handover refresh
```

No commit, push, reset, stash or dependency change; only our own dev windows were touched.

### Candidate measurement (theme files, not guesses)

Scope colours were resolved from the shipped theme trees
(`extensions/theme-defaults/themes/`): `2026-dark.json` → `dark_modern.json` → `dark_plus.json` →
`dark_vs.json`, and the `2026-light`/`light_modern`/`light_plus`/`light_vs` chain. The resolver
implements VS Code's rule precedence — deepest `tokenColors` selector (dot depth), then most parent
scopes, then last declaration wins — and was sanity-checked against the two colours already measured
in the DOM in the previous pass: `storage.type` on 2026 Dark resolves to `#FF7B72` (measured
`rgb(255,123,114)`) and `entity.name.type` to `#4EC9B0` (measured `rgb(78,201,176)`). Both matched
exactly before any candidate was trusted.

| Candidate scope | 2026 Dark (default) | Dark+ | Light+ | Verdict |
|---|---|---|---|---|
| `entity.name.tag` | `#7EE787` | `#569CD6` | `#800000` | not blue on default/light |
| `constant.character.escape` | `#D7BA7D` | `#D7BA7D` | `#EE0000` | not blue |
| `support.type` | `#4EC9B0` | `#4EC9B0` | `#267F99` | teal — collides with `namespace` (`entity.name.type`) |
| `storage` (plain) | `#FF7B72` | `#569CD6` | `#0000FF` | red on default |
| `constant.numeric` | `#B5CEA8` | `#B5CEA8` | `#098658` | green |
| `constant.language` | `#569CD6` | `#569CD6` | `#0000FF` | blue everywhere — runner-up |
| `meta.preprocessor` | `#569CD6` | `#569CD6` | `#0000FF` | blue everywhere — semantically poor |
| `support.variable` | `#79C0FF` | `#9CDCFE` | `#001080` | blue/navy — viable alternative |
| **`variable.language`** | **`#79C0FF`** | **`#569CD6`** | **`#0000FF`** | **chosen: blue in all three, literal "variable" family** |

`variable.language` is also blue in the other shipped defaults (Dark Modern `#569CD6`, 2026 Light
`#0550AE`, Light Modern `#0000FF`) and carries no italic/underline fontStyle in any of them. It is
distinct from the other mapped kinds in the default theme: teal `#4EC9B0` (`entity.name.type`),
magenta `#C586C0` (`keyword.control`), violet `#D2A8FF` (`entity.name.function`).
Contrast of the chosen blue: **9.6:1** on 2026 Dark `#121314`, 5.1:1 on Dark+ `#1E1E1E`, 8.6:1 on
Light+ `#FFFFFF`.

Correction to the previous section's premise: in 2026 Dark, `entity.name.function` resolves to
`#D2A8FF` (2026-dark declares it explicitly), not the Dark+ amber `#DCDCAA`. The `keyframe` mapping is
unchanged by this task; the measured violet is distinct from the variable blue but sits near the
runtime magenta, which is the next candidate for a follow-up if the owner wants more separation.

### Chosen mapping

```
variable        -> variable.language     (was storage.type)
namespace       -> entity.name.type      (unchanged)
runtimeVariable -> keyword.control       (unchanged)
customProperty  -> keyword.control       (unchanged)
keyframe        -> entity.name.function  (unchanged)
```

### DOM-measured painted colours (decisive)

Rebuilt once: `bun run --cwd packages/vscode build` → `Bundled 94 modules in 40ms`, `dist/extension.js`
0.43 MB. Two throwaway probes in the OS temp dir (outside the repo) launched the cached 1.147.0 build
with a fresh `mkdtemp` profile and **no `User/settings.json`**, `--disable-extensions`, the dev
extension, and read `getComputedStyle().color` on painted `mtk` spans over CDP.

`examples/basic/src/button.cssx`, default theme ("2026 Dark"):

| Run (no token settings) | Span | Painted colour |
|---|---|---|
| default theme | `$spacing` (`variable`) | `mtk23` `rgb(121, 192, 255)` = `#79C0FF` |
| default theme | `$radius`, member `primary` (`variable`) | `mtk23` `rgb(121, 192, 255)` |
| default theme | `$theme` (`namespace`) | `mtk18` `rgb(78, 201, 176)` = `#4EC9B0` |
| default theme | body text | `rgb(187, 190, 191)` = `#BBBEBF` |
| Dark+ picked at runtime (same temp profile) | `$spacing` (`variable`) | `mtk5` `rgb(86, 156, 214)` = `#569CD6` |

`packages/vscode/test/fixtures/ui/semantic.cssx`, default theme, all five kinds live:

| Kind | Span | Painted colour |
|---|---|---|
| `variable` | `$spacing`, `primary` | `mtk23` `rgb(121, 192, 255)` = `#79C0FF` |
| `namespace` | `$ui`, `$keyframes` | `mtk18` `rgb(78, 201, 176)` = `#4EC9B0` |
| `runtimeVariable` | `$accent` | `mtk12` `rgb(197, 134, 192)` = `#C586C0` |
| `customProperty` | `--accent` (in `var()`) | `mtk12` `rgb(197, 134, 192)` = `#C586C0` |
| `keyframe` | `spin` | `mtk26` `rgb(210, 168, 255)` = `#D2A8FF` |

So the zero-config `variable` is now the intended blue `rgb(121, 192, 255)` in the default experience
and is visibly distinct from teal (`rgb(78, 201, 176)`), magenta (`rgb(197, 134, 192)`) and violet
(`rgb(210, 168, 255)`). Under Dark+ it is `rgb(86, 156, 214)` as before.

### Files touched

| File | Change |
|---|---|
| `packages/vscode/package.json` | `semanticTokenScopes.variable` → `["variable.language"]`; everything else unchanged. |
| `packages/vscode/README.md` | “Token colors” table gains a measured Default (2026 Dark) column; `variable` row scope/colour updated. |
| `tests/extension/provider.semantic-tokens.test.ts` | Exact-manifest pin now `variable: ["variable.language"]`. |
| `packages/vscode/test/ui/semantic-tokens.js` | Host `deepEqual` scope-map pin updated to the same value. |
| `packages/vscode/test/ui/accessibility.js` | No edit: it inventories contribution keys (`semanticTokenScopes`), not scope values. |
| `CHANGELOG.md`, `.ai/todo.md`, `.ai/HANDOVER.md` | Scope name, measured colours and gate numbers refreshed. |
| `.ai/reports/CSSX-COLOR-TOKENS.md` | This section. |

No assertion was weakened — the two scope pins changed value only, still exact `deepEqual`/`toEqual`.

### Validation

```
bun test tests/extension/provider.semantic-tokens.test.ts tests/extension/grammar.scopes.test.ts
# 39 pass, 0 fail, 283 expect() calls

bun test tests/extension/host.test.ts
# 2 pass, 0 fail; [xessa host] passed: 14 scenarios, 856 assertions [semantic-tokens=21]

bun run verify
# typecheck exit 0; Biome lint exit 0;
# 1223 pass, 2 skip, 0 fail — 994856 expect() calls, 1225 tests across 89 files (73.54s)
```

### Relaunch

The previous `zero-profile` window was already gone (`pgrep -fl 'vscode-test-xessa/(zero|f5)-profile'`
→ no match), so nothing user-owned was killed. The first relaunch on `zero-profile2` opened only the
folder, so no `.cssx` was open and the extension stayed idle; it was stopped (our PID 38921) and
relaunched detached (`setsid`-equivalent `start_new_session=True`) with the file added:

```
Code --user-data-dir=…/node_modules/.vscode-test-xessa/zero-profile2 \
  --extensions-dir=…/node_modules/.vscode-test-xessa/zero-extensions \
  --extensionDevelopmentPath=…/packages/vscode --disable-extensions --skip-welcome \
  --skip-release-notes --new-window …/examples/basic …/examples/basic/src/button.cssx
```

New window **PID 39656** (`ps -p 39656` alive). No `zero-profile2/User/settings.json` exists, so this
is still the settings-less default experience. Session log `logs/20261126T124248/window1/exthost/exthost.log`
shows `ExtensionService#_doActivateExtension xessa.xessa … activationEvent: 'onLanguage:xessa'`.

## Media variant marker tuning

Owner follow-up (2026-11-26): the three grammar variant rules (inline value variants, block variant
headers, and the `@media-types` caption) emitted `entity.name.function.xessa`, which measures violet
`#D2A8FF` on 2026 Dark and pale amber `#DCDCAA` on Dark+ — too close to numeric values when variants
sit inline (`padding: $spacing @md 20px @xl 32px`). One scope-family change: variants → **`markup.deleted.xessa`**
(inside `meta.variant.xessa`); no classifier change.

### Candidate measurement (shipped theme trees)

Resolved from `theme-defaults/themes/` includes (`2026-dark` → `dark_modern` → `dark_plus` →
`dark_vs`; `light_plus` → `light_vs`), using the same precedence as the `variable.language` tune:
deepest selector, then last declaration. Candidate values:

| Candidate scope | 2026 Dark | Dark+ | Light+ | Verdict |
|---|---|---|---|---|
| `string` | `#A5D6FF` | `#CE9178` | `#A31515` | blue on default — collides with `variable` |
| `constant.character` | `#FF7B72` | `#569CD6` | `#0000FF` | blue on Dark+/Light+ — collides with `variable` |
| `constant.character.escape` | `#D7BA7D` | `#D7BA7D` | `#EE0000` | ΔE 25.7 from numeric and 17.4 from keyframe — too close |
| `markup.changed` | `#FFA657` | `#569CD6` | `#0451A5` | blue on Dark+/Light+ — collides with `variable` |
| **`markup.deleted`** | **`#FFA198`** | **`#CE9178`** | **`#A31515`** | **chosen: warm orange/red in all three** |

`markup.deleted` is ΔE ≥ 35 from all five mapped kinds in every theme (minimum: 41.5 vs keyword on
2026 Dark, 35.1 vs keyframe on Dark+, 50.6 vs keyframe on Light+), with contrast **9.57:1** on 2026
Dark, **6.31:1** on Dark+ and **7.85:1** on Light+. **Light+ tradeoff:** `markup.deleted` shares the
string hex `#A31515` (as Dark+ shares `#CE9178` with strings); variants and quoted strings therefore
share a hue in those two themes. They remain different constructs, and all five mapped kinds stay
distinct.

### DOM-measured paint (decisive)

Fresh settings-less CDP profile (`profileHasSettings: false`), default “2026 Dark”, dev extension
rebuilt, `examples/basic/src/button.cssx` open. PID **64455** (`pgrep -fl xessa-cdp` showed the
launcher alive while measuring; the probe disposed it afterwards):

| Span | Token class | Painted colour |
|---|---|---|
| `@md`, `@dark`, `@xl` | `mtk29` | `rgb(255, 161, 152)` = `#FFA198` |
| `20px`, `32px` | `mtk7` | `rgb(181, 206, 168)` = `#B5CEA8` |

Distinct red vs green confirmed on the rendered DOM.

### Files touched

| File | Change |
|---|---|
| `packages/vscode/syntaxes/xessa.tmLanguage.json` | Four `meta.variant.xessa entity.name.function.xessa` captures → `meta.variant.xessa markup.deleted.xessa` (inline alias, conditional block, alias block start, `@media-types` caption). |
| `tests/extension/grammar.scopes.test.ts`, `tests/extension/grammar.test.ts` | Variant pins moved to the new scope; all three positions still pinned; UI-contract reachable-scope list updated. |
| `packages/vscode/README.md` | Zero-config table gains the media-variant row and the measured min-ΔE/contrast tradeoff; grammar scope table updated. |
| `README.md`, `docs/usage.md` | One-line variant-marker colour pointer. |
| `.ai/HANDOVER.md` | Palette and verification refreshed. |

### Validation

```
bun test tests/extension/grammar.test.ts tests/extension/grammar.scopes.test.ts
# 41 pass, 0 fail, 538 expect() calls
bun test tests/extension/host.test.ts
# 14 scenarios, 856 assertions
bun run verify
# 1225 pass, 2 skip, 0 fail — 994862 expect() calls, 1227 tests across 89 files
```

No assertion was weakened: scope pins changed value only, and all three variant positions still
assert the exact scope.
