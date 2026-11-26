/**
 * Compiler-owned output manifest.
 *
 * The manifest lives at `<workspaceRoot>/.cssx-manifest.json` — the workspace
 * root is the directory containing `xessa.config.json` (ADR-0007), so one
 * manifest exists per project. It records the workspace-relative path, source
 * and SHA-256 hash of every file the CLI wrote, which lets `clean` delete only
 * compiler-owned files that were not modified since generation.
 *
 * Records are sorted by path and the document is written atomically, so the file
 * is deterministic across runs and safe to interrupt.
 */

import { readFile } from "node:fs/promises";
import type { OutputKind } from "@xessa/compiler";
import { isEscapingPath, joinPosix } from "./paths.js";
import { atomicWrite } from "./writer.js";

/** Manifest file name at the workspace root. */
export const MANIFEST_FILENAME = ".cssx-manifest.json";

/** Manifest schema version written by this CLI. */
export const MANIFEST_VERSION = 1;

/** One compiler-owned generated file. */
export interface ManifestRecord {
  /** Artifact kind that produced the file. */
  readonly kind: OutputKind;
  /** Workspace-relative POSIX path of the generated file. */
  readonly path: string;
  /** Workspace-relative POSIX path of the source that produced it. */
  readonly source: string;
  /** SHA-256 hash of the content written by the compiler. */
  readonly hash: string;
}

/** On-disk manifest document. */
export interface ManifestDocument {
  readonly version: number;
  readonly files: readonly ManifestRecord[];
}

const OUTPUT_KINDS: ReadonlySet<string> = new Set(["css", "js", "types", "cssSourceMap"]);

/** Artifact suffix produced by each output kind. */
const ARTIFACT_SUFFIX: Readonly<Record<OutputKind, string>> = {
  css: ".css",
  js: ".js",
  types: ".d.ts",
  cssSourceMap: ".map",
};

/**
 * Whether a record has the shape of a compiler artifact.
 *
 * A manifest record is not proof of ownership on its own: the document can be
 * hand-edited or copied from another project. Deleting requires an
 * artifact-shaped path for its `kind` and a `source` that is a workspace-relative
 * `.cssx` file. Path containment is the caller's responsibility.
 */
export function isArtifactRecord(record: ManifestRecord): boolean {
  if (!record.path.endsWith(ARTIFACT_SUFFIX[record.kind])) return false;
  if (isEscapingPath(record.source) || !record.source.endsWith(".cssx")) return false;
  return true;
}

/** Absolute path of the manifest for a workspace root. */
export function manifestPath(workspaceRoot: string): string {
  return joinPosix(workspaceRoot, MANIFEST_FILENAME);
}

/** An empty, valid manifest document. */
export function emptyManifest(): ManifestDocument {
  return { version: MANIFEST_VERSION, files: [] };
}

/** Read the manifest, treating missing or malformed documents as empty. */
export async function readManifest(
  workspaceRoot: string,
): Promise<{ manifest: ManifestDocument; warnings: readonly string[] }> {
  const path = manifestPath(workspaceRoot);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { manifest: emptyManifest(), warnings: [] };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      manifest: emptyManifest(),
      warnings: [`Ignoring ${MANIFEST_FILENAME}: invalid JSON.`],
    };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      manifest: emptyManifest(),
      warnings: [`Ignoring ${MANIFEST_FILENAME}: expected a JSON object.`],
    };
  }

  const record = value as { version?: unknown; files?: unknown };
  if (record.version !== MANIFEST_VERSION) {
    return {
      manifest: emptyManifest(),
      warnings: [`Ignoring ${MANIFEST_FILENAME}: unsupported manifest version.`],
    };
  }

  const warnings: string[] = [];
  const files: ManifestRecord[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(record.files)) {
    return {
      manifest: emptyManifest(),
      warnings: [`Ignoring ${MANIFEST_FILENAME}: "files" must be an array.`],
    };
  }

  for (const entry of record.files) {
    if (!isManifestRecord(entry)) {
      warnings.push(`Ignoring malformed ${MANIFEST_FILENAME} entry.`);
      continue;
    }
    if (isEscapingPath(entry.path)) {
      warnings.push(`Ignoring unsafe ${MANIFEST_FILENAME} path: ${entry.path}`);
      continue;
    }
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    files.push({
      kind: entry.kind,
      path: entry.path,
      source: entry.source,
      hash: entry.hash,
    });
  }

  return { manifest: { version: MANIFEST_VERSION, files: sortRecords(files) }, warnings };
}

/** Write the manifest atomically with a stable record order. */
export async function writeManifest(
  workspaceRoot: string,
  manifest: ManifestDocument,
): Promise<void> {
  const document = {
    version: MANIFEST_VERSION,
    files: sortRecords(manifest.files),
  };
  await atomicWrite(manifestPath(workspaceRoot), `${JSON.stringify(document, null, 2)}\n`);
}

/** Sort manifest records by path for deterministic output. */
export function sortRecords(records: readonly ManifestRecord[]): ManifestRecord[] {
  return [...records].sort((left, right) => (left.path < right.path ? -1 : 1));
}

function isManifestRecord(value: unknown): value is ManifestRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<Record<keyof ManifestRecord, unknown>>;
  return (
    typeof record.kind === "string" &&
    OUTPUT_KINDS.has(record.kind) &&
    typeof record.path === "string" &&
    record.path !== "" &&
    typeof record.source === "string" &&
    typeof record.hash === "string" &&
    record.hash.startsWith("sha256:")
  );
}
