# ADR-0013: `.cssx` is the source file extension

## Status

Accepted (2026-11-25) — project owner decision. Amends ADR-0001 for the source file extension only;
every other public name stays Xessa.

Related: ADR-0001 (public name), the 2026-11-24 naming decision (superseded for the extension only),
`docs/release.md`.

## Context

ADR-0001 renamed the project to Xessa and chose `.xessa` for source files alongside `@xessa/*`
packages, the `xessa` CLI, the VS Code language ID `xessa` and the `XESSA####` diagnostic family.
After using the language, the owner prefers `.cssx` for files: it reads immediately as "CSS + X",
matches the property-centric idea, and keeps editor file lists free of a name that reads like a
personal fork.

The extension is the only public artifact being reverted. Language ID, aliases, TextMate scopes,
packages, CLI command, configuration filename and diagnostics keep the Xessa name, so no consumer
has to translate between two product identities.

## Decision

- Source files use the `.cssx` extension.
- The VS Code extension contributes `extensions: [".cssx"]` for language ID `xessa`; the display
  aliases stay `Xessa`/`xessa` and the grammar scope stays `source.xessa`.
- Unchanged: `@xessa/*` packages, the `xessa` CLI command, `xessa.config.json`, `XESSA####`
  diagnostics and all prose naming.
- The CLI bookkeeping file becomes `.cssx-manifest.json` (and the compiler's temporary-file suffix
  `.cssx-tmp`) so the whole source-artifact family shares one extension token. Both are internal,
  unreleased and not configuration keys.
- No `.xessa` alias, dual extension registration or migration path ships in v0.1.

## Rationale

- Owner preference is the deciding factor; the cost is mechanical and contained.
- One extension token (`.cssx`) for sources, their manifest and temp files avoids mixed naming in
  ignore rules and documentation.
- Reversible: reverting is a rename and a documentation edit, with no API or grammar change.

## Consequences

- `grep -r "\.xessa"` now finds only historical records (this ADR, ADR-0001's history, changelog and
  archived task reports); functional code and docs use `.cssx`.
- Existing `.xessa` files are not recognised by v0.1 tooling. The project is unreleased, so no
  migration note is needed beyond this decision.
- ADR-0001's package/command/language-ID/diagnostic decisions remain in force; only its source
  extension clause is amended.
