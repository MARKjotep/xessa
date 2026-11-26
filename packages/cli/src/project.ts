/**
 * Project resolution shared by every command.
 *
 * A project is the workspace root (nearest `xessa.config.json`, else nearest
 * `package.json`, ADR-0007), the configuration found there and the entry list:
 * either one explicit file or the sources matched by the config include globs.
 * Configuration is optional for project runs: without a file the root still
 * comes from the workspace walk and discovery uses {@link DEFAULT_INCLUDE}.
 */

import { stat } from "node:fs/promises";
import type { CliInvocation } from "./args.js";
import { type CliConfig, DEFAULT_INCLUDE, findWorkspaceRoot, loadConfig } from "./config.js";
import { discoverSources } from "./glob.js";
import { absolutePath, dirnamePosix, isWithin, relativePosix } from "./paths.js";

/** Resolved project inputs for one CLI run. */
export interface ProjectContext {
  /** Absolute POSIX workspace root. */
  readonly root: string;
  /** Loaded configuration, or `null` for a config-less project/single-file run. */
  readonly config: CliConfig | null;
  /** Non-fatal configuration notes (ignored unknown keys outside strict mode). */
  readonly configWarnings: readonly string[];
  /** Entry sources, workspace-relative POSIX and deterministically sorted. */
  readonly entries: readonly string[];
  /** Whether the run targets one explicit file instead of the whole project. */
  readonly singleEntry: boolean;
}

/** Outcome of {@link prepareProject}. */
export type ProjectContextResult =
  | { readonly ok: true; readonly context: ProjectContext }
  | { readonly ok: false; readonly message: string };

/**
 * Resolve configuration, workspace root and entries for build/check/watch.
 *
 * Configuration is optional. Without a file, the workspace root is the nearest
 * `package.json` ancestor (ADR-0007) and project discovery uses
 * {@link DEFAULT_INCLUDE}; a single-entry run falls back to the file's
 * directory when no package boundary exists. Explicitly configuring an empty
 * `include` list remains an invocation error, and an empty discovery result is
 * reported by the command as a configuration error (typo protection).
 */
export async function prepareProject(
  invocation: CliInvocation,
  cwd: string,
): Promise<ProjectContextResult> {
  const fileArgument = invocation.file;
  let fileAbsolute: string | undefined;
  let startDir = cwd;

  if (fileArgument !== undefined) {
    fileAbsolute = absolutePath(cwd, fileArgument);
    if (!(await isFile(fileAbsolute))) {
      return { ok: false, message: `Source file not found: ${fileArgument}` };
    }
    startDir = dirnamePosix(fileAbsolute);
  }

  const loaded = await loadConfig({
    cwd,
    startDir,
    ...(invocation.configPath === undefined ? {} : { explicitPath: invocation.configPath }),
  });
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const config = loaded.config;
  const root = config === null ? await findWorkspaceRoot(startDir) : config.root;

  if (fileAbsolute !== undefined) {
    if (!isWithin(root, fileAbsolute)) {
      return {
        ok: false,
        message: `Source file "${fileArgument ?? fileAbsolute}" is outside the workspace root "${root}". Pass --config for the containing project.`,
      };
    }
    return {
      ok: true,
      context: {
        root,
        config,
        configWarnings: loaded.warnings,
        entries: [relativePosix(root, fileAbsolute)],
        singleEntry: true,
      },
    };
  }

  if (config !== null && config.include.length === 0) {
    return {
      ok: false,
      message: `"include" in ${config.file} must list at least one glob.`,
    };
  }

  const entries = await discoverSources({
    root,
    include: config?.include ?? DEFAULT_INCLUDE,
    exclude: config?.exclude ?? [],
  });

  return {
    ok: true,
    context: {
      root,
      config,
      configWarnings: loaded.warnings,
      entries,
      singleEntry: false,
    },
  };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
