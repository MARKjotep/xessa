# ADR-0008: Development tooling and quality gate

## Status

Accepted (2026-11-25)

Related: SPECIFICATION.md §13

## Context

The compiler must run on Node.js and Bun, while development uses Bun workspaces. Tooling choices
must not leak into the published compiler runtime.

## Decision

- **Bun workspaces** manage the monorepo and development scripts.
- **`bun test`** runs unit and golden tests.
- A **Node.js >= 20 smoke test** exercises the public API and the compiled CLI to prove runtime
  compatibility.
- **Biome** is a dev-only linter/formatter.
- **`bun run verify`** is the aggregate quality gate (`typecheck` + `lint` + `test`), and fails if
  any step fails.
- The compiler core keeps **zero mandatory third-party runtime dependencies**; dev tooling lives at
  the workspace root.

## Consequences

- Published packages must not import Bun-only APIs in core paths.
- CI (when added) runs `bun run verify` plus the Node smoke test and browser/extension suites.
- Adding a compiler runtime dependency requires justification in a new ADR or an amendment here.
