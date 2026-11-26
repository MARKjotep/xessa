import { VIEWPORTS } from "../harness/scenarios";
import { expect, open, readStyle, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

test.describe("specificity and duplicate declarations", () => {
  test(".card.card wins over .card and later duplicate declarations win", async ({ page }) => {
    for (const width of VIEWPORTS) {
      await open(page, "specificity", "pretty", { width });

      // `.card.card` (0,2,0) declares 20px; the later `.card` (0,1,0) declares
      // 30px. Specificity, not source order, decides the result.
      expect(await readStyle(page, "card", "padding-top"), `padding at ${width}px`).toBe("20px");

      // Two margin-top declarations in the same rule: the later one wins.
      expect(await readStyle(page, "card", "margin-top")).toBe("7px");

      // `color` is declared in the first and last `.card` rules; the later wins.
      expect(await readStyle(page, "card", "color")).toBe("rgb(4, 5, 6)");
    }
  });
});
