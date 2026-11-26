/**
 * Small POSIX path helpers for the VS Code extension.
 *
 * The compiler public API uses absolute POSIX paths with forward slashes
 * (`ModuleHost` contract), while VS Code document paths are platform paths.
 * These helpers are the single conversion boundary so the rest of the
 * extension never re-implements separators or `..` handling.
 */

/** Convert platform separators to POSIX forward slashes. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Whether a path is absolute in POSIX or Windows drive form. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

/** Normalize `.`/`..` segments and duplicate slashes without touching the filesystem. */
export function normalizePath(path: string): string {
  const posix = toPosix(path);
  const driveMatch = /^([A-Za-z]:)(\/|$)/.exec(posix);
  const drive = driveMatch?.[1] ?? "";
  const absolute = drive !== "" ? true : posix.startsWith("/");
  const body = drive !== "" ? posix.slice(drive.length) : posix;
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  if (drive !== "") return `${drive}/${joined}`;
  return absolute ? `/${joined}` : joined === "" ? "." : joined;
}

/** POSIX dirname of an already normalized path. */
export function dirnamePath(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  const directory = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(directory) ? `${directory}/` : directory;
}

/** POSIX join of an absolute or relative base and a relative or absolute segment. */
export function joinPath(base: string, segment: string): string {
  if (isAbsolutePath(segment)) return normalizePath(segment);
  if (base === "") return normalizePath(segment);
  return normalizePath(`${base.replace(/\/+$/, "")}/${segment}`);
}

/** POSIX basename. */
export function basenamePath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "";
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

/** Directory stem of a basename (`button.map.js` → `button.map`). */
export function stemOf(path: string): string {
  const base = basenamePath(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Workspace-relative POSIX path when `path` is inside `root`, else the
 * normalized absolute path. Mirrors the compiler's relative-path reporting.
 */
export function relativeTo(root: string, path: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, "");
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return ".";
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return normalizedPath;
  return normalizedPath.slice(normalizedRoot.length + 1);
}
