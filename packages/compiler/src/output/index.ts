/**
 * Pure output planner for Xessa (SPECIFICATION.md §9).
 *
 * `planOutputs` resolves every CSS, JS map, declaration and CSS source-map
 * destination from the frozen `ResolvedSetup`/`ProjectConfig`/CLI inputs,
 * validates the complete plan, and returns it with a matching manifest. It is
 * synchronous, deterministic and never writes. Expected planning failures are
 * returned as XESSA5001 diagnostics instead of exceptions.
 *
 * The frozen `PlanOutputsInput` does not carry a host or trusted-output policy.
 * This module therefore exposes an optional second context argument:
 * `host` supplies `canonicalize` for symlink containment, and
 * `occupiedTargets` lets a project build pass targets already planned by other
 * entries so cross-source collisions are rejected. Without them the planner
 * uses lexical identity canonicalization and validates one entry at a time.
 * External output is always rejected; no trusted policy escape exists in the
 * frozen contracts.
 */

import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type {
  OutputKind,
  OutputPlan,
  PlanOutputsInput,
  PlanOutputsResult,
  PlannedOutput,
} from "../types/result.js";
import type { Span } from "../types/span.js";
import { buildManifest } from "./manifest.js";
import { isAbsolutePath, joinPath, normalizePath, relativePath } from "./paths.js";
import {
  declarationNameFor,
  resolveOutputSettings,
  resolveSource,
  sourceMapNameFor,
} from "./resolve.js";
import type { OutputCandidate, OutputPlannerHost } from "./validate.js";
import {
  findDuplicateTargets,
  suppressedTypesWarning,
  validateCandidate,
  validateName,
  workspacePathFor,
} from "./validate.js";

export type { OutputPlannerHost } from "./validate.js";

/** Optional planning context that the frozen input shape has no room for. */
export interface OutputPlannerContext {
  /** Canonicalization host used to detect symlink escapes. */
  readonly host?: OutputPlannerHost;
  /** Absolute or workspace-relative targets already planned by other entries. */
  readonly occupiedTargets?: readonly string[];
}

/**
 * Validate and return the complete output plan for one entry before anything is
 * written.
 *
 * @param input Frozen planner input: source, effective setup, optional project
 *   configuration and CLI overrides, and the absolute workspace root.
 * @param context Optional host and cross-entry occupied targets.
 * @returns The valid plan plus diagnostics. Any error leaves an empty plan so a
 *   caller cannot accidentally write a partial or unsafe artifact set.
 */
export function planOutputs(
  input: PlanOutputsInput,
  context: OutputPlannerContext = {},
): PlanOutputsResult {
  const workspaceRoot = normalizePath(input.workspaceRoot);
  const resolvedSource = resolveSource(input);
  const sourceRelative = relativePath(workspaceRoot, resolvedSource.absolute);
  const source = Object.freeze({ ...resolvedSource, relative: sourceRelative });
  const span: Span = Object.freeze({ start: 0, end: 0, file: sourceRelative });
  const emptyPlan: OutputPlan = Object.freeze({
    outputs: Object.freeze([]),
    manifest: Object.freeze([]),
  });
  const diagnostics: Diagnostic[] = [];

  if (!isAbsolutePath(workspaceRoot)) {
    diagnostics.push(
      error(
        "XESSA5001",
        `Workspace root "${input.workspaceRoot}" must be an absolute POSIX or drive-letter path.`,
        span,
      ),
    );
    return freezeResult(emptyPlan, diagnostics);
  }

  if (
    isAbsolutePath(sourceRelative) ||
    sourceRelative === ".." ||
    sourceRelative.startsWith("../")
  ) {
    diagnostics.push(
      error(
        "XESSA5001",
        `Source "${sourceRelative}" is outside the workspace root "${workspaceRoot}".`,
        span,
      ),
    );
    return freezeResult(emptyPlan, diagnostics);
  }

  const settings = resolveOutputSettings(input, source, workspaceRoot);

  let emitTypes = settings.emitTypes;
  if (!settings.emitMap && settings.emitTypes) {
    diagnostics.push(suppressedTypesWarning(span));
    emitTypes = false;
  }

  const cssNameDiagnostic = settings.emitCss
    ? validateName(settings.cssName, "css", span)
    : undefined;
  if (cssNameDiagnostic !== undefined) diagnostics.push(cssNameDiagnostic);
  const mapNameDiagnostic = settings.emitMap
    ? validateName(settings.mapName, "js", span)
    : undefined;
  if (mapNameDiagnostic !== undefined) diagnostics.push(mapNameDiagnostic);

  if (hasError(diagnostics)) {
    return freezeResult(emptyPlan, diagnostics);
  }

  const candidates: OutputCandidate[] = [];
  const mapAbsolute = joinPath(settings.mapDir, settings.mapName);

  if (settings.emitCss) {
    for (const directory of settings.cssDirs) {
      const cssAbsolute = joinPath(directory, settings.cssName);
      candidates.push(toCandidate("css", cssAbsolute, source.relative, workspaceRoot));
    }
  }
  if (settings.emitMap) {
    candidates.push(toCandidate("js", mapAbsolute, source.relative, workspaceRoot));
    if (emitTypes) {
      const declarationsAbsolute = joinPath(settings.mapDir, declarationNameFor(settings.mapName));
      candidates.push(toCandidate("types", declarationsAbsolute, source.relative, workspaceRoot));
    }
  }
  if (settings.emitCss && settings.sourceMap) {
    for (const directory of settings.cssDirs) {
      const mapFileAbsolute = joinPath(directory, sourceMapNameFor(settings.cssName));
      candidates.push(toCandidate("cssSourceMap", mapFileAbsolute, source.relative, workspaceRoot));
    }
  }

  for (const candidate of candidates) {
    diagnostics.push(
      ...validateCandidate(candidate, {
        workspaceRoot,
        source: { relative: source.relative, absolute: source.absolute },
        span,
        ...(context.host === undefined ? {} : { host: context.host }),
        ...(context.occupiedTargets === undefined
          ? {}
          : { occupiedTargets: context.occupiedTargets }),
      }),
    );
  }
  diagnostics.push(...findDuplicateTargets(candidates, span));

  if (hasError(diagnostics)) {
    return freezeResult(emptyPlan, diagnostics);
  }

  const outputs: readonly PlannedOutput[] = Object.freeze(
    candidates.map((candidate) =>
      Object.freeze({
        kind: candidate.kind,
        absolutePath: candidate.absolutePath,
        workspacePath: candidate.workspacePath,
        sourceFile: candidate.sourceFile,
      }),
    ),
  );
  return freezeResult(
    Object.freeze({
      outputs,
      manifest: buildManifest(outputs),
    }),
    diagnostics,
  );
}

function toCandidate(
  kind: OutputKind,
  absolutePath: string,
  sourceFile: string,
  workspaceRoot: string,
): OutputCandidate {
  return Object.freeze({
    kind,
    absolutePath: normalizePath(absolutePath),
    workspacePath: workspacePathFor(workspaceRoot, absolutePath),
    sourceFile,
  });
}

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function freezeResult(plan: OutputPlan, diagnostics: Diagnostic[]): PlanOutputsResult {
  return Object.freeze({
    plan,
    diagnostics: Object.freeze([...diagnostics]),
  });
}
