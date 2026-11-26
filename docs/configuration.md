# Configuration reference (v0.1)

Xessa output is configured at three layers: per-file `@setup`, per-project `xessa.config.json`, and a
small set of explicit CLI flags. The normative definition is [SPECIFICATION.md](../SPECIFICATION.md)
§9–§10. This page is the practical reference.

## 1. Precedence

```text
built-in defaults  <  project xessa.config.json  <  file @setup  <  explicit CLI overrides
```

- `--minify` / `--no-minify` are the only output overrides the current CLI exposes. They win over
  both project config and file `@setup`. When a file authors a conflicting `minify` value, the CLI
  recompiles that entry with the flag and prints an informational warning such as
  `setup minify false overridden by CLI flag (--minify).`
- CLI path overrides are specified as single-entry only; no path flags are implemented yet.
- Unknown `@setup` keys and duplicate settings are always errors (`XESSA1001`). Unknown
  `xessa.config.json` keys are errors by default (`compiler.strict: true`); an explicit
  `"compiler": { "strict": false }` downgrades them to warnings.
- Class prefix precedence:
  - `compile()` API: `options.prefix` → `options.naming.prefix` → file `@setup prefix` → `""`.
  - `compileProject()` / CLI: file `@setup prefix` wins over project `classes.prefix`.
  - `classes.strategy: "none"` (API `naming.strategy`) disables prefixing entirely, whatever
    `prefix` says.

## 2. `@setup` keys

`@setup` is top-level only. Several blocks are merged in document order; a key may appear only once
across all of them. String values are CSS-string decoded; booleans must be `true` or `false`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `prefix` | string | `""` | Class-name prefix. `ui` turns `card` into `ui-card`; empty leaves names unchanged. |
| `css-dir` | string or comma-separated list | source directory | CSS output directory, resolved relative to the source file. Exact — no mirrored subfolders. A list (`"../client", "../src"`) writes the same stylesheet to every item. |
| `css-name` | string | `<stem>.css` | CSS basename. Must end in `.css`; no separators or traversal. |
| `map-dir` | string | source directory | Class-map output directory, resolved relative to the source file. |
| `map-name` | string | `<stem>.map.js` | Class-map basename. Must end in `.js`; declarations become `<stem>.d.ts`. |
| `emit-css` | boolean | `true` | Write the stylesheet. |
| `emit-map` | boolean | `true` | Write the JS class map. |
| `map-types` | boolean | `false` | Write `.d.ts` beside the JS map (opt-in, CSSX-A52). Suppressed with a warning when `emit-map` is false. |
| `emit-types` | boolean | `false` | Deprecated alias for `map-types`; the canonical key wins when both are authored. |
| `source-map` | boolean | `false` | Write a CSS v3 source map (`<css-name>.map`) beside the stylesheet. |
| `minify` | boolean | `true` | Compact generated structural whitespace; authored tokens and declaration order are preserved. Set `false` for readable output ([ADR-0022](decisions/ADR-0022-minified-output-default.md)). |
| `map-inherit` | boolean | `true` | When `false`, a style-merged module keeps its rules in the importer's CSS but contributes no class bindings to the importer's map, `.d.ts` or `classes`. The module's own entry map is unaffected ([ADR-0020](decisions/ADR-0020-map-inheritance-opt-out.md)). |
| `import-css` | boolean | `false` | When `true`, the generated `map.js` starts with one `import "<stylesheet>";` side-effect import for bundlers. Omitted when no stylesheet is emitted ([ADR-0021](decisions/ADR-0021-opt-in-css-import.md)). |
| `media-grouping` | `"merge"` \| `"safe"` \| `"none"` | `"safe"` | Grouping of emitted conditional runs. `safe` merges only adjacent compatible runs; `merge` is the opt-in disjoint-family optimizer; `none` emits runs as authored. See §2.4 ([ADR-0024](decisions/ADR-0024-media-merge-grouping.md)). |

Example:

