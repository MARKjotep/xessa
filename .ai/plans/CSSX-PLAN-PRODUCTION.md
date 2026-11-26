# Xessa Plan — Production readiness (v0.1 release)

**Status:** PP0–PP3, **PP4a** and **PP5a** executed 🟢 and verified on 2026-11-26 — `@xessa/compiler`,
`@xessa/cli` and the alias `xessa` **0.1.1 are published on npm** and passed a clean-environment
registry check. Tag `v0.1.1` is on `2abfbdf`. The
pre-release feature wave landed under an explicit owner scope change (2026-11-26); **PP4b (VS Code
Marketplace extension) and PP5b remain 🔴 deferred** by the owner.
**Owner decision 2026-11-26: publish npm only for now** — PP4a (`@xessa/compiler`, `@xessa/cli` and
the alias) executed 2026-11-26; PP4b (the VS Code Marketplace extension) is deferred.
Created 2026-11-26 against the editor-intelligence handover `.ai/HANDOVER.md` (A45–A51 landed,
`bun run verify` 892 pass / 0 fail across 45 files). **Revised 2026-11-26** against the current
`.ai/HANDOVER.md`: the campaigns that parked this plan are closed 🟢 — the stress-testing campaign
`.ai/plans/CSSX-PLAN-TESTING.md` (TT0–TT8) and the UI/UX validation campaign
`.ai/plans/CSSX-PLAN-UI.md` (U0–U7) — and the 19-defect integration campaign
(`.ai/reports/CSSX-FIX-INTEGRATION.md`), CSSX-A52 (map format), CSSX-COLOR-TOKENS (zero-config
semantic tokens) and CSSX-U07 (`!` completion) landed on top. PP0 re-verified the baseline on this
tree before any phase here executed.

**Feature wave (owner scope change, 2026-11-26):** the owner brought five language/output features
forward into 0.1.0 before the release: `css-dir` value lists (F18, ADR-0019), `map-inherit` opt-out
(F20, ADR-0020), opt-in `import-css` side-effect map import (F21, ADR-0021), minified output by
default (F22, ADR-0022) and multi-line group hovers (F23), plus the ninth example `examples/modules`.
A later owner decision added opt-in media-run merge grouping (F25, ADR-0024) with `safe` still the
default. All landed and gated; PP0–PP2 were re-run on the final tree.

The tree this revision is written against (final post-feature-wave gates, 2026-11-26):
`bun run verify` **1351 pass / 2 skip / 0 fail** (99 files), extension host **15 scenarios /
928 assertions** (`navigation=42`), browser **96/96** (32 per engine — PP0's recorded conflict is
resolved and `docs/compatibility.md`/`docs/cascade.md` now carry 96/96), and `bun run release:check`
green with **nine** examples and a VSIX of **18 files / 140.6 KB**.

The language, compiler, CLI and editor surface are feature-complete for v0.1: CSSX-A52's named-const
class map was the last unprompted output change (one `export const` per class in first-appearance
order, no default export and no object literal; `map-types` opt-in with `emit-types` as the deprecated
alias; the `import-css` / `output.importCss` setting removed there and reintroduced opt-in by
ADR-0021). The remaining work is release engineering, not semantics. Both former release blockers in
`docs/known-limitations.md` §2 — the CLI `bin` entry pointing at TypeScript source and the untrimmed
VSIX payload — are fixed and gated (PP1; VSIX trimmed 84 → 18 files, 136.06 KB on this tree), the manifest placeholder URLs are
replaced (PP2a), and the only editor smoke residue that needs a human is the three rows in PP3.
`bun run release:check` (`docs/release.md` "Aggregate gate") is the authoritative gate for every
phase below; publishing is irreversible per its "Rollback" section — a bad release is superseded by a
new version, never withdrawn.

Ownership: every phase is executed by `code` with lead verification of the gate results. PP4a executed
2026-11-26; PP4b still requires explicit owner authorization before any commit, push, tag or publish.
No commit/push/tag/publish/reset/stash beyond the recorded release without new authorization.

## Implementation Progress

