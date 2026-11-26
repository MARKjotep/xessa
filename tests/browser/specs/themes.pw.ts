import { COLOR_SCHEMES, type ColorScheme, VIEWPORTS } from "../harness/scenarios";
import { expect, open, readComputed, readStyle, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

const WHITE = "rgb(255, 255, 255)";
const DARK_BACKGROUND = "rgb(24, 24, 24)";
const XL_DARK_BACKGROUND = "rgb(16, 16, 16)";

function expectedCombinedBackground(width: number, scheme: ColorScheme): string {
  if (scheme === "light") return WHITE;
  return width >= 1280 ? XL_DARK_BACKGROUND : DARK_BACKGROUND;
}

test.describe("color scheme and combined conditions", () => {
  test("@dark applies at every width; @xl+dark only at >=1280 AND dark", async ({ page }) => {
    for (const width of VIEWPORTS) {
      for (const scheme of COLOR_SCHEMES) {
        await open(page, "combined", "pretty", { width, scheme });
        const background = await readStyle(page, "card", "background-color");
        expect(background, `combined background at ${width}px in ${scheme}`).toBe(
          expectedCombinedBackground(width, scheme),
        );
      }
    }
  });

  test("runtime custom property flips color in light and dark", async ({ page }) => {
    const cases = [
      { scheme: "light", color: "rgb(37, 99, 235)", custom: "#2563eb" },
      { scheme: "dark", color: "rgb(96, 165, 250)", custom: "#60a5fa" },
    ] as const;

    for (const width of [320, 1280] as const) {
      for (const entry of cases) {
        await open(page, "runtime", "pretty", { width, scheme: entry.scheme });
        const values = await readComputed(
          page,
          "card",
          ["color", "background-color"],
          ["--ui-primary"],
        );
        expect(values.color, `runtime color at ${width}px in ${entry.scheme}`).toBe(entry.color);
        expect(values["background-color"]).toBe(WHITE);
        expect(values["--ui-primary"], `--ui-primary at ${width}px in ${entry.scheme}`).toBe(
          entry.custom,
        );

        const rootCustom = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ui-primary"),
        );
        expect(rootCustom, `root --ui-primary in ${entry.scheme}`).toBe(entry.custom);
      }
    }
  });
});
