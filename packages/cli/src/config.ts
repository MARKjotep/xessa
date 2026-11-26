/**
 * `xessa.config.json` discovery, loading and schema validation.
 *
 * The document format is frozen by SPECIFICATION.md §10. Keys are camelCase in
 * JSON while source `@setup` keys stay kebab-case:
 *
 * | `@setup` key | JSON key | Where |
 * |---|---|---|
 * | `prefix` | `classes.prefix` | `classes` |
 * | `css-dir` | `output.cssDir` | `output` |
 * | `css-name` | `output.cssName` | `output` |
 * | `map-dir` | `output.mapDir` | `output` |
 * | `map-name` | `output.mapName` | `output` |
 * | `emit-css` | `output.emitCss` | `output` |
 * | `emit-map` | `output.emitMap` | `output` |
 * | `map-types` | `output.mapTypes` | `output` |
 * | `emit-types` | `output.emitTypes` | `output` |
 * | `source-map` | `output.sourceMap` | `output` |
 * | `minify` | `output.minify` | `output` |
 * | `map-inherit` | `output.mapInherit` | `output` |
 * | `import-css` | `output.importCss` | `output` |
 * | `media-grouping` | `compiler.mediaGrouping` | `compiler` |
 *
 * `output.prefix` is deliberately rejected: class naming lives under `classes`
 * so strategy and prefix stay together.
 *
 * Unknown keys are rejected (exit 2) by default; an explicit
 * `compiler.strict: false` downgrades them to warnings. Known keys are always
 * type-checked.
 *
 * `include` defaults to {@link DEFAULT_INCLUDE} (`**\/*.cssx`), so a configuration
 * file is only needed to change a default or scope discovery. `exclude` stays
 * empty by default: imported modules declare themselves with
 * `@setup { module: true; }` rather than appearing in a project-wide list.
 */

import { readFile, stat } from "node:fs/promises";
import type {
  CompilerConfig,
  MediaGroupingMode,
  NamingOptions,
  NamingStrategy,
  OutputOptions,
} from "@xessa/compiler";
import { absolutePath, dirnamePosix, toPosix } from "./paths.js";

/** Entry globs used when a project does not configure `include`. */
export const DEFAULT_INCLUDE: readonly string[] = Object.freeze(["**/*.cssx"]);

/** Validated project configuration with its resolved location. */
export interface CliConfig {
  /** Absolute POSIX path of the configuration file. */
  readonly file: string;
  /** Absolute POSIX workspace root: the directory containing the configuration file. */
  readonly root: string;
  /** Include globs used for project entry discovery; defaults to {@link DEFAULT_INCLUDE}. */
  readonly include: readonly string[];
  /** Exclude globs and directory names removed from discovery. Default `[]`. */
  readonly exclude: readonly string[];
  /** Project-level output settings, resolved against the workspace root. */
  readonly output?: OutputOptions;
  /** Project-level class naming strategy and prefix. */
  readonly classes?: NamingOptions;
  /** Project-level media alias overrides merged after built-in defaults. */
  readonly media?: Readonly<Record<string, string>>;
  /** Compiler behaviour settings such as strict mode and media grouping. */
  readonly compiler?: CompilerConfig;
}

/** Request for {@link loadConfig}. */
export interface LoadConfigRequest {
  /** Working directory used to resolve an explicit relative `--config` path. */
  readonly cwd: string;
  /** Directory to start the nearest-config walk from. */
  readonly startDir: string;
  /** Explicit `--config` path, absolute or relative to `cwd`. */
  readonly explicitPath?: string;
}

/** Outcome of loading a configuration file. */
export type ConfigLoadOutcome =
  | {
      readonly ok: true;
      /** Parsed configuration, or `null` when no configuration file was found. */
      readonly config: CliConfig | null;
      /** Non-fatal validation notes (ignored unknown keys outside strict mode). */
      readonly warnings: readonly string[];
    }
  | {
      readonly ok: false;
      /** User-facing explanation; callers report it and exit 2. */
      readonly message: string;
    };

interface ConfigDocument {
  readonly config?: CliConfig;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "include",
  "exclude",
  "output",
  "classes",
  "media",
  "compiler",
]);