| Phase / item | Deliverable | Acceptance condition | Status |
|---|---|---|---|
| PP0 · Baseline re-verification | Run `bun run verify`, `bun run test:browser` and full `bun run release:check` on the current tree; record actual numbers/durations in this table. **Recorded 2026-11-26:** verify 1225 pass / 2 skip / 0 fail (1227 tests, 89 files, 67.6 s; host 14 scenarios / 856 assertions); browser **96/96** (32 per engine, 82.3 s); `release:check` green in 156.7 s — VSIX **84 files / 309.78 KB**, examples step builds **seven** (no `portfolio`) | All three green; the recorded verify counts match 1225 pass / 2 skip / 0 fail across 89 files and the host suite 14 scenarios / 856 assertions; browser totals recorded from the actual run (the 75/75 and 96/96 records conflict); the produced `xessa-0.1.0.vsix` size/file count recorded, and the example step's coverage noted (docs list seven examples; eight exist — see PP2c) | 🟢 |
| PP1a · CLI `bin` entry | `@xessa/cli` `bin` → Node-compatible `dist` entry; affected tests and docs updated. **Landed 2026-11-26:** `bin.xessa` → `./dist/index.js` (= `main`), `node packages/cli/dist/index.js --version` → `0.1.0`, scaffold test pins `bin === main`, docs/README actuals; **shebang residual closed in PP2 Stage 1 (2026-11-26):** source/build now `#!/usr/bin/env node`, source-line pin added | `node packages/cli/dist/index.js --version` works from a clean checkout after build; `bun test`/`bun run verify` green; `docs/known-limitations.md` §2 row and `docs/release.md` payload rows updated | 🟢 |
| PP1b · VSIX payload | `.vscodeignore` in `packages/vscode` excluding `src/`, `test/`, `tsconfig.json`. **Landed 2026-11-26:** VSIX 84 files / 309.78 KB → **18 files / 134.59 KB** (134.57 before the PP2a URL slug); `src/**`, `test/**` and `tsconfig.json` absent, main/icon/language/grammar paths resolved from the unpacked package | `vsce package` succeeds; recorded file count/size in `docs/release.md` refreshed; extension still activates from the trimmed VSIX | 🟢 |
| PP1 · Packaging gate | Both fixes integrated. **Gates 2026-11-26:** `bun run verify` 1225 pass / 2 skip / 0 fail (89 files; host 14/856); `release:check` exit 0 in 149.5 s (browser 96/96); compiler 307 / CLI 89 tarball files; VSIX listing inspected | `bun run release:check` green; tarball and VSIX contents inspected (`npm pack --dry-run --json`, `unzip -l`) | 🟢 |
| PP2a · Manifest URLs | Replace placeholder `https://github.com/xessa/xessa` repository/homepage URLs with the owner-decided canonical URL `https://github.com/MARKjotep/xessa` (decision recorded 2026-11-26). **Landed 2026-11-26:** repository `.git`, `#readme` homepage and `/issues` bugs swapped on `packages/vscode/package.json`; `docs/release.md` step 1 now records the replacement instead of instructing it; `grep -rn "xessa/xessa" packages docs README.md` exits 1 | Manifest consistent across compiler/CLI/extension; no placeholder URLs remain | 🟢 |
| PP2b · CHANGELOG 0.1.0 | `CHANGELOG.md` entry for 0.1.0 covering the full shipped surface. **Landed 2026-11-26:** single `[0.1.0] - 2026-11-26` entry merges the former `[Unreleased]` material with the shipped compiler/CLI/extension surface — `@group`, `$keyframes`, runtime override, A45–A51/U07 editor wave, the 19-defect Fixed list, CSSX-A52 breaking map format, semantic tokens, `examples/portfolio` + `docs/usage.md`, and a known-limitations link; tag lands at PP4 (bump the date if the owner releases later). **Post-PP2 additions (2026-11-26):** the CHANGELOG entry was extended again for F18/F20/F21/F22/F23 and examples/modules (ADRs 0019–0022) | Entry lists the shipped feature set and links the known limitations; matches tag date | 🟢 |
| PP2c · Docs consistency | README, `docs/known-limitations.md`, `docs/release.md`, `docs/compatibility.md`, `docs/cascade.md` and `docs/usage.md` aligned with PP1/PP2. **Landed 2026-11-26:** `portfolio` added to `release:check` (eight examples; committed output identical in a temp build); browser totals `75/75`/25-per-engine → **96/96, 32 per engine** in compatibility/cascade/README; `import-css` only remains as ADR-0014 history, no `src/index.ts` bin path or default-object claims; §2 shebang caveat replaced with the node-shebang behavior; usage matches the four shipped settings. **Post-PP2 additions (2026-11-26):** the docs set was extended again for F18/F20/F21/F22/F23 and examples/modules (ADRs 0019–0022). **Post-consolidation note (2026-11-26):** docs touched again for optional configuration/defaults (ADR-0023) — README quick start + defaults table, configuration, usage, release examples step and CHANGELOG; verify counts refreshed to 1288 pass / 2 skip / 0 fail and host 14/872 | No stale counts, paths, placeholder URLs or removed-setting references remain in the v0.1 docs; the browser-total conflict is resolved against PP0's actuals; lint green | 🟢 |
| F18 · `css-dir` value lists | Owner-requested comma-separated in-workspace stylesheet destinations in `@setup` (`css-dir: "../client", "../src";`), each resolved exactly like the single-value form, with one plan artifact and manifest record per destination; scoped exception to the §3.2 single-scalar rule in ADR-0019. **Landed 2026-11-26:** 8 planner + 8 decode/diagnostic + 5 CLI integration tests and 1 watch case; `bun run verify` green (1248 pass / 92 files) | Single authored paths unchanged byte-for-byte; every copy written, and `clean`/watch/`--json` cover all copies; empty/duplicate item → `XESSA2001`, external item → `XESSA5001` | 🟢 |
| F20 · `map-inherit` opt-out | `@setup { map-inherit: false; }` / `output.mapInherit` (default `true`) keeps a style-merged module's class bindings out of the importer's `map.js`, `.d.ts` and `classes` while its CSS still merges in imported-first order; the module's own map is unaffected and excluded bindings never raise `XESSA4001`; ADR-0020 amends ADR-0014 §3. **Landed 2026-11-26:** 7 compiler + 4 integration tests; editor key/boolean completion and host assertion (857) | Default output byte-identical; precedence `file ?? project ?? true`; `module: true` + `map-inherit: false` silent and rule-only | 🟢 |
| F21 · `import-css` opt-in | `@setup { import-css: true; }` / `output.importCss` (default `false`) emits exactly one relative `import "./x.css";` at the top of `map.js`; the first `css-dir` destination is canonical; suppressed when no stylesheet is emitted (`emit-css: false`, `module: true`); `.d.ts` untouched; ADR-0021; `docs/usage.md` build-on-demand / Code Runner section. **Landed 2026-11-26:** 3 test files (17 compiler + 6 CLI + editor completion), host key count 14 (858) | Default CSSX-A52 map byte-identical and importable by plain Node with no loader; specifier is POSIX-relative from the planned map to the planned stylesheet | 🟢 |
| F22 · Minified output by default | `minify` / `output.minify` default `true` in the compiler, CLI and editor planning, with `--no-minify` / `minify: false` opt-outs; emitted CSS only — formatter, class maps, `.d.ts` and source-map rules unchanged; ADR-0022. **Landed 2026-11-26:** 31 default-output goldens regenerated + 3 new `expected/minified` goldens, 24 test files updated; all nine examples rebuilt minified (the eight pre-existing stylesheets 29 004 B → 24 034 B before `modules`); `verify` 1283 pass / 95 files, host 866 | Opt-outs reproduce the previous expanded bytes; repeat builds hash-identical; browser pretty-vs-minified parity 96/96 | 🟢 |
| F23 · Group hover readability | `@group.<name>` hovers render defaults as a real Markdown bullet list (one ``- `property: value` `` line per declaration, authored order preserved) plus a separate bulleted **Overrides at this use site** section (property names only; absent without overrides, never on definitions); empty groups keep the single italic line. **Landed 2026-11-26:** exact-Markdown pins in `provider.intelligence.test.ts` + host hover assertion (866) | No inline soft-collapse; compiler output, diagnostics and ADRs untouched | 🟢 |
| EXAMPLE · `examples/modules` | Ninth example: four `.cssx` files with **no `exclude` list**, a `module: true` trio (tokens/card/ribbon), a `map-inherit: false` ribbon, a `css-dir` list to `generated/styles` + `client/`, and a hand-written `client/index.html`; registered in `release:check` (nine examples). **Landed 2026-11-26:** both CSS files 512 B with identical SHA-256; map exports `card`/`cardIcon`/`page`, no `ribbon`; two builds, `clean`→rebuild and `release:check`'s rebuild all hash-identical | A build with no `exclude` stays quiet; `clean` removes only the three artifact records and keeps `index.html`; README/usage/release docs list nine examples | 🟢 |
| DEFAULTS · zero-config defaults | Optional `xessa.config.json` for project runs (nearest `package.json` root, `include` default `["**/*.cssx"]`), `compiler.strict` default `true`, explicit `mediaGrouping: "safe"`, module markers replacing example `exclude` lists, and a conditional `--config` examples step. **Landed 2026-11-26:** seven boilerplate configs deleted; `overrides`/`groups` keep only `classes.prefix`; config-less examples use a minimal `package.json` boundary; ADR-0023 + README/configuration/usage/release/CHANGELOG; `tests/integration/cli-config.test.ts` covers config-less discovery, default include, strict default and `"strict": false`; `verify` 1288 pass / 2 skip / 0 fail (95 files, host 14/872), `release:check` 2:41 (browser 96/96, nine examples, VSIX 18 files / 136.13 KB), lint green. All non-`basic` example hashes unchanged; `basic` source/output drift is pre-existing working-tree content recorded in `.ai/reports/CSSX-DEFAULTS.md` | Config-less build works with the default scope and empty discovery still exits 2; unknown keys exit 2 by default and warn with `strict: false`; no `exclude` remains in examples; repeat builds are hash-identical | 🟢 |
| MEDIA · merge grouping (opt-in) | Add `mediaGrouping: "merge"` as an opt-in third mode: keep the safe adjacent pass, then merge same-selector/same-chain/same-condition/same-native-context conditional runs across declarations whose frozen property families are provably disjoint; `all` and `var()` are wildcards/barriers; native blocks are barriers; iterate to a fixpoint. Expose `@setup { media-grouping: merge \| safe \| none; }` (defaults < project config < file, `XESSA1001` in-bounds on invalid values), editor value completion + Markdown hover card (15 setup keys), ADR-0024, browser merge-vs-none differential. **`safe` stays the default**, so default-output goldens and all nine examples remain byte-identical. **Landed 2026-11-26:** compiler family + merge modules, compiler/CLI/editor wiring, 32 new family/merge/setup tests, CLI config default/override tests, intelligence exact-Markdown pin, host count 15 + hover assertion, grouping spec 27/27 across three engines; browser `block-conditions` merge CSS 320 B → 286 B while computed styles stay equal. **Gates:** `verify` 1323 pass / 2 skip / 0 fail (98 files; host 14 scenarios / 880 assertions), `release:check` exit 0 in 159.5 s (browser 96/96, nine examples, VSIX 18 files / 138.35 KB), `lint` green; all example CSS SHA-256 values equal the pre-change baseline and double builds are hash-identical | Same-family/shorthand/different-selector/different-condition/different-context/wildcard/native-block cases blocked; merge never the default; all example SHA-256 values unchanged; `verify`/`release:check`/`lint` green | 🟢 |
| IDS · selector completion | Typing `#` in selector position lists the current document's id selectors as `selector` items (`#panel`, detail `id selector`), one per distinct name in first-appearance order, narrowed by the typed prefix. Accepting replaces the typed `#…` word range so exactly one `#` remains. Collection covers base selectors, `&` nesting, comma lists and `:is()`/`:not()`/`:has()` arguments, includes `:global(#x)`, and skips strings, comments, attribute values and declaration values. Ids are document-global, never renamed or mapped, and emit byte-for-byte. Value `#` on a colour property stays colour/hex only; selector `#` never offers colours. **Landed 2026-11-26:** `collectIdSelectors()` + `scanSelectorIds()` in `intelligence.ts`; hash branch in the existing `selector` state; 3 intelligence tests; additive host selector/value rows in `packages/vscode/test/ui/completions.js` (contexts 23 → 25); docs/usage §5.1/§5.2, extension README, CHANGELOG. **Gates:** `verify` 1326 pass / 2 skip / 0 fail (98 files; host 14 scenarios / 899 assertions), `release:check` 165.0 s (browser 96/96, nine examples, VSIX 18 files / 138.75 KB), `lint` green (0.31 s) | Selector `#` offers the document ids with correct labels/kind/detail and single-`#` acceptance; narrowing works; value/selector no-leak directions pinned; existing class/`&`/`:` states unchanged; all three gates green | 🟢 |
| RENAME · class selectors (single file) | Renaming a class token in a selector (base, `&` nesting, comma lists, `:is()`/`:not()`/`:has()` arguments) updates every non-global occurrence of that class name in the current `.cssx` document, replacing the name bytes only (the leading dot survives). `:global(...)` occurrences are excluded from a normal rename and refused when selected; an invalid CSS identifier, a class name that already exists in the file, and non-class tokens are refused; renaming to the identical name is a pinned no-op edit set. `prepareRename` reports the class-name range with the authored name as placeholder. JSX, the generated map and `.d.ts` are untouched and follow the next build (TypeScript catches a changed binding; literal `className="…"` strings are not). **Landed 2026-11-26:** `renameClass()`/`CLASS_NAME_PATTERN` + exported `classAt()` and the class branch in `renameAt()` (`intelligence.ts`); class branch in `prepareRename` and provider edits (`providers/navigation.ts`); 4 intelligence tests; real-host class rename with exact before/after text, prepare range/placeholder and `:global(...)` refusal in `packages/vscode/test/ui/navigation.js` (navigation 30 assertions); docs/usage §5.2, known-limitations §1/§5, CHANGELOG. **Gates:** `verify` 1330 pass / 2 skip / 0 fail (98 files; host 14 scenarios / 905 assertions), `release:check` 165.0 s (browser 96/96, nine examples, VSIX 18 files / 138.91 KB), `lint` green (1.0 s) | Every non-global same-name occurrence edited and nothing else (dot kept, nesting/comma/pseudo shapes covered); global excluded and refused; invalid/existing/non-class refusals pinned; token/group/keyframe behaviour unchanged; host suite green; all three gates green | 🟢 |
| RENAME · id selectors (single file) | Renaming an id token in a selector (base, `&` nesting, comma lists, `:is()`/`:not()`/`:has()` arguments, `:global(#x)`) updates every occurrence of that id name in the current `.cssx` document, replacing the name bytes only (the leading `#` survives). Ids have no local/global split, so `:global(#x)` occurrences are included. Invalid CSS identifiers, an id name that already exists in the file and non-id tokens are refused; renaming to the identical name is a pinned no-op edit set. `prepareRename` reports the id-name range with the authored name as placeholder. JSX/HTML `id="…"` anchors, inbound links, the generated map and `.d.ts` are untouched, and ids are not in the map. **Landed 2026-11-26:** `collectIdOccurrences()` + exported `idAt()` + `renameId()` and the id branch in `renameAt()` (`intelligence.ts`); id branch in `prepareRename` (`providers/navigation.ts`); 4 intelligence tests; real-host id rename with exact before/after text, hash survival, same-named class and attribute-value neighbours untouched, plus an existing-id refusal in `packages/vscode/test/ui/navigation.js`; docs/usage §5.2, known-limitations §1/§5, CHANGELOG. **Gates:** `verify` 1344 pass / 2 skip / 1 fail (99 files; host 14 scenarios / 912 assertions, navigation 37); `lint` green (449 files); browser 96/96 green. The single `verify` failure is **pre-existing and unrelated**: the untracked `examples/portfolio` authors `gutters` but reads `$space.gutter`, so `cli-config`'s example loop exits 1; `release:check` stops at that same `verify` step. Task scope, host and browser checks are green. | Every occurrence edited and nothing else (hash kept; base/`&`/comma/pseudo/`:global()` shapes covered); invalid/existing/non-id refusals pinned; class/token/group/keyframe rename and id completion unchanged; host suite green; docs/records persisted. **Gate follow-up:** the stale `examples/portfolio` reference that blocked this run was fixed afterwards in CSSX-FIX-PORTFOLIO-TOKEN (`$space.gutter` → `$space.gutters`), and the final REFS run made every gate green (`verify` 1351 pass / 2 skip / 0 fail with host 15 scenarios / 928 assertions; browser 96/96; `release:check` 173.9 s; VSIX 18 files / 140.6 KB) | 🟢 |
| ATTR · attribute-selector coverage | Additive coverage for native attribute selectors: operator/flag/namespace matrix (`[attr]`, quoted and unquoted equality, the `~=`, `^=`, `$=` and `*=` operators, dash-match, `i`/`s`, namespaced form and inner whitespace), byte-preserved values (`".icon"`, `"#id"`, `"A & B"`, `"$token"`, URL, escaped quote, unicode), selector composition and prefixing isolation; class rename leaves attribute values untouched and completion is inert inside a quoted value; one attribute-driven `states` declaration proven in three engines; compatibility §1 row. **Landed 2026-11-26:** new `tests/compiler/attribute-selectors.test.ts` (7 tests), 2 naming pins, 1 rename pin and 1 completion pin; `states` adds `&[data-state="open"] { background-color: rgb(10, 20, 30); }` (189 B CSS) asserted on `state-base`; browser **96/96** including the `states` pretty/minified and safe/none/merge parity in Chromium, Firefox and WebKit. **Gates:** `verify` **1341 pass / 2 skip / 0 fail** (99 files, 67.31 s; host 14 scenarios / 905 assertions), `release:check` exit 0 in **166.23 s** (browser 96/96, nine examples, compiler tarball 323 / CLI 89, VSIX 18 files / 138.91 KB), `lint` exit 0 (458 files). No compiler behaviour change; exotic combinations remain tested-not-complete per compatibility §4 | Matrix and value cases pinned byte-for-byte; attribute contents never renamed or mapped; no class suggestions inside a quoted attribute value; one attribute-driven computed style green in all three engines; pretty/minified and grouping parities unchanged; docs/records persisted; all three gates green | 🟢 |
| FIX · stale importer diagnostics | An open importing document re-analyzes when an imported `.cssx` module changes or is saved: `.cssx` change/save/close invalidates every cached document state and pending debounce in `AnalysisService` (generation-guarded so an in-flight result cannot repopulate the cache) and re-schedules all open `.cssx` documents on the existing 150 ms debounce. No reverse-import index, watcher or poller; the disk-backed module graph makes save the diagnostic trigger, and module-internal problems stay logged. **Landed 2026-11-26:** host repro `packages/vscode/test/ui/module-refresh.js` (red before the fix: 20 s timeout waiting for `XESSA2001` in the untouched importer) covers `$token` and `@runtime` renames, the clearing edit and the module's own refresh; `invalidateAll` unit pins in `provider.analysis.test.ts`; CLI pin in `tests/integration/cli-build.test.ts`. **Gates:** `verify` **1348 pass / 2 skip / 0 fail** (99 files, 71.54 s; host **15 scenarios / 923 assertions**), `release:check` exit 0 (browser 96/96, nine examples, VSIX 18 files / 139.2 KB), `lint` green. | Importer reports `XESSA2001` after a dependency rename/save without being edited (both `$` and `@runtime`) and clears after the fix; no watcher added; debounce preserved; CLI `check` exits 1 with JSON `XESSA2001`; docs/records persisted; all three gates green | 🟢 |
| REFS · reverse references | Find All References from a `$token`/`@runtime` definition returns the definition (honouring `includeDeclaration`) plus every use that resolves to it across workspace `.cssx` files; from an importer it returns the same set. Resolution uses each file's own analysis: namespaced aliases, unqualified and style imports count; local shadows, ambiguous unqualified imports (`XESSA2001`) and transitive re-exports are excluded; locations are deduped and sorted. The scan is on demand, bounded to 200 candidates (workspace folders plus the current directory for a standalone file), excludes `node_modules`/`dist`/`generated`, and adds no watchers. Rename stays single-file. **Landed 2026-11-26:** `tokenDefinitionAt()`/`resolveTokenReference()`/`referencesToToken()` in `intelligence.ts`; workspace scan, open-document text preference and provider wiring in `providers/navigation.ts`; 3 unit tests in `tests/extension/provider.navigation.test.ts`; real-host definition/importer (alias + unqualified + runtime)/shadow/ambiguous exact-URI cases in `packages/vscode/test/ui/navigation.js` (37 → 42 assertions); docs/usage §5.2, known-limitations §5, CHANGELOG, board bug 27. **Gates:** `verify` **1351 pass / 2 skip / 0 fail** (99 files, 72.6 s; host 15 scenarios / 928 assertions), `release:check` exit 0 in **173.9 s** (browser 96/96, nine examples, VSIX 18 files / 140.6 KB), `lint` green (459 files) | Definition and both importer directions return the same exact URI/range set; shadowed and ambiguous uses excluded; `includeDeclaration: false` drops only the definition; existing navigation cases unchanged; docs/records persisted; all three gates green | 🟢 |
| FIX · portfolio stale token | `examples/portfolio/src/layout.cssx:84` `calc(100% - 2 * $space.gutter)` → `$space.gutters`, completing the owner's rename; generated `portfolio.css` and `portfolio.map.js` rebuilt. **Provenance:** the owner's rename test left the importer behind and `XESSA2001` surfaced it through the config-less example loop. **Landed 2026-11-26:** `xessa check --json` exit 0 with zero diagnostics (was exit 1, one `XESSA2001` at `layout.cssx:84:38`); two consecutive builds byte-identical (`562ba7cb…` CSS, `2d4283c3…` map) and unchanged after `release:check`'s rebuild; no compiler/CLI/editor change | `check` exits 0 with no diagnostics; two builds and `release:check`'s rebuild byte-identical; `verify` 1345 pass / 2 skip / 0 fail, `release:check` exit 0 (browser 96/96), `lint` exit 0 (458 files) | 🟢 |
| PP3 · Editor manual smoke (residue) | Verify the three manual rows in §PP3 in an Extension Development Host / browser | Each row verified, or explicitly recorded as not verifiable in this environment with the reason. **Owner-verified 2026-11-26:** picker, Dark+/Light+ tokens and portfolio toggle all pass; one group-body completion defect found and fixed (board bug 25, CSSX-FIX-GROUP-COMPLETE) | 🟢 |
| PP4a · npm publication | Tag v0.1.0 on the authorized commit, then publish `@xessa/compiler` and `@xessa/cli` | **Explicit owner authorization first**; `npm publish --workspace @xessa/compiler --access public` then `--workspace @xessa/cli --access public` succeed; `npm view` resolves 0.1.0 for both. **Executed 2026-11-26:** 0.1.0 published first (compiler integrity `sha512-aAKqebvb…`, CLI `sha512-tbRmwcP+…`), then **0.1.1 for compiler, CLI and the alias `xessa`** with tag `v0.1.1` on `2abfbdf` — `.ai/reports/CSSX-PP4A-COMPILER-PUBLISHED.md`, `CSSX-0.1.1-STAGING.md` | 🟢 published 0.1.1 2026-11-26 |
| 0.1.1 · packaging fixes | Clean `dist` before both package builds, ship `src/` so every `.js`/`.d.ts` map resolves (compiler 398 / CLI 89 tarball files), drop the stale CLI `importPath.*`, `await` the compiler README example and make the `docs/usage.md` quick start formatter-clean; bump compiler/CLI/root manifests to `0.1.1` (CLI pins compiler `0.1.1`), extension stays `0.1.0`. **Landed 2026-11-26 (commit `e55bcb0` + release prep):** verify 1351/2/0 (99 files, host 15/928), release:check green (browser 96/96, nine examples, VSIX 0.1.0), dry-runs exit 0 at 0.1.1; evidence `.ai/reports/CSSX-0.1.1-STAGING.md`. **All published by the owner 2026-11-26:** compiler 398 files (byte-identical to the local pack, `sha256 db7bf473…eda97f`), CLI 89, alias 4; tag `v0.1.1` on `2abfbdf` | compiler, CLI and alias live at `0.1.1`/`latest`; packed manifests clean (no `workspace:*`, no `importPath.*`, maps resolve); full gate green; `v0.1.1` tagged | 🟢 published 2026-11-26 |
| PP4b · Marketplace extension (deferred by owner 2026-11-26) | Publish the VS Code extension | Owner authorization; `cd packages/vscode && npx @vscode/vsce publish` succeeds for publisher `xessa` | 🔴 deferred by owner 2026-11-26; no publish without new authorization |
| PP5a · npm post-release | Clean-environment install and quick start against the npm packages | `.ai/reports/CSSX-PP5A.md` records `npx`/`bunx` and the `docs/usage.md` quick start end to end via `xessa build`. **Executed 2026-11-26 for 0.1.0 and 0.1.1:** all version paths `0.1.1`, build/check/format pass, installed maps resolve, alias stub 4 files/exits 1 | 🟢 checked 0.1.1 2026-11-26 |
| PP5b · extension post-release | Marketplace listing and local VSIX in a clean profile | `.ai/reports/CSSX-PP5B.md` records activation, diagnostics, completion, token colours, swatches and preview | 🔴 after PP4b |

