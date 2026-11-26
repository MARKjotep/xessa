/**
 * CLI invocation and `xessa.config.json` validation (CSSX-A11, CSSX-DEFAULTS).
 *
 * Covers exit code 2 for invocation/configuration failures, the strict-by-default
 * unknown-key rule, optional configuration with the default include scope,
 * nearest-config resolution and the glob engine.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { expandBraces, isExcluded, matchesGlob } from "../../packages/cli/src/glob.ts";
import {
  type JsonReportShape,
  cleanup,
  createProject,
  createTempDirectory,
  exists,
  parseJson,
  readText,
  repoRoot,
  runCli,
  writeText,
} from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

async function project(fixture: string): Promise<string> {
  const directory = await createProject(fixture);
  temporaryProjects.push(directory);
  return directory;
}

describe("invocation errors", () => {
  test("an unknown flag exits 2", async () => {
    const root = await project("basic");
    const result = runCli(["build", "--wat"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown option "--wat"');
  });

  test("a missing command exits 2", async () => {
    const root = await project("basic");
    const result = runCli([], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Missing command");
  });

  test("an unknown command exits 2", async () => {
    const root = await project("basic");
    const result = runCli(["compile"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown command "compile"');
  });

  test("clean rejects a file argument", async () => {
    const root = await project("basic");
    const result = runCli(["clean", "src/button.cssx"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not take a file argument");
  });

  test("a missing source file exits 2", async () => {
    const root = await project("basic");
    const result = runCli(["build", "src/nope.cssx"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Source file not found");
  });

  test("an explicitly requested config that is missing exits 2", async () => {
    const root = await project("basic");
    const result = runCli(["check", "--config", "nope.json"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Configuration file not found");
  });

  test("--help and --version exit 0", async () => {
    const root = await project("basic");
    const help = runCli(["--help"], root);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("xessa build [file] [flags]");
    expect(help.stdout).toContain("Exit codes:");

    const version = runCli(["--version"], root);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("format --check lists files that would change and exits 1", async () => {
    const root = await project("basic");
    const result = runCli(["format", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("would be reformatted");
    expect(result.stdout).toContain("src/button.cssx");

    const json = runCli(["format", "--check", "--json"], root);
    expect(json.status).toBe(1);
    const report = parseJson<{
      command: string;
      success: boolean;
      exitCode: number;
      check: boolean;
      changed: string[];
    }>(json.stdout);
    expect(report.command).toBe("format");
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.check).toBe(true);
    expect(report.changed).toContain("src/button.cssx");
  });
});

describe("configuration validation", () => {
  test("strict mode rejects unknown keys with exit 2", async () => {
    const root = await project("config-unknown-key");
    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown configuration key "unknownTop" (strict mode).');
    expect(result.stderr).toContain('Unknown configuration key "output.wat" (strict mode).');
    expect(await exists(join(root, "out"))).toBe(false);
  });

  test("invalid JSON exits 2", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(join(root, "xessa.config.json"), '{ "include": [\n');
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["build"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid JSON");
  });

  test("a known key with the wrong type exits 2", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["src/*.cssx"], output: { minify: "yes" } }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"output.minify" must be a boolean.');
  });

  test("unknown keys are rejected by default without a compiler block", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["src/*.cssx"], mystery: true }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown configuration key "mystery" (strict mode).');
  });

  test("an explicit strict false keeps the warning path", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({
        include: ["src/*.cssx"],
        mystery: true,
        compiler: { strict: false },
      }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Ignoring unknown configuration key "mystery"');
  });

  test("compiler.mediaGrouping accepts merge and stays safe by default", async () => {
    const source = [
      ".a { @md { color: red; } }",
      ".b { padding: 1px; }",
      ".a { @md { color: blue; } }",
    ].join("\n");

    const mergeRoot = await createTempDirectory();
    temporaryProjects.push(mergeRoot);
    await writeText(
      join(mergeRoot, "xessa.config.json"),
      JSON.stringify({
        include: ["src/*.cssx"],
        output: { cssDir: "out", mapDir: "out" },
        compiler: { mediaGrouping: "merge" },
      }),
    );
    await writeText(join(mergeRoot, "src/entry.cssx"), source);
    expect(runCli(["build"], mergeRoot).status).toBe(0);
    const merged = await readText(join(mergeRoot, "out/src/entry.css"));
    expect((merged?.match(/@media/g) ?? []).length).toBe(1);

    const defaultRoot = await createTempDirectory();
    temporaryProjects.push(defaultRoot);
    await writeText(
      join(defaultRoot, "xessa.config.json"),
      JSON.stringify({
        include: ["src/*.cssx"],
        output: { cssDir: "out", mapDir: "out" },
      }),
    );
    await writeText(join(defaultRoot, "src/entry.cssx"), source);
    expect(runCli(["build"], defaultRoot).status).toBe(0);
    const safe = await readText(join(defaultRoot, "out/src/entry.css"));
    expect((safe?.match(/@media/g) ?? []).length).toBe(2);
  });

  test("file @setup media-grouping overrides project none", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({
        include: ["src/*.cssx"],
        output: { cssDir: "out", mapDir: "out" },
        compiler: { mediaGrouping: "none" },
      }),
    );
    await writeText(
      join(root, "src/entry.cssx"),
      [
        "@setup { media-grouping: merge; }",
        ".a { @md { color: red; } }",
        ".b { padding: 1px; }",
        ".a { @md { color: blue; } }",
      ].join("\n"),
    );
    expect(runCli(["build"], root).status).toBe(0);
    const css = await readText(join(root, "out/src/entry.css"));
    expect((css?.match(/@media/g) ?? []).length).toBe(1);
  });

  test("a config omitting include uses the default **/*.cssx globs", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ classes: { strategy: "prefix", prefix: "x" } }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");
    await writeText(join(root, "other/deep/extra.cssx"), ".extra { color: red; }\n");

    const result = runCli(["check", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<JsonReportShape>(result.stdout);
    expect(report.entries.map((entry) => entry.file)).toEqual([
      "other/deep/extra.cssx",
      "src/ok.cssx",
    ]);
  });

  test("a project build without any config discovers **/*.cssx", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(join(root, "package.json"), '{\n  "private": true\n}\n');
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");
    await writeText(join(root, "src/deep/extra.cssx"), ".extra { color: red; }\n");

    const result = runCli(["build", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<JsonReportShape>(result.stdout);
    expect(report.configFile).toBeNull();
    expect(report.workspaceRoot).toBe(await realpath(root));
    expect(report.entries.map((entry) => entry.file)).toEqual([
      "src/deep/extra.cssx",
      "src/ok.cssx",
    ]);
    expect(await exists(join(root, "src/ok.css"))).toBe(true);
    expect(await exists(join(root, "src/deep/extra.css"))).toBe(true);
  });

  test("a config-less project with no .cssx sources still exits 2", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(join(root, "package.json"), '{\n  "private": true\n}\n');
    const result = runCli(["build"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: No .cssx sources matched the project include globs.\n");
  });

  test("config-less examples discover from their own package.json boundary", async () => {
    for (const example of [
      "basic",
      "responsive",
      "variables",
      "jsx",
      "custom-output",
      "portfolio",
      "modules",
    ]) {
      const root = join(repoRoot, "examples", example);
      const result = runCli(["check", "--json"], root);
      expect(result.status).toBe(0);
      const report = parseJson<JsonReportShape>(result.stdout);
      expect(report.workspaceRoot).toBe(root);
      expect(report.configFile).toBeNull();
      expect(report.entries.length).toBeGreaterThan(0);
      expect(report.entries.every((entry) => entry.file.startsWith("src/"))).toBe(true);
    }
  });

  test("--json keeps invocation failures machine-readable", async () => {
    const root = await project("basic");
    const result = runCli(["build", "--config", "nope.json", "--json"], root);
    expect(result.status).toBe(2);
    const report = parseJson<{
      command: string;
      success: boolean;
      exitCode: number;
      error: string;
    }>(result.stdout);
    expect(report.command).toBe("build");
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(2);
    expect(report.error).toContain("Configuration file not found");
  });
});

