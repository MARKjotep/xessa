# Changelog — Xessa for VS Code

## 0.1.2 — 2026-11-28

- Composed group defaults flow into use sites; hover and derived-definition labels show the
  effective defaults and composition sites are labelled separately.
- Definition, references and rename follow composition sites, and definition/references cover
  `@group.<name>` and `@keyframes <name>` declarations, their references and exact `animation-name`
  values; keyframe rename works from the `animation-name` value.
- `@group`, `$keyframes.` and imported `$alias.` completions reopen the member list immediately, and
  `@lg+` continues a media alias chain.
- No compiler, CLI or dependency change; local VSIX only, Marketplace publication still deferred.

## 0.1.1 — 2026-11-28

- `@group` use sites show the overridden default as a dim italic `// <default>` ghost after the
  declaration; the new `xessa.editor.groupOverrideHints` setting picks `always` (default),
  `inside` or `off`. Ghosts are decoration-only and never modify the document.
- `var($runtimeToken, fallback)` now names the emitted custom property, so runtime tokens complete,
  hover and diagnose in the editor like any other token.
- Retired the chick mascot: the app icon is now the X/S monogram, and `.cssx` files use the transparent
  Xessa main-logo file icon in both light and dark themes.

## 0.1.0 — 2026-11-25

First MVP release candidate.

- Marketplace identity: unscoped `xessa` name, `0.1.0`, X/S monogram app icon and `.cssx` file icons
  for light and dark themes.
- Registers the `xessa` language and `.cssx` files with a standalone TextMate grammar and language
  configuration (comments, brackets, auto-closing pairs, indentation).
- Diagnostics from a tolerant parse plus an in-memory compile, debounced at 150 ms with stale-version
  discard; XESSA codes with exact spans.
- Completions for properties, values, media aliases (built-in, project and `@media-types`), `$` tokens
  and namespace members, `@setup` keys, `@use` paths, selectors and pseudo-classes.
- Hover for token values, media conditions and generated class names; definition, references,
  single-file token rename, color provider and outline.
- Commands: Compile File, Build Project, Preview Compiled CSS, Open Generated CSS, Open Class Map,
  Check Project; status bar and `Xessa` output channel.
- Multi-root nearest-config resolution, workspace-trust respect, and compile-on-save **off by
  default** (`xessa.compileOnSave`).
- Preview compiles in memory to a read-only `xessa-preview:` document and never writes.
- Known gaps: property hover is empty and property/value completion lists are curated (no CSS
  language-service projection); cross-module rename and class rename across JSX are refused; source
  maps are not emitted yet.
