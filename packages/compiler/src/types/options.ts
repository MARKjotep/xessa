/**
 * Options and host contracts for parsing, compiling and planning outputs.
 *
 * All paths crossing this API are workspace-relative or absolute POSIX paths
 * with forward slashes; hosts convert platform separators once at their
 * boundary. The compiler core never reads the filesystem: project operations
 * go through an injected {@link ModuleHost}, and single-source operations are
 * pure functions.
 */

/** Options for `parse`. */
export interface ParseOptions {
  /**
   * Workspace-relative POSIX path recorded as `Span.file` on every node and
   * diagnostic produced for this source. The source text itself is supplied
   * directly to `parse` and is never read from disk.
   */
  readonly file: string;
}

/** Class naming strategies available in v0.1 (ADR-0010). */
export type NamingStrategy = "none" | "prefix";

/** Class naming configuration. */
export interface NamingOptions {
  /** `none` keeps authored class names; `prefix` prepends the effective prefix. */
  readonly strategy: NamingStrategy;
  /**
   * Prefix used by the `prefix` strategy, for example `ui` producing `ui-card`.
   * An empty string leaves names unchanged. Omitted means the file-level
   * `prefix` option or setup key applies.
   */
  readonly prefix?: string;
}

/**
 * Media grouping modes accepted by v0.1.
 *
 * `safe` (the public default) merges only adjacent compatible rules and media
 * contexts without changing declaration order, specificity, layer or scope;
 * `none` emits rules as authored and performs no merging. `merge` is an opt-in
 * optimization (ADR-0024): it keeps the safe adjacent pass and additionally
 * moves same-selector/same-condition conditional runs across declarations whose
 * property families are provably disjoint (`all` and `var()` values are
 * barriers). It never merges unconditional runs, different selectors,
 * different conditions or different native contexts. Future modes such as
 * ordered-media grouping remain deliberately absent and must
 * be rejected as invalid configuration values.
 */
export type MediaGroupingMode = "safe" | "none" | "merge";

/**
 * Output settings shared by file-level setup, project configuration and CLI
 * overrides (SPECIFICATION.md §9).
 *
 * Defaults: `cssDir`/`mapDir` = the source directory; `cssName` =
 * `<stem>.css`; `mapName` = `<stem>.map.js`; `emitCss` and `emitMap` = `true`;
 * `mapTypes` = `false`; `sourceMap` = `false`; `minify` = `true`;
 * `importCss` = `false`. `minify` defaults on (ADR-0022) and compacts generated
 * structural whitespace while preserving authored CSS tokens and declaration
 * order; `minify: false` / `--no-minify` opts out.
 * `mapTypes` is opt-in only: the JS class map is the normal artifact and the
 * `.d.ts` beside it is generated only when requested (CSSX-A52). `importCss`
 * is opt-in only: the map carries no CSS import unless a bundler-driven
 * consumer asks for one (ADR-0021).
 */
