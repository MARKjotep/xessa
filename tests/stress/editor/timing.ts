/**
 * Latency measurement helpers for the TT6 editor stress harness.
 *
 * Contract (plan §TT6): numbers are **measured and recorded**, and assertions
 * only compare against a generous ceiling so CI cannot flake on a slow machine.
 * No case asserts an exact millisecond value, and no case asserts that a
 * measurement is "fast" beyond {@link HARD_CEILING_MS}.
 */

/** Hard latency ceiling every measured editor operation must stay under. */
export const HARD_CEILING_MS = 500;

/**
 * Ceiling for the one operation that re-runs the whole pipeline including the
 * compiler (cold-cache analysis), which is inherently the slowest path.
 */
export const COMPILE_CEILING_MS = 5_000;

/** One measured distribution. */
export interface TimingStats {
  /** Number of measured samples (warm-up excluded). */
  readonly samples: number;
  /** Median sample in milliseconds. */
  readonly p50: number;
  /** 95th percentile sample in milliseconds (nearest rank). */
  readonly p95: number;
  /** Largest sample in milliseconds. */
  readonly max: number;
  /** Sum of measured samples in milliseconds. */
  readonly total: number;
}

/**
 * Nearest-rank percentile over an ascending array.
 *
 * Nearest rank (no interpolation) keeps the number reproducible and makes the
 * p95 sample a real observation rather than an average of two runs.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

/** Round to one decimal so the recorded table stays readable and stable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Time `run` `samples` times after `warmup` untimed calls.
 *
 * `performance.now()` is used only to *record* durations; it never seeds any
 * generated input.
 */
export function timeRepeated(
  run: () => unknown,
  options: { readonly warmup?: number; readonly samples?: number } = {},
): TimingStats {
  const warmup = options.warmup ?? 5;
  const samples = Math.max(1, options.samples ?? 50);
  for (let index = 0; index < warmup; index += 1) run();

  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((left, right) => left - right);
  return {
    samples,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
    total: round(durations.reduce((sum, value) => sum + value, 0)),
  };
}

/**
 * Async variant of {@link timeRepeated} for one awaited call per sample.
 *
 * Kept separate because `performance.now()` around a promise would otherwise
 * measure only the synchronous part (the compile-backed analysis path).
 */
export async function timeRepeatedAsync(
  run: () => Promise<unknown>,
  options: { readonly warmup?: number; readonly samples?: number } = {},
): Promise<TimingStats> {
  const warmup = options.warmup ?? 1;
  const samples = Math.max(1, options.samples ?? 5);
  for (let index = 0; index < warmup; index += 1) await run();

  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((left, right) => left - right);
  return {
    samples,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
    total: round(durations.reduce((sum, value) => sum + value, 0)),
  };
}

/** Human-readable one-line row for the recorded latency table. */
export function formatRow(label: string, stats: TimingStats): string {
  return `${label.padEnd(44, " ")} n=${String(stats.samples).padStart(4, " ")}  p50=${stats.p50
    .toFixed(1)
    .padStart(7, " ")}ms  p95=${stats.p95.toFixed(1).padStart(7, " ")}ms  max=${stats.max
    .toFixed(1)
    .padStart(7, " ")}ms`;
}

/** Accumulates rows so one file prints a single table at the end. */
export class TimingTable {
  private readonly rows: string[] = [];

  /** Record one measured case. */
  add(label: string, stats: TimingStats): TimingStats {
    this.rows.push(formatRow(label, stats));
    return stats;
  }

  /** Print the whole table (bun test shows this in the run output). */
  print(title: string): void {
    console.log(`\n[TT6 latency] ${title}`);
    for (const row of this.rows) console.log(`  ${row}`);
  }
}