```xessa
@setup {
  prefix: "dashboard";
  css-dir: "../styles";
  css-name: "dashboard.css";
  map-dir: "../modules";
  map-name: "dashboard.map.js";
  emit-css: true;
  emit-map: true;
  map-types: true;
  source-map: false;
  minify: true;
  import-css: false;
}
```

### 2.1 `css-dir` lists

`css-dir` is the only `@setup` value that accepts more than one scalar. Write a comma-separated
list to put the same stylesheet in several in-workspace directories:

```xessa
@setup {
  css-dir: "../client", "../src";
  css-name: "app.css";
  source-map: true;
}
```

- Every item resolves exactly like the single-value form: relative to the source file, no project
  mirroring. A list depends on the source file's location just like one path does.
- The same `css-name` is written to each directory. With `source-map: true`, each destination also
  gets `<css-name>.map`.
- The list replaces the project `output.cssDir` for that file; there is no per-item merge.
  `map-dir`, `map-name` and project/CLI `cssDir` stay single-valued.
- Empty items (`"a", , "b"`, a leading or trailing comma) and repeated paths are `XESSA2001`
  errors. Every item is checked against the workspace root; an external item fails the whole entry.
- Each destination is a separate manifest record, so `clean` removes all copies and watch rebuilds
  rewrite all of them.

### 2.2 `map-inherit`

By default a style-merged module joins the importing build's single class table (ADR-0014 §3): its
rules and its class bindings both arrive. Set `map-inherit: false` in the **module** to keep only the
rules:

```xessa
// src/card.cssx — a rule-only component module
@setup {
  prefix: "ui";
  map-inherit: false;
}

.card { padding: 8px; }
```

```xessa
// src/page.cssx — the importer
@use "./card.cssx" styles;
.page { color: red; }
```

`page.css` still contains `.ui-card` and `.page` in imported-first cascade order, while
`page.map.js` and the opt-in `page.map.d.ts` export only `page`. The flag is the module's own
declaration, so it applies to every importer; precedence is defaults < project
`output.mapInherit` < the module's `@setup`. Compiling `card.cssx` as an entry still writes its own
full map. Excluded bindings cannot collide, and combining `map-inherit: false` with
`module: true` is allowed: the module's bindings then exist nowhere by default, which is the
documented escape hatch for a rule-only module. See
[ADR-0020](decisions/ADR-0020-map-inheritance-opt-out.md).

### 2.3 `import-css`

Bundlers that carry CSS through JavaScript imports can have the map load its stylesheet:

```xessa
@setup {
  css-dir: "../styles";
  import-css: true;
}
```

```js
// src/card.map.js
import "../styles/card.css";
export const card = "ui-card";
```

- The specifier is relative from the **map file** to the **emitted stylesheet**, with POSIX
  separators and a `./` prefix when the stylesheet is in or below the map directory.
- With a `css-dir` list (§2.1), the **first listed destination** is canonical and is the import
  target; every copy is still written.
- The import is omitted when the build emits no stylesheet (`emit-css: false`, or `module: true`
  without a restored `emit-css`), so a map never points at a missing file.
- `.d.ts` declarations never carry the import. Default `false` keeps the map plain-Node importable.
  Precedence is defaults < `output.importCss` < file `@setup`. See
  [ADR-0021](decisions/ADR-0021-opt-in-css-import.md).

### 2.4 `media-grouping`

Controls how the compiler groups emitted conditional declaration runs. The default is `safe`;
`merge` is an opt-in optimizer for larger stylesheets:

```xessa
@setup {
  media-grouping: merge;
}
```

- `none` — no grouping; every run is emitted where it was authored.
- `safe` — the default; merges only adjacent runs with the same selector chain, condition and
  native at-rule context.
- `merge` — keeps the safe pass and also moves same-selector/same-condition conditional runs into a
  later run when every crossed declaration has a **provably disjoint property family**. It never
  merges unconditional runs, different selectors, different conditions or different native contexts.
  `all` and declarations containing `var(` are wildcards: they never merge and nothing merges across
  them. See [ADR-0024](decisions/ADR-0024-media-merge-grouping.md) for the cascade proof and the
  family approximation's limits.

