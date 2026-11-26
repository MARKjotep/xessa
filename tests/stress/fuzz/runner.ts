#!/usr/bin/env bun
/**
 * TT1 long-run entry point.
 *
 * `bun test tests/stress/fuzz/` runs a bounded budget (default 200 cases per
 * area); this runner drives the same areas at any budget and exits non-zero on
 * the first area that reports a violation. No defect is exempted any more, so
 * the `pinned=` counter is expected to stay 0 (the field remains for
 * owner-approved pins).
 *
 * Usage:
 *
 *   bun tests/stress/fuzz/runner.ts [--area lexer,parser,compile,roundtrip,determinism]
 *                                   [--budget N] [--seed N] [--timeout-ms N] [--help]
 *
 * Seed and budget fall back to `XESSA_STRESS_SEED` / `XESSA_STRESS_BUDGET` and
 * then to 1 / 200, so a plain `bun tests/stress/fuzz/runner.ts` is reproducible
 * anywhere. Every failure prints the seed, the stable input hash, the case label
 * and a command that replays it; the per-case ceiling (`MAX_CASE_MS`) counts a
 * hang as a violation instead of blocking the run, and `--timeout-ms` bounds the
 * whole invocation.
 *
 * Exit codes: `0` every area clean, `1` a violation was found, `2` bad usage.
 */

import { readStressBudget, readStressSeed } from "../prng.ts";
import { AREA_NAMES, isAreaName, runArea } from "./areas.ts";
import type { AreaName, AreaRun, Violation } from "./areas.ts";

/** Overall default ceiling for one invocation: ten minutes. */
const DEFAULT_TIMEOUT_MS = 600_000;

interface Options {
  readonly areas: readonly AreaName[];
  readonly budget: number;
  readonly seed: number;
  readonly timeoutMs: number;
}

/** Usage text printed by `--help` and on a usage error. */
const USAGE = [
  "TT1 stress runner — deterministic compiler fuzz",
  "",
  "Usage: bun tests/stress/fuzz/runner.ts [options]",
  "",
  "  --area <names>       comma-separated: lexer, parser, compile, roundtrip, determinism",
  "                       (default: all areas)",
  "  --budget <n>         randomized cases per area (default: XESSA_STRESS_BUDGET or 200)",
  "  --seed <n>           PRNG seed (default: XESSA_STRESS_SEED or 1)",
  `  --timeout-ms <n>     whole-run ceiling in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
  "  --help               print this text",
  "",
  "Exit codes: 0 clean, 1 violation, 2 bad usage.",
].join("\n");

/** Parse a positive decimal integer flag value. */
function parsePositive(name: string, raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    throw new Error(`${name} needs a non-negative integer, received ${JSON.stringify(raw)}`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} needs a positive safe integer, received ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Parse an argument list; throws with a usage message on bad input. */
function parseArguments(argv: readonly string[]): Options | "help" {
  let areas: readonly AreaName[] = AREA_NAMES;
  let budget = readStressBudget();
  let seed = readStressSeed();
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return "help";
    const value = argv[index + 1];
    if (flag === "--area") {
      const names = (value ?? "").split(",").map((name) => name.trim());
      if (names.length === 0 || names.some((name) => name.length === 0)) {
        throw new Error(`--area needs a comma-separated list, received ${JSON.stringify(value)}`);
      }
      const unknown = names.filter((name) => !isAreaName(name));
      if (unknown.length > 0) {
        throw new Error(`unknown area(s) ${unknown.join(", ")}; known: ${AREA_NAMES.join(", ")}`);
      }
      areas = names.filter((name): name is AreaName => isAreaName(name));
      index += 1;
      continue;
    }
    if (flag === "--budget") {
      budget = parsePositive("--budget", value);
      index += 1;
      continue;
    }
    if (flag === "--seed") {
      if (value === undefined || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`--seed needs a non-negative integer, received ${JSON.stringify(value)}`);
      }
      seed = Number(value);
      index += 1;
      continue;
    }
    if (flag === "--timeout-ms") {
      timeoutMs = parsePositive("--timeout-ms", value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${JSON.stringify(flag)}`);
  }

  return { areas, budget, seed, timeoutMs };
}

