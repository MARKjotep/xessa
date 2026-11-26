import { COLOR_SCHEMES, SCENARIOS, VIEWPORTS } from "../harness/scenarios";
import { expect, open, readScenario, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

/**
 * Minification must preserve computed styles. For every
 * scenario, the pretty and minified pages are loaded at all required viewports
 * and both color schemes; a broad curated computed-style set (including the
 * runtime custom property) must be deep-equal.
 */
test.describe("pretty vs minified computed-style parity", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: pretty and minified pages are computed-style equal`, async ({
      page,
    }) => {
      for (const width of VIEWPORTS) {
        for (const scheme of COLOR_SCHEMES) {
          await open(page, scenario.name, "pretty", { width, scheme });
          const pretty = await readScenario(page, scenario);

          await open(page, scenario.name, "minified", { width, scheme });
          const minified = await readScenario(page, scenario);

          expect(minified, `${scenario.name} computed styles at ${width}px in ${scheme}`).toEqual(
            pretty,
          );
        }
      }
    });
  }
});
