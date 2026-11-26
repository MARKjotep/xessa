# CSSX-A12 — VS Code TextMate grammar and language configuration (P6)

## Summary

- Implement `packages/vscode/syntaxes/xessa.tmLanguage.json` per the approved UI contract (source.xessa, yellow alias scopes, magenta directives, category-distinguishable selectors).
- Add `language-configuration.json` (comments, bracket pairs, auto-closing, indentation) and the manifest `contributes` (language `xessa`, `.xessa` extension, aliases, grammar).
- Validate the grammar structurally and (if the toolchain installs cleanly) with vscode-textmate scope rendering over fixture samples.

**Status:** implemented and locally verified; `bun run verify` exit 0. Pending lead verification (`.ai/PROGRESS.md` untouched).

## Outcome

`packages/vscode` is now a real (unpackaged) VS Code extension manifest: the `xessa` language,
`.xessa` files, language configuration, a standalone `source.xessa` TextMate grammar and an
activation stub are wired. The grammar owns the whole file, uses no injections and has no runtime
dependency on `vscode-css`; its CSS-compatible patterns are vendored with standard `.css` scopes.
Highlighting is grammar-only and cannot affect compiler output.

## Created / changed files

Created:

- `packages/vscode/syntaxes/xessa.tmLanguage.json` (57 repository contexts, 109 includes,
  1129 lines after Biome formatting).
- `packages/vscode/language-configuration.json`.
- `packages/vscode/src/extension.ts` — activation stub: status bar item + activation message;
  disposables registered on `context.subscriptions`. Commands/providers remain A13 work.
- `packages/vscode/README.md` — what A12 ships, the scope map table, the yellow/magenta rationale
  and how to run the grammar tests.
- `tests/extension/grammar-harness.ts` — grammar/manifest readers, include/scope walkers, and the
  `vscode-textmate` + `vscode-oniguruma` renderer loader resolved from the extension package.
- `tests/extension/grammar.test.ts` — 19 structural tests (grammar, ordering, regex safety, scopes,
  manifest, language configuration).
- `tests/extension/grammar.scopes.test.ts` — 10 rendered-scope tests over the canonical, media,
  nesting and global fixtures plus synthetic edge cases.
- `.ai/tasks/CSSX-A12.md`, `.ai/reports/CSSX-A12.md`, `.ai/reports/logs/CSSX-A12.log`.

Changed:

- `packages/vscode/package.json` — real manifest: `publisher: xessa`, `engines.vscode ^1.85.0`,
  `main: ./src/extension.ts`, `activationEvents: ["onLanguage:xessa"]`,
  `contributes.languages` (`id: xessa`, aliases `Xessa`/`xessa`, `extensions: [".xessa"]`,
  `configuration: ./language-configuration.json`) and `contributes.grammars`
  (`language: xessa`, `scopeName: source.xessa`, `path: ./syntaxes/xessa.tmLanguage.json`).
  Dev dependencies added for tests/types: `@types/vscode ^1.85.0` (resolved 1.146.0),
  `vscode-oniguruma ^2.0.1`, `vscode-textmate ^9.3.2`.
