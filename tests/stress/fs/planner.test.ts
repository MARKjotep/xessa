/**
 * TT3 · Output-planner safety (`.ai/plans/CSSX-PLAN-TESTING.md` §TT3 "Planner
 * safety").
 *
 * Cases: output directory == source directory, output inside `exclude`, an
 * artifact path colliding with an existing non-artifact file, a directory where
 * the artifact file should be, two entries planning the same target, and a
 * `css-name` that would overwrite the source itself.
 *
 * The read-only output directory row is **already covered** by
 * `tests/integration/cli-build.test.ts:209` (chmod 0555 → XESSACLI001, previous
 * artifact byte-identical) and is not duplicated here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildReport,
  cleanupProjects,
  createProject,
  diagnosticCodes,
  diagnosticMessages,
  listFiles,
  projectConfig,
  projectPathExists,
  readManifest,
  readProjectFile,
  runCli,
  simpleSource,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

describe("planner safety", () => {
  test("writes beside the source when the output directory is the source directory", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n  css-dir: ".";\n}\n${simpleSource("a")}`,
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    // `"."` is the documented default directory, so the artifact lands next to
    // its source and the manifest still owns it.
    expect(await projectPathExists(root, "src/a.css")).toBe(true);
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["src/a.css"]);

    // The generated `.css` never becomes a source, so a rebuild is stable and
    // does not feed back on itself.
    const first = await readProjectFile(root, "src/a.css");
    const again = buildReport([], root);
    expect(again.success).toBe(true);
    expect(again.entries.map((entry) => entry.file)).toEqual(["src/a.cssx"]);
    expect(await readProjectFile(root, "src/a.css")).toBe(first);
  }, 60_000);

  test("writes into an excluded directory without re-discovering the output", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n  css-dir: "../gen";\n  css-name: "a.css";\n}\n${simpleSource("a")}`,
    });
    await writeProjectJson(
      root,
      "xessa.config.json",
      projectConfig({ include: ["src/*.cssx"], exclude: ["gen"] }),
    );

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(await projectPathExists(root, "gen/a.css")).toBe(true);

    // A stray `.cssx` inside the excluded output directory is not a source.
    await writeProjectFile(root, "gen/stray.cssx", simpleSource("stray"));
    const again = buildReport([], root);
    expect(again.success).toBe(true);
    expect(again.entries.map((entry) => entry.file)).toEqual(["src/a.cssx"]);
    expect(await projectPathExists(root, "out/gen/stray.css")).toBe(false);
    expect(JSON.parse((await readProjectFile(root, ".cssx-manifest.json")) ?? "{}")).toMatchObject({
      version: 1,
    });
  }, 60_000);

  test("overwrites an existing non-artifact file and takes ownership of it", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n  css-dir: "../gen";\n  css-name: "a.css";\n}\n${simpleSource("a")}`,
      // A hand-written stylesheet already sitting at the planned destination.
      "gen/a.css": "/* hand written */\n.hand { color: hotpink; }\n",
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    // Documented limitation (docs/known-limitations.md:41): configured
    // destinations are explicit authorisation, so an unowned file is replaced
    // with no diagnostic.
    expect(report.warnings).toEqual([]);
    expect(await readProjectFile(root, "gen/a.css")).not.toContain("hand written");
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/a.css"]);

    // Ownership now includes the replaced file, so clean removes it.
    const clean = runCli(["clean", "--json"], root);
    expect(clean.status).toBe(0);
    expect(await projectPathExists(root, "gen/a.css")).toBe(false);
  }, 60_000);

  test("fails with XESSACLI001 when a directory occupies the artifact path", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n  css-dir: "../gen";\n  css-name: "a.css";\n}\n${simpleSource("a")}`,
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
    await mkdir(join(root, "gen/a.css"), { recursive: true });
    await writeProjectFile(root, "gen/a.css/keep.txt", "keep\n");

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(diagnosticCodes(report)).toEqual(["XESSACLI001"]);
    expect(diagnosticMessages(report).join("\n")).toContain("Failed to write gen/a.css");

    // The failed rename leaves the directory untouched and removes its own
    // temporary file (writer.ts:48-54).
    expect(listFiles(`${root}/gen`)).toEqual(["a.css/keep.txt"]);
    expect(await readProjectFile(root, "gen/a.css/keep.txt")).toBe("keep\n");
  }, 60_000);

  test("rejects two entries that plan the same target with XESSA5001", async () => {
    const setup = '  css-dir: "../gen";\n  css-name: "shared.css";\n';
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n${setup}}\n${simpleSource("a")}`,
      "src/b.cssx": `@setup {\n${setup}}\n${simpleSource("b")}`,
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    const collision = report.diagnostics.find((diagnostic) =>
      diagnostic.message.includes("collides with the already-planned target"),
    );
    expect(collision?.code).toBe("XESSA5001");
    expect(collision?.file).toBe("src/b.cssx");

    // The first entry still wrote its artifact exactly once; the loser wrote
    // nothing, so no torn or duplicated output survives.
    expect(listFiles(`${root}/gen`)).toEqual(["shared.css"]);
    expect(await readProjectFile(root, "gen/shared.css")).toContain("color:red");
  }, 60_000);

  test("rejects a css-name that would overwrite the source file", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": `@setup {\n  css-dir: ".";\n  css-name: "a.cssx";\n}\n${simpleSource("a")}`,
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(diagnosticCodes(report)).toEqual(["XESSA5001"]);
    expect(diagnosticMessages(report).join("\n")).toContain("must end in .css");
    // The source is untouched and no artifact was written.
    expect(await readProjectFile(root, "src/a.cssx")).toContain(".a {");
    expect(listFiles(`${root}/src`)).toEqual(["a.cssx"]);
  }, 60_000);
});
