# ADR-0018: Keyframe visibility and exclusions

## Status

Accepted (owner sign-off 2026-11-25; (i) styles-only confirmed, (ii) string-named rejected,
(iii) conditional rejected/deferred) — project owner decision, normative for v0.1. This ADR is an
addendum to ADR-0015: it records the owner's answers to the three questions ADR-0015 left open and
does not change the shipped behaviour.

Related: ADR-0015, ADR-0017, `SPECIFICATION.md` §6.3, §6.4, §13; `.ai/reports/CSSX-A19.md`,
`.ai/reports/CSSX-A42.md`, `.ai/todo.md` items 6 and 11.

## Context

ADR-0015 shipped `$keyframes.<name>` with a styles-only visibility rule, plain-identifier names and
top-level-only collection, and recorded three open questions: whether a token-only import should ever
expose keyframe names, whether string-named keyframes (`@keyframes "fade"`) should become
addressable, and whether keyframes inside conditional or nested blocks should be collected. The
compiler implemented the conservative answers; CSSX-A42 then added editor completion, hover and
rename that resolve exactly the compiler's visible set, so an editorial guess in either layer would
now surface as a real inconsistency. The owner answered all three questions on 2026-11-25.

## Decision

1. **(i) Styles-only visibility is permanent.** A keyframe name is visible to `$keyframes.<name>` only
   from the declaring module's own top-level blocks and from modules reached through a `styles`
   `@use` edge, transitively. A token-only import contributes tokens but no CSS, so the target's
   `@keyframes` block is never emitted in the consuming build; a reference from such a name would
   emit `animation-name: spin` with no matching block and animate nothing. That emit-safety argument
   (ADR-0015 item 3) is confirmed as the permanent rule rather than a v0.1 shortcut. ADR-0015 stands
   unchanged, including XESSA2001 and segment omission for a name visible only through a token-only
   import. The editor's `$keyframes` hover cites this rule, and completion never offers such a name.
2. **(ii) String-named keyframes are rejected.** `@keyframes "fade"` is not valid CSS (keyframe names
   are identifiers), no engine supports it as a referenceable animation name, and accepting it would
   require string decoding inside a `dollar-ref` member for no authoring value. String/escaped
   preludes stay native-only text in v0.1 and are never registered, completed, hovered or renamed.
3. **(iii) Conditional keyframes are rejected for v0.1, deferred beyond it.** A `@keyframes` block
   inside a rule or another at-rule block (such as `@media`) is not collected; the
   top-level-only rule in ADR-0015 item 1 stays. Browsers handle such blocks inconsistently and the
   native cascade offers no benefit that authoring the block at the top level and gating the
   animation would not, so v1 keeps the simple, portable form. Revisiting this requires a new ADR
   with fixtures and a three-engine browser gate.
4. **Editor parity is a consequence, not a second decision.** CSSX-A42's completion, hover and rename
   resolve exactly the compiler's visible set (item 1) and the same plain-identifier, top-level-only
   registration; the editor advertises no name the compiler rejects.

## Rejected alternatives

- **Emit-on-reference for token-only imports.** Rejected: it would make a `$keyframes.` reference
  pull a `@keyframes` block out of a module the author imported for tokens alone, blurring the
  token-only/`styles` line ADR-0017 decision (a) deliberately keeps, and making "what an import
  brings" depend on which references happen to exist.
- **String-name normalization (strip quotes, decode escapes, register the identifier).** Rejected:
  the emitted block keeps its quoted prelude, so the reference and the CSS would depend on two
  different name spaces; it also adds CSS string decoding to a compile-time member lookup for a form
  that is not valid CSS to begin with.
- **Conditional lowering with a three-engine browser gate.** Rejected for v0.1: it turns a native
  at-rule into a compiler-managed construct with engine-specific caveats, needs conditional
  `@keyframes` fixtures and cascade tests in Chromium, Firefox and WebKit, and buys nothing the
  top-level form plus a conditional animation declaration cannot express.

## Consequences

- No language, compiler, parser or formatter change: ADR-0015's implementation, diagnostics and
  goldens stand as shipped, and this ADR only fixes the answers for the record.
- The two exclusions become explicit entries in `docs/known-limitations.md`, and
  `SPECIFICATION.md` §6.4/§13 references this ADR; the specification's normative behaviour is
  unchanged.
- `$keyframes` editor intelligence (CSSX-A42) and the compiler cannot drift in which names they
  advertise: both resolve the same visible set, and the token-only negative is pinned by tests in
  both layers.
- `.ai/todo.md` item 11 (the compiler-semantics half of the keyframes request) closes; item 6 remains
  the editor-half record.
- The `@variables { spin: spin; }` workaround still covers token-only and cross-module naming needs
  that the visibility rule excludes.
