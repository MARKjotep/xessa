# CSSX-GROUP-GHOST-HINTS — group override ghost text

## Summary

- Added dim italic ghost text after a use-site declaration showing the group default it overrides,
  for example `padding: 0.5rem;` followed by a dim `12px`.
- Hints are zero-width `after` decorations built from one `ThemeColor` type; nothing is written,
  no columns move, and hover/completion/formatting/CSS output are untouched.
- New setting `xessa.editor.groupOverrideHints` with `always` (default), `inside` and `off`.
- The pure computation and mode filter live in `packages/vscode/src/group-hints.ts` with no `vscode`
  import; the provider only converts them to decorations.

## Status

**PASS** — focused tests, extension typecheck and Biome are green. Actual rendering is a manual check.

## Setting

| Setting | Type | Default | Values |
|---|---|---|---|
| `xessa.editor.groupOverrideHints` | `string` enum | `"always"` | `"always"`, `"inside"`, `"off"` |

## Changed files

| Path | Change |
|---|---|
| `packages/vscode/src/group-hints.ts` | New pure module: `groupHints`, `filterGroupHints`, `groupHintMode`, `GroupHint`, `GroupHintMode`, `GroupHintSource`. |
| `packages/vscode/src/providers/group-hints.ts` | New `XessaGroupHintsProvider`: one `after` decoration type (`editorCodeLens.foreground`, italic, `0 0 0 0.7em`), per-document debounced refresh from the cached analysis, selection/editor/config refresh, `off` clears. |
| `packages/vscode/src/controller.ts` | Registration, disposables, open/change/save/close scheduling, active/visible editor and selection wiring, setting-change refresh, activation refresh. |
| `packages/vscode/src/groups.ts` | `GroupDefault` gains `authored` (full value with inline variants). Hover still reads `value`, so hover output is unchanged. |
| `packages/vscode/package.json` | Contributes `xessa.editor.groupOverrideHints` (enum, default `"always"`, enum descriptions). |
| `packages/vscode/README.md` | One row in the extension `## Settings` list with the default. (`docs/usage.md` left to the parallel docs worker; the root README has no settings list.) |
| `tests/extension/group-hints.test.ts` | New pure tests for all hint rules and the `inside`/`off` filters. |
| `.ai/reports/CSSX-GROUP-GHOST-HINTS.md` | This report. |

## Rules implemented

| Rule | Implementation | Test |
|---|---|---|
| Hint only direct use-site declarations whose exact property appears in the resolved group | `groupHints` builds a property→authored-value map from `symbol.defaults` and walks direct `declarations`; unresolved/ambiguous names are absent from the resolved map | `hints only declarations that shadow a resolved default`, `unknown and ambiguous groups get no hints` |
| Last default wins, verbatim | map overwrite in authored order; `GroupDefault.authored` keeps base + `@variant value` segments and `!important`; `$tokens` untouched | `repeated default property shows the last value`, `keeps inline variants, !important and unresolved $tokens verbatim` |
| One zero-width range at `Declaration.span.end`, first declaration per property per block | `rangeAt(lineStarts, span.end, span.end)`; per-block `Set` skips later duplicates | `places one zero-width range …`, `… first use-site declaration only` |
| `always` / `inside` / `off` | `filterGroupHints` keeps all, filters by `hint.site` containment of `selection.active`, or returns none | `group override hints: mode filter` (all five tests) |
| Appearance | one `createTextEditorDecorationType({ after: { color: ThemeColor, fontStyle: "italic", margin } })`; per-decoration `renderOptions.after.contentText = hint.value` | manual (see below) |
| Refresh without a second compile | provider polls `service.cached` after the diagnostics debounce and never calls `analyzeNow`; `document.version` guard in `apply`; non-xessa/non-file skipped | wiring in `controller.ts`; not unit-testable without `vscode` |
| No side effects | decoration-only provider; no edits/diagnostics/hover/format changes; `off` and close clear decorations | existing extension suite green |
| Custom properties and imported groups | exact property map includes `--x`; resolution comes from `analysis.groups` so styles imports work | `keeps … --gap …`, `resolves a styles-imported group`, `a local definition shadows an imported one` |

## Validation

| Command | Exit | Result |
|---|---|---|
| `bun test tests/extension/group-hints.test.ts tests/extension/provider.intelligence.test.ts` | 0 | 132 pass / 0 fail (5,513 expect calls) |
| `bunx tsc -p packages/vscode/tsconfig.json --noEmit` | 0 | no diagnostics |
| `bunx biome check` on the six changed code/manifest paths | 0 | clean after import/format fixes |

Manual, not asserted by a test: VS Code applies `ThemeColor("editorCodeLens.foreground")`, renders the
`after` attachment in italics with the 0.7em margin, and keeps it zero-width (no selection/column
change). The VS Code API exposes no way to read rendered decoration output from the unit suite, so
colour, italics and visual placement remain a manual editor check.

