# @xessa/compiler

The Xessa compiler: lexer, parser, module resolver, media lowering, selector lowering, class naming,
CSS/JS/TypeScript emission, source maps and output planning. It is pure TypeScript with no runtime
dependencies and runs on Node.js ≥ 20 and Bun.

**This package owns the language and compiler contract.** The CLI, the language service and the VS
Code extension are clients of these entry points; their documentation covers usage, not language
semantics. The normative, complete definition is the repository-root
[`SPECIFICATION.md`](https://github.com/MARKjotep/xessa/blob/main/SPECIFICATION.md). This README is
an orientation, not a substitute for it.

Source files use the `.cssx` extension (ADR-0013). The language ID (`xessa`), CLI command
(`xessa`), configuration file (`xessa.config.json`) and diagnostic codes (`XESSA####`) keep the
Xessa name.

## Documentation map

| Topic                                                       | Reference                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Complete normative language and compiler specification**  | [`SPECIFICATION.md`](https://github.com/MARKjotep/xessa/blob/main/SPECIFICATION.md)                              |
| Grammar, lexical rules and decisions D1–D3                  | [`docs/grammar.md`](https://github.com/MARKjotep/xessa/blob/main/docs/grammar.md)                                |
| Cascade contract and emitted order                          | [`docs/cascade.md`](https://github.com/MARKjotep/xessa/blob/main/docs/cascade.md)                                |
| Configuration keys and precedence                           | [`docs/configuration.md`](https://github.com/MARKjotep/xessa/blob/main/docs/configuration.md)                    |
| Compatibility and known limitations                         | [`docs/compatibility.md`](https://github.com/MARKjotep/xessa/blob/main/docs/compatibility.md), [`docs/known-limitations.md`](https://github.com/MARKjotep/xessa/blob/main/docs/known-limitations.md) |
| Practical usage guide                                       | [`docs/usage.md`](https://github.com/MARKjotep/xessa/blob/main/docs/usage.md)                                     |
| CLI commands, flags and project workflows                   | [`@xessa/cli`](https://github.com/MARKjotep/xessa/blob/main/packages/cli/README.md)                               |
| Editor integration (registration, completions, settings)    | [`xessa` for VS Code](https://github.com/MARKjotep/xessa/blob/main/packages/vscode/README.md)                     |

The published tarball ships `SPECIFICATION.md` and `docs/`; read them from
`node_modules/@xessa/compiler/` (for example `node_modules/@xessa/compiler/SPECIFICATION.md` and
`node_modules/@xessa/compiler/docs/grammar.md`). The copies are generated from the repository at
pack time, so they match the published compiler version.

## Language contract

Xessa is **CSS-first and property-centric**. A `.cssx` file is a stylesheet: declarations sit inside
ordinary selectors, and responsive, theme and state variants live inline with the base value instead
of in a separate utility system. Compilation produces plain CSS plus a static JavaScript class map;
there is no browser runtime and no framework dependency.

Sources are organized by top-level directives:

| Directive       | Purpose                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `@setup`        | File-level output, prefix, minification and module settings. Top-level only.                   |
| `@use`          | Import another `.cssx` module as a token namespace, with `styles` to merge its rules and groups. |
| `@variables`    | Compile-time variables, substituted and erased at build time.                                  |
| `@runtime`      | Runtime tokens emitted as CSS custom properties (themeable without recompiling).               |
| `@media-types`  | File-level media alias definitions or overrides.                                               |
| `@group`        | Reusable declaration groups and their use sites.                                               |

Inline variants (`value @md other`) compile to ordinary `@media` blocks in authored order; nested
selectors and `&` flatten to standard CSS selectors. Classes are renamed through the configured
prefix and collected into the class map (`button` → `"ui-button"`), which holds only bindings and
imports no CSS unless `import-css: true` is set.

Canonical example:

```cssx
@setup {
  prefix: "ui";
}
@use "./theme.cssx" as theme;
@variables {
  spacing: 12px;
}
.button {
  display: flex;
  padding: $spacing @md 20px;
  background: $theme.primary @dark #1e40af;
  &:hover { opacity: 0.85; }
}
```

The complete grammar, directive rules, alias semantics, cascade guarantees and limitations are in
the specification linked above.

## Install

**0.1.1** is live on npm; **0.1.2** is release-ready, not yet published. Install the current release:

```sh
npm install @xessa/compiler
# or
bun add @xessa/compiler
```

## Use

`compile()` is async; await it. It returns artifacts and **never writes files**.

```ts
import { compile } from "@xessa/compiler";

const result = await compile(source, { file: "src/button.cssx" });

if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
}

console.log(result.css, result.js, result.classes);
```

Project builds, output planning, the CLI and the VS Code extension are built on the same entry
points. `compileProject()` compiles several entries through one shared module graph and an injected
filesystem host.

## API

| Export            | Purpose                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `compile`         | Compile one source string to artifacts and diagnostics. Async; never touches the filesystem.     |
| `compileProject`  | Resolve several entries through one module graph and compile each with shared project settings.   |
| `parse`           | Tolerant parse to a partial AST plus syntax/lexical diagnostics.                                 |
| `format`          | Canonical source formatting (parse→print); returns the input unchanged when parsing fails.       |
| `tokenize`        | Lossless token stream plus lexical diagnostics.                                                  |
| `planOutputs`     | Resolve, validate and return an output plan (collisions, containment, symlink escapes). No writes. |
| `createNodeHost`  | The default Node/Bun filesystem host for `compileProject` and other host-consuming entry points. |

`compile()` returns a `CompileResult`:

| Field           | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `css`           | Generated stylesheet, when CSS emission is enabled.                             |
| `js`            | Generated JavaScript class map, when map emission is enabled.                   |
| `types`         | Generated TypeScript declarations, when type emission is enabled.               |
| `sourceMap`     | Standard v3 CSS source-map text, when requested and CSS is emitted.             |
| `classes`       | Authored→emitted class table with null-prototype safety semantics.              |
| `diagnostics`   | Errors and warnings in source order, each with a stable code and span.          |
| `dependencies`  | Workspace-relative POSIX paths of every module the source depends on.           |

## Diagnostics

Diagnostic codes are stable and grouped by phase:

- `XESSA1xxx` — syntax and lexical errors (for example `XESSA1002`, a missing semicolon).
- `XESSA2xxx` — symbol, variable, module and import resolution.
- `XESSA3xxx` — media aliases, conditions and grouping.
- `XESSA4xxx` — class naming and map collisions.
- `XESSA5xxx` — output planning, paths and collisions.

Warnings do not fail a build; errors do. The CLI maps spans to 1-based line/column positions and
exits 1 when any error is present.

## License

MIT. See [`LICENSE`](https://github.com/MARKjotep/xessa/blob/main/LICENSE).
