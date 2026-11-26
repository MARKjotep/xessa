/**
 * CLI end-to-end coverage for the module-side `map-inherit` opt-out (ADR-0020).
 *
 * The compiler pipeline is unit-tested in `tests/compiler/modules.test.ts`;
 * this suite proves that `xessa.config.json` `output.mapInherit` reaches the
 * compiler project layer (and that strict mode accepts the key) while a
 * module's authored `map-inherit` still wins.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanup, createTempDirectory, readText, runCli, writeText } from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

const ENTRY = '@setup { prefix: "app"; }\n@use "./card.cssx" styles;\n.page { color: red; }\n';
const MODULE = '@setup { prefix: "ui"; }\n.card { color: blue; }\n';

async function project(config: unknown, module = MODULE): Promise<string> {
  const root = await createTempDirectory("xessa-map-inherit-");
  temporaryProjects.push(root);
  await writeText(join(root, "xessa.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  await writeText(join(root, "src/entry.cssx"), ENTRY);
  await writeText(join(root, "src/card.cssx"), module);
  return root;
}

function config(output: Record<string, unknown>, strict = false): unknown {
  return {
    include: ["src/**/*.cssx"],
    output,
    ...(strict ? { compiler: { strict: true } } : {}),
  };
}

describe("xessa build output.mapInherit", () => {
  test("project false drops the module binding from the importer only", async () => {
    const root = await project(config({ mapInherit: false }));
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");

    expect(await readText(join(root, "src/entry.map.js"))).toBe(
      'export const page = "app-page";\n',
    );
    expect(await readText(join(root, "src/entry.css"))).toBe(
      ".ui-card{color:blue;}.app-page{color:red;}",
    );
    // The module's own entry build keeps its full map.
    expect(await readText(join(root, "src/card.map.js"))).toBe('export const card = "ui-card";\n');
  });

  test("strict mode accepts output.mapInherit as a known key", async () => {
    const root = await project(config({ mapInherit: false }, true));
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");
    expect(await readText(join(root, "src/entry.map.js"))).toBe(
      'export const page = "app-page";\n',
    );
  });

  test("an authored module value overrides the project default", async () => {
    const root = await project(
      config({ mapInherit: false }),
      '@setup { prefix: "ui"; map-inherit: true; }\n.card { color: blue; }\n',
    );
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(await readText(join(root, "src/entry.map.js"))).toBe(
      ['export const card = "ui-card";', 'export const page = "app-page";', ""].join("\n"),
    );
  });

  test("a module-authored false wins over a project true", async () => {
    const root = await project(
      config({ mapInherit: true }),
      '@setup { prefix: "ui"; map-inherit: false; }\n.card { color: blue; }\n',
    );
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(await readText(join(root, "src/entry.map.js"))).toBe(
      'export const page = "app-page";\n',
    );
  });
});
