import { COLOR_SCHEMES, VIEWPORTS, scenario } from "../harness/scenarios";
import {
  expect,
  open,
  readComputed,
  readScenario,
  readStyle,
  skipBrowserIfMissing,
  test,
} from "./support";

skipBrowserIfMissing();

const WHITE = "rgb(255, 255, 255)";
const DARK_BACKGROUND = "rgb(24, 24, 24)";
const NAVY = "rgb(0, 0, 128)";
const TILE_COLOR = "rgb(1, 2, 3)";
const BLACK = "rgb(0, 0, 0)";

/**
 * `@group` cascade contracts (ADR-0017 item 3, plan §8 D1–D5).
 *
 * The `groups` scenario splices a group whose defaults include an `@md`
 * variant, a `@dark`/`@reduced` variant and an `!important` line into three
 * use sites. Expansion is a plain splice, so every observable result here is
 * ordinary cascade behaviour and must stay pinned: the "fixes" the D2/D4 cases
 * forbid would turn a red gate into a compiler bug.
 */
test.describe("group cascade", () => {
  test("D1: the use-site override wins at every pinned breakpoint", async ({ page }) => {
    for (const width of VIEWPORTS) {
      await open(page, "groups", "pretty", { width });
      const values = await readComputed(page, "panel", ["color", "border-radius"]);
      // Both properties are width-independent, so the override must hold at
      // every boundary even though the group's `@md`/`@dark` blocks exist.
      expect(values.color, `panel color at ${width}px`).toBe(NAVY);
      expect(values["border-radius"], `panel border-radius at ${width}px`).toBe("0px");

      // The second use site of the same group gets its own override; dropping
      // either expansion would leave this at the group default `black`.
      expect(await readStyle(page, "tile", "color"), `tile color at ${width}px`).toBe(TILE_COLOR);
    }
  });

  test("D2: a use-site base declaration beats an @md variant default at all widths", async ({
    page,
  }) => {
    // `.panel` declares `padding: 20px` at the use site *after* the group's
    // `12px @md 24px` default; §5.2 "later base declaration wins" BY DESIGN
    // means 20px at every width, including >= 768. `.tile` omits the override
    // and proves the default variant still switches at 768.
    const cases = [
      { width: 320, panel: "20px", tile: "12px" },
      { width: 767, panel: "20px", tile: "12px" },
      { width: 768, panel: "20px", tile: "24px" },
      { width: 1279, panel: "20px", tile: "24px" },
      { width: 1280, panel: "20px", tile: "24px" },
    ] as const;

    for (const entry of cases) {
      await open(page, "groups", "pretty", { width: entry.width });
      expect(
        await readStyle(page, "panel", "padding-top"),
        `panel padding at ${entry.width}px`,
      ).toBe(entry.panel);
      expect(await readStyle(page, "tile", "padding-top"), `tile padding at ${entry.width}px`).toBe(
        entry.tile,
      );
    }
  });

  test("D3: non-overridden properties keep the group value under @dark and reduced motion", async ({
    page,
  }) => {
    for (const width of [320, 1280] as const) {
      for (const scheme of COLOR_SCHEMES) {
        await open(page, "groups", "pretty", { width, scheme });
        const values = await readComputed(page, "panel", [
          "background-color",
          "color",
          "padding-top",
        ]);
        expect(values["background-color"], `panel background at ${width}px in ${scheme}`).toBe(
          scheme === "light" ? WHITE : DARK_BACKGROUND,
        );
        // The override and the group default both survive the condition blocks.
        expect(values.color, `panel color at ${width}px in ${scheme}`).toBe(NAVY);
        expect(values["padding-top"], `panel padding at ${width}px in ${scheme}`).toBe("20px");
      }

      await open(page, "groups", "pretty", { width, reducedMotion: "no-preference" });
      expect(
        await readStyle(page, "panel", "transition-duration"),
        `transition-duration at ${width}px without reduced motion`,
      ).toBe("0.12s");

      await open(page, "groups", "pretty", { width, reducedMotion: "reduce" });
      expect(
        await readStyle(page, "panel", "transition-duration"),
        `transition-duration at ${width}px with reduced motion`,
      ).toBe("0s");
      expect(await readStyle(page, "panel", "color")).toBe(NAVY);
    }
  });

  test("D4: an !important group default is not overridden by a plain declaration", async ({
    page,
  }) => {
    for (const width of VIEWPORTS) {
      await open(page, "groups", "pretty", { width });
      // `.panel` authors a plain `display: block` after the group's
      // `display: flex !important`; !important binds per value segment
      // (ADR-0003), so flex still computes. `.tile` omits the plain line and
      // must reach the same value from the group default alone.
      expect(await readStyle(page, "panel", "display"), `panel display at ${width}px`).toBe("flex");
      expect(await readStyle(page, "tile", "display"), `tile display at ${width}px`).toBe("flex");
    }
  });

  test("D5: pretty, minified and ungrouped pages compute identically for expanded rules", async ({
    page,
  }) => {
    const groups = scenario("groups");

    for (const width of [320, 1280] as const) {
      for (const scheme of COLOR_SCHEMES) {
        await open(page, "groups", "pretty", { width, scheme });
        const pretty = await readScenario(page, groups);

        await open(page, "groups", "minified", { width, scheme });
        expect(
          await readScenario(page, groups),
          `groups minified at ${width}px in ${scheme}`,
        ).toEqual(pretty);

        await open(page, "groups", "nogroup", { width, scheme });
        expect(
          await readScenario(page, groups),
          `groups mediaGrouping "none" at ${width}px in ${scheme}`,
        ).toEqual(pretty);
      }
    }

    // Two `.badge` rules expand the base-only `chip` group independently and
    // `groupRuns("safe")` merges the identical runs. `margin-top` comes only
    // from the first use site and `border-radius: 0` only from the second, so
    // both expansions stay observable in the merged rule; the remaining values
    // are the group defaults.
    await open(page, "groups", "pretty", { width: 1280 });
    const badge = await readComputed(page, "badge", [
      "padding-top",
      "border-radius",
      "color",
      "margin-top",
    ]);
    expect(badge).toEqual({
      "padding-top": "6px",
      "border-radius": "0px",
      color: BLACK,
      "margin-top": "2px",
    });
  });
});
