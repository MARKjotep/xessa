/**
 * Lexer facade for `@xessa/compiler`.
 *
 * `tokenize` is the only entry point the parser needs: it turns source text into
 * a lossless token stream that always ends with exactly one `eof` token, plus
 * the lexical diagnostics collected on the way. It is a pure function — no
 * filesystem, no ambient state, no dependencies — and it never throws.
 *
 * `modifier` is deliberately absent from the output: the frozen `Token` JSDoc
 * makes the parser promote a recognised `at-keyword` to `modifier` only at
 * top-level value depth or in block-condition position, so alias tables stay in
 * configuration where they belong.
 */

import type { Diagnostic } from "../types/diagnostics.js";
import type { Token } from "../types/token.js";
import { scan } from "./scanner.js";

/** Result of tokenizing one source string. */
export interface TokenizeResult {
  /** Tokens in source order, always ending with exactly one zero-width `eof`. */
  readonly tokens: readonly Token[];
  /** Lexical errors in source order; empty when the source tokenizes cleanly. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Tokenize Xessa source.
 *
 * `file` is copied into every diagnostic {@link Span}; token spans are half-open
 * UTF-16 offsets into `source`, and concatenating `source.slice(start, end)` for
 * every token reproduces `source` exactly (the single `function` token's `value`
 * omits its `(`, but its span still covers only the name).
 */
export function tokenize(source: string, file: string): TokenizeResult {
  return scan(source, file);
}
