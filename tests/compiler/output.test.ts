import { describe, expect, test } from "bun:test";
import type {
  PlanOutputsInput,
  PlanOutputsResult,
  ResolvedSetup,
} from "../../packages/compiler/src/index.ts";
import type { OutputPlannerContext } from "../../packages/compiler/src/output/index.ts";
import { planOutputs } from "../../packages/compiler/src/output/index.ts";
import { defaultSetupFor } from "../../packages/compiler/src/output/resolve.ts";

const WORKSPACE = "/ws";

function setupFor(sourceFile: string, overrides: Partial<ResolvedSetup> = {}): ResolvedSetup {
  return { ...defaultSetupFor(sourceFile), ...overrides };
}

function run(
  input: Partial<PlanOutputsInput> = {},
  context?: OutputPlannerContext,
): PlanOutputsResult {
  const sourceFile = input.sourceFile ?? "src/button.cssx";
  return planOutputs(
    {
      sourceFile,
      setup: input.setup ?? setupFor(sourceFile),
      workspaceRoot: input.workspaceRoot ?? WORKSPACE,
      ...(input.projectConfig === undefined ? {} : { projectConfig: input.projectConfig }),
      ...(input.cliOverrides === undefined ? {} : { cliOverrides: input.cliOverrides }),
    },
    context,
  );
}

function shape(result: PlanOutputsResult) {
  return result.plan.outputs.map((output) => ({
    kind: output.kind,
    absolutePath: output.absolutePath,
    workspacePath: output.workspacePath,
    sourceFile: output.sourceFile,
  }));
}

function outputsOf(result: PlanOutputsResult): string[] {
  return result.plan.outputs.map((output) => `${output.kind}:${output.workspacePath}`);
}

function errorCodes(result: PlanOutputsResult): string[] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

