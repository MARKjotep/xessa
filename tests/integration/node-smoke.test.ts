/**
 * Node.js compatibility smoke test (CSSX-A11, ADR-0008).
 *
 * Builds the compiler and CLI `dist` with their package `tsc` build scripts,
 * verifies the compiler's public `main`/`exports` point at the built output, and
 * runs the compiled CLI under plain `node` (never Bun) for build, check and
 * clean.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type JsonCleanShape,
  type JsonReportShape,
  type ManifestShape,
  cleanup,
  createProject,
  exists,
  parseJson,
  readText,
  repoRoot,
  runNodeCli,
  writeText,
} from "./cli-helpers.ts";

const tsc = join(repoRoot, "node_modules/.bin/tsc");
const compilerDist = join(repoRoot, "packages/compiler/dist/index.js");
const nodeAvailable = spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;

const temporaryProjects: string[] = [];

beforeAll(() => {
  const projects = ["packages/compiler", "packages/cli"];
  for (const project of projects) {
    const built = spawnSync(tsc, ["-p", join(repoRoot, project, "tsconfig.json")], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 180_000,
    });
    if (built.status !== 0) {
      throw new Error(
        `tsc build failed for ${project} (status ${built.status ?? -1}):\n${built.stdout ?? ""}\n${built.stderr ?? ""}`,
      );
    }
  }
}, 240_000);

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

describe("compiler dist", () => {
  test("main and exports point at the built dist entry", async () => {
    const manifest = parseJson<{
      main?: string;
      types?: string;
      exports?: Record<string, { types?: string; import?: string; default?: string }>;
    }>(await readText(join(repoRoot, "packages/compiler/package.json")));

    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports?.["."]?.import).toBe("./dist/index.js");
    expect(manifest.exports?.["."]?.default).toBe("./dist/index.js");
    expect(manifest.exports?.["."]?.types).toBe("./dist/index.d.ts");

    expect(await exists(compilerDist)).toBe(true);
    expect(await exists(join(repoRoot, "packages/compiler/dist/index.d.ts"))).toBe(true);
  });

  test.skipIf(!nodeAvailable)(
    "plain node is at least version 20 and imports the public API",
    () => {
      const version = spawnSync("node", ["--version"], { encoding: "utf8" });
      const major = Number.parseInt(
        (version.stdout ?? "").replace(/^v/, "").split(".")[0] ?? "0",
        10,
      );
      expect(major).toBeGreaterThanOrEqual(20);

      const entry = pathToFileURL(compilerDist).href;
      const script = `const m = await import(${JSON.stringify(entry)});
const required = ["compile", "compileProject", "planOutputs", "createNodeHost", "parse"];
const missing = required.filter((key) => typeof m[key] !== "function");
if (missing.length > 0) { console.error("missing", missing); process.exit(4); }`;

      const result = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    },
  );
});

describe.skipIf(!nodeAvailable)("compiled CLI under plain node", () => {
  test("builds, checks and cleans a project", async () => {
    const root = await createProject("basic");
    temporaryProjects.push(root);

    const build = runNodeCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(true);
    expect(await exists(join(root, "generated/maps/card.map.js"))).toBe(true);
    expect(await exists(join(root, "generated/maps/button.map.d.ts"))).toBe(true);

    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files).toHaveLength(6);

    const check = runNodeCli(["check", "--json"], root);
    expect(check.status).toBe(0);
    expect(parseJson<JsonReportShape>(check.stdout).diagnostics).toEqual([]);

    await writeText(join(root, "src/broken.cssx"), ".broken { color: $missing; }\n");
    const failed = runNodeCli(["check"], root);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("XESSA2001");

    const clean = runNodeCli(["clean", "--json"], root);
    expect(clean.status).toBe(0);
    const cleanReport = parseJson<JsonCleanShape>(clean.stdout);
    expect(cleanReport.removed).toHaveLength(6);
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(false);
  }, 120_000);

  test("single-file build and --json work under plain node", async () => {
    const root = await createProject("basic");
    temporaryProjects.push(root);

    const build = runNodeCli(["build", "src/card.cssx", "--json"], root);
    expect(build.status).toBe(0);
    const report = parseJson<JsonReportShape>(build.stdout);
    expect(report.success).toBe(true);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.file).toBe("src/card.cssx");
    expect(report.entries[0]?.outputs.every((output) => output.written)).toBe(true);
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(false);
  }, 120_000);
});
