# Xessa golden fixtures

One directory per fixture. Fixtures are the executable form of `SPECIFICATION.md` and the
`docs/decisions/` ADRs; they are parsed and compiled by later phases, never by hand. This catalog is
frozen by task A02 (P0) so the lexer (A03), parser (A04), media/IR (A05/A06), resolver (A07/A08),
class map (A09) and output planner (A10) can start against fixed inputs.

## Layout

```text
tests/fixtures/<group>/<fixture>/
  input.cssx              # required entry source, valid unless the fixture is named an error case
  *.cssx                  # optional sibling modules imported by input.cssx
  xessa.config.json        # optional local project configuration (schema frozen in P5)
  source-path.txt          # optional virtual entry path used instead of `input.cssx`
  expected/
    css                    # golden CSS; filled in P2
    map.js                 # golden JS class map (named `export const` bindings)
    map.d.ts               # optional golden declarations, only for the two fixtures that pin them
    diagnostics.json       # diagnostics expectations (see below)
```

- The entry file is `input.cssx` at the fixture root. Its virtual source path is
  `<fixture-id>/input.cssx` relative to the workspace root. A fixture that needs a different source
  location ships `source-path.txt` containing one workspace-relative POSIX path; the harness reads
  it and uses that path instead. Only `output/nested-source` does this today.
- Merged-build fixtures (`keyframes/*`, `runtime/override-*`, `groups/*` merged cases) ship
  `entry.cssx` and are compiled by their feature suite through `compileProject`; they are not part
  of the plain `input.cssx` entry catalog.
- Sibling `.cssx` files are token-only modules resolved exactly as the fixture's `@use` specifiers
  say; they are not independent entries.
- `xessa.config.json` is read only for project-configuration fixtures. The document schema is frozen
  in phase P5; today it mirrors SPECIFICATION.md §10 with every documented key.
- All paths in fixtures and expectations are POSIX with forward slashes. Fixtures never contain
  absolute paths.

## Golden artifact status

`expected/css` and `expected/map.js` are intentionally empty placeholders. They are filled in when the
owning phase lands — CSS in P2, JS class maps in P3/P4 — and are reviewed by the lead before being
treated as golden. Do not "fix" a fixture by editing an expected artifact to match buggy output; fix
the compiler or escalate the contract.

`expected/map.d.ts` is no longer part of the default layout: declarations are opt-in (`map-types`),
so only fixtures whose goldens pin the declaration text (`canonical/button`, `naming/prefix`) ship
one. The map is one `export const <camelCase> = "<emitted>";` line per class with no default export;
see SPECIFICATION.md §8 (CSSX-A52).

`expected/diagnostics.json` is authored now **only** where the expectation follows from the frozen
syntax/lexical rules and the diagnostic registry in
`packages/compiler/src/types/diagnostics.ts`:

- `null` — no expectation authored yet; the harness must treat the fixture as diagnostic-unchecked.
- `[]` — explicit expectation of no diagnostics; used only for lexical fixtures whose inertness is
  pinned by SPECIFICATION.md §3.1.
- a JSON array — the complete expected diagnostic set (see next section).

Semantic fixtures (`variables/*` errors, `runtime/collision-with-compile-time`, naming and output
fixtures) keep `null` until their phase lands; their intended outcome is recorded in the table
below. Reusable-declaration-group fixtures (`groups/**`) author their complete expectation set now:
`tests/compiler/groups.golden.test.ts` compiles every one of them through the real
`compileProject` build and pins the codes, messages and spans (G4a of
`.ai/plans/CSSX-PLAN-GROUPS.md`).

## Diagnostics format and matching policy

```json
[
  {
    "code": "XESSA1001",
    "severity": "error",
    "messageContains": "conditional block",
    "span": { "line": 1, "col": 1 }
  }
]
```

- `code` — a reserved code from `DIAGNOSTIC_CODES` (XESSA1001, XESSA1002, XESSA1003, XESSA2001,
  XESSA3001, XESSA4001, XESSA5001). Subcodes added later are also accepted once registered.
- `severity` — exact match against `"error"` or `"warning"`.
- `messageContains` — required, non-empty phrase that must occur in the diagnostic message,
  case-insensitive. Keep it short; wording beyond this phrase is not frozen. Syntax fixtures use the
  wording of the registry summaries so A04 has a single target.
