/**
 * `xessa format [file]` — canonical source formatting.
 *
 * The command resolves entries exactly like `xessa check` (explicit file or the
 * project include/exclude globs), parses and reprints each source with the pure
 * compiler formatter, and reports the files it changed. Default mode writes the
 * canonical text atomically in place; `--check` writes nothing and exits 1 when
 * at least one file would change. Parse errors are reported and never rewrite
 * the affected file. Exit codes stay contractual: 0 success, 1 formatting or
 * parse errors (or `--check` changes), 2 invocation/configuration errors.
 */

import { readFile } from "node:fs/promises";
import type { CliInvocation } from "../args.js";
import { loadFormatter } from "../formatter.js";
import { joinPosix } from "../paths.js";
import { prepareProject } from "../project.js";
import {
  type CliDiagnostic,
  DiagnosticPositions,
  dedupeDiagnostics,
  formatDiagnostic,
  invocationFailure,
  toJson,
  writeErrorLine,
  writeLine,
} from "../report.js";
import { atomicWrite } from "../writer.js";

/** One source file and what this run did with it. */
export interface FormatFileRecord {
  /** Workspace-relative POSIX source path. */
  readonly file: string;
  /** Whether the canonical text differs from the authored text. */
  readonly changed: boolean;
  /** Whether this run wrote the file. */
  readonly written: boolean;
  /** Why the file was not written, when applicable. */
  readonly reason?: string;
}

/** Machine-readable `xessa format` report (`--json`). */
export interface JsonFormatReport {
  readonly command: "format";
  readonly success: boolean;
  readonly exitCode: number;
  readonly check: boolean;
  readonly dryRun: boolean;
  readonly workspaceRoot: string;
  readonly configFile: string | null;
  readonly files: readonly FormatFileRecord[];
  readonly changed: readonly string[];
  readonly diagnostics: readonly CliDiagnostic[];
  readonly errors: readonly string[];
}

/** Run `xessa format [file] [--check]`. */
export async function runFormat(invocation: CliInvocation, cwd: string): Promise<number> {
  const prepared = await prepareProject(invocation, cwd);
  if (!prepared.ok) return invocationFailure(invocation.command, prepared.message, invocation.json);

  const context = prepared.context;
  const check = invocation.check === true;
  const dryRun = invocation.dryRun;
  let formatter: Awaited<ReturnType<typeof loadFormatter>>;
  try {
    formatter = await loadFormatter();
  } catch (error) {
    return invocationFailure(
      invocation.command,
      error instanceof Error ? error.message : String(error),
      invocation.json,
    );
  }

  const positions = new DiagnosticPositions(context.root);
  const files: FormatFileRecord[] = [];
  const diagnostics: CliDiagnostic[] = [];
  const errors: string[] = [];

  for (const entry of context.entries) {
    const absolute = joinPosix(context.root, entry);
    let source: string;
    try {
      source = await readFile(absolute, "utf8");
    } catch (error) {
      errors.push(`${entry}: cannot read source (${describeError(error)}).`);
      files.push({ file: entry, changed: false, written: false, reason: "read-failed" });
      continue;
    }

    const result = formatter.format(source, entry);
    diagnostics.push(...(await positions.convert(result.diagnostics)));
    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      errors.push(`${entry}: not formatted because parsing reported errors.`);
      files.push({ file: entry, changed: false, written: false, reason: "parse-error" });
      continue;
    }

    const changed = result.formatted !== source;
    if (!changed) {
      files.push({ file: entry, changed: false, written: false });
      continue;
    }
    if (check || dryRun) {
      files.push({ file: entry, changed: true, written: false, reason: "not-written" });
      continue;
    }

    try {
      await atomicWrite(absolute, result.formatted);
      files.push({ file: entry, changed: true, written: true });
    } catch (error) {
      errors.push(`${entry}: cannot write formatted source (${describeError(error)}).`);
      files.push({ file: entry, changed: true, written: false, reason: "write-failed" });
    }
  }

  const positioned = dedupeDiagnostics(diagnostics);
  const changedFiles = files.filter((file) => file.changed).map((file) => file.file);
  const failed =
    errors.length > 0 || positioned.some((diagnostic) => diagnostic.severity === "error");
  const exitCode = failed ? 1 : check && changedFiles.length > 0 ? 1 : 0;
  const success = exitCode === 0;

  if (invocation.json) {
    const report: JsonFormatReport = {
      command: "format",
      success,
      exitCode,
      check,
      dryRun,
      workspaceRoot: context.root,
      configFile: context.config?.file ?? null,
      files,
      changed: changedFiles,
      diagnostics: positioned,
      errors,
    };
    writeLine(toJson(report).trimEnd());
    return exitCode;
  }

  for (const diagnostic of positioned) writeErrorLine(formatDiagnostic(diagnostic));
  for (const error of errors) writeErrorLine(`xessa format: ${error}`);

  if (check) {
    if (changedFiles.length > 0) {
      writeLine(`xessa format --check: ${changedFiles.length} file(s) would be reformatted:`);
      for (const file of changedFiles) writeLine(`  ${file}`);
    } else {
      writeLine(`xessa format --check: ${files.length} file(s) already formatted.`);
    }
  } else if (dryRun) {
    writeLine(`xessa format --dry-run: ${changedFiles.length} file(s) would be reformatted.`);
    for (const file of changedFiles) writeLine(`  ${file}`);
  } else if (changedFiles.length > 0) {
    writeLine(`xessa format: reformatted ${changedFiles.length} file(s):`);
    for (const file of changedFiles) writeLine(`  ${file}`);
  } else {
    writeLine(`xessa format: ${files.length} file(s) already formatted.`);
  }

  return exitCode;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
