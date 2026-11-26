import type { Diagnostic, DiagnosticCode } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";

/**
 * Collects parser diagnostics and hands them back in source order.
 *
 * Syntax diagnostics are statement-scoped per SPECIFICATION.md §12: recovery
 * reports once per statement and resumes at the next safe boundary.
 */
export class DiagnosticBag {
  private readonly collected: Diagnostic[] = [];

  add(code: DiagnosticCode, message: string, span: Span): void {
    this.collected.push(error(code, message, span));
  }

  /** Diagnostics sorted by start (then end) so ordering is deterministic. */
  finish(): readonly Diagnostic[] {
    return Object.freeze(
      [...this.collected].sort(
        (left, right) => left.span.start - right.span.start || left.span.end - right.span.end,
      ),
    );
  }
}

/**
 * User-facing wording for parser diagnostics.
 *
 * Syntax fixtures match on `messageContains` (tests/fixtures/README.md), so each
 * message carries the phrase the fixture pins: "conditional block", "semicolon",
 * "malformed" and "block".
 */
export const messages = {
  topLevelConditional:
    "conditional block outside rule: conditional blocks are only valid inside a rule (D3)",
  conditionalNeedsBlock: "conditional block is missing its '{' block",
  nativeInConditional:
    "native at-rule is not allowed inside a conditional block; move it into a rule",
  unclosedBlock: (construct: string) =>
    `unclosed block: expected '}' before end of file for ${construct}`,
  missingBrace: (construct: string) => `syntax error: expected '{' to open ${construct}`,
  unexpectedStatement: "syntax error: expected a declaration or nested rule",
  unexpectedToken: "syntax error: unexpected token",
  unexpectedAtRule: "syntax error: at-rule is not allowed here",
  emptySelector: "syntax error: rule selector is missing before '{'",
  emptyProperty: "syntax error: declaration property is missing before ':'",
  missingColon: (property: string) => `syntax error: expected ':' after property '${property}'`,
  missingSemicolon: (what: string) =>
    `missing semicolon after ${what}; v0.1 requires a semicolon for Xessa declarations (ADR-0011)`,
  malformedValue: "malformed value: unbalanced parentheses or brackets in declaration",
  malformedCondition: "malformed condition: unbalanced parentheses or brackets",
  expectedModuleSpecifier: "syntax error: expected a quoted module specifier after @use",
  expectedImportAlias: "syntax error: expected an identifier after 'as' in @use",
  expectedSettingKey: "syntax error: expected a setup setting key",
  expectedSettingColon: "syntax error: expected ':' after a setup setting key",
  expectedTokenName: "syntax error: expected a token name inside @variables",
  expectedAliasName: "syntax error: expected an alias name inside @media-types",
  groupMissingName:
    'syntax error: expected a group name after "@group."; write @group.<name> contiguously (ADR-0017)',
  groupMalformedName:
    'syntax error: malformed group name; "@group", "." and the name must be contiguous and the name a CSS identifier (ADR-0017)',
  groupNeedsBlock: (group: string) =>
    `syntax error: expected '{' to open the ${group} block; the block is required in v0.1 (ADR-0017)`,
  groupConditionalUseSite: (group: string) =>
    `syntax error: conditional group use site "${group} @…" is not supported; an unconditional use-site block is required in v0.1 (ADR-0017)`,
  groupDeclarationsOnly: (group: string) =>
    `syntax error: ${group} accepts declarations only; nested rules, conditional blocks and at-rules are not allowed (ADR-0017)`,
  groupNotAllowedHere: (group: string, context: string) =>
    `syntax error: ${group} is not allowed inside ${context}; group use sites belong in a rule body (ADR-0017)`,
  unclosedTypeBlock: (construct: string) =>
    `unclosed block: expected '}' before end of file for ${construct}`,
  internalRecovery: "syntax error: parser recovered from an unexpected token",
} as const;
