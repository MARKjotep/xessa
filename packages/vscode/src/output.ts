/**
 * Output planning and safe writes for the extension commands.
 *
 * The compiler's `planOutputs` remains the single authority for destinations,
 * containment, name validation and collisions. This module only decodes the
 * file-level `@setup` block into `ResolvedSetup` (the planner needs the
 * authored values) and performs temp-file-plus-rename writes, mirroring the
 * CLI writer without importing it.
 */

import { realpathSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { planOutputs } from "../../compiler/src/index.js";
import type {
  OutputKind,
  PlanOutputsResult,
  ProjectConfig,
  ResolvedSetup,
} from "../../compiler/src/index.js";
import type { AnalysisProblem, SetupSetting } from "./analysis.js";
import { basenamePath, dirnamePath, normalizePath, stemOf } from "./paths.js";

let temporaryCounter = 0;

/** Default setup values for one source path (mirrors the compiler defaults). */
export function defaultSetupFor(sourcePath: string): ResolvedSetup {
  const directory = dirnamePath(sourcePath);
  const stem = stemOf(basenamePath(sourcePath));
  return {
    prefix: "",
    cssDir: directory,
    mapDir: directory,
    cssName: `${stem}.css`,
    mapName: `${stem}.map.js`,
    emitCss: true,
    emitMap: true,
    emitTypes: false,
    sourceMap: false,
    minify: true,
  };
}

const BOOLEAN_KEYS = new Set([
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "module",
]);

/**
 * Decode the file `@setup` values over the built-in defaults.
 *
 * `prefix` is passed separately because the effective prefix already merged
 * project configuration and the naming strategy in the analysis layer.
 */
export function fileSetup(
  sourcePath: string,
  settings: readonly SetupSetting[],
  prefix: string,
): ResolvedSetup {
  const setup: { -readonly [Key in keyof ResolvedSetup]: ResolvedSetup[Key] } = {
    ...defaultSetupFor(sourcePath),
    prefix,
  };
  let moduleOnly = false;
  // `map-types` is canonical; `emit-types` remains a deprecated alias. Resolve
  // after the loop so the canonical key wins regardless of authored order.
  let mapTypes: boolean | undefined;
  let emitTypes: boolean | undefined;
  for (const setting of settings) {
    const value = setting.value;
    switch (setting.key) {
      case "prefix":
        break;
      case "css-dir":
        setup.cssDir = value;
        break;
      case "css-name":
        setup.cssName = value;
        break;
      case "map-dir":
        setup.mapDir = value;
        break;
      case "map-name":
        setup.mapName = value;
        break;
      default:
        if (BOOLEAN_KEYS.has(setting.key)) {
          const boolean = value === "true" ? true : value === "false" ? false : undefined;
          if (boolean === undefined) break;
          if (setting.key === "emit-css") setup.emitCss = boolean;
          if (setting.key === "emit-map") setup.emitMap = boolean;
          if (setting.key === "map-types") mapTypes = boolean;
          if (setting.key === "emit-types") emitTypes = boolean;
          if (setting.key === "source-map") setup.sourceMap = boolean;
          if (setting.key === "minify") setup.minify = boolean;
          if (setting.key === "module") moduleOnly = boolean;
        }
        break;
    }
  }
  if (mapTypes !== undefined) setup.emitTypes = mapTypes;
  else if (emitTypes !== undefined) setup.emitTypes = emitTypes;
  if (moduleOnly) {
    // ADR-0014: a rule-bearing module plans no artifacts of its own.
    setup.emitCss = false;
    setup.emitMap = false;
    setup.emitTypes = false;
  }
  return setup;
}

/** Project layer handed to the planner and to `compile`/`compileProject`. */
export function projectConfigOf(config: {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly output?: ProjectConfig["output"];
  readonly classes?: ProjectConfig["classes"];
  readonly media?: ProjectConfig["media"];
  readonly compiler?: ProjectConfig["compiler"];
}): ProjectConfig {
  return {
    include: config.include,
    exclude: config.exclude,
    ...(config.output === undefined ? {} : { output: config.output }),
    ...(config.classes === undefined ? {} : { classes: config.classes }),
    ...(config.media === undefined ? {} : { media: config.media }),
    ...(config.compiler === undefined ? {} : { compiler: config.compiler }),
  };
}

/** Canonicalize through `realpath` when possible, falling back to lexical paths. */
export function defaultCanonicalize(path: string): string {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(path);
  }
}

/** Plan every artifact for one entry through the compiler's output planner. */
export function planEntryOutputs(input: {
  readonly sourceFile: string;
  readonly workspaceRoot: string;
  readonly setup: ResolvedSetup;
  readonly projectConfig?: ProjectConfig;
  readonly canonicalize?: (path: string) => string;
}): PlanOutputsResult {
  const canonicalize = input.canonicalize ?? defaultCanonicalize;
  return planOutputs(
    {
      sourceFile: input.sourceFile,
      setup: input.setup,
      workspaceRoot: input.workspaceRoot,
      ...(input.projectConfig === undefined ? {} : { projectConfig: input.projectConfig }),
    },
    { host: { canonicalize } },
  );
}

/** Artifact contents keyed by kind for {@link writePlannedOutputs}. */
export type ArtifactContents = Partial<Record<OutputKind, string>>;

/**
 * Write planned artifacts atomically (temp file in the destination directory,
 * then rename). Returns the written absolute paths. Only planned artifacts with
 * content are written; anything else is skipped.
 */
export async function writePlannedOutputs(
  plan: PlanOutputsResult,
  contents: ArtifactContents,
): Promise<string[]> {
  if (plan.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("Refusing to write an invalid output plan.");
  }
  const written: string[] = [];
  for (const output of plan.plan.outputs) {
    const content = contents[output.kind];
    if (content === undefined) continue;
    await atomicWrite(output.absolutePath, content);
    written.push(output.absolutePath);
  }
  return written;
}

/** Write `content` atomically and return the destination path. */
export async function atomicWrite(path: string, content: string): Promise<string> {
  const destination = dirname(path);
  await mkdir(destination, { recursive: true });
  temporaryCounter += 1;
  const temporary = join(
    destination,
    `.${basename(path)}.${process.pid}.${temporaryCounter}.cssx-tmp`,
  );
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return path;
}

/** Human-readable one-line summary for the output channel. */
export function formatProblem(file: string, problem: AnalysisProblem): string {
  const position = `${problem.range.start.line + 1}:${problem.range.start.character + 1}`;
  return `${file}:${position} ${problem.severity} ${problem.code}: ${problem.message}`;
}

/** Artifact contents from a compile summary, limited to emitted artifacts. */
export function artifactContents(result: {
  readonly css?: string;
  readonly js?: string;
  readonly types?: string;
  readonly sourceMap?: string;
}): ArtifactContents {
  return {
    ...(result.css === undefined ? {} : { css: result.css }),
    ...(result.js === undefined ? {} : { js: result.js }),
    ...(result.types === undefined ? {} : { types: result.types }),
    ...(result.sourceMap === undefined ? {} : { cssSourceMap: result.sourceMap }),
  };
}