export interface OutputOptions {
  /**
   * Directory for the CSS artifact. A file-level directory resolves relative
   * to the source file (never the working directory); a project-level
   * directory resolves relative to the workspace root. A file-level directory
   * is exact, without mirrored subfolders.
   */
  readonly cssDir?: string;
  /**
   * Optional CSS basename, for example `button.css`. Basenames only: no
   * separators or traversal, and the `.css` extension is required.
   */
  readonly cssName?: string;
  /** Directory for the JS class map, resolved like {@link OutputOptions.cssDir}. */
  readonly mapDir?: string;
  /**
   * Optional JS map basename, for example `classes.js`. The opt-in declaration
   * file becomes `classes.d.ts`.
   */
  readonly mapName?: string;
  /** Write the stylesheet. Default `true`. */
  readonly emitCss?: boolean;
  /** Write the JS class map. Default `true`. */
  readonly emitMap?: boolean;
  /**
   * Write a `.d.ts` beside the JS map with one literal `export declare const`
   * per class. Default `false` (opt-in, CSSX-A52); automatically suppressed with
   * a documented warning when map emission is on but types were requested
   * without a map (SPECIFICATION.md §8).
   */
  readonly mapTypes?: boolean;
  /**
   * Deprecated alias for {@link OutputOptions.mapTypes}, kept for existing
   * configurations. `map-types` wins when both are authored in one layer.
   */
  readonly emitTypes?: boolean;
  /** Write a CSS debugging source map. Default `false`; never written when CSS is disabled. */
  readonly sourceMap?: boolean;
  /**
   * Compact CSS output. Default `true` (ADR-0022). Compacts generated structural
   * whitespace only and preserves authored CSS tokens, quoted strings, `calc()`
   * spacing and declaration order. Set `false` (or pass `--no-minify`) for
   * readable output.
   */
  readonly minify?: boolean;
  /**
   * Whether a style-merged module's class bindings join the importing build's
   * class map and declarations. Default `true` (the ADR-0014 one-table rule).
   * A module opts out with `@setup { map-inherit: false; }` (ADR-0020): its
   * rules still merge into the importing stylesheet, but its bindings stay out
   * of the importer's `map.js`, `.d.ts` and `CompileResult.classes`. The
   * module's own entry map is never affected.
   */
  readonly mapInherit?: boolean;
  /**
   * Opt-in CSS side-effect import in the generated class map. Default `false`,
   * so the map stays importable by plain Node without a loader (CSSX-A52).
   * With `@setup { import-css: true; }` (ADR-0021) the map starts with one
   * `import "<relative stylesheet>";` naming the emitted CSS artifact, which
   * bundlers that carry CSS through imports (Vite, Rspack, Next-style loaders)
   * then process. Omitted when the build emits no stylesheet; `.d.ts` output
   * never carries the import.
   */
  readonly importCss?: boolean;
}

/** Options for compiling one source string with `compile`. */
export interface CompileOptions extends ParseOptions, OutputOptions {
  /** Effective file-level class prefix; `naming.prefix` wins when both are set. */
  readonly prefix?: string;
  /** Class naming strategy and prefix. Defaults to strategy `prefix` with an empty prefix. */
  readonly naming?: NamingOptions;
  /**
   * Project-level media alias overrides merged after built-in defaults and
   * before file-level `@media-types`, which remain the source-level override
   * layer (ADR-0006).
   */
  readonly media?: Readonly<Record<string, string>>;
  /**
   * Enable strict validation, including rejection of unknown configuration
   * keys. Default `true` (ADR-0023); pass `false` to keep the warning path.
   */
  readonly strict?: boolean;
  /** Media grouping mode. Default `safe`; `merge` is the opt-in optimizer (ADR-0024). */
  readonly mediaGrouping?: MediaGroupingMode;
  /**
   * Absolute POSIX workspace root used for containment checks. When omitted,
   * `compile` stays filesystem-free and resolves paths relative to `file`.
   */
  readonly workspaceRoot?: string;
}

/** Compiler behaviour settings as they appear in `xessa.config.json` (`compiler`). */
export interface CompilerConfig {
  /**
   * Reject unknown configuration keys and other lenient recoveries. Default
   * `true` (ADR-0023); `false` keeps the warning path.
   */
  readonly strict?: boolean;
  /** Media grouping mode. Default `safe`. */
  readonly mediaGrouping?: MediaGroupingMode;
}

/**
 * Declarative project configuration read from `xessa.config.json`
 * (SPECIFICATION.md §10).
 *
 * Keys are camelCase in JSON; source `@setup` keys stay kebab-case. The
 * document schema is frozen in P5, so these structural fields mirror §10
 * without adding validation policy.
 */
export interface ProjectConfig {
  /** Glob patterns for project entries. */
  readonly include?: readonly string[];
  /** Glob patterns excluded from project discovery. */
  readonly exclude?: readonly string[];
  /** Project-level output settings, resolved relative to the workspace root. */
  readonly output?: OutputOptions;
  /** Project-level class naming configuration. */
  readonly classes?: NamingOptions;
  /** Project-level media alias overrides. */
  readonly media?: Readonly<Record<string, string>>;
  /** Compiler behaviour settings. */
  readonly compiler?: CompilerConfig;
}

