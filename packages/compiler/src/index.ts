/**
 * `@xessa/compiler` public entry point.
 *
 * The frozen contracts of task A02 live in `./types/*`. `parse`, `compile`,
 * `compileProject` and `planOutputs` are wired here; the compiler core remains
 * pure and filesystem-free through an injected {@link ModuleHost}. `compile` is
 * the batteries-included single-source entry point and uses the default Node
 * host from `./host/node.js`.
 */

import { emitCss } from "./emitter/index.js";
import { createNodeHost } from "./host/node.js";
import { stylesheetIr } from "./ir/factories.js";
import type { StylesheetIr } from "./ir/types.js";
import { tokenize } from "./lexer/index.js";
import type { TokenizeResult } from "./lexer/index.js";
import { expandGroupUseSites, groupRuns, lower } from "./lowering/index.js";
import { generateClassMap, mergeClassTables, renameClasses } from "./naming/index.js";
import type { ClassMapOptions, ClassTableSource } from "./naming/index.js";
import { stylesheetImportSpecifier } from "./output/import-path.js";
import { planOutputs } from "./output/index.js";
import type { OutputPlannerContext, OutputPlannerHost } from "./output/index.js";
import {
  basenamePath,
  dirnamePath,
  isAbsolutePath,
  joinPath,
  normalizePath,
  relativePath,
} from "./output/paths.js";
import { defaultSetupFor } from "./output/resolve.js";
import { parseTokens } from "./parser/index.js";
import { buildModuleGraph, styleModuleOrder } from "./resolver/index.js";
import type { GroupResolution, ModuleGraph } from "./resolver/index.js";
import { flattenIr } from "./selectors/index.js";
import { decodeSetupList, decodeSetupScalar } from "./setup-list.js";
import type { Setting, Stylesheet } from "./types/ast.js";
import type { Diagnostic } from "./types/diagnostics.js";
import { error } from "./types/diagnostics.js";
import type {
  CompileOptions,
  CompileProjectOptions,
  MediaGroupingMode,
  ModuleHost,
  OutputOptions,
  ParseOptions,
  ProjectConfig,
  ResolvedSetup,
} from "./types/options.js";
import type { ClassMap, CompileResult, ParseResult, PlanOutputsInput } from "./types/result.js";
import { emitRuntimeTokens, substitute } from "./variables/index.js";

export type {
  AliasDeclaration,
  BlockItem,
  ConditionalBlock,
  ConditionalBlockItem,
  Declaration,
  GroupDefinition,
  GroupUseSite,
  MediaTypesBlock,
  Modifier,
  NativeAtRule,
  Rule,
  RuntimeBlock,
  Setting,
  SetupBlock,
  Stylesheet,
  StylesheetItem,
  TokenDeclaration,
  UseImport,
  Variant,
  VariablesBlock,
} from "./types/ast.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticCodeInfo,
  DiagnosticFamily,
  DiagnosticSeverity,
  ReservedDiagnosticCode,
} from "./types/diagnostics.js";
export { DIAGNOSTIC_CODES, error, warning } from "./types/diagnostics.js";
export type {
  CliOutputOverrides,
  CompileOptions,
  CompileProjectOptions,
  CompilerConfig,
  MediaGroupingMode,
  ModuleHost,
  NamingOptions,
  NamingStrategy,
  OutputOptions,
  ParseOptions,
  ProjectConfig,
  ResolvedSetup,
} from "./types/options.js";
export type {
  ClassMap,
  CompileResult,
  ManifestEntry,
  OutputKind,
  OutputPlan,
  ParseResult,
  PlanOutputs,
  PlanOutputsInput,
  PlanOutputsResult,
  PlannedOutput,
} from "./types/result.js";
export type { Span } from "./types/span.js";
export type { Token, TokenKind } from "./types/token.js";

/** Tokenize Xessa source into a lossless token stream plus lexical diagnostics. */
export { tokenize };
/** Result of {@link tokenize}: tokens in source order plus lexical diagnostics. */
export type { TokenizeResult };
/** Default Node/Bun filesystem host used by {@link compile}. */
export { createNodeHost };
/** Optional host and cross-entry target context accepted by {@link planOutputs}. */
export type { OutputPlannerContext, OutputPlannerHost };
/** Validate and return a complete output plan without writing. */
export { planOutputs };
/** Decode a comma-separated `@setup` value list and its per-item diagnostics. */
export { decodeSetupList, decodeSetupScalar } from "./setup-list.js";
/** One decoded list item and the decoder result (ADR-0019). */
export type { SetupListEntry, SetupListResult } from "./setup-list.js";
/** Canonical source formatting (pure parse→print; errors return the input). */
export { format } from "./formatter/index.js";
/** Result of {@link format}: canonical text plus parse diagnostics. */
export type { FormatResult } from "./formatter/index.js";

