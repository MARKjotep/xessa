/**
 * Block comment scanning.
 *
 * Comments are emitted as their own tokens for fidelity, so any `@`, `$`,
 * quote or brace inside one can never become a Xessa token. An unterminated
 * comment runs to end of file and is reported by the caller.
 */

/** Result of scanning one block comment. */
export interface CommentScan {
  /** Offset just past the closing star-slash sequence, or end of file. */
  readonly end: number;
  /** False when the closing star-slash sequence never appears. */
  readonly closed: boolean;
}

/**
 * Scan the block comment that opens at `start` with a slash-star sequence.
 *
 * `source.indexOf` keeps this linear for the whole file: each comment scans its
 * own body once.
 */
export function scanComment(source: string, start: number): CommentScan {
  const close = source.indexOf("*/", start + 2);
  if (close === -1) return { end: source.length, closed: false };
  return { end: close + 2, closed: true };
}
