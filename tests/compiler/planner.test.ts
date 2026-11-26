import { describe, expect, test } from "bun:test";
import type {
  PlanOutputsInput,
  PlanOutputsResult,
  ResolvedSetup,
} from "../../packages/compiler/src/index.ts";
import type { OutputPlannerContext } from "../../packages/compiler/src/output/index.ts";
import { planOutputs } from "../../packages/compiler/src/output/index.ts";
import {
  dirnamePath,
  isWithinPath,
  joinPath,
  normalizePath,
  relativePath,
} from "../../packages/compiler/src/output/paths.ts";
import {
  declarationNameFor,
  defaultSetupFor,
  sourceMapNameFor,
  sourceRootFor,
} from "../../packages/compiler/src/output/resolve.ts";
import { findDuplicateTargets } from "../../packages/compiler/src/output/validate.ts";
import type { OutputCandidate } from "../../packages/compiler/src/output/validate.ts";

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

function outputsOf(result: PlanOutputsResult): string[] {
  return result.plan.outputs.map((output) => `${output.kind}:${output.workspacePath}`);
}

describe("output precedence and project configuration", () => {
  test("project configuration applies while setup is at its defaults", () => {
    const result = run({
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps" },
      },
    });
    expect(outputsOf(result)).toEqual(["css:dist/styles/button.css", "js:dist/maps/button.map.js"]);
  });

  test("file setup overrides project directories and names without losing project defaults", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { cssDir: "../file-out", cssName: "file.css" }),
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps" },
      },
    });
    expect(outputsOf(result)).toEqual(["css:file-out/file.css", "js:dist/maps/button.map.js"]);
  });

  test("file setup can disable map emission over project configuration", () => {
    const result = run({
      setup: setupFor("src/button.cssx", { emitMap: false }),
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps", emitMap: true, mapTypes: true },
      },
    });
    expect(outputsOf(result)).toEqual(["css:dist/styles/button.css"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
  });

  test("project configuration disabling maps suppresses requested types with a warning", () => {
    const result = run({
      projectConfig: { output: { emitMap: false, mapTypes: true } },
    });
    expect(outputsOf(result)).toEqual(["css:src/button.css"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
  });

  test("project mirroring falls back to the workspace-relative source directory outside include roots", () => {
    const result = run({
      projectConfig: {
        include: ["lib/**/*.cssx"],
        output: { cssDir: "dist" },
      },
    });
    expect(outputsOf(result)[0]).toBe("css:dist/src/button.css");
  });

  test("source root derivation uses the common static include prefix", () => {
    expect(
      sourceRootFor("/ws", ["src/**/*.cssx", "src/features/**/*.cssx"], "/ws/src/a.cssx"),
    ).toBe("/ws/src");
    expect(sourceRootFor("/ws", ["src/**/*.cssx", "tools/**/*.cssx"], "/ws/src/a.cssx")).toBe(
      "/ws",
    );
    expect(sourceRootFor("/ws", undefined, "/ws/src/a.cssx")).toBe("/ws");
  });

  test("CLI disabling maps suppresses requested types and still applies CLI names", () => {
    const result = run({
      cliOverrides: { emitMap: false, emitTypes: true, cssName: "cli.css" },
    });
    expect(outputsOf(result)).toEqual(["css:src/cli.css"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("warning");
  });
});

describe("output safety boundaries", () => {
  test("a drive-letter CSS directory on another drive escapes the workspace", () => {
    const result = run({
      workspaceRoot: "C:\\project",
      sourceFile: "src\\button.cssx",
      setup: setupFor("C:\\project\\src\\button.cssx", { cssDir: "D:\\out" }),
    });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("XESSA5001");
    expect(result.diagnostics[0]?.message).toContain("escapes");
  });

  test("an absolute source outside the workspace root is rejected", () => {
    const result = run({ sourceFile: "/elsewhere/button.cssx" });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("XESSA5001");
    expect(result.diagnostics[0]?.message).toContain("outside the workspace root");
  });

  test("a relative workspace root is rejected", () => {
    const result = run({ workspaceRoot: "relative/ws" });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("XESSA5001");
    expect(result.diagnostics[0]?.message).toContain("absolute");
  });

  test("a host canonicalization failure becomes XESSA5001 instead of throwing", () => {
    const host = {
      canonicalize(): string {
        throw new Error("permission denied");
      },
    };
    const result = run({}, { host });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("XESSA5001");
    expect(result.diagnostics[0]?.message).toContain("permission denied");
  });

  test("duplicate target detection reports XESSA5001 for two artifacts", () => {
    const span = { start: 0, end: 0, file: "src/button.cssx" };
    const candidates: OutputCandidate[] = [
      {
        kind: "css",
        absolutePath: "/ws/src/shared.css",
        workspacePath: "src/shared.css",
        sourceFile: "src/button.cssx",
      },
      {
        kind: "js",
        absolutePath: "/ws/src/shared.css",
        workspacePath: "src/shared.css",
        sourceFile: "src/button.cssx",
      },
    ];
    const diagnostics = findDuplicateTargets(candidates, span);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA5001");
    expect(diagnostics[0]?.message).toContain("Duplicate output target");
  });
});

describe("path and import helpers", () => {
  test("normalizes Windows separators and drive-letter roots", () => {
    expect(normalizePath("C:\\\\project\\\\src\\\\..\\\\out")).toBe("C:/project/out");
    expect(normalizePath("..\\\\styles")).toBe("../styles");
    expect(normalizePath("C:local")).toBe("C:local");
    expect(joinPath("C:/project", "src", "..", "out")).toBe("C:/project/out");
    expect(dirnamePath("C:/project/src/button.cssx")).toBe("C:/project/src");
    expect(dirnamePath("/ws/src")).toBe("/ws");
    expect(dirnamePath("/ws")).toBe("/");
  });

  test("computes relative paths and containment across roots", () => {
    expect(relativePath("/ws/modules", "/ws/styles/button.css")).toBe("../styles/button.css");
    expect(relativePath("/ws/src", "/ws/src/button.css")).toBe("button.css");
    expect(relativePath("C:/project/src", "C:/project/out/x.css")).toBe("../out/x.css");
    expect(relativePath("/ws", "D:/out/x.css")).toBe("D:/out/x.css");
    expect(isWithinPath("/ws", "/ws/src/x.css")).toBe(true);
    expect(isWithinPath("/ws", "/ws-other/x.css")).toBe(false);
    expect(isWithinPath("C:/Project", "c:/project/src/x.css")).toBe(true);
  });

  test("declaration and source-map names derive from the configured basenames", () => {
    expect(declarationNameFor("classes.js")).toBe("classes.d.ts");
    expect(declarationNameFor("button.map.js")).toBe("button.map.d.ts");
    expect(sourceMapNameFor("theme.css")).toBe("theme.css.map");
  });
});
