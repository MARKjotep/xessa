# ADR-0001: Xessa is the only public name

## Status

Accepted (2026-11-25). Amended by [ADR-0013](ADR-0013-cssx-file-extension.md) for the source file
extension only; every other decision below stands.

Related: the 2026-11-24 naming decision; SPECIFICATION.md §1, §12; ADR-0013

## Context

The project was previously referred to as CSSX. The owner renamed it to Xessa, and a stale alternate
name in packages, commands, file extensions or diagnostic codes would fragment the public contract.
The repository directory is named `xessa`, which is incidental.

## Decision

Use Xessa everywhere public:

- packages are scoped `@xessa/*`; the workspace root package is `xessa` (a name-reservation pointer;
  the CLI is `@xessa/cli`);
- the CLI command is `xessa`;
- source files use the `.cssx` extension (ADR-0013; ADR-0001 originally chose `.xessa`);
- the VS Code language ID is `xessa`;
- diagnostics use the `XESSA####` family;
- prose uses "Xessa".

The repository directory name `xessa` does not affect any package name, command, extension,
language ID or artifact.

## Consequences

No `cssx` package scope, command or diagnostic alias is shipped. `.cssx` is the source file
extension per ADR-0013; that is a file-name decision, not a second public name. Renames of public
artifacts require a superseding ADR and migration notes.
