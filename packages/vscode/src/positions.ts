/**
 * Offset↔position conversion for the pure editor layer.
 *
 * Kept in its own module so analysis, intelligence and the group resolver can
 * all use it without importing `analysis.ts` (which imports the group
 * resolver). `analysis.ts` re-exports the same helpers for its public surface.
 */

/** Zero-based editor position. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** Half-open editor range. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** Compute line start offsets for offset→position mapping. */
export function computeLineStarts(text: string): readonly number[] {
  const starts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/** Convert an offset to a zero-based line/character position. */
export function positionAt(lineStarts: readonly number[], offset: number): Position {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: Math.max(0, offset - (lineStarts[low] ?? 0)) };
}

/** Convert an offset pair to an editor range. */
export function rangeAt(lineStarts: readonly number[], start: number, end: number): Range {
  return {
    start: positionAt(lineStarts, start),
    end: positionAt(lineStarts, Math.max(start, end)),
  };
}
