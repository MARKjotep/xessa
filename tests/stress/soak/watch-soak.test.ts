/**
 * TT7 · Watch soak (`.ai/plans/CSSX-PLAN-TESTING.md` §TT7 row 1).
 *
 * | Case | Assertion |
 * |---|---|
 * | Watch soak | `xessa watch` on a generated project with an edit per interval: watcher RSS sampled continuously (bounded growth, series recorded), no watcher stall (every edit produces a fresh artifact), manifest stays consistent |
 *
 * Gated by `XESSA_SOAK=1` (see `tests/stress/README.md` and plan §TT7): the
 * committed run is the short shape of the same case (16 edits, 250 ms apart,
 * 100-file project) so it finishes in seconds, while the 30-minute release run is
 * driven by `soak-watch.ts` with the same implementation.
 *
 * Knobs (all optional): `XESSA_SOAK_WATCH_FILES`, `XESSA_SOAK_WATCH_EDITS`,
 * `XESSA_SOAK_WATCH_INTERVAL_MS`, `XESSA_SOAK_WATCH_SAMPLE_MS`,
 * `XESSA_SOAK_WATCH_TIMEOUT_MS`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  SOAK_DEFAULTS,
  SOAK_ENABLED,
  SOAK_SKIP_LABEL,
  cleanupSoakProjects,
  createSoakProject,
  projectFiles,
  readSoakInteger,
} from "./helpers.ts";
import { WATCH_RSS_CEILING_MB, WATCH_RSS_GROWTH_MB, runWatchSoak } from "./watch-soak-case.ts";

afterEach(() => {
  cleanupSoakProjects();
});

describe.skipIf(!SOAK_ENABLED)(`TT7 watch soak${SOAK_SKIP_LABEL}`, () => {
  test("every edit lands a fresh artifact, memory stays bounded and the manifest stays consistent", async () => {
    const fileCount = readSoakInteger("XESSA_SOAK_WATCH_FILES", SOAK_DEFAULTS.watchFiles);
    const edits = readSoakInteger("XESSA_SOAK_WATCH_EDITS", SOAK_DEFAULTS.watchEdits);
    const editIntervalMs = readSoakInteger(
      "XESSA_SOAK_WATCH_INTERVAL_MS",
      SOAK_DEFAULTS.watchEditIntervalMs,
    );
    const sampleIntervalMs = readSoakInteger(
      "XESSA_SOAK_WATCH_SAMPLE_MS",
      SOAK_DEFAULTS.watchSampleIntervalMs,
    );
    const buildTimeoutMs = readSoakInteger(
      "XESSA_SOAK_WATCH_TIMEOUT_MS",
      SOAK_DEFAULTS.watchBuildTimeoutMs,
    );

    const root = createSoakProject(projectFiles(fileCount));
    const result = await runWatchSoak({
      root,
      fileCount,
      edits,
      editIntervalMs,
      sampleIntervalMs,
      buildTimeoutMs,
    });

    console.log(
      `[TT7 watch soak] files=${result.fileCount} edits=${result.edits.length} ` +
        `builds=${result.builds} debounce=${result.debounceMs}ms sources=${result.readySources} ` +
        `latency p50=${percentile(
          result.edits.map((edit) => edit.latencyMs),
          0.5,
        )}ms ` +
        `max=${Math.max(...result.edits.map((edit) => edit.latencyMs))}ms`,
    );
    console.log(
      `[TT7 watch soak] rss samples=${result.rss.count} first=${result.rss.firstMb}MB ` +
        `last=${result.rss.lastMb}MB min=${result.rss.minMb}MB max=${result.rss.maxMb}MB ` +
        `growth=${result.rss.growthMb}MB peak-to-trough=${result.rss.peakToTroughMb}MB ` +
        `span=${result.rss.spanMs}ms`,
    );
    console.log(
      `[TT7 watch soak] manifest records=${result.manifest.records} ` +
        `artifacts=${result.manifest.artifacts} problems=${result.manifest.problems.length} ` +
        `staleDiscards=${result.staleDiscards}`,
    );

    // No stall: every edit's marker was observed and every revision produced a
    // *new* artifact hash (a reused hash would mean a stale artifact).
    expect(result.edits).toHaveLength(edits);
    expect(result.distinctArtifacts).toBe(edits);
    expect(result.edits.at(-1)?.marker).toBe(`rgb(${edits}, 0, 17)`);

    // Watcher health: every build event succeeded, at least one per edit, and
    // no feedback storm from the watcher observing its own outputs.
    expect(result.buildsHealthy).toBe(true);
    expect(result.buildDiagnostics).toEqual([]);
    // At the race-reaching cadence a change can legitimately invalidate one
    // in-flight generation; the latch guarantees at most one discard per edit
    // and that the invalidating change itself still lands.
    expect(result.staleDiscards).toBeLessThanOrEqual(edits);
    expect(result.builds).toBeGreaterThanOrEqual(edits);
    expect(result.builds).toBeLessThanOrEqual(2 * edits + 1);
    expect(result.watchExitCode).toBe(0);

    // Bounded memory, backed by the recorded series rather than one sample.
    expect(result.samples.length).toBeGreaterThanOrEqual(2);
    expect(result.rss.maxMb).toBeLessThan(WATCH_RSS_CEILING_MB);
    expect(result.rss.growthMb).toBeLessThan(WATCH_RSS_GROWTH_MB);

    // Manifest consistency: one record per emitted artifact, hashes match.
    expect(result.manifest.problems).toEqual([]);
    expect(result.manifest.artifacts).toBe(4 * fileCount);
    expect(result.manifest.records).toBe(4 * fileCount);
  }, 1_800_000);
});

/** Nearest-rank percentile of a numeric series (integer milliseconds). */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}
