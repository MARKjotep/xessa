/**
 * Destination resolution for the pure output planner.
 *
 * Precedence is built-in defaults, project configuration, file `@setup` and
 * explicit CLI overrides (SPECIFICATION.md §9.1). File-level directories are
 * exact and resolve against the source directory; project-level directories
 * resolve against the workspace root and preserve the source-relative
 * subdirectory; CLI directories resolve against the workspace root and are
 * exact because path overrides are single-entry only.
 *
 * `ResolvedSetup` is required and therefore cannot record whether a value was
 * authored or copied from a default. The planner treats a file-layer value that
 * equals the built-in default as unset so project configuration can still take
 * effect, and uses authored-value equality with `projectConfig.output` to infer
 * project-level directory provenance. This limitation is documented in
 * `.ai/reports/CSSX-A10.md`.
 */

import type { ResolvedSetup } from "../types/options.js";
import type { PlanOutputsInput } from "../types/result.js";
import {
  basenamePath,
  dirnamePath,
  isAbsolutePath,
  isSafeRelativePath,
  isWithinPath,
  joinPath,
  normalizePath,
  relativePath,
  toPosix,
} from "./paths.js";

/** Built-in output defaults from SPECIFICATION.md §9. */
export const OUTPUT_DEFAULTS: Readonly<{
  readonly emitCss: boolean;
  readonly emitMap: boolean;
  readonly emitTypes: boolean;
  readonly sourceMap: boolean;
  readonly minify: boolean;
  readonly mapInherit: boolean;
  readonly importCss: boolean;
}> = Object.freeze({
  emitCss: true,
  emitMap: true,
  // `.d.ts` beside the JS map is opt-in (`map-types`, CSSX-A52).
  emitTypes: false,
  sourceMap: false,
  // Compact CSS by default (ADR-0022); readers opt out with `minify: false`.
  minify: true,
  // Style-merged modules join the importing map unless they opt out (ADR-0020).
  mapInherit: true,
  // The map carries a CSS import only when a bundler consumer opts in (ADR-0021).
  importCss: false,
});

/** Where a directory or filename came from, used to apply the correct base. */
export type SettingOrigin = "default" | "project" | "file" | "cli";

interface DirectorySetting {
  /** Authored directory, or an absolute source directory for the default. */
  readonly value: string;
  readonly origin: SettingOrigin;
}

interface NameSetting {
  readonly value: string;
  readonly origin: SettingOrigin;
}

/** Effective names, directories and flags after precedence resolution. */
export interface ResolvedOutputSettings {
  /** Absolute POSIX CSS output directory. */
  readonly cssDir: string;
  /**
   * Absolute POSIX CSS destinations in authored order. A scalar input yields one
   * entry identical to {@link cssDir}; a file `css-dir` list yields one per item
   * (ADR-0019).
   */
  readonly cssDirs: readonly string[];
  /** Absolute POSIX JS map output directory. */
  readonly mapDir: string;
  /** Validated CSS basename. */
  readonly cssName: string;
  /** Validated JS map basename. */
  readonly mapName: string;
  /** Write the stylesheet. */
  readonly emitCss: boolean;
  /** Write the JS class map. */
  readonly emitMap: boolean;
  /** Write declarations beside the JS map. */
  readonly emitTypes: boolean;
  /** Write the CSS source map. */
  readonly sourceMap: boolean;
  /** Compact generated CSS whitespace. */
  readonly minify: boolean;
}

/** Normalized source path used for all destination calculations. */
export interface ResolvedSource {
  /** Workspace-relative POSIX source path. */
  readonly relative: string;
  /** Absolute POSIX source path. */
  readonly absolute: string;
  /** Absolute POSIX source directory. */
  readonly directory: string;
  /** Source basename without its final extension. */
  readonly stem: string;
}