/** Every `@setup` key understood by `compile` and `compileProject`. */
const SETUP_KEYS: ReadonlySet<string> = new Set([
  "prefix",
  "css-dir",
  "css-name",
  "map-dir",
  "map-name",
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "module",
  "map-inherit",
  "import-css",
  "media-grouping",
]);

const BOOLEAN_SETUP_KEYS: ReadonlySet<string> = new Set([
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "map-inherit",
  "import-css",
]);

interface DecodedSetup {
  /** Authored file-level values; missing keys mean "not authored". */
  readonly values: Partial<MutableSetup>;
  /**
   * `module: true` marker (ADR-0014): this file is a rule-bearing module, so
   * its own build suppresses CSS, map and type artifacts unless the file authors
   * those keys explicitly.
   */
  readonly moduleOnly: boolean;
  /** File-level `media-grouping` override (ADR-0024), when authored validly. */
  readonly mediaGrouping?: MediaGroupingMode;
  /** XESSA1001 diagnostics for unknown keys, duplicates and invalid values. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Mutable view used while merging defaults, project config, file setup and API. */
type MutableSetup = { -readonly [Key in keyof ResolvedSetup]: ResolvedSetup[Key] };

/**
 * Tolerantly parse Xessa source into an immutable AST plus diagnostics,
 * recovering at safe statement boundaries for editor use.
 *
 * Pipeline: {@link tokenize} then the A04 `parseTokens` stage. Diagnostics are
 * merged in a stable order — **lexical diagnostics first** (emitted while
 * tokenizing), then syntactic diagnostics — because both use the XESSA1xxx
 * family and each stage already reports in source order. Neither stage throws,
 * so a partial `Stylesheet` is always returned.
 */
export function parse(source: string, options: ParseOptions): ParseResult {
  const lexed = tokenize(source, options.file);
  const parsed = parseTokens(lexed.tokens, options.file);
  return Object.freeze({
    ast: parsed.ast,
    diagnostics: Object.freeze([...lexed.diagnostics, ...parsed.diagnostics]),
  });
}

/**
 * Compile one Xessa source string to CSS, JS class map, declarations and/or a
 * source map, returning artifacts and diagnostics without writing files.
 *
 * The pipeline is `parse` → optional module graph → (`expandGroupUseSites` →
 * `lower` → `substitute` → `renameClasses` per style-imported module) →
 * `expandGroupUseSites` → `lower` → `substitute` → `renameClasses` for the
 * entry → `mergeClassTables` → `emitRuntimeTokens` → `groupRuns` → `flattenIr`
 * → `emitCss` → `planOutputs` → `generateClassMap`.
 * Rule-bearing `styles` imports (ADR-0014) contribute their rules first, in
 * depth-first `@use` order, each renamed with the module's own `@setup` prefix;
 * the importing build then has one merged class map and declaration file. A
 * module that authors `@setup { map-inherit: false; }` (ADR-0020) still merges
 * its rules but keeps its bindings out of the importer's map and declarations.
 * A file that authors `@setup { import-css: true; }` (ADR-0021) gets one
 * side-effect import of its planned stylesheet at the top of the JS map; without
 * it (the default) the map stays import-free for plain Node.
 * File `@setup` values are decoded here, then explicit `CompileOptions` output
 * fields override them (API/CLI precedence). Prefix precedence is
 * `options.prefix` → `options.naming.prefix` → file `@setup prefix` → `""`;
 * strategy `none` disables prefixing. `@setup { module: true }` suppresses this
 * file's own CSS, map, types and CSS import unless those keys are authored.
 *
 * `options.workspaceRoot` is the containment root and the Node host's root. It
 * defaults to `process.cwd()` at call time inside {@link createNodeHost}. When
 * the source has no `@use`, a memory-only single-file graph is built so runtime
 * token and variable passes still see the entry; no filesystem is read for the
 * source itself.
 */
export async function compile(source: string, options: CompileOptions): Promise<CompileResult> {
  const parsed = parse(source, { file: options.file });
  const nodeHost = createNodeHost(options.workspaceRoot);
  const workspaceRoot = normalizePath(nodeHost.workspaceRoot());
  const entryAbsolute = normalizePath(
    isAbsolutePath(options.file) ? options.file : joinPath(workspaceRoot, options.file),
  );
  const canonicalEntry = normalizePath(nodeHost.canonicalize(entryAbsolute));
  const decoded = decodeSetup(parsed.ast);
  const hasUse = parsed.ast.items.some((item) => item.kind === "use");

  let graph: ModuleGraph;
  let ast = parsed.ast;
  let entryKey = canonicalEntry;
  let baseDiagnostics: readonly Diagnostic[];
  let sourceTexts: ReadonlyMap<string, string>;

  if (hasUse) {
    const recorded = createRecordingHost(withEntrySource(nodeHost, entryAbsolute, source));
    sourceTexts = recorded.sources;
    graph = await buildModuleGraph([entryAbsolute], recorded.host, options);
    const record = graph.modules.get(canonicalEntry);
    if (record !== undefined) ast = record.ast;
    baseDiagnostics =
      record === undefined
        ? [...parsed.diagnostics, ...graph.diagnostics]
        : diagnosticsForEntry(graph, canonicalEntry);
  } else {
    const recorded = createRecordingHost(createMemoryHost(source, entryAbsolute, workspaceRoot));
    sourceTexts = recorded.sources;
    graph = await buildModuleGraph([entryAbsolute], recorded.host, options);
    entryKey = entryAbsolute;
    const record = graph.modules.get(entryKey);
    if (record !== undefined) ast = record.ast;
    baseDiagnostics = singleFileDiagnostics(
      parsed.diagnostics,
      diagnosticsForEntry(graph, entryKey),
    );
  }

  const setup = buildCompileSetup(options.file, options, decoded);
  const sourceFile = sourcePathFor(entryAbsolute, workspaceRoot, options.file);
  const passOptions: CompileOptions = { ...options, file: sourceFile };

  return compileEntry({
    ast,
    entryKey,
    sourceFile,
    graph,
    setup,
    prefix: setup.prefix,
    options: passOptions,
    mediaGrouping: decoded.mediaGrouping ?? options.mediaGrouping ?? "safe",
    workspaceRoot,
    host: nodeHost,
    sourceTexts,
    baseDiagnostics,
    setupDiagnostics: decoded.diagnostics,
    ...(options.mapInherit === undefined ? {} : { moduleMapInherit: options.mapInherit }),
  });
}

/**
 * Resolve modules for several entries through an injected host and compile each
 * entry with one shared module graph.
 *
 * Project-level `options.output` and `options.naming` form the project layer;
 * file `@setup` values override them. `options.configFile`/`projectRoot` are
 * reserved for the P5 project loader and are not read here. The returned record
 * is keyed by the entry strings exactly as supplied.
 */
export async function compileProject(
  entries: string[],
  host: ModuleHost,
  options: CompileProjectOptions,
): Promise<Record<string, CompileResult>> {
  const workspaceRoot = normalizePath(options.projectRoot ?? host.workspaceRoot());
  const projectHost: ModuleHost =
    options.projectRoot === undefined
      ? host
      : {
          readFile: (path) => host.readFile(path),
          fileExists: (path) => host.fileExists(path),
          canonicalize: (path) => host.canonicalize(path),
          resolvePath: (from, to) => host.resolvePath(from, to),
          workspaceRoot: () => workspaceRoot,
        };
  const absoluteEntries = entries.map((entry) =>
    normalizePath(isAbsolutePath(entry) ? entry : joinPath(workspaceRoot, entry)),
  );
  const graphOptions: CompileOptions = {
    file: absoluteEntries[0] ?? "",
    ...(options.media === undefined ? {} : { media: options.media }),
  };
  const recorded = createRecordingHost(projectHost);
  const graph = await buildModuleGraph(absoluteEntries, recorded.host, graphOptions);
  const projectConfig = projectDirectoryConfig(options.output);
  const results: Record<string, CompileResult> = {};

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const absolute = absoluteEntries[index] ?? entry;
    const canonical = normalizePath(projectHost.canonicalize(absolute));
    const record = graph.modules.get(canonical);
    const sourceFile = sourcePathFor(absolute, workspaceRoot, entry);

    if (record === undefined) {
      results[entry] = emptyCompileResult(
        graph.diagnostics.filter((diagnostic) => normalizePath(diagnostic.span.file) === canonical),
      );
      continue;
    }

    const decoded = decodeSetup(record.ast);
    const setup = buildProjectSetup(sourceFile, options, decoded);
    const passOptions: CompileOptions = { ...options, file: sourceFile };
    results[entry] = compileEntry({
      ast: record.ast,
      entryKey: canonical,
      sourceFile,
      graph,
      setup,
      ...(projectConfig === undefined ? {} : { projectConfig }),
      prefix: setup.prefix,
      options: passOptions,
      mediaGrouping: decoded.mediaGrouping ?? options.mediaGrouping ?? "safe",
      workspaceRoot,
      host: projectHost,
      sourceTexts: recorded.sources,
      baseDiagnostics: diagnosticsForEntry(graph, canonical),
      setupDiagnostics: decoded.diagnostics,
      ...(options.output?.mapInherit === undefined
        ? {}
        : { moduleMapInherit: options.output.mapInherit }),
    });
  }

