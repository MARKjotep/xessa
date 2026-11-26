import type { Stylesheet } from "../types/ast.js";
import type { ParseResult } from "../types/result.js";
import type { Token } from "../types/token.js";
import { DiagnosticBag, messages } from "./diagnostics.js";
import { parseStylesheet } from "./statements.js";

/**
 * Parse a token stream into an immutable stylesheet AST plus syntax
 * diagnostics.
 *
 * The parser consumes a `readonly Token[]` produced by the lexer: it never
 * re-tokenizes source text, never mutates the input and never throws. Unknown
 * or malformed constructs are reported with the frozen XESSA1001/1002/1003
 * factories and recovery resumes at the next statement boundary, so a
 * `Stylesheet` is always returned (SPECIFICATION.md §3, §12; ADR-0004,
 * ADR-0011).
 *
 * Statement-depth rules worth knowing at the call site:
 *
 * - `@setup`, `@use`, `@variables`, `@runtime`, `@media-types`, `@group`
 *   definitions, rules and native at-rules are the only top-level constructs; a
 *   top-level conditional block is diagnosed and dropped. `@group.<name>`
 *   definitions are inert and declarations-only, and the same construct in a
 *   rule body parses as a use site (ADR-0017).
 * - Nested rules versus declarations are decided by balanced lookahead: a `{`
 *   before the statement terminator makes a rule (ADR-0002).
 * - `!important` stays raw text per segment and sets only that segment's flag
 *   (ADR-0003); a `$` reference additionally yields the parsed token sequence
 *   (ADR-0005).
 * - A final declaration without `;` before `}` is accepted only when it carries
 *   no modifier and no `$` reference; otherwise it is XESSA1002 (ADR-0011).
 */
export function parseTokens(tokens: readonly Token[], file: string): ParseResult {
  try {
    return parseStylesheet(tokens, file);
  } catch {
    // Defensive guarantee: a parser bug must never crash a host or the editor.
    const last = tokens[tokens.length - 1];
    const offset = last === undefined ? 0 : last.kind === "eof" ? last.start : last.end;
    const bag = new DiagnosticBag();
    bag.add("XESSA1001", messages.internalRecovery, { start: 0, end: offset, file });
    const ast: Stylesheet = Object.freeze({
      kind: "stylesheet",
      file,
      items: Object.freeze([]),
      span: { start: 0, end: offset, file },
    });
    return { ast, diagnostics: bag.finish() };
  }
}
