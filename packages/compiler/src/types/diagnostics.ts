import type { Span } from "./span.js";

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * Stable diagnostic identifier of the form `XESSA####`.
 *
 * Families are XESSA1xxx (syntax and lexical), XESSA2xxx (symbols and
 * modules), XESSA3xxx (media and conditions), XESSA4xxx (naming and exports)
 * and XESSA5xxx (output planning). Subcodes may be added inside a family
 * without changing the shape of {@link DIAGNOSTIC_CODES}; every code is stable
 * once released.
 */
export type DiagnosticCode = `XESSA${Digit}${Digit}${Digit}${Digit}`;

/** A diagnostic is either fatal for the affected construct or advisory. */
export type DiagnosticSeverity = "error" | "warning";

/** The five stable diagnostic families. */
export type DiagnosticFamily = "syntax" | "variables" | "media" | "naming" | "output";

/** Registry metadata for one reserved diagnostic code. */
export interface DiagnosticCodeInfo {
  /** The code itself, identical to its key in {@link DIAGNOSTIC_CODES}. */
  readonly code: DiagnosticCode;
  /** Family the code belongs to. */
  readonly family: DiagnosticFamily;
  /** Severity producers should use unless a documented case narrows it. */
  readonly defaultSeverity: DiagnosticSeverity;
  /** Short, user-facing description of when the code is reported. */
  readonly summary: string;
}

/** Codes reserved for v0.1; additional subcodes may join a family later. */
export type ReservedDiagnosticCode =
  | "XESSA1001"
  | "XESSA1002"
  | "XESSA1003"
  | "XESSA2001"
  | "XESSA3001"
  | "XESSA4001"
  | "XESSA5001";

/**
 * Every reserved Xessa diagnostic with a short description.
 *
 * Family anchors double as the canonical code for the whole family, so early
 * implementations may report the anchor while finer subcodes are introduced
 * later. Statement-scoped syntax diagnostics span the affected statement so
 * editors and fixtures can point at its start.
 */
export const DIAGNOSTIC_CODES: Readonly<Record<ReservedDiagnosticCode, DiagnosticCodeInfo>> = {
  XESSA1001: {
    code: "XESSA1001",
    family: "syntax",
    defaultSeverity: "error",
    summary:
      "General syntax or lexical error, including a conditional block outside a rule, an unknown setup key, a duplicate setting, a duplicate @setup block and a lexer-level recovery.",
  },
  XESSA1002: {
    code: "XESSA1002",
    family: "syntax",
    defaultSeverity: "error",
    summary:
      "Missing semicolon after a Xessa declaration. v0.1 requires semicolons for Xessa declarations, while an ordinary CSS final declaration without a trailing semicolon before `}` MAY be accepted (SPECIFICATION §3.1).",
  },
  XESSA1003: {
    code: "XESSA1003",
    family: "syntax",
    defaultSeverity: "error",
    summary:
      "Malformed declaration or block: unbalanced parentheses or braces in values, or an unrecoverable statement.",
  },
  XESSA2001: {
    code: "XESSA2001",
    family: "variables",
    defaultSeverity: "error",
    summary:
      "Symbol or module error: undefined token, import cycle, duplicate or ambiguous definition, or a compile-time/runtime name collision.",
  },
  XESSA3001: {
    code: "XESSA3001",
    family: "media",
    defaultSeverity: "error",
    summary:
      "Media or condition error: unknown alias, unsupported alias combination or a combination that cannot form valid CSS.",
  },
  XESSA4001: {
    code: "XESSA4001",
    family: "naming",
    defaultSeverity: "error",
    summary:
      "Naming or export error: camelCase alias collision, invalid CSS identifier, or an omitted named export that is reserved or not a valid JavaScript identifier (a warning in that case).",
  },
  XESSA5001: {
    code: "XESSA5001",
    family: "output",
    defaultSeverity: "error",
    summary:
      "Output planning error: duplicate target, input/output overlap, workspace or symlink escape, or another unsafe output plan.",
  },
};

/** One reported problem tied to an exact source range. */
export interface Diagnostic {
  /** Stable Xessa code, always a member of the XESSA#### family. */
  readonly code: DiagnosticCode;
  /** Whether the affected construct is rejected or merely flagged. */
  readonly severity: DiagnosticSeverity;
  /** Complete, user-facing explanation with actionable context. */
  readonly message: string;
  /** Exact source range; line and column are derived from its offsets. */
  readonly span: Span;
}

/** Create an error diagnostic; the affected construct is rejected. */
export function error(code: DiagnosticCode, message: string, span: Span): Diagnostic {
  return { code, severity: "error", message, span };
}

/** Create a warning diagnostic; output is still produced. */
export function warning(code: DiagnosticCode, message: string, span: Span): Diagnostic {
  return { code, severity: "warning", message, span };
}
