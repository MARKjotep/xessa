/**
 * Reporting helpers: diagnostic positioning, text output and JSON shapes.
 *
 * Compiler diagnostics carry UTF-16 offsets (`Span`), so the CLI converts them
 * to 1-based line and column numbers using the entry sources it already reads.
 * Machine-readable output is stable and documented in the A11 report.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Diagnostic, OutputKind } from "@xessa/compiler";
import { joinPosix, relativePosix, toPosix } from "./paths.js";

/** A compiler diagnostic positioned for humans and machine consumers. */
export interface CliDiagnostic {
  /** Stable compiler code (`XESSA####`) or CLI code (`XESSACLI###`). */
  readonly code: string;
  /** `error` fails a build/check; `warning` is advisory. */
  readonly severity: "error" | "warning";
  /** User-facing explanation. */
  readonly message: string;
  /** Workspace-relative POSIX path of the diagnostic origin. */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column number. */
  readonly column: number;
}

/** One planned artifact and whether this run wrote it. */
export interface OutputRecord {
  /** Artifact kind. */
  readonly kind: OutputKind;
  /** Workspace-relative POSIX destination. */
  readonly path: string;
  /** Absolute destination. */
  readonly absolutePath: string;
  /** Whether the artifact was written by this run. */
  readonly written: boolean;
  /** Why the artifact was not written, when applicable. */
  readonly reason?: string;
}

/** Per-entry result of a build or check. */
export interface EntryReport {
  /** Workspace-relative POSIX path of the entry source. */
  readonly file: string;
  /** Workspace-relative POSIX paths of reachable modules, excluding the entry. */
  readonly dependencies: readonly string[];
  /** Planned artifacts in planner order. */
  readonly outputs: readonly OutputRecord[];
  /** Positioned diagnostics for this entry and its modules. */
  readonly diagnostics: readonly CliDiagnostic[];
}

/** Result of one build or check run. */
export interface BuildReport {
  /** Command that produced the report. */
  readonly command: "build" | "check";
  /** Absolute POSIX workspace root. */
  readonly workspaceRoot: string;
  /** Absolute path of the configuration file, when one was used. */
  readonly configFile: string | null;
  /** Whether the run only reported planned work. */
  readonly dryRun: boolean;
  /** One report per entry, sorted like the input entries. */
  readonly entries: readonly EntryReport[];
  /** All positioned diagnostics, deduplicated. */
  readonly diagnostics: readonly CliDiagnostic[];
  /** Non-diagnostic notes and warnings. */
  readonly warnings: readonly string[];
  /** Non-diagnostic failures such as write or manifest errors. */
  readonly errors: readonly string[];
}

/** Machine-readable artifact record. */
export interface JsonOutputFile {
  readonly kind: OutputKind;
  readonly path: string;
  readonly written: boolean;
  readonly reason?: string;
}

/** Machine-readable entry record. */
export interface JsonEntry {
  readonly file: string;
  readonly dependencies: readonly string[];
  readonly outputs: readonly JsonOutputFile[];
  readonly diagnostics: readonly CliDiagnostic[];
}

/** Machine-readable build/check report (`--json`). */
export interface JsonBuildReport {
  readonly command: "build" | "check";
  readonly success: boolean;
  readonly exitCode: number;
  readonly dryRun: boolean;
  readonly workspaceRoot: string;
  readonly configFile: string | null;
  readonly entries: readonly JsonEntry[];
  readonly diagnostics: readonly CliDiagnostic[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Maximum offset-to-line scan cost per distinct source file. */
const POSITION_CACHE_LIMIT = 512;

/** Converts compiler spans into 1-based line/column diagnostics. */
export class DiagnosticPositions {
  private readonly root: string;
  private readonly cache = new Map<string, string | null>();

  constructor(root: string) {
    this.root = root;
  }

  /** Convert raw compiler diagnostics to positioned CLI diagnostics. */
  async convert(diagnostics: readonly Diagnostic[]): Promise<CliDiagnostic[]> {
    const result: CliDiagnostic[] = [];
    for (const diagnostic of diagnostics) {
      const absolute = isAbsolute(diagnostic.span.file)
        ? toPosix(diagnostic.span.file)
        : joinPosix(this.root, diagnostic.span.file);
      const text = await this.readSource(absolute);
      const position =
        text === null ? { line: 1, column: 1 } : positionAt(text, diagnostic.span.start);
      result.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        file: this.displayPath(absolute),
        line: position.line,
        column: position.column,
      });
    }
    return result;
  }

  private displayPath(absolute: string): string {
    const relative = relativePosix(this.root, absolute);
    if (relative === "" || relative === ".." || relative.startsWith("../")) {
      return toPosix(absolute);
    }
    return relative;
  }

  private async readSource(absolute: string): Promise<string | null> {
    if (this.cache.has(absolute)) return this.cache.get(absolute) ?? null;
    let text: string | null = null;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      text = null;
    }
    if (this.cache.size >= POSITION_CACHE_LIMIT) this.cache.clear();
    this.cache.set(absolute, text);
    return text;
  }
}

/** Convert a UTF-16 offset to 1-based line and column. */
export function positionAt(text: string, offset: number): { line: number; column: number } {
  const limit = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < limit; index += 1) {
    const character = text.charAt(index);
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** One-line human diagnostic: `file:line:col severity CODE: message`. */
export function formatDiagnostic(diagnostic: CliDiagnostic): string {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

/** Write one line to stdout. */
export function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Write one line to stderr. */
export function writeErrorLine(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** Serialize a JSON report with a trailing newline. */
export function toJson(report: unknown): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Whether any diagnostics in the list are errors. */
export function hasErrors(diagnostics: readonly CliDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/** Deduplicate positioned diagnostics while preserving first-seen order. */
export function dedupeDiagnostics(diagnostics: readonly CliDiagnostic[]): CliDiagnostic[] {
  const seen = new Set<string>();
  const result: CliDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\u0000${diagnostic.severity}\u0000${diagnostic.file}\u0000${diagnostic.line}\u0000${diagnostic.column}\u0000${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

/**
 * Report an invocation or configuration failure and return exit code 2.
 *
 * With `--json` the failure is still machine-readable; otherwise it goes to
 * stderr with a `xessa:` prefix.
 */
export function invocationFailure(command: string, message: string, json: boolean): number {
  if (json) {
    writeLine(toJson({ command, success: false, exitCode: 2, error: message }).trimEnd());
  } else {
    writeErrorLine(`xessa: ${message}`);
  }
  return 2;
}
