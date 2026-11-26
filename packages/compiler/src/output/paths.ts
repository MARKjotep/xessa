/**
 * Pure POSIX path utilities for output planning.
 *
 * The output planner never touches the filesystem and never imports `node:path`.
 * All paths are normalized to forward slashes, `.`/`..` segments are collapsed
 * lexically, and Windows drive prefixes such as `C:\project` are preserved as
 * `C:/project`. Hosts still own symlink and case policy; these helpers only
 * provide deterministic, platform-independent string handling.
 */

/** Convert every backslash to a forward slash. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Whether a path is absolute in the planner's POSIX-plus-drive model.
 *
 * A leading slash, a UNC-style double slash and a drive prefix (`C:/`, `C:`)
 * are absolute. Bare relative paths are not.
 */
export function isAbsolutePath(path: string): boolean {
  const slashed = toPosix(path);
  return slashed.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(slashed);
}

interface SplitRoot {
  /** Root prefix including its trailing slash, or an empty string. */
  readonly root: string;
  /** Path text after the root, without a leading slash. */
  readonly rest: string;
}

function splitRoot(path: string): SplitRoot {
  const match = /^([A-Za-z]):(?=\/|$)/.exec(path);
  if (match?.[1] !== undefined) {
    let rest = path.slice(2);
    if (rest.startsWith("/")) rest = rest.slice(1);
    return { root: `${match[1]}:/`, rest };
  }
  if (path.startsWith("//")) return { root: "//", rest: path.slice(2) };
  if (path.startsWith("/")) return { root: "/", rest: path.slice(1) };
  return { root: "", rest: path };
}

/**
 * Normalize a path to forward slashes and collapse `.`/`..` segments lexically.
 *
 * Absolute paths keep their root (`/`, `//` or a drive such as `C:/`) and never
 * climb above it. Relative paths keep leading `..` segments. An empty result
 * becomes `.`.
 */
export function normalizePath(path: string): string {
  const slashed = toPosix(path);
  const { root, rest } = splitRoot(slashed);
  const segments: string[] = [];

  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = segments[segments.length - 1];
      if (last !== undefined && last !== "..") segments.pop();
      else if (root === "") segments.push("..");
      continue;
    }
    segments.push(segment);
  }

  const body = segments.join("/");
  if (root === "") return body === "" ? "." : body;
  if (root === "/") return body === "" ? "/" : `/${body}`;
  if (root === "//") return body === "" ? "//" : `//${body}`;
  return body === "" ? root : `${root}${body}`;
}

/** Join path parts with `/`, resetting to an absolute part when one appears. */
export function joinPath(base: string, ...parts: readonly string[]): string {
  let result = normalizePath(base);
  for (const part of parts) {
    if (part === undefined || part === "") continue;
    if (isAbsolutePath(part)) {
      result = normalizePath(part);
      continue;
    }
    result = normalizePath(result === "." ? part : `${result}/${part}`);
  }
  return result;
}

/** Return the parent directory of a normalized path. */
export function dirnamePath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/" || normalized === "//" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  const parent = normalized.slice(0, index);
  if (parent === "") return "/";
  if (parent === "/") return "/";
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent;
}

/** Return the final path segment, or an empty string for a root. */
export function basenamePath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/" || normalized === "//" || /^[A-Za-z]:\/$/.test(normalized)) {
    return "";
  }
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

function isDriveRoot(root: string): boolean {
  return /^[A-Za-z]:\/$/.test(root);
}

function rootsMatch(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function segmentsEqual(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Compute a relative path from one path to another.
 *
 * Both paths must share the same absolute root; otherwise the normalized target
 * is returned unchanged. Relative inputs are compared lexically. The result is
 * `.` when the paths are identical.
 */
export function relativePath(from: string, to: string): string {
  const source = normalizePath(from);
  const target = normalizePath(to);
  const sourceRoot = splitRoot(source);
  const targetRoot = splitRoot(target);

  if (!rootsMatch(sourceRoot.root, targetRoot.root)) {
    return target;
  }

  const caseInsensitive = isDriveRoot(sourceRoot.root) && isDriveRoot(targetRoot.root);
  const sourceSegments = sourceRoot.rest.split("/").filter((segment) => segment !== "");
  const targetSegments = targetRoot.rest.split("/").filter((segment) => segment !== "");

  let common = 0;
  while (
    common < sourceSegments.length &&
    common < targetSegments.length &&
    segmentsEqual(sourceSegments[common] ?? "", targetSegments[common] ?? "", caseInsensitive)
  ) {
    common += 1;
  }

  if (sourceRoot.root === "" && common === 0) return target;

  const parts: string[] = [];
  for (let index = common; index < sourceSegments.length; index += 1) parts.push("..");
  for (let index = common; index < targetSegments.length; index += 1) {
    parts.push(targetSegments[index] ?? "");
  }
  return parts.length === 0 ? "." : parts.join("/");
}

/**
 * Whether `target` lies inside `root`, including the root itself.
 *
 * Comparison is lexical. Drive-letter roots and their segments are compared
 * case-insensitively to match Windows expectations; POSIX paths stay
 * case-sensitive. Symlink and full case policy belong to the injected host.
 */
export function isWithinPath(root: string, target: string): boolean {
  const base = normalizePath(root);
  const candidate = normalizePath(target);
  const baseRoot = splitRoot(base);
  const candidateRoot = splitRoot(candidate);

  if (!rootsMatch(baseRoot.root, candidateRoot.root)) return false;

  const caseInsensitive = isDriveRoot(baseRoot.root) && isDriveRoot(candidateRoot.root);
  const baseSegments = baseRoot.rest.split("/").filter((segment) => segment !== "");
  const candidateSegments = candidateRoot.rest.split("/").filter((segment) => segment !== "");

  if (baseSegments.length > candidateSegments.length) return false;
  return baseSegments.every((segment, index) =>
    segmentsEqual(segment, candidateSegments[index] ?? "", caseInsensitive),
  );
}

/**
 * Whether a path is a safe, non-empty relative path that does not climb out of
 * its base (`..`, `../x` and absolute paths are not safe).
 */
export function isSafeRelativePath(path: string): boolean {
  return (
    path !== "" && path !== "." && path !== ".." && !isAbsolutePath(path) && !path.startsWith("../")
  );
}
