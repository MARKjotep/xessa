import type { Stylesheet } from "./ast.js";
import type { Diagnostic } from "./diagnostics.js";
import type { CliOutputOverrides, ProjectConfig, ResolvedSetup } from "./options.js";

/**
 * Map from authored class name to emitted class name, for example
 * `{ "button-primary": "ui-button-primary" }`.
 *
 * Keys are the exact authored class tokens (safe quoted keys in generated JS),
 * so `__proto__` and other hazardous names must be represented with a
 * null-prototype object or computed keys. The same key set backs camelCase
 * named exports and the optional default-export aliases; an alias is added only
 * when it is unambiguous, and a collision such as `foo-bar` with `fooBar` is a
 * XESSA4001 error rather than a silent omission (ADR-0010). Global classes are
 * never present. Iteration order is deterministic.
 */
export type ClassMap = Readonly<Record<string, string>>;

/** Result of compiling one source string. */
export interface CompileResult {
  /** Generated stylesheet when CSS emission is enabled. */
  readonly css?: string;
  /** Generated JS class map when map emission is enabled. */
  readonly js?: string;
  /** Generated TypeScript declarations when type emission is enabled. */
  readonly types?: string;
  /** Standard v3 CSS source map text when requested and CSS is emitted. */
  readonly sourceMap?: string;
  /** Class name table with null-prototype safety semantics. */
  readonly classes: ClassMap;
  /** All diagnostics, errors and warnings, in source order. */
  readonly diagnostics: readonly Diagnostic[];
  /** Workspace-relative POSIX paths of every module the source depends on. */
  readonly dependencies: readonly string[];
}

/** Result of a tolerant parse. */
export interface ParseResult {
  /** Partial AST recovered at safe statement boundaries; never `undefined`. */
  readonly ast: Stylesheet;
  /** Syntax and lexical diagnostics in source order. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Kinds of artifact the output planner can plan. */
export type OutputKind = "css" | "js" | "types" | "cssSourceMap";

/** One planned artifact; the planner never writes it. */
export interface PlannedOutput {
  /** Artifact kind, which determines the writer and manifest handling. */
  readonly kind: OutputKind;
  /** Absolute, POSIX-normalized destination path. */
  readonly absolutePath: string;
  /** Workspace-relative POSIX destination used for manifests and reporting. */
  readonly workspacePath: string;
  /** Workspace-relative POSIX path of the source that produced the artifact. */
  readonly sourceFile: string;
}

/**
 * One compiler-owned artifact recorded in the build manifest.
 *
 * Manifests let `clean` remove only files the compiler created and left
 * untouched, and let rebuilds drop obsolete owned outputs after a successful
 * build. Entries are deterministic and never carry timestamps.
 */
export interface ManifestEntry {
  /** Artifact kind of the tracked file. */
  readonly kind: OutputKind;
  /** Workspace-relative POSIX path of the tracked file. */
  readonly workspacePath: string;
  /** Workspace-relative POSIX path of the source that produced it. */
  readonly sourceFile: string;
  /** Content hash recorded after a successful write, when available. */
  readonly contentHash?: string;
}

/**
 * Ordered, validated set of artifacts for one entry plus its manifest records.
 *
 * `outputs` follows a stable kind order (CSS, JS map, declarations, CSS source
 * map) so builds are deterministic; `manifest` mirrors the same artifacts in
 * the same order.
 */
export interface OutputPlan {
  /** Planned artifacts in deterministic order. */
  readonly outputs: readonly PlannedOutput[];
  /** Manifest records for the planned artifacts, in the same order. */
  readonly manifest: readonly ManifestEntry[];
}

/** Inputs to the pure output planner. */
export interface PlanOutputsInput {
  /** Workspace-relative POSIX path of the entry source. */
  readonly sourceFile: string;
  /** Effective output settings after defaults, config, `@setup` and CLI precedence. */
  readonly setup: ResolvedSetup;
  /** Project configuration contributing project-level directories and output flags. */
  readonly projectConfig?: ProjectConfig;
  /** Explicit CLI overrides applied last. */
  readonly cliOverrides?: CliOutputOverrides;
  /** Absolute POSIX workspace root used for containment checks. */
  readonly workspaceRoot: string;
}

/** Result of planning outputs: the plan plus any collision or safety diagnostics. */
export interface PlanOutputsResult {
  /** Valid plan containing only artifacts that passed every XESSA5001 check. */
  readonly plan: OutputPlan;
  /** Output-planning diagnostics; any error means the plan must not be written. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Signature of the pure output planner exposed as `planOutputs`.
 *
 * It resolves every destination, validates collisions, overlap, workspace and
 * symlink escapes, and returns diagnostics instead of writing or throwing for
 * expected planning failures.
 */
export type PlanOutputs = (input: PlanOutputsInput) => PlanOutputsResult;
