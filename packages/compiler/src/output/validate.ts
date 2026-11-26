/**
 * Validation helpers for the pure output planner.
 *
 * Everything here operates on already-resolved absolute POSIX paths. No
 * filesystem call is made; an optional host may canonicalize paths so symlink
 * escapes are detected, and callers may supply targets already owned by other
 * entries so multi-entry collisions are rejected before writing.
 */

import type { Diagnostic } from "../types/diagnostics.js";
import { error, warning } from "../types/diagnostics.js";
import type { OutputKind } from "../types/result.js";
import type { Span } from "../types/span.js";
import { isAbsolutePath, isWithinPath, joinPath, normalizePath, relativePath } from "./paths.js";

/** Minimal host surface needed by the planner; defaults to lexical identity. */
export interface OutputPlannerHost {
  /**
   * Return the canonical path used for containment checks, resolving symlinks
   * and platform case rules. Implementations may throw; the planner converts a
   * throw into a XESSA5001 error instead of leaking the exception.
   */
  canonicalize(path: string): string;
}

/** A resolved artifact before overlap, duplicate and escape validation. */
export interface OutputCandidate {
  /** Artifact kind, which determines writer and manifest handling. */
  readonly kind: OutputKind;
  /** Absolute POSIX destination. */
  readonly absolutePath: string;
  /** Workspace-relative POSIX destination. */
  readonly workspacePath: string;
  /** Workspace-relative POSIX source path. */
  readonly sourceFile: string;
}

/** One source path in absolute and workspace-relative forms. */
export interface SourceLocation {
  /** Workspace-relative POSIX source path. */
  readonly relative: string;
  /** Absolute POSIX source path. */
  readonly absolute: string;
}

/** Inputs shared by candidate and name validation. */
export interface ValidationContext {
  /** Absolute POSIX workspace root. */
  readonly workspaceRoot: string;
  /** Normalized source location used for diagnostics and overlap checks. */
  readonly source: SourceLocation;
  /** Diagnostic span for output-planning failures (zero-width at file start). */
  readonly span: Span;
  /** Optional canonicalization host. */
  readonly host?: OutputPlannerHost;
  /** Absolute or workspace-relative targets already planned by other entries. */
  readonly occupiedTargets?: readonly string[];
}

/**
 * Validate a CSS or JS basename.
 *
 * Names are basenames only: separators, `.`/`..`, empty names and the wrong
 * extension are rejected with XESSA5001. Spaces and other legal filename
 * characters are accepted.
 */
export function validateName(name: string, kind: "css" | "js", span: Span): Diagnostic | undefined {
  const extension = kind === "css" ? ".css" : ".js";
  const label = kind === "css" ? "css-name" : "map-name";
  if (name.length === 0) {
    return error("XESSA5001", `${label} must not be empty.`, span);
  }
  if (name === "." || name === "..") {
    return error("XESSA5001", `${label} "${name}" is a traversal segment, not a filename.`, span);
  }
  if (name.includes("/") || name.includes("\\")) {
    return error(
      "XESSA5001",
      `${label} "${name}" must be a basename without path separators.`,
      span,
    );
  }
  if (name.includes("\0")) {
    return error("XESSA5001", `${label} contains a NUL byte.`, span);
  }
  if (!name.endsWith(extension)) {
    return error(
      "XESSA5001",
      `${label} "${name}" must end in ${extension} (extension normalization is not enabled).`,
      span,
    );
  }
  return undefined;
}

/**
 * Find two or more planned artifacts that resolve to the same destination.
 *
 * Extension rules make this unreachable for a single entry today, but the check
 * keeps the planner safe if artifact kinds or naming rules grow.
 */
