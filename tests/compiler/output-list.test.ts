/**
 * `css-dir` value lists (CSSX-F18, ADR-0019).
 *
 * A file-level `css-dir` may author a comma-separated list. Every destination
 * receives the same stylesheet (and, when enabled, the same source map); the JS
 * map and declarations stay single. Resolution of each item is exact relative to
 * the source file, exactly like the single-value case.
 */

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

function outputsOf(result: PlanOutputsResult): string[] {
  return result.plan.outputs.map((output) => `${output.kind}:${output.workspacePath}`);
}

describe("css-dir lists in the pure planner", () => {
  test("one CSS artifact per listed directory, each exact beside the source", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../src"],
      }),
    });
    expect(outputsOf(result)).toEqual([
      "css:client/button.css",
      "css:src/button.css",
      "js:src/button.map.js",
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.plan.manifest).toEqual([
      { kind: "css", workspacePath: "client/button.css", sourceFile: "src/button.cssx" },
      { kind: "css", workspacePath: "src/button.css", sourceFile: "src/button.cssx" },
      { kind: "js", workspacePath: "src/button.map.js", sourceFile: "src/button.cssx" },
    ]);
  });

  test("source maps are emitted beside every listed CSS destination", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../src"],
        sourceMap: true,
      }),
    });
    expect(outputsOf(result)).toEqual([
      "css:client/button.css",
      "css:src/button.css",
      "js:src/button.map.js",
      "cssSourceMap:client/button.css.map",
      "cssSourceMap:src/button.css.map",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("map-dir and map-name stay single-valued beside a CSS list", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../modules"],
        cssName: "theme.css",
        mapDir: "../maps",
        mapName: "classes.js",
        emitTypes: true,
      }),
    });
    expect(outputsOf(result)).toEqual([
      "css:client/theme.css",
      "css:modules/theme.css",
      "js:maps/classes.js",
      "types:maps/classes.d.ts",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("a file list replaces project configuration cssDir entirely", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../src"],
      }),
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps" },
      },
    });
    expect(outputsOf(result)).toEqual([
      "css:client/button.css",
      "css:src/button.css",
      "js:dist/maps/button.map.js",
    ]);
  });

  test("items resolve exactly, without project-level source mirroring", () => {
    const result = run({
      sourceFile: "src/pages/dashboard.cssx",
      setup: setupFor("src/pages/dashboard.cssx", {
        cssDir: "../../client",
        cssDirs: ["../../client", "../styles"],
      }),
      projectConfig: {
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", mapDir: "dist/maps" },
      },
    });
    expect(outputsOf(result)).toEqual([
      "css:client/dashboard.css",
      "css:src/styles/dashboard.css",
      "js:dist/maps/pages/dashboard.map.js",
    ]);
  });

  test("a CLI css-dir override replaces the file list", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../src"],
      }),
      cliOverrides: { cssDir: "/ws/cli-out" },
    });
    expect(outputsOf(result)).toEqual(["css:cli-out/button.css", "js:src/button.map.js"]);
  });

  test("two list items resolving to one destination are rejected as XESSA5001", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../out",
        cssDirs: ["../out", "./../out"],
      }),
    });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA5001"]);
    expect(result.diagnostics[0]?.message).toContain("Duplicate output target");
  });

  test("an external list item is rejected per destination", () => {
    const result = run({
      setup: setupFor("src/button.cssx", {
        cssDir: "../client",
        cssDirs: ["../client", "../../outside"],
      }),
    });
    expect(result.plan.outputs).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("escapes"))).toBe(
      true,
    );
  });
});
