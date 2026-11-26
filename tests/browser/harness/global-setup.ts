/**
 * Playwright global setup: compile every browser scenario before tests run.
 *
 * The compiler source uses TypeScript `.ts` modules with NodeNext `.js`
 * specifiers, so the build runs in a Bun subprocess (the project's supported
 * toolchain) rather than in Playwright's Node-side transform. This keeps the
 * harness on the public compiler API and avoids a hidden prebuild step.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalSetup(): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const buildScript = join(repoRoot, "tests", "browser", "harness", "build.ts");
  const manifest = join(repoRoot, "tests", "browser", "dist", "manifest.json");

  console.log("[browser-global-setup] compiling browser scenarios with the public compiler API");
  execFileSync("bun", [buildScript], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (!existsSync(manifest)) {
    throw new Error(`Browser harness build did not create ${manifest}.`);
  }
}