(The former "PP3 · Deferred harness (optional)" row is closed without work in this plan: the UI
campaign's U1/U2 built the host harness and `packages/vscode/test/ui/checklist.js`; see
`.ai/reports/CSSX-U7.md`.)

## PP0 — Baseline re-verification

Deliverables: a recorded baseline before any release edit, so PP1 regressions are attributable.

1. `bun run verify` — expect **1225 pass / 2 skip / 0 fail across 89 files** (typecheck, Biome,
   unit/integration/extension-provider suites) and the extension host at **14 scenarios / 856
   assertions**; record the exact counts and durations.
2. `bun run test:browser` — record the actual totals per engine. The current records conflict:
   `docs/known-limitations.md` §6 says 96/96 (32 per engine); `docs/compatibility.md` and
   `docs/cascade.md` §5 still say 75/75 (25 per engine, CSSX-BROWSER-01). Whichever is true on this
   tree is the number PP2c propagates.
3. `bun run release:check` — the full aggregate gate from `docs/release.md`, including both builds,
   package metadata assertions, `npm pack --dry-run` checks, the examples step and `vsce package`;
   record the produced `xessa-0.1.0.vsix` size and file count. The recorded 214 files / 351.31 KB in
   `docs/release.md` predates the campaigns and A52's regenerated goldens — expect movement. Note
   whether the examples step covers `examples/portfolio` (docs list seven examples; eight example
   configs exist) — closing that gap is PP2c's job, not a PP0 blocker.

