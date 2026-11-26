# ADR-0004: Conditional blocks are rule-scoped in v0.1

## Status

Accepted (2026-11-25, owner decision); revisit via a future ADR

Related: SPECIFICATION.md §3, §4

## Context

The grammar allows `conditionalBlock` inside a rule. It does not state what a top-level
`@md { ... }` means, and accepting it would require a different lowering and cascade contract.

## Decision

In v0.1 conditional blocks are valid **only inside rules**. A top-level conditional block such as

```xessa
@md {
  .card { padding: 20px; }
}
```

is a syntax error in the XESSA1001 family ("conditional block outside rule"). The parser reports it
once and recovers at the next safe statement boundary so editor diagnostics and subsequent rules
continue to parse. No CSS is emitted for the rejected block.

Top-level native CSS at-rules (`@media`, `@supports`, `@layer`, `@keyframes`, `@font-face`,
`@property`) retain their native meaning and are not Xessa conditional blocks.

## Consequences

- Conditional-only declarations are written inside a rule, with a base value where needed.
- Supporting top-level conditional blocks later needs a superseding ADR, cascade fixtures and
  language-service updates.
- Error recovery at statement boundaries is an A03/A04 acceptance requirement.
