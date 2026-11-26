/**
 * Project plumbing tests: config discovery/validation, entry globbing and
 * output planning (the parts the commands rely on, tested without `vscode`).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type SetupSetting, analyzeText } from "../../packages/vscode/src/analysis.ts";
import { findNearestConfigPath, parseExtensionConfig } from "../../packages/vscode/src/config.ts";
import {
  type DirectoryEntry,
  discoverProjectEntries,
  globToRegExp,
  matchesPatterns,
} from "../../packages/vscode/src/glob.ts";
import { fileSetup, planEntryOutputs, projectConfigOf } from "../../packages/vscode/src/output.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

function settingsOf(text: string): readonly SetupSetting[] {
  return analyzeText({ text, path: join(ROOT, "x.cssx"), version: 1 }).settings;
}

describe("config discovery", () => {
  test("finds the nearest config and stops at the workspace boundary", () => {
    const files = new Set(["/workspace/xessa.config.json", "/workspace/app/xessa.config.json"]);
    expect(
      findNearestConfigPath("/workspace/app/src/a.cssx", "/workspace", (path) => files.has(path)),
    ).toBe("/workspace/app/xessa.config.json");
    expect(
      findNearestConfigPath("/workspace/app/src/a.cssx", "/workspace/app", (path) =>
        files.has(path),
      ),
    ).toBe("/workspace/app/xessa.config.json");
    expect(
      findNearestConfigPath("/workspace/src/a.cssx", "/workspace", (path) => files.has(path)),
    ).toBe("/workspace/xessa.config.json");
    expect(
      findNearestConfigPath("/workspace/src/a.cssx", "/workspace/src", (path) => files.has(path)),
    ).toBeUndefined();
  });

  test("parses valid configs, ignores unknown keys and rejects malformed ones", () => {
    const valid = parseExtensionConfig(
      JSON.stringify({
        include: ["src/**/*.cssx"],
        output: { cssDir: "dist/styles", emitCss: true },
        classes: { strategy: "prefix", prefix: "ui" },
        media: { md: "(min-width: 768px)" },
        compiler: { strict: true, mediaGrouping: "safe" },
        extra: true,
      }),
      "/workspace/xessa.config.json",
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.config.root).toBe("/workspace");
    expect(valid.config.classes?.prefix).toBe("ui");
    expect(valid.warnings[0]).toContain("extra");

    expect(parseExtensionConfig("{ nope", "/workspace/xessa.config.json").ok).toBe(false);
    expect(
      parseExtensionConfig(JSON.stringify({ output: { emitCss: "yes" } }), "/w/xessa.config.json")
        .ok,
    ).toBe(false);
  });
});

describe("project entries", () => {
  const tree: Record<string, readonly DirectoryEntry[]> = {
    "/project": [
      { name: "src", directory: true },
      { name: "node_modules", directory: true },
      { name: "README.md", directory: false },
    ],
    "/project/src": [
      { name: "a.cssx", directory: false },
      { name: "nested", directory: true },
      { name: "styles.css", directory: false },
    ],
    "/project/src/nested": [{ name: "b.cssx", directory: false }],
    "/project/node_modules": [{ name: "package", directory: true }],
    "/project/node_modules/package": [{ name: "c.cssx", directory: false }],
  };

  test("globs map ** and * to workspace-relative matches", () => {
    const pattern = globToRegExp("src/**/*.cssx");
    expect(pattern.test("src/a.cssx")).toBe(true);
    expect(pattern.test("src/nested/b.cssx")).toBe(true);
    expect(pattern.test("other/a.cssx")).toBe(false);
    expect(matchesPatterns("src/a.cssx", ["src/*.cssx"])).toBe(true);
  });

  test("discovers source entries, skipping dependencies and non-Xessa files", () => {
    const entries = discoverProjectEntries(
      "/project",
      [],
      ["src/nested"],
      (directory) => tree[directory] ?? [],
    );
    expect(entries).toEqual(["/project/src/a.cssx"]);
  });
});

describe("output planning", () => {
  test("file setup values resolve relative to the source file", () => {
    const settings = settingsOf(
      '@setup { css-dir: "../generated/styles"; css-name: "button.css"; map-dir: "../generated/maps"; map-name: "button.map.js"; emit-types: false; }\n.button { color: red; }',
    );
    const sourceFile = "tests/fixtures/canonical/button/input.cssx";
    const setup = fileSetup(sourceFile, settings, "ui");
    expect(setup.cssDir).toBe("../generated/styles");
    expect(setup.cssName).toBe("button.css");
    expect(setup.emitTypes).toBe(false);

    const plan = planEntryOutputs({
      sourceFile,
      workspaceRoot: ROOT,
      setup,
    });
    expect(plan.diagnostics).toEqual([]);
    const outputs = plan.plan.outputs.map((output) => [output.kind, output.workspacePath]);
    expect(outputs).toEqual([
      ["css", "tests/fixtures/canonical/generated/styles/button.css"],
      ["js", "tests/fixtures/canonical/generated/maps/button.map.js"],
    ]);
    const js = plan.plan.outputs.find((output) => output.kind === "js");
    expect(js?.workspacePath).toBe("tests/fixtures/canonical/generated/maps/button.map.js");
  });

  test("project output configuration is the middle layer", () => {
    const setup = fileSetup("src/card.cssx", [], "");
    const projectConfig = projectConfigOf({
      include: ["src/**/*.cssx"],
      exclude: [],
      output: { cssDir: "dist/styles", mapDir: "dist/maps" },
    });
    const plan = planEntryOutputs({
      sourceFile: "src/card.cssx",
      workspaceRoot: ROOT,
      setup,
      projectConfig,
    });
    expect(plan.diagnostics).toEqual([]);
    const css = plan.plan.outputs.find((output) => output.kind === "css");
    expect(css?.workspacePath).toBe("dist/styles/card.css");
    const map = plan.plan.outputs.find((output) => output.kind === "js");
    expect(map?.workspacePath).toBe("dist/maps/card.map.js");
  });

  test("invalid output plans are reported instead of written", () => {
    const settings = settingsOf('@setup { css-name: "card.txt"; }\n.card { color: red; }');
    const plan = planEntryOutputs({
      sourceFile: "src/card.cssx",
      workspaceRoot: ROOT,
      setup: fileSetup("src/card.cssx", settings, ""),
    });
    expect(plan.plan.outputs).toEqual([]);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "XESSA5001")).toBe(true);
  });
});
