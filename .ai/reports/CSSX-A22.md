# CSSX-A22 — Format-on-save for `.cssx` (VS Code)

## Summary

- The extension now registers a whole-document `DocumentFormattingEditProvider` for `xessa` and
  exposes **Xessa: Format Document** (⌥⇧F / `editor.formatOnSave`) through the compiler's existing
  pure `format(source, file)`; no compiler code was changed.
- New setting `xessa.editor.formatOnSave` (boolean, **default false**) uses
  `workspace.onWillSaveTextDocument` to request the same edit before a manual or after-delay save;
  focus-out saves are skipped. Parse-error documents are saved byte-identical.
- `$keyframes.<name>` round-trips cleanly. A real compiler formatter bug was found for the other
  new syntax: `@use "…" as x styles;` loses the `styles` flag on format (semantics-changing). It is
  **reported as a blocker**, not fixed here, and pinned with an expected-failure test.
- Full gate green: `bun run verify` → **677 pass / 0 fail / 41 files**; extension suite
  **94 pass / 0 fail / 10 files** including the live extension-host run (VS Code 1.147.0).

Status: 🟢 extension feature complete · 🔴 compiler formatter blocker (`@use … styles`) outside this
task's scope.

## Changed files

| File | Change |
|---|---|
| `packages/vscode/src/formatting.ts` | **New.** Pure (`vscode`-free) `formatDocument(text, file)`: one full-document `{ range, newText }` only when canonical text differs and parsing produced no error. |
| `packages/vscode/src/providers/formatting.ts` | **New.** `XessaFormattingProvider` (`DocumentFormattingEditProvider`) plus shared `formattingEdits(document)` used by the save listener. |
| `packages/vscode/src/controller.ts` | Registers the formatting provider and `onWillSaveTextDocument`; reads `xessa.editor.formatOnSave`; skips focus-out saves; requests edits via `waitUntil`. (`src/extension.ts` remains the thin entry point that activates this controller, matching every other provider in the package.) |
| `packages/vscode/package.json` | Contributes `xessa.editor.formatOnSave` (boolean, default false). |
| `packages/vscode/test/suite.js` | Extension-host acceptance: manifest setting, Format Document, default-off save, enabled save, parse-error save. Resets the setting after the run. |
| `tests/extension/host.test.ts` | Always rebuilds `dist/extension.js` + `out/extension.js` before the host run so the suite cannot pass against a stale bundle. |
| `tests/extension/provider.formatting.test.ts` | **New.** 7 pure tests for the formatting decision. |
| `tests/extension/formatter.current-grammar.test.ts` | **New.** `$keyframes` round trip (passing) and `@use … styles` preservation (expected failure, blocker). |
| `docs/known-limitations.md` | Replaced only the "Editor formatting" row: document-level only; no range formatter or format-on-type. |

## Behavior and evidence

### Format Document (whole document)

- Pure test: `.a{color:red}` → exactly one edit with range `(0,0)…(0,15)` and
  `newText: ".a {\n  color: red;\n}\n"`; applying it and formatting again yields no edit
  (idempotent). Already-canonical and empty documents return no edit.
- Extension host: `vscode.executeFormatDocumentProvider` succeeded and applying its edits produced
  `.card {\n  color: red;\n}\n` in the live editor. VS Code normalizes the provider's single
  full-document replace into minimal insertion edits at the command boundary (5 edits observed);
  the provider contract itself is still one full-document `TextEdit` (asserted in the pure test).
- Parse error: `@md { … }` (top-level conditional, XESSA1001) returns the input byte-identical and
  no edit. Host run saves `/* keep */\n@md { … }` unchanged with format-on-save enabled.
- CRLF input becomes canonical LF layout in the single edit.

### Save path (`xessa.editor.formatOnSave`)

Host run (setting written to Global inside the isolated test profile and reset in `finally`):

1. Default `false`: dirty file `" .card{color:red}"` saves as `" .card{color:red}"` — untouched.
2. Enabled `true`: the same dirty document saves as `.card {\n  color: red;\n}\n` on disk and in
   the editor.
3. Enabled `true` + parse-error document: saved text equals the authored text exactly.

### Semicolonless declarations (formatter is authoritative)

- Plain-CSS final declaration `.a { color: red }` (ADR-0011 permits no `;`) prints canonically with
  `;`: `.a {\n  color: red;\n}\n`. This is intended canonical printer behavior, not a quick fix.
- Xessa declaration `padding: $gap` is `XESSA1002`; `format()` returns the document unchanged with
  the parse error, so `formatDocument` produces **no edit**. The formatter never silently repairs a
  missing Xessa semicolon; the "Add semicolon" quick fix remains the only editor repair path.
- Formatting is idempotent, so enabling both `xessa.editor.formatOnSave` and global
  `editor.formatOnSave` cannot insert a semicolon twice (XESSA1002 documents are never rewritten).

## Blocker — compiler formatter drops `@use … styles` (not fixed here)

- **Affected API/module:** `packages/compiler/src/formatter/index.ts`, `printUse`
  (`UseImport.styles` is ignored when printing).
- **Reproduction:** `format('@use "./motion.cssx" as m styles;', "src/motion.cssx")`.
- **Expected:** `@use "./motion.cssx" as m styles;` (ADR-0014 rule-merge import preserved).
- **Actual:** `@use "./motion.cssx" as m;` — the `styles` flag is silently dropped, changing
  compilation semantics (rules stop being merged). Formatting is still idempotent, so the loss is
  not self-correcting.
- **Scope:** the owning module is `packages/compiler/**`, which is HARD OFF-LIMITS for this task and
  owned by a running worker; per the task instruction the compiler was not touched.
- **Pinned test:** `tests/extension/formatter.current-grammar.test.ts` uses `test.failing` with the
  desired canonical output. It currently reports as a pass (expected failure); when the compiler fix
  lands the assertion starts passing, Bun then reports it as a failure — flip `test.failing` to
  `test` at that point.
- **Risk:** until fixed, running Format Document / format-on-save on a `styles` import degrades the
  file. `xessa.editor.formatOnSave` is off by default, but this should be fixed in the compiler
  before recommending the setting broadly.

`$keyframes.<name>` has no formatter defect: references are preserved verbatim and the keyframes
block is laid out canonically.

## Validation

| Command | Result |
|---|---|
| `bun test tests/extension` | 🟢 94 pass / 0 fail / 10 files (includes extension host 1.147.0) |
| `bun test tests/extension/provider.formatting.test.ts tests/extension/formatter.current-grammar.test.ts` | 🟢 9 pass / 0 fail / 25 expects |
| `bun run typecheck` | 🟢 (part of verify) |
| `bun run lint` | 🟢 (part of verify) |
| `bun run verify` | 🟢 677 pass / 0 fail / 41 files; no failures outside scope |

No fixed sleeps were added; the host assertions use `document.save()`/`applyEdit` completion. The
shared `tests/compiler/**` formatter tests and compiler fixtures were not modified.

## Handoff

Completed: provider, save setting/listener, tests, host acceptance, docs row, reports. Remaining:
compiler owner must preserve `UseImport.styles` in `printUse`; then enable the expected-failure test.
Touched files are listed above; no changes outside `packages/vscode/**`, `tests/extension/**`,
`docs/known-limitations.md` (one row), and the A22 task/report/log paths.