Dependencies: none (current working tree, uncommitted changes included).
Exit criteria: all three green with numbers pasted into the progress rows above. Any pre-existing
failure is reported separately and blocks PP4, not the docs work in PP1/PP2.

**Recorded baseline (2026-11-26, this working tree; gates run sequentially):**

| Gate | Exit | Elapsed | Key output |
|---|---|---|---|
| `bun run verify` | 0 | 67.6 s | 1225 pass / 2 skip / 0 fail (1227 tests across 89 files, 994 864 `expect()` calls); host 14 scenarios / 856 assertions (`semantic-tokens=21`); typecheck and Biome green |
| `bun run test:browser` | 0 | 82.3 s (Playwright 1.4 m) | **96/96** — 32 per engine (chromium / firefox / webkit). Confirms `docs/known-limitations.md` §6; the 75/75 (25 per engine) in `docs/compatibility.md` and `docs/cascade.md` §5 is stale |
| `bun run release:check` | 0 | 156.7 s | verify + browser green again; compiler tarball 307 files, CLI tarball 89 files; examples step builds seven (`basic`, `responsive`, `variables`, `jsx`, `custom-output`, `overrides`, `groups`) — `examples/portfolio` is **not** built though eight example dirs exist; `DONE Packaged: …/xessa-0.1.0.vsix (84 files, 309.78 KB)` |

