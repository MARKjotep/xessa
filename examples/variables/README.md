# Variables example

Compile-time tokens, a namespaced and an unqualified `@use`, a local override and runtime custom
properties in one stylesheet.

```xessa
@use "./tokens.cssx";              // unqualified: $spacing, $radius, $surface
@use "./layout.cssx" as layout;    // namespaced: $layout.gutter
@variables {
  gap: $layout.gutter;
  spacing: 16px;                    // local override of the imported $spacing
}
@runtime { primary: #2563eb @dark #60a5fa; }
.card {
  padding: $spacing;                // 16px, not the imported 12px
  margin: $gap;
  border-radius: $radius;           // imported 8px
  color: $primary;                  // var(--ui-primary)
}
```

## Build

```sh
(cd examples/variables && bun ../../packages/cli/src/index.ts build)
```

or `cd examples/variables && xessa build`. No config is needed; the default `**/*.cssx` discovery
finds the entry and both modules, and the minimal `package.json` marks the workspace boundary.

## What it demonstrates

- Compile-time variables substitute **token sequences**, not JavaScript expressions.
- `src/tokens.cssx` and `src/layout.cssx` are token-only modules: they declare
  `@setup { module: true; }`, so discovery finds them but they emit no artifacts of their own. Their
  tokens still resolve for importers.
- Namespaced members (`$layout.gutter`) and unqualified tokens stay independent.
- A local definition overrides an unqualified imported definition; imported modules are not
  mutated.
- `@runtime` tokens emit `:root { --ui-primary: … }`, a `prefers-color-scheme: dark` override and
  `var(--ui-primary)` references. Runtime custom properties are prefixed with the same `prefix`
  (`ui`).
