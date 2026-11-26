/**
 * Hand-rolled base64-VLQ source-map decoder used by the TT5 sourcemap cases.
 *
 * Deliberately independent of the compiler's encoder (`packages/compiler/src/sourcemaps`):
 * this module never imports `@xessa/compiler`, so a bug in the encoder cannot hide
 * behind the same assumption in the decoder. The alphabet, the sign bit and the
 * generated/source delta accumulation rules come straight from the v3 specification.
 *
 * Positions in {@link DecodedSegment} are zero-based because that is what the v3
 * `mappings` payload encodes; {@link zeroBasedPosition} converts a UTF-16 offset in the
 * authored or emitted text into the same convention.
 */

/** The base64 alphabet a v3 `mappings` string is encoded with. */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One decoded mapping segment, in absolute (already accumulated) coordinates. */
export interface DecodedSegment {
  /** Zero-based line in the generated artifact. */
  readonly generatedLine: number;
  /** Zero-based UTF-16 column in the generated artifact. */
  readonly generatedColumn: number;
  /** Index into {@link DecodedSourceMap.sources}. */
  readonly sourceIndex: number;
  /** Zero-based line in the source file. */
  readonly sourceLine: number;
  /** Zero-based UTF-16 column in the source file. */
  readonly sourceColumn: number;
}

/** A parsed and fully decoded v3 source map. */
export interface DecodedSourceMap {
  readonly version: number;
  readonly file?: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  /** The raw VLQ payload, kept so a case can assert it is non-empty. */
  readonly mappings: string;
  readonly segments: readonly DecodedSegment[];
}

/** Decode one base64-VLQ segment into its signed integer components. */
export function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new Error(`invalid base64 VLQ character ${JSON.stringify(character)}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  if (value !== 0 || shift !== 0) throw new Error(`truncated base64 VLQ segment ${segment}`);
  return values;
}

/** Decode a complete v3 `mappings` string into absolute positions. */
export function decodeMappings(mappings: string): DecodedSegment[] {
  const segments: DecodedSegment[] = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  const lines = mappings.split(";");

  for (let generatedLine = 0; generatedLine < lines.length; generatedLine += 1) {
    const line = lines[generatedLine];
    if (line === undefined || line.length === 0) continue;
    let generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue;
      const values = decodeVlqSegment(segment);
      if (values.length !== 4) {
        throw new Error(`expected a 4-field mapping segment, received ${values.length} fields`);
      }
      generatedColumn += values[0] ?? 0;
      sourceIndex += values[1] ?? 0;
      sourceLine += values[2] ?? 0;
      sourceColumn += values[3] ?? 0;
      segments.push({ generatedLine, generatedColumn, sourceIndex, sourceLine, sourceColumn });
    }
  }
  return segments;
}

/** Parse and decode a serialized v3 map. */
export function parseSourceMap(text: string): DecodedSourceMap {
  const document = JSON.parse(text) as {
    version?: number;
    file?: string;
    sources?: string[];
    sourcesContent?: (string | null)[];
    mappings?: string;
  };
  const mappings = document.mappings ?? "";
  return {
    version: document.version ?? 0,
    ...(document.file === undefined ? {} : { file: document.file }),
    sources: document.sources ?? [],
    ...(document.sourcesContent === undefined ? {} : { sourcesContent: document.sourcesContent }),
    mappings,
    segments: decodeMappings(mappings),
  };
}

/** One-based line/column of a UTF-16 offset, computed without compiler helpers. */
function oneBasedPosition(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charAt(index) === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * Zero-based line/column of `needle` inside `text`, matching the v3 convention.
 *
 * Throws when the needle is absent so a broken fixture fails loudly instead of
 * silently asserting nothing.
 */
export function zeroBasedPosition(
  text: string,
  needle: string,
  from = 0,
): { line: number; column: number } {
  const offset = text.indexOf(needle, from);
  if (offset < 0) throw new Error(`missing ${JSON.stringify(needle)} after offset ${from}`);
  const position = oneBasedPosition(text, offset);
  return { line: position.line - 1, column: position.column - 1 };
}

/** The decoded segment at exactly `position`, if the map has one. */
export function segmentAt(
  segments: readonly DecodedSegment[],
  position: { readonly line: number; readonly column: number },
): DecodedSegment | undefined {
  return segments.find(
    (segment) =>
      segment.generatedLine === position.line && segment.generatedColumn === position.column,
  );
}

/** Length in UTF-16 code units of the zero-based generated line `line`. */
export function generatedLineLength(text: string, line: number): number {
  const lines = text.split("\n");
  return (lines[line] ?? "").length;
}
