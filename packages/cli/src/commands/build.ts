/**
 * Build engine shared by `xessa build` and `xessa check`.
 *
 * Entries are planned with the public `planOutputs` API (mirroring the plan the
 * compiler builds internally), compiled together with `compileProject`, and
 * written per-file atomically. Errors keep the last successful outputs and skip
 * every write for the affected entry.
 */

import { readFile } from "node:fs/promises";
import type {
  CompileOptions,
  CompileProjectOptions,
  CompileResult,
  Diagnostic,
  OutputKind,
  PlanOutputsResult,
  ProjectConfig,
  ResolvedSetup,
} from "@xessa/compiler";
import type { CliInvocation } from "../args.js";
import { loadCompiler } from "../compiler.js";
import type { CliConfig } from "../config.js";
import { type ManifestRecord, isArtifactRecord, readManifest, writeManifest } from "../manifest.js";
import { dirnamePosix, joinPosix } from "../paths.js";
import { type ProjectContext, prepareProject } from "../project.js";
import {
  type BuildReport,
  type CliDiagnostic,
  DiagnosticPositions,
  type EntryReport,
  type JsonBuildReport,
  type OutputRecord,
  dedupeDiagnostics,
  formatDiagnostic,
  hasErrors,
  invocationFailure,
  toJson,
  writeErrorLine,
  writeLine,
} from "../report.js";
import { type FileSetupValues, decodeFileSetup, resolveEffectiveSetup } from "../setup.js";
import { atomicWrite, hashFile, removeFile, sweepTemporaries } from "../writer.js";

/** Options for one build/check run. */
export interface ExecuteBuildOptions {
  /** Resolved project inputs. */
  readonly context: ProjectContext;
  /** Write artifacts; `false` makes the run a check. */
  readonly write: boolean;
  /** Plan and compile but do not touch the disk. */
  readonly dryRun: boolean;
  /** Remove obsolete owned outputs after a fully successful project build. */
  readonly prune: boolean;
  /** `--minify` / `--no-minify` override. */
  readonly minify?: boolean;
  /** Returns `false` when a newer build generation superseded this one. */
  readonly isCurrent?: () => boolean;
}

/** Result of {@link executeBuild}. */
export interface ExecuteBuildResult {
  /** Structured report for text or JSON output. */
  readonly report: BuildReport;
  /** Whether the run was discarded because a newer generation started. */
  readonly stale: boolean;
}

interface MutableOutput {
  kind: OutputKind;
  path: string;
  absolutePath: string;
  written: boolean;
  reason?: string;
}

/** Compiler diagnostic code used for CLI-level source read failures. */
const CLI_SOURCE_ERROR = "XESSACLI002";
/** Compiler diagnostic code used for CLI-level write failures. */
const CLI_WRITE_ERROR = "XESSACLI001";

