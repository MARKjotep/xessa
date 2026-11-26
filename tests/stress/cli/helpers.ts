/**
 * Shared harness for the TT4 CLI invocation-contract suites (`tests/stress/cli/**`).
 *
 * Every case copies a frozen fixture (or writes a synthetic project) into a
 * `mkdtemp` directory under the OS temp dir, drives the real CLI through the
 * same `bun <entry>` path `tests/integration/` uses, and cleans up afterwards.
 * Nothing is ever written inside the repository.
 *
 * Golden snapshots contain machine-specific absolute paths (`workspaceRoot`,
 * `configFile`). {@link normalizeOutput} rewrites those to the documented
 * `<ROOT>` placeholder before comparison, so goldens stay byte-stable on any
 * machine; {@link tempRootPrefixes} lets a case prove that no absolute temp path
 * survived normalisation.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root as an absolute path. */
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
/** CLI TypeScript entry point, executed through `bun` like the integration suite. */
export const cliEntry = join(repoRoot, "packages/cli/src/index.ts");
/** Frozen CLI fixtures (read-only inputs; always copied before use). */
export const fixturesDir = join(repoRoot, "tests/fixtures/cli");
/** Golden snapshot directory for this phase. */
export const goldenDir = fileURLToPath(new URL("./golden/", import.meta.url));
/** Documented placeholder that replaces the temp project root in goldens. */
export const ROOT_PLACEHOLDER = "<ROOT>";

/** Upper bound for one CLI process (invocation cases finish in milliseconds). */
const CLI_TIMEOUT_MS = 120_000;
/** Upper bound for every watch event await. */
export const WATCH_TIMEOUT_MS = 15_000;

/** Result of one CLI process run. */
export interface CliResult {
  /** Arguments after the entry point, as passed. */
  readonly args: readonly string[];
  /** Process exit code, or `-1` when the process was killed. */
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const temporaryProjects: string[] = [];

/**
 * Create a temporary project from a frozen fixture (default `basic`).
 *
 * The directory is registered for {@link cleanupProjects}; pass `""` as the
 * fixture to get an empty workspace.
 */
export async function createProject(
  fixture = "basic",
  prefix = "xessa-stress-cli-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  if (fixture !== "") await cp(join(fixturesDir, fixture), directory, { recursive: true });
  temporaryProjects.push(directory);
  return directory;
}

/** Remove every project created through {@link createProject}. */
export async function cleanupProjects(): Promise<void> {
  await Promise.all(
    temporaryProjects.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

/** Run one CLI process synchronously. */
export function runCli(args: readonly string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
  });
  return {
    args: [...args],
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run one CLI process asynchronously (used where two processes must overlap). */
export async function runCliAsync(args: readonly string[], cwd: string): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    child.exited,
  ]);
  return { args: [...args], status, stdout, stderr };
}

/** One running CLI process plus the promise of its result. */
export interface CliProcess {
  /** Live handle: `exitCode` is `null` while the process is running. */
  readonly child: { readonly exitCode: number | null };
  /** Resolves once the process exits and both streams are drained. */
  readonly result: Promise<CliResult>;
}

/**
 * Start one CLI process without awaiting it.
 *
 * Used by the concurrency case, which needs to observe that both processes are
 * alive at the same time before it awaits their results.
 */
export function spawnCli(args: readonly string[], cwd: string): CliProcess {
  const child = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = Promise.all([
    new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    child.exited,
  ]).then(([stdout, stderr, status]) => ({ args: [...args], status, stdout, stderr }));
  return { child, result };
}

/** Read a UTF-8 file, returning `null` when it does not exist. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Write a UTF-8 file, creating parent directories as needed. */
export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/** Whether a path exists. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Parse JSON from CLI output, failing with the raw text when it is not JSON. */
export function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `[${label}] expected JSON output, received: ${JSON.stringify(text.slice(0, 500))}`,
    );
  }
}

/**
 * Rewrite every form of a temp project root to {@link ROOT_PLACEHOLDER}.
 *
 * `mkdtemp` returns the un-resolved path (`/var/...` on macOS) while the CLI
 * reports the kernel's canonical path (`/private/var/...`), so both are
 * replaced. Longest first, so a nested root is never half-replaced.
 */
export function normalizeOutput(text: string, root: string): string {
  const variants = new Set<string>();
  for (const candidate of [root, safeRealpath(root)]) {
    if (candidate === null || candidate === "") continue;
    variants.add(candidate);
    variants.add(candidate.replace(/\\/g, "/"));
  }
  const ordered = [...variants].sort((left, right) => right.length - left.length);
  let normalized = text;
  for (const variant of ordered) normalized = normalized.split(variant).join(ROOT_PLACEHOLDER);
  return normalized;
}

/** Every spelling of the OS temp root, so a case can prove none leaked. */
export function tempRootPrefixes(): readonly string[] {
  const values = new Set<string>([tmpdir()]);
  const canonical = safeRealpath(tmpdir());
  if (canonical !== null) values.add(canonical);
  return [...values];
}