/** Print one failing case with everything needed to reproduce it. */
function reportViolation(violation: Violation, seed: number, budget: number): void {
  console.error(`  ✗ ${violation.area} · ${violation.caseLabel}`);
  console.error(`    ${violation.message}`);
  console.error(`    seed=${seed} budget=${budget} inputHash=${violation.inputHash}`);
  if (violation.limitation !== undefined) {
    console.error(`    pinned defect: ${violation.limitation}`);
  }
  console.error(`    replay: ${violation.reproducer}`);
}

/** Print the summary line for one area. */
function reportArea(run: AreaRun): void {
  const status = run.violations.length === 0 ? "ok" : "FAIL";
  console.log(
    `  ${status.padEnd(4)} ${run.area.padEnd(12)} cases=${String(run.cases).padStart(6)} ` +
      `time=${String(run.elapsedMs).padStart(6)}ms ` +
      `violations=${run.violations.length} pinned=${run.limitations.length}`,
  );
}

/** Race a promise against a timeout; rejects with a labelled error on expiry. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded the ${timeoutMs}ms run ceiling (hang, not a slow case)`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Run every requested area and return the process exit code. */
async function main(argv: readonly string[]): Promise<number> {
  let options: Options | "help";
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    return 2;
  }
  if (options === "help") {
    console.log(USAGE);
    return 0;
  }

  console.log(
    `TT1 stress: seed=${options.seed} budget=${options.budget} areas=${options.areas.join(",")} ` +
      `timeout=${options.timeoutMs}ms`,
  );

  const runs: AreaRun[] = [];
  const failures: { readonly violation: Violation; readonly run: AreaRun }[] = [];
  try {
    const run = await withTimeout(
      (async (): Promise<AreaRun[]> => {
        const results: AreaRun[] = [];
        for (const area of options.areas) {
          const result = await runArea(area, { seed: options.seed, budget: options.budget });
          reportArea(result);
          results.push(result);
        }
        return results;
      })(),
      options.timeoutMs,
      "run",
    );
    runs.push(...run);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(
      `reproduce: XESSA_STRESS_SEED=${options.seed} bun tests/stress/fuzz/runner.ts ` +
        `--area ${options.areas.join(",")} --budget ${options.budget} --seed ${options.seed}`,
    );
    return 1;
  }

  for (const result of runs) {
    for (const violation of result.violations) failures.push({ violation, run: result });
  }

  const totalCases = runs.reduce((total, result) => total + result.cases, 0);
  const totalLimitations = runs.reduce((total, result) => total + result.limitations.length, 0);
  const elapsed = runs.reduce((total, result) => total + result.elapsedMs, 0);

  if (failures.length === 0) {
    console.log(
      `PASS seed=${options.seed} budget=${options.budget} cases=${totalCases} ` +
        `pinned=${totalLimitations} time=${elapsed}ms`,
    );
    return 0;
  }

  console.error(
    `FAIL ${failures.length} violation(s) at seed=${options.seed} budget=${options.budget}`,
  );
  for (const failure of failures) {
    reportViolation(failure.violation, failure.run.seed, failure.run.budget);
  }
  console.error(
    `reproduce: XESSA_STRESS_SEED=${options.seed} bun tests/stress/fuzz/runner.ts ` +
      `--area ${options.areas.join(",")} --budget ${options.budget} --seed ${options.seed}`,
  );
  return 1;
}

// A failing stress run must fail CI; `process.exitCode` is enough because every
// timer created for `--timeout-ms` is cleared, so nothing keeps the loop alive.
process.exitCode = await main(process.argv.slice(2));
