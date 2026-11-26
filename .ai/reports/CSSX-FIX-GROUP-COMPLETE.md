# CSSX-FIX-GROUP-COMPLETE — group-body CSS completion

## Summary

- Owner smoke 2026-11-26 (PP3): inside a `@group.<name> { … }` block, CSS property completion did
  not fire, while the same position inside a normal rule body listed properties. Board bug 25.
- Cause: `contextAt` classified a top-level group definition interior as `none`; a group definition
  is not a style rule, so the rule-body branch never ran. Use-site bodies already worked through
  their enclosing rule but were not classified explicitly.
- Fix: a new `findEnclosingGroupBody` plus a declaration-only branch treat the interior of a
  definition or use site (inside its braces) as a declaration context: properties at a statement
  start, the ordinary value state after `property:`, never a selector list (ADR-0017). Directive
  completion, `@group.` name completion, tokens/namespaces, keyframes and `@setup` bodies are
  unchanged. No compiler/CLI change.
- Failing repro tests were written first and shown red; both are green after the fix. A real-host
  completion assertion was added and the full gates pass.

## Status: PASS

## Red before the fix

`bun test tests/extension/provider.intelligence.test.ts` failed on the new repro test with:

```
error: expect(received).toEqual(expected)

  {
-   "kind": "property",
-   "word": "",
+   "kind": "none",
  }

(fail) group completion > group definition and use-site bodies offer the rule-body property set (bug 25)
 103 pass
 1 fail
```

A direct probe confirmed the shape:

```
DEF ctx {"kind":"none"}          DEF items []
USE ctx {"kind":"property"}      USE items ["accent-color", …]
RULE ctx {"kind":"property"}     RULE items ["accent-color", …]
```

## Fix

- `packages/vscode/src/intelligence.ts`
  - `findEnclosingGroupBody` walks `body`/`block` members and returns the innermost
    `group-definition`/`group-use-site` span containing the offset.
  - `contextAt` checks it before the rule branch, gated by authored brace depth so only the block
    interior qualifies (not the closing `}`). Inside: a `property:` current-line statement returns
    the value state; everything else returns the property state. Group bodies accept declarations
    only (ADR-0017), so no selector path is offered, but statement/`@`/`$`/declaration
    classification earlier in `contextAt` is untouched.
- `tests/extension/provider.intelligence.test.ts` — one additive test that compares the group
  definition and use-site property labels to the normal rule-body property set, asserts `padding`
  is `kind: "property"` with snippet `padding: $0;`, and asserts `padding: ` switches to the value
  state in both bodies.
- `packages/vscode/test/ui/completions.js` — additive real-host scenario 10b: a group definition
  body returns property items (`padding`, `kind: Property`, detail `CSS property`), accepting the
  item inserts `padding: ;`, and applying it writes `padding: ;` on the declaration line. The
  completion scenario count is now 23 while the suite keeps 14 scenarios.

## Host evidence

```
[xessa host] passed: 14 scenarios, 872 assertions
[baseline=36, completions=138, hovers=50, diagnostics=36, colors=42, semantic-tokens=21,
 commands=26, navigation=24, quickfix=15, checklist=98, commands-matrix=101, config=54,
 accessibility=196, performance=35]
```

Was 14 scenarios / 866 assertions (completions 132); the new scenario adds 6 assertions.

## Gates

| Command | Exit | Result |
| --- | --- | --- |
| `bun test tests/extension/provider.intelligence.test.ts` | 0 | red first (1 fail), then **104 pass / 0 fail** |
| `bun run verify` | 0 | **1284 pass / 2 skip / 0 fail**, 1286 tests across 95 files, 67.43 s; host **14 scenarios / 872 assertions**; typecheck + Biome green |
| `bun run release:check` | 0 | green; browser **96/96**; VSIX **18 files / 136.13 KB** |
| `bun run lint` | 0 | `biome check .` — 452 files, no fixes applied |

## Records updated

- `.ai/todo.md` bug item **25** added with the owner quote and flipped 🟢.
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` PP3 → 🟢 with the owner-verified note.
- `CHANGELOG.md` `[0.1.0]` editor line for group-body property/value completion.
- `.ai/tasks/CSSX-FIX-GROUP-COMPLETE.md` and this report.

## Handoff

Status PASS. Group definition bodies classified as `none`; now both definition and use-site
interiors are declaration contexts via `findEnclosingGroupBody` + a declaration-only branch.
Changed: `packages/vscode/src/intelligence.ts`, `tests/extension/provider.intelligence.test.ts`,
`packages/vscode/test/ui/completions.js`, `.ai/todo.md`, plan PP3, `CHANGELOG.md`, task/report. Host
assertion added (group body properties + `padding: ;`). Gates: verify 0 / 67.43 s (1284 pass, host
14/872), release:check 0 (browser 96/96, VSIX 18/136.13 KB), lint 0. PP4 inherits a green tree;
no compiler/CLI changes, no git operations, uncommitted work preserved.