/** SHA-256 of a file's bytes in the manifest's `sha256:<hex>` form. */
export async function hashOfFile(path: string): Promise<string> {
  const data = await readFile(path);
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** Recursively list files below `directory` as sorted POSIX-relative paths. */
export async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), relative);
        continue;
      }
      found.push(relative);
    }
  };
  await walk(directory, "");
  return found.sort();
}

/**
 * Freeze a file's mtime to a fixed instant.
 *
 * Lets a case prove "no write happened" with a stable comparison instead of a
 * timing-dependent mtime delta.
 */
export async function freezeMtime(path: string, epochMs = 1_700_000_000_000): Promise<number> {
  const frozen = new Date(epochMs);
  await utimes(path, frozen, frozen);
  return epochMs;
}

/** Current mtime in milliseconds. */
export async function mtimeMs(path: string): Promise<number> {
  return (await stat(path)).mtimeMs;
}

/** Read a golden snapshot. */
export async function readGolden(name: string): Promise<string> {
  return await readFile(join(goldenDir, name), "utf8");
}

/** Write a golden snapshot (only used by the documented update flow). */
export async function writeGolden(name: string, text: string): Promise<void> {
  await mkdir(goldenDir, { recursive: true });
  await writeFile(join(goldenDir, name), text, "utf8");
}

/** One NDJSON event line plus its decoded object. */
export interface WatchLine {
  /** Raw line exactly as the CLI wrote it (without the trailing newline). */
  readonly raw: string;
  /** Decoded JSON object. */
  readonly value: Record<string, unknown>;
}

/** `xessa watch --json` child process with bounded awaits. */
export interface WatchHarness {
  /** Raw NDJSON lines observed so far, in order. */
  readonly lines: readonly string[];
  /** Await the next event of `type`, skipping other event types. */
  nextEvent(type: string, label: string): Promise<WatchLine>;
  /** Stop the child (SIGINT, then SIGKILL) and return its exit code. */
  stop(): Promise<number>;
}

/**
 * Start `xessa watch --json` in `root` and read its NDJSON stream.
 *
 * Awaits are bounded by {@link WATCH_TIMEOUT_MS} and the failure message names
 * the await plus the stderr tail, so a regression identifies itself.
 */
export function startWatchJson(root: string): WatchHarness {
  const child = Bun.spawn([process.execPath, cliEntry, "watch", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = child.stdout as ReadableStream<Uint8Array> | null;
  const stderr = child.stderr as ReadableStream<Uint8Array> | null;
  if (stdout === null || stderr === null) {
    throw new Error("watch process did not expose piped stdout/stderr");
  }

  const reader = stdout.getReader();
  const stderrReader = stderr.getReader();
  const decoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = "";
  let stderrTail = "";
  let stopped = false;

  // Drain stderr so a chatty process can never block on a full pipe.
  void (async () => {
    try {
      for (;;) {
        const chunk = await stderrReader.read();
        if (chunk.done) return;
        stderrTail = `${stderrTail}${stderrDecoder.decode(chunk.value, { stream: true })}`.slice(
          -4_000,
        );
      }
    } catch {
      // Stream closed with the process.
    }
  })();

  const diagnostics = (label: string): string =>
    `[${label}] lines seen: ${JSON.stringify(lines.map((line) => line.slice(0, 120)))}; ` +
    `stderr tail: ${stderrTail.slice(-1_000) || "(empty)"}`;

  const readLine = async (label: string, deadline: number): Promise<string> => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;
        return line;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`[${label}] timed out after ${WATCH_TIMEOUT_MS}ms: ${diagnostics(label)}`);
      }
      const readPromise = reader.read();
      // Guard the losing side of the timeout race against unhandled rejection.
      readPromise.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), Math.max(1, remaining));
      });
      try {
        const chunk = await Promise.race([readPromise, timeout]);
        if (chunk === "timeout") {
          throw new Error(
            `[${label}] timed out after ${WATCH_TIMEOUT_MS}ms: ${diagnostics(label)}`,
          );
        }
        if (chunk.done) {
          throw new Error(`[${label}] watch exited before the event: ${diagnostics(label)}`);
        }
        buffer = `${buffer}${decoder.decode(chunk.value, { stream: true })}`;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  };

  return {
    lines,
    nextEvent: async (type: string, label: string): Promise<WatchLine> => {
      const deadline = Date.now() + WATCH_TIMEOUT_MS;
      for (;;) {
        const raw = await readLine(label, deadline);
        let value: Record<string, unknown>;
        try {
          value = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // A non-JSON diagnostic line; keep looking.
          continue;
        }
        lines.push(raw);
        if (value.type === type) return { raw, value };
      }
    },
    stop: async (): Promise<number> => {
      if (stopped) return child.exitCode ?? 0;
      stopped = true;
      child.kill("SIGINT");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 5_000);
      });
      try {
        const result = await Promise.race([child.exited, timeout]);
        if (result === "timeout") {
          child.kill("SIGKILL");
          await child.exited;
        }
        return typeof result === "number" ? result : (child.exitCode ?? 0);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await reader.cancel().catch(() => undefined);
        await stderrReader.cancel().catch(() => undefined);
      }
    },
  };
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
