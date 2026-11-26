#!/usr/bin/env bun
/**
 * Benchmark harness.
 *
 * Generates a deterministic synthetic project of N `.cssx` sources, then
 * measures, five times each and reporting the median:
 *
 * - **cold project build** — `compileProject` over every entry, rebuilding the
 *   module graph from disk on each run (no incremental state);
 * - **single-file incremental** — one `compile()` call for a representative
 *   entry, including reads of its imported token modules, excluding any output
 *   write;
 * - **parse proxy** — a tolerant `parse()` of that entry, the cheapest model of
 *   the work an editor does per analysis pass;
 * - **memory** — current RSS/heap after the build and the OS-reported peak RSS
 *   of the process (which also includes fixture generation; the generation
 *   baseline is printed so the delta is visible).
 *
 * Each size runs in its own child process so peak memory is not polluted by a
 * larger run. Usage:
 *
 *   bun scripts/benchmark.ts                 # both sizes, table output
 *   bun scripts/benchmark.ts --size 1000     # one size
 *   bun scripts/benchmark.ts --json          # machine-readable
 *
 * Everything is measured, nothing is promised. Results belong in
 * `docs/performance.md` with the machine context.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cpus, release, tmpdir } from "node:os";
import { join } from "node:path";
import { compile, compileProject, createNodeHost, parse } from "../packages/compiler/src/index.ts";

/** Runs per measurement; the median is reported. */
const RUNS = 5;

/** Benchmark sizes. */
const DEFAULT_SIZES = [100, 1000];

/** Token modules in the import chain (each source imports the last one). */
const CHAIN_LENGTH = 10;

interface Measurement {
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly samplesMs: readonly number[];
}

interface SizeReport {
  readonly files: number;
  readonly entries: number;
  readonly generationMs: number;
  readonly generationBaseline: {
    readonly rssMb: number;
    readonly heapUsedMb: number;
    readonly peakRssMb: number;
  };
  readonly coldBuild: Measurement;
  readonly incremental: Measurement;
  readonly parseProxy: Measurement;
  readonly memory: {
    readonly rssMb: number;
    readonly heapUsedMb: number;
    readonly peakRssMb: number;
    readonly peakGrowthMb: number;
  };
  readonly outputBytes: number;
  readonly diagnostics: number;
  readonly environment: Environment;
}

interface Environment {
  readonly platform: string;
  readonly arch: string;
  readonly osRelease: string;
  readonly cpu: string;
  readonly bun: string;
  readonly node: string;
  readonly timestamp: string;
}

