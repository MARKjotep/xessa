/**
 * Import specifier for the opt-in CSS side-effect import in the class map
 * (ADR-0021).
 *
 * The specifier is computed from the two planned artifacts, never from authored
 * settings, so it always names the stylesheet that is actually written:
 *
 * - relative to the directory of the emitted `map.js`;
 * - POSIX separators only;
 * - always `./`-prefixed when the stylesheet is in or below the map directory,
 *   and left as authored `..` segments when it is above it.
 *
 * The planner guarantees both artifacts stay inside the workspace; a
 * non-relative result would therefore mean the plan was rejected, and callers
 * omit the import instead of emitting a dangling specifier.
 */

import { dirnamePath, isAbsolutePath, relativePath } from "./paths.js";

/**
 * Return the ESM specifier a generated map uses to import its stylesheet.
 *
 * @param mapFile Absolute POSIX path of the generated JS map.
 * @param stylesheetFile Absolute POSIX path of the emitted stylesheet.
 */
export function stylesheetImportSpecifier(mapFile: string, stylesheetFile: string): string {
  const relative = relativePath(dirnamePath(mapFile), stylesheetFile);
  if (relative === "." || relative.startsWith("../") || isAbsolutePath(relative)) return relative;
  return `./${relative}`;
}
