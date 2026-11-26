/**
 * Hand-rolled deterministic pseudo-randomness for the stress harness (TT1).
 *
 * Every stress case derives from this PRNG and nothing else: no `Math.random()`,
 * no wall clock, no PID and no OS entropy. The generator is xorshift128 over
 * four 32-bit words, seeded by expanding the numeric seed with a splitmix-style
 * scramble; all arithmetic is integer-only (`>>> 0`, `Math.imul`) so the same
 * seed yields the same sequence on every machine and every run.
 *
 * Seeds and budgets come from `XESSA_STRESS_SEED` / `XESSA_STRESS_BUDGET`
 * (defaults `1` and `200`) or from `--seed` / `--budget` in
 * `tests/stress/fuzz/runner.ts`. A failure is replayable because the case label,
 * the seed and a stable hash of the failing input are always reported.
 */

/** Environment surface the harness reads; narrowed so tests can inject one. */
export interface StressEnvironment {
  readonly XESSA_STRESS_SEED?: string | undefined;
  readonly XESSA_STRESS_BUDGET?: string | undefined;
}

/** Seed used when `XESSA_STRESS_SEED` is absent or empty. */
export const DEFAULT_STRESS_SEED = 1;

/**
 * Case budget used when `XESSA_STRESS_BUDGET` is absent or empty.
 *
 * 200 keeps `bun test` inside `bun run verify` fast; long runs opt in through
 * the environment variable or `runner.ts --budget`.
 */
export const DEFAULT_STRESS_BUDGET = 200;

/** Deterministic integer generator shared by every stress case. */
export interface StressRng {
  /** Numeric seed this generator was created from, for failure reports. */
  readonly seed: number;
  /** Next raw 32-bit word (the xorshift128 output step). */
  nextUint32(): number;
  /** Uniform integer in `[0, bound)`. `bound` must be a positive safe integer. */
  nextInt(bound: number): number;
  /** Uniform integer in `[min, max]` inclusive. */
  nextRange(min: number, max: number): number;
  /** Uniform byte in `[0, 255]`. */
  nextByte(): number;
  /** True with probability `numerator / denominator` (integer odds, no floats). */
  chance(numerator: number, denominator: number): boolean;
  /** Uniformly pick one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates copy of `items` in a deterministic order. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Parse a numeric environment value, rejecting anything that is not a safe non-negative integer. */
function readCount(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a non-negative integer, received ${JSON.stringify(raw)}`);
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer, received ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Effective seed: `XESSA_STRESS_SEED`, else {@link DEFAULT_STRESS_SEED}. */
export function readStressSeed(environment: StressEnvironment = process.env): number {
  return readCount("XESSA_STRESS_SEED", environment.XESSA_STRESS_SEED, DEFAULT_STRESS_SEED);
}

/** Effective case budget: `XESSA_STRESS_BUDGET`, else {@link DEFAULT_STRESS_BUDGET}. */
export function readStressBudget(environment: StressEnvironment = process.env): number {
  return readCount("XESSA_STRESS_BUDGET", environment.XESSA_STRESS_BUDGET, DEFAULT_STRESS_BUDGET);
}

/** Splitmix32 step: deterministic 32-bit avalanche used only to expand the seed. */
function splitmix32(value: number): number {
  let word = (value + 0x9e3779b9) >>> 0;
  word = (word ^ (word >>> 16)) >>> 0;
  word = Math.imul(word, 0x21f0aaad) >>> 0;
  word = (word ^ (word >>> 15)) >>> 0;
  word = Math.imul(word, 0x735a2d97) >>> 0;
  return (word ^ (word >>> 15)) >>> 0;
}

/**
 * Create a generator for `seed`.
 *
 * The four state words come from successive {@link splitmix32} steps and are
 * forced non-zero (xorshift128 is stuck at the all-zero state). Fractional or
 * negative seeds are folded into the 32-bit range by `>>> 0` after `| 0`.
 */
export function createRng(seed: number): StressRng {
  const normalized = (Math.trunc(seed) | 0) >>> 0;
  let x = splitmix32(normalized);
  let y = splitmix32(x);
  let z = splitmix32(y);
  let w = splitmix32(z);
  if ((x | y | z | w) === 0) x = 0x9e3779b9;

  const nextUint32 = (): number => {
    const t = (x ^ (x << 11)) >>> 0;
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };

  const nextInt = (bound: number): number => {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new Error(`nextInt bound must be a positive integer, received ${bound}`);
    }
    // Rejection sampling keeps the modulo unbiased without floating point.
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
    for (;;) {
      const word = nextUint32();
      if (word < limit) return word % bound;
    }
  };

  const nextRange = (min: number, max: number): number => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new Error(`nextRange needs integers with max >= min, received ${min}..${max}`);
    }
    return min + nextInt(max - min + 1);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("pick needs at least one item");
    const item = items[nextInt(items.length)];
    if (item === undefined) throw new Error("pick index out of range");
    return item;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = nextInt(index + 1);
      const held = copy[index] as T;
      copy[index] = copy[swap] as T;
      copy[swap] = held;
    }
    return copy;
  };

  return Object.freeze({
    seed: normalized,
    nextUint32,
    nextInt,
    nextRange,
    nextByte: (): number => nextInt(256),
    chance: (numerator: number, denominator: number): boolean => {
      if (denominator <= 0) throw new Error("chance denominator must be positive");
      return nextInt(denominator) < numerator;
    },
    pick,
    shuffle,
  });
}

/**
 * 64-bit FNV-1a style hash of a string, returned as 16 lowercase hex characters.
 *
 * Two independent 32-bit accumulators over UTF-16 code units keep the hash
 * integer-only and machine independent, so a reported hash identifies the exact
 * failing input on any platform. Surrogate halves are hashed as-is, which makes
 * lone-surrogate inputs hash distinctly from their replacement characters.
 */
export function hashString(text: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193 ^ 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    low = Math.imul(low ^ unit, 0x01000193) >>> 0;
    high = Math.imul(high ^ unit, 0x85ebca6b) >>> 0;
    high = (high ^ (high >>> 13)) >>> 0;
  }
  const hex = (value: number): string => value.toString(16).padStart(8, "0");
  return `${hex(high)}${hex(low)}`;
}

/** Stable 32-bit hash used to derive independent per-area/per-label streams. */
export function hash32(text: string): number {
  let low = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    low = Math.imul(low ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return splitmix32(low);
}

/**
 * Independent generator for one named area/case family.
 *
 * `createLabelledRng(seed, "compile")` is reproducible from the seed alone but
 * does not perturb the sequence of any other area, so `--area compile` and a
 * full run agree case for case.
 */
export function createLabelledRng(seed: number, label: string): StressRng {
  return createRng((seed ^ hash32(label)) >>> 0);
}
