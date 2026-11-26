/**
 * Playwright configuration for the xessa cascade browser gate.
 *
 * The required npm script is exactly `playwright test`, so this file lives at
 * the repository root where Playwright discovers it. Scenario compilation and
 * page generation happen in `globalSetup`; the static server serves
 * `tests/browser/dist`.
 */

import { existsSync } from "node:fs";
import {
  type BrowserType,
  type Project,
  chromium,
  defineConfig,
  devices,
  firefox,
  webkit,
} from "@playwright/test";

function installed(browser: BrowserType): boolean {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
}

const projects: Project[] = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
];

// Only add engines whose bundled binary is actually installed. Chromium is
// always listed so an absent binary reports a clear skip instead of silently
// reducing coverage.
if (installed(firefox)) {
  projects.push({ name: "firefox", use: { ...devices["Desktop Firefox"] } });
}
if (installed(webkit)) {
  projects.push({ name: "webkit", use: { ...devices["Desktop Safari"] } });
}

export default defineConfig({
  testDir: "./tests/browser/specs",
  // Playwright specs use `*.pw.ts` rather than `*.spec.ts` so Bun's own test
  // discovery (`bun test` matches `*.spec.ts`) never tries to execute them.
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // Kept under the already-ignored `dist/` tree so Playwright's `.last-run.json`
  // never becomes a lint target after a browser run.
  outputDir: "./tests/browser/dist/test-results",
  globalSetup: "./tests/browser/harness/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4319",
    colorScheme: "light",
    reducedMotion: "no-preference",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "bun tests/browser/server.ts",
    url: "http://127.0.0.1:4319/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects,
});