/** Resolve the workspace-relative and absolute forms of the entry source. */
export function resolveSource(input: PlanOutputsInput): ResolvedSource {
  const workspaceRoot = normalizePath(input.workspaceRoot);
  const raw = normalizePath(input.sourceFile);
  const absolute = isAbsolutePath(raw) ? raw : joinPath(workspaceRoot, raw);
  const relative = relativePath(workspaceRoot, absolute);
  return Object.freeze({
    relative,
    absolute,
    directory: dirnamePath(absolute),
    stem: sourceStem(absolute),
  });
}

function sourceStem(absolute: string): string {
  const base = basenamePath(absolute);
  const dot = base.lastIndexOf(".");
  if (dot > 0) return base.slice(0, dot);
  return base === "" ? "index" : base;
}

/** Default CSS and JS basenames for a source stem. */
export function defaultNames(stem: string): { readonly cssName: string; readonly mapName: string } {
  return Object.freeze({ cssName: `${stem}.css`, mapName: `${stem}.map.js` });
}

/**
 * Apply defaults, project configuration, file setup and CLI overrides, then
 * resolve all directories to absolute POSIX paths.
 */
export function resolveOutputSettings(
  input: PlanOutputsInput,
  source: ResolvedSource,
  workspaceRoot: string,
): ResolvedOutputSettings {
  const defaults = defaultNames(source.stem);
  let cssDir: DirectorySetting = { value: source.directory, origin: "default" };
  let cssDirs: readonly string[] | undefined;
  let mapDir: DirectorySetting = { value: source.directory, origin: "default" };
  let cssName: NameSetting = { value: defaults.cssName, origin: "default" };
  let mapName: NameSetting = { value: defaults.mapName, origin: "default" };
  let emitCss: boolean = OUTPUT_DEFAULTS.emitCss;
  let emitMap: boolean = OUTPUT_DEFAULTS.emitMap;
  let emitTypes: boolean = OUTPUT_DEFAULTS.emitTypes;
  let sourceMap: boolean = OUTPUT_DEFAULTS.sourceMap;
  let minify: boolean = OUTPUT_DEFAULTS.minify;

  const projectOutput = input.projectConfig?.output;
  if (projectOutput?.cssDir !== undefined) {
    cssDir = { value: projectOutput.cssDir, origin: "project" };
  }
  if (projectOutput?.mapDir !== undefined) {
    mapDir = { value: projectOutput.mapDir, origin: "project" };
  }
  if (projectOutput?.cssName !== undefined) {
    cssName = { value: projectOutput.cssName, origin: "project" };
  }
  if (projectOutput?.mapName !== undefined) {
    mapName = { value: projectOutput.mapName, origin: "project" };
  }
  if (projectOutput?.emitCss !== undefined) emitCss = projectOutput.emitCss;
  if (projectOutput?.emitMap !== undefined) emitMap = projectOutput.emitMap;
  if (projectOutput?.emitTypes !== undefined) emitTypes = projectOutput.emitTypes;
  // `map-types` is the canonical spelling; it wins over the legacy alias.
  if (projectOutput?.mapTypes !== undefined) emitTypes = projectOutput.mapTypes;
  if (projectOutput?.sourceMap !== undefined) sourceMap = projectOutput.sourceMap;
  if (projectOutput?.minify !== undefined) minify = projectOutput.minify;

  const fileCssDirs = input.setup.cssDirs;
  if (fileCssDirs !== undefined && fileCssDirs.length > 1) {
    // A file-level list replaces project/CLI single directories entirely and
    // resolves every item exactly against the source file (ADR-0019).
    cssDirs = fileCssDirs;
    cssDir = { value: fileCssDirs[0] ?? ".", origin: "file" };
  } else if (
    projectOutput?.cssDir !== undefined &&
    sameAuthoredPath(input.setup.cssDir, projectOutput.cssDir)
  ) {
    cssDir = { value: projectOutput.cssDir, origin: "project" };
  } else if (!isDefaultDirectory(input.setup.cssDir, source, workspaceRoot)) {
    cssDir = { value: input.setup.cssDir, origin: "file" };
  }
  if (
    projectOutput?.mapDir !== undefined &&
    sameAuthoredPath(input.setup.mapDir, projectOutput.mapDir)
  ) {
    mapDir = { value: projectOutput.mapDir, origin: "project" };
  } else if (!isDefaultDirectory(input.setup.mapDir, source, workspaceRoot)) {
    mapDir = { value: input.setup.mapDir, origin: "file" };
  }
  if (input.setup.cssName !== defaults.cssName) {
    cssName = { value: input.setup.cssName, origin: "file" };
  }
  if (input.setup.mapName !== defaults.mapName) {
    mapName = { value: input.setup.mapName, origin: "file" };
  }
  if (input.setup.emitCss !== OUTPUT_DEFAULTS.emitCss) emitCss = input.setup.emitCss;
  if (input.setup.emitMap !== OUTPUT_DEFAULTS.emitMap) emitMap = input.setup.emitMap;
  if (input.setup.emitTypes !== OUTPUT_DEFAULTS.emitTypes) emitTypes = input.setup.emitTypes;
  if (input.setup.sourceMap !== OUTPUT_DEFAULTS.sourceMap) sourceMap = input.setup.sourceMap;
  if (input.setup.minify !== OUTPUT_DEFAULTS.minify) minify = input.setup.minify;

  const cli = input.cliOverrides;
  if (cli?.cssDir !== undefined) {
    cssDir = { value: cli.cssDir, origin: "cli" };
    cssDirs = undefined;
  }
  if (cli?.mapDir !== undefined) mapDir = { value: cli.mapDir, origin: "cli" };
  if (cli?.cssName !== undefined) cssName = { value: cli.cssName, origin: "cli" };
  if (cli?.mapName !== undefined) mapName = { value: cli.mapName, origin: "cli" };
  if (cli?.emitCss !== undefined) emitCss = cli.emitCss;
  if (cli?.emitMap !== undefined) emitMap = cli.emitMap;
  if (cli?.emitTypes !== undefined) emitTypes = cli.emitTypes;
  if (cli?.mapTypes !== undefined) emitTypes = cli.mapTypes;
  if (cli?.sourceMap !== undefined) sourceMap = cli.sourceMap;
  if (cli?.minify !== undefined) minify = cli.minify;

  const include = input.projectConfig?.include;
  const resolvedCssDirs =
    cssDirs === undefined
      ? [resolveDirectory(cssDir, source, workspaceRoot, include)]
      : cssDirs.map((value) => resolveFileDirectory(value, source));
  return Object.freeze({
    cssDir: resolvedCssDirs[0] ?? source.directory,
    cssDirs: Object.freeze(resolvedCssDirs),
    mapDir: resolveDirectory(mapDir, source, workspaceRoot, include),
    cssName: cssName.value,
    mapName: mapName.value,
    emitCss,
    emitMap,
    emitTypes,
    sourceMap,
    minify,
  });
}