The 84-file / 309.78 KB VSIX still carries the untrimmed payload (`src/` 27 files, `test/` 38
files, `tsconfig.json`) described in `docs/known-limitations.md` §2 and supersedes the 214 files /
351.31 KB recorded in `docs/release.md`; PP1b trims it.

Final post-feature-wave gates (2026-11-26): verify 1283 pass / 2 skip / 0 fail (95 files; host 14
scenarios / 866 assertions), browser 96/96, release:check green with nine examples, VSIX 18 files /
136.06 KB.

## PP1 — Packaging fixes

These are the two v0.1 release blockers in `docs/known-limitations.md` §2; nothing else in that table
is in scope.

**PP1a — CLI `bin` entry.** `packages/cli/package.json` declares `"bin": { "xessa": "src/index.ts" }`,
which only runs under Bun's TypeScript loader. Point it at the built Node-compatible entry
(`dist/index.js`, already the package `main`), update every test/doc that pins the `src` path
(`tests/integration/node-smoke/` expectations, `docs/known-limitations.md` §2, `docs/release.md`
tarball rows, the README install note once true), and confirm `node packages/cli/dist/index.js
--version` succeeds after a build. The tarball must still ship `dist/**` and whatever `src/**` the
recorded contents list claims — keep `docs/release.md` honest either way.