  return results;
}

interface CompileEntryInput {
  readonly ast: Stylesheet;
  /** Canonical graph key for the entry module. */
  readonly entryKey: string;
  /** Workspace-relative POSIX source path used in diagnostics and plans. */
  readonly sourceFile: string;
  readonly graph: ModuleGraph;
  readonly setup: ResolvedSetup;
  /** Project-level config used only for output-directory provenance. */
  readonly projectConfig?: ProjectConfig;
  /** Effective class/runtime prefix after API and file precedence. */
  readonly prefix: string;
  /** Effective media grouping mode: file `@setup` > project/API > `safe` (ADR-0024). */
  readonly mediaGrouping: MediaGroupingMode;
  readonly options: CompileOptions;
  readonly workspaceRoot: string;
  readonly host: ModuleHost;
  /** Authored source text keyed by normalized module path, for source maps. */
  readonly sourceTexts: ReadonlyMap<string, string>;
  readonly baseDiagnostics: readonly Diagnostic[];
  /**
   * Base map-inheritance value for style-merged modules (ADR-0020). Comes from
   * the API/project output layer; each module's own `@setup map-inherit` wins.
   * Omitted means `true`, preserving ADR-0014 output byte-for-byte.
   */
  readonly moduleMapInherit?: boolean;
  readonly setupDiagnostics: readonly Diagnostic[];
}

