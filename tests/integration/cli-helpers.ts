/**
 * Shared helpers for CLI integration tests.
 *
 * Tests copy a fixture into a fresh temporary workspace and drive the real CLI
 * through `bun` (and, in the Node smoke suite, through the compiled `dist` with
 * plain `node`).
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root as an absolute path. */
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
/** CLI TypeScript entry point. */
export const cliEntry = join(repoRoot, "packages/cli/src/index.ts");
/** CLI compiled entry point (built by the Node smoke suite). */
export const cliDist = join(repoRoot, "packages/cli/dist/index.js");
/** CLI fixture root. */
export const fixtures = join(repoRoot, "tests/fixtures/cli");

/** Result of one CLI process run. */
export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one CLI process synchronously. */
export function runCli(
  args: readonly string[],
  cwd: string,
  options: { readonly exe?: string; readonly entry?: string } = {},
): CliResult {
  const result = spawnSync(options.exe ?? process.execPath, [options.entry ?? cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run the compiled CLI under plain `node`. */
export function runNodeCli(args: readonly string[], cwd: string): CliResult {
  return runCli(args, cwd, { exe: "node", entry: cliDist });
}

/** Copy a named fixture into a fresh temporary directory. */
export async function createProject(fixture: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xessa-cli-"));
  await cp(join(fixtures, fixture), directory, { recursive: true });
  return directory;
}

/** Create an empty temporary directory. */
export async function createTempDirectory(prefix = "xessa-cli-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove a temporary directory tree. */
export async function cleanup(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
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

/** Poll `predicate` until it returns true or the timeout elapses. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

/** Parse JSON of an expected shape, failing with the raw text when invalid. */
export function parseJson<T>(text: string | null): T {
  if (text === null) throw new Error("expected JSON output but the command wrote nothing");
  return JSON.parse(text) as T;
}

/** Minimal shape of a positioned CLI diagnostic. */
export interface CliDiagnosticShape {
  code: string;
  severity: "error" | "warning";
  message: string;
  file: string;
  line: number;
  column: number;
}

/** Minimal shape of a `--json` build/check report. */
export interface JsonReportShape {
  command: string;
  success: boolean;
  exitCode: number;
  dryRun: boolean;
  workspaceRoot: string;
  configFile: string | null;
  entries: Array<{
    file: string;
    dependencies: string[];
    outputs: Array<{ kind: string; path: string; written: boolean; reason?: string }>;
    diagnostics: CliDiagnosticShape[];
  }>;
  diagnostics: CliDiagnosticShape[];
  warnings: string[];
  errors: string[];
}

/** Minimal shape of a `--json` clean report. */
export interface JsonCleanShape {
  command: string;
  success: boolean;
  exitCode: number;
  dryRun: boolean;
  removed: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
  errors: string[];
}

/** Minimal shape of the on-disk manifest. */
export interface ManifestShape {
  version: number;
  files: Array<{ kind: string; path: string; source: string; hash: string }>;
}
