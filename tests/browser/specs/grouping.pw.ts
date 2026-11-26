import { COLOR_SCHEMES, SCENARIOS, VIEWPORTS } from "../harness/scenarios";
import { expect, open, readScenario, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

/**
 * ADR-0024: no grouping mode may change computed styles.
 * Each scenario is compiled with `mediaGrouping: "safe"` (the default),
 * `"none"` and the opt-in `"merge"` optimizer; the resulting pages must be
 * computed-style equal at every required viewport and color scheme. The
 * `block-conditions` scenario contains an actual cross-run merge opportunity.
 */
test.describe("grouping mode parity (safe, none, merge)", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: all grouping modes preserve computed styles`, async ({ page }) => {
      for (const width of VIEWPORTS) {
        for (const scheme of COLOR_SCHEMES) {
          await open(page, scenario.name, "pretty", { width, scheme });
          const safe = await readScenario(page, scenario);

          await open(page, scenario.name, "nogroup", { width, scheme });
          const ungrouped = await readScenario(page, scenario);

          expect(ungrouped, `${scenario.name} safe grouping at ${width}px in ${scheme}`).toEqual(
            safe,
          );

          await open(page, scenario.name, "merge", { width, scheme });
          const merged = await readScenario(page, scenario);

          expect(merged, `${scenario.name} merge grouping at ${width}px in ${scheme}`).toEqual(
            ungrouped,
          );
        }
      }
    });
  }
});