describe("SPECIFICATION.md §9.3 output planner acceptance cases", () => {
  test("no setup places artifacts beside the source", () => {
    const result = run();
    expect(shape(result)).toEqual([
      {
        kind: "css",
        absolutePath: "/ws/src/button.css",
        workspacePath: "src/button.css",
        sourceFile: "src/button.cssx",
      },
      {
        kind: "js",
        absolutePath: "/ws/src/button.map.js",
        workspacePath: "src/button.map.js",
        sourceFile: "src/button.cssx",
      },
    ]);
    expect(result.plan.manifest).toEqual([
      { kind: "css", workspacePath: "src/button.css", sourceFile: "src/button.cssx" },
      { kind: "js", workspacePath: "src/button.map.js", sourceFile: "src/button.cssx" },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("only CSS directory keeps the map directory at its default", () => {
    const result = run({ setup: setupFor("src/button.cssx", { cssDir: "../out/styles" }) });
    expect(shape(result)).toEqual([
      {
        kind: "css",
        absolutePath: "/ws/out/styles/button.css",
        workspacePath: "out/styles/button.css",
        sourceFile: "src/button.cssx",
      },
      {
        kind: "js",
        absolutePath: "/ws/src/button.map.js",
        workspacePath: "src/button.map.js",
        sourceFile: "src/button.cssx",
      },
    ]);
  });

  test("only map directory keeps the CSS directory at its default", () => {
    const result = run({ setup: setupFor("src/button.cssx", { mapDir: "../out/maps" }) });
    expect(outputsOf(result)).toEqual(["css:src/button.css", "js:out/maps/button.map.js"]);
  });

  test("only names retain the effective directories and derive declarations", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssName: "theme.css",
        mapName: "classes.js",
      }),
    });
    expect(outputsOf(result)).toEqual(["css:src/theme.css", "js:src/classes.js"]);
  });

  test("both directories and both names resolve independently", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../generated/styles",
        cssName: "theme.css",
        mapDir: "../generated/maps",
        mapName: "classes.js",
      }),
    });
    expect(outputsOf(result)).toEqual([
      "css:generated/styles/theme.css",
      "js:generated/maps/classes.js",
    ]);
  });

  test("nested source preserves its subdirectory by default", () => {
    const sourceFile = "src/pages/dashboard.cssx";
    const result = run({ sourceFile, setup: setupFor(sourceFile) });
    expect(outputsOf(result)).toEqual([
      "css:src/pages/dashboard.css",
      "js:src/pages/dashboard.map.js",
    ]);
  });

  test("project-level directories mirror the source-relative subdirectory", () => {
    const sourceFile = "src/pages/dashboard.cssx";
    const result = run({
      sourceFile,
      setup: setupFor(sourceFile),
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps" },
      },
    });
    expect(outputsOf(result)).toEqual([
      "css:dist/styles/pages/dashboard.css",
      "js:dist/maps/pages/dashboard.map.js",
    ]);
  });

  test("paths with spaces keep working directories", () => {
    const sourceFile = "src/my pages/button.cssx";
    const result = run({
      sourceFile,
      setup: setupFor(sourceFile, { cssDir: "../../out/styles here" }),
    });
    expect(outputsOf(result)).toEqual([
      "css:out/styles here/button.css",
      "js:src/my pages/button.map.js",
    ]);
  });

  test("Windows separators and a drive-letter workspace resolve OS-independently", () => {
    const sourceFile = "src\\button.cssx";
    const result = run({
      sourceFile,
      workspaceRoot: "C:\\project",
      setup: setupFor("C:\\project\\src\\button.cssx", { cssDir: "..\\out\\styles" }),
    });
    expect(shape(result)).toEqual([
      {
        kind: "css",
        absolutePath: "C:/project/out/styles/button.css",
        workspacePath: "out/styles/button.css",
        sourceFile: "src/button.cssx",
      },
      {
        kind: "js",
        absolutePath: "C:/project/src/button.map.js",
        workspacePath: "src/button.map.js",
        sourceFile: "src/button.cssx",
      },
    ]);
  });

  test("output collision: two sources planning the same target is XESSA5001", () => {
    const first = run({
      sourceFile: "src/a.cssx",
      setup: setupFor("src/a.cssx", { cssName: "shared.css" }),
    });
    expect(first.diagnostics).toEqual([]);
    expect(first.plan.outputs[0]?.workspacePath).toBe("src/shared.css");

    const second = run(
      {
        sourceFile: "src/b.cssx",
        setup: setupFor("src/b.cssx", { cssName: "shared.css" }),
      },
      { occupiedTargets: first.plan.outputs.map((output) => output.workspacePath) },
    );
    expect(errorCodes(second)).toEqual(["XESSA5001"]);
    expect(second.plan.outputs).toEqual([]);
    expect(second.diagnostics[0]?.message).toContain("already-planned");
  });

  test("invalid extension is XESSA5001 for css-name and map-name", () => {
    const css = run({
      setup: setupFor("src/button.cssx", { cssName: "button.scss" }),
    });
    expect(errorCodes(css)).toEqual(["XESSA5001"]);
    expect(css.plan.outputs).toEqual([]);
    expect(css.diagnostics[0]?.message).toContain(".css");

    const map = run({
      setup: setupFor("src/button.cssx", { mapName: "button.ts" }),
    });
    expect(errorCodes(map)).toEqual(["XESSA5001"]);
    expect(map.plan.outputs).toEqual([]);
    expect(map.diagnostics[0]?.message).toContain(".js");
  });

  test("traversal in a filename and a directory escape are XESSA5001", () => {
    const name = run({
      setup: setupFor("src/button.cssx", { cssName: "../evil.css" }),
    });
    expect(errorCodes(name)).toEqual(["XESSA5001"]);
    expect(name.plan.outputs).toEqual([]);
    expect(name.diagnostics[0]?.message).toContain("separator");

    const directory = run({
      setup: setupFor("src/button.cssx", { cssDir: "../../outside" }),
    });
    expect(errorCodes(directory)).toEqual(["XESSA5001"]);
    expect(directory.plan.outputs).toEqual([]);
    expect(directory.diagnostics.some((diagnostic) => diagnostic.message.includes("escapes"))).toBe(
      true,
    );
  });

  test("symlink escape through the injected host is XESSA5001", () => {
    const host = {
      canonicalize(path: string): string {
        const normalized = path.replace(/\\/g, "/");
        return normalized.startsWith("/ws/out")
          ? normalized.replace("/ws/out", "/outside")
          : normalized;
      },
    };
    const result = run({ setup: setupFor("src/button.cssx", { cssDir: "../out" }) }, { host });
    expect(errorCodes(result)).toEqual(["XESSA5001"]);
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("symlink"))).toBe(
      true,
    );
  });

  test("disabled map suppresses requested types with a warning", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { emitMap: false, emitTypes: true }),
    });
    expect(outputsOf(result)).toEqual(["css:src/button.css"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA5001");
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.message).toContain("suppressed");
  });

  test("disabled map with default-off types is silent", () => {
    const result = run({ setup: setupFor("src/button.cssx", { emitMap: false }) });
    expect(outputsOf(result)).toEqual(["css:src/button.css"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("disabled CSS writes only the map and no source map", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { emitCss: false, sourceMap: true }),
    });
    expect(outputsOf(result)).toEqual(["js:src/button.map.js"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("disabled types explicitly produce no warning", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { emitMap: false, emitTypes: false }),
    });
    expect(outputsOf(result)).toEqual(["css:src/button.css"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("renamed source reflects its new stem in every default name", () => {
    const sourceFile = "src/renamed.cssx";
    const result = run({ sourceFile, setup: setupFor(sourceFile) });
    expect(outputsOf(result)).toEqual(["css:src/renamed.css", "js:src/renamed.map.js"]);
  });

  test("custom source map URL naming is reserved from the CSS basename", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { cssName: "theme.css", sourceMap: true }),
    });
    expect(outputsOf(result)).toEqual([
      "css:src/theme.css",
      "js:src/button.map.js",
      "cssSourceMap:src/theme.css.map",
    ]);
  });

  test("sibling directories resolve independently", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../styles",
        mapDir: "../modules",
      }),
    });
    expect(outputsOf(result)).toEqual(["css:styles/button.css", "js:modules/button.map.js"]);
  });

  test("only-name with only CSS directory keeps the effective directory", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../out/styles",
        cssName: "theme.css",
      }),
    });
    expect(outputsOf(result)).toEqual(["css:out/styles/theme.css", "js:src/button.map.js"]);
  });

  test("CLI override wins over file setup (single-entry path overrides)", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { cssDir: "../file-out", cssName: "file.css" }),
      cliOverrides: { cssDir: "/ws/cli-out", cssName: "cli.css" },
    });
    expect(outputsOf(result)).toEqual(["css:cli-out/cli.css", "js:src/button.map.js"]);
  });

  test("map-types opts the declaration file back in beside the JS map", () => {
    const result = run({ setup: setupFor("src/button.cssx", { emitTypes: true }) });
    expect(outputsOf(result)).toEqual([
      "css:src/button.css",
      "js:src/button.map.js",
      "types:src/button.map.d.ts",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("input/output overlap is rejected when an artifact would overwrite its source", () => {
    const sourceFile = "src/theme.css";
    const result = run({ sourceFile, setup: setupFor(sourceFile) });
    expect(errorCodes(result)).toEqual(["XESSA5001"]);
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("overwrite");
  });

  test("planning is deterministic and never mutates input", () => {
    const input = { sourceFile: "src/button.cssx", setup: setupFor("src/button.cssx") };
    const snapshot = JSON.stringify(input);
    expect(run(input)).toEqual(run(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
