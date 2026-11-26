/**
 * A half-open range of offsets into one source file.
 *
 * `start` is inclusive and `end` is exclusive, so a zero-width span has
 * `start === end`. Offsets are UTF-16 code-unit indices into the authored
 * source text. Line and column numbers are deliberately **not** stored: every
 * consumer derives them from `start`/`end` with the same offset-to-position
 * rule, which keeps diagnostics, source maps and editor ranges consistent
 * across stages.
 */
export interface Span {
  /** Inclusive offset of the first covered character. */
  readonly start: number;
  /** Exclusive offset just past the last covered character. */
  readonly end: number;
  /** Workspace-relative, POSIX-normalized path (forward slashes) of the source file. */
  readonly file: string;
}