function sameAuthoredPath(left: string, right: string): boolean {
  return normalizeAuthored(left) === normalizeAuthored(right);
}

function normalizeAuthored(value: string): string {
  const slashed = toPosix(value).trim();
  if (slashed === "") return ".";
  return slashed.endsWith("/") && slashed !== "/" ? slashed.slice(0, -1) : slashed;
}

/**
 * Whether a file-layer directory value is just the built-in default for this
 * source (the source directory), regardless of whether the caller wrote `.`,
 * `src`, an absolute path or an empty string.
 */
function isDefaultDirectory(value: string, source: ResolvedSource, workspaceRoot: string): boolean {
  const normalized = normalizePath(value);
  if (normalized === ".") return true;
  if (isAbsolutePath(normalized)) return normalizePath(normalized) === source.directory;
  return (
    normalizePath(joinPath(workspaceRoot, value)) === source.directory ||
    normalizePath(joinPath(source.directory, value)) === source.directory
  );
}

function resolveDirectory(
  setting: DirectorySetting,
  source: ResolvedSource,
  workspaceRoot: string,
  include: readonly string[] | undefined,
): string {
  switch (setting.origin) {
    case "default":
      return source.directory;
    case "file":
      return resolveFileDirectory(setting.value, source);
    case "cli":
      return isAbsolutePath(setting.value)
        ? normalizePath(setting.value)
        : joinPath(workspaceRoot, setting.value);
    case "project":
      return resolveProjectDirectory(setting.value, source, workspaceRoot, include);
  }
}

