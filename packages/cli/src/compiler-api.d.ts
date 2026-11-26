/**
 * Ambient declaration of the compiler surface the CLI consumes.
 *
 * The monorepo does not link workspace packages into `node_modules` and the
 * compiler intentionally publishes only `dist` declarations, so the CLI
 * typechecks against this mirror of the public barrel
 * (`packages/compiler/src/index.ts`) instead of reaching into compiler
 * internals. When a real `@xessa/compiler` installation resolves (or the
 * compiler's `dist` is present with `paths`/`node_modules` wiring), TypeScript
 * uses the package's own declarations instead and this mirror is ignored.
 *
 * Keep this file limited to the symbols the CLI imports. The Node smoke test
 * exercises every mirrored function against the built compiler, so drift
 * between this mirror and the real exports fails a gate.
 */

declare module "@xessa/compiler" {
  /** Half-open range of offsets into one source file. */
  export interface Span {
    readonly start: number;
    readonly end: number;
    readonly file: string;
  }

  /** Stable XESSA#### diagnostic with severity and origin span. */
  export interface Diagnostic {
    readonly code: string;
    readonly severity: "error" | "warning";
    readonly message: string;
    readonly span: Span;
  }

  /** One authored setting inside a `@setup` block. */
  export interface SetupSetting {
    readonly kind: "setting";
    readonly key: string;
    readonly value: string;
    readonly valueSpan: Span;
    readonly span: Span;
  }

  /** A `@setup { ... }` block as returned by `parse`. */
  export interface SetupBlock {
    readonly kind: "setup";
    readonly settings: readonly SetupSetting[];
    readonly span: Span;
  }

  /** Any top-level stylesheet item; only `kind === "setup"` is inspected. */
  export interface StylesheetItem {
    readonly kind: string;
  }

  /** Parsed stylesheet; the CLI only reads top-level `@setup` blocks. */
  export interface Stylesheet {
    readonly kind: "stylesheet";
    readonly file: string;
    readonly items: readonly StylesheetItem[];
    readonly span: Span;
  }

  /** Result of the tolerant `parse` entry point. */
  export interface ParseResult {
    readonly ast: Stylesheet;
    readonly diagnostics: readonly Diagnostic[];
  }

  /** Map from authored class name to emitted class name. */
  export type ClassMap = Readonly<Record<string, string>>;

  /** Artifacts and diagnostics for one compiled source. */
  export interface CompileResult {
    readonly css?: string;
    readonly js?: string;
    readonly types?: string;
    readonly sourceMap?: string;
    readonly classes: ClassMap;
    readonly diagnostics: readonly Diagnostic[];
    readonly dependencies: readonly string[];
  }

  /** Class naming strategies available in v0.1. */
  export type NamingStrategy = "none" | "prefix";

  /** Class naming configuration. */
  export interface NamingOptions {
    readonly strategy: NamingStrategy;
    readonly prefix?: string;
  }

  /** Media grouping modes accepted by v0.1. */
  export type MediaGroupingMode = "safe" | "none" | "merge";

  /** Output settings shared by `@setup`, project config and CLI overrides. */
  export interface OutputOptions {
    readonly cssDir?: string;
    readonly cssName?: string;
    readonly mapDir?: string;
    readonly mapName?: string;
    readonly emitCss?: boolean;
    readonly emitMap?: boolean;
    readonly mapTypes?: boolean;
    readonly emitTypes?: boolean;
    readonly sourceMap?: boolean;
    readonly minify?: boolean;
    readonly mapInherit?: boolean;
    readonly importCss?: boolean;
  }

  /** Options accepted by `compile`. */
  export interface CompileOptions extends OutputOptions {
    readonly file: string;
    readonly prefix?: string;
    readonly naming?: NamingOptions;
    readonly media?: Readonly<Record<string, string>>;
    /** Strict validation. Default `true` (ADR-0023). */
    readonly strict?: boolean;
    /** Media grouping. Default `"safe"`. */
    readonly mediaGrouping?: MediaGroupingMode;
    readonly workspaceRoot?: string;
  }

  /** Compiler behaviour settings from `xessa.config.json` (`compiler`). */
  export interface CompilerConfig {
    /** Reject unknown configuration keys. Default `true` (ADR-0023). */
    readonly strict?: boolean;
    /** Media grouping. Default `"safe"`. */
    readonly mediaGrouping?: MediaGroupingMode;
  }

