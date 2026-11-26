# ADR-0007: Workspace root and output containment

## Status

Accepted (2026-11-25)

Related: SPECIFICATION.md §6, §9, §10

## Context

File-level output directories resolve relative to the source, and imports resolve relative to the
importing file. Without a workspace boundary, a project can read or write outside its intended tree.

## Decision

The **workspace root** is the nearest ancestor directory containing `xessa.config.json`; if none
exists, the nearest ancestor containing `package.json`.

- Imports are relative and restricted to the workspace root. No network imports or executable
  source.
- File-level output directories resolve relative to the source file, never the current working
  directory; project-level directories resolve relative to the workspace root.
- The output planner rejects input/output overlap, duplicate targets, path traversal, workspace
  escapes and symlink escapes before writing, unless an explicit trusted project policy permits
  external output.

## Consequences

- `xessa.config.json` establishes project boundaries for multi-root editors and CI.
- All output is validated as a complete plan before the first write; failures retain last successful
  outputs and mark them stale.
- Tests must cover traversal, symlink escape, collision and nested-source cases.
