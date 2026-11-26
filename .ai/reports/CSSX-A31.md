# CSSX-A31 — G1: `@group.<name>` lexer/parser and additive AST nodes

## Summary

- Implemented phase **G1** of `.ai/plans/CSSX-PLAN-GROUPS.md`: `@group.<name>` definitions are parsed at
  the top level into a new `GroupDefinition` node, and the same construct inside any rule body (any
  depth) into a new `GroupUseSite` node. Both blocks accept declarations only; every other statement is
  one XESSA1001 with statement-scoped recovery.
- The dotted form is contiguous. `@group.card` and `@group.keyframes` parse; `@group`, `@group .card`,
  `@group. card`, `@group.` and `@group.2xl` are XESSA1001 with recovery and no crash. The lexer already
  produced the `at-keyword` / `.` / identifier triple, so G1 pins that contract in tests and recognises
  adjacency in the parser instead of joining tokens (the frozen `at-keyword` JSDoc defines an `@` name).
- No expansion, resolver, formatter or emitter behaviour was added. Duplicate definitions are both kept
  in the AST and no XESSA2001 is emitted anywhere (G2 owns that). `types/diagnostics.ts` is untouched.
- `bun run verify` is green: **712 pass / 0 fail across 42 files** (681 baseline + 31 new tests), zero
  golden/fixture changes. Group-free output is unchanged. Two findings for the lead are recorded below:
  an ADR/SPEC contradiction about "definition inside a rule", and the pre-G5 formatter hazard.

## Objective (as executed)

1. Read `AGENTS.md`, ADR-0017, `SPECIFICATION.md` §3.2/§3.6/§3.7 and the plan (§2.5, §2.7, §6, §7 G1,
   §9) before coding; treat ADR-0017 and the spec as frozen.
2. Extend `types/ast.ts` additively (lead-approved): `GroupDefinition` in `StylesheetItem`,
   `GroupUseSite` in `BlockItem`, JSDoc citing ADR-0017.
3. Add `parser/group.ts` (header reading, declarations-only body, both node kinds, rejection helper) and
   wire it into `statements.ts` (top level) and `rule.ts` (block items).
4. Extract `classifyStatement` to `parser/statement.ts` (no behaviour change) so the group body can reuse
   the ADR-0002 lookahead without a `rule.ts` ↔ `group.ts` import cycle; `rule.ts` re-exports it.
5. Add lexer and parser tests for acceptance and rejection (names, order, spans, empty definitions,
   `@group.keyframes`, nested rule/conditional/native/group statements, malformed dotted forms, bare
   include, conditional use site, and the existing XESSA1002 recovery with group nodes present).
6. Run `bun run verify`, update the plan's G1 row to 🟢, and write this report plus the task and log.

## Changed files

| File | Change |
|---|---|
| `packages/compiler/src/types/ast.ts` | **Lead-approved additive AST change.** New `GroupDefinition` (`kind: "group-definition"`, `name`, `declarations: readonly Declaration[]`, `span`) added to `StylesheetItem`; new `GroupUseSite` (`kind: "group-use-site"`, same shape) added to `BlockItem`. JSDoc mirrors `UseImport`/`RuntimeBlock`, cites ADR-0017, and documents inertness, declarations-only recovery, contiguous dotted names, empty/duplicate definitions and the G2/G3/G5 ownership. No existing node, key or type changed. |
| `packages/compiler/src/index.ts` | Public barrel: additive `export type { GroupDefinition, GroupUseSite }` alongside the sibling AST node types. No other change. |
| `packages/compiler/src/parser/group.ts` | **New.** `isGroupAtKeyword`, header reader (adjacency + CSS-identifier name), `parseGroupDefinition`, `parseGroupUseSite`, declarations-only body with one XESSA1001 per non-declaration statement, missing-block/conditional-use-site/unclosed handling, and `rejectGroupConstruct` for conditional blocks. |
| `packages/compiler/src/parser/statement.ts` | **New.** `classifyStatement` / `StatementKind` moved verbatim from `rule.ts` (ADR-0002 lookahead unchanged); `rule.ts` re-exports both for existing importers and the compiled `.d.ts`. |
| `packages/compiler/src/parser/rule.ts` | `BlockOptions` gains `allowGroup` (true for rule bodies and native at-rule blocks, false for conditional blocks); `parseAtRuleInBlock` dispatches group statements before native/modifier handling; `classifyStatement` import/re-export. |
| `packages/compiler/src/parser/statements.ts` | Top-level dispatch parses `@group` before the directive/native switch. |
| `packages/compiler/src/parser/diagnostics.ts` | Message helpers only: missing name, malformed dotted form, missing block, conditional use site, declarations-only and not-allowed-here. All use XESSA1001. |
| `packages/compiler/src/parser/index.ts` | JSDoc bullet updated to list `@group` definitions as top-level constructs and to state that the same construct in a rule body is a use site. |
| `packages/compiler/src/lexer/at-keywords.ts` | Contract note only: `@group.<name>` deliberately stays three tokens (frozen `at-keyword` JSDoc); the parser recognises contiguity by offsets. |
| `tests/compiler/groups.parser.test.ts` | **New (27 tests).** Acceptance, spans, declarations-only recovery, malformed forms, out-of-v1 constructs, XESSA1002 recovery with groups present. |
| `tests/compiler/lexer.test.ts` | **+4 tests** in a `group dotted form` block: three adjacent tokens, `@group.keyframes`, whitespace/comment inside the form, missing/non-identifier names. |
| `.ai/plans/CSSX-PLAN-GROUPS.md` | G1 row only: 🔴 → 🟢 with the evidence note. |
| `.ai/tasks/CSSX-A31.md`, `.ai/reports/CSSX-A31.md`, `.ai/reports/logs/CSSX-A31.log` | **New.** Task prompt, this report, worker log. |

