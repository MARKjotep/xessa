/**
 * Declarative project configuration discovery for the VS Code extension.
 *
 * The document format is the CLI's frozen `xessa.config.json` schema
 * (SPECIFICATION.md §10). Multi-root workspaces resolve the nearest config for
 * each file, never a global one; the workspace folder root is the explicit
 * boundary so a config outside the folder is not adopted. Unknown keys are
 * ignored with a warning, matching the CLI's non-strict mode.
 */

import type { MediaGroupingMode, NamingStrategy, OutputOptions } from "../../compiler/src/index.js";
import { dirnamePath, normalizePath } from "./paths.js";

/** Validated extension view of one `xessa.config.json`. */
export interface ExtensionConfig {
  /** Absolute POSIX path of the configuration file. */
  readonly file: string;
  /** Directory containing the configuration file; the project root. */
  readonly root: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly output?: OutputOptions;
  readonly classes?: { readonly strategy: NamingStrategy; readonly prefix?: string };
  readonly media?: Readonly<Record<string, string>>;
  readonly compiler?: {
    readonly strict?: boolean;
    readonly mediaGrouping?: MediaGroupingMode;
  };
}

/** Result of reading one configuration file. */
export type ConfigOutcome =
  | { readonly ok: true; readonly config: ExtensionConfig; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly message: string };

/**
 * Walk up from `startPath` for the nearest `xessa.config.json`, stopping at
 * `boundary` (inclusive) when the file is inside a workspace folder.
 */
export function findNearestConfigPath(
  startPath: string,
  boundary: string | undefined,
  fileExists: (path: string) => boolean,
): string | undefined {
  const start = normalizePath(startPath);
  const limit = boundary === undefined ? undefined : normalizePath(boundary);
  let current = dirnamePath(start);
  for (;;) {
    const candidate = `${current === "/" ? "" : current}/xessa.config.json`;
    if (fileExists(candidate)) return candidate;
    if (limit !== undefined && current === limit) return undefined;
    const parent = dirnamePath(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, key: string, errors: string[]): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`"${key}" must be an array of glob strings.`);
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function readOutput(value: unknown, errors: string[]): OutputOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('"output" must be an object.');
    return undefined;
  }
  const output: Record<string, string | boolean> = {};
  for (const key of ["cssDir", "cssName", "mapDir", "mapName"] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== "string") {
      errors.push(`"output.${key}" must be a string.`);
      continue;
    }
    output[key] = entry;
  }
  for (const key of [
    "emitCss",
    "emitMap",
    "mapTypes",
    "emitTypes",
    "sourceMap",
    "minify",
  ] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") {
      errors.push(`"output.${key}" must be a boolean.`);
      continue;
    }
    output[key] = entry;
  }
  return output as OutputOptions;
}

/**
 * Parse and validate a configuration document. Unknown keys are ignored with a
 * warning (non-strict), known keys are always type-checked.
 */
export function parseExtensionConfig(text: string, file: string): ConfigOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: `${file}: invalid JSON: ${String(error)}` };
  }
  if (!isRecord(raw)) return { ok: false, message: `${file}: expected a JSON object.` };

  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set([
    "$schema",
    "include",
    "exclude",
    "output",
    "classes",
    "media",
    "compiler",
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) warnings.push(`Ignoring unknown configuration key "${key}".`);
  }

  const include = stringArray(raw.include, "include", errors);
  const exclude = stringArray(raw.exclude, "exclude", errors) ?? [];
  const output = readOutput(raw.output, errors);

  let classes: ExtensionConfig["classes"];
  if (raw.classes !== undefined) {
    if (!isRecord(raw.classes)) {
      errors.push('"classes" must be an object.');
    } else {
      const strategy = raw.classes.strategy;
      if (strategy !== undefined && strategy !== "prefix" && strategy !== "none") {
        errors.push('"classes.strategy" must be "prefix" or "none".');
      }
      const prefix = raw.classes.prefix;
      if (prefix !== undefined && typeof prefix !== "string") {
        errors.push('"classes.prefix" must be a string.');
      }
      if (errors.length === 0) {
        classes = {
          strategy: strategy === "none" ? "none" : "prefix",
          ...(typeof prefix === "string" ? { prefix } : {}),
        };
      }
    }
  }

  let media: Record<string, string> | undefined;
  if (raw.media !== undefined) {
    if (!isRecord(raw.media)) {
      errors.push('"media" must be an object mapping aliases to media queries.');
    } else {
      media = {};
      for (const [key, query] of Object.entries(raw.media)) {
        if (typeof query !== "string") {
          errors.push(`"media.${key}" must be a string.`);
          continue;
        }
        media[key] = query;
      }
    }
  }

  let compiler: ExtensionConfig["compiler"];
  if (raw.compiler !== undefined) {
    if (!isRecord(raw.compiler)) {
      errors.push('"compiler" must be an object.');
    } else {
      const strict = raw.compiler.strict;
      if (strict !== undefined && typeof strict !== "boolean") {
        errors.push('"compiler.strict" must be a boolean.');
      }
      const grouping = raw.compiler.mediaGrouping;
      if (
        grouping !== undefined &&
        grouping !== "safe" &&
        grouping !== "none" &&
        grouping !== "merge"
      ) {
        errors.push('"compiler.mediaGrouping" must be "safe", "none" or "merge".');
      }
      compiler = {
        ...(typeof strict === "boolean" ? { strict } : {}),
        ...(grouping === "safe" || grouping === "none" || grouping === "merge"
          ? { mediaGrouping: grouping }
          : {}),
      };
    }
  }

  if (errors.length > 0) return { ok: false, message: errors.join("\n") };

  return {
    ok: true,
    config: {
      file,
      root: dirnamePath(file),
      include: include ?? [],
      exclude,
      ...(output === undefined ? {} : { output }),
      ...(classes === undefined ? {} : { classes }),
      ...(media === undefined ? {} : { media }),
      ...(compiler === undefined ? {} : { compiler }),
    },
    warnings,
  };
}
