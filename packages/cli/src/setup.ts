/**
 * Effective output setup resolution for CLI planning.
 *
 * The compiler returns artifacts but not the output plan it used
 * (`CompileResult` has no destination list), so the CLI must build the same
 * `PlanOutputsInput` the compiler builds internally: defaults, project
 * configuration and decoded file `@setup` values, in that order. This module
 * mirrors the documented precedence and the planner's provenance rules from
 * `.ai/reports/CSSX-A10.md`. A future public plan on `CompileResult` would
 * remove the duplication.
 */

import { decodeSetupList } from "@xessa/compiler";
import type { ResolvedSetup, SetupBlock, Stylesheet, StylesheetItem } from "@xessa/compiler";
import type { CliConfig } from "./config.js";
import { basenamePosix, dirnamePosix } from "./paths.js";

/** Authored file-level `@setup` values; absent keys mean "not authored". */
export interface FileSetupValues {
  readonly prefix?: string;
  readonly cssDir?: string;
  /** File-level `css-dir` list when more than one destination was authored. */
  readonly cssDirs?: readonly string[];
  readonly cssName?: string;
  readonly mapDir?: string;
  readonly mapName?: string;
  readonly emitCss?: boolean;
  readonly emitMap?: boolean;
  /** Resolved declaration flag; `map-types` is canonical, `emit-types` the alias. */
  readonly emitTypes?: boolean;
  readonly sourceMap?: boolean;
  readonly minify?: boolean;
  /** Module map inheritance default (ADR-0020): `@setup { map-inherit: false; }`. */
  readonly mapInherit?: boolean;
  /** Class-map CSS side-effect import (ADR-0021): `@setup { import-css: true; }`. */
  readonly importCss?: boolean;
  /** `@setup { module: true }`: rule-bearing module with no artifacts of its own (ADR-0014). */
  readonly module?: boolean;
}

const STRING_SETUP_KEYS = ["prefix", "css-name", "map-dir", "map-name"] as const;
const BOOLEAN_SETUP_KEYS = [
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "module",
  "map-inherit",
  "import-css",
] as const;

/** Decode every top-level `@setup` block of an entry, first occurrence winning. */
export function decodeFileSetup(ast: Stylesheet): FileSetupValues {
  const values: Record<string, string | boolean> = {};
  const seen = new Set<string>();
  let cssDir: string | undefined;
  let cssDirs: readonly string[] | undefined;

  for (const item of ast.items) {
    if (!isSetupBlock(item)) continue;
    for (const setting of item.settings) {
      const key = setting.key;
      if (seen.has(key)) continue;
      if (key === "css-dir") {
        seen.add(key);
        const decoded = decodeSetupList(setting.value, setting.valueSpan);
        const first = decoded.entries[0];
        if (first !== undefined) cssDir = first.value;
        if (decoded.entries.length > 1) {
          cssDirs = decoded.entries.map((entry) => entry.value);
        }
        continue;
      }
      if (isStringKey(key)) {
        seen.add(key);
        values[key] = decodeScalar(setting.value);
      } else if (isBooleanKey(key)) {
        const decoded = decodeBoolean(setting.value);
        if (decoded === undefined) continue;
        seen.add(key);
        values[key] = decoded;
      }
    }
  }

  // `map-types` is the canonical declaration flag; `emit-types` is its legacy
  // alias, so the canonical key wins when both are authored in one layer.
  const types =
    typeof values["map-types"] === "boolean"
      ? values["map-types"]
      : typeof values["emit-types"] === "boolean"
        ? values["emit-types"]
        : undefined;

  return {
    ...(typeof values.prefix === "string" ? { prefix: values.prefix } : {}),
    ...(cssDir === undefined ? {} : { cssDir }),
    ...(cssDirs === undefined ? {} : { cssDirs }),
    ...(typeof values["css-name"] === "string" ? { cssName: values["css-name"] } : {}),
    ...(typeof values["map-dir"] === "string" ? { mapDir: values["map-dir"] } : {}),
    ...(typeof values["map-name"] === "string" ? { mapName: values["map-name"] } : {}),
    ...(typeof values["emit-css"] === "boolean" ? { emitCss: values["emit-css"] } : {}),
    ...(typeof values["emit-map"] === "boolean" ? { emitMap: values["emit-map"] } : {}),
    ...(types === undefined ? {} : { emitTypes: types }),
    ...(typeof values["source-map"] === "boolean" ? { sourceMap: values["source-map"] } : {}),
    ...(typeof values.minify === "boolean" ? { minify: values.minify } : {}),
    ...(typeof values.module === "boolean" ? { module: values.module } : {}),
    ...(typeof values["map-inherit"] === "boolean" ? { mapInherit: values["map-inherit"] } : {}),
    ...(typeof values["import-css"] === "boolean" ? { importCss: values["import-css"] } : {}),
  };
}