/** No visible groups: used when the entry module record is unavailable. */
const NO_GROUPS: ReadonlyMap<string, GroupResolution> = new Map();

/** Run every pure pass for one already-loaded entry and return frozen artifacts. */
function compileEntry(input: CompileEntryInput): CompileResult {
  const styleModules = styleModuleOrder(input.graph, input.entryKey);
  const moduleDiagnostics: Diagnostic[] = [];
  const moduleIr: StylesheetIr[] = [];
  const tables: ClassTableSource[] = [];

  // Rule-merge imports (ADR-0014): each module is expanded, lowered,
  // substituted and renamed on its own, with its own setup prefix. Imported
  // modules come first in the IR (depth-first in authored `@use` order), then
  // the entry's rules.
  for (const file of styleModules) {
    const record = input.graph.modules.get(file);
    if (record === undefined) continue;
    const decoded = decodeSetup(record.ast);
    const prefix = modulePrefix(input.options, decoded);
    const expanded = expandGroupUseSites(record.ast, { module: file, groups: record.groups });
    const lowered = lower(expanded.ast, input.options);
    const substituted = substitute(lowered.ir, input.graph, file, { prefix: input.prefix });
    const renamed = renameClasses(substituted.ir, { prefix });
    moduleDiagnostics.push(
      ...decoded.diagnostics,
      ...expanded.diagnostics,
      ...lowered.diagnostics,
      ...substituted.diagnostics,
      ...renamed.diagnostics,
    );
    moduleIr.push(renamed.ir);
    tables.push({
      table: renamed.classes,
      label: sourcePathFor(file, input.workspaceRoot, file),
      mapInherit: decoded.values.mapInherit ?? input.moduleMapInherit ?? true,
    });
  }

  const entryGroups = input.graph.modules.get(input.entryKey)?.groups ?? NO_GROUPS;
  const expandedEntry = expandGroupUseSites(input.ast, {
    module: input.entryKey,
    groups: entryGroups,
  });
  const lowered = lower(expandedEntry.ast, input.options);
  const substituted = substitute(lowered.ir, input.graph, input.entryKey, {
    prefix: input.prefix,
  });
  const renamed = renameClasses(substituted.ir, { prefix: input.prefix });
  tables.push({ table: renamed.classes, label: input.sourceFile });

  const merged = mergeClassTables(tables);
  const combinedIr = stylesheetIr([...moduleIr.flatMap((ir) => ir.rules), ...renamed.ir.rules]);
  const runtime = emitRuntimeTokens(combinedIr, input.graph, input.entryKey, {
    prefix: input.prefix,
    ...(input.options.media === undefined ? {} : { media: input.options.media }),
    ...(styleModules.length === 0 ? {} : { ruleModules: styleModules }),
  });
  const grouped = groupRuns(runtime.ir, input.mediaGrouping);
  const flattened = flattenIr(grouped);

  const planInput: PlanOutputsInput = {
    sourceFile: input.sourceFile,
    setup: input.setup,
    workspaceRoot: input.workspaceRoot,
    ...(input.projectConfig === undefined ? {} : { projectConfig: input.projectConfig }),
  };
  const plan = planOutputs(planInput, {
    host: { canonicalize: (path) => input.host.canonicalize(path) },
  });
  const cssOutput = plan.plan.outputs.find((output) => output.kind === "css");
  const emitted = emitCss(flattened.ir, {
    minify: input.setup.minify,
    ...(input.setup.sourceMap && cssOutput !== undefined
      ? {
          sourceMap: {
            // The comment and `file` field must name the planned CSS basename.
            file: basenamePath(cssOutput.workspacePath),
            sourceText: (file) => input.sourceTexts.get(normalizePath(file)),
            sourcePath: (file) => mapSourcePath(file, input.workspaceRoot, input.host),
            includeSourcesContent: true,
          },
        }
      : {}),
  });

  const map =
    input.setup.emitMap === true ? generateClassMap(merged.table, classMapOptions()) : undefined;

  /** Opt-in CSS side-effect import for the class map (ADR-0021). */
  function classMapOptions(): ClassMapOptions {
    if (input.setup.importCss !== true) return {};
    const jsOutput = plan.plan.outputs.find((output) => output.kind === "js");
    // Authored destinations keep their order, so the first `css` plan entry is
    // the canonical artifact for a `css-dir` list (ADR-0019, ADR-0021).
    const cssOutput = plan.plan.outputs.find((output) => output.kind === "css");
    if (jsOutput === undefined || cssOutput === undefined) return {};
    return {
      cssImport: stylesheetImportSpecifier(jsOutput.absolutePath, cssOutput.absolutePath),
    };
  }

  const diagnostics = mergeDiagnostics(
    input.setupDiagnostics,
    input.baseDiagnostics,
    moduleDiagnostics,
    expandedEntry.diagnostics,
    lowered.diagnostics,
    substituted.diagnostics,
    runtime.diagnostics,
    renamed.diagnostics,
    merged.diagnostics,
    flattened.diagnostics,
    emitted.diagnostics,
    map === undefined ? [] : map.diagnostics,
    plan.diagnostics,
  );

  return Object.freeze({
    ...(input.setup.emitCss ? { css: emitted.css } : {}),
    ...(emitted.map === undefined ? {} : { sourceMap: emitted.map }),
    ...(map === undefined ? {} : { js: map.js }),
    ...(map === undefined || !input.setup.emitTypes ? {} : { types: map.types }),
    classes: classMapOf(merged.table.entries),
    diagnostics: Object.freeze(diagnostics),
    dependencies: Object.freeze(
      dependenciesForEntry(input.graph, input.entryKey, input.workspaceRoot),
    ),
  });
}

