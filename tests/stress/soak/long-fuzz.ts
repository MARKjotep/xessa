#!/usr/bin/env bun
/**
 * TT7 long-fuzz driver — plan §TT7 row 4 ("the TT1 runner at the maximum budget").
 *
 * Runs `tests/stress/fuzz/runner.ts` once per area at `--budget` (default
 * 100 000) and records, per area: exit code, cases, elapsed time, violation count,
 * pinned-limitation count and the reproduction command the runner printed.
 *
 * The `compile` area used to be **expected** to exit 1 for pinned defect
 * `CSSX-T3` (an out-of-bounds `XESSA2001` span on `$`-prefixed tokens). That
 * defect is fixed, so every area is expected to exit 0 and no outcome is
 * classified as expected. The driver still records out-of-bounds violations
 * separately, because they are a useful regression signal, but any failing area
 * is an unexpected failure that fails the driver.
 *
 * Usage:
 *
 *   bun tests/stress/soak/long-fuzz.ts [--budget 100000] [--seed 1]
 *                                      [--areas lexer,parser,compile,roundtrip,determinism]
 *                                      [--timeout-ms 1800000] [--log-dir .ai/reports/logs]
 *                                      [--out <file>] [--help]
 *
 * Exit codes: `0` every area exited clean, `1` an unexpected failure, `2` bad
 * usage.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../corpus.ts";
import {
  type CliOutcome,
  SOAK_DEFAULTS,
  flagNumber,
  flagValue,
  machineContext,
} from "./helpers.ts";

/** Areas the TT1 runner knows; every one is expected to exit 0. */
const DEFAULT_AREAS = ["lexer", "parser", "compile", "roundtrip", "determinism"];

/** Everything parsed out of one runner invocation. */
interface AreaOutcome {
  readonly area: string;
  readonly exitCode: number;
  readonly cases: number | null;
  readonly timeMs: number | null;
  readonly violations: number | null;
  readonly pinned: number | null;
  readonly outOfBoundsSpans: number;
  readonly violationLines: readonly string[];
  readonly reproducer: string | null;
  readonly durationMs: number;
  readonly logPath: string | null;
}

const USAGE = [
  "TT7 long-fuzz driver",
  "",
  "Usage: bun tests/stress/soak/long-fuzz.ts [options]",
  "",
  "  --budget <n>        cases per area (default: 100000)",
  "  --seed <n>          PRNG seed (default: 1)",
  "  --areas <names>     comma-separated areas (default: lexer,parser,compile,roundtrip,determinism)",
  "  --timeout-ms <n>    ceiling for one area run (default: 1800000)",
  "  --log-dir <dir>     directory for per-area raw logs (default: .ai/reports/logs)",
  "  --out <file>        also write the JSON summary to this path",
  "  --help              print this text",
].join("\n");

/** Run the TT1 runner for one area. */
function runArea(area: string, budget: number, seed: number, timeoutMs: number): CliOutcome {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "tests/stress/fuzz/runner.ts"),
      "--area",
      area,
      "--budget",
      String(budget),
      "--seed",
      String(seed),
      "--timeout-ms",
      String(timeoutMs),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: timeoutMs + 60_000,
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  return {
    status: result.status ?? -1,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    stderr: "",
    elapsedMs: performance.now() - started,
  };
}

/** Parse one runner output into an {@link AreaOutcome}. */
function parseArea(
  area: string,
  outcome: CliOutcome,
  durationMs: number,
  logPath: string | null,
): AreaOutcome {
  const summary =
    /^\s+(ok|FAIL)\s+(\S+)\s+cases=\s*(\d+)\s+time=\s*(\d+)ms\s+violations=(\d+)\s+pinned=(\d+)/mu.exec(
      outcome.stdout,
    );
  const violationLines: string[] = [];
  const lines = outcome.stdout.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("  ✗ ")) {
      violationLines.push(
        [line, lines[index + 1] ?? "", lines[index + 2] ?? ""].join(" | ").trim(),
      );
    }
  }
  const outOfBoundsSpans = violationLines.filter((line) =>
    line.includes("out-of-bounds span"),
  ).length;
  const reproducer = /^reproduce: (.+)$/mu.exec(outcome.stdout)?.[1]?.trim() ?? null;
  return {
    area,
    exitCode: outcome.status,
    cases: summary === null ? null : Number(summary[3]),
    timeMs: summary === null ? null : Number(summary[4]),
    violations: summary === null ? null : Number(summary[5]),
    pinned: summary === null ? null : Number(summary[6]),
    outOfBoundsSpans,
    violationLines: violationLines.slice(0, 5),
    reproducer,
    durationMs,
    logPath,
  };
}