/** Resolve a file-level directory exactly against the source directory. */
function resolveFileDirectory(value: string, source: ResolvedSource): string {
  return isAbsolutePath(value) ? normalizePath(value) : joinPath(source.directory, value);
}

function resolveProjectDirectory(
  value: string,
  source: ResolvedSource,
  workspaceRoot: string,
  include: readonly string[] | undefined,
): string {
  if (isAbsolutePath(value)) return normalizePath(value);
  const base = joinPath(workspaceRoot, value);
  const sourceRoot = sourceRootFor(workspaceRoot, include, source.absolute);
  const mirror = relativePath(sourceRoot, source.directory);
  if (mirror === ".") return base;
  if (isSafeRelativePath(mirror)) return joinPath(base, mirror);

  const fallback = relativePath(workspaceRoot, source.directory);
  if (isSafeRelativePath(fallback)) return joinPath(base, fallback);
  return base;
}

/**
 * Derive a project source root from static prefixes in `include` patterns.
 *
 * `src/**\/*.cssx` yields `<workspace>/src`, so project output directories can
 * mirror `pages/dashboard` instead of flattening or repeating `src`. When the
 * include list has no common static prefix, the workspace root is used.
 */
export function sourceRootFor(
  workspaceRoot: string,
  include: readonly string[] | undefined,
  sourceAbsolute: string,
): string {
  if (include === undefined || include.length === 0) return workspaceRoot;

  const prefixes: string[][] = [];
  for (const pattern of include) {
    const normalized = toPosix(pattern).trim();
    if (normalized === "" || normalized.startsWith("!")) continue;
    const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
    const prefix: string[] = [];
    for (const segment of segments) {
      if (isGlobSegment(segment)) break;
      prefix.push(segment);
    }
    if (prefix.length > 0) prefixes.push(prefix);
  }
  if (prefixes.length === 0) return workspaceRoot;

  const common = [...(prefixes[0] ?? [])];
  for (const prefix of prefixes.slice(1)) {
    let index = 0;
    while (index < common.length && index < prefix.length && common[index] === prefix[index]) {
      index += 1;
    }
    common.length = index;
  }
  if (common.length === 0) return workspaceRoot;

  const candidate = joinPath(workspaceRoot, ...common);
  return isWithinPath(candidate, sourceAbsolute) ? candidate : workspaceRoot;
}

function isGlobSegment(segment: string): boolean {
  return (
    segment.includes("*") ||
    segment.includes("?") ||
    segment.includes("[") ||
    segment.includes("]") ||
    segment.includes("{") ||
    segment.includes("}")
  );
}

/** Derive the declaration basename from a map basename (`classes.js` → `classes.d.ts`). */
export function declarationNameFor(mapName: string): string {
  return `${mapName.slice(0, -3)}.d.ts`;
}

/** Derive the CSS source-map basename (`theme.css` → `theme.css.map`). */
export function sourceMapNameFor(cssName: string): string {
  return `${cssName}.map`;
}

/**
 * Baseline settings shape used by callers and tests when a source has no file
 * `@setup`. Directories point at the source directory so the planner sees the
 * documented default rather than an accidental override.
 */
export function defaultSetupFor(file: string): ResolvedSetup {
  const base = basenamePath(file);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const directory = dirnamePath(normalizePath(file));
  return {
    prefix: "",
    cssDir: directory,
    mapDir: directory,
    cssName: `${stem}.css`,
    mapName: `${stem}.map.js`,
    emitCss: OUTPUT_DEFAULTS.emitCss,
    emitMap: OUTPUT_DEFAULTS.emitMap,
    emitTypes: OUTPUT_DEFAULTS.emitTypes,
    sourceMap: OUTPUT_DEFAULTS.sourceMap,
    minify: OUTPUT_DEFAULTS.minify,
    mapInherit: OUTPUT_DEFAULTS.mapInherit,
    importCss: OUTPUT_DEFAULTS.importCss,
  };
}
