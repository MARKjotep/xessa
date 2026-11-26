# CSSX-BROWSER-01 — Browser verification infrastructure (P2/7)

## Summary

- Set up Playwright in the repo (`@playwright/test` as a root devDependency) and create the browser test infrastructure under `tests/browser/`.
- Build a harness that compiles xessa fixture sources to real CSS with the public compiler API and loads them in generated HTML pages.
- Author computed-style specs per masterplan §9: viewports 320/767/768/1279/1280, light/dark, reduced motion, hover/focus/disabled, combined conditions, overlapping selectors/specificity, and pretty-vs-minified computed equality. Run Chromium; report engine availability.

**Status:** implemented; `bun run test:browser` green on Chromium, Firefox and WebKit (75 passed,
25 per engine). Awaiting lead verification. `.ai/PROGRESS.md` untouched; no `packages/**`,
`tests/fixtures/**`, other tests, docs or verify scripts changed.

## Installed tooling and engines

| Item | Version / path |
|---|---|
| `@playwright/test` | `1.65.1` (root devDependency; `bun.lock` resolved) |
| Playwright CLI | `1.65.1` |
| Chromium | Chrome for Testing `159.0.8154.6`, build `chromium-1255` |
| Chromium Headless Shell | `159.0.8154.6`, build `chromium_headless_shell-1255` |
| Firefox | `159.0`, build `firefox-1572` |
| WebKit | `27.2`, build `webkit-2388` |
| FFmpeg | build `ffmpeg-1013` |

`bunx playwright install chromium`, `bunx playwright install firefox webkit` and
`bunx playwright install --dry-run` all exited 0. The binaries were already present in the
Playwright cache, so the install commands produced no download output. All three engines ran the
suite; no engine was skipped or unavailable.

## Created / modified files

| File | Contents |
|---|---|
| `package.json` | Added `@playwright/test` to devDependencies and `"test:browser": "playwright test"`; nothing else. |
| `bun.lock` | Resolved `@playwright/test@1.65.1`, `playwright@1.65.1`, `playwright-core@1.65.1`. |
| `playwright.config.ts` | Root config: `testDir: tests/browser/specs`, `testMatch: "**/*.pw.ts"`, Chromium always, Firefox/WebKit only when installed, `workers: 1`, `fullyParallel: false`, `retries: 0`, list reporter, `webServer`, `globalSetup`. |
| `tests/browser/harness/scenarios.ts` | Inline Xessa sources, HTML fragments with class placeholders, viewport/scheme lists and computed-property compare sets. |
| `tests/browser/harness/build.ts` | Compiles each scenario with the public `compile` API into pretty, minified and ungrouped CSS; renders pretty/minified/ungrouped pages; writes `dist/manifest.json`; fails on diagnostics or empty output. |
| `tests/browser/harness/global-setup.ts` | Runs the Bun build subprocess before tests. |
| `tests/browser/server.ts` | Zero-dependency static server for `dist/` with explicit MIME types, `/health` and no-store caching. |
| `tests/browser/specs/support.ts` | Shared `page` fixture (console/pageerror/requestfailed/HTTP≥400 assertions), engine availability, `open`, computed-style readers, per-file missing-browser skip. |
| `tests/browser/specs/cascade.pw.ts` | Viewport boundary specs. |
| `tests/browser/specs/themes.pw.ts` | Light/dark, combined `@xl+dark`, runtime custom property. |
| `tests/browser/specs/interactions.pw.ts` | Reduced motion, hover/focus/disabled. |
| `tests/browser/specs/specificity.pw.ts` | `.card.card` vs `.card` and duplicate declarations. |
| `tests/browser/specs/parity.pw.ts` | Pretty vs minified deep computed-style equality for every scenario. |
| `tests/browser/specs/grouping.pw.ts` | Safe grouping vs `mediaGrouping: "none"` deep computed-style equality (masterplan §9 extra). |
| `tests/browser/README.md` | Run/layout/coverage notes. |
| `tests/browser/.gitignore` | `dist/`, `test-results/`, `playwright-report/`. |
| `.ai/tasks/CSSX-BROWSER-01.md`, `.ai/reports/CSSX-BROWSER-01.md`, `.ai/reports/logs/CSSX-BROWSER-01.log` | Task, report, worker log. |