No `docs/**`, `.ai/PROGRESS.md`, `.ai/todo.md`, fixture, golden, lowering, formatter, emitter, resolver,
variables or diagnostic-registry file was modified. Parallel worktree changes (A29/A30, vscode,
examples, board) were left untouched.

## Implementation notes

### Lexer: contract preserved, recognition by adjacency

The existing scan already yields `at-keyword("@group")`, `delim(".")`, `ident("card")` for
`@group.card`; the three tokens are adjacent (`token[0].end === token[1].start`,
`token[1].end === token[2].start`). Joining them into one token would contradict the frozen `Token`
JSDoc ("An `@` name ... including the `@`") and the lossless-stream expectations, so no token shape
changed. The parser requires exact adjacency for the `.` and the name, which makes whitespace and
comments inside the dotted form rejectable without any extra lexer state. `@group.2xl` lexes the tail as
one `number` token (`.2xl`), which the header reader treats as a dotted-form attempt with a
non-identifier name. Tests pin all of this.

### Parser: position decides the node kind

- Top level (`statements.ts`): `@group.<name> { … }` → `GroupDefinition`.
- Rule body / native at-rule block (`rule.ts`): the same construct → `GroupUseSite`.
- Conditional block bodies: group use sites are rejected (XESSA1001, statement omitted) because
  `ConditionalBlockItem` is not part of the lead-approved AST change and the conditional use-site form is
  out of v1.
- The group block body loop accepts declarations and `;`, and rejects with one XESSA1001 each: any
  at-keyword/modifier statement (nested conditional, native at-rule, `@group.`), a leading `{`, and any
  statement that classifies as a nested rule (ADR-0002 lookahead). The offending statement is skipped
  with `skipAtRule` / `skipBalancedBlock` / `skipStatementBlock`; the rest of the block survives.
- `@group.x @md { … }` (conditional use site, no block immediately after the header) is one XESSA1001
  naming the group, and the whole malformed statement is skipped so the enclosing rule keeps parsing.
  A separate `@md { … }` **after** a complete use-site block parses as an ordinary conditional block —
  pinned by a test.
- A valid header with no block (`@group.x;`, bare include form) is XESSA1001 and omitted. An unclosed
  group block reports the existing `unclosedBlock` wording in addition to the enclosing rule's own
  unclosed diagnostic.
- Malformed headers recover as one statement; a bare `@group` followed by something other than `{`
  advances past `@group` only, so a later rule still parses.
- Duplicate definitions produce two `GroupDefinition` nodes and **no diagnostic**; XESSA2001 is not
  implemented anywhere in this task.

### Spans

`GroupDefinition.span` / `GroupUseSite.span` run from the `@group` token through the closing `}` (or end
of input when unclosed). Declaration spans stay the parser's existing property-through-last-value span.
Tests assert exact authored slices, including nested use sites.

## Spec contradiction: "definition inside a rule" vs use sites in rule bodies

The prompt (and ADR-0017 item 1 / SPECIFICATION §3.7 "Definition") says a definition inside a rule is
XESSA1001, while item 2 of the same ADR and SPECIFICATION §3.2/§3.7 "Use site" say the identical
construct `@group.<name> { declarations }` is valid inside any rule body. There is no syntax that
distinguishes the two: the token sequence is byte-identical. The only implementable reading is the one
this task's acceptance also requires elsewhere — **position decides the node kind**: top level =
definition, rule body = use site. G1 implements that and pins it
(`groups.parser.test.ts` → "a group statement inside a rule is a use site, never a definition").

Consequence: the plan §8 fixture `definition-in-rule` ("XESSA1001, definition omitted") cannot be
satisfied without deleting use-site support. It needs a spec/plan correction before G4a. This is a
blocker for the fixture matrix, not for G1's grammar: declarations-only rejection, malformed forms and
nested-definition-like statements (`@group.y { … }` **inside** a group block) are all XESSA1001 and
tested.

## Pre-G5 formatter hazard (release blocker, observed)