/** Decode every `@setup` block in document order, rejecting unknown/duplicate keys. */
function decodeSetup(ast: Stylesheet): DecodedSetup {
  const values: Partial<MutableSetup> = {};
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let moduleOnly = false;
  let mediaGrouping: MediaGroupingMode | undefined;
  // `map-types` is the canonical declaration flag; `emit-types` is its legacy
  // alias. Resolve them together so the canonical key wins regardless of order.
  let mapTypes: boolean | undefined;
  let emitTypes: boolean | undefined;

  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      if (!SETUP_KEYS.has(setting.key)) {
        diagnostics.push(
          error("XESSA1001", `Unknown @setup setting "${setting.key}".`, setting.span),
        );
        continue;
      }
      if (seen.has(setting.key)) {
        diagnostics.push(
          error("XESSA1001", `Duplicate @setup setting "${setting.key}".`, setting.span),
        );
        continue;
      }
      seen.add(setting.key);
      // `module` is a marker, not a resolved output setting: it only removes
      // defaults for this file's own build (ADR-0014).
      if (setting.key === "module") {
        const moduleValue = decodeBoolean(setting);
        if (moduleValue === undefined) {
          diagnostics.push(
            error(
              "XESSA1001",
              `@setup setting "module" expects true or false, not ${setting.value.trim()}.`,
              setting.span,
            ),
          );
          continue;
        }
        moduleOnly = moduleValue;
        continue;
      }
      if (setting.key === "media-grouping") {
        const value = decodeSetupScalar(setting.value);
        if (value === "merge" || value === "safe" || value === "none") {
          mediaGrouping = value;
        } else {
          diagnostics.push(
            error(
              "XESSA1001",
              `@setup setting "media-grouping" expects "merge", "safe" or "none", not ${setting.value.trim()}.`,
              setting.valueSpan,
            ),
          );
        }
        continue;
      }
      if (BOOLEAN_SETUP_KEYS.has(setting.key)) {
        const value = decodeBoolean(setting);
        if (value === undefined) {
          diagnostics.push(
            error(
              "XESSA1001",
              `@setup setting "${setting.key}" expects true or false, not ${setting.value.trim()}.`,
              setting.span,
            ),
          );
          continue;
        }
        if (setting.key === "map-types") {
          mapTypes = value;
          continue;
        }
        if (setting.key === "emit-types") {
          emitTypes = value;
          continue;
        }
        assignBooleanSetting(values, setting.key, value);
      } else if (setting.key === "css-dir") {
        const decoded = decodeSetupList(setting.value, setting.valueSpan);
        diagnostics.push(...decoded.diagnostics);
        if (decoded.diagnostics.length > 0) continue;
        const first = decoded.entries[0];
        if (first === undefined) continue;
        values.cssDir = first.value;
        if (decoded.entries.length > 1) {
          values.cssDirs = decoded.entries.map((entry) => entry.value);
        }
      } else {
        assignStringSetting(values, setting.key, decodeSetupScalar(setting.value));
      }
    }
  }

  const types = mapTypes ?? emitTypes;
  if (types !== undefined) values.emitTypes = types;

  return {
    values,
    moduleOnly,
    ...(mediaGrouping === undefined ? {} : { mediaGrouping }),
    diagnostics,
  };
}

