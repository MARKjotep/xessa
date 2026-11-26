# Xessa grammar and lexical rules (v0.1)

The normative definition is [SPECIFICATION.md](../SPECIFICATION.md) §3. This page restates it for
authors and implementers, with the owner-locked decisions inline. Where this page and the
specification disagree, the specification wins.

## 1. Lexical rules

Xessa is parsed by a stateful tokenizer and a recursive-descent parser, never by splitting
declarations with regular expressions. Every token and AST node carries a source span (`start`,
`end`, `file`); diagnostics point at the authored range, and the language service maps spans to
line/column.

The tokenizer tracks:

- source offsets plus line and column;
- comments (`// …` and `/* … */`);
- escapes in identifiers, strings and selectors;
- quoted strings, including embedded `@`, `$`, `{`, `}`, `;`;
- balanced parentheses and brackets;
- brace nesting and statement boundaries.

### `@` recognition

`@` is only a Xessa construct when it is **not** inside a string, comment, `url(...)` or other
function argument, and only after whitespace at top-level value depth. Everything else is ordinary
CSS content:

```xessa
.icon { background: url("image@2x.png"); }
.label::after { content: "@md"; }
.note { width: calc(100% - 2rem); }
```

None of the `@` characters above are modifiers or directives. An unknown modifier at the correct
depth is reported (`XESSA3001`) rather than emitted as CSS.

A file-level directive (`@setup`, `@use`, `@variables`, `@runtime`, `@media-types`) is recognised
only at the **top level**. The same names inside a rule are not directives. `@group.<name>` is
defined at the top level as well, but its identical form inside a rule is a *use site* rather than a
definition (§3).

### Strings and escapes

Strings are single- or double-quoted and may contain CSS escapes. Escaped characters are never
interpreted as syntax: `content: "\@md"` holds a literal `@`. Setup values are CSS-string decoded
(`css-dir: "../gen\ styles"`). Quotes inside a string are escaped with `\"`; a backslash at the end
of a string is an error.

CSS identifier escapes are preserved in selectors and class names. Class renaming applies to the
authored class token; the escape text is not rewritten inside attribute strings, `content` values or
other declaration values.

### Statements and semicolons

- Xessa declarations require a semicolon.
- An ordinary CSS final declaration without a trailing semicolon before `}` is accepted only when it
  contains **no** recognised modifier and **no** `$` reference (ADR-0011). Otherwise the parser
  reports `XESSA1002`.
- Recovery happens at safe statement boundaries so the editor keeps working after an error. Each
  recoverable error is reported once; the affected construct is omitted rather than emitted as
  invalid CSS.
- Unknown or duplicate `@setup` keys, duplicate settings and invalid boolean values are
  `XESSA1001` errors (`compile` reports them at the exact setting span).
- Xessa directives are reserved names and may not be reused as aliases or token names where that
  would conflict.

## 2. Grammar (EBNF)

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

`groupDefinition` is top level only and `groupUseSite` is a block item inside a rule; the two
productions are textually identical, because position decides which one a `@group.<name>` block is.

This is **structural** grammar. CSS values and selectors are parsed as balanced token sequences:
`calc(100% - 2rem)`, `url(a(b).png)`, quoted strings, comments and escaped braces are not structural
punctuation. Aliases may begin with digits (`2xl`).

Multiple `@setup` blocks may appear at top level; they are merged in document order. A duplicate
setting key — within one block or across blocks — is rejected.

## 3. Directives

| Directive | Position | Purpose |
|---|---|---|
| `@setup { key: value; }` | top level | Output paths, filenames, emit flags, prefix. Keys are kebab-case. |
| `@use "path" [as ns] [styles];` | top level | Import compile-time tokens, optionally namespaced; the optional `styles` clause also merges the module's rules (ADR-0014). Paths are relative to the importing file and restricted to the workspace. |
| `@variables { name: tokens; }` | top level | Compile-time token definitions. Values substitute token sequences, not JavaScript. |
| `@runtime { name: value [@alias value]; }` | top level | Native custom properties with optional conditional values. |
| `@media-types { alias: condition; }` | top level | File-local media aliases, merged over built-ins and project config. |
| `@group.<name> { declaration; }` | top level (definition), rule body (use site) | Reusable declaration defaults (ADR-0017). A definition emits nothing; a use site splices the defaults and then its overrides. |

