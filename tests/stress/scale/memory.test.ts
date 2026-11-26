/**
 * TT2 memory at 1000 files — plan §TT2 row 7.
 *
 * | Case | Assertion |
 * |---|---|
 * | Memory at 1000 files | record RSS/peak against `docs/performance.md` medians; record, no hard pass/fail on the number itself — assert only that the run completes and outputs are valid |
 *
 * The build runs in its own process (`bun -e` probe) so `process.resourceUsage().maxRSS`
 * is not polluted by the test runner's earlier scale cases. The probe performs
 * one cold `compileProject` build — the harness in `scripts/benchmark.ts`
 * measures five builds plus fixture generation in its child, so the two numbers
 * are recorded side by side with that difference spelled out rather than
 * compared as if identical.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpus, release } from "node:os";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  SCALE,
  cleanupTempProjects,
  createTempProject,
  runMemoryProbe,
  thousandFileProject,
} from "./generate.ts";

/** Medians recorded in `docs/performance.md` for the 1 000-file benchmark run. */
const DOCS_MEDIAN = Object.freeze({
  rssMb: 109.0,
  heapUsedMb: 22.6,
  peakRssMb: 115.1,
  peakGrowthMb: 97.1,
});

/** Machine context required by the plan for any recorded number. */
const MACHINE = Object.freeze({
  cpu: cpus()[0]?.model.trim() ?? "unknown",
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  bun: process.versions.bun ?? "n/a",
  node: process.versions.node,
});

let root = "";
let probe: ReturnType<typeof runMemoryProbe>;

beforeAll(() => {
  const rng = createLabelledRng(readStressSeed(), "scale/memory");
  const project = thousandFileProject(rng);
  root = createTempProject(project.files);
  probe = runMemoryProbe(root, 240_000);
}, 240_000);

afterAll(cleanupTempProjects);

describe("TT2 memory at 1000 files", () => {
  test("an isolated cold build of 1000 files completes with valid outputs", () => {
    expect(probe.outcome.status).toBe(0);
    expect(probe.outcome.stderr).toBe("");
    const result = probe.result;
    expect(result).toBeDefined();
    if (result === undefined) return;

    expect(result.entries).toBe(SCALE.projectFiles);
    expect(result.errors).toBe(0);
    expect(result.classes).toBe(SCALE.projectFiles * 2);
    expect(result.cssBytes).toBeGreaterThan(0);
    // Recorded numbers must be real measurements, not placeholders.
    for (const value of [
      result.buildMs,
      result.baselineRssMb,
      result.rssMb,
      result.heapUsedMb,
      result.peakRssMb,
      result.growthMb,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(result.peakRssMb).toBeGreaterThan(result.baselineRssMb);
    expect(result.rssMb).toBeGreaterThan(result.baselineRssMb);
    // Peak and sampled RSS come from different probes (OS maxRSS page accounting
    // vs `process.memoryUsage()`), so they agree only within page granularity.
    expect(Math.abs(result.peakRssMb - result.rssMb)).toBeLessThan(8);
  }, 240_000);

  test("records the measurement against the docs/performance.md medians", () => {
    const result = probe.result;
    if (result === undefined) return;

    // Recorded only — the plan forbids a pass/fail threshold on the number.
    console.log(
      `[TT2 memory] 1000 files · build ${result.buildMs.toFixed(0)} ms · ` +
        `baseline RSS ${result.baselineRssMb.toFixed(1)} MB · ` +
        `after-build RSS ${result.rssMb.toFixed(1)} MB · ` +
        `heap ${result.heapUsedMb.toFixed(1)} MB · ` +
        `peak RSS ${result.peakRssMb.toFixed(1)} MB · ` +
        `peak growth ${result.growthMb.toFixed(1)} MB`,
    );
    console.log(
      `[TT2 memory] docs/performance.md medians (benchmark child: 5 builds + generation): RSS ${DOCS_MEDIAN.rssMb.toFixed(1)} MB · heap ${DOCS_MEDIAN.heapUsedMb.toFixed(1)} MB · peak ${DOCS_MEDIAN.peakRssMb.toFixed(1)} MB · growth ${DOCS_MEDIAN.peakGrowthMb.toFixed(1)} MB`,
    );
    console.log(
      `[TT2 memory] machine: ${MACHINE.cpu} · ${MACHINE.platform}/${MACHINE.arch} ` +
        `${MACHINE.osRelease} · Bun ${MACHINE.bun} · Node ${MACHINE.node}`,
    );

    // The recorded figure is a measurement of this method, not the benchmark's.
    expect(result.peakRssMb).toBeGreaterThan(0);
    expect(result.peakRssMb).toBeLessThan(4096);
    expect(DOCS_MEDIAN.peakRssMb).toBeGreaterThan(DOCS_MEDIAN.rssMb);
  }, 240_000);
});