**PP1b — VSIX payload.** Add `packages/vscode/.vscodeignore` excluding `src/`, `test/` and
`tsconfig.json` (keep `dist/`, `out/`, `syntaxes/`, `media/`, `LICENSE`, `README.md`,
`language-configuration.json`). Re-run the packaging step and refresh the recorded
`DONE Packaged: … (N files, S KB)` line in `docs/release.md`.

Dependencies: PP0.
Exit criteria: `bun run release:check` still green; Node-only CLI invocation works without Bun;
`npm pack --dry-run --json` and `unzip -l xessa-0.1.0.vsix` contents inspected and consistent with the
recorded docs.

## PP2 — Metadata and docs finalization

**PP2a — Manifest URLs.** Replace the placeholder `https://github.com/xessa/xessa`
repository/homepage URLs in `packages/vscode/package.json` (verified present before the fix) and any
identical placeholders elsewhere. **Owner decision recorded 2026-11-26**: canonical repo URL is
`https://github.com/MARKjotep/xessa`. **Landed 2026-11-26:** the manifest replacement is applied
and `docs/release.md` records it; no placeholder remains.

**PP2b — CHANGELOG 0.1.0.** Author the 0.1.0 `CHANGELOG.md` entry from the shipped surface:

- Compiler, CLI and VS Code extension; `@group` (ADR-0017), the `$keyframes` namespace (ADR-0015,
  ADR-0018) and the runtime token override (ADR-0016).