No framework bug/feature record applies: this is application test infrastructure, not a framework
defect or feature request.

## Harness design

- **Compiler import path:** `tests/browser/harness/build.ts` imports
  `compile` from `packages/compiler/src/index.ts` — the public `@xessa/compiler` barrel source. The
  package `exports` field points at the unbuilt `dist/index.js`, so importing source is the documented
  approach for this build-time step. Only `compile` is used; no internal module is imported.
- **Build step:** Playwright `globalSetup` runs `bun tests/browser/harness/build.ts` in a subprocess.
  The compiler source uses `.ts` modules with `.js` specifiers; Bun is the project-supported runtime
  for that import graph. The build removes and regenerates `tests/browser/dist/`.
- **Artifacts per scenario:** `<name>.css` (pretty, safe grouping), `<name>.min.css` (minified),
  `<name>.nogroup.css` (`mediaGrouping: "none"`), plus matching pages. The class map comes from the
  compiler and fills `{{card}}` / `{{icon}}` placeholders, so the HTML never guesses emitted names.
- **No hand-written CSS:** HTML pages contain only a `<link rel="stylesheet">` to compiled CSS. There
  are no `<style>` blocks or inline `style` attributes.
- **Server:** `tests/browser/server.ts` serves `dist/` on `127.0.0.1:4319`; Playwright's `webServer`
  polls `/health`. The server is stateless and reads files per request, so build/serve order cannot
  deadlock.
- **Determinism:** no sleeps; `page.goto` waits for load (including CSS), and assertions use
  Playwright auto-waiting / `expect.poll`. One worker, no retries, no parallel tests.

### Spec filename note (`*.pw.ts`)

Bun's test runner discovers `*.spec.ts`. Naming Playwright files `*.spec.ts` under `tests/` makes
`bun test` execute them and fail (Playwright's `test.skip` is not valid in Bun's runner). The specs
therefore use `*.pw.ts` with `testMatch: "**/*.pw.ts"`; `bun test` stays clean and the Playwright
suite remains fully discovered. This is the only filename deviation from the task text.

### Config location note

Playwright discovers `playwright.config.ts` only from the invocation directory, and the required
script is exactly `playwright test`; the config therefore lives at the repo root. This is the only
new root file besides the permitted `package.json` change and the dependency-resolved `bun.lock`.

## Scenario coverage

| Scenario | Source contract | Browser assertions |
|---|---|---|
| `inline-variants` | `padding: 12px @md 20px @xl 32px;` + `font-size: 14px @md 16px;` | padding 12/12/20/20/32 and font-size 14/14/16/16/16 at 320/767/768/1279/1280. |
| `block-conditions` | `@md { display: grid; gap: 24px; }` + `@media-types { compact: (max-width: 500px); }` | 320: flex/4px; 767: block/8px; 768/1279/1280: grid/8px/24px gap. |
| `specificity` | `.card`, `.card.card`, later `.card`; duplicate `margin-top` | padding 20px (`.card.card` beats later 30px `.card`), margin-top 7px (later wins), color `rgb(4, 5, 6)` (later wins). |
| `combined` | `background: white @dark #181818 @xl+dark #101010;` | Light: white at all 5 widths. Dark: `#181818` below 1280, `#101010` at 1280. |
| `runtime` | `@setup prefix ui`; `@runtime { primary: #2563eb @dark #60a5fa; }`; `color: $primary` | Color `rgb(37, 99, 235)` / `rgb(96, 165, 250)`; `--ui-primary` `#2563eb` / `#60a5fa` on the element and root. |
| `states` | Nested `&:hover` / `&:focus` / `&:disabled` opacity rules | Base 1; hover 0.85 via `page.hover`; focus 0.7 via `page.focus`; disabled 0.5 via `disabled` attribute; cursor `not-allowed`. |
| `reduced` | `transition` + `animation` gated by `@reduced` | No-preference: `0.12s` / `opacity` / `pulse`; reduce: `0s` / `none` / `none`. |
| `nesting` | `& > .icon { width: 16px @lg 20px; }` | Icon width 16/16/16/20/20 at 320/767/768/1279/1280; parent display flex. |

