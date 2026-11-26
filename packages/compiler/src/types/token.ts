/**
 * The lexical vocabulary shared by the tokenizer, parser and AST.
 *
 * A token always covers one contiguous slice of the original source and never
 * normalizes escaped text. `Token.value` is the exact source text for the
 * token, with the single documented exception of `function`, whose value
 * excludes the opening parenthesis so parentheses stay individually balanced.
 */
export type TokenKind =
  /** Identifier or keyword, including escaped characters (`\31 23`, `status\:active`). */
  | "ident"
  /** Numeric token such as `12`, `0.5` or `10px`, kept as authored. */
  | "number"
  /** Quoted string including its delimiters; embedded `@`, `$`, `{`, `}` and `;` stay inert. */
  | "string"
  /** A complete `url(...)` construct including parentheses, quotes and any `@` or `$` inside. */
  | "url"
  /** A CSS function name; the immediately following `(` is emitted as a separate `lparen`. */
  | "function"
  /** Any other single character without a dedicated kind. */
  | "delim"
  | "colon"
  | "semicolon"
  | "comma"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  /** A `#` name or hash value such as `#2563eb`. */
  | "hash"
  /**
   * An `@` name such as `@media` or `@setup`, including the `@`. Directive and
   * native at-rule names both arrive here because alias tables are
   * configuration-dependent; the parser promotes recognized condition names to
   * `modifier`.
   */
  | "at-keyword"
  /** A compile-time variable reference, either `$name` or `$name.member`, including the `$`. */
  | "dollar-ref"
  /**
   * A recognized Xessa condition modifier such as `@md` or `@xl+dark`, with the
   * `@` and any `+` joins preserved. The tokenizer never emits this kind on its
   * own: the parser reclassifies `at-keyword` to `modifier` only at top-level
   * value depth (inline variants) or in block-condition position. It must not
   * occur anywhere else, so an `@` inside strings, comments, URLs, functions or
   * without preceding whitespace never becomes one.
   */
  | "modifier"
  /** Insignificant whitespace, emitted so token streams can reproduce the source exactly. */
  | "whitespace"
  /** A block comment emitted for fidelity and skipped where insignificant. */
  | "comment"
  /** Zero-width end-of-input marker with an empty value. */
  | "eof";

/**
 * One lexical token pointing into the original source.
 *
 * Tokens carry offsets only; derive line and column from `start`/`end` when
 * reporting. Escapes are never rewritten, so a stream that keeps whitespace and
 * comment tokens reproduces the authored source byte for byte.
 */
export interface Token {
  readonly kind: TokenKind;
  /**
   * Exact source slice covered by `[start, end)` for every kind except
   * `function`, whose value is the function name without its `(`. `eof` has an
   * empty value.
   */
  readonly value: string;
  /** Inclusive source offset of the token. */
  readonly start: number;
  /** Exclusive source offset of the token. */
  readonly end: number;
}