/** Run one build or check and return the structured report. */
export async function executeBuild(options: ExecuteBuildOptions): Promise<ExecuteBuildResult> {
  const { context } = options;
  const command = options.write ? "build" : "check";
  const warnings = [...context.configWarnings];
  const errors: string[] = [];
  const rawByEntry = new Map<string, Diagnostic[]>();
  const positionedByEntry = new Map<string, CliDiagnostic[]>();

  let compiler: Awaited<ReturnType<typeof loadCompiler>>;
  try {
    compiler = await loadCompiler();
  } catch (error) {
    errors.push(describeError(error));
    return {
      report: emptyReport(command, context, options.dryRun, errors, warnings),
      stale: false,
    };
  }

  const host = compiler.createNodeHost(context.root);
  const positions = new DiagnosticPositions(context.root);
  const entries = [...context.entries];
  if (entries.length === 0) {
    warnings.push("No .cssx sources matched the project include globs.");
  }
  const setups = new Map<string, FileSetupValues>();
  const sources = new Map<string, string>();
  const resolvedSetups = new Map<string, ResolvedSetup>();
  const minifyOverrides = new Set<string>();

  for (const entry of entries) {
    let source: string | undefined;
    try {
      source = await readFile(joinPosix(context.root, entry), "utf8");
      sources.set(entry, source);
    } catch (error) {
      const diagnostic: CliDiagnostic = {
        code: CLI_SOURCE_ERROR,
        severity: "error",
        message: `Could not read source: ${describeError(error)}`,
        file: entry,
        line: 1,
        column: 1,
      };
      positionedByEntry.set(entry, [diagnostic]);
      setups.set(entry, {});
      continue;
    }

    let fileSetup: FileSetupValues = {};
    try {
      fileSetup = decodeFileSetup(compiler.parse(source, { file: entry }).ast);
    } catch {
      fileSetup = {};
    }
    setups.set(entry, fileSetup);
    if (
      options.minify !== undefined &&
      fileSetup.minify !== undefined &&
      fileSetup.minify !== options.minify
    ) {
      minifyOverrides.add(entry);
      warnings.push(
        `${entry}: setup minify ${fileSetup.minify ? "true" : "false"} overridden by CLI flag (${options.minify ? "--minify" : "--no-minify"}).`,
      );
    }
  }

  // Plan every entry first so cross-entry target collisions are detectable.
  const plans = new Map<string, PlanOutputsResult>();
  const occupied: string[] = [];
  const projectConfig = planProjectConfig(context.config?.output);
  for (const entry of entries) {
    const setup = resolveEffectiveSetup(
      entry,
      context.config,
      setups.get(entry) ?? {},
      options.minify,
    );
    resolvedSetups.set(entry, setup);
    let plan: PlanOutputsResult;
    try {
      plan = compiler.planOutputs(
        {
          sourceFile: entry,
          setup,
          ...(projectConfig === undefined ? {} : { projectConfig }),
          workspaceRoot: context.root,
        },
        {
          host: { canonicalize: (path) => host.canonicalize(path) },
          occupiedTargets: [...occupied],
        },
      );
    } catch (error) {
      errors.push(`Could not plan outputs for ${entry}: ${describeError(error)}`);
      continue;
    }
    plans.set(entry, plan);
    for (const output of plan.plan.outputs) occupied.push(output.absolutePath);
  }

  // Sweep `.cssx-tmp` files left by a process that died between the temporary
  // write and its rename, before this run writes anything. Only the writer's own
  // dot-prefixed pattern is matched, never user files.
  if (options.write && !options.dryRun) {
    const directories = new Set<string>([context.root]);
    for (const plan of plans.values()) {
      for (const output of plan.plan.outputs) directories.add(dirnamePosix(output.absolutePath));
    }
    await sweepTemporaries([...directories]);
  }

  // Compile all entries through one shared module graph.
  let results: Record<string, CompileResult> = {};
  try {
    results = await compiler.compileProject(
      entries,
      host,
      compileOptions(context.config, options.minify),
    );
  } catch (error) {
    errors.push(`Compilation failed: ${describeError(error)}`);
  }

  // A file `@setup minify` beats the compiler's project layer, but explicit CLI
  // flags are the highest precedence (SPECIFICATION.md §9.1). Recompile only
  // the conflicting entries with `compile`, whose API options override file
  // setup, and take its CSS text; class maps, types, plans and dependencies stay
  // with the shared project compilation.
  if (options.minify !== undefined && minifyOverrides.size > 0) {
    for (const entry of minifyOverrides) {
      const result = results[entry];
      const setup = resolvedSetups.get(entry);
      const source = sources.get(entry);
      const cssPlanned = plans.get(entry)?.plan.outputs.some((output) => output.kind === "css");
      if (result === undefined || setup === undefined || source === undefined || !cssPlanned) {
        continue;
      }
      const css = await compileWithMinifyOverride(
        compiler,
        context,
        entry,
        source,
        setup,
        options.minify,
      );
      if (css === undefined) {
        warnings.push(
          `${entry}: could not apply the CLI minify override; keeping the setup value.`,
        );
        continue;
      }
      results[entry] = { ...result, css };
    }
  }

  const mutableOutputs = new Map<string, MutableOutput[]>();
  const dependencies = new Map<string, readonly string[]>();
  const successfulSources = new Set<string>();
  let stale = false;

  for (const entry of entries) {
    const result = results[entry];
    const plan = plans.get(entry);
    const raw: Diagnostic[] = [];
    if (result !== undefined) raw.push(...result.diagnostics);
    if (plan !== undefined) raw.push(...plan.diagnostics);
    rawByEntry.set(entry, dedupeRaw(raw));
    dependencies.set(entry, result?.dependencies ?? []);

    const outputs: MutableOutput[] = [];
    for (const planned of plan?.plan.outputs ?? []) {
      outputs.push({
        kind: planned.kind,
        path: planned.workspacePath,
        absolutePath: planned.absolutePath,
        written: false,
      });
    }
    mutableOutputs.set(entry, outputs);
  }

  // Position all diagnostics before writing so text and JSON agree.
  for (const entry of entries) {
    const positioned = await positions.convert(rawByEntry.get(entry) ?? []);
    const extra = positionedByEntry.get(entry) ?? [];
    positionedByEntry.set(entry, dedupeDiagnostics([...positioned, ...extra]));
  }

  const writesEnabled = options.write && !options.dryRun;
  // Checked immediately before the first artifact rename (no await intervenes),
  // so a generation discarded here writes nothing at all.
  if (writesEnabled && options.isCurrent !== undefined && !options.isCurrent()) stale = true;

  const writtenRecords: ManifestRecord[] = [];

  for (const entry of entries) {
    const entryDiagnostics = positionedByEntry.get(entry) ?? [];
    const entryHasErrors = hasErrors(entryDiagnostics);
    const outputs = mutableOutputs.get(entry) ?? [];
    const result = results[entry];

    if (!options.write) {
      for (const output of outputs) output.reason = "check";
      continue;
    }
    if (options.dryRun) {
      for (const output of outputs) output.reason = "dry-run";
      continue;
    }
    if (stale) {
      for (const output of outputs) output.reason = "stale";
      continue;
    }
    if (entryHasErrors || result === undefined) {
      for (const output of outputs) output.reason = "error";
      continue;
    }

    let entryFailed = false;
    for (const output of outputs) {
      const content = artifactContent(result, output.kind);
      if (content === undefined) {
        output.reason = output.kind === "cssSourceMap" ? "not-implemented" : "missing-artifact";
        warnings.push(
          output.kind === "cssSourceMap"
            ? `${output.path}: CSS source maps land in P7; artifact not written.`
            : `${output.path}: the compiler did not return ${output.kind} content; artifact not written.`,
        );
        continue;
      }
      try {
        const hash = await atomicWrite(output.absolutePath, content);
        output.written = true;
        writtenRecords.push({ kind: output.kind, path: output.path, source: entry, hash });
      } catch (error) {
        output.reason = "write-failed";
        entryFailed = true;
        const writeDiagnostic: CliDiagnostic = {
          code: CLI_WRITE_ERROR,
          severity: "error",
          message: `Failed to write ${output.path}: ${describeError(error)}`,
          file: entry,
          line: 1,
          column: 1,
        };
        positionedByEntry.set(
          entry,
          dedupeDiagnostics([...(positionedByEntry.get(entry) ?? []), writeDiagnostic]),
        );
        break;
      }
    }
    if (!entryFailed) successfulSources.add(entry);
  }

  if (writesEnabled && !stale) {
    const pruneAll =
      options.prune && entries.length > 0 && successfulSources.size === entries.length;
    try {
      const previous = await readManifest(context.root);
      warnings.push(...previous.warnings);
      const replaceSources = pruneAll ? new Set<string>() : new Set(successfulSources);
      const rewritten = new Set(writtenRecords.map((record) => record.path));
      const kept = previous.manifest.files.filter((record) =>
        rewritten.has(record.path) ? false : !(pruneAll || replaceSources.has(record.source)),
      );
      const obsolete = previous.manifest.files.filter(
        (record) => !rewritten.has(record.path) && (pruneAll || replaceSources.has(record.source)),
      );
      const cleanup = await pruneRecords(context.root, obsolete);
      warnings.push(...cleanup.warnings);
      errors.push(...cleanup.errors);
      const nextRecords = mergeRecords(kept, writtenRecords);
      // Always persist the manifest once any artifact was renamed into place. A
      // filesystem event can arrive after the check above and during the write
      // loop; skipping the manifest then left the tree newer than the records
      // (the CSSX-T06 desync). The next generation rebuilds from this consistent
      // state, so nothing is lost and nothing is reported as owned twice.
      await writeManifest(context.root, { version: 1, files: nextRecords });
    } catch (error) {
      errors.push(`Could not update .cssx-manifest.json: ${describeError(error)}`);
    }
  }

  const entryReports: EntryReport[] = entries.map((entry) => ({
    file: entry,
    dependencies: dependencies.get(entry) ?? [],
    outputs: (mutableOutputs.get(entry) ?? []).map(toOutputRecord),
    diagnostics: positionedByEntry.get(entry) ?? [],
  }));

  const report: BuildReport = {
    command,
    workspaceRoot: context.root,
    configFile: context.config?.file ?? null,
    dryRun: options.dryRun,
    entries: entryReports,
    diagnostics: dedupeDiagnostics(entryReports.flatMap((entry) => entry.diagnostics)),
    warnings,
    errors,
  };

  return { report, stale };
}

