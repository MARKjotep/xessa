# Responsive example

Inline media variants, combined aliases, a file-level `@media-types` alias and rule-scoped
conditional blocks in one stylesheet.

```xessa
.card {
  padding: 12px @md 20px @xl 32px;
  background: white @dark #181818 @xl+dark #101010;
  @md { display: grid; grid-template-columns: 1fr 1fr; }
  @compact { display: block; padding: 8px; }
}
```

## Build

```sh
(cd examples/responsive && bun ../../packages/cli/src/index.ts build)
```

or `cd examples/responsive && xessa build`. No config is needed; the example relies on the default
`**/*.cssx` discovery and its `package.json` workspace boundary.

## What it demonstrates

- Ascending mobile-first variants: base, `@md` (768px), `@xl` (1280px).
- Combined aliases are logical **AND**: `@xl+dark` emits
  `(min-width: 1280px) and (prefers-color-scheme: dark)`.
- A file-level `@media-types { compact: (max-width: 500px); }` alias, used in a conditional block.
- Conditional blocks are **rule-scoped only**. Order is preserved: the `@compact` block is emitted
  after the `@md` block, so `display: block` wins below 500px while `display: grid` wins from 768px
  up (see [the cascade contract](../../docs/cascade.md)).
- Nested selectors inside a conditional block (`& > .icon` under `@md`) inherit the condition.

The CSS in `generated/styles/card.css` is emitted in authored order with no reordering. Browser
computed-style checks for these constructs live in `tests/browser/specs/`.
