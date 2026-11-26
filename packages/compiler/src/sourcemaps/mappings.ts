/**
 * Standard v3 source-map assembly for emitted CSS.
 *
 * Granularity is declaration-level: the emitter records one mapping for each
 * emitted rule selector and one for each emitted declaration property. Tokens
 * inside a selector or value are not mapped individually, so no `names` array
 * is needed. Generated and source positions are zero-based here because that is
 * what the v3 `mappings` payload encodes; callers deriving positions from UTF-16
 * offsets get one-based lines/columns from {@link offsetToLineColumn} and must
 * subtract one.
 */

import { encodeVlq } from "./vlq.js";

/** One decoded mapping between an emitted CSS position and an authored source. */
export interface SourceMapping {
  /** Zero-based line in the emitted CSS. */
  readonly generatedLine: number;
  /** Zero-based column in the emitted CSS. */
  readonly generatedColumn: number;
  /** Workspace-relative POSIX path of the authored source file. */
  readonly source: string;
  /** Zero-based line in the authored source. */
  readonly sourceLine: number;
  /** Zero-based UTF-16 column in the authored source. */
  readonly sourceColumn: number;
}

/** A rendered source-map v3 document. */
export interface SourceMapV3 {
  /** Always `3`. */
  readonly version: 3;
  /** Planned CSS output basename, when known. */
  readonly file?: string;
  /** Optional prefix applied to every `sources` entry. */
  readonly sourceRoot?: string;
  /** Distinct authored sources in deterministic (sorted) order. */
  readonly sources: readonly string[];
  /** Optional authored text parallel to `sources`. */
  readonly sourcesContent?: readonly (string | null)[];
  /** VLQ-encoded mappings, standard segment format. */
  readonly mappings: string;
}

/** Options for {@link generateSourceMap}. */
export interface GenerateSourceMapOptions {
  /** Planned CSS output basename recorded in the map `file` field. */
  readonly file?: string;
  /** Optional `sourceRoot` for environments that relocate sources. */
  readonly sourceRoot?: string;
  /** Authored text per source, included as `sourcesContent` when supplied. */
  readonly sourcesContent?: Readonly<Record<string, string>>;
}

/**
 * Encode mappings as a standard v3 `mappings` string.
 *
 * Segments are sorted by generated line and column; the generated-column delta
 * resets on each line while source, source-line and source-column deltas carry
 * across the whole document, exactly as the v3 specification requires. Sources
 * missing from `sources` are skipped rather than producing an invalid index.
 */
export function encodeMappings(
  mappings: readonly SourceMapping[],
  sources: readonly string[],
): string {
  const indexBySource = new Map<string, number>();
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (source !== undefined) indexBySource.set(source, index);
  }

  const sorted = [...mappings].sort(
    (left, right) =>
      left.generatedLine - right.generatedLine || left.generatedColumn - right.generatedColumn,
  );
  const lines: string[][] = [];
  let lastSource = 0;
  let lastSourceLine = 0;
  let lastSourceColumn = 0;
  let currentLine = -1;
  let previousColumn = 0;
  let previous: SourceMapping | undefined;

  for (const mapping of sorted) {
    const sourceIndex = indexBySource.get(mapping.source);
    if (sourceIndex === undefined) continue;
    if (
      previous !== undefined &&
      previous.generatedLine === mapping.generatedLine &&
      previous.generatedColumn === mapping.generatedColumn &&
      previous.source === mapping.source &&
      previous.sourceLine === mapping.sourceLine &&
      previous.sourceColumn === mapping.sourceColumn
    ) {
      continue;
    }

    if (mapping.generatedLine !== currentLine) {
      currentLine = mapping.generatedLine;
      previousColumn = 0;
    }

    const segment =
      encodeVlq(mapping.generatedColumn - previousColumn) +
      encodeVlq(sourceIndex - lastSource) +
      encodeVlq(mapping.sourceLine - lastSourceLine) +
      encodeVlq(mapping.sourceColumn - lastSourceColumn);

    let line = lines[currentLine];
    if (line === undefined) {
      line = [];
      lines[currentLine] = line;
    }
    line.push(segment);
    previousColumn = mapping.generatedColumn;
    lastSource = sourceIndex;
    lastSourceLine = mapping.sourceLine;
    lastSourceColumn = mapping.sourceColumn;
    previous = mapping;
  }

  const maxLine = lines.length - 1;
  const encoded: string[] = [];
  for (let line = 0; line <= maxLine; line += 1) {
    encoded.push((lines[line] ?? []).join(","));
  }
  return encoded.join(";");
}

/** Build the complete v3 document for a set of mappings. */
export function generateSourceMap(
  mappings: readonly SourceMapping[],
  options: GenerateSourceMapOptions = {},
): SourceMapV3 {
  const sources = [...new Set(mappings.map((mapping) => mapping.source))].sort();
  const sourcesContent =
    options.sourcesContent === undefined
      ? undefined
      : sources.map((source) => options.sourcesContent?.[source] ?? null);

  return {
    version: 3,
    ...(options.file === undefined ? {} : { file: options.file }),
    ...(options.sourceRoot === undefined ? {} : { sourceRoot: options.sourceRoot }),
    sources,
    ...(sourcesContent === undefined ? {} : { sourcesContent }),
    mappings: encodeMappings(mappings, sources),
  };
}

/** Serialize a v3 map as deterministic JSON text with a trailing newline. */
export function serializeSourceMap(map: SourceMapV3): string {
  return `${JSON.stringify(map)}\n`;
}

/**
 * Convert a UTF-16 offset into a one-based line and column.
 *
 * Offsets past the end are clamped. Line breaks are `\n`; a `\r\n` sequence
 * therefore moves the column past the `\r` before the line break resets it,
 * matching the tokenizer's line accounting.
 */
export function offsetToLineColumn(
  text: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const limit = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < limit; index += 1) {
    if (text.charAt(index) === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** The `sourceMappingURL` value for a planned CSS output basename. */
export function sourceMapUrlFor(cssFile: string): string {
  return `${cssFile}.map`;
}

/** The CSS comment that points at a planned source-map artifact. */
export function sourceMapComment(cssFile: string): string {
  return `/*# sourceMappingURL=${sourceMapUrlFor(cssFile)} */`;
}
