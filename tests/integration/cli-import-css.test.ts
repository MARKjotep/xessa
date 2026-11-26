/**
 * CLI end-to-end coverage for the opt-in class-map CSS import (ADR-0021, F21).
 *
 * The compiler pipeline is unit-tested in `tests/compiler/import-css.test.ts`;
 * this suite proves `xessa.config.json` `output.importCss` reaches the compiler
 * project layer and that the written `map.js` starts with the stylesheet import
 * (first `css-dir` list destination, no import when CSS is suppressed).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanup, createTempDirectory, readText, runCli, writeText } from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

const SOURCE = '@setup { prefix: "ui"; }\n.button { color: red; }\n';

async function project(
  config: unknown,
  source = SOURCE,
  file = "src/button.cssx",
): Promise<string> {
  const root = await createTempDirectory("xessa-import-css-");
  temporaryProjects.push(root);
  await writeText(join(root, "xessa.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  await writeText(join(root, file), source);
  return root;
}

function config(output: Record<string, unknown>, strict = false): unknown {
  return {
    include: ["src/**/*.cssx"],
    output,
    ...(strict ? { compiler: { strict: true } } : {}),
  };
}

describe("xessa build output.importCss", () => {
  test("project true writes the side-effect import at the top of the map", async () => {
    const root = await project(config({ importCss: true }));
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");

    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'import "./button.css";\nexport const button = "ui-button";\n',
    );
  });

  test("strict mode accepts output.importCss as a known key", async () => {
    const root = await project(config({ importCss: true }, true));
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");
    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'import "./button.css";\nexport const button = "ui-button";\n',
    );
  });

  test("default off writes the plain map", async () => {
    const root = await project(config({}));
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'export const button = "ui-button";\n',
    );
  });

  test("a file import-css: false overrides a project true", async () => {
    const root = await project(
      config({ importCss: true }),
      '@setup { prefix: "ui"; import-css: false; }\n.button { color: red; }\n',
    );
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'export const button = "ui-button";\n',
    );
  });

  test("a css-dir list imports the first listed destination", async () => {
    const root = await project(
      config({ importCss: true }),
      '@setup { prefix: "ui"; css-dir: "../client", "../src/generated"; }\n.button { color: red; }\n',
    );
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(build.stderr).toBe("");

    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'import "../client/button.css";\nexport const button = "ui-button";\n',
    );
    expect(await readText(join(root, "client/button.css"))).toBe(".ui-button{color:red;}");
    expect(await readText(join(root, "src/generated/button.css"))).toBe(".ui-button{color:red;}");
  });

  test("emit-css: false writes no import and no stylesheet", async () => {
    const root = await project(
      config({ importCss: true }),
      '@setup { prefix: "ui"; emit-css: false; }\n.button { color: red; }\n',
    );
    const build = runCli(["build"], root);
    expect(build.status).toBe(0);
    expect(await readText(join(root, "src/button.map.js"))).toBe(
      'export const button = "ui-button";\n',
    );
    expect(await readText(join(root, "src/button.css"))).toBeNull();
  });
});
