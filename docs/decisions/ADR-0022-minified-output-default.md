# ADR-0022: Minified output by default (`minify` / `output.minify`)

## Status

Accepted (2026-11-26) — project owner decision, normative for v0.1. Flips the built-in output default
from `false` to `true` without adding an option or changing the precedence chain.

Related: SPECIFICATION.md §9, §10; ADR-0019, ADR-0021; CSSX-F22; `.ai/reports/CSSX-F22.md`

## Context

`minify` started as an opt-in emitter setting. The generated CSS shipped to pages, committed
examples, bundler builds and the extension preview was therefore expanded by default, even though
production consumers usually want the smaller bytes. A project or file could opt into compaction,
but the common path required an extra setting per file or project.

The existing contract already separates generated structural whitespace from authored content:
minification removes indentation, newlines, the space after `:`, spaces around braces and blank lines
between sibling rules, while preserving selector text, declaration values, quoted strings,
`url(...)`, `calc(...)` internals, at-rule prelude whitespace and declaration order. It affects the
emitted stylesheet only; `format()`, the class map, `.d.ts` declarations and source-map content are
separate outputs.

The precedence chain is frozen: built-in defaults < project `xessa.config.json` < file `@setup` <
explicit CLI flags. `--minify` / `--no-minify` already win last-wins, and the CLI already reports a
file-level conflict rather than silently ignoring it.

## Decision

Make minified CSS the built-in output default for v0.1:

1. **Default.** `minify` (`@setup`) and `output.minify` (`xessa.config.json`) default to `true` in the
   compiler's resolved setup, CLI setup and editor output defaults. `compile()`, `compileProject()`,
   `xessa build` (project and single-file), `xessa watch`, the extension's Compile File,
   compile-on-save and Preview all emit compact CSS without extra configuration.
2. **Opt-outs stay exactly as before.** `@setup { minify: false; }`, project
   `"output": { "minify": false }` and `--no-minify` restore the previous expanded bytes.
   `--minify` remains the explicit override in the other direction, and the last minify flag wins.
   The precedence chain is unchanged.
3. **Only emitted CSS changes.** `format()` source formatting, the class map and `.d.ts` declarations
   keep their existing bytes. Source maps keep the same v3 format and generation rules; their
   mappings continue to describe the real generated positions for both modes.
4. **Committed artifacts follow the contract.** The eight `examples/*/generated/*.css` files are
   regenerated in the same change. Rebuilding them twice must be byte-identical. Example sources are
   not edited.

## Rejected alternatives

- **Keep the expanded default.** Rejected by the owner: it ships avoidable bytes by default and makes
  every production project repeat an opt-in. The expanded form is still one setting away for readers
  and debugging.
- **Add a second `dev`/`production` mode.** Rejected: `minify: false` / `--no-minify` already expresses
  the only difference such a mode would control. A second mode would duplicate precedence and invite
  ambiguity with the existing boolean.
- **Minify every artifact.** Rejected: the request is about emitted CSS size. Reformatting class maps,
  declarations or source-map JSON would break byte contracts without consumer benefit.
- **Change `format()` to emit compact source.** Rejected: the formatter is a source-authoring tool;
  its readable canonical layout is independent of generated CSS delivery.

## Consequences

- Default builds, committed examples and the extension preview are compact. A reader who wants
  expanded CSS opts out per file, per project or per invocation.
- The byte contract change is deliberate: existing golden expectations that assert default output
  were regenerated to the minified bytes. Tests that explicitly pass `minify: false` keep pinning the
  expanded form and were not weakened.
- `format()` output remains unchanged, so Format Document / format-on-save still produce the readable
  canonical source layout.
- The setting surface is unchanged: no new key, no new flag and no schema addition. `--minify` and
  `--no-minify` keep their documented last-wins behaviour.
- Documentation, `CHANGELOG.md` and the example output describe minified CSS as the default; expanded
  output is documented as the opt-out.
