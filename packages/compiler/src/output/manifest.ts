/**
 * Manifest construction for planned artifacts.
 *
 * A manifest records every compiler-owned artifact so `xessa clean` and watch
 * invalidation can remove or refresh only files the compiler created. Entries
 * never carry timestamps and follow the same order as the plan. Content hashes
 * are added only after a successful write, so the planner omits them.
 */

import type { ManifestEntry, PlannedOutput } from "../types/result.js";

/**
 * Build one manifest entry per planned artifact, in plan order.
 *
 * @param outputs Deterministically ordered planned artifacts.
 * @returns Frozen manifest entries with kind, workspace path and source file.
 */
export function buildManifest(outputs: readonly PlannedOutput[]): readonly ManifestEntry[] {
  return Object.freeze(
    outputs.map((output) =>
      Object.freeze({
        kind: output.kind,
        workspacePath: output.workspacePath,
        sourceFile: output.sourceFile,
      }),
    ),
  );
}
