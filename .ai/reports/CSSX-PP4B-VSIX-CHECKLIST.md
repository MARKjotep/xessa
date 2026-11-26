# CSSX PP4B — local VSIX testing checklist

**Status:** 🟡 in progress (owner testing, 2026-11-26)
**Board:** PP4b (Marketplace publication deferred)

Marketplace publication is deferred, so the local VSIX is the shipping candidate. Every check below
is run by the owner in a real VS Code window against the artifact in the table; record actual
results and evidence, and log any mismatch in the defect table at the end.

## Artifact under test

| Field             | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Path              | `packages/vscode/xessa-0.1.0.vsix`                                      |
| Size              | 143,940 B (140.57 KB)                                                   |
| Contents          | 18 files                                                                |
| SHA-256           | `1250d2028995a95610530dd45fd87b2672f13f13b61105d688cc875b70ee3c52`      |
| Extension version | `0.1.0`                                                                 |
| Source            | `HEAD 70485e8`                                                          |
| Bundled compiler  | built from the 0.1.1 sources (self-contained; no npm CLI or Bun needed) |

## Install

```sh
code --install-extension '/Users/Marky/Desktop/$/xessa/packages/vscode/xessa-0.1.0.vsix' --force
```

Then reload the window (Command Palette → **Developer: Reload Window**).

## Environment

- VS Code version: ______________________
- OS: ______________________
- Theme: ______________________ (Dark+ / Light+)
- Workspace folder: ______________________

## Checks

### 1. Language

- [x] Open a `.cssx` file: the language is reported as Xessa and the chick icon shows in the tab and
      the Explorer; directives, aliases (`@`), tokens (`$`), and selectors are highlighted and
      distinguishable — expected: all four categories are visually distinct on the current theme.
      `evidence:`

### 2. Diagnostics

- [x] Missing `;` before a nested `&:hover` in a rule — expected: `XESSA1002` on the offending line
      with the correct range, severity error. `evidence:`
- [x] Undefined `$missing` used in a declaration value — expected: `XESSA2001` naming `$missing`.
      `evidence:`
- [x] Fix each error and save — expected: the matching diagnostic clears on save, and reintroducing
      the error makes it appear again without reopening the file. `evidence:`

### 3. Completion

- [x] Trigger completion at a statement start — expected: the property list appears.
      `evidence:`
- [x] Trigger completion on a bare line directly above `&` — expected: the property list appears
      there too. `evidence:`
- [ ] Type `color:` — expected: value completions, including named and hex colours.
      `bug: only appears when manually typing the right after entering ":". but if from intellisense, it wouldnt popup the color. not big deal for now`
- [x] Type `#` in selector position — expected: id completions; type `#` in a colour value —
      expected: hex colour completions. `evidence:`
- [x] Type `(` in a value — expected: function completions. `evidence:`
- [x] Type `!` in a declaration — expected: `!important` suggested, and accepting it does not double
      the `!`. `evidence:`
- [ ] Type a digit in a value — expected: unit completions after the number. `bug: no auto suggestion of units`
- [x] Type `@` — expected: alias completions. `evidence:`
- [x] Type `$` — expected: token completions, including nested `$keyframes.` members.
      `evidence:`
- [x] Type `@group.` — expected: that group's property/parameter completions. `evidence:`
- [x] Trigger completion in setup position — expected: setup keys. `evidence:`

### 4. Hover

- [x] Hover a `$token` — expected: its resolved value and source location. `evidence:`
- [x] Hover a media alias — expected: the alias's resolved media query. `evidence:`
- [x] Hover a function — expected: usage signature plus a short example. `evidence:`
- [x] Hover an `@group` declaration — expected: defaults shown, with use-site overrides in a separate
      list. `evidence:`

### 5. Navigation

- [x] Go to definition / Find All References on an alias and on an unqualified import across two
      modules — expected: both resolve to the exporting file and location. `evidence:`
- [x] Rename a token, a class and an id within a single file — expected: all in-file occurrences
      update. `evidence:`
- [x] Attempt rename in the refusal cases (e.g. across files, or a non-renameable symbol) —
      expected: a clear refusal message and no partial edits. `evidence:`

### 6. Colours

- [ ] Inline colour swatches render on colour literals — expected: swatch matches the value.
      `evidence:`
- [ ] Use the native colour picker and confirm — expected: the document gets lowercase `#rrggbb`,
      with an alpha channel only when the alpha is not 1. `evidence:`
- [ ] Inspect semantic token colours in source on Dark+ and on Light+ — expected: tokens, aliases,
      variables and selectors stay readable and distinct on both themes. `evidence:`

### 7. Commands

- [ ] **Compile File** — expected: CSS generated for the active file with a success message.
      `evidence:`
- [ ] **Build Project** — expected: every entry compiles; each generated file is reported.
      `evidence:`
- [ ] **Check Project** — expected: diagnostics report without any file being written.
      `evidence:`
- [ ] **Preview Compiled CSS** — expected: the compiled preview opens and does not leave an empty tab
      behind. `evidence:`
- [ ] **Open Generated CSS** — expected: the generated CSS output for the current file opens.
      `evidence:`
- [ ] **Open Class Map** — expected: the class map opens and matches the compiled selectors.
      `evidence:`
- [ ] Status bar and output channel — expected: the status item reflects the build state and the
      output channel logs the run with no unhandled errors. `evidence:`

### 8. Formatting

- [ ] **Format Document** — expected: valid source is reformatted consistently. `evidence:`
- [ ] `xessa.editor.formatOnSave` is off by default — expected: saving does not reformat until the
      setting is enabled; after enabling, save reformats. `evidence:`
- [ ] Format a file containing a parse error — expected: the command refuses and the file content is
      unchanged (compare hash before/after). `evidence:`

### 9. Module refresh

- [ ] Rename a `$token` in `portfolio/src/tokens.cssx`, save, and watch an open importer — expected:
      the importer's diagnostics update without retyping or reopening the file. `evidence:`

### 10. Safety

- [ ] Compile-on-save is off by default — expected: saving alone writes no output. `evidence:`
- [ ] Compile-on-save is trusted-workspace only — expected: enabling it in an untrusted workspace
      does not write. `evidence:`
- [ ] Restricted Mode — expected: every writing command is blocked with a clear message.
      `evidence:`
- [ ] No watcher is started — expected: no file watcher is registered while the extension is idle
      (check the Extension Host / watcher listing). `evidence:`

## Use these workspaces

- `examples/portfolio` — modules, groups, keyframes, runtime tokens and theme control; covers most
  of checks 1–10.
- `examples/basic` — owner test content. Note that its `@keyframes ss` emits
  `background-color: 8px` because of textual `$radius` substitution; that is authored content,
  not an extension or compiler bug.

## Caveats

- The extension is `0.1.0`; Marketplace publication is deferred. This VSIX is the interim artifact.
- No npm CLI or Bun is required — the compiler is bundled. Do not install packages to run the checks.
- Compile-on-save is off by default; enable it only for check 8/10 deliberately.
- After packaging with `vsce`, `LICENSE` → `LICENSE.txt` and `README.md` → `readme.md` case renames
  are normal and expected.
- The VSIX still ships `.gitignore`, `scripts/write-entry.mjs` and unused `media/logo*`; trimming
  them is a PP4b follow-up, not a defect for this run.

## Defect log

| #   | Check | File:line | Expected | Actual | Xessa output | Board item |
| --- | ----- | --------- | -------- | ------ | ------------ | ---------- |
|     |       |           |          |        |              |            |

## Result

- Checks passed: ____ / ____
- Checks failed: ____
- Sign-off: ______________________ (owner, date)
