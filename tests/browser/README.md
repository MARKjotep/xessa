# Xessa browser cascade gate

Playwright verifies the cascade contract in real engines: exact viewport
boundaries, light/dark, reduced motion, hover/focus/disabled, combined
conditions, specificity, runtime custom properties, safe grouping and
pretty-vs-minified computed-style equality.

## Run

```sh
bunx playwright install chromium   # firefox/webkit optional; config auto-detects them
bun run test:browser               # == playwright test
```

If a browser binary is missing, its project is omitted (or its tests are skipped
with a reason). Chromium is the required engine.

## Layout

```text
playwright.config.ts            repository-root config (Playwright discovers it here)
tests/browser/
  harness/
    scenarios.ts                inline Xessa sources + HTML fragments (test data)
    build.ts                    compiles scenarios through the public compiler API
    global-setup.ts             runs build.ts before the suite
  server.ts                     zero-dependency static server for dist/
  specs/*.pw.ts                 Playwright specs (named *.pw.ts so `bun test` ignores them)
  dist/                         generated CSS/pages/manifest (gitignored)
```

`tests/browser/harness/build.ts` imports `compile` from
`packages/compiler/src/index.ts`, the public `@xessa/compiler` barrel source.
The package `exports` entry points at the unbuilt `dist/`, so the browser
harness deliberately imports the source barrel and documents that path. No
CSS is hand-written: every stylesheet comes from `compile()`.

## Coverage

| Scenario | Contract |
|---|---|
| `inline-variants` | base / `@md` / `@xl` padding and font-size at 320/767/768/1279/1280 |
| `block-conditions` | rule-scoped `@md` plus a `@media-types` `compact` max-width alias |
| `specificity` | `.card.card` beats `.card`; later duplicate declarations win |
| `combined` | `@dark` every width; `@xl+dark` only at ≥1280 AND dark |
| `runtime` | `--ui-primary` flips light/dark and drives `color: var(--ui-primary)` |
| `states` | nested `&:hover`, `&:focus`, `&:disabled` opacity rules |
| `reduced` | `@reduced` gates transition and animation |
| `nesting` | `& > .icon` with `@lg` width |
| `groups` | `@group.<name>` D1–D5 in `specs/groups.pw.ts`: override wins at 320/767/768/1279/1280, a base override beats an `@md` default at every width (by design), `@dark`/`@reduced` keep un-overridden defaults, a group `!important` survives a plain override, pretty/minify and safe/`none` grouping agree |

Every page is checked for console errors, page errors, failed requests and
HTTP ≥400 responses by the shared `page` fixture in `specs/support.ts`.
