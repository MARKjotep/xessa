#!/usr/bin/env bun
/**
 * TT7 watch-soak driver — the long form of `watch-soak.test.ts`.
 *
 * Runs a real `xessa watch --json` on a generated project, edits one source every
 * `--edit-interval-s` seconds, samples the watcher's RSS while it waits, and
 * prints one JSON summary (plus a progress line per edit on stderr). Every edit's
 * emitted CSS must contain that revision's marker; a missed marker inside
 * `--timeout-ms` is a watcher stall and fails the run.
 *
 * Usage:
 *
 *   bun tests/stress/soak/soak-watch.ts [--minutes 30] [--edit-interval-s 30]
 *                                       [--files 100] [--seed 1] [--sample-interval-s 10]
 *                                       [--timeout-ms 90000] [--out <file>] [--help]
 *
 * The release run of the plan's §TT7 row is `--minutes 30 --edit-interval-s 30`,
 * which drives 60 edits. Temp project: one `mkdtemp` dir, removed on exit.
 *
 * Exit codes: `0` every edit landed with bounded memory and a consistent
 * manifest, `1` a soak assertion failed, `2` bad usage.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  SOAK_DEFAULTS,
  cleanupSoakProjects,
  createSoakProject,
  flagNumber,
  flagValue,
  machineContext,
  projectFiles,
} from "./helpers.ts";
import { WATCH_RSS_CEILING_MB, WATCH_RSS_GROWTH_MB, runWatchSoak } from "./watch-soak-case.ts";

const USAGE = [
  "TT7 watch-soak driver",
  "",
  "Usage: bun tests/stress/soak/soak-watch.ts [options]",
  "",
  "  --minutes <n>            soak length in minutes (default: 30)",
  "  --edit-interval-s <n>    seconds between edits (default: 30)",
  "  --files <n>              sources in the generated project (default: 100)",
  "  --seed <n>               generator seed (default: 1)",
  "  --sample-interval-s <n>  watcher RSS sampling period (default: 10)",
  "  --timeout-ms <n>         per-edit ceiling before it counts as a stall (default: 90000)",
  "  --out <file>             also write the JSON summary to this path",
  "  --help                   print this text",
].join("\n");

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const minutes = flagNumber(argv, "--minutes", 30);
  const editIntervalMs = flagNumber(argv, "--edit-interval-s", 30) * 1_000;
  const fileCount = flagNumber(argv, "--files", SOAK_DEFAULTS.watchFiles);
  const seed = flagNumber(argv, "--seed", SOAK_DEFAULTS.seed);
  const sampleIntervalMs = flagNumber(argv, "--sample-interval-s", 10) * 1_000;
  const buildTimeoutMs = flagNumber(argv, "--timeout-ms", 90_000);
  const out = flagValue(argv, "--out");
  const edits = Math.max(1, Math.round((minutes * 60_000) / editIntervalMs));

  if (edits < 1 || editIntervalMs < 100 || fileCount < 1) {
    console.error("error: --minutes, --edit-interval-s and --files must describe a real soak");
    return 2;
  }

  console.error(
    `[soak-watch] files=${fileCount} edits=${edits} every=${editIntervalMs}ms ` +
      `(~${((edits * editIntervalMs) / 60_000).toFixed(1)} min) sample=${sampleIntervalMs}ms seed=${seed}`,
  );

  const root = createSoakProject(projectFiles(fileCount, seed));
  const startedAt = Date.now();
  const result = await runWatchSoak({
    root,
    fileCount,
    edits,
    editIntervalMs,
    sampleIntervalMs,
    buildTimeoutMs,
    onEdit: (edit) => {
      if (edit.revision % 5 === 0 || edit.revision === edits) {
        console.error(
          `[soak-watch] edit ${edit.revision}/${edits} ${edit.source} ` +
            `latency=${edit.latencyMs}ms builds=${edit.builds} rss=${edit.rssMb ?? "n/a"}MB`,
        );
      }
    },
  });

  const failures: string[] = [];
  if (result.edits.length !== edits)
    failures.push(`only ${result.edits.length}/${edits} edits ran`);
  if (result.distinctArtifacts !== edits) {
    failures.push(`${result.distinctArtifacts}/${edits} distinct artifact hashes`);
  }
  if (!result.buildsHealthy)
    failures.push(`build diagnostics: ${result.buildDiagnostics.join("; ")}`);
  if (result.manifest.problems.length > 0) {
    failures.push(`manifest: ${result.manifest.problems.slice(0, 5).join("; ")}`);
  }
  if (result.rss.maxMb >= WATCH_RSS_CEILING_MB) {
    failures.push(`rss max ${result.rss.maxMb}MB >= ceiling ${WATCH_RSS_CEILING_MB}MB`);
  }
  if (result.rss.growthMb >= WATCH_RSS_GROWTH_MB) {
    failures.push(`rss growth ${result.rss.growthMb}MB >= bound ${WATCH_RSS_GROWTH_MB}MB`);
  }

  const summary = {
    case: "TT7 watch soak",
    ok: failures.length === 0,
    failures,
    machine: machineContext(),
    config: {
      files: fileCount,
      edits,
      editIntervalMs,
      sampleIntervalMs,
      buildTimeoutMs,
      seed,
      expectedMinutes: Math.round(((edits * editIntervalMs) / 60_000) * 10) / 10,
      rssCeilingMb: WATCH_RSS_CEILING_MB,
      rssGrowthBoundMb: WATCH_RSS_GROWTH_MB,
    },
    wallClockMs: Date.now() - startedAt,
    readySources: result.readySources,
    debounceMs: result.debounceMs,
    readyRssMb: result.readyRssMb,
    builds: result.builds,
    buildsHealthy: result.buildsHealthy,
    buildDiagnostics: result.buildDiagnostics,
    staleDiscards: result.staleDiscards,
    rss: result.rss,
    manifest: result.manifest,
    watchExitCode: result.watchExitCode,
    edits: result.edits,
    samples: result.samples,
  };

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, "utf8");
    console.error(`[soak-watch] summary written to ${out}`);
  }
  process.stdout.write(text);
  console.error(
    `[soak-watch] ${summary.ok ? "PASS" : "FAIL"} edits=${result.edits.length} builds=${result.builds} ` +
      `rss ${result.rss.minMb}-${result.rss.maxMb}MB growth=${result.rss.growthMb}MB ` +
      `p50=${median(result.edits.map((edit) => edit.latencyMs))}ms manifest=${result.manifest.records}`,
  );
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  return summary.ok ? 0 : 1;
}

/** Median of a numeric series (0 for an empty one). */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} finally {
  cleanupSoakProjects();
}