/** Options for compiling several entries through an injected host. */
export interface CompileProjectOptions {
  /**
   * Absolute POSIX workspace root override. Defaults to the nearest ancestor
   * with `xessa.config.json`, else `package.json`, as reported by the host.
   */
  readonly projectRoot?: string;
  /** Explicit configuration file path, relative to `projectRoot`. */
  readonly configFile?: string;
  /** Project-level output settings overriding the configuration file. */
  readonly output?: OutputOptions;
  /** Project-level naming overriding the configuration file. */
  readonly naming?: NamingOptions;
  /** Project-level media aliases overriding the configuration file. */
  readonly media?: Readonly<Record<string, string>>;
  /** Strict validation override. */
  readonly strict?: boolean;
  /** Media grouping override. */
  readonly mediaGrouping?: MediaGroupingMode;
}

/**
 * Effective output settings after merging built-in defaults, project
 * configuration, file `@setup` and explicit CLI overrides.
 *
 * Every setting has a value, but directory fields are still authored strings:
 * `planOutputs` resolves them against the documented base (source file for
 * file-level settings, workspace root for project-level settings) and
 * validates the result before any write. The authored `mapTypes` alias is not
 * carried here: it resolves into {@link ResolvedSetup.emitTypes}, the single
 * flag the planner reads.
 */
export interface ResolvedSetup
  extends Required<Omit<OutputOptions, "mapTypes" | "mapInherit" | "importCss">> {
  /** Effective class prefix after naming precedence is applied. */
  readonly prefix: string;
  /**
   * Effective module map-inheritance flag (ADR-0020). Defaults to `true` in
   * `defaultSetupFor`; optional so hosts that only consume destination planning
   * can omit it, and the compile pipeline treats an absent value as `true`.
   */
  readonly mapInherit?: boolean;
  /**
   * Effective class-map CSS import flag (ADR-0021). Defaults to `false` in
   * `defaultSetupFor`; optional for the same host-compatibility reason as
   * {@link ResolvedSetup.mapInherit}, and an absent value means `false`.
   */
  readonly importCss?: boolean;
  /**
   * File-level `@setup { css-dir: "a", "b"; }` list ([ADR-0019]).
   *
   * Present only when a file authored more than one CSS destination. Every
   * entry resolves exactly relative to the source file, like the single
   * {@link OutputOptions.cssDir}, and replaces any project/CLI single directory
   * for the CSS artifact. `cssDir` keeps the first entry for consumers that
   * still read the single value. Project configuration and CLI overrides cannot
   * author a list in v0.1.
   */
  readonly cssDirs?: readonly string[];
}

/** Explicit CLI overrides; partial by design and never flatten multiple outputs silently. */
export type CliOutputOverrides = OutputOptions & {
  /** CLI-level class prefix override. */
  readonly prefix?: string;
};

/**
 * Filesystem and policy operations the compiler needs from its embedding
 * environment.
 *
 * Every method is asynchronous where it may hit the disk, and paths are
 * absolute POSIX paths unless stated otherwise. Implementations own caching,
 * case sensitivity and symlink policy; the compiler never imports `fs`.
 */
export interface ModuleHost {
  /** Read a UTF-8 source file. Rejects when the file is missing or unreadable. */
  readFile(path: string): Promise<string>;
  /** Test whether a path exists and is readable as a file. */
  fileExists(path: string): Promise<boolean>;
  /**
   * Return the canonical real path used as module cache key, resolving
   * symlinks and platform case rules.
   */
  canonicalize(path: string): string;
  /**
   * Resolve an import specifier `to` relative to the importing file `from`,
   * returning an absolute POSIX path. Resolution is lexical here; callers use
   * {@link ModuleHost.canonicalize} to detect symlink escapes.
   */
  resolvePath(from: string, to: string): string;
  /** Absolute POSIX path of the workspace root used for containment checks. */
  workspaceRoot(): string;
}