Because G1 makes group sources parse cleanly and G5 printing is intentionally not implemented, the
existing formatter silently drops group nodes instead of returning the input. Observed:

```text
input : "@group.card {\n  padding: 12px;\n}\n\n.a {\n  @group.card {\n    color: red;\n  }\n}\n"
format: ".a {\n}\n"
diagnostics: 0
```

This is exactly the destructive path ADR-0017 warns about ("a parse→print formatter that cannot print
`@group` would delete authored groups on save"); G5 remains the release blocker before format-on-save
ships with group support. Per the frozen G1 instruction no formatter printing or guard was added, and
no exhaustive `kind` switch failed typecheck in `lowering/`, `emitter` or `formatter` (the group kinds
are inert defaults). Until G5 lands, group files must not be exposed to format-on-save (extension
default is off). Recorded here so it is not forgotten between G1 and G5.

## Verification

### Commands

```sh
bunx tsc -p packages/compiler/tsconfig.json --noEmit
bun test tests/compiler/lexer.test.ts tests/compiler/groups.parser.test.ts
bun test tests/compiler
bun run verify            # typecheck + lint + test
git status --porcelain
git diff --stat
```

### Output tails

`bunx tsc -p packages/compiler/tsconfig.json --noEmit` → exit 0, no output.

`bun test tests/compiler/lexer.test.ts tests/compiler/groups.parser.test.ts`:

```
 59 pass
 0 fail
 462 expect() calls
Ran 59 tests across 2 files.
```

`bun test tests/compiler`:

```
 560 pass
 0 fail
 787713 expect() calls
Ran 560 tests across 26 files.
```

`bun run verify`:

```
$ bun run typecheck && bun run lint && bun run test
$ tsc -p packages/compiler/tsconfig.json --noEmit && ... && tsc -p packages/vscode/tsconfig.json --noEmit
$ biome check .
Checked 388 files in 166ms. No fixes applied.
$ bun test
...
[xessa host] passed: activation, grammar, 6 commands, format-on-save (default off + on + parse error), 1 diagnostic(s), completion 11 item(s), compile+preview commands

 712 pass
 0 fail
 788663 expect() calls
Ran 712 tests across 42 files.
exit=0
```

A final `bun run verify` after the last JSDoc-only cleanups was also green with the same 712 pass / 0
fail and exit 0 (`.ai/reports/logs/CSSX-A31.log` §10–§11).

### Observed counts

| Measure | Before G1 | After G1 | Delta |
|---|---|---|---|
| `bun test` total | 681 pass / 41 files | 712 pass / 42 files | +31 tests, +1 file |
| `tests/compiler` | 529 pass / 25 files | 560 pass / 26 files | +31 tests, +1 file |
| `groups.parser.test.ts` | — | 27 pass | new |
| `lexer.test.ts` | 28 pass | 32 pass | +4 |
| Golden/fixture changes | — | 0 | none |

### Group-free output unchanged

Group-free sources are byte-identical: no fixture, golden, example or lowerer was edited; the full
pre-existing 681-test suite (including `golden.test.ts`, `variables.golden.test.ts`, emitter, lowering,
formatter, source-map, resolver and extension tests) passes unchanged. The only new parser acceptance is
for sources that contain `@group.<name>`, which previously fell through to the native at-rule / modifier
paths (and a top-level conditional diagnostic in some forms); no existing fixture, example or golden
contains `@group`. A group file compiles with no group expansion and no new diagnostics (G3 owns
expansion).

## Constraints and scope compliance

- Frozen registry `types/diagnostics.ts`: unchanged; only XESSA1001 is produced by the new code.
- No XESSA2001 anywhere in this task; duplicate definitions keep both AST nodes.
- No expansion/lowering, formatter printing, resolver, variables or emitter behaviour change; no
  `kind` switch needed an edit to keep typecheck green.
- No golden/fixture, docs, board or framework edit; no commit or push.
- Fix attempts: one (a `let message: string` annotation after the first typecheck error); no test was
  weakened or expectation regenerated.

## Blockers and handoff

- **Blocker for G4a (not G1):** the plan §8 `definition-in-rule` fixture contradicts §3.7's use-site
  rule; the spec/plan must choose position-based semantics (implemented here) or drop that fixture.
- **Release blocker for G5:** `format()` currently returns a group-less file for group sources (evidence
  above). G5 must print both node kinds, or a guard must return the input unchanged, before group
  support ships with format-on-save.
- **Handoff to G2:** consume `GroupDefinition` (top-level, both duplicates kept) and `GroupUseSite`
  nodes; add the `group` symbol kind, styles visibility, `@use … as group` rejection, duplicate and
  ambiguity XESSA2001 with the messages naming the group. **Handoff to G3:** splice `declarations` at the
  use-site span with authored spans; **handoff to G5:** print the two node kinds. `classifyStatement`
  now lives in `parser/statement.ts` (re-exported from `rule.ts`).