const OUTPUT_KEYS: ReadonlySet<string> = new Set([
  "cssDir",
  "cssName",
  "mapDir",
  "mapName",
  "emitCss",
  "emitMap",
  "mapTypes",
  "emitTypes",
  "sourceMap",
  "minify",
  "mapInherit",
  "importCss",
]);

const CLASSES_KEYS: ReadonlySet<string> = new Set(["strategy", "prefix"]);
const COMPILER_KEYS: ReadonlySet<string> = new Set(["strict", "mediaGrouping"]);

/** Walk up from `startDir` to the filesystem root for the nearest config file. */
export async function findConfigPath(startDir: string): Promise<string | null> {
  let current = toPosix(startDir);
  for (;;) {
    const candidate = `${current === "/" ? "" : current}/xessa.config.json`;
    if (await isFile(candidate)) return candidate;
    const parent = dirnamePosix(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Walk up for the nearest `xessa.config.json`, else `package.json`, else `startDir`. */
export async function findWorkspaceRoot(startDir: string): Promise<string> {
  const config = await findConfigPath(startDir);
  if (config !== null) return dirnamePosix(config);

  let current = toPosix(startDir);
  for (;;) {
    if (await isFile(`${current === "/" ? "" : current}/package.json`)) return current;
    const parent = dirnamePosix(current);
    if (parent === current) return toPosix(startDir);
    current = parent;
  }
}

/** Load and validate `xessa.config.json`, resolving the nearest file when not explicit. */
export async function loadConfig(request: LoadConfigRequest): Promise<ConfigLoadOutcome> {
  const explicit =
    request.explicitPath === undefined
      ? undefined
      : absolutePath(request.cwd, request.explicitPath);
  const configPath = explicit ?? (await findConfigPath(request.startDir));

  if (configPath === null) return { ok: true, config: null, warnings: [] };

  if (!(await isFile(configPath))) {
    return {
      ok: false,
      message:
        explicit === undefined
          ? `Configuration file could not be read: ${configPath}`
          : `Configuration file not found: ${request.explicitPath ?? configPath}`,
    };
  }

  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    return { ok: false, message: `Could not read ${configPath}: ${describeError(error)}` };
  }

  const document = parseConfigDocument(text, configPath);
  if (document.config === undefined || document.errors.length > 0) {
    return { ok: false, message: document.errors.join("\n") };
  }

  return { ok: true, config: document.config, warnings: document.warnings };
}

/** Parse and validate one configuration document. */
export function parseConfigDocument(text: string, file: string): ConfigDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { errors: [`${file}: invalid JSON: ${describeError(error)}`], warnings: [] };
  }

  if (!isRecord(value)) {
    return { errors: [`${file}: expected a JSON object at the top level.`], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const compilerValue = value.compiler;
  // Strict is the default; only an explicit `false` downgrades unknown keys.
  const strict = !(isRecord(compilerValue) && compilerValue.strict === false);

  reportUnknownKeys(value, TOP_LEVEL_KEYS, "", strict, errors, warnings);

  const include = readStringArray(value.include, "include", errors) ?? DEFAULT_INCLUDE;
  const exclude = readStringArray(value.exclude, "exclude", errors) ?? [];
  const output = readOutput(value.output, strict, errors, warnings);
  const classes = readClasses(value.classes, strict, errors, warnings);
  const media = readMedia(value.media, errors);
  const compiler = readCompiler(value.compiler, strict, errors, warnings) ?? {
    strict: true,
    mediaGrouping: "safe",
  };

  if (errors.length > 0) return { errors, warnings };

  return {
    config: {
      file,
      root: dirnamePosix(file),
      include,
      exclude,
      ...(output === undefined ? {} : { output }),
      ...(classes === undefined ? {} : { classes }),
      ...(media === undefined ? {} : { media }),
      compiler,
    },
    errors,
    warnings,
  };
}

function readOutput(
  value: unknown,
  strict: boolean,
  errors: string[],
  warnings: string[],
): OutputOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`"output" must be an object.`);
    return undefined;
  }
  reportUnknownKeys(value, OUTPUT_KEYS, "output", strict, errors, warnings);
  const output: Record<string, string | boolean> = {};
  assignString(output, value, "cssDir", "output", errors);
  assignString(output, value, "cssName", "output", errors);
  assignString(output, value, "mapDir", "output", errors);
  assignString(output, value, "mapName", "output", errors);
  assignBoolean(output, value, "emitCss", "output", errors);
  assignBoolean(output, value, "emitMap", "output", errors);
  assignBoolean(output, value, "mapTypes", "output", errors);
  assignBoolean(output, value, "emitTypes", "output", errors);
  assignBoolean(output, value, "sourceMap", "output", errors);
  assignBoolean(output, value, "minify", "output", errors);
  assignBoolean(output, value, "mapInherit", "output", errors);
  assignBoolean(output, value, "importCss", "output", errors);
  return output as OutputOptions;
}