function decodeBoolean(setting: Setting): boolean | undefined {
  const raw = setting.value.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function assignStringSetting(target: Partial<MutableSetup>, key: string, value: string): void {
  switch (key) {
    case "prefix":
      target.prefix = value;
      break;
    case "css-name":
      target.cssName = value;
      break;
    case "map-dir":
      target.mapDir = value;
      break;
    case "map-name":
      target.mapName = value;
      break;
    default:
      break;
  }
}

function assignBooleanSetting(target: Partial<MutableSetup>, key: string, value: boolean): void {
  switch (key) {
    case "emit-css":
      target.emitCss = value;
      break;
    case "emit-map":
      target.emitMap = value;
      break;
    case "map-types":
    case "emit-types":
      target.emitTypes = value;
      break;
    case "source-map":
      target.sourceMap = value;
      break;
    case "minify":
      target.minify = value;
      break;
    case "map-inherit":
      target.mapInherit = value;
      break;
    case "import-css":
      target.importCss = value;
      break;
    default:
      break;
  }
}

function definedOutput(options: OutputOptions | undefined): Partial<MutableSetup> {
  if (options === undefined) return {};
  const values: Partial<MutableSetup> = {};
  if (options.cssDir !== undefined) values.cssDir = options.cssDir;
  if (options.cssName !== undefined) values.cssName = options.cssName;
  if (options.mapDir !== undefined) values.mapDir = options.mapDir;
  if (options.mapName !== undefined) values.mapName = options.mapName;
  if (options.emitCss !== undefined) values.emitCss = options.emitCss;
  if (options.emitMap !== undefined) values.emitMap = options.emitMap;
  const types = options.mapTypes ?? options.emitTypes;
  if (types !== undefined) values.emitTypes = types;
  if (options.sourceMap !== undefined) values.sourceMap = options.sourceMap;
  if (options.minify !== undefined) values.minify = options.minify;
  if (options.mapInherit !== undefined) values.mapInherit = options.mapInherit;
  if (options.importCss !== undefined) values.importCss = options.importCss;
  return values;
}

function buildCompileSetup(
  file: string,
  options: CompileOptions,
  decoded: DecodedSetup,
): ResolvedSetup {
  const defaults = defaultSetupFor(file);
  const merged: MutableSetup = {
    ...defaults,
    ...moduleSuppression(decoded.moduleOnly),
    ...decoded.values,
    ...definedOutput(options),
    prefix: "",
  };
  // An explicit API/CLI `cssDir` is a single destination and replaces a file
  // list (ADR-0019); only the file layer can author a list.
  if (options.cssDir !== undefined) merged.cssDirs = undefined;
  return {
    ...merged,
    prefix: resolveCompilePrefix(options, decoded),
  };
}

function buildProjectSetup(
  file: string,
  options: CompileProjectOptions,
  decoded: DecodedSetup,
): ResolvedSetup {
  const defaults = defaultSetupFor(file);
  const merged: MutableSetup = {
    ...defaults,
    ...definedOutput(options.output),
    ...moduleSuppression(decoded.moduleOnly),
    ...decoded.values,
    prefix: "",
  };
  if (options.output?.cssDir !== undefined) merged.cssDirs = undefined;
  return {
    ...merged,
    prefix: resolveProjectPrefix(options, decoded),
  };
}

/**
 * Output defaults removed by `@setup { module: true }` (ADR-0014).
 *
 * A module-only file writes no artifacts of its own, so CSS, map and types are
 * suppressed. The suppression sits above built-in defaults and project
 * configuration but below the file's own explicit `emit-*` keys and explicit
 * API/CLI overrides, so authoring a key restores it.
 */
function moduleSuppression(moduleOnly: boolean): Partial<MutableSetup> {
  if (!moduleOnly) return {};
  return { emitCss: false, emitMap: false, emitTypes: false };
}

function resolveCompilePrefix(options: CompileOptions, decoded: DecodedSetup): string {
  if ((options.naming?.strategy ?? "prefix") === "none") return "";
  return options.prefix ?? options.naming?.prefix ?? decoded.values.prefix ?? "";
}

function resolveProjectPrefix(options: CompileProjectOptions, decoded: DecodedSetup): string {
  if ((options.naming?.strategy ?? "prefix") === "none") return "";
  return decoded.values.prefix ?? options.naming?.prefix ?? "";
}

/**
 * Effective class prefix of a style-imported module (ADR-0014).
 *
 * Only the module's own `@setup prefix` applies: the importing file's prefix,
 * the API `prefix` and the project `classes.prefix` never reach merged rules. A
 * module without `@setup` therefore merges unprefixed. `naming.strategy: "none"`
 * still disables prefixing for the whole build.
 */
function modulePrefix(options: CompileOptions, decoded: DecodedSetup): string {
  if ((options.naming?.strategy ?? "prefix") === "none") return "";
  return decoded.values.prefix ?? "";
}

/** Build the null-prototype class map required by the frozen `ClassMap` type. */
function classMapOf(
  entries: readonly { readonly name: string; readonly emitted: string; readonly global: boolean }[],
): ClassMap {
  const map = Object.create(null) as Record<string, string>;
  for (const entry of entries) {
    if (!entry.global) map[entry.name] = entry.emitted;
  }
  return Object.freeze(map) as ClassMap;
}

/** Workspace-relative POSIX dependencies of one entry, excluding the entry itself. */
function dependenciesForEntry(
  graph: ModuleGraph,
  entryKey: string,
  workspaceRoot: string,
): string[] {
  const reachable = new Set<string>();
  const queue = [entryKey];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    const record = graph.modules.get(file);
    if (record === undefined) continue;
    for (const dependency of record.dependencies) queue.push(dependency);
  }
  reachable.delete(entryKey);

  const relative = [...reachable].map((file) => relativePath(workspaceRoot, file));
  return relative
    .filter((path) => !isAbsolutePath(path) && path !== ".." && !path.startsWith("../"))
    .sort();
}

