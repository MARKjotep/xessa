/**
 * Extension-host smoke test orchestrator.
 *
 * Runs `@vscode/test-electron` against a cached VS Code build when one exists
 * (or when `XESSA_EXTENSION_HOST_DOWNLOAD=1` allows a one-off download). When
 * neither is available the suite is skipped with the exact reason: the provider
 * unit tests (`provider*.test.ts`) remain the gate in that case, and this file
 * never fakes a pass.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const EXTENSION_ROOT = join(REPO_ROOT, "packages", "vscode");
// Kept under node_modules so Biome (a read-only root config for this task) does
// not scan the ~375 MB VS Code test build.
const CACHE_PATH = join(REPO_ROOT, "node_modules", ".vscode-test-xessa");
const MANIFEST = join(EXTENSION_ROOT, "package.json");

interface TestElectron {
  runTests(options: {
    readonly extensionDevelopmentPath: string;
    readonly extensionTestsPath: string;
    readonly launchArgs?: readonly string[];
    readonly vscodeExecutablePath?: string;
    readonly version?: string;
    readonly cachePath?: string;
  }): Promise<number>;
}

function loadTestElectron(): TestElectron | undefined {
  try {
    const requireFromExtension = createRequire(MANIFEST);
    return requireFromExtension("@vscode/test-electron") as TestElectron;
  } catch {
    return undefined;
  }
}

/** Launcher paths for a downloaded VS Code directory (1.147 renamed Electron → Code). */
function executableCandidates(directory: string): readonly string[] {
  return [
    join(directory, "Visual Studio Code.app", "Contents", "MacOS", "Electron"),
    join(directory, "Visual Studio Code.app", "Contents", "MacOS", "Code"),
    join(directory, "code"),
    join(directory, "Code.exe"),
    join(directory, "bin", "code-server"),
  ];
}

function cachedExecutable(
  testElectron: TestElectron,
): { executable: string; version: string } | undefined {
  if (!existsSync(CACHE_PATH)) return undefined;
  const pattern = /^vscode-(?<platform>[a-z0-9-]+)-(?<version>[0-9.]+)$/;
  for (const entry of readdirSync(CACHE_PATH)) {
    const match = pattern.exec(entry);
    if (match?.groups === undefined) continue;
    const directory = join(CACHE_PATH, entry);
    try {
      const executable = executableCandidates(directory).find((candidate) => existsSync(candidate));
      if (executable !== undefined) {
        return { executable, version: match.groups.version ?? "stable" };
      }
    } catch {
      // Ignore incomplete cache entries and keep looking.
    }
  }
  return undefined;
}

function ensureBuild(): void {
  // Rebuild unconditionally: a stale `dist/extension.js` would let the host
  // suite pass against code that no longer exists in the working tree now that
  // the suite exercises formatting and save behaviour added after A20.
  // tsc is typecheck-only for the extension; the loadable bundle is produced by
  // Bun. Under `bun test`, process.execPath is the Bun binary.
  const build = spawnSync(
    process.execPath,
    [
      "build",
      "src/extension.ts",
      "--outdir",
      "dist",
      "--external",
      "vscode",
      "--format",
      "cjs",
      "--target",
      "node",
    ],
    { cwd: EXTENSION_ROOT, stdio: "inherit" },
  );
  expect(build.status).toBe(0);
  const entry = spawnSync(process.execPath, ["scripts/write-entry.mjs"], {
    cwd: EXTENSION_ROOT,
    stdio: "inherit",
  });
  expect(entry.status).toBe(0);
}

const testElectron = loadTestElectron();
const cached = testElectron === undefined ? undefined : cachedExecutable(testElectron);
const allowDownload = process.env.XESSA_EXTENSION_HOST_DOWNLOAD === "1";
const runnable = testElectron !== undefined && (cached !== undefined || allowDownload);

const skipReason =
  testElectron === undefined
    ? "@vscode/test-electron is not installed (bun install did not provide it)"
    : cached === undefined
      ? `no cached VS Code test build in ${CACHE_PATH}; run "XESSA_EXTENSION_HOST_DOWNLOAD=1 bun test tests/extension/host.test.ts" once (network download, ~120 MB)`
      : "";

if (!runnable) {
  describe.skip(`extension host smoke (skipped: ${skipReason})`, () => {
    test("extension host", () => undefined);
  });
} else {
  test("extension host activates providers and commands", { timeout: 300_000 }, async () => {
    ensureBuild();
    const electron = testElectron as TestElectron;
    const code = await electron.runTests({
      extensionDevelopmentPath: EXTENSION_ROOT,
      extensionTestsPath: join(EXTENSION_ROOT, "test", "suite.js"),
      launchArgs: [
        join(EXTENSION_ROOT, "test", "fixtures"),
        "--disable-extensions",
        "--skip-welcome",
        "--skip-release-notes",
        // Keep profile state inside the ignored cache (not the repo root).
        `--user-data-dir=${join(CACHE_PATH, "user-data")}`,
        `--extensions-dir=${join(CACHE_PATH, "extensions")}`,
      ],
      ...(cached === undefined
        ? { version: "stable", cachePath: CACHE_PATH }
        : { vscodeExecutablePath: cached.executable }),
    });
    expect(code).toBe(0);
  });
}

// Surface the cache decision in the test output for the report.
test("host test environment summary", () => {
  console.log(
    `[xessa host] test-electron=${testElectron === undefined ? "missing" : "installed"} cached=${
      cached === undefined ? "none" : cached.version
    } runnable=${runnable}`,
  );
  expect(true).toBe(true);
});