- The editor intelligence wave (A45–A51: completion contexts, CSS function tooltips, units, named
  colors, hex palette, swatches) and CSSX-U07's `!` trigger with bang repair (never `!!important`).
- The 19-defect integration campaign: formatter terminator/sigil fixes, nesting and span bounds, CLI
  watch/clean/exit-code fixes, editor analysis and completion repairs
  (`.ai/reports/CSSX-FIX-INTEGRATION.md`).
- **CSSX-A52 map format (breaking for map consumers):** one named `export const` per class, no default
  export, no object literal, no CSS side-effect import; `map-types` opt-in with `emit-types` as the
  deprecated alias; the `import-css` / `output.importCss` setting removed; `XESSA4001` collision
  warnings (`.ai/reports/CSSX-A52.md`).
- CSSX-COLOR-TOKENS: zero-config semantic token colors (`.ai/reports/CSSX-COLOR-TOKENS.md`).
- `examples/portfolio/` and `docs/usage.md`.
- The honest limits in `docs/known-limitations.md`.

**PP2c — Docs consistency.** Beyond re-checking counts, paths and the README install note after PP1a:

1. Add `examples/portfolio` to `release:check`'s examples step and the `docs/release.md` list (seven →
   eight; confirm at execution whether the script enumerates names or discovers `xessa.config.json`s).
2. Resolve the browser-total conflict in `docs/compatibility.md` and `docs/cascade.md` §5 against
   PP0's recorded actuals (75/75 vs 96/96).
3. Grep the docs for stale references: the removed `import-css` / `output.importCss` setting,
   default-object class maps, and the `src/index.ts` bin path (README install note included).
4. Refresh the `docs/known-limitations.md` §2 rows after PP1 (a fixed blocker moves out of the table
   or the row states the new behavior) and keep `docs/usage.md` consistent with the shipped
   CLI/settings.

Dependencies: PP1 for the docs rows; the URL replacement can run any time after the owner answer.
Exit criteria: no placeholder URLs, no stale counts, paths or removed settings, CHANGELOG present for
0.1.0, lint green.

## PP3 — Editor manual smoke (the residue)