export function findDuplicateTargets(
  candidates: readonly OutputCandidate[],
  span: Span,
): readonly Diagnostic[] {
  const seen = new Map<string, OutputCandidate>();
  const diagnostics: Diagnostic[] = [];
  for (const candidate of candidates) {
    const key = normalizePath(candidate.absolutePath);
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, candidate);
      continue;
    }
    diagnostics.push(
      error(
        "XESSA5001",
        `Duplicate output target "${candidate.workspacePath}": ${previous.kind} and ${candidate.kind} plan the same destination.`,
        span,
      ),
    );
  }
  return diagnostics;
}

/**
 * Validate one resolved candidate against workspace containment, symlink
 * escapes, source overlap and targets owned by other entries.
 */
export function validateCandidate(
  candidate: OutputCandidate,
  context: ValidationContext,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const workspaceRoot = normalizePath(context.workspaceRoot);
  const target = normalizePath(candidate.absolutePath);
  const label = `${candidate.kind} output "${candidate.workspacePath}"`;

  const workspaceRelative = relativePath(workspaceRoot, target);
  if (
    isAbsolutePath(workspaceRelative) ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith("../")
  ) {
    diagnostics.push(
      error(
        "XESSA5001",
        `${label} escapes the workspace root "${workspaceRoot}" (resolved to "${target}").`,
        context.span,
      ),
    );
  }

  const canonicalRoot = canonicalizeOrThrow(
    workspaceRoot,
    workspaceRoot,
    context.host,
    context.span,
  );
  if (typeof canonicalRoot === "string") {
    const canonicalTarget = canonicalizeOrThrow(target, workspaceRoot, context.host, context.span);
    if (
      typeof canonicalTarget === "string" &&
      !isWithinPath(canonicalRoot, canonicalTarget) &&
      canonicalTarget !== target
    ) {
      diagnostics.push(
        error(
          "XESSA5001",
          `${label} resolves through a symlink outside the workspace root (canonical path "${canonicalTarget}").`,
          context.span,
        ),
      );
    } else if (typeof canonicalTarget !== "string") {
      diagnostics.push(canonicalTarget);
    }
  } else {
    diagnostics.push(canonicalRoot);
  }

  if (
    target === normalizePath(context.source.absolute) ||
    candidate.workspacePath === context.source.relative
  ) {
    diagnostics.push(
      error(
        "XESSA5001",
        `${label} would overwrite the input source "${context.source.relative}".`,
        context.span,
      ),
    );
  }

  for (const occupied of context.occupiedTargets ?? []) {
    const occupiedAbsolute = isAbsolutePath(occupied)
      ? normalizePath(occupied)
      : joinPath(workspaceRoot, occupied);
    if (occupiedAbsolute === target) {
      const occupiedRelative = relativePath(workspaceRoot, occupiedAbsolute);
      diagnostics.push(
        error(
          "XESSA5001",
          `${label} collides with the already-planned target "${occupiedRelative.startsWith("..") ? occupiedAbsolute : occupiedRelative}".`,
          context.span,
        ),
      );
    }
  }

  return diagnostics;
}

function canonicalizeOrThrow(
  path: string,
  workspaceRoot: string,
  host: OutputPlannerHost | undefined,
  span: Span,
): string | Diagnostic {
  try {
    const canonical = host === undefined ? path : host.canonicalize(path);
    const normalized = normalizePath(canonical);
    return isAbsolutePath(normalized) ? normalized : joinPath(workspaceRoot, normalized);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return error(
      "XESSA5001",
      `Could not canonicalize "${path}" for output containment: ${detail}.`,
      span,
    );
  }
}

/**
 * Build the documented warning emitted when map emission is disabled but type
 * declarations were requested (ADR-0010).
 */
export function suppressedTypesWarning(span: Span): Diagnostic {
  return warning(
    "XESSA5001",
    "Type declarations were suppressed because emit-map is false; set map-types to false to acknowledge this warning.",
    span,
  );
}

/**
 * Return the workspace-relative destination for an absolute artifact path, or
 * the absolute path when it is not a safe relative form.
 */
export function workspacePathFor(workspaceRoot: string, absolutePath: string): string {
  return relativePath(workspaceRoot, absolutePath);
}
