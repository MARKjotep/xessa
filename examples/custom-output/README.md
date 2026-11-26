# Custom output example

Two entries in one project with independent output directories, explicit basenames and one entry
that emits no CSS.

| Entry | CSS | Class map | Notes |
|---|---|---|---|
| `src/panel.cssx` | `generated/styles/theme.css` + `theme.css.map` | `generated/maps/classes.js` + `.d.ts` | `css-name: "theme.css"`, `map-name: "classes.js"`, `source-map: true`, `map-types: true` |
| `src/plain.cssx` | — | `generated/maps/plain.js` + `.d.ts` | `emit-css: false`, `map-types: true` |

## Build

```sh
(cd examples/custom-output && bun ../../packages/cli/src/index.ts build)
```

or `cd examples/custom-output && xessa build`. The example has no `xessa.config.json`; all of its
non-default output settings live in each file's `@setup`, and the minimal `package.json` marks the
workspace boundary.

## What it demonstrates

- `css-dir`/`map-dir` are resolved relative to the **source file** for `@setup`; the directories are
  exact and are not mirrored per entry.
- `css-name` and `map-name` are basenames only. `classes.js` yields `classes.d.ts`; `theme.css` with
  `source-map: true` yields `theme.css.map`, and the emitted CSS ends with
  `/*# sourceMappingURL=theme.css.map */`.
- `emit-css: false` is valid now that class maps never import their stylesheet. The map for
  `plain.cssx` still exports its class names and declarations; only the CSS artifact is absent.
- Output planning validates every destination before writing: no input/output overlap, no
  traversal, no workspace escape, no duplicate targets. See
  [docs/configuration.md](../../docs/configuration.md).

Artifacts under `generated/` are committed, byte-stable CLI output.
