import { expect, open, readStyle, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

test.describe("media and interaction states", () => {
  test("reduced motion gates the transition and animation", async ({ page }) => {
    for (const width of [320, 1280] as const) {
      await open(page, "reduced", "pretty", { width, reducedMotion: "no-preference" });
      expect(await readStyle(page, "card", "transition-duration")).toBe("0.12s");
      expect(await readStyle(page, "card", "transition-property")).toBe("opacity");
      expect(await readStyle(page, "card", "animation-name")).toBe("pulse");

      await open(page, "reduced", "pretty", { width, reducedMotion: "reduce" });
      expect(await readStyle(page, "card", "transition-duration")).toBe("0s");
      expect(await readStyle(page, "card", "transition-property")).toBe("none");
      expect(await readStyle(page, "card", "animation-name")).toBe("none");
    }
  });

  test("hover, focus, disabled and attribute states change per the cascade", async ({ page }) => {
    await open(page, "states", "pretty", { width: 1280 });

    // The base button carries `data-state="open"`, so the nested attribute rule
    // `.card[data-state="open"]` (compiled from `&[data-state="open"]`) must win
    // over the UA button background. The class prefix is outside the brackets.
    expect(await readStyle(page, "state-base", "background-color")).toBe("rgb(10, 20, 30)");
    expect(await readStyle(page, "state-base", "opacity")).toBe("1");

    await page.locator('[data-testid="state-hover"]').hover();
    await expect
      .poll(() => readStyle(page, "state-hover", "opacity"), {
        message: "hover opacity",
      })
      .toBe("0.85");

    await page.locator('[data-testid="state-focus"]').focus();
    await expect
      .poll(() => readStyle(page, "state-focus", "opacity"), {
        message: "focus opacity",
      })
      .toBe("0.7");

    await page.locator('[data-testid="state-disabled"]').evaluate((element) => {
      (element as HTMLButtonElement).disabled = true;
    });
    await expect
      .poll(() => readStyle(page, "state-disabled", "opacity"), {
        message: "disabled opacity",
      })
      .toBe("0.5");
    expect(await readStyle(page, "state-disabled", "cursor")).toBe("not-allowed");
  });
});
