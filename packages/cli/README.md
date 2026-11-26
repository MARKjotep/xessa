# @xessa/cli

The Xessa command line interface: `xessa build`, `xessa watch`, `xessa check`, `xessa format` and
`xessa clean`. It uses the same `@xessa/compiler` as the API and the VS Code extension.

Source files use the `.cssx` extension (ADR-0013). The command, configuration file
(`xessa.config.json`) and diagnostic codes (`XESSA####`) keep the Xessa name.

## Install

**0.1.1** is the first Xessa release (2026-11-27), prepared for publication; publish with
`docs/release.md`. Once published, install it with:

```sh
npm install --global @xessa/cli
# or run it without installing
npx @xessa/cli build
```

The packaged `bin` entry is the built `dist/index.js`, so `npx @xessa/cli` / `bunx xessa` no longer
need a TypeScript loader. The source and built entry use the `#!/usr/bin/env node` shebang, so the
CLI runs on a Node-only machine (Bun executes the same file).

## Commands

| Command | Purpose |
|---|---|
| `xessa build [file]` | Build one entry or the project from `xessa.config.json`. |
| `xessa watch [file]` | Rebuild affected entries on change. |
| `xessa check [file]` | Validate without writing. |
| `xessa format [file] [--check]` | Format source files or verify formatting. |
| `xessa clean` | Delete manifest-owned, unmodified generated files. |

Exit codes: `0` success, `1` compile/validation error, `2` invocation or configuration error.

## Documentation

The repository `README.md`, `docs/configuration.md`, `docs/release.md` and `CHANGELOG.md` describe
configuration, precedence, output safety and known gaps.

## License

MIT. See `LICENSE` in this package.