describe("nearest configuration", () => {
  test("a file argument walks up from the file to the project config", async () => {
    const root = await project("basic");
    const result = runCli(["build", "button.cssx"], join(root, "src"));
    expect(result.status).toBe(0);
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(true);

    const manifest = parseJson<{ files: Array<{ path: string }> }>(
      await readText(join(root, ".cssx-manifest.json")),
    );
    expect(manifest.files.map((file) => file.path)).toContain("generated/styles/button.css");
  });

  test("an explicit --config selects a project outside the working directory", async () => {
    const root = await project("basic");
    const elsewhere = await createTempDirectory();
    temporaryProjects.push(elsewhere);

    const result = runCli(
      ["check", "--config", join(root, "xessa.config.json"), "--json"],
      elsewhere,
    );
    expect(result.status).toBe(0);
    const report = parseJson<JsonReportShape>(result.stdout);
    expect(report.workspaceRoot).toBe(root);
    expect(report.entries).toHaveLength(2);
    expect(await exists(join(elsewhere, "generated"))).toBe(false);
  });
});

describe("glob engine", () => {
  test("** matches zero or more path segments", () => {
    expect(matchesGlob("src/a.cssx", "src/**/*.cssx")).toBe(true);
    expect(matchesGlob("src/deep/nested/a.cssx", "src/**/*.cssx")).toBe(true);
    expect(matchesGlob("other/a.cssx", "src/**/*.cssx")).toBe(false);
    expect(matchesGlob("a.cssx", "**/*.cssx")).toBe(true);
  });

  test("* and ? stay within one segment", () => {
    expect(matchesGlob("src/button.cssx", "src/*.cssx")).toBe(true);
    expect(matchesGlob("src/deep/button.cssx", "src/*.cssx")).toBe(false);
    expect(matchesGlob("src/ab.cssx", "src/a?.cssx")).toBe(true);
    expect(matchesGlob("src/abc.cssx", "src/a?.cssx")).toBe(false);
  });

  test("{a,b} alternation expands, including nesting", () => {
    expect(matchesGlob("src/a.cssx", "src/{a,b}.cssx")).toBe(true);
    expect(matchesGlob("src/b.cssx", "src/{a,b}.cssx")).toBe(true);
    expect(matchesGlob("src/c.cssx", "src/{a,b}.cssx")).toBe(false);
    expect(expandBraces("x{1,2}y")).toEqual(["x1y", "x2y"]);
    expect(expandBraces("{a,{b,c}}")).toEqual(["a", "b", "c"]);
  });

  test("exclude patterns match directories and ancestors", () => {
    expect(isExcluded("node_modules/pkg/a.cssx", ["node_modules"])).toBe(true);
    expect(isExcluded("src/dist/a.cssx", ["dist"])).toBe(true);
    expect(isExcluded("src/tokens/theme.cssx", ["src/tokens"])).toBe(true);
    expect(isExcluded("src/button.cssx", ["src/tokens"])).toBe(false);
    expect(isExcluded("src/button.cssx", [])).toBe(false);
  });

  test("discovery excludes token directories from project entries", async () => {
    const root = await project("basic");
    const result = runCli(["check", "--json"], root);
    const report = parseJson<JsonReportShape>(result.stdout);
    expect(report.entries.map((entry) => entry.file)).toEqual(["src/button.cssx", "src/card.cssx"]);
  });
});
