#!/usr/bin/env bun
/**
 * TT7 cold-build identity driver — the long form of `cold-build.test.ts`.
 *
 * Runs `--builds` consecutive cold builds of the same generated project (a fresh
 * `mkdtemp` project per build, so no manifest and no warm state survives), hashes
 * every artifact — CSS, source map, `.d.ts`, JS and `.cssx-manifest.json` — and
 * prints one JSON summary with the per-build time, artifact count, byte total and
 * fingerprint.
 *
 * Usage:
 *
 *   bun tests/stress/soak/cold-build.ts [--builds 20] [--files 1000] [--seed 1]
 *                                       [--out <file>] [--help]
 *
 * Exit codes: `0` every build was byte-identical, `1` a difference was found,
 * `2` bad usage.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  SOAK_DEFAULTS,
  cleanupSoakProjects,
  flagNumber,
  flagValue,
  machineContext,
  runColdBuilds,
} from "./helpers.ts";

const USAGE = [
  "TT7 cold-build identity driver",
  "",
  "Usage: bun tests/stress/soak/cold-build.ts [options]",
  "",
  "  --builds <n>  consecutive cold builds to compare (default: 20)",
  "  --files <n>   sources in the generated project (default: 1000)",
  "  --seed <n>    generator seed (default: 1)",
  "  --out <file>  also write the JSON summary to this path",
  "  --help        print this text",
].join("\n");

function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const builds = flagNumber(argv, "--builds", SOAK_DEFAULTS.coldBuilds);
  const files = flagNumber(argv, "--files", SOAK_DEFAULTS.coldFiles);
  const seed = flagNumber(argv, "--seed", SOAK_DEFAULTS.seed);
  const out = flagValue(argv, "--out");
  if (builds < 2 || files < 1) {
    console.error("error: --builds must be >= 2 and --files >= 1");
    return 2;
  }

  console.error(`[cold-build] builds=${builds} files=${files} seed=${seed}`);
  const startedAt = Date.now();
  const result = runColdBuilds({
    builds,
    files,
    seed,
    onRun: (run) => {
      console.error(
        `[cold-build] run ${run.run}/${builds} ${run.elapsedMs}ms ` +
          `artifacts=${run.artifactCount} bytes=${run.artifactBytes} ${run.fingerprint.slice(0, 19)}…`,
      );
    },
  });

  const elapsed = result.runs.map((run) => run.elapsedMs);
  const summary = {
    case: "TT7 cold-build identity",
    ok: result.identical && result.runs.every((run) => run.status === 0 && run.errors.length === 0),
    machine: machineContext(),
    config: { builds, files, seed },
    wallClockMs: Date.now() - startedAt,
    identical: result.identical,
    mismatches: result.mismatches,
    missing: result.missing,
    artifactCount: result.runs[0]?.artifactCount ?? 0,
    artifactBytes: result.runs[0]?.artifactBytes ?? 0,
    buildMs: {
      min: Math.min(...elapsed),
      median: [...elapsed].sort((left, right) => left - right)[Math.floor(elapsed.length / 2)] ?? 0,
      max: Math.max(...elapsed),
      total: elapsed.reduce((sum, value) => sum + value, 0),
    },
    fingerprints: [...new Set(result.runs.map((run) => run.fingerprint))],
    runs: result.runs,
  };

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, "utf8");
    console.error(`[cold-build] summary written to ${out}`);
  }
  process.stdout.write(text);
  console.error(
    `[cold-build] ${summary.ok ? "PASS" : "FAIL"} ${result.runs.length} builds, ` +
      `identical=${result.identical} artifacts=${summary.artifactCount} ` +
      `mismatches=${result.mismatches.length} missing=${result.missing.length}`,
  );
  return summary.ok ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} finally {
  cleanupSoakProjects();
}
