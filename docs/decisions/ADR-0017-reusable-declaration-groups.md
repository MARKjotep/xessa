# ADR-0017: Reusable declaration groups (`@group.<name>`)

## Status

Accepted (owner sign-off 2026-11-25; decisions (a) styles-only, (b) compile-time-only defaults, (c) reuse XESSA2001) — project owner decision, normative for v0.1. Implementation starts with G1 of
`.ai/plans/CSSX-PLAN-GROUPS.md` and may not precede this ADR.

Related: SPECIFICATION.md §3.2, §3.6, §3.7, §5.1, §5.2, §5.4, §6.1, §6.3, §12, §13; ADR-0003,
ADR-0005, ADR-0011, ADR-0014, ADR-0015; `.ai/plans/CSSX-PLAN-GROUPS.md` (design and phases G0–G6),
`.ai/reports/CSSX-A23.md` (the plan), `.ai/reports/CSSX-A30.md` (this ADR and the spec integration),
`.ai/todo.md` item 8 (the board entry).

## Context

Declarations that must stay identical across rules — card chrome, control height, surface elevation
— are copied today, and every copy drifts independently. `@variables` cannot help: a token
substitutes a *value*, not a property/value pair, and a group has to be overridable per use site
without forking the definition. The owner wants the repeated block written once and customized
where it is used:

```xessa
@group.card {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
}

.panel {
  @group.card {
    padding: 20px;
    color: navy;
  }
}

.tile {
  @group.card {
    border-radius: 0;
  }
}
```

`.panel` keeps `border` and the group's `border-radius`, but uses its own `padding` and `color`;
`.tile` keeps everything except the radius. No new runtime concept, no generated code, no CSS
emitted for the definition itself.

Reusable declaration groups (`@group`/`@apply`) were already listed as a future feature, requiring an
ADR and regression fixtures before implementation, and `SPECIFICATION.md` §13 deferred them to
exactly that. The owner and lead proposed the design on 2026-11-25 in
`.ai/plans/CSSX-PLAN-GROUPS.md` and left three decisions open. The owner accepted all three on
2026-11-25; this ADR is the accepted record and does not re-open them. Nothing in v0.1 changes until
the phases below land, and group-free sources keep byte-identical output.

## Decision

1. **Definition.** A group definition is a top-level at-rule block:

   ```ebnf
   groupDefinition = "@group" "." groupName "{" { declaration } "}" ;
   groupUseSite    = "@group" "." groupName "{" { declaration } "}" ;
   ```

   A definition exists only at the top level, alongside `@setup`, `@use`, `@variables`, `@runtime`
   and `@media-types`. The identical syntax inside a rule body is a **use site**, never a
   definition: position decides (§3.2), so `@group.<name> { … }` in a rule is the valid use-site
   form and reports nothing. The XESSA1001 family with statement-scoped recovery, one diagnostic per
   offending statement, therefore covers *malformed* group statements inside rules (a bad dotted
   form such as `@group .x`, a bare `@group`, a non-declaration statement in the block) — not
   well-formed use sites. A definition block accepts **declarations and nothing else**:
   nested rules, conditional blocks (`@md { … }`), native at-rules and `@group.` use sites inside a
   definition are XESSA1001-family syntax errors and the offending statement is omitted. That is what
   keeps expansion a pure declaration splice and recursion impossible; group chaining is a v2
   candidate. `@group` is **not a mixin**: no parameters, no arguments, no interpolation.
   Customization is exactly "override at the use site". The three parts of `@group.<name>` are
   contiguous — no whitespace between `group`, `.` and the name; whitespace or a missing dotted name
   is XESSA1001. A definition **emits nothing**: an unused group has no output, like an unused
   `@variables` entry. Empty definitions are legal and inert (no diagnostic).

2. **Use site.** Inside any rule body, at any nesting depth:

   ```xessa
   .selector {
     @group.<name> {
       <overrides>;
     }
   }
   ```

   The block is **required** in v1; a bare `@group.<name>;` is out of v1. The use-site block accepts
   declarations only; nested rules and conditional blocks inside it are XESSA1001 (the conditional
   use-site form `@group.x @md+dark { … }` is explicitly out of v1).

