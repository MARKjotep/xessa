/**
 * TT2 1000-file project — plan §TT2 row 6.
 *
 * | Case | Assertion |
 * |---|---|
 * | 1000-file project | class map ↔ emitted files 1:1; generated `.d.ts` compiles under `tsc --noEmit` |
 *
 * The project is generated into a `mkdtemp` directory and driven through the
 * real CLI (`xessa build --json`), so manifest bookkeeping, artifact writes and
 * output planning are exercised exactly as a build script would see them. The
 * build is executed once in `beforeAll`; the three cases assert different
 * invariants over the same artifacts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { compile } from "../../../packages/compiler/src/index.ts";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  SCALE,
  cleanupTempProjects,
  createTempProject,
  cssClassTokens,
  cssErrorMessages,
  listProjectFiles,
  readProjectFile,
  runCli,
  runTsc,
  thousandFileProject,
} from "./generate.ts";

/** Minimal shape of the CLI `build --json` report used here. */
interface BuildReport {
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly entries: readonly {
    readonly file: string;
    readonly outputs: readonly {
      readonly kind: string;
      readonly path: string;
      readonly written: boolean;
    }[];
    readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
  }[];
}

/** Class names exported by a generated JS class map. */
function mapClassNames(js: string): string[] {
  const names: string[] = [];
  for (const match of js.matchAll(/^export const (\w+) = "([^"]+)";$/gmu)) {
    const value = match[2];
    if (value !== undefined) names.push(value);
  }
  return names;
}

/** Class literal values declared by a generated `.d.ts`. */
function declaredClassValues(types: string): string[] {
  const values: string[] = [];
  for (const match of types.matchAll(/^export declare const \w+: "([^"]+)";$/gmu)) {
    const value = match[1];
    if (value !== undefined) values.push(value);
  }
  return values;
}

let root = "";
let project: ReturnType<typeof thousandFileProject>;
let buildOutcome: ReturnType<typeof runCli>;
let report: BuildReport;
const artifactFiles: string[] = [];

beforeAll(() => {
  const rng = createLabelledRng(readStressSeed(), "scale/project");
  project = thousandFileProject(rng);
  root = createTempProject(project.files);
  buildOutcome = runCli(["build", "--json"], root, 240_000);
  report = JSON.parse(buildOutcome.stdout) as BuildReport;
  artifactFiles.push(...listProjectFiles(root, "dist"));
}, 240_000);

afterAll(cleanupTempProjects);

