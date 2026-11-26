#!/usr/bin/env node
/**
 * `@xessa/cli` entry point.
 *
 * The CLI is a thin, dependency-free shell around the public compiler API. It
 * resolves project configuration, plans and compiles entries, writes artifacts
 * atomically, tracks them in a manifest, and optionally watches sources.
 *
 * Exit codes are contractual: 0 success, 1 compile/validation errors, 2
 * invocation or configuration errors.
 */

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { USAGE, parseArgs } from "./args.js";
import { runBuild } from "./commands/build.js";
import { runCheck } from "./commands/check.js";
import { runClean } from "./commands/clean.js";
import { runFormat } from "./commands/format.js";
import { runWatch } from "./commands/watch.js";
import { invocationFailure, writeErrorLine, writeLine } from "./report.js";

export type { CliInvocation, CommandName, ParseOutcome } from "./args.js";
export { USAGE, parseArgs } from "./args.js";
export type { CliConfig, ConfigLoadOutcome, LoadConfigRequest } from "./config.js";
export {
  findConfigPath,
  findWorkspaceRoot,
  loadConfig,
  parseConfigDocument,
} from "./config.js";
export type { DiscoverOptions } from "./glob.js";
export { discoverSources, expandBraces, globToRegExp, isExcluded, matchesGlob } from "./glob.js";
export type { BuildReport, CliDiagnostic, JsonBuildReport } from "./report.js";
export type { ProjectContext } from "./project.js";
export { prepareProject } from "./project.js";
export type { ExecuteBuildOptions, ExecuteBuildResult } from "./commands/build.js";
export { executeBuild, runBuild } from "./commands/build.js";
export { runCheck } from "./commands/check.js";
export { runClean } from "./commands/clean.js";
export type { FormatFileRecord, JsonFormatReport } from "./commands/format.js";
export { runFormat } from "./commands/format.js";
export { runWatch } from "./commands/watch.js";
export { loadFormatter } from "./formatter.js";
export type { FormatterApi } from "./formatter.js";
export { MANIFEST_FILENAME, readManifest, writeManifest } from "./manifest.js";
export { atomicWrite, hashContent, hashFile } from "./writer.js";

/** Execute one CLI invocation and return its exit code. */
export async function main(
  argv: readonly string[],
  cwd: string = process.cwd(),
  signal?: AbortSignal,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    return invocationFailure(commandLabel(argv), parsed.message, parsed.json);
  }

  if (parsed.help) {
    writeLine(USAGE.trimEnd());
    return 0;
  }
  if (parsed.version) {
    writeLine(await readVersion());
    return 0;
  }

  const invocation = parsed.invocation;
  switch (invocation.command) {
    case "build":
      return runBuild(invocation, cwd);
    case "check":
      return runCheck(invocation, cwd);
    case "watch":
      return runWatch({ invocation, cwd, ...(signal === undefined ? {} : { signal }) });
    case "clean":
      return runClean(invocation, cwd);
    case "format":
      return runFormat(invocation, cwd);
    case "help":
      writeLine(USAGE.trimEnd());
      return 0;
  }
}

function commandLabel(argv: readonly string[]): string {
  for (const argument of argv) {
    if (!argument.startsWith("-")) return argument;
  }
  return "xessa";
}

let cachedVersion: string | undefined;

/** Read the CLI version from its package manifest, falling back to `0.0.0`. */
async function readVersion(): Promise<string> {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    cachedVersion = typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

/** Whether this module is the process entry point. */
function isEntryPoint(): boolean {
  const meta = import.meta as ImportMeta & { main?: boolean };
  if (typeof meta.main === "boolean") return meta.main;

  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  main(process.argv.slice(2), process.cwd(), controller.signal)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      writeErrorLine(`xessa: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
