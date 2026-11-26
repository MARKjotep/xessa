import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanup,
  createProject,
  createTempDirectory,
  parseJson,
  readText,
  runCli,
  writeText,
} from "./cli-helpers.ts";

/**
 * `xessa format` CLI contract: `--check` exit codes and write-nothing behavior,
 * in-place canonical writes, idempotence, safe parse-error fallback, and
 * compilation invariance (a formatted project builds byte-identical CSS).
 */

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

async function basicProject(): Promise<string> {
  const directory = await createProject("basic");
  temporaryProjects.push(directory);
  return directory;
}

describe("xessa format --check", () => {
  test("lists files that would change, writes nothing, and exits 1", async () => {
    const root = await basicProject();
    const before = await readText(join(root, "src/button.cssx"));
    expect(before).not.toBeNull();

    const result = runCli(["format", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("would be reformatted");
    expect(result.stdout).toContain("src/button.cssx");
    expect(await readText(join(root, "src/button.cssx"))).toBe(before);
  });

  test("--check is rejected for other commands with exit 2", async () => {
    const root = await basicProject();
    const result = runCli(["build", "--check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--check is only valid for xessa format");
  });

  test("--json reports changed paths and exit code", async () => {
    const root = await basicProject();
    const result = runCli(["format", "--check", "--json"], root);
    expect(result.status).toBe(1);
    const report = parseJson<{
      command: string;
      success: boolean;
      exitCode: number;
      check: boolean;
      changed: string[];
      diagnostics: unknown[];
      errors: string[];
    }>(result.stdout);
    expect(report.command).toBe("format");
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.check).toBe(true);
    expect(report.changed).toContain("src/card.cssx");
    expect(report.errors).toEqual([]);
  });
});

describe("xessa format in place", () => {
  test("writes canonical sources, then --check exits 0 and reruns are byte-stable", async () => {
    const root = await basicProject();

    const write = runCli(["format"], root);
    expect(write.status).toBe(0);
    expect(write.stdout).toContain("reformatted");

    const formatted = await readText(join(root, "src/card.cssx"));
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("@setup {");
    expect(formatted).toContain("\n\n@use");

    const check = runCli(["format", "--check"], root);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("already formatted");

    const again = runCli(["format"], root);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already formatted");
    expect(await readText(join(root, "src/card.cssx"))).toBe(formatted);
  });

  test("formatting does not change build output", async () => {
    const root = await basicProject();

    const firstBuild = runCli(["build"], root);
    expect(firstBuild.status).toBe(0);
    const beforeCss = await readText(join(root, "generated/styles/button.css"));
    const beforeCard = await readText(join(root, "generated/styles/card.css"));
    expect(beforeCss).not.toBeNull();

    expect(runCli(["format"], root).status).toBe(0);

    const secondBuild = runCli(["build"], root);
    expect(secondBuild.status).toBe(0);
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(beforeCss);
    expect(await readText(join(root, "generated/styles/card.css"))).toBe(beforeCard);
  });

  test("parse errors exit 1 and never rewrite the file", async () => {
    const root = await createTempDirectory("xessa-format-");
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      `${JSON.stringify({ include: ["src/**/*.cssx"] }, null, 2)}\n`,
    );
    const source = ".broken {\n  color: red;\n";
    await writeText(join(root, "src/broken.cssx"), source);

    const result = runCli(["format"], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not formatted because parsing reported errors");
    expect(await readText(join(root, "src/broken.cssx"))).toBe(source);
  });

  test("a missing file is an invocation error with exit 2", async () => {
    const root = await basicProject();
    const result = runCli(["format", "src/missing.cssx"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Source file not found");
  });
});
