# @xessa/compiler

The Xessa compiler: lexer, parser, resolver, media lowering, selector lowering, class naming,
CSS/JS/TypeScript emission, source maps and output planning. It is pure TypeScript with no runtime
dependencies and runs on Node.js >= 20 and Bun.

Source files use the `.cssx` extension (ADR-0013). The language ID (`xessa`), CLI command (`xessa`),
configuration file (`xessa.config.json`) and diagnostic codes (`XESSA####`) keep the Xessa name.

## Install

**0.1.1** is the first Xessa release (2026-11-27), prepared for publication; publish with
`docs/release.md`. Once published, install it with:

```sh
npm install @xessa/compiler
```

## Use

`compile()` is async; await it. It returns artifacts and never writes files.

```ts
import { compile } from "@xessa/compiler";

const result = await compile(source, { sourceFile: "src/button.cssx" });
if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
}
```

Project builds, output planning, the CLI and the VS Code extension are built on the same entry points.

## Documentation

The repository `README.md`, `SPECIFICATION.md`, `docs/grammar.md`, `docs/cascade.md`,
`docs/configuration.md` and `docs/compatibility.md` are the normative references. `CHANGELOG.md`
lists v0.1 behaviour and known gaps.

## License

MIT. See `LICENSE` in this package.
