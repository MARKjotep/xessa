# Xessa 0.1.1 prepublish — runtime merge-order fix and release prep

**Date:** 2026-11-27
**Status:** 🟢 implementation and local gates complete; independent verification pending. **Not
published, committed or pushed.**

## Bug summary

`SPECIFICATION.md` §6.2/§6.3 and ADR-0016 require duplicate runtime custom-property names across a
merged build to resolve later-in-merge-order and emit no conflict diagnostic. Two unqualified
`@use "./a.cssx" styles;` imports declaring the same `@runtime` property instead raised
`XESSA2001` "Ambiguous unqualified import" and kept the first module's value. The first provider was
the only runtime definition `emitRuntimeTokens` could see, so the later definition never reached the
rank comparison. Input: `.ai/framework/bugs/runtime-token-merge-order-first-wins.md`.

## Fix design

- `resolveUnqualified` now returns both the deterministic first-provider winners for `$name`
  symbol resolution and a new per-name `RuntimeProviders` map containing every unqualified runtime
  definition in authored `@use` order.
- `buildScopes` returns `runtimeProviders`; `ModuleRecord` carries it as an additive field.
- `emitRuntimeTokens` registers every entry `runtimeProviders` entry after the normal runtime scope,
  so the existing `moduleMergeRanks` comparison chooses the later definition. The existing
  `byProperty` slot dedupes the output to one custom property.
- A runtime-only conflict is suppressed **only** when the importing module's authored AST contains
  no bare `$name` reference. A new resolver-local `references.ts` walk finds unqualified
  `dollar-ref` tokens and ignores `$namespace.member` (and escaped dots). A referenced name keeps
  `XESSA2001` and the first-provider recovery. Compile-time duplicate imports are unchanged.
- No new diagnostic codes, no parser/lexer/IR change, no dependency change.

## Tests

`tests/compiler/runtime.test.ts` adds:

1. Two unqualified `styles` imports with the same runtime property, no reference: zero diagnostics,
   one `:root`, later value (`green`), and both modules' rules emitted.
2. The same entry referencing `$x`: `XESSA2001` ambiguity remains.
3. A namespaced `$a.x` reference does not count as an unqualified reference, so the runtime merge
   stays diagnostic-free.
4. A token-only variant where graph merge rank (path-ordered) wins over authored `@use` order.
5. The existing entry-override and namespaced-merge tests remain green; the compile-time
   `variables/ambiguous-import` resolver test still expects `XESSA2001`.

Red evidence (before the fix), `bun test tests/compiler/runtime.test.ts`:
**25 pass / 2 fail** — case 1 failed with the XESSA2001 diagnostic and case 4 failed with the same
diagnostic. After the fix, `bun test tests/compiler/runtime.test.ts tests/compiler/resolver.test.ts`:
**57 pass / 0 fail**. The full suite is green below.

## Prepublish changes

- Root `package.json`: `repository`, `homepage` and `bugs` point at
  `https://github.com/MARKjotep/xessa`; name/version/bin/files/workspaces unchanged.
- `packages/language-service/package.json`: `"private": true` (internal editor service).
- `packages/vscode/syntaxes/xessa.tmLanguage.json`: `fileTypes` is `["cssx"]` (extension), with the
  grammar test updated.
- Docs status: `README.md`, `docs/usage.md`, `docs/release.md`, `packages/compiler/README.md`,
  `packages/cli/README.md`, `CHANGELOG.md`, `.ai/HANDOVER.md`, `.ai/todo.md` and
  `docs/known-limitations.md` now say **0.1.1 is the first Xessa release (2026-11-27), prepared for
  publication**, not published. `docs/release.md` records the compiler → CLI → root order and the
  root metadata; stale live/tag claims were removed from active sections.
- `.ai/framework/bugs/runtime-token-merge-order-first-wins.md` is **Fixed in 0.1.1** (original
  evidence retained); `.ai/framework/TRIAGE.md` records the fix and test path.
- `examples/portfolio/src/sections.cssx` and its generated outputs were not touched.

## Gate results (2026-11-27)

| Command | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0 (461 files) |
| `bun run test` | **1366 pass / 2 skip / 0 fail**, 1368 tests, 99 files |
| `bun run release:check` | exit 0 — Playwright **96/96**, compiler tarball **403 files**, CLI **89**, nine examples built, VSIX **18 files / 144.93 KB** |
| Targeted red→green | 25 pass/2 fail → 56 pass/0 fail as above |

The two skips are the opt-in soak suites (`XESSA_SOAK`), unchanged.

## Remaining manual steps (owner)

1. Create/confirm the npm **`@xessa`** org/scope and log in with 2FA.
2. Publish in order: `npm publish --workspace @xessa/compiler --access public`, then
   `npm publish --workspace @xessa/cli --access public`, then `npm publish --access public` for the
   root reservation package.
3. Run the registry post-checks in `docs/release.md` (versions, clean install, `npx`/`bunx`).
4. Create the VS Code publisher **`xessa`**, then `cd packages/vscode && npx @vscode/vsce publish`
   (extension `0.1.0`) or distribute the local VSIX.
5. After publication, update `docs/release.md`, `.ai/HANDOVER.md`, `.ai/todo.md` and the root README
   from release-ready to published, and record actual registry output.

## Pre-existing finding left untouched

`examples/portfolio/src/sections.cssx` still contains the previously triaged `@lg 3` invalid-CSS
pattern. It is outside this task's write set and was not modified; portfolio output was rebuilt by
`release:check` from unchanged sources.

## Independent verification (2026-11-27)

- Static verifier verdict: **PASS** — core merge-order bug, referenced-name ambiguity, compile-time
  duplicate behavior and the resolver/emission plumbing.
- `bun run typecheck`: exit **0**.
- `bun run lint`: exit **0** (461 files).
- `bun run test`: **1366 pass / 2 skip / 0 fail** (1368 tests, 99 files).
- `bun run release:check` on rerun: exit **0** — Playwright **96/96** (32 Chromium / 32 Firefox /
  32 WebKit), nine examples built, compiler tarball **403 files**, CLI **89 files**, VSIX
  `xessa-0.1.0.vsix` **18 files / 144.93 KB**.
- One known load-sensitive `cli-watch` timeout occurred on the first gate run; the isolated run
  passed **4/4**, the full gate rerun exited 0, and the gate changed no tracked files.
