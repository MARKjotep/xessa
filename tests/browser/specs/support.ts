/**
 * Shared Playwright fixtures and computed-style helpers.
 *
 * Every test gets a `page` that fails at teardown if the page logged a console
 * error, threw a page error, failed a request or returned an HTTP error. This
 * makes console/network cleanliness an invariant rather than a per-test
 * afterthought.
 */

import { existsSync } from "node:fs";
import {
  type BrowserType,
  type Page,
  test as base,
  chromium,
  expect,
  firefox,
  webkit,
} from "@playwright/test";
import type { BrowserScenario, ColorScheme, PageVariant } from "../harness/scenarios";

function browserInstalled(browser: BrowserType): boolean {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
}

/** Installed bundled engines, used by the config and for skip diagnostics. */
export const engineAvailability = {
  chromium: browserInstalled(chromium),
  firefox: browserInstalled(firefox),
  webkit: browserInstalled(webkit),
} as const;

export type EngineName = keyof typeof engineAvailability;

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      problems.push(`pageerror: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      problems.push(
        `requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        problems.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    await use(page);

    expect(problems, "expected no console errors or failed requests").toEqual([]);
  },
});

/**
 * Register a file-scoped skip when the project's browser binary is missing.
 *
 * Call this once at the top of every Playwright spec file. Registering the
 * skip in each file (rather than once in this shared module) keeps the
 * declaration file-scoped and prevents a missing download from being reported
 * as a launch failure.
 */
export function skipBrowserIfMissing(): void {
  test.skip(
    ({ browserName }) => !(engineAvailability[browserName as EngineName] ?? false),
    "browser binary is not installed; run `bunx playwright install <engine>`",
  );
}

export { expect };

export interface OpenOptions {
  readonly width: number;
  readonly scheme?: ColorScheme;
  readonly reducedMotion?: "no-preference" | "reduce";
}

/** Deterministic page URL for one scenario variant. */
export function pagePath(scenarioName: string, variant: PageVariant): string {
  const suffix =
    variant === "minified"
      ? ".min"
      : variant === "nogroup"
        ? ".nogroup"
        : variant === "merge"
          ? ".merge"
          : "";
  return `/pages/${scenarioName}${suffix}.html`;
}

/**
 * Set viewport/media emulation and navigate. `goto` waits for the load event,
 * which includes the linked stylesheet; no explicit sleeps are used.
 */
export async function open(
  page: Page,
  scenarioName: string,
  variant: PageVariant,
  options: OpenOptions,
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: 720 });
  await page.emulateMedia({
    colorScheme: options.scheme ?? "light",
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  await page.goto(pagePath(scenarioName, variant));
}

/** Read a set of computed properties (and custom properties) for one element. */
export async function readComputed(
  page: Page,
  testId: string,
  properties: readonly string[],
  customProperties: readonly string[] = [],
): Promise<Record<string, string>> {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expect(locator, `stable test id ${testId}`).toHaveCount(1);
  return locator.evaluate(
    (element, names) => {
      const style = window.getComputedStyle(element);
      const values: Record<string, string> = {};
      for (const property of names.properties) values[property] = style.getPropertyValue(property);
      for (const property of names.customProperties) {
        values[property] = style.getPropertyValue(property);
      }
      return values;
    },
    { properties, customProperties },
  );
}

/** Read one computed property for one element. */
export async function readStyle(page: Page, testId: string, property: string): Promise<string> {
  const values = await readComputed(page, testId, [property]);
  return values[property] ?? "";
}

/** Read every compared element/property of a scenario as a deep-comparable object. */
export async function readScenario(
  page: Page,
  scenario: BrowserScenario,
): Promise<Record<string, Record<string, string>>> {
  const values: Record<string, Record<string, string>> = {};
  for (const testId of scenario.testIds) {
    values[testId] = await readComputed(
      page,
      testId,
      scenario.compareProperties,
      scenario.compareCustomProperties ?? [],
    );
  }
  return values;
}