/** `xessa build` command entry point. */
export async function runBuild(invocation: CliInvocation, cwd: string): Promise<number> {
  const prepared = await prepareProject(invocation, cwd);
  if (!prepared.ok) return invocationFailure(invocation.command, prepared.message, invocation.json);
  if (!prepared.context.singleEntry && prepared.context.entries.length === 0) {
    return invocationFailure(
      invocation.command,
      "No .cssx sources matched the project include globs.",
      invocation.json,
    );
  }

  let outcome: ExecuteBuildResult;
  try {
    outcome = await executeBuild({
      context: prepared.context,
      write: true,
      dryRun: invocation.dryRun,
      prune: !prepared.context.singleEntry,
      ...(invocation.minify === undefined ? {} : { minify: invocation.minify }),
    });
  } catch (error) {
    return invocationFailure(invocation.command, describeError(error), invocation.json);
  }

  emitReport(outcome.report, invocation.json);
  return reportExitCode(outcome.report);
}

/** Convert a report into its machine-readable shape. */
export function toJsonReport(report: BuildReport): JsonBuildReport {
  const failed = hasErrors(report.diagnostics) || report.errors.length > 0;
  return {
    command: report.command,
    success: !failed,
    exitCode: failed ? 1 : 0,
    dryRun: report.dryRun,
    workspaceRoot: report.workspaceRoot,
    configFile: report.configFile,
    entries: report.entries.map((entry) => ({
      file: entry.file,
      dependencies: entry.dependencies,
      outputs: entry.outputs.map((output) => ({
        kind: output.kind,
        path: output.path,
        written: output.written,
        ...(output.reason === undefined ? {} : { reason: output.reason }),
      })),
      diagnostics: entry.diagnostics,
    })),
    diagnostics: report.diagnostics,
    warnings: report.warnings,
    errors: report.errors,
  };
}