/** Deterministic two-decimal millisecond formatting. */
function ms(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function median(samples: readonly number[]): Measurement {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : sorted[middle];
  return {
    medianMs: value ?? 0,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    samplesMs: samples,
  };
}

/** Deterministic synthetic stylesheet for one entry. */
function sourceFor(index: number): string {
  const pad = String(index).padStart(4, "0");
  const base = 12 + (index % 8);
  const wide = 20 + (index % 12);
  const gap = 8 + (index % 16);
  return `@use "./tokens.cssx" as t;
@use "./chain/chain-${CHAIN_LENGTH - 1}.cssx" as chain;
@variables {
  gap: $t.spacing;
  local: ${(index % 7) + 1}px;
}
.card-${pad} {
  display: flex;
  padding: $gap @md ${base}px @xl ${wide}px;
  margin: $local @dark 0;
  color: $chain.accent @dark #f8fafc;
  border-radius: 6px;
  &:hover { opacity: 0.85; }
  &:focus-visible { outline: 2px solid $chain.accent; }
  & > .icon-${pad} { width: 16px @lg 20px; }
  @md {
    gap: ${gap}px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
}

function tokenSource(): string {
  return `@variables {
  spacing: 12px;
  radius: 6px;
}
`;
}

function chainSource(level: number): string {
  const previous =
    level === 0 ? '@use "../tokens.cssx" as tokens;\n' : `@use "./chain-${level - 1}.cssx";\n`;
  const inherited = level === 0 ? "$tokens.spacing" : `$${level - 1}px`;
  return `${previous}@variables {
  accent: #2563eb;
  step-${level}: ${level}px;
  inherited-${level}: ${inherited};
}
`;
}

/** Write the fixture project and return its root plus entry paths. */
function generate(root: string, size: number): { entries: string[]; generationMs: number } {
  const started = performance.now();
  mkdirSync(join(root, "src", "chain"), { recursive: true });
  writeFileSync(join(root, "src", "tokens.cssx"), tokenSource());
  for (let level = 0; level < CHAIN_LENGTH; level += 1) {
    writeFileSync(join(root, "src", "chain", `chain-${level}.cssx`), chainSource(level));
  }
  const entries: string[] = [];
  const width = String(size).length;
  for (let index = 0; index < size; index += 1) {
    const name = `file-${String(index).padStart(width, "0")}.cssx`;
    writeFileSync(join(root, "src", name), sourceFor(index));
    entries.push(`src/${name}`);
  }
  return { entries, generationMs: performance.now() - started };
}

function environment(): Environment {
  const versions = process.versions as NodeJS.ProcessVersions & { bun?: string };
  const processors = cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpu: processors[0]?.model.trim() ?? "unknown",
    bun: versions.bun ?? "n/a",
    node: versions.node,
    timestamp: new Date().toISOString(),
  };
}

function errorCount(
  results: Record<string, { diagnostics: readonly { severity: string }[] }>,
): number {
  let errors = 0;
  for (const result of Object.values(results)) {
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === "error") errors += 1;
    }
  }
  return errors;
}

async function measureSize(size: number): Promise<SizeReport> {
  // macOS mkdtemp returns a /var path that canonicalizes to /private/var; the
  // compiler's containment checks use the canonical workspace root.
  const root = realpathSync(mkdtempSync(join(tmpdir(), `xessa-bench-${size}-`)));
  try {
    const { entries, generationMs } = generate(root, size);
    const baselineUsage = process.memoryUsage();
    const generationBaselinePeak = process.resourceUsage().maxRSS * 1024;

    const host = createNodeHost(root);
    const output = {
      cssDir: "dist/styles",
      mapDir: "dist/maps",
      emitCss: true,
      emitMap: true,
      mapTypes: true,
      sourceMap: false,
      minify: false,
    } as const;

    const coldSamples: number[] = [];
    let diagnostics = 0;
    let outputBytes = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const results = await compileProject(entries, host, {
        projectRoot: root,
        output,
        mediaGrouping: "safe",
      });
      coldSamples.push(performance.now() - started);
      diagnostics += errorCount(results);
      if (process.env.XESSA_BENCH_DEBUG === "1" && run === 0) {
        for (const [file, result] of Object.entries(results)) {
          for (const diagnostic of result.diagnostics) {
            if (diagnostic.severity === "error") {
              console.error(`${file}: ${diagnostic.code} ${diagnostic.message}`);
            }
          }
        }
      }
      if (run === 0) {
        for (const result of Object.values(results)) {
          outputBytes += Buffer.byteLength(result.css ?? "", "utf8");
          outputBytes += Buffer.byteLength(result.js ?? "", "utf8");
          outputBytes += Buffer.byteLength(result.types ?? "", "utf8");
        }
      }
    }

    // Incremental work excludes fixture reads but includes the entry's imports
    // (the compiler builds its module graph per call).
    const entry = entries[Math.floor(entries.length / 2)] ?? entries[0] ?? "";
    const sourceText = await readFile(join(root, entry), "utf8");
    const incrementalSamples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const result = await compile(sourceText, { file: entry, workspaceRoot: root });
      incrementalSamples.push(performance.now() - started);
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity === "error") diagnostics += 1;
      }
    }

    const parseSamples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const result = parse(sourceText, { file: entry });
      parseSamples.push(performance.now() - started);
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity === "error") diagnostics += 1;
      }
    }

    const usage = process.memoryUsage();
    const peak = process.resourceUsage().maxRSS * 1024;

    return {
      files: size,
      entries: entries.length,
      generationMs,
      generationBaseline: {
        rssMb: baselineUsage.rss / 1024 / 1024,
        heapUsedMb: baselineUsage.heapUsed / 1024 / 1024,
        peakRssMb: generationBaselinePeak / 1024 / 1024,
      },
      coldBuild: median(coldSamples),
      incremental: median(incrementalSamples),
      parseProxy: median(parseSamples),
      memory: {
        rssMb: usage.rss / 1024 / 1024,
        heapUsedMb: usage.heapUsed / 1024 / 1024,
        peakRssMb: peak / 1024 / 1024,
        peakGrowthMb: (peak - generationBaselinePeak) / 1024 / 1024,
      },
      outputBytes,
      diagnostics,
      environment: environment(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function printReport(report: SizeReport): void {
  const env = report.environment;
  console.log(`\n### ${report.files} source files`);
  console.log(`  fixture generation      ${ms(report.generationMs)}`);
  console.log(
    `  cold project build      ${ms(report.coldBuild.medianMs)} median ` +
      `(min ${ms(report.coldBuild.minMs)}, max ${ms(report.coldBuild.maxMs)}, n=${RUNS})`,
  );
  console.log(
    `  single-file compile()   ${ms(report.incremental.medianMs)} median ` +
      `(min ${ms(report.incremental.minMs)}, max ${ms(report.incremental.maxMs)})`,
  );
  console.log(
    `  parse() proxy           ${ms(report.parseProxy.medianMs)} median ` +
      `(min ${ms(report.parseProxy.minMs)}, max ${ms(report.parseProxy.maxMs)})`,
  );
  console.log(
    `  memory (after build)    rss ${report.memory.rssMb.toFixed(1)} MB, ` +
      `heap ${report.memory.heapUsedMb.toFixed(1)} MB`,
  );
  console.log(
    `  peak RSS                ${report.memory.peakRssMb.toFixed(1)} MB ` +
      `(generation baseline ${report.generationBaseline.peakRssMb.toFixed(1)} MB, ` +
      `build growth ${report.memory.peakGrowthMb.toFixed(1)} MB)`,
  );
  console.log(
    `  artifacts               ${report.outputBytes} bytes; errors ${report.diagnostics}`,
  );
  console.log(
    `  environment             ${env.cpu} · ${env.platform}/${env.arch} ${env.osRelease} · ` +
      `Bun ${env.bun} · Node ${env.node}`,
  );
}

async function main(argv: readonly string[]): Promise<number> {
  const wantsJson = argv.includes("--json");
  const sizeIndex = argv.indexOf("--size");
  const sizes =
    sizeIndex >= 0 && argv[sizeIndex + 1] !== undefined
      ? [Number(argv[sizeIndex + 1])]
      : DEFAULT_SIZES;

  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0) {
      console.error(`benchmark: invalid size "${String(size)}"`);
      return 2;
    }
  }

  const reports: SizeReport[] = [];
  for (const size of sizes) {
    if (wantsJson && sizes.length === 1) {
      reports.push(await measureSize(size));
    } else if (sizes.length === 1) {
      reports.push(await measureSize(size));
    } else {
      // Isolate peak memory per size in a child process.
      const result = spawnSync(
        process.execPath,
        [import.meta.path, "--size", String(size), "--json"],
        {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      if (result.status !== 0) {
        console.error(result.stderr || result.stdout);
        return result.status ?? 1;
      }
      reports.push(JSON.parse(result.stdout.trim()) as SizeReport);
    }
  }

  if (wantsJson) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
    return 0;
  }

  console.log("Xessa benchmarks — measured, not guaranteed");
  for (const report of reports) printReport(report);
  console.log(
    "\nTargets: completion under 100 ms for cached ordinary files; single-file incremental\n" +
      "compile under 100 ms excluding filesystem overhead. See docs/performance.md.",
  );
  return 0;
}

const code = await main(process.argv.slice(2));
process.exitCode = code;
