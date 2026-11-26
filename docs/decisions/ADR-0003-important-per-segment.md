# ADR-0003: `!important` binds per inline value segment

## Status

Accepted (2026-11-25, owner decision)

Related: SPECIFICATION.md §3, §5

## Context

An inline variant declaration such as `padding: 10px @md 20px` expands into one base declaration
and one conditional declaration. It is unspecified whether a trailing `!important` applies to the
whole authored line or only to the segment in which it appears.

## Decision

`!important` binds **per value segment**. It terminates the segment it appears in and is ordinary
CSS token content of that segment; each inline-variant segment is an independent CSS declaration.

```xessa
padding: 10px @md 20px !important;
```

emits the base declaration `padding: 10px` without `!important` and the `md` declaration
`padding: 20px !important`. To make the base important, write `padding: 10px !important @md 20px
!important` (each segment carries its own flag).

The tokenizer keeps `!important` in the value's raw token slice; it is not a modifier alias and does
not terminate inline-variant parsing. CSS cascade rules then apply normally.

## Consequences

- The compiler never propagates `!important` across segments.
- Golden tests must cover important flags on base only, variant only, multiple segments and
  shorthand/longhand interactions.
- `!important` remains native CSS content; no new syntax is introduced.
