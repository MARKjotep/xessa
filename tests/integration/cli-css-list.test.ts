/**
 * End-to-end `css-dir` list behaviour (CSSX-F18, ADR-0019).
 *
 * The real CLI process builds a project whose entry writes the same stylesheet
 * (and source map) to two in-workspace directories. The manifest must record
 * every destination, `clean` must remove all of them and `--json` must report
 * each written path.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type JsonCleanShape,
  type JsonReportShape,
  type ManifestShape,
  cleanup,
  createTempDirectory,
  exists,
  parseJson,
  readText,
  runCli,
  writeText,
} from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

const SETUP = [
  "@setup {",
  '  prefix: "ui";',
  '  css-dir: "../client", "../src";',
  '  css-name: "app.css";',
  '  map-dir: "../maps";',
  '  map-name: "app.map.js";',
  "  source-map: true;",
  "}",
].join("\n");

async function listProject(): Promise<string> {
  const root = await createTempDirectory("xessa-css-list-");
  temporaryProjects.push(root);
  await writeText(
    join(root, "xessa.config.json"),
    `${JSON.stringify({ include: ["src/*.cssx"], compiler: { strict: true } }, null, 2)}\n`,
  );
  await writeText(
    join(root, "src/app.cssx"),
    `${SETUP}\n.app {\n  color: red;\n  padding: 8px;\n}\n`,
  );
  return root;
}

const WRITTEN = [
  "client/app.css",
  "client/app.css.map",
  "maps/app.map.js",
  "src/app.css",
  "src/app.css.map",
];

describe("xessa build with a css-dir list", () => {
  test("writes the stylesheet and source map to every destination", async () => {
    const root = await listProject();
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");

    const client = await readText(join(root, "client/app.css"));
    const src = await readText(join(root, "src/app.css"));
    expect(client).not.toBeNull();
    expect(src).not.toBeNull();
    expect(client).toBe(src);
    expect(client).toContain(".ui-app");
    expect(client).toContain("/*# sourceMappingURL=app.css.map */");
    expect(await exists(join(root, "client/app.css.map"))).toBe(true);
    expect(await exists(join(root, "src/app.css.map"))).toBe(true);
    // map-dir stays single-valued.
    expect(await exists(join(root, "maps/app.map.js"))).toBe(true);
  });

  test("records every destination in the manifest and --json reports each path", async () => {
    const root = await listProject();
    const build = runCli(["build", "--json"], root);
    expect(build.status).toBe(0);

    const report = parseJson<JsonReportShape>(build.stdout);
    expect(report.success).toBe(true);
    expect(report.entries).toHaveLength(1);
    const outputs = report.entries[0]?.outputs ?? [];
    expect(outputs.map((output) => output.path).sort()).toEqual(WRITTEN);
    expect(outputs.every((output) => output.written)).toBe(true);

    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files.map((file) => file.path).sort()).toEqual(WRITTEN);
    expect(manifest.files.every((file) => file.source === "src/app.cssx")).toBe(true);
  });

  test("clean removes every recorded destination", async () => {
    const root = await listProject();
    expect(runCli(["build"], root).status).toBe(0);

    const clean = runCli(["clean", "--json"], root);
    expect(clean.status).toBe(0);
    const report = parseJson<JsonCleanShape>(clean.stdout);
    expect(report.removed.map((item) => item.path).sort()).toEqual(WRITTEN);

    for (const path of WRITTEN) expect(await exists(join(root, path))).toBe(false);
    const manifest = parseJson<ManifestShape>(await readText(join(root, ".cssx-manifest.json")));
    expect(manifest.files).toEqual([]);
  });

  test("duplicate list items exit 1 with XESSA2001 and write nothing", async () => {
    const root = await createTempDirectory("xessa-css-list-dup-");
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      `${JSON.stringify({ include: ["src/*.cssx"] }, null, 2)}\n`,
    );
    await writeText(
      join(root, "src/app.cssx"),
      '@setup { css-dir: "../client", "../client"; }\n.app { color: red; }\n',
    );

    const build = runCli(["build"], root);
    expect(build.status).toBe(1);
    expect(build.stderr).toContain("XESSA2001");
    expect(await exists(join(root, "client/app.css"))).toBe(false);
    const manifest = await readText(join(root, ".cssx-manifest.json"));
    expect(manifest === null ? [] : parseJson<ManifestShape>(manifest).files).toEqual([]);
  });

  test("an external list item is rejected with XESSA5001 and writes nothing", async () => {
    const root = await createTempDirectory("xessa-css-list-out-");
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      `${JSON.stringify({ include: ["src/*.cssx"] }, null, 2)}\n`,
    );
    await writeText(
      join(root, "src/app.cssx"),
      '@setup { css-dir: "../client", "../../outside"; }\n.app { color: red; }\n',
    );

    const build = runCli(["build"], root);
    expect(build.status).toBe(1);
    expect(build.stderr).toContain("XESSA5001");
    expect(await exists(join(root, "client/app.css"))).toBe(false);
    const manifest = await readText(join(root, ".cssx-manifest.json"));
    expect(manifest === null ? [] : parseJson<ManifestShape>(manifest).files).toEqual([]);
  });
});