3. **Expansion is a splice, and overrides are emergent cascade — never a filter.** This is the
   load-bearing rule of the feature. Expansion splices the group's defaults **in definition order**
   followed by the use-site block's declarations **in authored order**, at the authored position, as
   one declaration run. Nothing else about the surrounding rule changes: selector, ancestors,
   native-rule context and following declarations are untouched, and the next authored statement
   flushes normally (§5.1). `.panel` above lowers exactly as if the author had written:

   ```xessa
   .panel {
     padding: 12px;
     border-radius: 8px;
     border: 1px solid #ddd;
     color: black;
     padding: 20px;
     color: navy;
   }
   ```

   The compiler **never filters, reorders, deduplicates or rewrites the group's lines**, even when a
   later use-site line repeats the same property. The override works because the use-site declaration
   comes later at equal specificity — §5.2, "later base declaration wins", **by design**. Invariant 3
   applies to expanded output in full: a compiler that dropped `padding: 12px` would silently change
   behaviour under conditional variants and `!important`, and is wrong by construction. Consequences
   that are documented and tested rather than "fixed": a use-site base declaration for property `P`
   beats an earlier group default for `P` at every width, including when the group default was an
   inline variant (`@md`) — §5.2 by design; `!important` binds per value segment (ADR-0003), so a
   group default authored `!important` cannot be overridden by a plain use-site declaration;
   "which properties the use site overrides" is **analysis** (hover, editor), never compilation.
   Identical semantics apply at every use site independently, and safe grouping (`groupRuns`) is
   unchanged — adjacent runs with identical selector, ancestors, condition and native context may
   still merge; expansion only adds declarations to a run.

4. **Visibility (owner decision (a): styles-only).** A module sees its own top-level group
   definitions plus the definitions of every module reached through `@use "…" styles;` transitively
   in authored order (ADR-0014). Token-only imports expose **no** groups. Same-file visibility always
   applies. This mirrors ADR-0015's visibility rule and keeps one visibility model for the language.
   Unlike keyframes, group definitions emit no CSS by themselves, so expansion from a token-only
   module would produce valid CSS; that is exactly why this is an owner decision rather than an
   inherited emit-safety rule. Merged builds compute the visible set per module at graph time and
   expand with the consuming module's view.

5. **Names, precedence and failures (owner decision (c): reuse XESSA2001).** Group names live in
   their **own symbol kind** (`group`), separate from locals, unqualified import aliases, namespaces
   and the built-in `keyframes` namespace. A name is a plain CSS identifier, matched exactly and
   case-sensitively: the member text after `@group.` must equal the addressable name byte for byte
   (the rule ADR-0015 applies to `$keyframes.<name>`). `group` becomes a reserved directive name
   (§3.6): `@use "…" as group` is XESSA2001 at the `@use` span. The rejected alias clause makes the
   whole statement invalid — no namespace and no tokens are imported, mirroring `as keyframes`
   (§3.6/§6.4) — so the statement can never shadow the built-in construct. Groups are not values:
   `$group.<name>` stays an unknown token namespace (XESSA2001, declaration omitted per
   §6.1/§12). Precedence mirrors the undefined-token rules (§6.1):

   - a local definition shadows imported definitions of the same name — no error;
   - two visible imported definitions with no local definition are ambiguous — XESSA2001 at the use
     site, block omitted, both definitions remain inert (first-wins does not apply: neither is more
     local);
   - duplicate definitions inside one module are XESSA2001 at the **later** definition, and the
     first definition wins (consistent with duplicate locals);
   - `@group.keyframes` is legal and independent of `@keyframes`; an import alias only names the
     token namespace and never addresses groups; class names, media aliases, `@setup` keys and
     property names share no namespace with groups.

   Messages must name the group (`Unknown group "@group.card" …`) and, for ambiguity, the two
   defining modules. No new diagnostic code is added; a future actionable subcode needs the
   frozen-registry process (FRAMEWORK §4, §9).

