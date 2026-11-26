# ADR-0005: AST values keep raw source slices

## Status

Accepted (2026-11-25)

Related: SPECIFICATION.md §3, §11

## Context

Declarations carry arbitrary CSS token sequences, custom properties and `$` references. Normalizing
values to strings early loses escaped token boundaries and source fidelity; keeping only a token
stream complicates exact round-tripping.

## Decision

Value-bearing AST fields hold the **raw source slice** exactly as authored. When a value contains
`$` references, the node additionally carries a parsed token sequence (literal and reference tokens)
used for substitution. Both point into the original source and every AST/IR node preserves its
`Span` through all stages.

This additively refines the public API interface shapes; existing raw value fields remain strings. Transformations never rewrite source text in place; lowering produces new IR nodes.

## Consequences

- Generators can emit authored CSS tokens byte-for-byte where no rewrite is needed.
- Source maps can map generated declarations back to original spans.
- The parser must build the optional token sequence only when `$` is present to keep the common
  path cheap.
- Contract tests (A02) freeze both shapes; changes require lead approval.