The 7-item checklist from the earlier handover is automated: `packages/vscode/test/ui/checklist.js`
(UI campaign U2) asserts all seven rows end to end inside the 14-scenario / 866-assertion host suite,
and the newer surfaces are host-asserted too — the semantic-token scenario (`semantic-tokens=21`),
U07's `!important` bang repair and the U01–U03 completion repairs. A full manual re-run of those rows
is not required; if the owner performs one anyway (`.ai/HANDOVER.md`'s 13-item checklist), any
surprise opens a defect task instead of being absorbed here.

PP3 owns exactly three manual rows:

1. **Native colour picker** (handover smoke item 6): click a swatch on a named/hex value, choose a
   value in the native dialog, confirm the write-back is lowercase `#rrggbb` (alpha only when non-1).
   No `vscode` API opens the dialog, so this cannot be automated.
2. **Token colours on Dark+ and Light+** (handover smoke item 3): the automated semantic-token
   scenario and the recorded DOM check cover the default 2026 Dark theme; the rendered
   teal/amber/variant-red pass on Dark+ and Light+ is visual (vision was unavailable in this
   environment). **Developer: Inspect Editor Tokens and Scopes** on `$spacing`, `$theme`, `var(--x)`,
   `$keyframes.spin` and an inline `@md` is the quick check.
3. **Portfolio theme toggle** (handover smoke item 12): serve `examples/portfolio`
   (`python3 -m http.server 4173`), click Auto / Light / Dark and confirm the control mirrors the
   emitted `:root` values from the CSSOM (Auto leaves the OS media query in charge). A browser check
   outside the Playwright suite; extending that suite is optional and not required by this plan.

Dependencies: PP0 (green baseline); can run in parallel with PP1/PP2.
Exit criteria: each row verified, or recorded as not verifiable in this environment with the exact
reason. Do not mark a row passed from unit tests alone — the handover explicitly separates the two.

## PP4a — npm publication (executed 2026-11-26)

**Executed 2026-11-26: compiler, CLI and the alias `xessa` are live at `0.1.1`** (compiler
first, CLI pinned to the exact compiler version; tag `v0.1.1` on `2abfbdf`). PP4b still needs a
separate owner authorization; no commit, push, tag or publish beyond the recorded release happens
without it. The steps below are retained for the next version. **Update 2026-11-27:** this historical
record predates the registry 404 check; the unscoped root is now private and is not published (npm
rejected the name as too similar). Only compiler → CLI remain.

1. Tag `v0.1.0` on the authorized commit.
2. `npm publish --workspace @xessa/compiler --access public`
3. `npm publish --workspace @xessa/cli --access public`

The shipped `CHANGELOG.md` date (`2026-11-26`) already covers the feature wave; bump it only if the
tag lands later. Post-checks: `npm view` both packages, a temp-dir install, `npx @xessa/cli --version`
(after installing the CLI for the local `xessa` bin), `npx -y @xessa/cli@0.1.0 --version` and
`bunx @xessa/cli@0.1.0 --version`. Drop the docs' registry caveat only after the publish succeeds.

Dependencies: PP0–PP3 complete including the PP2a URL decision; `bun run release:check` green
immediately before publishing.
Exit criteria: all npm artifacts resolvable at 0.1.1 (compiler, CLI and alias), with the compiler
first (the CLI pins it to the exact version `"@xessa/compiler": "0.1.1"`; npm does not rewrite
`workspace:*`, so a new compiler release means bumping the CLI dependency to the same version before
publishing the CLI). Publishing is **irreversible** (`docs/release.md` "Rollback"): the only remedy
for a bad release is a new version.

## PP4b — VS Code Marketplace (deferred by owner 2026-11-26)

Publisher `xessa`, a PAT with Marketplace *Manage* scope, then:

```sh
cd packages/vscode && npx @vscode/vsce publish
```

**Version rule:** 0.1.0 is still publishable later if the extension source is unchanged; otherwise
publish 0.1.1. In the meantime the local `xessa-0.1.0.vsix` is self-contained and can be distributed
by hand. Marketplace failure after npm success: retry or publish the VSIX from the UI; never
re-publish npm to match.

## PP5a — npm post-release verification (executed 2026-11-26)

**Executed against the registry on 2026-11-26 for 0.1.0 and 0.1.1 — 🟢**; report:
`.ai/reports/CSSX-PP5A.md` (install + `npx`/`bunx` versions + the §1.2 project end to end, including
`format --check`, plain-Node map import, `clean` and a configured rerun; the 0.1.1 section adds the
installed source-map and alias-stub checks).

1. `npm i @xessa/cli@0.1.1 && npx @xessa/cli --version`; `bunx @xessa/cli@0.1.1 --version`. The root is
   private and unpublished (npm rejected the unscoped `xessa` name); the local `xessa` bin comes from
   `@xessa/cli`.
2. Run the `docs/usage.md` quick start end to end with `xessa build`: optional config, two `.cssx`
   files, generated CSS/map, JSX import and a rendered page.
3. Record the checklist with actual outputs in `.ai/reports/CSSX-PP5A.md`.

Dependencies: PP4a 🟢. Exit criteria met 2026-11-26: actual outputs recorded; the two mismatches open
follow-ups rather than in-place edits to the published claim.

## PP5b — extension post-release verification

After PP4b: install the extension from the Marketplace **and** the local VSIX in a clean profile, and
confirm activation, diagnostics, completion, token colours, swatches and preview. Record actual
outputs in `.ai/reports/CSSX-PP5B.md`; a mismatch opens a follow-up task.

## Out of scope / deferred

- Token completion inside function arguments (`calc($ui.space|)`).
- A language server (LSP) for editors other than VS Code (`docs/known-limitations.md` §1).
- Cross-module rename of tokens and classes; container aliases; executable config.
- Editor formatting beyond the document-level parse→print pass.
- Reintroducing `@fn` (owner decision recorded 2026-11-25/26), making the CSS side-effect map import
  unconditional again (CSSX-A52 rationale; opt-in only per ADR-0021), or returning to the
  default-object class map (both superseded by CSSX-A52).
- Further compiler, CLI or language-service semantics work beyond the pre-release wave: the owner
  brought the output-planning features into 0.1.0 (see the feature-wave paragraph above), so these
  phases otherwise only package and publish the shipped language.
