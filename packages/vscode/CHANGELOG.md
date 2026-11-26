# Changelog — Xessa for VS Code

## 0.1.0 — 2026-11-25

First MVP release candidate.

- Marketplace identity: unscoped `xessa` name, `0.1.0`, chick logo icon and `.cssx` file icons for
  light and dark themes.
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
