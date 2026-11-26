# Xessa Language and Compiler Specification

**Status:** v0.1 frozen (P0)  
**Public name:** Xessa (`.cssx`), packages `@xessa/*`, CLI `xessa`, VS Code language ID `xessa`,
diagnostic family `XESSA####`. Source files use `.cssx` by owner decision
([ADR-0013](docs/decisions/ADR-0013-cssx-file-extension.md)); every other public name stays Xessa.  
**Derived from:** the owner-approved design proposal of 2026-11-24 and the owner decisions of 2026-11-25. This document is normative for v0.1 and supersedes earlier design notes; features it defers are listed under [Deferred](#13-deferred).

## 0. Owner-locked decisions

Three language questions were resolved by the project owner on 2026-11-25 and are normative:

| # | Decision | Recorded in |
|---|---|---|
| D1 | A bare nested selector without `&` is a **descendant** selector. | ADR-0002, §3.5, §7 |
| D2 | `!important` binds **per value segment**; each inline variant segment is an independent CSS declaration. | ADR-0003, §3.3, §5 |
| D3 | Conditional blocks (`@md { ... }`) are **rule-scoped only** in v0.1; a top-level conditional block is a syntax error with statement-boundary recovery. | ADR-0004, §3.4, §4 |

The keywords MUST, MUST NOT, SHOULD and MAY are used normatively.

## 1. Vision and scope

Xessa is a CSS-first, property-centric stylesheet language. Responsive values, theme overrides and
nested selectors live beside their base declarations. It compiles to ordinary CSS and static
JavaScript class maps, with optional TypeScript declarations and source maps. There is no browser
runtime, framework dependency or editor requirement. The VS Code extension is an interface to the
same compiler used by the CLI and build tools.

The MVP includes inline and block media aliases, combined conditions, variables and imports, nested
selectors, prefixing, configurable output paths and names, class maps, opt-in compact CSS output,
CLI build/check/watch, syntax highlighting, completions and diagnostics.

Out of scope for v0.1 includes mixins, arbitrary expressions, container aliases, inline pseudo-state
modifiers, hashing, advanced refactoring and aggressive CSS optimization. See §13.

## 2. Canonical example

```scss
@setup {
  prefix: "ui";
  css-dir: "../generated/styles";
  css-name: "button.css";
  map-dir: "../generated/maps";
  map-name: "button.map.js";
}
@use "./theme.cssx" as theme;
@variables {
  spacing: 12px;
  radius: 8px;
}
.button {
  display: flex;
  padding: $spacing @md 20px @xl 32px;
  border-radius: $radius;
  background: $theme.primary @dark #1e40af;
  font-size: 14px @md 16px;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  & > .icon { width: 16px @lg 20px; }
}
```

Assume `theme.primary` is `#2563eb` and the source is `src/button.cssx`. The outputs are
`generated/styles/button.css` and `generated/maps/button.map.js`; authoring `map-types: true` also
writes `generated/maps/button.map.d.ts`. The stylesheet contains `.ui-button` and
`.ui-button > .ui-icon`, ordinary media queries and flattened pseudo-selectors. The JS map exports
`button` and `icon` as named bindings (there is no default export):

```js
export const button = "ui-button";
export const icon = "ui-icon";
```

By default the map has no CSS side-effect import. Load `generated/styles/button.css` from the page
(`<link rel="stylesheet">`) or import it explicitly from the bundler entry; `import-css: true`
(§9) opts the map into that import instead.

```tsx
import { button } from "../generated/maps/button.map.js";
export function Button() {
  return <button className={button}>Continue</button>;
}
```

## 3. Lexical and grammatical rules

### 3.1 Tokenizer

The implementation MUST use a stateful tokenizer and a recursive-descent parser. Declarations MUST
NOT be split with regular expressions alone. The tokenizer tracks:

- source offsets plus line and column for every token and span;
- comments (ordinary and preserved where required for output fidelity);
- escapes in identifiers, strings and selectors;
- quoted strings, including embedded `@`, `$`, `{`, `}` and `;`;
- balanced parentheses and brackets;
- brace nesting and statement boundaries.

An `@` inside a string, comment, URL or function is ordinary CSS content. Inline modifiers are
recognized only at top-level value depth, after whitespace, outside escaped tokens and outside
strings, comments, URLs and functions. Unknown modifiers produce diagnostics.

Raw CSS token sequences and custom property values MUST be preserved. Xessa declarations in v0.1
require semicolons; ordinary CSS final declarations without a semicolon MAY be accepted. An ordinary
CSS final declaration without a trailing semicolon before `}` is accepted only when it contains no
recognized modifier and no `$` reference; a declaration that carries either and lacks its terminating
semicolon is reported as `XESSA1002` (ADR-0011). Recovery happens at safe statement boundaries so the
editor can continue.

### 3.2 Grammar (EBNF)

```ebnf
file          = { setup | use | variables | runtime | mediaTypes | groupDefinition | rule
                | nativeAtRule } ;
setup         = "@setup" "{" { setting } "}" ;
setting       = identifier ":" scalar ";" ;
use           = "@use" string [ "as" identifier ] [ "styles" ] ";" ;
variables     = "@variables" "{" { tokenDeclaration } "}" ;
runtime       = "@runtime" "{" { declaration } "}" ;
mediaTypes    = "@media-types" "{" { aliasDeclaration } "}" ;
rule          = selector "{" { declaration | rule | conditionalBlock | nativeAtRule
                | groupUseSite } "}" ;
declaration   = property ":" cssValue { modifier cssValue } ";" ;
modifier      = "@" alias { "+" alias } ;
conditionalBlock = modifier "{" { declaration | rule | conditionalBlock } "}" ;
groupDefinition = "@group" "." groupName "{" { declaration } "}" ;
groupUseSite    = "@group" "." groupName "{" { declaration } "}" ;
```

This is structural grammar. CSS values and selectors require balanced token parsing rather than
simple strings. Aliases may begin with digits (for example `2xl`). Setup, `@use`, `@variables`,
`@runtime`, `@media-types` and `@group` definitions are top-level only. Multiple `@setup` blocks MAY
appear at top level; they are merged in document order, and a duplicate setting key within a block
or across blocks is rejected with a XESSA1001-family diagnostic.

`@setup` values are single scalars with one scoped exception: `css-dir` MAY be a comma-separated
list of directories (`css-dir: "../client", "../src";`, [ADR-0019](docs/decisions/ADR-0019-setup-output-lists.md)).
Each item is a scalar path that resolves exactly like the single-value form; empty or duplicate
items are `XESSA2001` errors. `map-dir`, `map-name`, `css-name`, `prefix` and the boolean keys remain
single-valued.

`@group` definitions and use sites are specified in §3.7 (ADR-0017, owner decision of 2026-11-25).

The optional `styles` clause of `@use` (ADR-0014) marks a rule-merge import: the target's
stylesheet rules are merged into the importing build in addition to its tokens (§6.3). Without the
clause the import stays token-only.

### 3.3 Declarations, variants and `!important`

A declaration carries a property, a base value and zero or more inline variants. Each variant is a
modifier alias combination plus a value. A base value is required for inline variants; use a
conditional block for conditional-only declarations.

`!important` binds **per value segment** (D2). It terminates the value segment in which it appears
and is ordinary CSS token content of that segment. Each inline-variant segment is an independent
CSS declaration.

```scss
padding: 10px @md 20px !important;
```

emits the base declaration `padding: 10px` (normal) and the `md` declaration
`padding: 20px !important`. `!important` is never propagated from one segment to another. See §5.4.

### 3.4 Rules, nesting and conditional blocks

A rule is a selector followed by a block. Blocks may contain declarations, nested rules,
conditional blocks and native at-rules.

Nested rules are distinguished from declarations by **balanced lookahead**, not by the presence of a
colon alone. If the statement reaches a `{` at top level before its terminator (accounting for
strings, comments, parentheses, brackets and escapes), it is a nested rule; otherwise it is a
declaration.

A nested rule without `&` is a descendant selector (D1):

```scss
.button {
  .icon { width: 16px; }
}
```

lowers to `.ui-button .ui-icon`, equivalent to `& .icon`. `&` remains required for compound and
complex nesting in v0.1; see §7.

Conditional blocks are valid **only inside rules** (D3). A top-level conditional block is a syntax
error in the XESSA1001 family:

```scss
@md {
  .card { padding: 20px; }
}
```

The parser reports one XESSA1001-family diagnostic ("conditional block outside rule"), recovers at
the next safe statement boundary, and emits no CSS for the rejected block. Native top-level CSS
at-rules (`@media`, `@supports`, `@layer`, `@keyframes`, `@font-face`, `@property`) keep their
native meaning and are not conditional blocks.

### 3.5 Native at-rules

Native CSS at-rules retain their meaning. `@supports`, `@layer`, `@container`, `@keyframes`,
`@font-face` and `@property` contexts are preserved. Unsupported Xessa transformations inside them
MUST be rejected with diagnostics rather than silently changing semantics.

### 3.6 Reserved names

Xessa directives are reserved and MUST NOT be used as aliases, variables or class-map keys where
that would conflict. Conflicting alias names are rejected. The built-in `keyframes` namespace name is
reserved: an `@use` alias named `keyframes` is XESSA2001 (§6.4). The directive name `group` is
reserved: an `@use` alias named `group` is XESSA2001 at the `@use` statement, creates no namespace and
does not shadow the built-in `@group.<name>` construct (§3.7). Native CSS keywords keep their native
meaning.

### 3.7 Reusable declaration groups

A group is a named, non-parametric set of declarations, defined once and spliced into any rule body
with per-use-site overrides (ADR-0017, owner decision of 2026-11-25):

```ebnf
groupDefinition = "@group" "." groupName "{" { declaration } "}" ;
groupUseSite    = "@group" "." groupName "{" { declaration } "}" ;
```

**Definition.** `@group.<name> { … }` accepts declarations only. A definition exists only at the top
level: the identical syntax inside a rule body is a use site, never a definition, because position
decides (§3.2). XESSA1001 recovery therefore covers malformed group statements inside rules — a bad
dotted form, a bare `@group`, or a non-declaration statement in the block — with statement-scoped
recovery. Nested rules, conditional blocks, native at-rules and further `@group.` statements inside a
definition are XESSA1001-family syntax errors: one diagnostic per offending statement, the statement
is omitted and the rest of the definition survives. `@group` is not a mixin: there are no parameters,
arguments or interpolation. A definition emits no CSS; unused definitions are inert, and empty
definitions are legal, inert and produce no diagnostic. Group names are plain CSS identifiers,
matched exactly and case-sensitively, in their own `group` symbol kind. The three parts of
`@group.<name>` are contiguous; whitespace inside the dotted form, or a missing name, is XESSA1001.

**Use site.** `@group.<name> { <overrides> }` is valid inside any rule body at any nesting depth and
accepts declarations only. The block is required in v0.1: a bare `@group.<name>;` is XESSA1001; so is
a nested rule or a conditional block inside the use-site block.

**Expansion.** The group's defaults are spliced at the authored position in definition order,
followed by the use-site block's declarations in authored order, as one declaration run:

```scss
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

lowers to the equivalent authored CSS:

```scss
.panel {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  padding: 20px;
  color: navy;
}
.tile {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  border-radius: 0;
}
```

The compiler MUST NOT filter, reorder, merge, deduplicate or rewrite the group's lines. Overrides win
by the ordinary cascade: the use-site declaration is later at equal specificity (§5.2), including
against a group default authored as an inline variant, at every width. `!important` binds per value
segment (§3.3, §5.4), so a group default carrying `!important` is not beaten by a plain use-site
declaration. Expansion never changes selector, ancestors, native-rule context, following declarations
or safe grouping (§5.1, §5.3), and each use site expands independently.

**Visibility and precedence.** A module sees its own top-level group definitions plus the
definitions of every module reached through `@use "…" styles;` transitively in authored order (§6.3,
ADR-0014). Token-only imports expose no groups. A local definition shadows imported definitions of
the same name without a diagnostic. Two visible imported definitions with no local definition are
ambiguous: XESSA2001 at the use site and the use-site block is omitted, while both definitions stay
inert. Duplicate definitions in one module are XESSA2001 at the later definition, and the first
definition wins. Groups are not addressable through an import alias, and `@use "…" as group` is
XESSA2001 at the `@use` statement: the rejected alias clause makes the whole statement invalid, so no
namespace and no tokens are imported, mirroring `as keyframes` (§3.6, §6.4). `$group.<name>` is not a
value reference: it is the existing unknown-token-namespace case, XESSA2001 with the declaration
segment omitted (§6.1, §12). `@group.keyframes` is legal and does not interact with `$keyframes` (§6.4).

**Tokens and spans.** Defaults resolve against the defining module's tokens; use-site declarations
resolve against the consuming module (§6.1). A `@runtime` reference in a group default is XESSA2001
with the declaration omitted (§6.1, §12); runtime customization is authored at the use site.
Expanded declarations keep their authored spans and files — defaults from the definition, overrides
from the use site — so diagnostics and source maps point at the authored text (ADR-0005).

**Diagnostics.** Unknown, ambiguous, duplicate, alias and `$group.` failures reuse XESSA2001; syntax
misuse is XESSA1001; no new diagnostic code exists for this feature. Messages name the group, and an
ambiguity message names the two defining modules. Recovery omits exactly the offending statement or
the use-site block, and a rule emptied by the omission is dropped like any other (§12).

**Out of scope for v0.1.** Conditional or variant use-site blocks and conditional definitions; nested
rules or native at-rules inside either block; `@apply`; parameters, interpolation or argument lists;
group chaining; cross-module renaming and re-export of groups; the bare include form;
`$group.<name>` value references; and editor support (completion, hover, outline, rename,
highlighting), which is a follow-up release.

## 4. Media conditions

### 4.1 Default aliases

| Alias | Condition |
|---|---|
| `smd` | `(min-width: 624px)` |
| `sm` | `(min-width: 640px)` |
| `md` | `(min-width: 768px)` |
| `lg` | `(min-width: 1024px)` |
| `xl` | `(min-width: 1280px)` |
| `2xl` | `(min-width: 1536px)` |
| `dark` | `(prefers-color-scheme: dark)` |
| `light` | `(prefers-color-scheme: light)` |
| `portrait` | `(orientation: portrait)` |
| `landscape` | `(orientation: landscape)` |
| `screen` | `screen` |
| `print` | `print` |
| `reduced` | `(prefers-reduced-motion: reduce)` |
| `no_hover` | `(pointer: coarse)` |
| `mobile` | `(pointer: coarse)` |

`screen` and `print` are media types; `no_hover` and `mobile` are media features and share the
coarse-pointer condition.

### 4.2 Definitions and overrides

Aliases may be overridden by project configuration (`media`) and by file-level `@media-types`:

```scss
@media-types { compact: (max-width: 500px); }
.card {
  padding: 12px @md 20px @xl 32px;
  background: white @dark #181818 @xl+dark #101010;
  @xl { display: grid; gap: 24px; }
  @compact { display: block; }
}
```

Definitions merge by key: built-in defaults < project config `media` < file-level `@media-types`.
For the same key the later layer wins; distinct keys accumulate (ADR-0006). A file-level definition
is local to that file.

### 4.3 Combined aliases

Combined aliases are logical **AND**, never OR: `@xl+dark` becomes
`(min-width: 1280px) and (prefers-color-scheme: dark)`. Duplicate aliases in one modifier are
normalized. Nested conditions are combined with `and`.

MVP supports one media-query expression per alias. Unsupported combinations (incompatible media
types, comma-list combinations, aliases that cannot be combined) are rejected with XESSA3001-family
diagnostics. Invalid CSS MUST NOT be emitted; the affected declaration or block is omitted after the
diagnostic. Native media lists pass through unchanged.

### 4.4 Conditional blocks

A conditional block applies a modifier to every declaration and nested rule in its block:

```scss
.card {
  @xl { display: grid; gap: 24px; }
}
```

Conditional blocks nest and combine conditions. They are only valid inside rules (D3, §3.4).

## 5. Cascade contract

### 5.1 Source-preserving mode

The default mode is **source-preserving**. For each rule, declarations are expanded in written
order: the base declaration first, then each variant in its written order. Consecutive expanded
declarations with the same selector and at-rule context form a contiguous run.

Runs are flushed when a nested rule or a conditional declaration is encountered. Nested rules are
lowered and emitted at the position where they appear. The output preserves authored declaration
order.

### 5.2 Precedence

Later declarations retain normal CSS precedence, including shorthand/longhand interactions,
duplicate fallbacks and `!important`. Within one inline declaration, the last matching variant wins
subject to the native cascade. A later base declaration can override an earlier conditional
declaration; this is valid authored CSS and is documented rather than "fixed".

Authors SHOULD order mobile-first ascending aliases and place combined conditions last. The
compiler MAY warn about suspicious order but MUST NOT silently reorder declarations.

### 5.3 Grouping

`mediaGrouping` has three values; `safe` is the default:

- `safe` merges only adjacent compatible rules/media contexts without changing declaration order,
  selector specificity, layer or scope.
- `none` emits every run as authored.
- `merge` is an opt-in optimizer ([ADR-0024](docs/decisions/ADR-0024-media-merge-grouping.md)). It
  keeps the safe pass and additionally moves a conditional declaration run into a later run with
  the **same selector chain, condition string and native at-rule context** when every declaration
  of every run strictly between them belongs to a provably disjoint property family. The moved
  declarations are placed before the destination run's declarations, preserving their relative
  order. `all` and any declaration containing `var(` are wildcards: they never merge and nothing
  merges across them. Unconditional runs, different selectors, different conditions and different
  native contexts are never merged. The family approximation is frozen and conservative
  (for example `font-size` and `font-family` share `font`); its documented cross-prefix exceptions
  and limits live in ADR-0024.

Global grouping at the bottom is not generally safe. Grouping MUST NOT change computed styles; the
browser differential compiles every scenario with `safe`, `none` and `merge` and requires equal
computed styles.

A future opt-in ordered-media mode may define a different cascade contract; it MUST never be
described as semantics-preserving.

### 5.4 `!important`

Per D2 and §3.3, `!important` belongs to the segment it terminates:

```scss
padding: 10px !important @md 20px;
```

emits `padding: 10px !important` and, inside `md`, `padding: 20px` (normal). The compiler MUST NOT
promote or copy `!important` across segments. Conformance tests cover important flags on the base
only, on variants only, on multiple segments, and combined with shorthand/longhand declarations.

## 6. Variables and modules

### 6.1 Compile-time variables

```scss
@use "./theme.cssx";
@use "./layout.cssx" as layout;
@variables { radius: 16px; gap: $layout.spacing; }
.card { padding: $gap; border-radius: $radius; }
```

Variables substitute **token sequences**, not JavaScript expressions. Resolution follows a
dependency graph and supports forward references. Undefined symbols and cycles are errors with
source locations.

- Local definitions override unqualified imported definitions, including when several unqualified
  imports export the same name; no ambiguity is reported when a local definition exists.
- Duplicate local definitions are errors.
- Ambiguous unqualified imports are errors unless a local definition overrides the name.
- Namespaced imports remain independent.
- Imported values resolve in their defining module; local overrides do not mutate imported modules.
- There is no implicit transitive re-export.

Imports are relative to the importing source and restricted to the workspace by default. By default
an import may bring in tokens only, not stylesheet rules; the `styles` clause lifts that
restriction for one module (§6.3, ADR-0014). Token-only modules do not emit artifacts unless
explicitly configured. Modules are cached by canonical path; cycles are detected and reverse
dependencies tracked. Network imports and executable source are not supported.

### 6.2 Runtime variables

```scss
@runtime { primary: #2563eb @dark #60a5fa; }
.card { color: $primary; }
```

Runtime variables emit native custom properties and references, for example:

```css
:root { --ui-primary: #2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --ui-primary: #60a5fa; }
}
.card { color: var(--ui-primary); }
```

Runtime tokens are scoped by the prefix/module policy and named with the consuming build's prefix.
Imported runtime tokens are emitted in each consuming entrypoint; a token referenced only by a
`styles`-imported module's rules is emitted too. Compile-time and runtime symbols cannot share a
local name (§6.1). Native `var()` remains valid.

**Merge-order override (ADR-0016, owner decision of 2026-11-25).** When two runtime definitions
produce the same post-prefix custom-property name, the definition later in merge order wins and the
compiler emits one resolved declaration for that property. Merge order is:

1. style-imported (`styles`) modules in canonical DFS `@use` post-order (dependencies before
   importers, each module once);
2. then any other reachable runtime-token module in graph topological order (dependencies before
   importers);
3. the entry last.

The rule is deliberate and matches the native cascade: the entry's `@runtime` definition overrides a
style-imported module's same-named property, and a later style module overrides an earlier one —
exactly as a later `:root` declaration wins in CSS. Do not turn this back into a conflict error.
Inline variants follow the same order per query group: base declarations first, then one conditional
`:root` per resolved query in first-appearance order, and the winning definition supplies its own
base and variants, so the entry's value beats an imported module's same-query value. A losing
definition contributes neither its base nor its variants. Unqualified `$name` symbol ambiguity is
unaffected: a local definition or a namespace is still how a compile-time value is chosen.
Cross-entrypoint collision reporting is project-level work deferred beyond v0.1.

### 6.3 Rule-merge imports

`@use "<specifier>" [as <alias>] styles;` imports the module's **rules** as well as its tokens
(ADR-0014, owner decision of 2026-11-25). The clause is opt-in: without it the import is token-only
as described in §6.1.

- **Prefix ownership.** Merged rules keep the imported module's own `@setup prefix`. The importing
  file's prefix, the API prefix and project-level `classes.prefix` never apply to them. A module
  without `@setup` merges unprefixed (`naming: none` still disables prefixing everywhere).
- **Cascade order.** Merged CSS emits imported modules first — depth-first in authored `@use` order,
  each module once — then the importing file's own rules. This is native-`@import`-like: local rules
  win equal-specificity ties, and no declaration is reordered within a module.
- **Class table.** The importing build writes one merged JS map covering its own classes plus every
  style-imported module's classes (and a matching `.d.ts` when `map-types` is enabled). The same
  original class name resolving to the same emitted name in several modules unifies. Different
  emitted names for one original name are XESSA4001 errors (§8, ADR-0010); the first result wins as
  documented recovery so output stays deterministic, but the build fails. camelCase identifier
  collisions across modules are resolved deterministically with a `_2`/`_3` suffix and one
  XESSA4001 **warning** per adjusted export (§8). Global classes stay global and are never
  exported. **Exception (ADR-0020):** a module may author `@setup { map-inherit: false; }`; its rules
  still merge in cascade order, but its bindings join neither the importer's map nor its `.d.ts`
  (nor `CompileResult.classes`), and they cannot raise `XESSA4001`. Default `true`; project
  `output.mapInherit` sets the default and the module's own value wins. The module's own entry map is
  unaffected, and `module: true` + `map-inherit: false` is allowed and silent (a documented escape
  hatch for rule-only modules).
- **Artifacts.** Style-imported modules do not emit artifacts in the importing build, and the
  importing build is unaffected by a module's own output flags. A file that is module-only marks
  itself with `@setup { module: true; }`: its own build suppresses `emit-css`, `emit-map`,
  `map-types`. Precedence is built-in defaults < project config <
  `module: true` < the file's own explicit `emit-*` keys < explicit API/CLI overrides,
  so authoring a key restores it. A project-glob entry that is style-imported elsewhere still builds
  standalone under its own resolved flags.
- **Tokens.** Compile-time values resolve in their defining module (§6.1). Runtime tokens of merged
  modules are emitted into the consuming build under §6.2, named with the consuming build's prefix,
  and include runtime properties referenced only by a merged module's rules. If the entry and a
  merged module (or two merged modules) define the same property, merge order decides the value
  without a conflict diagnostic: the entry wins over imported modules and a later module wins over
  an earlier one (ADR-0016).
- **Cycles.** A cycle through any `@use` edge, style-bearing or not, is XESSA2001 at the edge that
  closes it (§6.1). The merged walk still terminates deterministically.

### 6.4 Built-in `keyframes` namespace

`@keyframes <name> { … }` stays native CSS and additionally registers `<name>` in a built-in
`keyframes` namespace (ADR-0015, owner decision of 2026-11-25). A declaration value may reference it
as `$keyframes.<name>`:

```scss
@keyframes spin {
  from { rotate: 0deg; }
  to { rotate: 360deg; }
}
.spinner { animation-name: $keyframes.spin; animation-duration: 1s; }
```

emits the native `@keyframes spin` block and `animation-name: spin`. The reference is a compile-time
substitution that expands to the authored name text (§6.1); it is not recursive and the at-rule
prelude is never substituted.

- **Registration.** Only a top-level `@keyframes` block whose prelude is a single plain identifier
  registers a member, named exactly as authored (ASCII case-insensitive at-rule name). String-named
  keyframes, escaped names, other preludes, and keyframes nested inside a rule or another at-rule
  block (for example `@media`) stay native CSS and are not addressable. A repeated name in one module
  registers once; the later block still wins in CSS.
- **Visibility.** A module sees its own keyframe names plus those of every module reached through a
  `styles` `@use` edge (§6.3), transitively in authored order — exactly the blocks the build emits. A
  token-only import contributes no CSS, so its keyframe names are not referenceable.
- **Duplicate names.** Expansion emits only the bare name text, so the same name may be declared by
  several merged modules. Both blocks are emitted as authored and native cascade order decides the
  winner; the compiler reports no conflict.
- **Failures.** An unknown member, a name visible only through a token-only import, and a bare
  `$keyframes` are XESSA2001 at the reference and the affected declaration segment is omitted (§5.5).
  `@use "…" as keyframes` is XESSA2001 at the `@use` statement and does not shadow the built-in
  namespace. No new diagnostic code exists for this feature.
- **Rejected constructs.** String-named keyframes (`@keyframes "fade"`) and keyframes nested in a
  rule or another at-rule block are not registered and cannot be referenced; both are rejected by
  ADR-0018, which also confirms the styles-only visibility above as permanent.
- **Editor support.** Completion, hover and rename for keyframe names are provided by the VS Code
  extension over exactly the visible set above (CSSX-A42); no name the compiler rejects is offered.

## 7. Selectors and classes

### 7.1 Supported nesting

Supported forms include `&:hover`, `&::before`, `&:nth-child(2n)`, `& > .icon`, `& + .button` and
descendant nesting. `&` is required for compound, sibling and complex nesting in v0.1. A bare nested
selector is a descendant (D1, §3.4).

Selector lists are parsed at top-level commas, including functional pseudos. Native nesting
specificity is preserved: mixed-specificity parent lists use `:is(...)` where needed, or unsupported
flattening is rejected rather than naïvely expanded. Multiple `&` references and escaped class
identifiers are validated. Text inside attribute strings and declaration values is never rewritten.

Flattening is bounded per rule: a flattened selector list may not exceed **8 388 608 characters** or
**100 000 alternatives**, checked at every expansion step. Exceeding either limit rejects that rule
with a single **XESSA1001** naming the nesting depth and offending selector — message
`Cannot flatten selector "…": selector expansion exceeded the flattening limit of 8388608 characters
and 100000 selectors at nesting depth N; reduce repeated "&" or nested selector lists` — and
compilation continues with the rest of the file. The code is the existing syntax-family anchor rather
than a new one; a finer `XESSA1004` subcode for expansion-limit failures is a recorded optional
follow-up (`docs/known-limitations.md` §4).

### 7.2 Class renaming

All local class tokens, including nested references, use the same naming table. `:global(.external-icon)`
escapes renaming and is removed from the emitted selector. MVP supports simple global class escapes;
complex global selectors may follow.

MVP strategies are `none` and `prefix` (ADR-0010):

- `prefix` uses the file-level `prefix` setup key: `ui` produces `ui-card`; empty leaves names
  unchanged.
- CSS identifier compatibility is validated.
- Collisions across sources are detected when building a project. Intentional shared global classes
  are allowed and are never renamed or exported.

## 8. JavaScript maps and declarations

The JS map is a module of named constant exports, one per local class, in first-appearance order:

```js
export const buttonPrimary = "ui-button-primary";
```

Consumers import the binding and use it as the DOM class value:
`import { buttonPrimary } from "./button.map.js";` then `class={buttonPrimary}`. There is no default
export and no object literal: the map's single purpose is to hand the emitted class name to the DOM
under a stable JavaScript name (CSSX-A52).

- **Identifier.** The authored class name is split on `-` and `_` and camelCased
  (`button-primary` → `buttonPrimary`, `panel_head` → `panelHead`); leading and trailing `_` runs
  are preserved (`__proto__` → `__proto__`).
- **Adjustments are deterministic and never drop a class.**
  - characters outside the JavaScript identifier set become `_` (`foo.bar` → `foo_bar`);
  - an alias that would start with a digit, or that has no identifier parts, is prefixed with `_`
    (`2col` → `_2col`);
  - a reserved word is prefixed with `_` (`default` → `_default`);
  - when two classes resolve to the same identifier, the first-authored keeps it and later ones get
    `_2`, `_3`, … (first free suffix). A collision is a XESSA4001 **warning** naming both classes,
    not an error: the export set stays complete and unambiguous.
- `__proto__` needs no special casing: as a `const` binding it is an ordinary identifier.
- Output ordering is deterministic; the same table and options produce byte-identical text.
- Global classes are not exported.
- A style-merged module that authors `@setup { map-inherit: false; }` contributes no bindings to the
  merged table, so its classes appear in neither the JS map nor the declarations and cannot raise
  `XESSA4001`; its own entry build is unaffected (ADR-0020, the documented exception to §6.3's
  one-table rule).
- Generated declarations mirror the JS exactly, one `export declare const <identifier>:
  "<emitted>";` line per class with literal string types and no `any`. They are **opt-in**: the
  `map-types` setting (default `false`) writes `<map-name stem>.d.ts` beside the JS map.
- ESM is the default. By default the map imports no CSS; the page or bundler entry loads the
  stylesheet, so the module is importable by plain Node without a loader. A file (or project) may opt
  in with `import-css: true` / `output.importCss` (ADR-0021): the map then starts with exactly one
  `import "<stylesheet>";`, where the specifier is the path from the map file to the emitted
  stylesheet, POSIX-separated and `./`-prefixed when in or below the map directory. With a `css-dir`
  list the first-listed destination is imported. The import is omitted when no stylesheet is emitted
  (`emit-css: false`, or `module: true` suppressing outputs) and never appears in `.d.ts`.
- No runtime helper is required.

When map emission is disabled, requested type declarations are automatically suppressed with a
documented warning. The JS map is distinct from the CSS debugging source map.

## 9. Output configuration

File-level `@setup` supports independent output directories and optional filenames:

```scss
@setup {
  prefix: "dashboard";
  css-dir: "../styles";
  css-name: "dashboard.css";
  map-dir: "../modules";
  map-name: "dashboard.map.js";
  emit-css: true;
  emit-map: true;
  map-types: true;
  source-map: true;
  minify: true;
}
```

| Setting | Default | Meaning |
|---|---|---|
| `prefix` | empty | Class name prefix |
| `css-dir` | source directory | CSS output directory, or a comma-separated list of directories (ADR-0019) |
| `css-name` | `<stem>.css` | Optional CSS basename |
| `map-dir` | source directory | JS class map output directory |
| `map-name` | `<stem>.map.js` | Optional JS basename |
| `emit-css` | `true` | Write stylesheet |
| `emit-map` | `true` | Write JS class map |
| `map-types` | `false` | Write `.d.ts` beside JS map (opt-in; CSSX-A52) |
| `emit-types` | `false` | Deprecated alias for `map-types` |
| `source-map` | `false` | Write CSS source map |
| `minify` | `true` | Compact generated CSS whitespace while preserving CSS tokens and declaration order; set `false` / `--no-minify` for readable output (ADR-0022) |
| `map-inherit` | `true` | Whether a style-merged module's bindings join the importer's map and `.d.ts` (ADR-0020); its rules always merge |
| `import-css` | `false` | Prepend the emitted stylesheet's side-effect import to the JS map (ADR-0021); omitted when no stylesheet is emitted |
| `media-grouping` | `"safe"` | Grouping of conditional runs: `safe` (adjacent only), `none` (as authored) or the opt-in `merge` disjoint-family optimizer (ADR-0024); project `compiler.mediaGrouping` is the lower-precedence layer |

### 9.1 Path resolution

File-level directories resolve relative to the source file, never the current working directory.
Project-level directories resolve relative to the project root; source-relative subdirectories are
preserved by default to avoid basename collisions. A file-level directory is exact, without mirrored
subfolders.

A file-level `css-dir` list is the same rule applied per item: each destination is exact and
resolves relative to the source file, and the list replaces any project `output.cssDir` for that
file. The same `css-name` is written to every item, with one source map beside each destination when
`source-map: true`. An empty or duplicate item is `XESSA2001`; a destination outside the workspace
is rejected per item like any other output. Project configuration (`output.cssDir`) and CLI
overrides stay single-valued; a CLI `cssDir` override replaces the file list.

Filenames are basenames only: no separators or traversal. `css-name` requires `.css` and `map-name`
requires `.js` (optional extension normalization may be added later). A custom JS basename
`classes.js` yields `classes.d.ts`; a CSS name `theme.css` yields `theme.css.map` when source maps
are enabled. If only a directory is specified, the default filename is used; if only a filename is
specified, the effective directory is retained. Independent overrides must work.

Precedence: built-in defaults < project config < file `@setup` < explicit CLI overrides. CLI
overrides are explicit and MUST NOT silently flatten multiple outputs into one destination.

### 9.2 Safety and writing

All output paths are resolved before any write. The planner rejects input/output overlap, duplicate
targets, workspace escapes and symlink escapes unless an explicit trusted project policy permits
external output. Unknown setup keys and duplicate settings are rejected. Missing directories are
created. The JS map contains only named exports and, by default, imports no stylesheet; with
`import-css: true` it starts with one side-effect import of the emitted CSS (ADR-0021).

CSS emission may be disabled independently; the map is still planned and written. If map emission is
disabled, requested types are automatically suppressed with a documented warning (§8). No source map
is written when CSS is disabled.

The build validates the entire output plan before writing. Files are written to temp files in the
destination directory and renamed: per-file atomicity, not cross-file transactionality. On errors the
last successful outputs are retained and marked stale. Generated files are tracked in a manifest;
`clean` removes only compiler-owned files not modified externally. A `css-dir` list produces one
manifest record per destination, so `clean` removes every copy and the interrupted-write
`.cssx-tmp` sweep covers each output directory. On renames or configuration changes, obsolete owned
outputs are removed after a successful build, or reported when safe deletion cannot be established.
The watcher excludes generated outputs and avoids feedback loops. Unrelated user files are never
overwritten without explicit opt-in.

### 9.3 Acceptance cases

No setup; only CSS directory; only map directory; only names; both directories and names; nested
source; paths with spaces; Windows separators; output collision; invalid extension; traversal;
symlink; disabled outputs; renamed source; custom source map URL; relative import across sibling
directories; `css-dir` list with a source map per destination.

## 10. Project configuration

The MVP uses declarative `xessa.config.json`, safe to read in untrusted workspaces. A trusted
`xessa.config.ts` may come later and is executed only by an explicit trusted build.

```json
{
  "include": ["src/**/*.cssx"],
  "exclude": ["node_modules", "dist"],
  "output": {
    "cssDir": "dist/styles",
    "mapDir": "dist/maps",
    "emitCss": true,
    "emitMap": true,
    "mapTypes": true,
    "sourceMap": false,
    "minify": true,
    "mapInherit": true
  },
  "classes": { "strategy": "prefix", "prefix": "ui" },
  "media": { "md": "(min-width: 768px)", "xl": "(min-width: 1280px)" },
  "compiler": { "strict": true, "mediaGrouping": "safe" }
}
```

The schema is validated; unknown keys are rejected in strict mode. `compiler.mediaGrouping` accepts
`"safe"` (default), `"none"` and the opt-in `"merge"`; a file `@setup { media-grouping: …; }`
overrides it ([ADR-0024](docs/decisions/ADR-0024-media-merge-grouping.md)). Kebab-case source
settings map to camelCase JSON (`css-dir` ↔ `cssDir`). Multi-root VS Code workspaces resolve the
nearest config per file with an explicit workspace boundary. A JSON schema and completions are
provided. Media definitions merge by key (§4.2).

The workspace root is the nearest ancestor containing `xessa.config.json`, else the nearest ancestor
containing `package.json` (ADR-0007).

## 11. Public API

The compiler exposes pure APIs; it returns artifacts and never writes files. Project hosts provide
read/resolve operations and canonical path policy. Shared interface shapes:

```ts
interface Span {
  start: number;
  end: number;
  file: string;
}
interface Variant {
  aliases: string[];
  value: string;
  span: Span;
}
interface Declaration {
  kind: "declaration";
  property: string;
  value: string;
  variants: Variant[];
  span: Span;
}
interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  span: Span;
}
interface CompileResult {
  css?: string;
  js?: string;
  types?: string;
  sourceMap?: string;
  classes: Record<string, string>;
  diagnostics: Diagnostic[];
  dependencies: string[];
}
```

Public entry points:

- `parse(source, options)` — tolerant parse to a file AST plus diagnostics, with spans.
- `compile(source, options)` — compile one source to a `CompileResult`.
- `compileProject(entries, host, options)` — resolve modules/configuration and compile entries
  through an injected host.
- `planOutputs(...)` — validate and return the output plan before writing.

AST value fields hold raw source slices. Values containing `$` references additionally carry a
parsed token sequence; spans are preserved through all stages (ADR-0005). The IR records ordered
selectors, declarations, at-rule stack, origin spans and condition keys. The AST is immutable
during transformation.

Pipeline: tokenize → parse AST → resolve modules/config → semantic validation → lower into ordered
CSS IR → class rewrite → safe grouping → CSS/JS/types/source-map generation → output planning/writing.
Output is deterministic across runs and platforms. Source maps use standard v3 mappings; the CSS
source map comment points to the actual output basename. Fatal errors and warnings are distinct.

The exact TypeScript signatures and result types beyond these shapes are frozen by task A02. Changes
require lead approval.

## 12. Diagnostics

Codes are stable and belong to families:

| Family | Meaning | Canonical member |
|---|---|---|
| XESSA1xxx | Syntax and lexical errors, including top-level conditional blocks | `XESSA1001` syntax |
| XESSA2xxx | Symbol and module errors (undefined token, cycle, ambiguity) | `XESSA2001` undefined token |
| XESSA3xxx | Media and condition errors (unknown/rejected alias) | `XESSA3001` unknown media |
| XESSA4xxx | Naming and export errors (collision) | `XESSA4001` export collision |
| XESSA5xxx | Output planning errors (collision, escape, overlap) | `XESSA5001` output collision |

Every diagnostic carries a stable code, severity (`error` or `warning`), message and `Span`.
Recoverable syntax errors are reported once per statement and recovery resumes at the next safe
boundary. Invalid CSS is never emitted; affected constructs are omitted after an error diagnostic.

## 13. Deferred

The following are explicitly deferred beyond v0.1 and require an ADR plus regression fixtures:

- mixins and the `@apply` alias;
- keyframe names through token-only imports (permanent styles-only rule) and string-named or
  conditional keyframes (rejected for v0.1 by ADR-0015/ADR-0018; use `@use "…" styles` for imported
  keyframes); keyframe editor support is no longer deferred (CSSX-A42);
- arbitrary expressions and computation;
- container aliases and attribute-based theme conditions;
- inline pseudo-state modifiers;
- explicit token defaults and shared runtime token bundles;
- file-scoped and stable hash naming;
- top-level conditional blocks (D3 may be revisited by a future ADR);
- trusted executable `xessa.config.ts`;
- LSP server, cross-language rename and class rename across JSX;
- safe advanced optimization and richer native CSS support;
- source formatting beyond the initial formatter task.

Reusable declaration groups (`@group.<name>`) are no longer deferred: they are specified by
ADR-0017 in §3.7, which also lists the v1 exclusions.

## 14. Conformance

A conforming v0.1 implementation:

1. parses the grammar in §3.2 with recovery and reports the diagnostic families in §12;
2. applies the locked decisions D1–D3 without configuration;
3. honours the cascade contract in §5 and never silently reorders declarations;
4. emits CSS and JS maps (plus opt-in declarations) per §8–§9 or fails with diagnostics;
5. keeps compiler core free of mandatory third-party runtime dependencies;
6. runs on Node.js >= 20 and Bun, without a browser runtime.
