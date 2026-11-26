/**
 * Project entry discovery for **Build Project** and **Check Project**.
 *
 * The CLI owns project globbing for command-line builds; the extension needs
 * the same discovery without importing the CLI package, so this is a small,
 * explicit implementation: `**`, `*` and `?` globs over a directory walk, with
 * default excludes that keep generated output and dependency trees out.
 */

import { normalizePath, relativeTo } from "./paths.js";

/** Minimal directory entry shape (injectable for tests). */
export interface DirectoryEntry {
  readonly name: string;
  readonly directory: boolean;
}

/** Directory lister used by {@link discoverProjectEntries}. */
export type DirectoryLister = (absoluteDirectory: string) => readonly DirectoryEntry[];

const ALWAYS_EXCLUDED = new Set([
  ".git",
  "node_modules",
  "dist",
  "generated",
  ".vscode-test",
  "out",
]);

/** Compile a glob to an anchored regular expression (`**`, `*`, `?`). */
export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\.\//, "");
  let source = "";
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index] ?? "";
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 2;
        if (normalized[index] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`^${source}$`);
}

/** Whether a workspace-relative path matches any pattern. */
export function matchesPatterns(relativePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

/** Whether a directory name is always excluded from project discovery. */
export function isExcludedDirectory(name: string): boolean {
  return ALWAYS_EXCLUDED.has(name) || (name.startsWith(".") && name !== ".");
}

/**
 * Discover `.cssx` entries under `root`.
 *
 * `include` defaults to `**\/*.cssx`; `exclude` is matched against the
 * workspace-relative path. Paths are returned as absolute normalized POSIX
 * paths, sorted for determinism.
 */
export function discoverProjectEntries(
  root: string,
  include: readonly string[],
  exclude: readonly string[],
  list: DirectoryLister,
  options: { readonly maxEntries?: number } = {},
): readonly string[] {
  const patterns = include.length === 0 ? ["**/*.cssx"] : [...include];
  const excluded = [...exclude];
  const limit = options.maxEntries ?? 5000;
  const found: string[] = [];

  const walk = (directory: string): void => {
    if (found.length >= limit) return;
    let entries: readonly DirectoryEntry[];
    try {
      entries = list(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const absolute = `${directory.replace(/\/+$/, "")}/${entry.name}`;
      const relative = relativeTo(root, absolute);
      if (entry.directory) {
        if (isExcludedDirectory(entry.name)) continue;
        if (excluded.length > 0 && matchesPatterns(relative, excluded)) continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith(".cssx")) continue;
      if (excluded.length > 0 && matchesPatterns(relative, excluded)) continue;
      if (!matchesPatterns(relative, patterns)) continue;
      found.push(absolute);
    }
  };

  walk(normalizePath(root));
  return found.sort();
}
