/**
 * Comma-separated `@setup` value lists (ADR-0019).
 *
 * Only `css-dir` accepts a list in v0.1. Values are split on top-level commas
 * (commas inside quotes stay literal), each item is decoded as a CSS string
 * scalar, and empty or duplicate items become XESSA2001 setup errors with a span
 * inside the authored value. A value without a top-level comma keeps the
 * single-scalar behaviour exactly.
 */

import { normalizePath } from "./output/paths.js";
import { decodeCssString } from "./resolver/paths.js";
import { error } from "./types/diagnostics.js";
import type { Diagnostic } from "./types/diagnostics.js";
import type { Span } from "./types/span.js";

/** One decoded item in an authored list. */
export interface SetupListEntry {
  /** Decoded scalar: quotes removed and CSS escapes resolved. */
  readonly value: string;
  /** Covers the trimmed authored item, quotes included. */
  readonly span: Span;
}

/** Result of {@link decodeSetupList}. */
export interface SetupListResult {
  /** Valid decoded items in authored order; empty items contribute nothing. */
  readonly entries: readonly SetupListEntry[];
  /** Whether a top-level comma was authored (single values keep legacy rules). */
  readonly isList: boolean;
  /** XESSA2001 diagnostics for empty and duplicate items, in authored order. */
  readonly diagnostics: readonly Diagnostic[];
}

interface RawSegment {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  /** Absolute offset of the comma that precedes this segment, or `-1`. */
  readonly commaBefore: number;
}

/**
 * Decode an authored `@setup` value that may be a comma-separated list.
 *
 * @param raw Raw value slice exactly as authored (quotes included).
 * @param span Span of {@link raw} within the source, used for item diagnostics.
 * @returns Valid entries, whether the value was a list, and XESSA2001 errors.
 */
export function decodeSetupList(raw: string, span: Span): SetupListResult {
  const segments = splitSegments(raw, span);
  const isList = segments.length > 1;
  const entries: SetupListEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, SetupListEntry>();

  for (const segment of segments) {
    const content = trimBounds(segment);
    if (content === undefined) {
      diagnostics.push(
        error(
          "XESSA2001",
          '@setup "css-dir" list contains an empty directory item.',
          emptyItemSpan(segment, span.file),
        ),
      );
      continue;
    }
    const entry: SetupListEntry = Object.freeze({
      value: decodeSetupScalar(segment.raw.slice(content.start, content.end)),
      span: {
        start: segment.start + content.start,
        end: segment.start + content.end,
        file: span.file,
      },
    });
    if (entry.value === "") {
      diagnostics.push(
        error("XESSA2001", '@setup "css-dir" list contains an empty directory item.', entry.span),
      );
      continue;
    }
    if (seen.has(normalizePath(entry.value))) {
      diagnostics.push(
        error(
          "XESSA2001",
          `Duplicate directory "${entry.value}" in the @setup "css-dir" list.`,
          entry.span,
        ),
      );
      continue;
    }
    seen.set(normalizePath(entry.value), entry);
    entries.push(entry);
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    isList,
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Decode a setup scalar: quoted values lose their quotes and CSS escapes,
 * unquoted values are trimmed verbatim.
 */
export function decodeSetupScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charAt(0);
    const last = trimmed.charAt(trimmed.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return decodeCssString(trimmed.slice(1, -1));
    }
  }
  return trimmed;
}

function splitSegments(raw: string, span: Span): RawSegment[] {
  const segments: RawSegment[] = [];
  let start = 0;
  let quote: string | undefined;
  let escaped = false;
  let commaBefore = -1;

  for (let index = 0; index <= raw.length; index++) {
    const atEnd = index === raw.length;
    const character = atEnd ? "" : raw.charAt(index);

    if (!atEnd && quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (!atEnd && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (atEnd || character === ",") {
      segments.push({
        raw: raw.slice(start, index),
        start: span.start + start,
        end: span.start + index,
        commaBefore,
      });
      if (!atEnd) {
        commaBefore = span.start + index;
        start = index + 1;
      }
    }
  }

  return segments;
}

/** Trimmed content offsets inside a raw segment, or `undefined` when empty. */
function trimBounds(
  segment: RawSegment,
): { readonly start: number; readonly end: number } | undefined {
  const leading = segment.raw.length - segment.raw.trimStart().length;
  const trailing = segment.raw.length - segment.raw.trimEnd().length;
  if (leading === segment.raw.length) return undefined;
  return { start: leading, end: segment.raw.length - trailing };
}

/** A non-empty span at the gap an empty item leaves (the comma when possible). */
function emptyItemSpan(segment: RawSegment, file: string): Span {
  const start = segment.commaBefore >= 0 ? segment.commaBefore : segment.start;
  return { start, end: Math.max(start + 1, segment.end), file };
}
