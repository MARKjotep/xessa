# ADR-0002: Bare nested selectors mean descendant nesting

## Status

Accepted (2026-11-25, owner decision)

Related: SPECIFICATION.md §3, §7

## Context

The earlier design left open whether a nested selector without `&` "may mean descendants". Ambiguity
here changes emitted selectors and specificity, so v0.1 must pick one reading.

## Decision

A nested rule whose selector contains no `&` is a **descendant** selector, not a declaration and not
an implicit concatenation. For example:

```xessa
.button {
  .icon { width: 16px; }
}
```

lowers to `.ui-button .ui-icon` under the `ui` prefix, exactly as if the author had written
`& .icon`.

Nested rules are distinguished from declarations by balanced-token lookahead (a `{` before the
statement terminator, accounting for strings, comments, parentheses, brackets and escapes), never by
the mere presence of a colon.

## Consequences

- Authors can use concise descendant nesting; `&` remains required for compound, sibling and other
  complex nesting in v0.1.
- The parser must perform lookahead before committing to a declaration, which is part of A04.
- This decision resolves the earlier "may mean descendants" ambiguity; it does not add selector
  features beyond §3.5.
