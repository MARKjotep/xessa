/**
 * Zero-dependency CSS source-map support (standard v3).
 *
 * The public surface is intentionally small: {@link encodeVlq} for the encoding
 * primitive, {@link encodeMappings} and {@link generateSourceMap} for assembly,
 * {@link serializeSourceMap} for text artifacts, and the locating helpers used
 * by the emitter to turn authored UTF-16 spans into line/column pairs. Mapping
 * granularity is documented in `./mappings.ts`: one mapping per emitted rule
 * selector and per emitted declaration.
 */

export {
  encodeMappings,
  generateSourceMap,
  offsetToLineColumn,
  serializeSourceMap,
  sourceMapComment,
  sourceMapUrlFor,
} from "./mappings.js";
export type {
  GenerateSourceMapOptions,
  SourceMapV3,
  SourceMapping,
} from "./mappings.js";
export { encodeVlq } from "./vlq.js";