- `span` — a **position**, not a span: 1-based `line` and 1-based `col` in the fixture source,
  derived by the harness from the reported offsets. Line/column are never stored in the AST
  (`Span` holds offsets only). The position must satisfy `start <= position <= end` of the actual
  diagnostic span, where the end is inclusive for this check so zero-width end-of-file diagnostics
  match.
- Matching is a one-to-one multiset comparison: every expectation must match a distinct actual
  diagnostic with the same code and severity, and an unmatched extra diagnostic fails the fixture
  (except warnings that the registry defines as policy outcomes for that fixture, which are always
  listed).

Syntax diagnostics are statement-scoped: XESSA1002 spans the declaration missing its terminator and
XESSA1003 spans the malformed statement, so those fixtures point at the statement start. XESSA1001
construct diagnostics point at the offending construct (`@md` for a top-level conditional block,
`@ultrawide` for an unknown modifier, the setting key for setup errors); `errors/unclosed-block`
points at end of file, where an unclosed block is reported.

## Fixture index

| Fixture | Pins |
|---|---|
| `canonical/button` | SPECIFICATION.md §2 verbatim, plus the `theme.cssx` token module (`$theme.primary`). |
| `lexical/at-in-string` | `@` inside strings is literal content, including combined aliases. |
| `lexical/url-at` | `@` inside quoted and unquoted `url(...)` is literal. |
| `lexical/calc` | A modifier-looking token inside function arguments (`calc(100% - @md 20px)`) is **not** recognized; it stays literal CSS. |
| `lexical/comments-escapes` | Comments, quoted `@`/`/*`, and an escaped colon in a class token stay inert. |
| `lexical/no-whitespace-modifier` | `12px@md` has no preceding whitespace, so `@md` is literal value content; no modifier, no diagnostic. |
| `lexical/at-mid-value` | One fixture pins both sides: `@` inside the URL string is literal while the whitespace-preceded `@md` after it is a recognized modifier. |
| `lexical/final-no-semicolon` | ADR-0011: a plain CSS final declaration (`padding: 10px`) without a trailing semicolon before `}` is accepted with no diagnostics. |
| `media/inline-variants` | SPECIFICATION.md §3.2 card example: inline variants, `@xl+dark`, block conditions, `@media-types`. |
| `media/combined-and` | Combined aliases are AND; includes `2xl` and width+orientation. |
| `media/block-conditions` | Nested conditional blocks combine conditions; `@print` inside a rule. |
| `media/custom-alias-override` | File `@media-types` overrides built-in `md` and adds `tablet`. |
| `media/duplicate-aliases` | Duplicate aliases in one modifier (`@md+md`) normalize. |
| `nesting/descendant-bare` | D1: bare `.icon` is a descendant, including multi-level descendant chains. |
| `nesting/pseudo-combinators` | `&:hover`, `&::before`, `& > .icon`, `& + .button`, `&:nth-child(2n)`. |
| `nesting/multiple-amp` | Multiple `&` references, including a parent reference that is not first (`.row &`). |
| `important/per-segment` | D2: important on base only, variant only, both, and on adjacent variant segments. |
| `errors/top-level-conditional` | D3: one XESSA1001 at `@md`; the following rule still parses. |
| `errors/unknown-modifier` | XESSA3001 for `@ultrawide`; the affected declaration is omitted. |
| `errors/unclosed-block` | XESSA1001 at end of file. |
| `errors/unknown-setup-key` | XESSA1001 for `theme:`; duplicate `prefix` is a separate fixture. |
| `errors/duplicate-setting` | XESSA1001 for a repeated `prefix` key inside one block (tap the merged-`@setup` rule). |
| `errors/missing-semicolon` | XESSA1002 for `color: red` followed by another declaration; recovery resumes at the next statement. |
| `errors/semicolonless-modifier` | XESSA1002 for a final declaration carrying a recognized modifier (`padding: 10px @md 20px`) with no semicolon before `}` (ADR-0011). |
| `errors/semicolonless-before-nested-rule` | XESSA1002 for a non-final `color: red` that runs into `&:hover { … }`; recovery keeps the authored declaration and the nested rule (ADR-0011, invariant 2). |
| `errors/malformed-value` | XESSA1003 for `calc(100% - 20px;` (unbalanced parenthesis). |
| `variables/basic` | Local tokens, token-sequence substitution and forward references. |
| `variables/local-overrides-imported` | A local `gap` overrides an unqualified imported `gap`; imported `radius` still resolves. |
| `variables/ambiguous-import` | Two unqualified imports export `spacing`; intended XESSA2001 error (diagnostics authored in P3). |
| `variables/duplicate-local` | A repeated compile-time local definition stays XESSA2001; the first definition is kept and the rule still emits (ADR-0016 keeps this negative unchanged). |
| `variables/local-overrides-ambiguous-import` | A local `@variables` definition wins over two unqualified imports that export the same name, with no ambiguity diagnostic (ADR-0016). |
| `variables/cycle` | `a.cssx` ↔ `b.cssx` cycle; intended XESSA2001 error. |
| `variables/undefined-ref` | `$missing` is undefined; intended XESSA2001 error. |
| `variables/namespaced-members` | `$layout.spacing` and `$layout.margin` stay independent of local names. |
| `keyframes/same-file` | ADR-0015: `@keyframes spin` registers `$keyframes.spin`; `animation-name: $keyframes.spin` emits `animation-name: spin` beside the native block. |
| `keyframes/unknown-member` | ADR-0015: `$keyframes.fade` with only `spin` declared is XESSA2001 and the declaration (and its empty rule) is omitted; the keyframe block still emits. |
| `keyframes/bare-namespace` | ADR-0015: bare `$keyframes` follows the bare-namespace XESSA2001 rule with segment omission. |
| `keyframes/style-import` | ADR-0015: a keyframe from a `@use "…" styles` module is referenceable from the importing file; the merged build emits the block (merged fixture: `entry.cssx`). |
| `keyframes/token-only` | ADR-0015: a token-only import does not expose keyframe names (`XESSA2001`, empty CSS) because its block is not emitted. |
| `keyframes/duplicate-name` | ADR-0015: two merged modules may declare the same keyframe name; both blocks are emitted and the cascade decides, with no diagnostic (merged fixture: `entry.cssx`). |
| `groups/same-file` | ADR-0017 item 3: definition plus one use site with overrides; **all** repeated properties are emitted in authored order (`padding: 12px` and `padding: 20px`) — no filter, no dedupe, no reorder. |
| `groups/no-override` | ADR-0017 item 2: an empty use-site block is valid and expands the defaults only. |
| `groups/two-use-sites` | ADR-0017 item 3: two use sites expand independently (no cross-contamination) and `groupRuns("safe")` still merges the two adjacent `.status` runs without reordering the spliced declarations. |
| `groups/unknown-group` | ADR-0017 item 7: an unknown group is XESSA2001, exactly the use-site block is omitted, and the rule it emptied is dropped. |
| `groups/duplicate-definition` | ADR-0017 item 5: XESSA2001 spans the later definition, the first definition wins, and that first group still expands with the use-site override. |
| `groups/group-position` | ADR-0017 item 1: the same `@group.card { … }` syntax is a definition at top level and a use site inside a rule body (also nested under `&:hover`); position decides, so there is no diagnostic. |
| `groups/nested-rule-in-definition` | ADR-0017 items 1/7: a nested rule inside a definition is XESSA1001, that statement is omitted, and the surviving defaults (`padding`, `color`) still expand. |
| `groups/conditional-use-site` | ADR-0017 item 7 / §9.1: `@group.card @md { … }` is out of v0.1 — XESSA1001, the whole statement is omitted, and the rule's own declaration continues. |
| `groups/inline-variant-default` | ADR-0017 item 8: an inline variant in a default (`padding: 8px @md 12px`) expands as a base segment plus an `@media (min-width: 768px)` segment in authored order. |
| `groups/important-default` | ADR-0017 item 3: a group default authored `!important` is not beaten by a later plain use-site declaration; both declarations are emitted and the CSS cascade decides. |
| `groups/empty-group` | ADR-0017 item 1: an empty definition is legal, inert and reports nothing; an empty use-site block of a non-empty group still expands that group's defaults. |
| `groups/group-named-keyframes` | ADR-0017 item 5: `@group.keyframes` is legal and expands normally, while `$keyframes.spin` keeps resolving to the `@keyframes` block (the two namespaces stay independent). |
| `groups/alias-group` | ADR-0017 items 5/7: `@use "…" as group` is XESSA2001 at the `@use` (reserved directive name); the rejected statement imports nothing and the rest of the file compiles. |
| `groups/style-import` | ADR-0017 item 4: a group defined in a `@use "…" styles` module is usable in the entry, and its default resolves the defining module's token (`$pad` → `12px`) (merged fixture: `entry.cssx`). |
| `groups/token-only` | ADR-0017 item 4, owner decision (a): a token-only import exposes no groups — XESSA2001, the block is omitted and no CSS is emitted (merged fixture: `entry.cssx`). |
| `groups/ambiguous-import` | ADR-0017 item 5: two `styles` modules define `card` with no local definition — XESSA2001 naming both modules, both definitions stay inert, and the emptied rule is dropped (merged fixture: `entry.cssx`). |
| `groups/local-shadows-import` | ADR-0017 item 5: a local definition shadows the imported same-named definition with no diagnostic (merged fixture: `entry.cssx`). |
| `groups/transitive-visibility` | ADR-0017 item 4: `entry styles→ b styles→ c`; the group defined in `c` is usable in the entry and the merge order stays depth-first (`c`, `b`, entry) (merged fixture: `entry.cssx`). |
| `groups/cross-module-defining-tokens` | ADR-0017 item 6: a default's `$pad` resolves in the defining module (`12px`), the entry's identically named token (`40px`) never leaks in, and the override stays later (merged fixture: `entry.cssx`). |
| `groups/runtime-ref` | ADR-0017 item 6, owner decision (b): a `@runtime` reference in a default is XESSA2001 with that declaration omitted; the rest of the group expands and the runtime declaration still emits (merged fixture: `entry.cssx`). |
| `runtime/basic` | SPECIFICATION.md §3.4 runtime custom property plus reference. |
| `runtime/with-variant` | Runtime tokens with `@dark`, `@md` and `@dark+md` overrides. |
| `runtime/collision-with-compile-time` | Compile-time and runtime `primary` collide; intended XESSA2001 error. |
| `runtime/override-entry` | ADR-0016: an entry `@runtime` definition overrides a style-imported module's same-named custom property (merged fixture: `entry.cssx`). |
| `runtime/override-modules` | ADR-0016: two style-imported modules define one custom property; the later one in merge order wins with no diagnostic (merged fixture: `entry.cssx`). |
| `runtime/override-variants` | ADR-0016: the entry's `@dark` variant beats a style-imported module's same-query variant while base and override order stay authored (merged fixture: `entry.cssx`). |
| `global/escape` | `:global(.external-icon)` is neither renamed nor exported, at top level and nested. |
| `naming/prefix` | `ui` prefix applies to nested classes and camelCase export aliases. |
| `naming/empty-prefix` | An explicit empty prefix leaves names unchanged. |
| `naming/camel-collision` | `foo-bar` and `fooBar` collide; intended XESSA4001 error. |
| `naming/reserved-js-identifier` | `.default` and `.delete` stay in the quoted-key map, omit named exports and warn (XESSA4001 warning) in P4. |
| `output/no-setup` | Defaults: CSS and map beside the source, declarations off (`map-types` opt-in), no source map. |
| `output/only-css-dir` | Only `css-dir` is overridden; map output uses the default directory. |
| `output/only-map-dir` | Only `map-dir` is overridden; CSS output uses the default directory. |
| `output/only-names` | Only `css-name`/`map-name` are overridden; effective directories are retained. |
| `output/dirs-and-names` | Both directories and both names; `classes.js` yields `classes.d.ts`, `theme.css` yields `theme.css.map`. |
| `output/nested-source` | Uses `source-path.txt` (`src/pages/dashboard.cssx`) to pin project-relative subdirectory preservation. |
| `output/disabled-emit` | `emit-map: false`; types are auto-suppressed with a documented warning (SPECIFICATION.md §8). |
| `config/project-json` | Every `xessa.config.json` key from SPECIFICATION.md §10 beside `input.cssx`, which uses them. |

## Authoring rules

1. Fixtures are normative inputs. Do not add new syntax here without a spec section or ADR.
2. If an input depends on a reading the frozen spec does not settle, do not guess: record the
   ambiguity in the task report and leave the expectation unauthored (`null`) until the lead rules.
3. Keep fixtures minimal; one behavior per directory unless a fixture explicitly pins two sides of
   the same boundary (`lexical/at-mid-value`).
4. Expected artifacts must be deterministic: no timestamps, absolute paths or platform separators.
5. Goldens are refreshed only after the lead reviews the compiler change that produced them.