  /** Declarative project configuration shape. */
  export interface ProjectConfig {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly output?: OutputOptions;
    readonly classes?: NamingOptions;
    readonly media?: Readonly<Record<string, string>>;
    readonly compiler?: CompilerConfig;
  }

  /** Options accepted by `compileProject`. */
  export interface CompileProjectOptions {
    readonly projectRoot?: string;
    readonly configFile?: string;
    readonly output?: OutputOptions;
    readonly naming?: NamingOptions;
    readonly media?: Readonly<Record<string, string>>;
    readonly strict?: boolean;
    readonly mediaGrouping?: MediaGroupingMode;
  }

  /** Effective output settings after merging every layer. */
  export interface ResolvedSetup
    extends Required<Omit<OutputOptions, "mapTypes" | "mapInherit" | "importCss">> {
    readonly prefix: string;
    readonly mapInherit?: boolean;
    readonly importCss?: boolean;
    readonly cssDirs?: readonly string[];
  }

  /** One decoded item in a comma-separated `@setup` value list. */
  export interface SetupListEntry {
    readonly value: string;
    readonly span: Span;
  }

  /** Result of {@link decodeSetupList}. */
  export interface SetupListResult {
    readonly entries: readonly SetupListEntry[];
    readonly isList: boolean;
    readonly diagnostics: readonly Diagnostic[];
  }

  /** Decode a comma-separated `@setup` value list and its per-item diagnostics. */
  export function decodeSetupList(raw: string, span: Span): SetupListResult;

  /** Explicit CLI overrides; partial by design. */
  export type CliOutputOverrides = OutputOptions & { readonly prefix?: string };

  /** Filesystem and policy operations the compiler needs from its host. */
  export interface ModuleHost {
    readFile(path: string): Promise<string>;
    fileExists(path: string): Promise<boolean>;
    canonicalize(path: string): string;
    resolvePath(from: string, to: string): string;
    workspaceRoot(): string;
  }

  /** Artifact kinds the planner can plan. */
  export type OutputKind = "css" | "js" | "types" | "cssSourceMap";

  /** One planned artifact; the planner never writes it. */
  export interface PlannedOutput {
    readonly kind: OutputKind;
    readonly absolutePath: string;
    readonly workspacePath: string;
    readonly sourceFile: string;
  }

  /** One compiler-owned artifact recorded in the build manifest. */
  export interface ManifestEntry {
    readonly kind: OutputKind;
    readonly workspacePath: string;
    readonly sourceFile: string;
    readonly contentHash?: string;
  }

  /** Ordered, validated artifact set for one entry. */
  export interface OutputPlan {
    readonly outputs: readonly PlannedOutput[];
    readonly manifest: readonly ManifestEntry[];
  }

  /** Inputs to the pure output planner. */
  export interface PlanOutputsInput {
    readonly sourceFile: string;
    readonly setup: ResolvedSetup;
    readonly projectConfig?: ProjectConfig;
    readonly cliOverrides?: CliOutputOverrides;
    readonly workspaceRoot: string;
  }

  /** Planner result: valid plan plus XESSA5001 diagnostics. */
  export interface PlanOutputsResult {
    readonly plan: OutputPlan;
    readonly diagnostics: readonly Diagnostic[];
  }

  /** Canonicalization adapter accepted by `planOutputs`. */
  export interface OutputPlannerHost {
    canonicalize(path: string): string;
  }

  /** Optional planner context for symlink and cross-entry collision checks. */
  export interface OutputPlannerContext {
    readonly host?: OutputPlannerHost;
    readonly occupiedTargets?: readonly string[];
  }

  /** Tolerantly parse one source string. */
  export function parse(source: string, options: { readonly file: string }): ParseResult;

  /** Compile one source string without writing files. */
  export function compile(source: string, options: CompileOptions): Promise<CompileResult>;

  /** Compile several entries with one shared module graph. */
  export function compileProject(
    entries: string[],
    host: ModuleHost,
    options: CompileProjectOptions,
  ): Promise<Record<string, CompileResult>>;

  /** Validate and return the complete output plan without writing. */
  export function planOutputs(
    input: PlanOutputsInput,
    context?: OutputPlannerContext,
  ): PlanOutputsResult;

  /** Default Node/Bun filesystem host. */
  export function createNodeHost(root?: string): ModuleHost;
}