`@use` imports compile-time tokens by default; without the `styles` clause it never imports rules.
The optional `styles` clause makes the import rule-bearing (ADR-0014): the module's rules are merged
into the importing build ahead of the importing file's own rules, depth-first in authored `@use`
order, and keep the imported module's own `@setup prefix`. The build writes one merged class map (and
an opt-in declaration file with `map-types: true`); the same original class name resolving to
different emitted names is `XESSA4001`, and a camelCase export-identifier collision is resolved with a
`_2`/`_3` suffix plus a `XESSA4001` warning. A module that should never emit artifacts of its own
declares `@setup { module: true; }`, which suppresses its CSS, map, types and CSS import unless those
keys are authored explicitly. Modules are imported once; there is no implicit transitive re-export
and no network or executable import.

### Reusable declaration groups (`@group.<name>`)

A group is a named, non-parametric set of declarations, written once and spliced into rules with
per-use-site overrides. See [ADR-0017](decisions/ADR-0017-reusable-declaration-groups.md) and
[SPECIFICATION.md](../SPECIFICATION.md) §3.7.

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
```

- A **definition** (`@group.<name> { declaration… }`) is top level only, beside the other
  directives. The block accepts declarations and nothing else; the dotted form is contiguous
  (`@group.card`, never `@group .card`); and the name matches exactly and case-sensitively. A
  definition **emits nothing**: an unused group has no output, and an empty definition is legal and
  inert.
- A **use site** is the identical syntax inside a rule body at any nesting depth. The block is
  required — a bare `@group.card;` is `XESSA1001` — and accepts declarations only. Nested rules,
  conditional blocks and native at-rules inside either block are `XESSA1001`; the v1 exclusions are
  listed in [known-limitations.md](known-limitations.md).
- **Expansion** splices the group's defaults in definition order, followed by the use-site
  declarations in authored order, at the authored position, as one declaration run. Nothing is
  filtered, reordered, deduplicated or rewritten: overrides win through the ordinary cascade, as
  [cascade.md](cascade.md#2-precedence) shows.
- A module sees its own groups and those of `@use "…" styles` modules, mirroring
  `$keyframes.<name>`; a token-only import exposes none. `group` is a reserved directive name, so
  `@use "…" as group` is `XESSA2001`, and groups are not values — `$group.<name>` is
  `XESSA2001`.

## 4. Declarations and inline variants

```xessa
.button {
  display: flex;
  padding: 12px @md 20px @xl 32px;
  background: white @dark #181818 @xl+dark #101010;
}
```

- A declaration is `property: baseValue [@alias[+alias] value]* ;`.
- A **base value is required** for inline variants. For conditional-only declarations use a
  conditional block inside the rule.
- Variants are emitted in authored order, after their base value, as independent CSS declarations.
- Duplicate aliases in one modifier are normalised (`@md+md` is `@md`). Combined aliases are logical
  **AND**.
- `!important` binds **per value segment** (D2):

  ```xessa
  padding: 10px @md 20px !important;
  ```

  emits `padding: 10px` and, inside `md`, `padding: 20px !important`. The flag is never propagated
  from one segment to another. See [ADR-0003](decisions/ADR-0003-important-per-segment.md).

### Owner-locked decision D1 — bare nested selectors are descendants

A nested rule whose selector has no `&` is a **descendant** selector, exactly as if it were written
with a leading `& `:

```xessa
.button {
  .icon { width: 16px; }
}
```

lowers to `.ui-button .ui-icon`. `&` is still required for compound, sibling and other complex
nesting in v0.1. Nested rules are distinguished from declarations by balanced lookahead: a `{` at
top level before the statement terminator means a rule, not a declaration. See
[ADR-0002](decisions/ADR-0002-descendant-nesting.md).

### Owner-locked decision D3 — conditional blocks are rule-scoped

```xessa
.card {
  @md { display: grid; gap: 24px; }
}
```

Conditional blocks are valid **only inside rules**. A top-level conditional block is a
`XESSA1001`-family syntax error:

```xessa
@md {              /* XESSA1001: conditional block outside rule */
  .card { padding: 20px; }
}
```

The parser reports the error once, recovers at the next safe statement boundary, and emits no CSS
for the rejected block. Native top-level at-rules keep their native meaning and are not conditional
blocks. See [ADR-0004](decisions/ADR-0004-rule-scoped-conditionals.md).

### Owner-locked decision D2 — `!important` is per segment

See §4 above and [ADR-0003](decisions/ADR-0003-important-per-segment.md). Each inline variant
segment is an independent declaration and carries only its own flag.

## 5. Rules, nesting and selectors

Blocks may contain declarations, nested rules, conditional blocks and native at-rules. Supported
nesting forms in v0.1:

| Authored | Emitted (prefix `ui`) |
|---|---|
| `&:hover` | `.ui-button:hover` |
| `&::before` | `.ui-button::before` |
| `&:nth-child(2n)` | `.ui-button:nth-child(2n)` |
| `& > .icon` | `.ui-button > .ui-icon` |
| `& + .button` | `.ui-button + .ui-button` |
| `&.is-active` | `.ui-button.ui-is-active` |
| `.icon` (bare) | `.ui-button .ui-icon` (D1) |

Selector lists are split only at top-level commas, including functional pseudos such as
`:is(.a, .b)`. Native nesting specificity is preserved: for mixed-specificity parent lists the
emitter uses `:is(...)` where needed, or rejects unsupported flattening instead of expanding it
naïvely. Multiple `&` references and escaped class identifiers are validated. Text inside attribute
strings and declaration values is never rewritten.

A leading `&` is preserved as authored through lowering and resolved during selector flattening.

## 6. Media conditions

Default aliases (all `min-width` unless noted):

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

Aliases merge by key: built-ins < project `media` config < file `@media-types`; the later layer wins
for the same key and distinct keys accumulate. MVP supports **one media-query expression per
alias**. Comma lists, two media types in one modifier, and aliases defined with `not`/`only` in a
combination are rejected with `XESSA3001`; native media lists pass through untouched. See
[ADR-0006](decisions/ADR-0006-media-alias-merge.md).

## 7. Native at-rules

Native CSS at-rules retain their meaning and are emitted around Xessa-generated declarations.
Supported pass-through contexts include `@media`, `@supports`, `@layer`, `@container`,
`@keyframes`, `@font-face`, `@property` and classic `@page`.

`@keyframes`, `@font-face` and `@property` are **restricted contexts**: inline modifiers and
conditional blocks inside them are rejected (`XESSA3001`, "Unsupported Xessa transformation in this
context") instead of silently changing semantics. Plain declarations and keyframe steps pass
through. See [compatibility.md](compatibility.md#native-at-rules).

### Keyframe name references (`$keyframes.<name>`)

An authored `@keyframes <name>` block registers `<name>` in a built-in `keyframes` namespace
([ADR-0015](decisions/ADR-0015-keyframes-namespace.md)). A declaration value can reference it, and the
reference compiles to the plain name text:

```xessa
@keyframes spin {
  from { rotate: 0deg; }
  to { rotate: 360deg; }
}
.spinner {
  animation-name: $keyframes.spin;
  animation-duration: 1s;
}
```

emits `animation-name: spin` beside the unchanged `@keyframes spin` block. Notes:

- Only a top-level `@keyframes` whose prelude is a plain identifier registers a name. String-named
  keyframes (`@keyframes "fade"`), keyframes nested in a rule or inside another at-rule block such as
  `@media`, and non-identifier preludes stay native CSS only.
- A module can also use the keyframe names of modules it imported with `@use "…" styles` — those
  blocks are emitted in its own build. Token-only imports do not expose keyframe names, because
  their CSS is not emitted.
- An unknown member, a bare `$keyframes` and an `@use … as keyframes` alias are `XESSA2001`; the
  affected declaration is omitted. Two merged modules defining the same name are **not** an error:
  both blocks are emitted and native cascade order decides.
- Completion, hover and rename for keyframe names are not implemented yet.

## 8. Diagnostics

| Family | Meaning | Anchor |
|---|---|---|
| `XESSA1xxx` | Syntax and lexical errors, including top-level conditional blocks | `XESSA1001` |
| `XESSA2xxx` | Symbols and modules (undefined token, cycle, ambiguity) | `XESSA2001` |
| `XESSA3xxx` | Media and condition errors | `XESSA3001` |
| `XESSA4xxx` | Naming and export errors | `XESSA4001` |
| `XESSA5xxx` | Output planning (collision, escape, overlap) | `XESSA5001` |

Every diagnostic has a stable code, severity, message and span. Errors reject the affected
construct; warnings leave output in place. Invalid CSS is never emitted.

## See also

- [cascade.md](cascade.md) — what the emitted order means in the browser.
- [configuration.md](configuration.md) — `@setup`, `xessa.config.json` and output planning.
- [compatibility.md](compatibility.md) — supported and unsupported constructs.
- [`examples/basic`](../examples/basic/) — a feature tour source and its committed output.
