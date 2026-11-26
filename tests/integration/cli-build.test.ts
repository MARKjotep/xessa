/**
 * End-to-end CLI build/check/clean contract (CSSX-A11).
 *
 * These tests drive the real CLI process against copies of
 * `tests/fixtures/cli/basic`, so exit codes, artifact bytes, manifests and
 * write-safety are observed exactly as a build script would see them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type JsonCleanShape,
  type JsonReportShape,
  type ManifestShape,
  cleanup,
  createProject,
  createTempDirectory,
  exists,
  fixtures,
  parseJson,
  readText,
  runCli,
  writeText,
} from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

/** Permission-based atomicity proof cannot run as root (writes always succeed). */
const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

async function project(): Promise<string> {
  const directory = await createProject("basic");
  temporaryProjects.push(directory);
  return directory;
}

const EXPECTED_ARTIFACTS: ReadonlyArray<readonly [string, string]> = [
  ["generated/styles/button.css", "button.css"],
  ["generated/styles/card.css", "card.css"],
  ["generated/maps/button.map.js", "button.map.js"],
  ["generated/maps/card.map.js", "card.map.js"],
  ["generated/maps/button.map.d.ts", "button.map.d.ts"],
  ["generated/maps/card.map.d.ts", "card.map.d.ts"],
];