## Notes and handoff

- Changed `groups.ts` beyond the prompt's file list: the existing `GroupDefault.value` is the base
  value only, so inline variants could not be shown verbatim. A separate `authored` field was added
  and only the hint path reads it; hover continues to render `value`, preserving rule 7.
- The provider waits for the diagnostics analysis through `AnalysisService.cached` (bounded retries,
  no compile of its own), so a keystroke still triggers one analysis, not two.
- Pre-existing parallel-worker changes under `docs/`, `SPECIFICATION.md`, `packages/compiler/` and
  `tests/compiler/` were left untouched.
- Next: fresh `verify` session runs the full gate; then a real-editor manual check of the rendered
  ghost (theme colour, italic, zero width).

## Correction addendum (harness expectations)

Independent verification found two harness gaps caused by the new setting/provider, fixed without
changing feature behaviour:

| Path | Change |
|---|---|
| `packages/vscode/test/ui/config.js` | Settings matrix adds `xessa.editor.groupOverrideHints` to `DEFAULTS` (in manifest order) plus its enum; the type assertion now accepts string settings and still checks the exact manifest inventory. Adds an `inside` → `off` → `always` round-trip assertion for the setting (rendering remains manual). |
| `tests/stress/editor/vscode-host.ts` | Fake host gains `ThemeColor`, `window.visibleTextEditors`, and the three window listener registrations; `createTextEditorDecorationType` was already tracked. |
| `tests/stress/editor/activation.test.ts` | Counts updated for the decoration type and three window listeners: 32 tracked disposables per cycle, 33 context subscriptions; kind map extended. |

Validation after the correction: `bun run verify` exit 0 — 1395 pass / 2 skip / 0 fail across 100
files; extension host 15 scenarios / 951 assertions. One repeated gate run flaked on
`tests/stress/fs/watch.test.ts` "rename in place" (old artifact not pruned yet); that file passed in
isolation on re-run, and the next full gate was green. The separate `cli-watch` timeout did not recur.

## Real-host divergence correction (range contract + artifact provenance)

The owner reported no ghosts in the real dev host and packaged VSIX.

- **Artifact provenance.** The committed/ignored `packages/vscode/xessa-0.1.0.vsix` packaged at
  14:32 contained none of `groupOverrideHints`, `editorGhostText.foreground`,
  `createTextEditorDecorationType` or `XessaGroupHintsProvider`, and its manifest had no
  `xessa.editor.groupOverrideHints`. The stale `dist/extension.js` the dev host loaded predated the
  feature too. Rebuilt with `bun run --cwd packages/vscode build` and
  `cd packages/vscode && bunx @vscode/vsce package --no-dependencies`; the new VSIX greps 2 ×
  `XessaGroupHintsProvider`, 2 × `groupOverrideHints`, 1 × `editorGhostText.foreground`,
  1 × `createTextEditorDecorationType`, and the manifest contains the setting.
- **Range contract.** `vscode.DecorationOptions.range` must not be empty. The hint now covers the
  whole declaration span (`Declaration.span.start` → `span.end`) instead of a zero-width point at
  `span.end`; the `after` attachment still lands at the authored end, before the terminating `;`.
  `site` still drives `inside` mode. The regression suite asserts every hint range is non-empty.
- **Appearance.** `contentText` is `// <value>`; attachment colour is
  `ThemeColor("editorGhostText.foreground")`, italic, `fontWeight: "300"`, margin
  `0 0 0 2em`. The attachment API has no `fontSize`; weight 300 is the closest lighter finish.
- **Real-host evidence** (VS Code 1.147, cached test build, CDP screenshot): use-site ghost nodes had
  `::after` content `"// 12px"` / `"// black"`, colour `rgba(255, 255, 255, 0.34)`, `font-style:
  italic`, `margin-left: 24px`. Screenshot:
  `.ai/reports/logs/group-hints-cdp-probe-final.png` (ghosts visible after `padding: 0.5rem;` and
  `color: blue;`; the 2em gap does not collide).

Focused checks after the fix: `bun test` 140 pass / 0 fail across the three requested files;
`bunx tsc -p packages/vscode/tsconfig.json --noEmit` exit 0; `bunx biome check` on the changed files
exit 0.

### Placement follow-up

The `after` attachment sat before the terminating `;` because `Declaration.span.end` excludes it.
`GroupHintSource` now carries the document text; the hint range extends past spaces/tabs to include
an immediately following `;` (never crossing a newline), and trailing whitespace is trimmed for a
semicolonless final declaration. The ghost now renders as `padding: 0.5rem; // 12px`. Tests assert the
range ends after the `;`, at the value when absent, and is never empty (`bun test` 141 pass / 0 fail).
New real-host screenshot: `.ai/reports/logs/group-hints-cdp-placement.png`.