The file-level key overrides project `compiler.mediaGrouping`; precedence is defaults (`safe`) <
project config < file `@setup`. An invalid value is `XESSA1001`.

## 3. `xessa.config.json`

The file is **optional**. A config is only needed to change a default or scope discovery; without
one, project runs use the nearest `package.json` workspace root and the default include globs. The
full example below shows every key:

```json
{
  "include": ["src/**/*.cssx"],
  "exclude": ["node_modules", "dist", "generated"],
  "output": {
    "cssDir": "dist/styles",
    "mapDir": "dist/maps",
    "emitCss": true,
    "emitMap": true,
    "mapTypes": true,
    "sourceMap": false,
    "minify": true,
    "mapInherit": true,
    "importCss": false
  },
  "classes": { "strategy": "prefix", "prefix": "ui" },
  "media": { "md": "(min-width: 768px)", "xl": "(min-width: 1280px)" },
  "compiler": { "strict": true, "mediaGrouping": "safe" }
}
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `$schema` | string | — | Accepted and ignored, so editors can validate the document. |
| `include` | string[] | `["**/*.cssx"]` | Entry globs. Omit it for the default. An explicitly empty list exits 2, and so do globs that match no `.cssx` file (a configuration error, not an empty build). Optional for single-file mode. |
| `exclude` | string[] | `[]` | Glob patterns and directory names removed from discovery. `node_modules` and `.git` are never walked. Imported modules normally self-declare with `@setup { module: true; }` instead of being listed here. |
| `output.cssDir` | string | source directory | Project CSS directory, relative to the workspace root. Mirrors the source path (see §4). |
| `output.cssName` | string | `<stem>.css` | Project default CSS basename. |
| `output.mapDir` | string | source directory | Project class-map directory. |
| `output.mapName` | string | `<stem>.map.js` | Project default class-map basename. |
| `output.emitCss` | boolean | `true` | See the emit-flag rules in §5. |
| `output.emitMap` | boolean | `true` | See §5. |
| `output.mapTypes` | boolean | `false` | Write `.d.ts` beside the JS map (opt-in, CSSX-A52). See §5. |
| `output.emitTypes` | boolean | `false` | Deprecated alias for `output.mapTypes`. |
| `output.sourceMap` | boolean | `false` | See §6. |
| `output.minify` | boolean | `true` | Compact CSS output; set `false` for readable output ([ADR-0022](decisions/ADR-0022-minified-output-default.md)). |
| `output.mapInherit` | boolean | `true` | Whether style-merged modules contribute class bindings to the importing build ([ADR-0020](decisions/ADR-0020-map-inheritance-opt-out.md)). |
| `output.importCss` | boolean | `false` | Prepend the emitted stylesheet's side-effect import to the class map ([ADR-0021](decisions/ADR-0021-opt-in-css-import.md)). |
| `classes.strategy` | `"prefix"` \| `"none"` | `"prefix"` | Naming strategy. |
| `classes.prefix` | string | `""` | Prefix used by the `prefix` strategy. |
| `media` | object | `{}` | Alias overrides merged after built-ins and before file `@media-types`. |
| `compiler.strict` | boolean | `true` | Reject unknown configuration keys (exit 2). `"strict": false` keeps the warning path. |
| `compiler.mediaGrouping` | `"merge"` \| `"safe"` \| `"none"` | `"safe"` | Grouping of conditional runs. `safe` merges adjacent compatible runs; `merge` is the opt-in disjoint-family optimizer ([ADR-0024](decisions/ADR-0024-media-merge-grouping.md)); `none` emits as authored. |

### Kebab-case ↔ camelCase mapping

| Source `@setup` | JSON key |
|---|---|
| `prefix` | `classes.prefix` |
| `css-dir` | `output.cssDir` |
| `css-name` | `output.cssName` |
| `map-dir` | `output.mapDir` |
| `map-name` | `output.mapName` |
| `emit-css` | `output.emitCss` |
| `emit-map` | `output.emitMap` |
| `map-types` | `output.mapTypes` |
| `emit-types` (deprecated) | `output.emitTypes` |
| `source-map` | `output.sourceMap` |
| `minify` | `output.minify` |
| `map-inherit` | `output.mapInherit` |
| `import-css` | `output.importCss` |
| `media-grouping` | `compiler.mediaGrouping` |

`output.prefix` is not a schema key; class naming lives under `classes` so strategy and prefix stay
together. Writing `output.prefix` is an unknown key (`strict`: error).

### Discovery and workspace root

- **Project mode** (`xessa build`, no file argument): the CLI walks up from the working directory to
  the nearest `xessa.config.json`; `--config <path>` overrides the walk. The config directory is the
  workspace root. When no config exists, the nearest ancestor `package.json` (else the starting
  directory) is the workspace root and discovery uses the default include `["**/*.cssx"]`
  ([ADR-0007](decisions/ADR-0007-workspace-root-and-containment.md),
  [ADR-0023](decisions/ADR-0023-zero-config-defaults.md)).
- **Single-file mode** (`xessa build src/button.cssx`): the nearest config is still used if found;
  otherwise the nearest ancestor `package.json` (else the file's directory) is the workspace root
  ([ADR-0007](decisions/ADR-0007-workspace-root-and-containment.md)).
- Globs support `*` (within a segment), `**` (across segments; `**/` also matches zero segments),
  `?` and `{a,b}`. Character classes are literal. Discovery only considers `.cssx` files, never
  walks `.git`/`node_modules`, skips symlinks, and sorts entries deterministically.
- An empty discovery result in project mode is a configuration error: `build`, `check` and `watch`
  exit 2 with `No .cssx sources matched the project include globs.` (JSON:
  `{"success":false,"exitCode":2}`), so a moved or typo'd source tree cannot pass CI silently.
- Multi-root VS Code workspaces resolve the nearest config per file, bounded by the workspace folder.

## 4. Paths, names and collisions

- File-level directories resolve **relative to the source file** and are used exactly:
  `css-dir: "../styles"` in `src/button.cssx` writes `styles/button.css`.
- A `css-dir` list applies the same rule to each item: `css-dir: "../client", "../src"` writes the
  identical stylesheet to both `client/` and `src/` next to the source file. The list replaces
  `output.cssDir` for that file and does not mirror project subdirectories. Empty or duplicate items
  are `XESSA2001`; each destination is validated and manifested separately.
- Project-level directories resolve **relative to the workspace root** and mirror the source path
  relative to the workspace root. With `include: ["src/**/*.cssx"]` and `cssDir: "dist/styles"`,
  `src/deep/widget.cssx` writes `dist/styles/src/deep/widget.css`. This keeps same-named sources
  apart; it also means the `src/` segment is repeated under the output directory in v0.1 (a known
  gap, recorded in [known-limitations.md](known-limitations.md)).
- A file-level directory and a project-level directory can be mixed: the file value wins for that
  file.
- If only a directory is set, the default filename applies. If only a filename is set, the effective
  directory is retained.
- `css-name` must end in `.css`; `map-name` must end in `.js`. Both must be basenames: no `/`, `\`,
  `.`/`..`, NUL or traversal. Extension normalisation is not implemented.
- A CSS source map is named `<css-name>.map`; a JS map `classes.js` has opt-in declarations
  `classes.d.ts`.
- The JS map is one `export const <camelCase> = "<emitted class>";` per class, in first-appearance
  order, with no default export and, by default, no CSS side-effect import. `<camelCase>` splits on
  `-`/`_`; a digit-leading or reserved identifier gets a `_` prefix and duplicate identifiers get
  `_2`/`_3`. Load the stylesheet from the page (`<link>`) or import it explicitly in the bundler
  entry; `import-css: true` (§2.3) opts the map into that import instead. See §8 of
  [SPECIFICATION.md](../SPECIFICATION.md), CSSX-A52 and [ADR-0021](decisions/ADR-0021-opt-in-css-import.md).
- The same destination planned by two entries is a collision (`XESSA5001`), as is a target that
  equals its own input source.

## 5. Emit-flag consistency rules

| Combination | Result |
|---|---|
| `emit-css: false` | Valid. No CSS artifact; maps (and requested declarations) are still produced, no source map is written, and `import-css` emits no import. |
| `emit-map: false` + `map-types: true` | Types are suppressed and a `XESSA5001` **warning** asks you to set `map-types: false` explicitly. |
| `emit-map: false` + `map-types: false` (the default) | Valid. No JS or declarations. |
| `source-map: true` + `emit-css: false` | No source map is planned or written. |
| `emit-css: false` | `compile()` omits `css`; class maps and declarations are still returned. |

`minify` defaults to `true` (ADR-0022): generated CSS is compact by default. It only compacts
generated structural whitespace, preserving quoted strings, custom values, `calc()` spacing, at-rule
prelude whitespace and declaration order; it never changes computed styles. Opt out per file with
`@setup { minify: false; }`, per project with `"output": { "minify": false }`, or per invocation with
`--no-minify`; `--minify` is the explicit override in the other direction. `format()` is unaffected.

## 6. Source maps

`source-map: true` (settings: `@setup`, project `output.sourceMap`, or API `options.sourceMap`)
writes a standard v3 CSS source map beside the stylesheet:

- file name: `<css-name>.map` in the same directory as the CSS (`theme.css` → `theme.css.map`);
- `file` names the emitted CSS basename; `sources` are workspace-relative Xessa paths;
  `sourcesContent` is included so the map is self-contained;
- the emitted CSS ends with `/*# sourceMappingURL=<css-name>.map */`;
- `CompileResult.sourceMap` carries the serialized JSON and the CLI writes it atomically and tracks
  it as a `cssSourceMap` manifest entry;
- no map is planned or written when `emit-css: false`.

Source maps are new in 0.1.0 and covered by `tests/compiler/sourcemap.test.ts` and
`tests/compiler/mapgen.test.ts`. They are distinct from the JS class map (`map-name`), which is a
runtime module, not a debugging artifact.

## 7. Safety and writing

Before anything is written, the whole output plan is validated with `planOutputs`:

- every destination must stay inside the workspace root (v0.1 has **no** trusted override for
  external output);
- a destination reached through a symlink that resolves outside the workspace root is rejected
  (`XESSA5001`);
- a destination equal to its input source, or to another entry's target, is rejected;
- unknown setup keys, invalid booleans, bad basenames and inconsistent emit flags are rejected
  before generation.

Validated files are written atomically per file: a temp file in the destination directory, then a
rename. This is per-file atomicity, not cross-file transactionality. On failure the last successful
outputs are retained and reported as stale. The CLI records generated files in
`<workspaceRoot>/.cssx-manifest.json` (fixed location) and `xessa clean` deletes only
manifest-owned files whose hash still matches; externally modified files are reported and kept.
Obsolete owned outputs are pruned after a successful full build. A manifest record is only trusted
when it is also artifact-shaped for its `kind` with an in-workspace `.cssx` source, so a hand-edited
record cannot target an unrelated file. Unrelated user files are never deleted, and stale
`*.cssx-tmp` writer temporaries are swept by both `build` and `clean`.

## 8. CLI flags relevant to configuration

| Flag | Effect |
|---|---|
| `--config <path>` | Use a specific `xessa.config.json`; the config directory becomes the workspace root. |
| `--minify` / `--no-minify` | Highest-precedence CSS compaction; the last flag wins. |
| `--check` | With `format`: list files that would change and write nothing; exits 1 when any would change. |
| `--dry-run` | Report work that would be written/deleted; nothing is written. Not valid with `check` (exit 2) because `check` never writes. |
| `--json` | Machine-readable results (NDJSON for `watch`). |

See the [README CLI section](../README.md#cli) for commands and exit codes.

## See also

- [grammar.md](grammar.md) — `@setup`, `@media-types` and directive syntax.
- [compatibility.md](compatibility.md) — supported features and gaps.
- [`examples/custom-output`](../examples/custom-output/) — independent directories, names and
  `emit-css: false`.
