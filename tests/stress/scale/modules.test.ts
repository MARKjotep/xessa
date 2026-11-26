/**
 * TT2 module-graph scale — plan §TT2 rows 3 and 4.
 *
 * | Case | Assertion |
 * |---|---|
 * | 1k-deep `@use` chain | builds, no stack overflow, no depth diagnostic at 1 000 |
 * | diamond + cycle graph of 500 modules | deterministic resolution or a typed cycle diagnostic; no hang; byte-identical output across two runs |
 *
 * Graphs are built through the same in-memory `ModuleHost` the compiler suites
 * use, so 1 500 module files never touch the filesystem. Current behaviour is
 * asserted exactly (the plan's "assert actual"): there is no depth limit at
 * 1 000, and a 500-module cycle yields one `XESSA2001` whose message embeds the
 * whole import path — both recorded in `.ai/reports/CSSX-TT2.md`.
 */

import { describe, expect, test } from "bun:test";
import { compileProject } from "../../../packages/compiler/src/index.ts";
import {
  buildModuleGraph,
  styleModuleOrder,
} from "../../../packages/compiler/src/resolver/index.ts";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  SCALE,
  createMemoryHost,
  cssErrorMessages,
  cycleProject,
  diamondProject,
  projectOutputOptions,
  useChainProject,
} from "./generate.ts";

const ROOT = "/workspace";

/** Diagnostic codes of every error diagnostic in a result. */
function errorCodes(
  diagnostics: readonly { readonly code: string; readonly severity: string }[],
): string[] {
  return diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.code);
}

describe("TT2 1k-deep @use chain", () => {
  test("builds without a stack overflow or a depth diagnostic at 1000 modules", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/use-chain");
    const project = useChainProject(rng);
    expect(Object.keys(project.files)).toHaveLength(SCALE.useChainModules);

    const host = createMemoryHost(project.files, ROOT);
    const graph = await buildModuleGraph([`${ROOT}/${project.entries[0] ?? ""}`], host, {
      file: "src/m0.cssx",
    });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.modules.size).toBe(SCALE.useChainModules);

    const results = await compileProject(project.entries, host, {
      projectRoot: ROOT,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    const entry = results["src/m0.cssx"];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(entry.diagnostics).toEqual([]);
    expect(entry.dependencies).toHaveLength(SCALE.useChainModules - 1);
    expect(Object.keys(entry.classes)).toHaveLength(SCALE.useChainModules);

    const css = entry.css ?? "";
    expect(css.length).toBeGreaterThan(0);
    expect(cssErrorMessages(css)).toEqual([]);

    // Deepest module first, entry module last: the chain order survives at 1 000.
    const deepest = css.indexOf(".c999 ");
    const first = css.indexOf(".c0 ");
    expect(deepest).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(deepest);
    expect((css.match(/^\.c\d+ \{/gmu) ?? []).length).toBe(SCALE.useChainModules);
  }, 120_000);
});

describe("TT2 diamond graph of 500 modules", () => {
  test("resolves the shared module once and is byte-identical across two builds", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/diamond");
    const project = diamondProject(rng);
    expect(Object.keys(project.files)).toHaveLength(SCALE.graphModules);

    const host = createMemoryHost(project.files, ROOT);
    const entryPath = `${ROOT}/${project.entries[0] ?? ""}`;
    const firstGraph = await buildModuleGraph([entryPath], host, { file: "src/entry.cssx" });
    const secondGraph = await buildModuleGraph([entryPath], host, { file: "src/entry.cssx" });
    expect(firstGraph.diagnostics).toEqual([]);
    expect(secondGraph.diagnostics).toEqual([]);

    const firstOrder = styleModuleOrder(firstGraph, entryPath);
    const secondOrder = styleModuleOrder(secondGraph, entryPath);
    expect(firstOrder).toHaveLength(SCALE.graphModules - 1);
    expect(secondOrder).toEqual(firstOrder);

    const first = await compileProject(project.entries, host, {
      projectRoot: ROOT,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    const second = await compileProject(project.entries, host, {
      projectRoot: ROOT,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const entry = first["src/entry.cssx"];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.diagnostics).toEqual([]);
    expect(Object.keys(entry.classes)).toHaveLength(SCALE.graphModules);

    const css = entry.css ?? "";
    expect(cssErrorMessages(css)).toEqual([]);
    // The shared `c` module is merged exactly once, before the leaves.
    expect((css.match(/^\.c \{/gmu) ?? []).length).toBe(1);
    expect(css.indexOf(".c {")).toBeLessThan(css.indexOf(".a0 {"));
  }, 120_000);
});

describe("TT2 cycle graph of 500 modules", () => {
  test("reports one typed cycle diagnostic, terminates, and repeats byte-identically", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/cycle");
    const project = cycleProject(rng);
    expect(Object.keys(project.files)).toHaveLength(SCALE.graphModules);

    const host = createMemoryHost(project.files, ROOT);
    const entryPath = `${ROOT}/${project.entries[0] ?? ""}`;
    const graph = await buildModuleGraph([entryPath], host, { file: "src/m0.cssx" });
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    expect(graph.diagnostics[0]?.severity).toBe("error");
    expect(graph.diagnostics[0]?.message).toContain("Import cycle detected");
    expect(styleModuleOrder(graph, entryPath)).toHaveLength(SCALE.graphModules - 1);

    const first = await compileProject(project.entries, host, {
      projectRoot: ROOT,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    const second = await compileProject(project.entries, host, {
      projectRoot: ROOT,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const entry = first["src/m0.cssx"];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(errorCodes(entry.diagnostics)).toEqual(["XESSA2001"]);
    expect(entry.dependencies).toHaveLength(SCALE.graphModules - 1);
  }, 120_000);
});