Pretty/minified parity and safe/ungrouped parity compare a broad curated set per element:
display, position, box-sizing, color, background-color, font-size/family/weight/line-height,
padding/margin longhands, width, height, gap, cursor, transition duration/property, animation
name/duration, plus `--ui-primary` for runtime and `opacity` for the static states scenario.
Opacity is excluded for `reduced` because the animation is time-dependent.

## Actual results

### Browser suite

Command: `bun run test:browser` (exact script `playwright test`)

```text
Running 75 tests using 1 worker
...
75 passed (1.2m)
```

Per engine: Chromium 25 passed, Firefox 25 passed, WebKit 25 passed. A separate Chromium-only run,
`bunx playwright test --project=chromium`, reported `25 passed (16.4s)`.

Breakdown per engine:

| Spec | Tests |
|---|---|
| `cascade.pw.ts` | 4 |
| `themes.pw.ts` | 2 |
| `interactions.pw.ts` | 2 |
| `specificity.pw.ts` | 1 |
| `parity.pw.ts` | 8 (one per scenario) |
| `grouping.pw.ts` | 8 (one per scenario) |
| **Total** | **25 per engine / 75 total** |

### Cleanliness

The shared `page` fixture attaches `console`, `pageerror`, `requestfailed` and `response` listeners
before navigation and asserts an empty problem list at teardown. Every one of the 75 tests passed, so
every page load in the suite had no console errors, no page errors, no failed requests and no
HTTP ≥400 responses. Pages use `<link rel="icon" href="data:,">` to avoid a favicon 404.

### Missing-browser fallback (validated)

Simulated with `PLAYWRIGHT_BROWSERS_PATH=<empty dir> bunx playwright test --project=chromium`:
`25 skipped` (no launch failures), using the per-file `skipBrowserIfMissing()` reason
"browser binary is not installed; run `bunx playwright install <engine>`". Normal runs with
installed binaries execute the tests.

### Adjacent gates run

| Command | Result |
|---|---|
| `bun test` | 440 pass, 0 fail (21 → 22 files as concurrent work landed). |
| `bun run typecheck` | exit 0. |
| `bunx biome check playwright.config.ts tests/browser` | clean. |
| `bun run lint` (repo-wide) | red on `packages/cli/**`, `tests/integration/cli-*.test.ts` and `tests/fixtures/cli/config-invalid-json/xessa.config.json` — concurrent A11 work outside this task's scope; no browser/root-config findings. |

## Limitations / blockers

- **No browser-install blocker:** all three bundled engines are installed and ran.
- **Repo-wide lint is currently red outside this task:** the failures are in concurrent A11 CLI
  files/fixtures, not in `tests/browser/**` or `playwright.config.ts`. This task did not modify
  `packages/**` or those tests. Lead should re-run `bun run verify` after A11 lands.
- **Port 4319:** the static server uses a fixed localhost port. If occupied, Playwright's
  `reuseExistingServer` behavior or the process owner must be checked. No conflict occurred here.
- **Root config:** required by Playwright's discovery and the exact `playwright test` script; noted
  as the only root addition besides `package.json`/`bun.lock`.

## Handoff

Completed state: Playwright installed, harness compiles 8 scenarios through the public compiler API,
24 CSS artifacts and 24 pages generated, 75/75 browser tests pass on Chromium/Firefox/WebKit, and
`bun test` / `bun run typecheck` pass. Remaining lead action: independently run
`bun run test:browser` and the full `bun run verify` after concurrent A11 lint fixes; then flip
progress statuses. Touched files are listed above; no `packages/**` or `tests/fixtures/**` changes
from this task.
