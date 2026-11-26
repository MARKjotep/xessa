# ADR-0012: `&` substitution follows native CSS nesting semantics

## Status

Accepted (2026-11-25, lead decision)

Related: SPECIFICATION.md §3.4, §7.1; ADR-0002

## Context

SPECIFICATION.md §7.1 supports `&:hover`, `&::before`, `&:nth-child(2n)`, `& > .icon`, `& + .button`
and descendant nesting, and requires `&` for compound and complex nesting. It did not state whether
`&` may be trailing, repeated or preceded by other selector parts, although multiple `&` references
must be validated. Selector lowering needs one unambiguous substitution rule.

## Decision

`&` is replaced by the parent selector using **native CSS nesting substitution semantics**:

- It may appear in any position, including trailing (`.icon &`), leading (`& > .icon`) or between
  other selector parts (`.row & + .item`).
- It may appear multiple times per compound selector (`& + &`, `&&`) and each occurrence substitutes
  the parent selector.
- An escaped `\&` is a literal ampersand character and is never substituted.
- An `&` inside a string, comment or attribute value is never rewritten.

Selectors remain raw slices in the AST (ADR-0005); only lowering performs substitution, and it must
preserve native specificity (mixed-specificity parent lists use `:is(...)` where needed or are
rejected rather than naïvely expanded).

## Consequences

- A06 can implement one substitution algorithm for leading, trailing and repeated references.
- `nesting/multiple-amp` pins `.row &` and `& + &`; other nesting fixtures pin compound and
  pseudo/combinator forms.
- Escaped ampersands and selector text inside strings or attribute values stay byte-for-byte as
  authored.
- No AST or token contract change is required.