function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const budget = flagNumber(argv, "--budget", SOAK_DEFAULTS.fuzzBudget);
  const seed = flagNumber(argv, "--seed", SOAK_DEFAULTS.seed);
  const timeoutMs = flagNumber(argv, "--timeout-ms", 1_800_000);
  const logDir = flagValue(argv, "--log-dir") ?? join(REPO_ROOT, ".ai/reports/logs");
  const out = flagValue(argv, "--out");
  const areas = (flagValue(argv, "--areas") ?? DEFAULT_AREAS.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (budget < 1 || areas.length === 0) {
    console.error("error: --budget must be >= 1 and --areas must not be empty");
    console.error(USAGE);
    return 2;
  }

  console.error(`[long-fuzz] budget=${budget} seed=${seed} areas=${areas.join(",")}`);
  const startedAt = Date.now();
  const outcomes: AreaOutcome[] = [];
  for (const area of areas) {
    const outcome = runArea(area, budget, seed, timeoutMs);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `CSSX-TT7-fuzz-${area}.log`);
    const truncated =
      outcome.stdout.length > 8 * 1024 * 1024
        ? `${outcome.stdout.slice(0, 8 * 1024 * 1024)}\n…(truncated)…\n`
        : outcome.stdout;
    writeFileSync(logPath, truncated, "utf8");
    const parsed = parseArea(area, outcome, Math.round(outcome.elapsedMs), logPath);
    outcomes.push(parsed);
    console.error(
      `[long-fuzz] ${area} exit=${parsed.exitCode} cases=${parsed.cases ?? "?"} ` +
        `violations=${parsed.violations ?? "?"} pinned=${parsed.pinned ?? "?"} ` +
        `t=${Math.round(outcome.elapsedMs / 1000)}s`,
    );
  }

  const unexpected = outcomes.filter((outcome) => outcome.exitCode !== 0);
  const clean = outcomes.filter((outcome) => outcome.exitCode === 0);
  const summary = {
    case: "TT7 long fuzz",
    ok: unexpected.length === 0,
    machine: machineContext(),
    config: { budget, seed, areas, timeoutMs },
    wallClockMs: Date.now() - startedAt,
    command: `XESSA_STRESS_BUDGET=${budget} bun tests/stress/fuzz/runner.ts --area <area> --seed ${seed}`,
    cleanAreas: clean.map((outcome) => outcome.area),
    unexpectedFailures: unexpected.map((outcome) => outcome.area),
    totals: {
      cases: outcomes.reduce((sum, outcome) => sum + (outcome.cases ?? 0), 0),
      violations: outcomes.reduce((sum, outcome) => sum + (outcome.violations ?? 0), 0),
      pinned: outcomes.reduce((sum, outcome) => sum + (outcome.pinned ?? 0), 0),
      outOfBoundsSpans: outcomes.reduce((sum, outcome) => sum + outcome.outOfBoundsSpans, 0),
    },
    areas: outcomes,
  };

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, "utf8");
    console.error(`[long-fuzz] summary written to ${out}`);
  }
  process.stdout.write(text);
  console.error(
    `[long-fuzz] ${summary.ok ? "PASS" : "FAIL"} clean=${summary.cleanAreas.join(",")} ` +
      `unexpected=${summary.unexpectedFailures.join(",") || "none"} ` +
      `cases=${summary.totals.cases} violations=${summary.totals.violations}`,
  );
  return summary.ok ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
