# CSSX-BASIC-EXAMPLE — README aligned with the owner's source edits

**Status:** 🟢 PASS · **Worker:** `code` · **Date:** 2026-11-26
**Scope:** documentation only; `examples/basic/src/**` and `generated/**` untouched.
**Task:** `.ai/tasks/CSSX-BASIC-EXAMPLE.md`

## Handoff

- **Decision (owner, 2026-11-26):** keep the personal-test content in
  `examples/basic/src/button.cssx` and update the README instead of restoring the canonical file.
- **Provenance of the drift:** the source was edited during an earlier defaults/editor session (and
  was already reported as pre-existing drift in `.ai/reports/CSSX-DEFAULTS.md` and
  `.ai/reports/CSSX-FIX-INTEGRATION.md`). The committed `generated/` output was rebuilt from that
  edited source, so source and output are now consistent.
- **README:** the intro is now a feature tour on the canonical *layout* (no §2 / byte-for-byte
  claim); the figure list names `minify: false`, the pretty-printed stylesheet and the
  `button`/`icon`/`test` map; the bullets cover `@runtime` (prefixed custom property + dark
  override), the inert `@group.clr`, dropped empty `&:hover {}` / `&:focus {}`, the authored
  `@keyframes ss` with `$radius` substituted textually, and the `minify: false` opt-out linked to
  ADR-0022.
- **Other docs fixed:** `docs/grammar.md` "See also" and the `docs/usage.md` examples index no longer
  call `basic` the canonical stylesheet. Root `README.md` was checked and is accurate as written.
- **Hashes:** both rebuilds identical to the committed output —
  `11fe95fd…e7df4` (`button.css`), `82854edc…75cb96` (`button.map.js`).
- **Lint:** `bun run lint` → `biome check .` clean, 452 files.

## Output evidence

```text
$ shasum -a 256 examples/basic/generated/…
11fe95fd48158813372eec57d77e2eaf28d469d49fda9bf7da768216025e7df4  button.css
82854edcf6be06befd9bafe8b05a19be448dbe5c2db3292678451383d475cb96  button.map.js

$ node packages/cli/dist/index.js build   # run twice from examples/basic
wrote generated/styles/button.css
wrote generated/maps/button.map.js
xessa build: 2 entries, 2 files written, 0 warnings
# both runs sha256-identical to the committed files above
```

## Notes

- The generated CSS starts with `:root { --ui-colors: orange }` plus the `prefers-color-scheme:
  dark` override; `.ui-test:hover` / `.ui-test:focus` are absent, confirming empty nested rules are
  dropped; `@keyframes ss` emits `background-color: 8px` from `$radius`.
- The keyframe value is documented as an authored textual substitution, not validation, so future
  readers do not mistake it for a bug in the example.