/** Print a report as text or JSON. */
export function emitReport(report: BuildReport, json: boolean): void {
  if (json) {
    writeLine(toJson(toJsonReport(report)).trimEnd());
    return;
  }

  for (const diagnostic of report.diagnostics) writeErrorLine(formatDiagnostic(diagnostic));
  for (const warning of report.warnings) writeErrorLine(`xessa: warning: ${warning}`);
  for (const error of report.errors) writeErrorLine(`xessa: error: ${error}`);

  const written = report.entries.flatMap((entry) =>
    entry.outputs.filter((output) => output.written),
  );
  for (const output of written) writeLine(`wrote ${output.path}`);

  const errorCount = report.diagnostics.filter((entry) => entry.severity === "error").length;
  const warningCount =
    report.diagnostics.filter((entry) => entry.severity === "warning").length +
    report.warnings.length;
  if (report.command === "check") {
    writeLine(
      `xessa check: ${report.entries.length} entr${report.entries.length === 1 ? "y" : "ies"} checked, ` +
        `${errorCount} error${plural(errorCount)}, ${warningCount} warning${plural(warningCount)}`,
    );
    return;
  }
  if (report.dryRun) {
    writeLine(`xessa build: dry run, ${plannedCount(report)} file(s) planned`);
    return;
  }
  if (errorCount > 0 || report.errors.length > 0) {
    writeLine(`xessa build: failed (${errorCount} error${plural(errorCount)})`);
    return;
  }
  writeLine(
    `xessa build: ${report.entries.length} entr${report.entries.length === 1 ? "y" : "ies"}, ` +
      `${written.length} file${plural(written.length)} written, ` +
      `${warningCount} warning${plural(warningCount)}`,
  );
}

/** Exit code for a completed report: 1 when any error exists. */
export function reportExitCode(report: BuildReport): number {
  return hasErrors(report.diagnostics) || report.errors.length > 0 ? 1 : 0;
}

function plannedCount(report: BuildReport): number {
  return report.entries.reduce((count, entry) => count + entry.outputs.length, 0);
}