function readClasses(
  value: unknown,
  strict: boolean,
  errors: string[],
  warnings: string[],
): NamingOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`"classes" must be an object.`);
    return undefined;
  }
  reportUnknownKeys(value, CLASSES_KEYS, "classes", strict, errors, warnings);

  const strategyValue = value.strategy;
  let strategy: NamingStrategy | undefined;
  if (strategyValue === undefined) {
    strategy = "prefix";
  } else if (strategyValue === "none" || strategyValue === "prefix") {
    strategy = strategyValue;
  } else {
    errors.push(`"classes.strategy" must be "prefix" or "none".`);
  }

  const prefixValue = value.prefix;
  if (prefixValue !== undefined && typeof prefixValue !== "string") {
    errors.push(`"classes.prefix" must be a string.`);
  }

  if (strategy === undefined) return undefined;
  return {
    strategy,
    ...(typeof prefixValue === "string" ? { prefix: prefixValue } : {}),
  };
}

function readMedia(value: unknown, errors: string[]): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`"media" must be an object mapping alias names to media queries.`);
    return undefined;
  }
  const media: Record<string, string> = {};
  for (const [key, query] of Object.entries(value)) {
    if (key.trim() === "") {
      errors.push(`"media" keys must be non-empty alias names.`);
      continue;
    }
    if (typeof query !== "string" || query.trim() === "") {
      errors.push(`"media.${key}" must be a non-empty media query string.`);
      continue;
    }
    media[key] = query;
  }
  return media;
}

function readCompiler(
  value: unknown,
  strict: boolean,
  errors: string[],
  warnings: string[],
): CompilerConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`"compiler" must be an object.`);
    return undefined;
  }
  reportUnknownKeys(value, COMPILER_KEYS, "compiler", strict, errors, warnings);

  const strictValue = value.strict;
  if (strictValue !== undefined && typeof strictValue !== "boolean") {
    errors.push(`"compiler.strict" must be a boolean.`);
  }

  const groupingValue = value.mediaGrouping;
  let mediaGrouping: MediaGroupingMode = "safe";
  if (groupingValue !== undefined) {
    if (groupingValue === "safe" || groupingValue === "none" || groupingValue === "merge") {
      mediaGrouping = groupingValue;
    } else {
      errors.push(`"compiler.mediaGrouping" must be "safe", "none" or "merge".`);
    }
  }

  return {
    strict: typeof strictValue === "boolean" ? strictValue : true,
    mediaGrouping,
  };
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  strict: boolean,
  errors: string[],
  warnings: string[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    const location = path === "" ? key : `${path}.${key}`;
    if (strict) {
      errors.push(`Unknown configuration key "${location}" (strict mode).`);
    } else {
      warnings.push(`Ignoring unknown configuration key "${location}".`);
    }
  }
}

function readStringArray(
  value: unknown,
  key: string,
  errors: string[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`"${key}" must be an array of glob strings.`);
    return undefined;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      errors.push(`"${key}" entries must be non-empty strings.`);
      continue;
    }
    result.push(entry);
  }
  return result;
}

function assignString(
  target: Record<string, string | boolean>,
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): void {
  const value = source[key];
  if (value === undefined) return;
  if (typeof value !== "string") {
    errors.push(`"${path}.${key}" must be a string.`);
    return;
  }
  target[key] = value;
}

function assignBoolean(
  target: Record<string, string | boolean>,
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): void {
  const value = source[key];
  if (value === undefined) return;
  if (typeof value !== "boolean") {
    errors.push(`"${path}.${key}" must be a boolean.`);
    return;
  }
  target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
