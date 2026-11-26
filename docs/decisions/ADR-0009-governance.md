# ADR-0009: Repository governance for Xessa

## Status

Accepted (2026-11-25, owner instruction)

Related: `.ai/PROGRESS.md`

## Context

The repository inherits `AGENTS.md` and `.ai/agents/AGENTS.md` guidance written for a different
project. Those files mandate `builder/html_builder.ts` builds, `client/` bundling and Tally JSDoc,
and ask that `.ai/` root stay free of files. The project's own specification and workflow documents
define its process.

## Decision

- `.ai/PROGRESS.md` lives at the `.ai/` root per explicit owner instruction. This overrides the
  older "keep `.ai/` root free of files" guidance in `.ai/agents/AGENTS.md`.
- At most **two concurrent implementation workers**, each with disjoint file ownership, per owner
  instruction.
- The project specification supersedes the root `AGENTS.md` template rules about
  `builder/html_builder.ts`, `client/` builds and Tally JSDoc.
- Workers keep `.ai/reports/<id>.md` records; task prompts are disposable. The lead independently
  verifies gates and updates progress.

## Consequences

- Project-specific build and documentation rules in `SPECIFICATION.md` and `AGENTS.md` win over
  generic template guidance.
- Shared interfaces may not change without lead approval.
- Progress is never marked complete from agent claims alone.