describe("xessa build", () => {
  test("writes byte-stable artifacts at the file-setup destinations", async () => {
    const root = await project();
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");

    for (const [artifact, golden] of EXPECTED_ARTIFACTS) {
      const written = await readText(join(root, artifact));
      const expected = await readText(join(fixtures, "basic/expected", golden));
      expect(written).not.toBeNull();
      expect(written).toBe(expected);
    }

    const buttonCss = await readText(join(root, "generated/styles/button.css"));
    expect(buttonCss).toContain(".ui-button");
    expect(buttonCss).toContain("@media (min-width: 768px)");
    expect(buttonCss).toContain(".ui-button > .ui-icon");
    expect(buttonCss).not.toContain(".app-button");

    const buttonMap = await readText(join(root, "generated/maps/button.map.js"));
    expect(buttonMap).not.toContain("import ");
    expect(buttonMap).toContain('export const button = "ui-button";');

    // Determinism: a second build produces identical bytes.
    const first = await readText(join(root, "generated/styles/button.css"));
    const again = runCli(["build"], root);
    expect(again.status).toBe(0);
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(first);
  });

  test("records every written artifact in the workspace manifest", async () => {
    const root = await project();
    expect(runCli(["build"], root).status).toBe(0);

    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.version).toBe(1);
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.map((file) => file.path).sort()).toEqual(
      EXPECTED_ARTIFACTS.map(([artifact]) => artifact).sort(),
    );
    for (const file of manifest.files) {
      expect(file.hash.startsWith("sha256:")).toBe(true);
      expect(file.source.startsWith("src/")).toBe(true);
    }
  });

  test("--json reports files, written flags and no diagnostics", async () => {
    const root = await project();
    const build = runCli(["build", "--json"], root);
    expect(build.status).toBe(0);

    const report = parseJson<JsonReportShape>(build.stdout);
    expect(report.command).toBe("build");
    expect(report.success).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.dryRun).toBe(false);
    expect(report.entries).toHaveLength(2);
    expect(report.diagnostics).toEqual([]);
    expect(report.errors).toEqual([]);

    for (const entry of report.entries) {
      expect(entry.outputs).toHaveLength(3);
      expect(entry.outputs.every((output) => output.written)).toBe(true);
      expect(entry.dependencies).toEqual(["src/tokens/theme.cssx"]);
    }
  });

  test("--dry-run lists planned files without writing", async () => {
    const root = await project();
    const build = runCli(["build", "--dry-run", "--json"], root);
    expect(build.status).toBe(0);

    const report = parseJson<JsonReportShape>(build.stdout);
    expect(report.dryRun).toBe(true);
    expect(report.entries.flatMap((entry) => entry.outputs)).toHaveLength(6);
    expect(
      report.entries.flatMap((entry) => entry.outputs).every((output) => !output.written),
    ).toBe(true);
    expect(await exists(join(root, "generated"))).toBe(false);
    expect(await exists(join(root, ".cssx-manifest.json"))).toBe(false);
  });

  test("a single-file build leaves other entries untouched", async () => {
    const root = await project();
    expect(runCli(["build"], root).status).toBe(0);
    const cardBefore = await readText(join(root, "generated/styles/card.css"));

    const single = runCli(["build", "src/button.cssx"], root);
    expect(single.status).toBe(0);

    for (const [artifact] of EXPECTED_ARTIFACTS) {
      expect(await exists(join(root, artifact))).toBe(true);
    }
    expect(await readText(join(root, "generated/styles/card.css"))).toBe(cardBefore);
    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files).toHaveLength(6);
  });

  test("--minify emits compact CSS and --no-minify wins when last", async () => {
    const root = await project();
    const minified = runCli(["build", "--minify"], root);
    expect(minified.status).toBe(0);
    const compact = await readText(join(root, "generated/styles/button.css"));
    expect(compact).not.toBeNull();
    expect(compact).toContain(".ui-button{display:flex;padding:12px;}");
    expect(compact).not.toContain("\n.ui-button {");

    const pretty = runCli(["build", "--minify", "--no-minify"], root);
    expect(pretty.status).toBe(0);
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(
      await readText(join(fixtures, "basic/expected/button.css")),
    );
  });

  test("a CLI minify flag overrides a file @setup minify with a warning", async () => {
    const root = await project();
    const buttonPath = join(root, "src/button.cssx");
    const original = (await readText(buttonPath)) ?? "";
    const marker = 'map-name: "button.map.js";';

    await writeFile(buttonPath, original.replace(marker, `${marker}\n  minify: false;`), "utf8");
    const forced = runCli(["build", "--minify"], root);
    expect(forced.status).toBe(0);
    expect(forced.stderr).toContain("setup minify false overridden by CLI flag (--minify)");
    const compact = await readText(join(root, "generated/styles/button.css"));
    expect(compact).toContain(".ui-button{display:flex;padding:12px;}");
    expect(compact?.includes("\n.ui-button {")).toBe(false);

    await writeFile(buttonPath, original.replace(marker, `${marker}\n  minify: true;`), "utf8");
    const expanded = runCli(["build", "--no-minify"], root);
    expect(expanded.status).toBe(0);
    expect(expanded.stderr).toContain("setup minify true overridden by CLI flag (--no-minify)");
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(
      await readText(join(fixtures, "basic/expected/button.css")),
    );
  });

  test("a compile error exits 1 and retains the last successful outputs", async () => {
    const root = await project();
    expect(runCli(["build"], root).status).toBe(0);

    const cssBefore = await readText(join(root, "generated/styles/button.css"));
    const manifestBefore = await readText(join(root, ".cssx-manifest.json"));
    const sourcePath = join(root, "src/button.cssx");
    const original = await readText(sourcePath);
    await writeFile(sourcePath, `${original ?? ""}\n.broken { color: $missing; }\n`, "utf8");

    const failed = runCli(["build"], root);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("XESSA2001");
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(cssBefore);
    expect(await readText(join(root, ".cssx-manifest.json"))).toBe(manifestBefore);
  });

  test.skipIf(runningAsRoot)(
    "a failing write leaves the previous artifact intact (per-file atomicity)",
    async () => {
      const root = await project();
      expect(runCli(["build"], root).status).toBe(0);

      const cssPath = join(root, "generated/styles/card.css");
      const cssBefore = await readText(cssPath);
      const stylesDir = join(root, "generated/styles");
      await chmod(stylesDir, 0o555);
      try {
        const failed = runCli(["build"], root);
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain("XESSACLI001");
        expect(await readText(cssPath)).toBe(cssBefore);
      } finally {
        await chmod(stylesDir, 0o755);
      }
    },
  );

  test("a deleted source has its obsolete owned outputs removed after a successful build", async () => {
    const root = await project();
    expect(runCli(["build"], root).status).toBe(0);

    await rm(join(root, "src/card.cssx"));
    const rebuild = runCli(["build"], root);
    expect(rebuild.status).toBe(0);

    expect(await exists(join(root, "generated/styles/card.css"))).toBe(false);
    expect(await exists(join(root, "generated/maps/card.map.js"))).toBe(false);
    expect(await exists(join(root, "generated/maps/button.map.js"))).toBe(true);

    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.every((file) => file.source === "src/button.cssx")).toBe(true);
  });
  test("project-level output directories mirror the source subdirectory", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({
        include: ["src/**/*.cssx"],
        output: { cssDir: "build/styles", mapDir: "build/maps" },
      }),
    );
    await writeText(join(root, "src/deep/widget.cssx"), ".widget { color: red @md blue; }\n");

    const build = runCli(["build"], root);
    expect(build.status).toBe(0);

    const cssPath = join(root, "build/styles/src/deep/widget.css");
    const mapPath = join(root, "build/maps/src/deep/widget.map.js");
    expect(await exists(cssPath)).toBe(true);
    expect(await exists(mapPath)).toBe(true);
    expect(await readText(cssPath)).toContain(".widget");
    // The map holds only bindings; it never imports the stylesheet.
    expect(await readText(mapPath)).not.toContain("import ");
  });

  test("two entries targeting one artifact fail with XESSA5001", async () => {
    const root = await createTempDirectory();
    temporaryProjects.push(root);
    await writeText(join(root, "xessa.config.json"), JSON.stringify({ include: ["src/*.cssx"] }));
    const setup = [
      "@setup {",
      '  css-dir: "../out";',
      '  css-name: "shared.css";',
      '  map-dir: "../out";',
      '  map-name: "shared.map.js";',
      "}",
    ].join("\n");
    await writeText(join(root, "src/a.cssx"), `${setup}\n.a { color: red; }\n`);
    await writeText(join(root, "src/b.cssx"), `${setup}\n.b { color: blue; }\n`);

    const build = runCli(["build"], root);
    expect(build.status).toBe(1);
    expect(build.stderr).toContain("XESSA5001");
    const css = await readText(join(root, "out/shared.css"));
    expect(css).toContain(".a");
    expect(css).not.toContain(".b");
  });
});