6. **Token resolution and spans.** Group defaults are authored in the defining module, so their
   `$refs` resolve against that module's locals, imports and namespaces; use-site declarations
   resolve against the consuming module (§6.1: imported compile-time values resolve where they are
   defined). Engineering consequence: expansion cannot be a naive cross-module AST copy before
   substitution — either expansion happens per module before that module's own `substitute` pass, or
   each expanded declaration carries an origin-module token table; this is the largest engineering
   risk of the feature (plan §11). **Runtime references are rejected in group defaults (owner
   decision (b): compile-time only).** A `@runtime` token in a default is XESSA2001 with the
   declaration omitted (§6.1/§12 semantics); runtime customization is authored at the use site,
   in the consuming module. Every expanded declaration keeps the authored span and file it came from
   — defaults carry the definition's spans in the defining module, use-site declarations the use
   site's spans in the consuming module; no positions are invented (invariant 4, ADR-0005). A
   diagnostic about a `$token` inside a default therefore points at the definition line in the
   defining file even when the use site is elsewhere, and source maps land on the authored text: the
   CSS a use site produces is authored at the definition.

7. **Diagnostics and recovery.** No new diagnostic code is added; `types/diagnostics.ts` stays
   frozen. The matrix is:

   | Situation | Code | Recovery |
   |---|---|---|
   | Malformed group statement (bad dotted form, bare `@group`, missing name); non-declaration statement inside a definition or use-site block | XESSA1001 (parser) | One diagnostic per statement; offending statement omitted; parsing resumes at the next boundary. A well-formed group block inside a rule is a use site, not an error (item 1) |
   | Unknown group at a use site (not visible, or from a token-only import) | XESSA2001 | **The whole use-site block is omitted**, consistent with §5.5 undefined-member semantics; the rest of the rule continues, and an emptied rule is dropped like any other |
   | Ambiguous visible group (two imported definitions, no local) | XESSA2001 | Use-site block omitted; both definitions remain inert; first-wins does not apply because neither is more local |
   | Duplicate definition in one module | XESSA2001 | First definition wins; later definition is ignored (consistent with duplicate locals) |
   | `@use "…" as group` | XESSA2001 at the `@use` | The rejected alias clause makes the whole statement invalid: no namespace and no tokens are imported, mirroring `as keyframes` (§3.6/§6.4). The built-in `@group.<name>` construct cannot be shadowed |
   | `$group.<name>` | XESSA2001 (existing unknown-namespace path) | Declaration segment omitted (§5.5) |

   The table quotes the plan's §2.5 wording; the normative recovery text in `SPECIFICATION.md` is
   §6.1 (undefined/ambiguous symbols are errors) and §12 (invalid CSS is never emitted; the affected
   construct is omitted after the diagnostic), and §3.7 restates it for groups.

   **Rejected recovery, recorded so it is not re-litigated:** emitting the use-site block's
   declarations *without* the group's defaults on an unknown group. It would silently reinterpret
   "override" as "declare" and produce declarations the author never meant as standalone values.

8. **Authoring details.** These are normative and pinned by tests: inline variants are allowed in
   defaults (`property: a @md b` is one declaration in Xessa grammar), and expansion keeps the
   segments in authored order; the dotted form is contiguous only (item 1); empty definitions are
   legal, emit nothing and report nothing; a duplicate-definition diagnostic is placed on the later
   definition and the first wins; XESSA2001 messages name the group and, for ambiguity, the two
   defining modules; `format()` prints a definition and a use site like other at-rule blocks, one
   declaration per line, with blank-line preservation following the existing formatter rules.

