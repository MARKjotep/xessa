# CSSX-F23 — group hover readability (multi-line defaults + override section)

## Summary

- `@group.<name>` hovers now render default declarations as a real Markdown bullet list: one
  ``- `property: value` `` line per declaration, authored order and spacing preserved. Consecutive
  inline-code entries no longer soft-collapse into one paragraph.
- A use site with overrides gets a separate **Overrides at this use site** section listing property
  names only, one per bullet. A use site with no overrides omits the section entirely; definition
  hovers never show it.
- Empty definitions keep the existing single italic line with no empty **Defaults** heading:
  `_No default declarations._` at a use site and the existing
  `_No default declarations; the group is inert._` at a definition.
- Editor-intelligence-only change: compiler output, diagnostics and ADRs are untouched. Exact
  Markdown is pinned in unit tests; the extension-host hover scenario proves the line separation.

## Status: PASS

## Changed paths

- `packages/vscode/src/intelligence.ts` — new `groupDefaultSection` (heading + bullets, empty-line
  fallback); definition and use-site `groupHover` branches consume it; overrides section emitted
  only for a non-empty `groupOverrides` result. Completion documentation and all other hover
  branches remain unchanged.
- `tests/extension/provider.intelligence.test.ts` — one new test pinning the exact Markdown for the
  definition, use site with overrides, use site without overrides, empty definition and empty use
  site; existing group-hover assertions moved from the old inline `Overrides in this use site:` text
  to the new heading/bullet contract.
- `packages/vscode/test/ui/hovers.js` — additive real-host assertions on a scratch workspace with
  three defaults and two overrides: `**Defaults**`, three ordered bullet lines, at least two `\n- `
  separators, and the separate `**Overrides at this use site**` bulleted section.
- `CHANGELOG.md` — one `[0.1.0]` editor line.
- `.ai/tasks/CSSX-F23.md`, this report, `.ai/todo.md` item 23 → 🟢.

## Exact Markdown evidence

Definition hover with defaults (`GROUP_DOCUMENT`):

```
**@group.card** — group definition

**Defaults**
- `padding: 12px`
- `color: black`
```

Use-site hover with overrides:

```
**@group.card** — group use site

Defined in this file.

**Defaults**
- `padding: 12px`
- `color: black`

**Overrides at this use site**
- `padding`
```

Use-site hover without overrides (the overrides section is absent):

```
**@group.card** — group use site

Defined in this file.

**Defaults**
- `padding: 12px`
- `color: black`
```

Empty definition and its use site:

```
**@group.empty** — group definition

_No default declarations; the group is inert._
```

```
**@group.empty** — group use site

Defined in this file.

_No default declarations._
```

All four shapes are asserted with `toBe(...)`, so the `\n- ` separators are real newlines rather
than soft-wrapped inline code.

## Host assertion

`packages/vscode/test/ui/hovers.js` opens a scratch workspace containing:

```cssx
@group.card-base {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
}

.card {
  @group.card-base {
    padding: 4px;
    border-radius: 0;
  }
}
```

It asserts the definition hover contains `**Defaults**` and the ordered lines
`\n- \`padding: 12px\`\n- \`border-radius: 8px\`\n- \`border: 1px solid #ddd\``, then asserts the
use-site hover contains `**Overrides at this use site**\n- \`padding\`\n- \`border-radius\``. Both
also assert `split("\n- ").length - 1 >= 2`. The committed `ui/clean.cssx` fixture has only one
group default, so the scratch workspace supplies the multi-declaration case without changing any
existing fixture or assertion.

## Gates

| Command | Exit | Evidence |
|---|---|---|
| `bun test tests/extension/provider.intelligence.test.ts` | 0 | 103 pass / 0 fail, 3668 expect calls |
| `bun test tests/extension/host.test.ts` | 0 | host 14 scenarios / **866 assertions** (was 858; hovers 50), 2 tests pass |
| `bun run verify` | 0 | **1283 pass / 2 skip / 0 fail** across 95 files (test duration 76.56 s; wall 80.84 s); typecheck + lint green; host suite included |
| `bun run release:check` | 0 | 179.22 s wall; verify + browser suite green; compiler/CLI builds; metadata and tarballs valid; 8 examples built with 0 warnings; VSIX 18 files / 136.04 KB |
| `bun run lint` | 0 | 471 files checked, no fixes (0.28 s) |

Baseline was 1282 pass / 2 skip / 0 fail over 95 files and 858 host assertions. This change adds one
intelligence test (1283 pass) and eight host assertions (866), with no assertion weakened.

## Board

`.ai/todo.md` item 23 is 🟢 with the landed reference (`groupHover` bullets, exact unit pins, host
assertions, this report). Item 22 (minified default) remains 🔴.

## F22 inherits

- F22 (minify default true) is compiler/output work; it inherits a clean editor hover contract and
  the 1283-pass / 866-host-assertion baseline.
- The group hover helpers are callable only through `groupHover`; completion documentation still
  uses the older inline `Defaults:` text and was deliberately left out of this hover-only wave.
