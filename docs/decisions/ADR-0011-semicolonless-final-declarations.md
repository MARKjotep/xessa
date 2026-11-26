# ADR-0011: Semicolonless final declarations are limited to plain CSS

## Status

Accepted (2026-11-25, lead decision)

Related: SPECIFICATION.md §3.1, §12; ADR-0003, ADR-0011 fixtures

## Context

SPECIFICATION.md §3.1 requires semicolons for Xessa declarations while allowing ordinary CSS final
declarations without a trailing semicolon before `}` to be accepted. The spec did not define what
makes a final declaration "ordinary CSS", so a declaration carrying Xessa-only syntax could either be
tolerated or rejected, changing diagnostics and cascade output.

## Decision

An ordinary CSS final declaration without a trailing semicolon before `}` is accepted **only** when it
contains no Xessa-specific syntax: no recognized modifier and no `$` reference.

A declaration that carries a recognized modifier or a `$` reference is a Xessa declaration even when
it is the last statement in a block. It **must** have its terminating semicolon; otherwise the parser
reports `XESSA1002` and recovers at the next statement boundary. Recovery keeps the accepted final
declaration and omits the rejected one.

## Consequences

- Plain CSS pass-through remains practical: `color: red` before `}` needs no semicolon, and authors
  do not get diagnostics for ordinary CSS.
- Xessa syntax always requires explicit termination, so modifier/value segmentation and `$`
  substitution never guess where a declaration ends.
- `XESSA1002` has one unambiguous meaning: a Xessa declaration is missing its semicolon.
- Fixtures `lexical/final-no-semicolon` (no diagnostics) and `errors/semicolonless-modifier`
  (`XESSA1002`) pin both sides; A04 owns the implementation.