describe("TT2 1000-file project", () => {
  test("the CLI build succeeds with zero error diagnostics", () => {
    expect(buildOutcome.status).toBe(0);
    expect(buildOutcome.stderr).toBe("");
    expect(report.command).toBe("build");
    expect(report.success).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.entries).toHaveLength(SCALE.projectFiles);

    const errors: string[] = [];
    let written = 0;
    for (const entry of report.entries) {
      for (const diagnostic of entry.diagnostics) {
        if (diagnostic.severity === "error") errors.push(`${entry.file}: ${diagnostic.code}`);
      }
      written += entry.outputs.filter((output) => output.written).length;
    }
    expect(errors).toEqual([]);
    expect(written).toBe(SCALE.projectFiles * 3);
  }, 240_000);

  test("class map ↔ emitted files is 1:1 for all 1000 sources", () => {
    const cssFiles = artifactFiles.filter((path) => path.startsWith("dist/styles/"));
    const jsFiles = artifactFiles.filter((path) => path.endsWith(".map.js"));
    const typeFiles = artifactFiles.filter((path) => path.endsWith(".map.d.ts"));
    expect(cssFiles).toHaveLength(SCALE.projectFiles);
    expect(jsFiles).toHaveLength(SCALE.projectFiles);
    expect(typeFiles).toHaveLength(SCALE.projectFiles);
    expect(artifactFiles).toHaveLength(SCALE.projectFiles * 3);

    const mismatches: string[] = [];
    const reparseErrors: string[] = [];
    for (const entry of project.entries) {
      const stem = entry.replace(/^src\//u, "").replace(/\.cssx$/u, "");
      const cssPath = `dist/styles/src/${stem}.css`;
      const jsPath = `dist/maps/src/${stem}.map.js`;
      const typesPath = `dist/maps/src/${stem}.map.d.ts`;
      if (
        !cssFiles.includes(cssPath) ||
        !jsFiles.includes(jsPath) ||
        !typeFiles.includes(typesPath)
      ) {
        mismatches.push(`${entry}: missing one of ${cssPath}, ${jsPath}, ${typesPath}`);
        continue;
      }

      const css = readProjectFile(root, cssPath);
      const js = readProjectFile(root, jsPath);
      const types = readProjectFile(root, typesPath);
      reparseErrors.push(...cssErrorMessages(css).map((message) => `${cssPath}: ${message}`));

      if (js.includes("import ")) mismatches.push(`${jsPath}: map imports CSS`);

      const mapped = mapClassNames(js).sort();
      const declared = declaredClassValues(types).sort();
      const emitted = cssClassTokens(css).sort();
      if (JSON.stringify(mapped) !== JSON.stringify(emitted)) {
        mismatches.push(`${jsPath}: map [${mapped.join(",")}] != css [${emitted.join(",")}]`);
      }
      if (JSON.stringify(declared) !== JSON.stringify(mapped)) {
        mismatches.push(
          `${typesPath}: declarations [${declared.join(",")}] != map [${mapped.join(",")}]`,
        );
      }
    }

    // Two classes per source: the rule's own class and the nested `& > .icon`.
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(reparseErrors.slice(0, 10)).toEqual([]);
    expect(mismatches).toHaveLength(0);
    expect(reparseErrors).toHaveLength(0);

    const anyCss = readProjectFile(root, "dist/styles/src/file-0000.css");
    expect(cssClassTokens(anyCss)).toHaveLength(2);
  }, 240_000);

  test("the workspace manifest records exactly the 3000 emitted artifacts", () => {
    const manifest = JSON.parse(readProjectFile(root, ".cssx-manifest.json")) as {
      readonly version: number;
      readonly files: readonly { readonly kind: string; readonly path: string }[];
    };
    expect(manifest.version).toBe(1);
    expect(manifest.files).toHaveLength(SCALE.projectFiles * 3);
    const kinds = new Map<string, number>();
    for (const file of manifest.files) {
      kinds.set(file.kind, (kinds.get(file.kind) ?? 0) + 1);
    }
    expect([...kinds.entries()].sort()).toEqual([
      ["css", SCALE.projectFiles],
      ["js", SCALE.projectFiles],
      ["types", SCALE.projectFiles],
    ]);
    for (const file of manifest.files) {
      expect(artifactFiles).toContain(file.path);
    }
  }, 240_000);

  test("generated declarations compile under `tsc --noEmit`", () => {
    const tsc = runTsc(root, 240_000);
    expect({ status: tsc.status, stdout: tsc.stdout, stderr: tsc.stderr }).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  }, 240_000);

  test("`xessa check` accepts emitted CSS from the built project", () => {
    for (const sample of [
      "dist/styles/src/file-0000.css",
      "dist/styles/src/file-0500.css",
      "dist/styles/src/file-0999.css",
    ]) {
      const check = runCli(["check", sample, "--json"], root, 120_000);
      expect(check.status).toBe(0);
      const checked = JSON.parse(check.stdout) as { readonly success: boolean };
      expect(checked.success).toBe(true);
    }
  }, 240_000);
});

describe("TT2 1000-file project: independent compile of one entry", () => {
  test("a generated source compiles through `compile()` with no error diagnostics", async () => {
    const source = readProjectFile(root, "src/file-0500.cssx");
    const result = await compile(source, {
      file: "src/file-0500.cssx",
      workspaceRoot: root,
      prefix: "ui",
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(cssErrorMessages(result.css ?? "")).toEqual([]);
    expect(Object.keys(result.classes)).toHaveLength(2);
  }, 240_000);
});
