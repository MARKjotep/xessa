# JSX example

A generated Xessa class map consumed by a small React component. The example deliberately has no
React or bundler dependency: the component is illustrative, while the committed class map and
declarations are real compiler output and can be type-checked on their own.

```tsx
// src/Button.tsx (not compiled by this example — shown for usage)
import { button, isPrimary } from "../generated/maps/button.map.js";
import "../generated/styles/button.css";

export function Button() {
  return <button className={`${button} ${isPrimary}`}>Continue</button>;
}
```

## Build

```sh
(cd examples/jsx && bun ../../packages/cli/src/index.ts build)
```

or `cd examples/jsx && xessa build`. No config is needed: the default `**/*.cssx` discovery finds
`src/button.cssx`, and the minimal `package.json` marks the workspace boundary.

## What it demonstrates

- `&.is-primary` (a compound nested selector) becomes `.ui-button.ui-is-primary` and is exported
  both as the quoted original key `"is-primary"` and as the camelCase named export `isPrimary`.
- `generated/maps/button.map.js` exports literal strings and has no default export and no CSS
  import; `button.map.d.ts` (opt-in through `map-types: true`) types each binding as its literal,
  for example `button` as `"ui-button"`.
- Style loading is explicit: the example imports `../generated/styles/button.css` beside the map.
  A static page can use `<link rel="stylesheet">` instead. The generated map never imports CSS, so
  plain Node can import it directly.
- Global classes escaped with `:global(...)` never appear in the map; see
  [docs/compatibility.md](../../docs/compatibility.md).

To type-check the generated declarations directly:

```sh
cd examples/jsx
bunx tsc --noEmit --strict --moduleResolution bundler --module esnext \
  --allowJs false generated/maps/button.map.d.ts
```

`src/Button.tsx` is illustrative and not discovered: project entry discovery only considers `.cssx`
sources.
