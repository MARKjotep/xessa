/**
 * `xessa clean` — remove compiler-owned outputs.
 *
 * Only files recorded in `.cssx-manifest.json` whose current SHA-256 hash still
 * matches the manifest are deleted. Files modified since generation are kept and
 * reported; missing files are dropped from the manifest. `--dry-run` reports the
 * same decision without touching the disk.
 */

import type { CliInvocation } from "../args.js";
import { findWorkspaceRoot, loadConfig } from "../config.js";
import { type ManifestRecord, isArtifactRecord, readManifest, writeManifest } from "../manifest.js";
import { dirnamePosix, isWithin, joinPosix } from "../paths.js";
import { invocationFailure, toJson, writeErrorLine, writeLine } from "../report.js";
import { hashFile, removeFile, sweepTemporaries } from "../writer.js";

/** One file handled by `clean`. */
interface CleanItem {
  /** Workspace-relative POSIX path of the generated file. */
  readonly path: string;
  /** `deleted`, `would-delete`, `missing` or `modified`. */
  readonly reason: string;
}

/** Machine-readable clean report. */
interface CleanReport {
  readonly command: "clean";
  readonly success: boolean;
  readonly exitCode: number;
  readonly dryRun: boolean;
  readonly workspaceRoot: string;
  readonly configFile: string | null;
  readonly removed: readonly CleanItem[];
  readonly skipped: readonly CleanItem[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Run `xessa clean`. */
export async function runClean(invocation: CliInvocation, cwd: string): Promise<number> {
  const loaded = await loadConfig({
    cwd,
    startDir: cwd,
    ...(invocation.configPath === undefined ? {} : { explicitPath: invocation.configPath }),
  });
  if (!loaded.ok) return invocationFailure(invocation.command, loaded.message, invocation.json);

  const config = loaded.config;
  const root = config === null ? await findWorkspaceRoot(cwd) : config.root;
  const warnings = [...loaded.warnings];
  const errors: string[] = [];
  const removed: CleanItem[] = [];
  const skipped: CleanItem[] = [];

  const manifestResult = await readManifest(root);
  warnings.push(...manifestResult.warnings);

  // Sweep writer temporaries left behind by an interrupted build. The manifest
  // carries the artifact directories; the workspace root and configured output
  // directories cover a manifest write that was itself interrupted.
  const sweepDirectories = new Set<string>([root]);
  for (const directory of [config?.output?.cssDir, config?.output?.mapDir]) {
    if (directory === undefined) continue;
    const absolute = joinPosix(root, directory);
    if (isWithin(root, absolute)) sweepDirectories.add(absolute);
  }
  for (const record of manifestResult.manifest.files) {
    const directory = dirnamePosix(joinPosix(root, record.path));
    if (isWithin(root, directory)) sweepDirectories.add(directory);
  }
  await sweepTemporaries([...sweepDirectories]);

  const remaining: ManifestRecord[] = [];
  for (const record of manifestResult.manifest.files) {
    const absolute = joinPosix(root, record.path);
    if (!isWithin(root, absolute) || record.path.startsWith("/")) {
      warnings.push(`Ignoring manifest path outside the workspace: ${record.path}`);
      continue;
    }
    if (!isCompilerArtifact(record, root)) {
      skipped.push({ path: record.path, reason: "untrusted" });
      warnings.push(
        `Refusing to delete ${record.path}: the record does not describe a compiler artifact; ownership released.`,
      );
      continue;
    }

    const currentHash = await hashFile(absolute);
    if (currentHash === null) {
      skipped.push({ path: record.path, reason: "missing" });
      continue;
    }
    if (currentHash !== record.hash) {
      skipped.push({ path: record.path, reason: "modified" });
      warnings.push(`Kept ${record.path}: modified since generation; ownership released.`);
      continue;
    }
    if (invocation.dryRun) {
      removed.push({ path: record.path, reason: "would-delete" });
      continue;
    }
    try {
      await removeFile(absolute);
      removed.push({ path: record.path, reason: "deleted" });
    } catch (error) {
      errors.push(`Could not delete ${record.path}: ${describeError(error)}`);
      remaining.push(record);
    }
  }

  if (!invocation.dryRun) {
    // Records whose deletion failed stay owned so a retry can finish the job.
    try {
      await writeManifest(root, { version: 1, files: remaining });
    } catch (error) {
      errors.push(`Could not update .cssx-manifest.json: ${describeError(error)}`);
    }
  }

  const failed = errors.length > 0;
  const report: CleanReport = {
    command: "clean",
    success: !failed,
    exitCode: failed ? 1 : 0,
    dryRun: invocation.dryRun,
    workspaceRoot: root,
    configFile: config?.file ?? null,
    removed,
    skipped,
    warnings,
    errors,
  };

  if (invocation.json) {
    writeLine(toJson(report).trimEnd());
  } else {
    for (const item of removed) {
      writeLine(invocation.dryRun ? `would remove ${item.path}` : `removed ${item.path}`);
    }
    for (const item of skipped) writeLine(`skipped ${item.path} (${item.reason})`);
    for (const warning of warnings) writeErrorLine(`xessa: warning: ${warning}`);
    for (const error of errors) writeErrorLine(`xessa: error: ${error}`);
    const verb = invocation.dryRun ? "removable" : "removed";
    writeLine(
      `xessa clean: ${removed.length} file${removed.length === 1 ? "" : "s"} ${verb}, ` +
        `${skipped.length} skipped`,
    );
  }

  return failed ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a manifest record describes a file the compiler can have produced.
 *
 * A record alone is not proof of ownership: the manifest can be hand-edited or
 * copied from another project. Deletion therefore also requires an
 * artifact-shaped path for its `kind` and a `source` that resolves inside the
 * workspace. Anything else is released, not deleted (CSSX-T10).
 */
function isCompilerArtifact(record: ManifestRecord, root: string): boolean {
  if (!isArtifactRecord(record)) return false;
  return isWithin(root, joinPosix(root, record.source));
}