/**
 * Built-in setup defaults for a workspace-relative source path.
 *
 * Directories default to the source directory and names to `<stem>.css` /
 * `<stem>.map.js`, matching SPECIFICATION.md §9 and the planner's defaults.
 */
export function defaultSetupFor(relativeFile: string): ResolvedSetup {
  const base = basenamePosix(relativeFile);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const directory = dirnamePosix(relativeFile);
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
    mapInherit: true,
    importCss: false,
  };
}

/**
 * Merge built-in defaults, project configuration and file `@setup` into the
 * effective setup for one entry.
 *
 * Precedence is defaults < project config < `module: true` suppression < file
 * `@setup` < explicit overrides. The optional `--minify`/`--no-minify` flag is
 * applied last for reporting; the compiler's project API cannot place it above
 * file `@setup`, which the caller reports as a warning when a file authors a
 * conflicting value. `@setup { module: true }` (ADR-0014) removes the default
 * CSS, map and type outputs of a rule-bearing module; authoring one of those
 * keys explicitly restores it.
 */
export function resolveEffectiveSetup(
  relativeFile: string,
  config: CliConfig | null,
  fileSetup: FileSetupValues,
  minifyFlag: boolean | undefined,
): ResolvedSetup {
  const defaults = defaultSetupFor(relativeFile);
  const project = config?.output;
  const strategy = config?.classes?.strategy ?? "prefix";
  const prefix = strategy === "none" ? "" : (fileSetup.prefix ?? config?.classes?.prefix ?? "");
  const moduleDefaults = fileSetup.module === true;
  const emitCssDefault = moduleDefaults ? false : (project?.emitCss ?? defaults.emitCss);
  const emitMapDefault = moduleDefaults ? false : (project?.emitMap ?? defaults.emitMap);
  const emitTypesDefault = moduleDefaults
    ? false
    : (project?.mapTypes ?? project?.emitTypes ?? defaults.emitTypes);

  return {
    prefix,
    cssDir: fileSetup.cssDir ?? project?.cssDir ?? defaults.cssDir,
    ...(fileSetup.cssDirs === undefined ? {} : { cssDirs: fileSetup.cssDirs }),
    cssName: fileSetup.cssName ?? project?.cssName ?? defaults.cssName,
    mapDir: fileSetup.mapDir ?? project?.mapDir ?? defaults.mapDir,
    mapName: fileSetup.mapName ?? project?.mapName ?? defaults.mapName,
    emitCss: fileSetup.emitCss ?? emitCssDefault,
    emitMap: fileSetup.emitMap ?? emitMapDefault,
    emitTypes: fileSetup.emitTypes ?? emitTypesDefault,
    sourceMap: fileSetup.sourceMap ?? project?.sourceMap ?? defaults.sourceMap,
    minify: minifyFlag ?? fileSetup.minify ?? project?.minify ?? defaults.minify,
    mapInherit: fileSetup.mapInherit ?? project?.mapInherit ?? defaults.mapInherit,
    importCss: fileSetup.importCss ?? project?.importCss ?? defaults.importCss,
  };
}

function isSetupBlock(item: StylesheetItem): item is SetupBlock {
  return item.kind === "setup" && Array.isArray((item as { settings?: unknown }).settings);
}

function isStringKey(key: string): boolean {
  return (STRING_SETUP_KEYS as readonly string[]).includes(key);
}

function isBooleanKey(key: string): boolean {
  return (BOOLEAN_SETUP_KEYS as readonly string[]).includes(key);
}

function decodeBoolean(raw: string): boolean | undefined {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Decode a quoted CSS string scalar; unquoted scalars are trimmed verbatim. */
function decodeScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charAt(0);
    const last = trimmed.charAt(trimmed.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
    }
  }
  return trimmed;
}
