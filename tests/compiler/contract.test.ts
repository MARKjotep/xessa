import { describe, expect, test } from "bun:test";
import {
  DIAGNOSTIC_CODES,
  compile,
  compileProject,
  createNodeHost,
  error,
  parse,
  planOutputs,
  warning,
} from "../../packages/compiler/src/index.ts";
import type { ModuleHost, ResolvedSetup, Span } from "../../packages/compiler/src/index.ts";

const span: Span = { start: 0, end: 4, file: "src/sample.cssx" };

const host: ModuleHost = {
  readFile: async () => "",
  fileExists: async () => false,
  canonicalize: (path) => path,
  resolvePath: (_from, to) => to,
  workspaceRoot: () => "/workspace",
};

const setup: ResolvedSetup = {
  prefix: "ui",
  cssDir: "src",
  cssName: "sample.css",
  mapDir: "src",
  mapName: "sample.map.js",
  emitCss: true,
  emitMap: true,
  emitTypes: true,
  sourceMap: false,
  minify: false,
};

describe("frozen compiler contract", () => {
  test("public entry points are exported", () => {
    expect(typeof parse).toBe("function");
    expect(typeof compile).toBe("function");
    expect(typeof compileProject).toBe("function");
    expect(typeof createNodeHost).toBe("function");
    expect(typeof planOutputs).toBe("function");
    expect(typeof error).toBe("function");
    expect(typeof warning).toBe("function");
  });

  test("implemented entry points return results instead of phase stubs", async () => {
    const compilation = await compile(".a { color: red; }", {
      file: "src/sample.cssx",
      workspaceRoot: "/workspace",
    });
    expect(compilation.css).toContain(".a");
    expect(compilation.classes.a).toBe("a");
    expect(compilation.diagnostics).toEqual([]);

    const project = await compileProject([], host, {});
    expect(project).toEqual({});

    const plan = planOutputs({
      sourceFile: "src/sample.cssx",
      setup,
      workspaceRoot: "/workspace",
    });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.plan.outputs.map((output) => output.kind)).toEqual(["css", "js", "types"]);
  });

  test("reserved diagnostic codes are registered", () => {
    expect(Object.keys(DIAGNOSTIC_CODES).sort()).toEqual([
      "XESSA1001",
      "XESSA1002",
      "XESSA1003",
      "XESSA2001",
      "XESSA3001",
      "XESSA4001",
      "XESSA5001",
    ]);
    for (const [code, info] of Object.entries(DIAGNOSTIC_CODES)) {
      expect(info.code).toBe(code);
      expect(info.summary.length).toBeGreaterThan(0);
    }
  });

  test("diagnostic factories preserve code, severity, message and span", () => {
    const failure = error("XESSA1001", "unexpected token", span);
    expect(failure).toEqual({
      code: "XESSA1001",
      severity: "error",
      message: "unexpected token",
      span,
    });
    const warningIssue = warning("XESSA4001", "named export omitted", span);
    expect(warningIssue.severity).toBe("warning");
    expect(warningIssue.code).toBe("XESSA4001");
  });
});
