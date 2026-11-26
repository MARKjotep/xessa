# ADR-0015: Built-in `keyframes` namespace (`$keyframes.<name>`)

## Status

Accepted (2026-11-25) — project owner decision, normative for v0.1. The owner chose the syntax and
reviewed the visibility rule in this ADR.

Related: SPECIFICATION.md §3.5, §3.6, §6.1, §6.3, §6.4; ADR-0005, ADR-0014;
`.ai/reports/CSSX-A19.md`

## Context

An `animation-name` (or `animation` shorthand) has to repeat the identifier of its `@keyframes`
block. Nothing in v0.1 links the two, so renaming a keyframe silently breaks the animation, and the
duplicated identifier is invisible to tooling. Authored keyframes are already native CSS
(SPECIFICATION.md §3.5): the compiler parses the at-rule, keeps its prelude as a raw slice and emits
the block unchanged.

The workaround that exists in v0.1 today is a plain compile-time token:

```xessa
@variables { spin: spin; }
@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
.spinner { animation-name: $spin; }
```

It works, and it keeps working unchanged, but the registration is manual and easy to get wrong.

The owner decided on 2026-11-25 that `@keyframes <name>` should *itself* register the name, exposed
as `$keyframes.<name>`. The first version scoped visibility to the declaring file; the owner
extended it in review: a name is referenceable exactly where its `@keyframes` block is emitted in the
consuming build, which includes modules imported with `@use "…" styles;` (ADR-0014). No separate
"keyframe export" concept was wanted.

## Decision

1. **Registration.** Every top-level `@keyframes <name>` block in a module registers `<name>` in a
   built-in `keyframes` namespace for that module. The registered name is the authored prelude
   trimmed of surrounding whitespace, and only when it is a single plain identifier. String-named
   keyframes (`@keyframes "fade"`), escaped identifiers and other preludes stay native CSS and are
   not addressable, because the `$keyframes.<member>` member text must equal the emitted name byte
   for byte. The at-rule name is matched ASCII case-insensitively, like every native at-rule.
   `@keyframes` blocks nested inside a rule or inside another at-rule block (for example `@media`)
   are not collected in v0.1, so conditional keyframes stay native-only.
2. **Reference and expansion.** `$keyframes.<name>` in a declaration value is a compile-time
   reference that expands to the keyframe name text: `animation-name: $keyframes.spin;` emits
   `animation-name: spin;`. Expansion is textual and verbatim, like other compile-time
   substitution: it is not recursive (the spliced text contains no `$`), repeated references in one
   value are fine, and the `@keyframes` block itself keeps being emitted as native CSS. At-rule
   preludes are never substituted, so `@keyframes $keyframes.spin` is not a construct.
3. **Visibility follows emit safety.** A module sees its own top-level keyframe names plus the names
   of every module reached through a `styles` `@use` edge, transitively in authored order
   (ADR-0014). That is exactly the set of `@keyframes` blocks the consuming build emits, so a
   reference can never produce `animation-name: spin` without a matching `@keyframes spin` block.
   A token-only `@use` imports no CSS, so its keyframe names are deliberately **not** visible;
   referencing one is XESSA2001 (item 4) rather than a silently broken runtime stylesheet.
4. **Failures reuse XESSA2001.** An unknown member (`$keyframes.fade` when no visible `fade` exists),
   a name from a token-only import, and a bare `$keyframes` follow SPECIFICATION.md §6.1/§5.5
   undefined/namespace semantics: one XESSA2001 at the reference, and the affected declaration
   segment is omitted, dropping the declaration or the rule when nothing else remains. An
   `@use "…" as keyframes` alias is XESSA2001 at the `@use` statement and does not create a
   namespace, so the built-in namespace cannot be shadowed. No new diagnostic code is added to the
   frozen registry. A compile-time token literally named `keyframes` is unaffected: it answers a bare
   `$keyframes`, while the member form `$keyframes.<name>` always means the built-in namespace, so no
   shadowing occurs.
5. **Duplicate names are not an error.** Expansion emits only the bare name text, so two merged
   modules (or a module and its importer) may both declare `@keyframes spin`. Both blocks are emitted
   as authored CSS and the native cascade decides which definition wins — a later block replaces the
   animation steps of an earlier one at the same name. Authors get one shared name, not a conflict;
   the compiler must not invent an error here.
6. **Collection is resolver work, expansion is variables work.** Names are collected from the
   module AST while the graph is built and stored on the module record; substitution only reads
   them. No parser or lexer change, no frozen-contract change, no new runtime value type, no value
   rewriting outside the existing declaration-value pass.
7. **Scope of v0.1.** Keyframe-name completion, hover, go-to-definition and rename are out of scope
   and tracked on the todo board. There is no keyframe symbol export, no reference through a
   token-only import, and no name-based deduplication.

## Rejected alternatives

- **Keyframe-name function syntax (`animation-name: keyframes(spin)`).** Rejected: function
  arguments are native CSS value text, and inventing a value-level function is a much larger grammar
  change than a `$`-reference the language already supports.
- **Export names through token-only imports.** Rejected: those modules emit no CSS in the consuming
  build, so the reference would emit an `animation-name` with no keyframe block — invalid at runtime
  and exactly what invariant 1 forbids.
- **A separate "keyframe export" symbol table (`@export-keyframes …`).** Rejected by the owner: the
  `styles` import already decides which blocks a build emits; a second declaration would be
  redundant maintenance surface.
- **A new `XESSA2xxx` subcode for unknown keyframes.** Rejected: the registry is frozen and
  §5.5 already defines the recovery (error plus segment omission). A dedicated code would be a
  subcode nobody can act on differently.
- **Diagnosing duplicate names across merged modules.** Rejected: both blocks are authored CSS and
  the cascade defines the outcome; an error would reject valid stylesheets.
- **Addressing string-named keyframes as `$keyframes."fade"`.** Rejected for v0.1: members are
  plain identifiers; allowing quoted members would make the reference grammar depend on CSS string
  decoding inside a `dollar-ref` token.

## Consequences

- A keyframe and its animation reference can be authored once and stay in sync; the expansion is
  byte-identical to the name the CSS block declares.
- Existing outputs are unchanged: registration is passive, and only authored `$keyframes.…`
  references expand.
- The `@variables { spin: spin; }` workaround remains valid and unchanged for token-only or
  cross-module naming needs.
- The limitation is documented: `docs/known-limitations.md` (token-only imports, string-named
  keyframes, no editor support), `docs/grammar.md` §7 and `docs/compatibility.md`.
- Fixtures pin the same-file reference, the unknown member, the bare namespace, `styles`-import
  visibility and the token-only negative. Unit tests pin collection, transitive visibility,
  duplicate-name tolerance and alias shadowing.
