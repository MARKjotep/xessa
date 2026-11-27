# @xessa/cli

The official Xessa command-line interface. It compiles `.cssx` sources to CSS, JavaScript class
maps, optional TypeScript declarations and optional source maps, and is a thin wrapper around
[`@xessa/compiler`](https://github.com/MARKjotep/xessa/blob/main/packages/compiler/README.md): the same parser, resolver and emitters that power the
API and the VS Code extension.

`@xessa/cli` is the command and operations reference. The complete language and compiler contract
lives in [`@xessa/compiler`](https://github.com/MARKjotep/xessa/blob/main/packages/compiler/README.md)
and the normative
[`SPECIFICATION.md`](https://github.com/MARKjotep/xessa/blob/main/SPECIFICATION.md); this page does
not restate the language.

The CLI depends on `@xessa/compiler`, so the complete spec and docs are installed at
`node_modules/@xessa/compiler/SPECIFICATION.md` and `node_modules/@xessa/compiler/docs/` — available
offline to npm and CLI users.

**0.1.1** is live on npm; **0.1.2** is release-ready, not yet published. Until 0.1.2 is live, use the
source-checkout workflow below or install the published 0.1.1.

## This README vs the language spec

| Question                                          | Reference                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| How do I install, run, configure and script it?    | This page                                                                                |
| What does a `.cssx` file mean?                     | [`@xessa/compiler`](https://github.com/MARKjotep/xessa/blob/main/packages/compiler/README.md) → [`SPECIFICATION.md`](https://github.com/MARKjotep/xessa/blob/main/SPECIFICATION.md) |
| How does the editor behave?                        | [`packages/vscode/README.md`](https://github.com/MARKjotep/xessa/blob/main/packages/vscode/README.md) |

## Requirements

- **Node.js ≥ 20** or **Bun**. The CLI is ESM and ships built `dist` output; its `bin` entry is
  `dist/index.js` with a `#!/usr/bin/env node` shebang, so a Node-only machine works.
- A runtime dependency on `@xessa/compiler` is installed with the CLI.
- Workspaces are ordinary directories. No framework, bundler or browser runtime is required.

## Install

### As a local development dependency

```sh
npm install -D @xessa/cli
# or
bun add -d @xessa/cli
```

This puts the `xessa` binary in `node_modules/.bin`. Use it directly or through your package
scripts:

```sh
xessa build
```

`npx @xessa/cli build` also resolves the locally installed package when you prefer an explicit
scoped invocation.

### Globally

```sh
npm install -g @xessa/cli
xessa build
```

### One-off, without installing

```sh
npx @xessa/cli build
bunx @xessa/cli build
```

> **Important:** the unscoped `xessa` package on npm is the private repository root and is **not
> published**. Bare `npx xessa` therefore does not work. The `xessa` bin only exists after
> `@xessa/cli` is installed, or when you invoke the scoped package directly
> (`npx @xessa/cli`, `bunx @xessa/cli`).

### From a source checkout

```sh
bun install
bun run --cwd packages/compiler build
bun run --cwd packages/cli build
node packages/cli/dist/index.js --help
```

The last command works without a global install; substitute its path for `xessa` anywhere below.

## 60-second quick start

### One file

Create `src/button.cssx`:

```cssx
@setup {
  prefix: "ui";
}

.button {
  display: flex;
  padding: 12px @md 20px;
  background: #2563eb;
  &:hover { opacity: 0.85; }
}
```

Compile it:

```sh
npx @xessa/cli build src/button.cssx
```

With no configuration and no output overrides, both artifacts land next to the source:

```text
src/button.css      # .ui-button rules, inline @md lowered to @media
src/button.map.js   # export const button = "ui-button";
```

Defaults: `css-dir` and `map-dir` are the source directory, CSS is `<stem>.css`, the map is
`<stem>.map.js`, and CSS is **minified** (`minify: true`). Add `map-types: true` in `@setup` to
emit `<stem>.map.d.ts`, and `source-map: true` for a `.map` artifact. Pass `--no-minify` for
readable CSS.

### A project

No configuration is required. From the workspace root:

```sh
npx @xessa/cli build
```

`build` discovers `include: ["**/*.cssx"]` under the nearest workspace root and compiles every
entry. Add `xessa.config.json` only to change a default or scope discovery:

```json
{
  "include": ["src/**/*.cssx"],
  "classes": { "strategy": "prefix", "prefix": "ui" }
}
```

See [Configuration](#configuration) below for the full shape.

## Command reference

Commands are `build`, `check`, `watch`, `format`, `clean` and the `help`/`version` shortcuts.
Parsing is strict: unknown flags, extra positional arguments, a missing flag value and a missing
command are invocation errors (exit 2). `-h/--help` and `-v/--version` short-circuit every other
rule and exit 0.

### `xessa build [file]`

Compile the project (config include globs) or one file, write artifacts, and update the manifest.

- **Writes:** CSS, class map and any enabled declaration/source-map artifacts, plus
  `.cssx-manifest.json` at the workspace root.
- **Flags:** `--config <path>`, `--json`, `--dry-run`, `--minify`, `--no-minify`.
- A failed entry writes nothing for that entry and keeps its previous good outputs.
- `--dry-run` positions diagnostics and prints the plan but writes no files and does not update
  the manifest.

```sh
npx @xessa/cli build
npx @xessa/cli build src/button.cssx --no-minify
npx @xessa/cli build --config config/xessa.config.json --json
```

### `xessa check [file]`

Run the same compilation pipeline and diagnostics as `build`, but **never write**. Exit 1 when any
error diagnostic is reported, 0 otherwise (warnings are allowed).

- **Writes:** nothing.
- **Flags:** `--config <path>`, `--json`, `--minify`, `--no-minify`.
- `--dry-run` is rejected for `check` because it already performs no writes (exit 2).

```sh
npx @xessa/cli check
npx @xessa/cli check src/button.cssx --json
```

### `xessa watch [file]`

Build once, then rebuild affected entries on change until `SIGINT`/`SIGTERM`. Newly created
directories are included, and a config edit re-resolves the project.

- **Writes:** yes, like `build` (watch always writes; `--dry-run` does not apply).
- **Flags:** `--config <path>`, `--json`, `--minify`, `--no-minify`.
- **`--json`** emits **NDJSON**, one compact object per line: `{"type":"build",…}` after each
  build generation, then `{"type":"watch","ready":true,"sources":N,"debounceMs":…}` once watchers
  are attached. It is a stream, not a single JSON document.

```sh
npx @xessa/cli watch
npx @xessa/cli watch src/button.cssx
npx @xessa/cli watch --json | jq -c 'select(.type == "build")'
```

### `xessa format [file]`

Reformat sources canonically in place. Formatting is parse→print: a file with parse errors is never
rewritten, and the errors are reported with their exit code.

- **Writes:** changed source files only (atomic replacement).
- **Flags:** `--check`, `--config <path>`, `--json`, `--dry-run`.
- **`--check`** writes nothing, lists files that would change, and exits **1** when any exist, 0
  when everything is already canonical.
- `--dry-run` is accepted as an explicit no-write run; `--check` is the CI-friendly form.
- `--minify`/`--no-minify` have no effect on source formatting.

```sh
npx @xessa/cli format
npx @xessa/cli format --check
npx @xessa/cli format src/button.cssx --json
```

### `xessa clean`

Delete generated files that the manifest records as compiler-owned **and** whose content hash still
matches the recorded hash. Edited outputs are kept and their ownership released. Stale writer
temporaries are swept; files outside the workspace and untrusted manifest records are refused.

- **Writes:** deletes files, and rewrites `.cssx-manifest.json` with the remaining owned records.
- **Flags:** `--config <path>`, `--dry-run`, `--json`. No file argument (exit 2).
- `--dry-run` prints what would be removed, deletes nothing and leaves the manifest untouched.

```sh
npx @xessa/cli clean --dry-run
npx @xessa/cli clean --json
```

### `xessa --help`, `xessa --version`

Print usage or the CLI version and exit 0. `-h` and `-v` are the short forms. Both work before or
after a command and take precedence over command validation.

```sh
npx @xessa/cli --help
npx @xessa/cli -v
```

## Flags

| Flag              | Value    | Commands                          | Behaviour                                                                 |
| ----------------- | -------- | --------------------------------- | ------------------------------------------------------------------------- |
| `--config`        | `<path>` | `build`, `check`, `watch`, `format`, `clean` | Use this config file instead of the nearest `xessa.config.json`. Relative paths resolve from the working directory. May be given once; `--config=path` also works. |
| `--json`          | none     | `build`, `check`, `watch`, `clean`, `format` | Machine-readable output. One JSON document for build/check/clean/format; **NDJSON** for watch. |
| `--dry-run`       | none     | `build`, `clean` (also `format` as a no-write run) | Report planned work; write and delete nothing. Rejected by `check`; `watch` ignores it. |
| `--minify`        | none     | `build`, `check`, `watch`         | Emit compact CSS (this is the default).                                     |
| `--no-minify`     | none     | `build`, `check`, `watch`         | Emit expanded, readable CSS.                                               |
| `--check`         | none     | `format` only                     | Report files that would change; write nothing; exit 1 if any.              |
| `-h`, `--help`    | none     | anywhere                          | Print usage and exit 0.                                                    |
| `-v`, `--version` | none     | anywhere                          | Print the CLI version and exit 0.                                          |

Notes:

- `--minify` / `--no-minify`: the last one on the command line wins.
- A value flag never consumes another option as its value: `--config --json` is a missing path, not
  a config named `--json`. A bare `-` is a legal value.
- `--` ends flag parsing; later tokens are positional.
- Unknown options or commands, more than one file argument, a file argument to `clean`, `--check`
  on a non-format command and a missing command all exit **2**.

## Project discovery and workspace root

- The CLI walks upward from the starting directory for the nearest **`xessa.config.json`**. The
  directory containing that file is the workspace root.
- `--config <path>` overrides the walk; its directory becomes the workspace root.
- With no configuration file, the root is the nearest ancestor containing **`package.json`**; if
  none exists, the starting directory itself.
- For `build`, `check` and `watch`, a **single-file** run still loads the nearest config for
  project-level output, naming and media settings. The file must be inside the workspace root;
  otherwise the CLI exits 2 and suggests `--config` for the containing project.
- **Project mode** discovers `.cssx` files via `include` (default `**/*.cssx`) minus `exclude`.
  `node_modules` and `.git` are never walked, and only `.cssx` files are sources.
- An explicitly empty `include` array is an invocation error (exit 2). A project discovery that
  matches no `.cssx` sources is also exit 2 (`No .cssx sources matched the project include globs.`),
  not a silent success.

```sh
# run from anywhere, targeting a specific project
npx @xessa/cli build --config ../site/xessa.config.json

# one file inside a project whose config lives above it
npx @xessa/cli check --config ./xessa.config.json src/button.cssx
```

## Configuration

Configuration is optional. A minimal `xessa.config.json`:

```json
{
  "include": ["src/**/*.cssx"],
  "classes": { "strategy": "prefix", "prefix": "ui" },
  "output": {
    "cssDir": "generated/styles",
    "mapDir": "generated/maps",
    "minify": true
  },
  "media": { "tablet": "(min-width: 48rem)" },
  "compiler": { "strict": true, "mediaGrouping": "safe" }
}
```

**Precedence:** built-in defaults < project `xessa.config.json` < file `@setup` < explicit CLI
overrides (`--minify` / `--no-minify`). CLI path overrides are not implemented; only minification
is overridable from the command line.

`compiler.strict` defaults to `true`: an unknown configuration key is an error (exit 2). Set
`"compiler": { "strict": false }` to downgrade unknown keys to warnings. Known keys are always
type-checked and range-checked.

**Imported modules** do not need an `exclude` entry. A token-only or rule-bearing module declares
itself:

```cssx
@setup {
  module: true;
}
```

`module: true` suppresses the file's own artifacts unless it authors emission keys explicitly, while
its tokens and rules remain importable with `@use`.

Project output directories resolve relative to the workspace root and mirror source paths; `@setup`
directories resolve relative to the source file, exactly. The full key table, path safety rules and
examples are in
[`docs/configuration.md`](https://github.com/MARKjotep/xessa/blob/main/docs/configuration.md).

## Outputs, manifest and safety

With defaults, one entry produces:

| Artifact      | Default path        | Default | Opt-in key              |
| ------------- | ------------------- | ------- | ----------------------- |
| Stylesheet    | `<source dir>/<stem>.css`    | on  | `emit-css` / `output.emitCss` |
| JS class map  | `<source dir>/<stem>.map.js` | on  | `emit-map` / `output.emitMap` |
| Declarations  | beside the map, `<stem>.map.d.ts` | off | `map-types` / `output.mapTypes` |
| CSS source map| beside the stylesheet | off   | `source-map` / `output.sourceMap` |

- CSS is minified by default; `--no-minify`, `@setup { minify: false; }` or `output.minify: false`
  expands it.
- The class map exports one `export const` per class and imports no CSS by default; set
  `import-css: true` to prepend a side-effect import of the planned stylesheet.
- Writes are atomic (temporary file plus rename). A build that fails validation writes nothing for
  that entry and leaves the previous good outputs in place.
- `.cssx-manifest.json` at the workspace root records owned artifacts and content hashes. After a
  fully successful project build, obsolete owned outputs are pruned only when they are still
  unmodified.
- `clean` uses the same ownership and hash rules, so hand-edited outputs are kept.
- `source-map: true` is planned and accepted in v0.1; the current writer reports the artifact as
  not implemented rather than writing an incomplete map. Declarations (`map-types`) are fully
  supported.

## JSON output

`build`, `check`, `clean` and `format` print exactly one JSON document with `--json` (pretty
printed, trailing newline). `watch --json` prints NDJSON instead.

A build/check document has this shape:

```json
{
  "command": "build",
  "success": false,
  "exitCode": 1,
  "dryRun": false,
  "workspaceRoot": "/project",
  "configFile": "/project/xessa.config.json",
  "entries": [
    {
      "file": "src/button.cssx",
      "dependencies": [],
      "outputs": [
        { "kind": "css", "path": "src/button.css", "written": false, "reason": "error" }
      ],
      "diagnostics": [
        {
          "code": "XESSA1002",
          "severity": "error",
          "message": "Expected \";\" after declaration.",
          "file": "src/button.cssx",
          "line": 6,
          "column": 18
        }
      ]
    }
  ],
  "diagnostics": [],
  "warnings": [],
  "errors": []
}
```

`clean` reports `removed` and `skipped` arrays with `reason` values such as `deleted`,
`would-delete`, `missing`, `modified` or `untrusted`. `format` reports `files`, `changed` and
`written` per file. Invocation and configuration failures with `--json` still print a machine-readable
object (`command`, `success: false`, `exitCode: 2`, `error`) so scripts can parse every outcome.

## Exit codes

| Code | Meaning                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| `0`  | Success (warnings allowed; `check` and `format --check` with nothing to report).                            |
| `1`  | Compile, validation or formatting error; write/manifest failure; or `format --check` found changes.        |
| `2`  | Invocation or configuration error: unknown flag/command, invalid config, missing flag value, empty include, empty discovery, file outside the workspace root. |

## Common mistakes and troubleshooting

- **`npx xessa` fails.** The unscoped `xessa` package is not published. Use `npx @xessa/cli …`,
  `bunx @xessa/cli …`, or install `@xessa/cli` first so the local `xessa` bin exists.
- **Old `chikx` commands or config files.** The project was renamed to Xessa; use `xessa …` and
  `xessa.config.json`. `.cssx` is the source extension either way.
- **`XESSA1002: Expected ";"`.** Xessa declarations require semicolons, including the last one in a
  block.
- **"Source file … is outside the workspace root".** The nearest config or `package.json` belongs to
  a different project. Pass `--config` for the intended project, or run from inside it.
- **"No .cssx sources matched the project include globs".** Check `include`, the working directory
  and the workspace root; this is exit 2 by design.
- **`format --check` exits 1 but changed nothing.** It reports files that *would* change. Run
  `xessa format` to write them.
- **`clean` leaves a file behind.** It was edited after generation (hash mismatch), is outside the
  workspace, or is not recorded as a compiler artifact. `clean` never deletes unowned files.
- **Unknown configuration key exits 2.** Fix the key, or opt into warnings with
  `"compiler": { "strict": false }`.
- **Installing ahead of the release.** `0.1.1` is on npm; `0.1.2` is release-ready but not yet
  published, so use the source checkout commands above to run the newest changes.

## Documentation map

| Topic                                              | Where                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Complete language and compiler spec (normative)    | [`@xessa/compiler` README](https://github.com/MARKjotep/xessa/blob/main/packages/compiler/README.md) and [`SPECIFICATION.md`](https://github.com/MARKjotep/xessa/blob/main/SPECIFICATION.md) |
| Grammar and lexical rules                          | [`docs/grammar.md`](https://github.com/MARKjotep/xessa/blob/main/docs/grammar.md)                                 |
| Cascade and emitted order                          | [`docs/cascade.md`](https://github.com/MARKjotep/xessa/blob/main/docs/cascade.md)                                 |
| Configuration keys and precedence                  | [`docs/configuration.md`](https://github.com/MARKjotep/xessa/blob/main/docs/configuration.md)                     |
| Practical usage guide                              | [`docs/usage.md`](https://github.com/MARKjotep/xessa/blob/main/docs/usage.md)                                     |
| Compatibility and known limitations                | [`docs/compatibility.md`](https://github.com/MARKjotep/xessa/blob/main/docs/compatibility.md), [`docs/known-limitations.md`](https://github.com/MARKjotep/xessa/blob/main/docs/known-limitations.md) |
| Editor integration (VS Code)                       | [`packages/vscode/README.md`](https://github.com/MARKjotep/xessa/blob/main/packages/vscode/README.md)            |
| Compiler API                                       | [`packages/compiler/README.md`](https://github.com/MARKjotep/xessa/blob/main/packages/compiler/README.md)                                                            |

## License

MIT. See [`LICENSE`](https://github.com/MARKjotep/xessa/blob/main/LICENSE).
