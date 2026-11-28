# ADR-0025: Group composition inside definitions

## Status

Accepted (owner sign-off 2026-11-28) — project owner decision, normative for v0.1. Supersedes the
"group chaining is a v2 candidate" note and exclusion 9.5 of
[ADR-0017](ADR-0017-reusable-declaration-groups.md).

Related: [ADR-0017](ADR-0017-reusable-declaration-groups.md), [ADR-0014](ADR-0014-styles-import-rule-merge.md),
[ADR-0015](ADR-0015-keyframes-namespace.md), [ADR-0005](ADR-0005-raw-value-slices.md),
[SPECIFICATION.md](../SPECIFICATION.md) §3.7, [docs/grammar.md](../grammar.md),
[docs/usage.md](../usage.md), [docs/known-limitations.md](../known-limitations.md).

## Context

ADR-0017 made a definition a flat list of declarations and deliberately rejected a definition
referencing another group: expansion was a pure declaration splice, recursion was impossible, and
"group chaining" was left as a v2 candidate. Real stylesheets quickly repeat a larger block (card
chrome) and then a narrower block built from it (compact card, elevated card). Today that either
duplicates the shared declarations or forks the group under a new name, and the copies drift exactly
as the original ADR-0017 problem described.

The owner approved extending definitions with **composition**: a definition may contain a nested
`@group.<base> { overrides }` statement. Composition must not turn groups into mixins, must not make
selector use sites recursive, and must not silently deduplicate authored output.

## Decision

1. **Composition is a definition-body statement.** A `GroupDefinition` body is an ordered sequence of
   declarations and nested `@group.<base> { overrides }` composition blocks. A nested group is a
   composition statement, not a nested definition and not a re-export. Nothing is registered under
   the composed name: the top-level definition list and duplicate-name rules are unchanged.

2. **Use sites stay declarations-only.** `@group.card { … }` inside a rule still accepts declarations
   only. A `@group.` statement there — or inside a composition block's overrides — is `XESSA1001`, the
   offending statement is omitted and the rest of the block survives. Nested rules, conditional
   blocks and native at-rules are `XESSA1001` in both definitions and use sites.

3. **Expansion order is authored.** For a definition, walk its body in authored order: a declaration
   splices in place; a composition expands the base's effective declarations, then that composition
   block's overrides, then continues. A use site then splices the resolved definition's effective
   declarations, then its own declarations. The cascade is unchanged: later declarations win at equal
   specificity.

4. **Scope is the defining module's.** A composition target resolves with the visibility a use site in
   the **defining module** would see: that module's own definitions first, then its transitive
   `styles` imports, with local shadowing. Token-only imports expose no groups. A consumer that
   defines a same-named group cannot rebind a base composed inside an imported definition.

5. **Diamonds are textual.** The same group may be composed more than once. If `a` composes `b` and
   `c`, and both compose `d`, `d` expands on both paths. Declarations and group identities are never
   deduplicated; the compiler still never filters, reorders, merges or rewrites authored lines.

6. **Cycles and depth are XESSA2001.** A composition that closes a cycle is `XESSA2001` at that
   statement with the chain in the message (`@group.a -> @group.b -> @group.a`). Nested composition
   depth is capped at 64; exceeding it is `XESSA2001` at the offending statement with no recursion.
   Only the offending composition statement is omitted; the rest of the chain and the use site
   continue. Unknown and ambiguous targets reuse the existing `XESSA2001` messages and recovery.

7. **Spans and tokens stay authored.** Every spliced declaration remains the defining module's own
   node with its authored span and `span.file`, at any composition depth. A base default's `$refs`
   resolve in the base module; a composition override's `$refs` resolve in the module that authored
   the definition. A `@runtime` reference in a default or composition override is `XESSA2001` and
   that segment is omitted, exactly like a direct default.

8. **Unused definitions stay inert.** A cycle or unknown target inside a definition that is never
   expanded produces no diagnostic and no output. This matches ADR-0017's inert-definition rule and
   keeps the graph pass free of composition analysis.

9. **No new diagnostic code.** `XESSA1001` covers syntax misuse and `XESSA2001` covers resolution,
   cycle and depth failures. The formatter round-trips composition blocks and stays idempotent.

## Rejected alternatives

- **Parameters, arguments or mixin semantics.** Rejected: it would make `@group` a macro language
  with substitution rules, evaluation order and a new contract, far beyond the owner's request. The
  feature is still "override at the use site", now with one level of definition reuse.
- **Composition in selector use sites.** Rejected: it makes expansion recursive at the point of use,
  mixes per-rule overrides with definition reuse, and lets one rule's authored text depend on another
  rule's block. Composition belongs to definitions, which are already inert until expanded.
- **Deduplicating diamonds or repeated compositions.** Rejected: it violates ADR-0017's no-filter
  invariant, changes cascade behaviour under `!important` and conditional variants, and makes output
  depend on hidden identity tracking. Textual expansion is predictable and testable.
- **Treating a nested group as a re-export or alias.** Rejected: it would change visibility and
  duplicate rules, and would let definition shape affect import scope. Composition expands text and
  exports nothing.
- **Diagnosing cycles at graph time for every definition.** Rejected: unused definitions must stay
  inert (ADR-0017), and only an expanded chain makes a cycle actionable.

## Consequences

- A shared block is authored once and extended by derivation instead of copy-paste; overrides still
  work through the ordinary cascade.
- Correct resolution needs the per-module visible scopes at expansion time. `expandGroupUseSites`
  accepts them as an optional map, and the compiler passes one module → scope map built once per
  entry; old callers without the map keep single-module behaviour.
- Every existing golden and example outside the new composition fixtures stays byte-identical:
  definitions still emit nothing and group-free sources are untouched.
- Editor support for composition (completion, hover, navigation, media `+` alias completion) is a
  separate follow-up; this ADR only ships the compiler, spec, formatter and docs.
