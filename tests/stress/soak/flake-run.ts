#!/usr/bin/env bun
/**
 * TT7 flake-detection driver — plan §TT7 row 3.
 *
 * Runs the two full gates from the repository root, `--runs` times each:
 *
 * - `bun run verify` — `bun run typecheck && bun run lint && bun run test`
 * - `bun run test:browser` — Playwright across Chromium, Firefox and WebKit
 *
 * and records per-run pass/fail counts plus the wall-clock duration. A run whose
 * exit code is non-zero (or whose `fail` count is non-zero) is a flake: its
 * complete output is written verbatim to `<log-dir>/CSSX-TT7-flake-<suite>-run<n>.log`
 * and its tail is embedded in the JSON summary.
 *
 * Usage:
 *
 *   bun tests/stress/soak/flake-run.ts [--runs 5] [--suites verify,browser]
 *                                      [--timeout-ms 1800000]
 *                                      [--log-dir .ai/reports/logs]
 *                                      [--out <file>] [--help]
 *
 * Exit codes: `0` no flake, `1` at least one flake, `2` bad usage.
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

/** The gates this case drives, keyed by the `--suites` name. */
const SUITES = Object.freeze({
  verify: { label: "bun run verify", args: ["run", "verify"] },
  browser: { label: "bun run test:browser", args: ["run", "test:browser"] },
});

type SuiteName = keyof typeof SUITES;

const USAGE = [
  "TT7 flake-detection driver",
  "",
  "Usage: bun tests/stress/soak/flake-run.ts [options]",
  "",
  "  --runs <n>          runs per suite (default: 5)",
  "  --suites <names>    comma-separated: verify, browser (default: verify,browser)",
  "  --timeout-ms <n>    ceiling for one run (default: 1800000)",
  "  --log-dir <dir>     where failing-run output is written (default: .ai/reports/logs)",
  "  --out <file>        also write the JSON summary to this path",
  "  --help              print this text",
].join("\n");

/** Counts parsed out of one suite's output. */
interface SuiteCounts {
  readonly pass: number | null;
  readonly fail: number | null;
  readonly tests: number | null;
  readonly files: number | null;
  readonly flaky: number | null;
  readonly skipped: number | null;
}

/** Counts from a Bun test summary block ("1160 pass", "0 fail", "Ran N tests across M files"). */
function parseVerify(output: string): SuiteCounts {
  const pass = /^\s*(\d+)\s+pass\s*$/mu.exec(output);
  const fail = /^\s*(\d+)\s+fail\s*$/mu.exec(output);
  const ran = /Ran (\d+) tests? across (\d+) files?/u.exec(output);
  return {
    pass: pass === null ? null : Number(pass[1]),
    fail: fail === null ? null : Number(fail[1]),
    tests: ran === null ? null : Number(ran[1]),
    files: ran === null ? null : Number(ran[2]),
    flaky: null,
    skipped: null,
  };
}

/** Counts from a Playwright summary block ("96 passed (1.7m)", "2 failed"). */
function parseBrowser(output: string): SuiteCounts {
  const counts = new Map<string, number>();
  const pattern = /^\s*(\d+)\s+(passed|failed|flaky|skipped|did not run|interrupted)\b/gmu;
  for (const match of output.matchAll(pattern)) {
    const value = Number(match[1]);
    const label = match[2] ?? "";
    if (!counts.has(label)) counts.set(label, value);
  }
  return {
    pass: counts.get("passed") ?? null,
    fail: counts.get("failed") ?? null,
    tests: null,
    files: null,
    flaky: counts.get("flaky") ?? null,
    skipped: counts.get("skipped") ?? null,
  };
}

/** Run one gate from the repository root. */
function runGate(args: readonly string[], timeoutMs: number): CliOutcome {
  const started = performance.now();
  const result = spawnSync(process.execPath, [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    stderr: "",
    elapsedMs: performance.now() - started,
  };
}

/** Trim a log for the JSON summary so the file stays a pointer, not a dump. */
function tail(text: string, limit = 6_000): string {
  return text.length <= limit ? text : `…(truncated)…\n${text.slice(-limit)}`;
}

function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const runs = flagNumber(argv, "--runs", SOAK_DEFAULTS.flakeRuns);
  const timeoutMs = flagNumber(argv, "--timeout-ms", 1_800_000);
  const logDir = flagValue(argv, "--log-dir") ?? join(REPO_ROOT, ".ai/reports/logs");
  const out = flagValue(argv, "--out");
  const names = (flagValue(argv, "--suites") ?? "verify,browser")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const unknown = names.filter((name) => !Object.hasOwn(SUITES, name));
  if (runs < 1 || names.length === 0 || unknown.length > 0) {
    console.error(`error: bad --runs/--suites (unknown: ${unknown.join(", ") || "none"})`);
    console.error(USAGE);
    return 2;
  }
  const suites = names as SuiteName[];

  console.error(`[flake] runs=${runs} suites=${suites.join(",")} timeout=${timeoutMs}ms`);
  const startedAt = Date.now();
  const results = suites.map((suite) => {
    const runsOut: Array<Record<string, unknown>> = [];
    let flakes = 0;
    for (let run = 1; run <= runs; run += 1) {
      const outcome = runGate(SUITES[suite].args, timeoutMs);
      const counts =
        suite === "verify" ? parseVerify(outcome.stdout) : parseBrowser(outcome.stdout);
      const flaked = outcome.status !== 0 || (counts.fail ?? 0) > 0;
      if (flaked) {
        flakes += 1;
        mkdirSync(logDir, { recursive: true });
        const logPath = join(logDir, `CSSX-TT7-flake-${suite}-run${run}.log`);
        writeFileSync(logPath, outcome.stdout, "utf8");
        console.error(
          `[flake] ${suite} run ${run}/${runs} FLAKE (exit ${outcome.status}) -> ${logPath}`,
        );
      } else {
        console.error(
          `[flake] ${suite} run ${run}/${runs} pass=${counts.pass ?? "?"} ` +
            `fail=${counts.fail ?? 0} ${Math.round(outcome.elapsedMs / 1000)}s`,
        );
      }
      runsOut.push({
        run,
        exit: outcome.status,
        durationMs: Math.round(outcome.elapsedMs),
        ...counts,
        flaked,
        ...(flaked ? { outputTail: tail(outcome.stdout) } : {}),
      });
    }
    return { suite, command: SUITES[suite].label, runs: runsOut, flakes, requestedRuns: runs };
  });

  const summary = {
    case: "TT7 flake detection",
    ok: results.every((suite) => suite.flakes === 0),
    machine: machineContext(),
    config: { runs, suites, timeoutMs },
    wallClockMs: Date.now() - startedAt,
    flakeRate: Object.fromEntries(results.map((suite) => [suite.suite, `${suite.flakes}/${runs}`])),
    suites: results,
  };

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, "utf8");
    console.error(`[flake] summary written to ${out}`);
  }
  process.stdout.write(text);
  const rates = results.map((suite) => `${suite.suite}=${suite.flakes}/${runs}`).join(" ");
  console.error(`[flake] ${summary.ok ? "PASS" : "FAIL"} flake rate ${rates}`);
  return summary.ok ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
