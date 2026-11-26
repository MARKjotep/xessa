/**
 * Zero-dependency glob matching and source discovery for project builds.
 *
 * Supported syntax: `*` (any run of characters except `/`), `**` (any run of
 * characters including `/`, and as a path segment it also matches zero
 * segments), `?` (one character except `/`) and `{a,b}` alternation, including
 * nesting. Character classes are not supported and are matched literally.
 *
 * Patterns are POSIX-style; backslashes are treated as separators so Windows
 * authored configuration behaves the same as forward slashes. A leading `./` or
 * `/` is ignored, which anchors the pattern at the workspace root.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Normalize a path or pattern for glob matching (POSIX separators, no `./`). */
export function normalizeGlobPath(value: string): string {
  let normalized = value.replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

/** Whether a pattern segment contains glob magic. */
export function hasGlobMagic(value: string): boolean {
  return /[*?{]/.test(value);
}

/** Expand `{a,b}` alternations (including nesting) into concrete patterns. */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];

  let depth = 0;
  let close = -1;
  for (let index = open; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return [pattern];

  const before = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const after = pattern.slice(close + 1);
  const options = splitAlternatives(body);
  if (options.length < 2) return [pattern];

  return options.flatMap((option) => expandBraces(before + option + after));
}

function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Translate one glob pattern into an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeGlobPath(pattern);
  const alternatives = expandBraces(normalized).map(globSourceToRegExp);
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

function globSourceToRegExp(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character === "*") {
      const next = pattern.charAt(index + 1);
      if (next === "*") {
        const after = pattern.charAt(index + 2);
        if (after === "/") {
          source += "(?:[^/]+/)*";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(character);
  }
  return source;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match a workspace-relative POSIX path against one glob pattern. */
export function matchesGlob(relativePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizeGlobPath(relativePath));
}

/**
 * Whether a workspace-relative path is excluded by any pattern.
 *
 * A pattern also excludes descendants of a matching directory and, when it is a
 * bare name such as `node_modules`, any path segment with that name.
 */
export function isExcluded(relativePath: string, patterns: readonly string[]): boolean {
  const normalized = normalizeGlobPath(relativePath);
  const segments = normalized.split("/");

  for (const raw of patterns) {
    const pattern = normalizeGlobPath(raw.trim());
    if (pattern === "" || pattern.startsWith("!")) continue;

    if (matchesGlob(normalized, pattern)) return true;

    if (!pattern.includes("/") && !hasGlobMagic(pattern) && segments.includes(pattern)) {
      return true;
    }

    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      if (matchesGlob(ancestor, pattern)) return true;
    }
  }
  return false;
}

/**
 * Directory the discovery walk can start from for a pattern, before its first
 * glob segment. Exact file patterns start at their parent directory.
 */
export function staticDirectoryPrefix(pattern: string): string {
  const segments = normalizeGlobPath(pattern)
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  const prefix: string[] = [];
  for (const segment of segments) {
    if (hasGlobMagic(segment)) break;
    prefix.push(segment);
  }
  if (prefix.length === segments.length && prefix.length > 0) prefix.pop();
  return prefix.join("/");
}

/** Options for {@link discoverSources}. */
export interface DiscoverOptions {
  /** Absolute POSIX workspace root. */
  readonly root: string;
  /** Include globs, relative to the workspace root. */
  readonly include: readonly string[];
  /** Exclude globs or directory names, relative to the workspace root. */
  readonly exclude: readonly string[];
}

/**
 * Discover `.cssx` sources matching the include globs, minus exclusions.
 *
 * Only `.cssx` files are sources by definition, `.git` and `node_modules`
 * directories are never walked, symlinks are skipped, and results are sorted for
 * deterministic builds.
 */
export async function discoverSources(options: DiscoverOptions): Promise<string[]> {
  const found = new Set<string>();
  const roots = new Set<string>();
  for (const pattern of options.include) roots.add(staticDirectoryPrefix(pattern));
  if (roots.size === 0) roots.add("");

  for (const root of roots) {
    await walk(options.root, root, options, found);
  }

  return [...found].sort();
}

async function walk(
  workspaceRoot: string,
  relativeDir: string,
  options: DiscoverOptions,
  found: Set<string>,
): Promise<void> {
  const absolute = relativeDir === "" ? workspaceRoot : join(workspaceRoot, relativeDir);
  let entries: Dirent[];
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const entry of entries) {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (isExcluded(relativePath, options.exclude)) continue;
      await walk(workspaceRoot, relativePath, options, found);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".cssx")) continue;
    if (isExcluded(relativePath, options.exclude)) continue;
    if (!options.include.some((pattern) => matchesGlob(relativePath, pattern))) continue;
    found.add(relativePath);
  }
}
