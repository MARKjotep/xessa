/**
 * TT5 row 2 — ESM consumers of the generated class map.
 *
 * | Assertion | How |
 * |---|---|
 * | plain ESM import under `node --input-type=module` | the map is imported with a static named `import` and its literal exports compared against the compiled class table; there is no default export (CSSX-A52) |
 * | the same import under Bun | identical static import executed by the Bun binary |
 * | the map has no CSS side-effect import | the file contains only `export const` lines, so Node imports it with no loader; the stylesheet is a separate artifact |
 * | opt-in generated `.d.ts` mirrors the map | the declaration file (requested with `map-types`) declares the same literal bindings |
 * | bundler case | `esbuild` / `vite` are not dependencies of this repository, so the row is recorded as **not run — tool not present** (no installation permitted) |
 *
 * Every artifact assertion derives from {@link generatedProject}, not from the emitted
 * text itself, so the map is checked against the authored class names.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "../corpus.ts";
import { cleanupTempProjects, createTempProject } from "../scale/generate.ts";
import {
  type GeneratedProject,
  bundlerStatus,
  ensureDistBuild,
  expectStatus,
  generatedProject,
  runProcess,
  runtimeMatrix,
} from "./helpers.ts";

/** One built consumer project. */
interface BuiltConsumer {
  readonly project: GeneratedProject;
  readonly root: string;
}

const matrix = runtimeMatrix();
const nodeRuntime = matrix.rows.find(
  (row) => row.engine === "node" && row.status === "verified",
)?.runtime;
const bunRuntime = matrix.rows.find(
  (row) => row.engine === "bun" && row.status === "verified",
)?.runtime;
const cliRuntime = nodeRuntime ?? bunRuntime;

/** Build one project with the **built** CLI under a real Node runtime. */
function buildWithCli(project: GeneratedProject): BuiltConsumer {
  const root = createTempProject(project.files);
  const entry = join(REPO_ROOT, "packages", "cli", "dist", "index.js");
  const outcome = runProcess(cliRuntime?.binary ?? "bun", [entry, "build"], { cwd: root });
  expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
  for (const relative of [
    ...Object.values(project.mapModules),
    ...Object.values(project.declarations),
    ...Object.values(project.stylesheets),
  ]) {
    expect({ artifact: relative, exists: existsSync(join(root, relative)) }).toEqual({
      artifact: relative,
      exists: true,
    });
  }
  return { project, root };
}

let plain: BuiltConsumer;

beforeAll(async () => {
  await ensureDistBuild();
  plain = buildWithCli(generatedProject({ sourceMap: false, mapTypes: true }));
});

afterAll(() => {
  cleanupTempProjects();
});

describe("ESM consumers of the generated class map", () => {
  test("generated artifacts match the authored class table", () => {
    // Guard against a fixture drift that would make the import cases vacuous.
    expect(plain.project.classes).toEqual({
      "panel-head": "ui-panel-head",
      "panel-body": "ui-panel-body",
      "card-one": "ui-card-one",
      "card-two": "ui-card-two",
    });
    expect(cliRuntime).toBeDefined();
  });

  test("plain ESM import of the map under node --input-type=module", () => {
    if (nodeRuntime === undefined) {
      // Recorded unverified in the runtime matrix; never silently skipped as passed.
      expect(matrix.rows.some((row) => row.engine === "node" && row.status === "unverified")).toBe(
        true,
      );
      return;
    }
    const modulePath = join(plain.root, plain.project.mapModules["src/panel.cssx"] ?? "");
    const code = `import { panelHead, panelBody } from ${JSON.stringify(
      pathToFileURL(modulePath).href,
    )};
process.stdout.write(JSON.stringify({ named: { panelHead, panelBody } }));`;
    const outcome = runProcess(nodeRuntime.binary, ["--input-type=module", "-e", code], {
      cwd: plain.root,
    });
    expectStatus(`node ${nodeRuntime.version} --input-type=module -e <static import>`, outcome, 0);
    expect(outcome.stderr).toBe("");
    expect(JSON.parse(outcome.stdout)).toEqual({
      named: { panelHead: "ui-panel-head", panelBody: "ui-panel-body" },
    });
  });

  test("plain ESM import of the map under Bun", () => {
    if (bunRuntime === undefined) {
      expect(matrix.rows.find((row) => row.engine === "bun")?.reason ?? "").not.toBe("");
      return;
    }
    const modulePath = join(plain.root, plain.project.mapModules["src/panel.cssx"] ?? "");
    const code = `import { panelHead, panelBody } from ${JSON.stringify(
      pathToFileURL(modulePath).href,
    )};
process.stdout.write(JSON.stringify({ named: { panelHead, panelBody } }));`;
    const outcome = runProcess(bunRuntime.binary, ["--input-type=module", "-e", code], {
      cwd: plain.root,
    });
    expectStatus(`bun ${bunRuntime.version} --input-type=module -e <static import>`, outcome, 0);
    expect(outcome.stderr).toBe("");
    expect(JSON.parse(outcome.stdout)).toEqual({
      named: { panelHead: "ui-panel-head", panelBody: "ui-panel-body" },
    });
  });

  test("the map has no CSS import and the .d.ts matches", () => {
    const mapPath = join(plain.root, plain.project.mapModules["src/card.cssx"] ?? "");
    const mapText = readFileSync(mapPath, "utf8");
    expect(mapText).not.toContain(".css");
    expect(mapText).not.toContain("import ");
    expect(
      mapText
        .trim()
        .split("\n")
        .every((line) => line.startsWith("export const ")),
    ).toBe(true);

    // The stylesheet is a separate artifact the consumer loads explicitly.
    expect(existsSync(join(plain.root, plain.project.stylesheets["src/card.cssx"] ?? ""))).toBe(
      true,
    );

    // Declarations ship beside the map (opt-in) and declare the same literals.
    const declarations = readFileSync(
      join(plain.root, plain.project.declarations["src/card.cssx"] ?? ""),
      "utf8",
    );
    for (const name of ["card-one", "card-two"]) {
      const emitted = plain.project.classes[name] ?? "";
      expect(mapText).toContain(`"${emitted}"`);
      expect(declarations).toContain(`"${emitted}"`);
    }
    expect(mapText).toContain('export const cardOne = "ui-card-one";');
    expect(mapText).not.toContain("export default");
    expect(declarations).toContain('export declare const cardOne: "ui-card-one";');
    expect(declarations).not.toContain("export default");
  });

  test("bundler row is recorded as not run — the tools are not dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    for (const tool of ["esbuild", "vite"] as const) {
      const status = bundlerStatus(tool);
      // The recorded row and the manifest agree: the tool is genuinely absent.
      expect({ tool, declared: Object.hasOwn(declared, tool), present: status.present }).toEqual({
        tool,
        declared: false,
        present: false,
      });
      expect(status.reason).toContain("not present");
      expect(status.present ? status.reason : "not run — tool not present").toBe(
        "not run — tool not present",
      );
    }
  });
});
