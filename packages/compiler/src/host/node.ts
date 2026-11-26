/**
 * Default Node/Bun filesystem host for `compile`.
 *
 * The compiler core stays filesystem-free; this host is the batteries-included
 * adapter used by `compile` so callers do not have to build one. It is built on
 * Node-compatible modules only (`node:fs/promises`, `node:fs` for the
 * synchronous realpath required by {@link ModuleHost.canonicalize}, and
 * `node:path`), with no Bun-only APIs.
 *
 * Workspace policy: the root is the explicit `root` argument when provided,
 * otherwise `process.cwd()` resolved **at the moment `createNodeHost` is
 * called**. The caller should pass `CompileOptions.workspaceRoot` for stable
 * behaviour across process directory changes. Paths crossing the host boundary
 * are absolute POSIX-style paths with forward slashes; `node:path` handles the
 * platform separator and Windows drive letters internally.
 *
 * Canonicalization note: the frozen {@link ModuleHost.canonicalize} signature is
 * synchronous, so `fs/promises.realpath` (async) cannot back it directly. The
 * host uses `realpathSync` in a guarded try/catch, falling back to the resolved
 * lexical path when the target does not exist or the platform refuses to
 * resolve it. This is the only `node:fs` use; reads and existence checks use
 * `node:fs/promises` as requested.
 */

import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ModuleHost } from "../types/options.js";

/** Convert a platform path to a POSIX-style path with forward slashes. */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Remove a trailing separator except for a filesystem root. */
function trimTrailingSlash(path: string): string {
  if (path === "/" || /^[A-Za-z]:\/$/.test(path)) return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Create the default Node/Bun {@link ModuleHost}.
 *
 * @param root Absolute workspace root; defaults to `process.cwd()` at call
 *   time. Relative roots are resolved against the current directory.
 * @returns A host whose `canonicalize` resolves symlinks when the real path is
 *   available and falls back to a lexical absolute path otherwise.
 */
export function createNodeHost(root?: string): ModuleHost {
  const lexicalRoot = trimTrailingSlash(toPosix(resolve(root ?? process.cwd())));
  const workspaceRoot = realOrLexical(lexicalRoot);

  const absolute = (path: string): string =>
    trimTrailingSlash(toPosix(resolve(workspaceRoot, path)));

  return {
    async readFile(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
    async fileExists(path: string): Promise<boolean> {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    },
    canonicalize(path: string): string {
      return realOrLexical(absolute(path));
    },
    resolvePath(from: string, to: string): string {
      return trimTrailingSlash(toPosix(resolve(dirname(from), to)));
    },
    workspaceRoot(): string {
      return workspaceRoot;
    },
  };
}

function realOrLexical(path: string): string {
  try {
    return trimTrailingSlash(toPosix(realpathSync(path)));
  } catch {
    return path;
  }
}