9. **Explicitly out of v1.** Each is recorded in `docs/known-limitations.md` when the compiler phase
   lands (G4c), not by this ADR:

   1. Conditional/variant use-site blocks (`@group.x @md+dark { … }`) and conditional definitions.
   2. Nested rules or native at-rules inside a definition or use-site block.
   3. `@apply` alternative syntax (the earlier design lists the pair; v1 ships only `@group.<name>`).
   4. Group parameters, interpolation or argument lists (not a mixin).
   5. Groups referencing other groups (chaining/composition).
   6. Cross-module group renaming (`@use … as` for groups) and re-export of groups.
   7. Bare include form `@group.<name>;` with no block.
   8. Keyframe-style `$group.<name>` value references.
   9. Editor support in the same release as the compiler phase; that is a follow-up by design.

   **Consequence update (2026-11-25):** the owner brought editor support forward instead of leaving
   it to an unplanned later release. It landed within the same wave, as the editor release that
   followed the compiler phase: CSSX-A39 (group completion with styles-only visibility, hover with
   resolved defaults and use-site overrides, outline nodes, workspace-scoped rename), CSSX-A40
   (distinct TextMate scopes for definitions, use sites and members) and CSSX-A42
   (`$keyframes.<name>` completion, hover and rename under the same visibility rule). Item 9.9's
   deferral is therefore closed for v0.1 (the editor work still followed the compiler phase rather
   than shipping inside it); exclusions 1–8 above are unchanged. Evidence:
   `.ai/reports/CSSX-A39.md`, `.ai/reports/CSSX-A40.md`, `.ai/reports/CSSX-A42.md`.

## Rejected alternatives

- **(a)-ii, token-only imports expose groups.** Rejected: two visibility models for one language
  ("what a `styles` import brings" vs "what a token-only import brings") invite exactly the
  mistakes ADR-0015 removed for keyframes. Revisit only if authors hit the wall; the visibility
  predicate is a single function so the decision stays cheap to flip.
- **(b)-ii, rewrite `@runtime` references in defaults to `var()` with the consuming prefix.**
  Rejected for v1: it couples group expansion to the consuming build's runtime prefix table, makes
  a default's meaning depend on who imports it, and interacts with (a) since a token-only import
  exposes no runtime tokens. Authoring the reference at the use site serves the same need.
- **(c)-ii, a new `XESSA2xxx` subcode for unknown groups.** Rejected: the registry is frozen, and
  §6.1/§12 already define error-plus-omission. A dedicated code would be a subcode nobody can act on
  differently; an actionable message names the group instead.
- **Filtering, deduplicating or rewriting the group's lines when the use site repeats a property.**
  Rejected: it silently changes behaviour under conditional variants and `!important`, violates
  invariant 3 for expanded output, and turns an ordinary cascade rule into compiler magic.
- **Emitting use-site declarations without the defaults on an unknown group.** Rejected: it
  reinterprets "override" as "declare" and emits declarations the author never wrote as standalone
  values — exactly the silent semantic change invariant 2 forbids.

## Consequences

- A repeated declaration block is authored once and customized at each use site through the normal
  cascade: no new runtime, no generated code, no emitted CSS for the definition itself.
- Group-free sources are byte-identical: definitions are inert, and only an authored use site
  expands. Existing goldens and examples must not change (asserted in G3).
- The frozen diagnostic registry is untouched: XESSA1001 covers syntax misuse, XESSA2001 covers
  unknown, ambiguous, duplicate, alias and `$group.` cases, and every rejection omits exactly the
  statement or block the matrix allows.
- Delivery follows `.ai/plans/CSSX-PLAN-GROUPS.md`: G1 grammar (additive AST nodes, lead-approved),
  G2 resolver/visibility, G3 expansion, G4a fixtures/goldens, G4b browser gate, G4c author docs,
  G5 formatter, G6 editor support. `format()` must print both new node kinds before format-on-save
  ships in a release that supports groups — G5 is a **release blocker**, because a parse→print
  formatter that cannot print `@group` would delete authored groups on save.
- Editor support (G6: completion, hover, outline, rename, TextMate scopes) landed as a follow-up
  release on 2026-11-25 in CSSX-A39/A40/A42, after the compiler phase rather than bundled into it; it
  is not deferred further.
- The v1 exclusions in item 9 are documented in `docs/known-limitations.md` by G4c and stated in
  `SPECIFICATION.md` §3.7 now, so authors are not promised `@apply`, parameters, conditional use
  sites or `$group.` values.
- ADR-0005 and invariant 4 govern spans: an expanded declaration's diagnostics and source-map
  positions point at the file and span where the text was authored, which is intended.