describe("xessa check", () => {
  test("reports a clean project without writing anything", async () => {
    const root = await project();
    const check = runCli(["check"], root);
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
    expect(check.stdout).toContain("0 errors");
    expect(await exists(join(root, "generated"))).toBe(false);
    expect(await exists(join(root, ".cssx-manifest.json"))).toBe(false);
  });

  test("exits 1 with positioned diagnostics and no writes", async () => {
    const root = await createProject("broken");
    temporaryProjects.push(root);

    const check = runCli(["check", "--json"], root);
    expect(check.status).toBe(1);

    const report = parseJson<JsonReportShape>(check.stdout);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.diagnostics).toHaveLength(1);

    const diagnostic = report.diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA2001");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.file).toBe("src/broken.cssx");
    expect(diagnostic?.line).toBe(2);
    expect(diagnostic?.column).toBe(10);

    expect(await exists(join(root, "src/broken.css"))).toBe(false);
    expect(await exists(join(root, ".cssx-manifest.json"))).toBe(false);
  });

  test("an importer with a missing $ member is XESSA2001 and exits 1", async () => {
    const root = await createTempDirectory("xessa-cli-import-");
    temporaryProjects.push(root);
    await writeText(join(root, "xessa.config.json"), JSON.stringify({ include: ["src/*.cssx"] }));
    await writeText(
      join(root, "src/tokens.cssx"),
      "@setup { module: true; }\n@variables { space: 8px; }\n",
    );
    await writeText(
      join(root, "src/main.cssx"),
      '@use "./tokens.cssx" as t;\n.x { padding: $t.missing; }\n',
    );

    const check = runCli(["check", "--json"], root);
    expect(check.status).toBe(1);

    const report = parseJson<JsonReportShape>(check.stdout);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    const diagnostic = report.diagnostics.find((entry) => entry.code === "XESSA2001");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.file).toBe("src/main.cssx");
    expect(diagnostic?.message).toContain("$t.missing");
    expect(await exists(join(root, "src/main.css"))).toBe(false);
    expect(await exists(join(root, ".cssx-manifest.json"))).toBe(false);
  });
});

describe("xessa clean", () => {
  test("removes only unmodified owned outputs and reports skipped files", async () => {
    const root = await project();
    expect(runCli(["build"], root).status).toBe(0);

    const editedPath = join(root, "generated/styles/card.css");
    await writeFile(editedPath, `${(await readText(editedPath)) ?? ""}/* hand edit */\n`, "utf8");

    const dryRun = runCli(["clean", "--dry-run", "--json"], root);
    expect(dryRun.status).toBe(0);
    const dryReport = parseJson<JsonCleanShape>(dryRun.stdout);
    expect(dryReport.removed).toHaveLength(5);
    expect(dryReport.skipped).toEqual([{ path: "generated/styles/card.css", reason: "modified" }]);
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(true);

    const clean = runCli(["clean", "--json"], root);
    expect(clean.status).toBe(0);
    const cleanReport = parseJson<JsonCleanShape>(clean.stdout);
    expect(cleanReport.removed).toHaveLength(5);
    expect(cleanReport.skipped.map((item) => item.path)).toEqual(["generated/styles/card.css"]);

    expect(await exists(join(root, "generated/styles/button.css"))).toBe(false);
    expect(await exists(join(root, "generated/maps/button.map.js"))).toBe(false);
    expect(await exists(editedPath)).toBe(true);

    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files).toEqual([]);
  });

  test("a clean with no manifest is a successful no-op", async () => {
    const root = await project();
    const clean = runCli(["clean"], root);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("0 files removed");
  });
});