function compileOptions(
  config: CliConfig | null,
  minify: boolean | undefined,
): CompileProjectOptions {
  const output = config?.output;
  const mergedOutput =
    output === undefined && minify === undefined
      ? undefined
      : {
          ...(output ?? {}),
          ...(minify === undefined ? {} : { minify }),
        };
  return {
    ...(mergedOutput === undefined ? {} : { output: mergedOutput }),
    ...(config?.classes === undefined ? {} : { naming: config.classes }),
    ...(config?.media === undefined ? {} : { media: config.media }),
    ...(config?.compiler?.strict === undefined ? {} : { strict: config.compiler.strict }),
    ...(config?.compiler?.mediaGrouping === undefined
      ? {}
      : { mediaGrouping: config.compiler.mediaGrouping }),
  };
}

/** Planner project layer exactly as `compileProject` passes it (directories only). */
function planProjectConfig(output: CliConfig["output"]): ProjectConfig | undefined {
  if (output === undefined) return undefined;
  const directories = {
    ...(output.cssDir === undefined ? {} : { cssDir: output.cssDir }),
    ...(output.mapDir === undefined ? {} : { mapDir: output.mapDir }),
  };
  if (directories.cssDir === undefined && directories.mapDir === undefined) return undefined;
  return { output: directories };
}

/**
 * Recompile one entry so an explicit `--minify`/`--no-minify` flag wins over a
 * file `@setup minify`. Only the CSS text is taken: destinations, class maps,
 * types and dependency records remain those of the shared project compile.
 */
async function compileWithMinifyOverride(
  compiler: Awaited<ReturnType<typeof loadCompiler>>,
  context: ProjectContext,
  entry: string,
  source: string,
  setup: ResolvedSetup,
  minify: boolean,
): Promise<string | undefined> {
  const options: CompileOptions = {
    file: entry,
    workspaceRoot: context.root,
    prefix: setup.prefix,
    minify,
    emitCss: true,
    emitMap: false,
    emitTypes: false,
    ...(context.config?.media === undefined ? {} : { media: context.config.media }),
    ...(context.config?.compiler?.mediaGrouping === undefined
      ? {}
      : { mediaGrouping: context.config.compiler.mediaGrouping }),
  };
  try {
    const result = await compiler.compile(source, options);
    return result.css;
  } catch {
    return undefined;
  }
}

function artifactContent(result: CompileResult, kind: OutputKind): string | undefined {
  switch (kind) {
    case "css":
      return result.css;
    case "js":
      return result.js;
    case "types":
      return result.types;
    case "cssSourceMap":
      return result.sourceMap;
  }
}

function dedupeRaw(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
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
    result.push(diagnostic);
  }
  return result;
}

function toOutputRecord(output: MutableOutput): OutputRecord {
  return {
    kind: output.kind,
    path: output.path,
    absolutePath: output.absolutePath,
    written: output.written,
    ...(output.reason === undefined ? {} : { reason: output.reason }),
  };
}

function mergeRecords(
  previous: readonly ManifestRecord[],
  written: readonly ManifestRecord[],
): ManifestRecord[] {
  const byPath = new Map<string, ManifestRecord>();
  for (const record of previous) byPath.set(record.path, record);
  for (const record of written) byPath.set(record.path, record);
  return [...byPath.values()].sort((left, right) => (left.path < right.path ? -1 : 1));
}

interface CleanupOutcome {
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Delete obsolete owned outputs that are still byte-identical to their recorded
 * hash. Files modified since generation are kept and reported.
 */
async function pruneRecords(
  root: string,
  obsolete: readonly ManifestRecord[],
): Promise<CleanupOutcome> {
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const record of obsolete) {
    if (!isArtifactRecord(record)) {
      warnings.push(
        `Not removing ${record.path}: the record does not describe a compiler artifact; ownership released.`,
      );
      continue;
    }
    const absolute = joinPosix(root, record.path);
    const currentHash = await hashFile(absolute);
    if (currentHash === null) continue;
    if (currentHash !== record.hash) {
      warnings.push(`Not removing ${record.path}: modified since generation; ownership released.`);
      continue;
    }
    try {
      await removeFile(absolute);
    } catch (error) {
      errors.push(`Could not remove obsolete output ${record.path}: ${describeError(error)}`);
    }
  }

  return { warnings, errors };
}

function emptyReport(
  command: "build" | "check",
  context: ProjectContext,
  dryRun: boolean,
  errors: readonly string[],
  warnings: readonly string[],
): BuildReport {
  return {
    command,
    workspaceRoot: context.root,
    configFile: context.config?.file ?? null,
    dryRun,
    entries: [],
    diagnostics: [],
    warnings,
    errors,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