/**
 * Caller-facing diagnostics for a source compiled without `@use`.
 *
 * The memory graph reparses the same source, so its syntax (`XESSA1xxx`)
 * diagnostics duplicate `parsed.diagnostics`; the caller's parse keeps the
 * authored file label and stays authoritative. Resolver diagnostics
 * (`XESSA2xxx`+) exist only in the graph and must survive, so a duplicate
 * `@variables` key reports one `XESSA2001` with the resolver's message and span
 * just as the module-graph path does (CSSX-U04).
 */
function singleFileDiagnostics(
  parsed: readonly Diagnostic[],
  graphDiagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const resolverDiagnostics = graphDiagnostics.filter(
    (diagnostic) => !diagnostic.code.startsWith("XESSA1"),
  );
  return mergeDiagnostics(parsed, resolverDiagnostics);
}

/** Graph diagnostics whose file belongs to the entry's reachable module set. */
function diagnosticsForEntry(graph: ModuleGraph, entryKey: string): readonly Diagnostic[] {
  const reachable = new Set<string>();
  const queue = [entryKey];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    const record = graph.modules.get(file);
    if (record === undefined) continue;
    for (const dependency of record.dependencies) queue.push(dependency);
  }
  return graph.diagnostics.filter((diagnostic) =>
    reachable.has(normalizePath(diagnostic.span.file)),
  );
}

function projectDirectoryConfig(output: OutputOptions | undefined): ProjectConfig | undefined {
  if (output === undefined) return undefined;
  const directories: OutputOptions = {
    ...(output.cssDir === undefined ? {} : { cssDir: output.cssDir }),
    ...(output.mapDir === undefined ? {} : { mapDir: output.mapDir }),
  };
  if (directories.cssDir === undefined && directories.mapDir === undefined) return undefined;
  return { output: directories };
}

