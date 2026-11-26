import { VIEWPORTS } from "../harness/scenarios";
import { expect, open, readStyle, skipBrowserIfMissing, test } from "./support";

skipBrowserIfMissing();

/**
 * Viewport cascade contracts at the exact default alias boundaries:
 * base below `md` 768, `md` from 768 through 1279, `xl` from 1280.
 */
test.describe("viewport cascade", () => {
  test("inline variants switch padding and font-size at exact md/xl boundaries", async ({
    page,
  }) => {
    const cases = [
      { width: 320, padding: "12px", fontSize: "14px" },
      { width: 767, padding: "12px", fontSize: "14px" },
      { width: 768, padding: "20px", fontSize: "16px" },
      { width: 1279, padding: "20px", fontSize: "16px" },
      { width: 1280, padding: "32px", fontSize: "16px" },
    ] as const;

    for (const entry of cases) {
      await open(page, "inline-variants", "pretty", { width: entry.width });
      const padding = await readStyle(page, "card", "padding-top");
      const fontSize = await readStyle(page, "card", "font-size");
      expect(padding, `padding at ${entry.width}px`).toBe(entry.padding);
      expect(fontSize, `font-size at ${entry.width}px`).toBe(entry.fontSize);
    }
  });

  test("block conditions use @md from 768 and the compact alias at 320", async ({ page }) => {
    const cases = [
      { width: 320, display: "flex", padding: "4px", gap: null },
      { width: 767, display: "block", padding: "8px", gap: null },
      { width: 768, display: "grid", padding: "8px", gap: "24px" },
      { width: 1279, display: "grid", padding: "8px", gap: "24px" },
      { width: 1280, display: "grid", padding: "8px", gap: "24px" },
    ] as const;

    for (const entry of cases) {
      await open(page, "block-conditions", "pretty", { width: entry.width });
      expect(await readStyle(page, "card", "display"), `display at ${entry.width}px`).toBe(
        entry.display,
      );
      expect(await readStyle(page, "card", "padding-top"), `padding at ${entry.width}px`).toBe(
        entry.padding,
      );
      if (entry.gap !== null) {
        expect(await readStyle(page, "card", "gap"), `gap at ${entry.width}px`).toBe(entry.gap);
      }
    }
  });

  test("nested child @lg width switches at 1024 across the required widths", async ({ page }) => {
    const cases = [
      { width: 320, widthValue: "16px" },
      { width: 767, widthValue: "16px" },
      { width: 768, widthValue: "16px" },
      { width: 1279, widthValue: "20px" },
      { width: 1280, widthValue: "20px" },
    ] as const;

    for (const entry of cases) {
      await open(page, "nesting", "pretty", { width: entry.width });
      expect(await readStyle(page, "card", "display")).toBe("flex");
      expect(await readStyle(page, "icon", "width"), `icon width at ${entry.width}px`).toBe(
        entry.widthValue,
      );
    }
  });

  test("all required viewports are present", () => {
    expect([...VIEWPORTS]).toEqual([320, 767, 768, 1279, 1280]);
  });
});
