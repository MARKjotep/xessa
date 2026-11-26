/**
 * Small POSIX-style path helpers shared by the CLI.
 *
 * Node's `node:path` handles platform separators and drive letters; every value
 * that crosses a CLI boundary (reports, manifests, compiler input) is converted
 * to POSIX form with forward slashes.
 */

import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Convert platform separators to forward slashes. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Resolve `value` against `base` (when relative) and return a POSIX absolute path. */
export function absolutePath(base: string, value: string): string {
  return toPosix(isAbsolute(value) ? resolve(value) : resolve(base, value));
}

/** POSIX path of `to` relative to `from`. */
export function relativePosix(from: string, to: string): string {
  return toPosix(relative(from, to));
}

/** POSIX parent directory. */
export function dirnamePosix(path: string): string {
  return toPosix(dirname(path));
}

/** POSIX basename. */
export function basenamePosix(path: string): string {
  return toPosix(basename(path));
}

/** POSIX join. */
export function joinPosix(...parts: readonly string[]): string {
  return toPosix(join(...parts));
}

/** Whether `target` is `root` itself or nested inside it. */
export function isWithin(root: string, target: string): boolean {
  const rel = relativePosix(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}

/** Whether a relative path is absolute or escapes its base. */
export function isEscapingPath(relativePath: string): boolean {
  return isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith("../");
}
