/**
 * TT2 benchmark-harness verification — plan §TT2 row 8 and weakest-10 #10.
 *
 * | Case | Assertion |
 * |---|---|
 * | `scripts/benchmark.ts --json` | exit 0; schema stable across two runs; fixture bytes identical across two runs; the reported zero-error claim independently re-checked |
 *
 * The harness calls `await main(process.argv.slice(2))` on import, so it is
 * subprocess-only. "Fixture bytes identical" is asserted two ways: the two
 * reports carry the same `outputBytes`, and this file's own byte-for-byte
 * replica of the harness generator (documented in `generate.ts`) compiles to
 * exactly that byte count. Only then is the zero-error claim re-checked by
 * compiling a generated entry here.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { compile, compileProject } from "../../../packages/compiler/src/index.ts";
import {
  benchmarkArtifactBytes,
  benchmarkShapedProject,
  cleanupTempProjects,
  createMemoryHost,
  createTempProject,
  cssErrorMessages,
  projectOutputOptions,
  readProjectFile,
  runBenchmark,
  valueShape,
} from "./generate.ts";

afterAll(cleanupTempProjects);

/** Top-level keys every JSON report must carry; a schema change must be deliberate. */
const REPORT_KEYS = [
  "coldBuild",
  "diagnostics",
  "entries",
  "environment",
  "files",
  "generationBaseline",
  "generationMs",
  "incremental",
  "memory",
  "outputBytes",
  "parseProxy",
] as const;

/** The benchmark generator's recorded artifact byte count for 100 files. */
const RECORDED_OUTPUT_BYTES_100 = 95_086;

interface Report {
  readonly files: number;
  readonly entries: number;
  readonly diagnostics: number;
  readonly outputBytes: number;
  readonly coldBuild: { readonly medianMs: number; readonly samplesMs: readonly number[] };
  readonly memory: { readonly peakRssMb: number };
  readonly environment: { readonly timestamp: string };
}

describe("TT2 scripts/benchmark.ts --json", () => {
  test("two runs exit 0 with a stable schema and identical fixture byte counts", () => {
    const first = runBenchmark(100);
    const second = runBenchmark(100);
    for (const run of [first, second]) {
      expect(run.outcome.status).toBe(0);
      expect(run.outcome.stderr).toBe("");
      expect(run.report).toBeDefined();
    }
    const firstReport = first.report as Report;
    const secondReport = second.report as Report;

    expect(Object.keys(firstReport).sort()).toEqual([...REPORT_KEYS].sort());
    expect(valueShape(secondReport)).toEqual(valueShape(firstReport));

    for (const report of [firstReport, secondReport]) {
      expect(report.files).toBe(100);
      expect(report.entries).toBe(100);
      expect(report.diagnostics).toBe(0);
      expect(report.coldBuild.samplesMs).toHaveLength(5);
      expect(report.coldBuild.medianMs).toBeGreaterThan(0);
      expect(report.memory.peakRssMb).toBeGreaterThan(0);
    }

    // Fixture + artifact bytes are deterministic; timings and timestamps are not.
    expect(secondReport.outputBytes).toBe(firstReport.outputBytes);
    expect(firstReport.outputBytes).toBe(RECORDED_OUTPUT_BYTES_100);
    expect(secondReport.environment.timestamp).not.toBe(firstReport.environment.timestamp);
  }, 240_000);

  test("the harness fixture generator is reproduced byte-for-byte in this harness", async () => {
    const report = runBenchmark(100).report as Report;
    const replicated = benchmarkShapedProject(100);
    expect(replicated.entries).toHaveLength(100);
    const bytes = await benchmarkArtifactBytes(replicated);
    expect(bytes).toBe(report.outputBytes);
    expect(report.outputBytes).toBe(RECORDED_OUTPUT_BYTES_100);
  }, 240_000);

  test("the reported zero-error claim is independently re-checked on a generated entry", async () => {
    const project = benchmarkShapedProject(100);
    const root = createTempProject(project.files);
    const entry = project.entries[50] ?? project.entries[0] ?? "";
    const source = readProjectFile(root, entry);
    expect(source.length).toBeGreaterThan(0);

    const single = await compile(source, {
      file: entry,
      workspaceRoot: root,
      mediaGrouping: "safe",
    });
    expect(single.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(cssErrorMessages(single.css ?? "")).toEqual([]);

    const results = await compileProject(project.entries, createMemoryHost(project.files), {
      projectRoot: "/workspace",
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    const errors: string[] = [];
    for (const [file, result] of Object.entries(results)) {
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity === "error") errors.push(`${file}: ${diagnostic.code}`);
      }
      errors.push(...cssErrorMessages(result.css ?? "").map((message) => `${file}: ${message}`));
    }
    expect(errors).toEqual([]);
  }, 240_000);
});