function emptyCompileResult(diagnostics: readonly Diagnostic[] = []): CompileResult {
  const classes = Object.freeze(Object.create(null)) as ClassMap;
  return Object.freeze({
    classes,
    diagnostics: Object.freeze([...diagnostics]),
    dependencies: Object.freeze([]),
  });
}

/** Resolve an authored source path to a workspace-relative POSIX path when possible. */
function sourcePathFor(absolute: string, workspaceRoot: string, authored: string): string {
  const relative = relativePath(workspaceRoot, absolute);
  if (
    relative === "." ||
    isAbsolutePath(relative) ||
    relative === ".." ||
    relative.startsWith("../")
  ) {
    return normalizePath(authored);
  }
  return relative;
}

/** Project a span file path into the workspace-relative POSIX form maps require. */
function mapSourcePath(file: string, workspaceRoot: string, host: ModuleHost): string {
  const roots = new Set<string>([workspaceRoot]);
  try {
    roots.add(normalizePath(host.canonicalize(workspaceRoot)));
  } catch {
    // A host that cannot canonicalize the root keeps the lexical form only.
  }
  for (const root of roots) {
    const relative = relativePath(root, file);
    if (
      relative !== "." &&
      !isAbsolutePath(relative) &&
      relative !== ".." &&
      !relative.startsWith("../")
    ) {
      return relative;
    }
  }
  return normalizePath(file);
}

/**
 * Wrap a host so every authored source read by the module graph is retained for
 * source-map generation.
 *
 * `ModuleRecord` intentionally stores no source text (A07 contract), so the
 * index pipeline records it here without changing frozen or resolver types.
 * Keys are normalized module paths, exactly the paths that end up in IR spans.
 */
function createRecordingHost(host: ModuleHost): {
  readonly host: ModuleHost;
  readonly sources: ReadonlyMap<string, string>;
} {
  const sources = new Map<string, string>();
  return {
    sources,
    host: {
      async readFile(path: string): Promise<string> {
        const source = await host.readFile(path);
        sources.set(normalizePath(path), source);
        return source;
      },
      fileExists: (path) => host.fileExists(path),
      canonicalize: (path) => host.canonicalize(path),
      resolvePath: (from, to) => host.resolvePath(from, to),
      workspaceRoot: () => host.workspaceRoot(),
    },
  };
}

/**
 * Memory host for a source with no `@use`: it makes the parsed entry available
 * to the graph passes without reading the filesystem.
 */
function createMemoryHost(source: string, entry: string, workspaceRoot: string): ModuleHost {
  const normalizedEntry = normalizePath(entry);
  const same = (path: string): boolean => normalizePath(path) === normalizedEntry;
  return {
    async readFile(path: string): Promise<string> {
      if (same(path)) return source;
      throw new Error(`ENOENT: ${path}`);
    },
    async fileExists(path: string): Promise<boolean> {
      return same(path);
    },
    canonicalize(path: string): string {
      return normalizePath(path);
    },
    resolvePath(from: string, to: string): string {
      return isAbsolutePath(to) ? normalizePath(to) : joinPath(dirnamePath(from), to);
    },
    workspaceRoot(): string {
      return workspaceRoot;
    },
  };
}

/**
 * Wrap the default host so the in-memory source overrides the entry file while
 * imports still resolve through the real Node host.
 */
function withEntrySource(host: ModuleHost, entry: string, source: string): ModuleHost {
  const normalizedEntry = normalizePath(entry);
  const canonicalEntry = normalizePath(host.canonicalize(normalizedEntry));
  const same = (path: string): boolean => {
    const normalized = normalizePath(path);
    return normalized === normalizedEntry || normalized === canonicalEntry;
  };
  return {
    async readFile(path: string): Promise<string> {
      if (same(path)) return source;
      return host.readFile(path);
    },
    async fileExists(path: string): Promise<boolean> {
      if (same(path)) return true;
      return host.fileExists(path);
    },
    canonicalize(path: string): string {
      if (same(path)) return canonicalEntry;
      return host.canonicalize(path);
    },
    resolvePath(from: string, to: string): string {
      return host.resolvePath(from, to);
    },
    workspaceRoot(): string {
      return host.workspaceRoot();
    },
  };
}

function mergeDiagnostics(...groups: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  const merged: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const diagnostic of group) {
      const key = [
        diagnostic.code,
        diagnostic.severity,
        diagnostic.span.file,
        diagnostic.span.start,
        diagnostic.span.end,
        diagnostic.message,
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(diagnostic);
    }
  }
  return merged;
}