- `bun.lock` — workspace devDependencies and the three resolved packages. This root lockfile change
  is the unavoidable consequence of requirement 4/3 (declaring the extension's test toolchain); no
  other package or root config was edited.

## Grammar design and vendoring decisions

- **Scopes**: only `.xessa`-specific scopes for Xessa-only constructs
  (`meta.variant.xessa`, `entity.name.function.xessa`, `keyword.control.directive.xessa`,
  `keyword.other.xessa`, `variable.other.xessa`, `variable.other.member.xessa`,
  `comment.*.xessa`, directive/at-rule/meta wrappers). Everything CSS-shaped uses the standard
  `.css` suffixes for the categories named in the UI contract (class, id, tag, pseudo, property,
  value, numeric, unit, important, function, at-rule, punctuation, string, comment-block).
- **No injection / no CSS extension dependency**: a single grammar with ordinary `include` chains
  against its own `repository`. `contributes.grammars` has no `injectTo`.
- **Ordering**: root is `#comment → #directives → #native-at-rule → #alias-block-start →
  #at-rule-generic → #block → #selector → #error-recovery`. `#directives` lists setup, use,
  variables, runtime, media-types in that order before any alias rule. In addition, both the alias
  `match` and the conditional-block `begin` carry a negative lookahead over the reserved directive
  **and** native at-rule names, so `@media`/`@supports` can never be captured by the alias rule even
  where `#conditional-block` is tried before `#native-at-rule` in a block body.
- **Alias shape**: `@` + `[A-Za-z0-9][\w-]*` with optional `+`-joined segments, so `@2xl` and
  `@xl+dark` are single tokens. Inline aliases use `name: "meta.variant.xessa
  entity.name.function.xessa"` (both scopes rendered); conditional blocks set
  `contentName: "meta.variant.xessa"` and the same begin-capture scope.
- **Balanced nesting**: `#selector` is a zero-width brace lookahead that ends *before* `{` (end
  `(?={" )`); `#block` consumes `{ … }` with balanced begin/end and recursively includes
  `#block-body`. Every context that contains `#selector`/`#nested-rule` includes `#block` first, so
  the zero-width selector end always hands off to a consuming block and nested rules keep their own
  braces (verified on nested rules, conditional blocks, media blocks and keyframe steps).
- **Declaration vs nested rule**: rule lookahead scans a statement for `{` before `;`/`}` while
  skipping quoted strings (`"(?:[^"\\]|\\.)*"` / single-quote equivalent), so `content: "{"` is a
  declaration and `[data-x="{"]` is a selector. Declarations anchor at statement starts
  (`^`, after `{`, `}`, `;`) and end at `;` or before the block's `}` — a missing `;` cannot leak
  across a block boundary.
- **Strings/comments inert**: string bodies have no patterns except escapes; block and line comments
  are separate contexts. `@`, `$`, `{`, `}` inside them never receive alias/variable/brace scopes.
  Line comments require preceding whitespace/line start (`(?<![^\s])//`), so `url(http://…)` is not a
  comment.
- **Recovery**: unterminated constructs do not open a context that can run away — the selector
  lookahead requires a same-line `{`, unresolved characters fall to `meta.fallback.xessa` (no
  colour), and stray braces become `punctuation.section.block.css`. `#fallback` is a patterns
  container so braces are punctuation and only non-space leftovers are meta.
- **Native at-rules**: dedicated contexts for `@media`, `@supports`, `@keyframes` (with
  `#keyframe-step` for `from`/`to`/`<percentage>`), `@font-face`, `@property`, `@layer`,
  `@container`, `@page`, `@charset`, `@import`, `@namespace`, and a generic fallback for unknown
  names. Preludes use `#media-prelude`: feature names before `:` are
  `support.type.property-name.css`, values/identifiers `support.constant.property-value.css`,
  `and|or|not|only` → `keyword.operator.logical.css`, numbers/units and punctuation. The prelude
  never includes `#alias`, so media conditions cannot render yellow.
- **Directive bodies**: `@setup`, `@variables`, `@runtime` reuse `#declaration` (keys therefore get
  `support.type.property-name.css` and values get variables/numbers/strings). `@use` handles the
  string, `as` → `keyword.other.xessa`, namespace → `entity.name.namespace.xessa`. `@media-types`
  uses a dedicated declaration whose key is an alias scope and whose value uses the alias-free
  media prelude.
- **Additions beyond the literal include graph**: `#block` (required for balanced braces) and
  `#at-rule-generic` (root recovery for unknown `@…;`/`@…{`) are the only extra root contexts.
  `#at-rule-generic` sits *after* `#alias-block-start` so known aliases stay yellow.
- **Known trade-off**: the selector lookahead excludes `@` in its prefix scan, so a selector whose
  attribute string contains a literal `@` before its `{` still parses its block correctly but the
  prelude text is not selector-scoped. Attribute strings themselves are inert.

## UI acceptance checks → implementation

| # | Check | Implemented by | Evidence |
| --- | --- | --- | --- |
| 1 | Media aliases (inline + block) are yellow and grouped as variants | `#alias.match` (`name: meta.variant.xessa entity.name.function.xessa`), `#conditional-block` / `#alias-block-start` (`beginCaptures.1` + `contentName: meta.variant.xessa`), `#alias` inside `#value` | Rendered `@md`, `@xl`, `@dark`, `@xl+dark`, `@compact` → `entity.name.function.xessa` (+ `meta.variant.xessa`); structural test `alias matcher accepts digits and + combinations…` |
| 2 | Directives are magenta and matched before aliases | `#directives` order, `#directive-*` `beginCaptures.1: keyword.control.directive.xessa`, reserved-name negative lookahead in alias rules, root `#directives` before `#alias-block-start` | Rendered `@setup`, `@media-types` → `keyword.control.directive.xessa` and **not** `entity.name.function.xessa`; structural test `directives are listed before any generic alias pattern` |
| 3 | Selector categories are distinguishable (`&`, `.`, `#`, type, pseudo-class, pseudo-element, combinator) | `#selector-class`, `#selector-id`, `#selector-type`, `#selector-pseudo-class`, `#selector-pseudo-element`, `#selector-parent`, `#selector-combinator`, `#selector-escape`, `#attribute-selector` | Rendered `.ui-button` class, `#app` id, `button` tag, `:hover`/`:nth-child` pseudo-class, `::before` pseudo-element, `&` parent, `>`/`+` combinator |
| 4 | Declarations: properties, values, `$var`/`$ns.member`, numbers/units, `!important`, `calc(`, inert strings | `#declaration`, `#value`, `#variable`, `#numeric`, `#important`, `#function-call`, `#string` | Rendered `display` property, `flex` constant, `$theme` + `primary` member, `12`/`px`, `!important`, `calc`, `"./theme.xessa"` only string scopes |
| 5 | Native at-rules/preludes and `:global` use CSS scopes, never alias yellow; grammar never affects compilation | `#native-at-rule` + `#media-prelude` (no `#alias`), `#selector-global` (pseudo-class scope + `#selector-base` argument), grammar-only change | Rendered `@media` → `keyword.control.at-rule.css` + `meta.at-rule.media.css`, `min-width` property, `dark` constant (not yellow); `:global` pseudo-class with `.external-icon` class inside |

Additional contract items: `as` → `keyword.other.xessa`; punctuation uses
`punctuation.section.block.css`, `punctuation.definition.group.css`,
`punctuation.terminator.rule.css` (plus comma/selector separators); `:global` argument re-enters
`#selector-base`; `@media-types` keys are treated as alias definitions (yellow) with alias-free
conditions; `@setup`/`@runtime` keys are property names, as approved.

## Language configuration

- `comments`: line `//`, block `/* */`.
- `brackets`: `{ }`, `[ ]`, `( )`.
- `autoClosingPairs`: the three bracket pairs, single/double quotes (not inside strings/comments) and
  `/* */`; `surroundingPairs`: brackets and quotes.
- `indentationRules`: `increaseIndentPattern: ^.*\{[^}"']*$` (opens on `{`),
  `decreaseIndentPattern: ^[^{}]*\}` (a line that closes a block).
- `wordPattern: (-?\$?[A-Za-z_][\w-]*|\\[^\s]+)` — covers `$name`, hyphenated names and escaped
  selector fragments.

## Validation evidence

Environment: Bun 1.4.5, Node 24.22.3, macOS arm64.

```
$ bun test tests/extension
29 pass, 0 fail, 386 expect() calls, across 2 files

$ bunx biome check packages/vscode tests/extension
Checked 7 files. No fixes applied.

$ ./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext \
    --target ES2022 --skipLibCheck packages/vscode/src/extension.ts
exit 0

$ bun run verify
502 pass, 0 fail, 787499 expect() calls, 27 files, ~6.3 s, exit 0
```

`bun run verify` was run three consecutive times with exit 0. Rendered-scope tests ran with the
WASM toolchain, not the fallback:

```
vscode-textmate 9.3.2 (installed, packages/vscode/node_modules)
vscode-oniguruma 2.0.1 (installed, release/onig.wasm loaded)
@types/vscode 1.146.0 (declared ^1.85.0)
```

The renderer loader resolves modules from `packages/vscode/package.json` via `createRequire`, so the
tests use the extension's declared dev dependencies rather than a root hoist. If loading ever fails,
`createRenderer()` returns `null`, the scope suite is skipped via `describe.skip`, and a warning is
printed — there is no fake scope assertion path.

Fixture samples rendered read-only:

- `tests/fixtures/canonical/button/input.xessa` — directives, alias variants, variables/namespace
  member, class selector, hex colour, strings.
- `tests/fixtures/media/inline-variants/input.xessa` — `@xl+dark`, `@compact`, conditional blocks.
- `tests/fixtures/nesting/pseudo-combinators/input.xessa` — `&`, `>`, `+`, `::before`,
  `:nth-child(2n)`.
- `tests/fixtures/global/escape/input.xessa` — `:global(...)`, top-level and nested.

Edge coverage exercised manually through the same renderer: block/line comments, strings containing
`@`/`$`/braces, attribute selectors with quoted braces, multi-line declarations, `!IMPORTANT`,
`@media`/`@supports` nested inside rules, `@keyframes` steps, `@font-face`, `@property`,
`@layer`, `@container`, `@page`, `@charset`, `@import`, `@namespace`, combined `:is(...)` /
`:not(...)` / `:where(...)` pseudo arguments, escaped class names, empty/blank/unterminated files,
and a 300-rule file (rendered in ~0.06 s; no hangs).

## Deviations and notes (lead attention)

1. **Manifest `name` remains `@xessa/vscode` instead of `xessa`.** Renaming would fail
   `tests/integration/scaffold.test.ts:44` (`expect(vscode.name).toBe("@xessa/vscode")`), which is
   outside A12's allowed file scope, and it would change the Bun workspace/lock identity. Since
   acceptance criterion 1 requires `bun run verify` exit 0, the monorepo identity was kept and every
   other manifest field is packaging-real. Follow-up for A13/A15 with owner approval: rename
   `name` to `xessa`, update that scaffold assertion and re-run `bun install`; `vsce` also requires
   a lowercase hyphenated name at packaging time (A15 owns packaging).
2. **`main` points at TypeScript source** (`./src/extension.ts`) exactly as the task requires. The
   extension host cannot execute TypeScript directly, so the extension is not loadable until A13
   bundles it; A12 deliberately adds no launch/debug configuration or bundler.
3. **Fixture pollution cleaned (out of scope but required for the gate).** `bun run verify` first
   failed three A11 tests because `tests/fixtures/cli/basic/` contained stray compiler output
   (`generated/styles/card.css`, `generated/maps/card.map.{js,d.ts}` and `.xessa-manifest.json`,
   timestamp 03:12, byte-identical to `expected/card.css`/`expected/card.map.js`). These are
   compiler-owned artifacts left by a manual `xessa build src/card.xessa` in the fixture, not fixture
   source. They were removed; no fixture source, config or golden was edited.
4. **Pre-existing watch-test flakiness under full-suite parallelism.** Two full `bun run verify` runs
   after that cleanup failed different `tests/integration/cli-watch.test.ts` cases (15 s `waitFor`
   timeouts under 27 concurrent test files); the watch file passes 3/3 in isolation and three
   subsequent full runs were green. A12 did not modify watcher code or its tests.
5. **Alias exclusion includes native at-rule names** in addition to directives. This is stricter
   than the minimum UI requirement and prevents `@media` from rendering yellow when a block body
   tries `#conditional-block` before `#native-at-rule`.
6. **`@media-types` definition keys render as aliases** (yellow) because they define media aliases;
   the conditions beside them use property/constant scopes and never alias yellow.
7. **Selector lookahead excludes `@`** so a top-level `@md { … }` is never mistaken for a selector;
   the trade-off (an attribute string containing `@` before the rule's `{`) is noted above.
8. No framework bug/feature records were required: no upstream TextMate/VS Code defect or feature
   request was found; the only upstream packages used are test-only dev dependencies.

## Handoff

- Completed: grammar, language configuration, manifest contributes, activation stub, README, tests,
  docs records; `bun run verify` green; extension TS stub typechecks.
- Remaining for the lead: independent diff review and `bun run verify`, then flip A12 in
  `.ai/PROGRESS.md`.
- Remaining for A13: bundle `src/extension.ts`, add extension-host launch/debug config, providers and
  commands. Remaining for A15: packaging (`vsce`) and the `name: xessa` manifest rename with the
  scaffold assertion/lockfile update.
- Touched files: `packages/vscode/{package.json,syntaxes/xessa.tmLanguage.json,language-configuration.json,src/extension.ts,README.md}`,
  `tests/extension/{grammar-harness.ts,grammar.test.ts,grammar.scopes.test.ts}`, `bun.lock`,
  `.ai/tasks/CSSX-A12.md`, `.ai/reports/CSSX-A12.md`, `.ai/reports/logs/CSSX-A12.log`.
