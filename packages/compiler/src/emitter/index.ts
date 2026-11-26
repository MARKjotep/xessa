import type {
  AtRuleContextIr,
  DeclarationIr,
  MediaConditionIr,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
import { flattenSelector } from "../selectors/index.js";
import {
  generateSourceMap,
  offsetToLineColumn,
  serializeSourceMap,
  sourceMapComment,
} from "../sourcemaps/index.js";
import type { SourceMapping } from "../sourcemaps/index.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";

/**
 * Deterministic CSS text emission from the lowered stylesheet IR
 * (SPECIFICATION.md §9 `minify`, §5 cascade contract).
 *
 * The emitter is pure: it never reads the filesystem, never mutates the IR and
 * never throws. It emits nodes in IR order, never reorders, merges or
 * deduplicates declarations, and never propagates `!important`: the raw
 * `DeclarationIr.value` already contains the authored `!important` text
 * (ADR-0003), so appending the flag would duplicate it.
 *
 * Formatting conventions:
 *
 * - Pretty mode uses two-space indentation, one declaration per line with a
 *   trailing `;` on every declaration, and one blank line between sibling
 *   rules or at-rules. The stylesheet ends with one `\n`.
 * - `minify: true` compacts only structural whitespace (indentation, newlines,
 *   the space after `:` and spaces around braces). Selector text, declaration
 *   values, quoted strings, `url(...)`, `calc(...)` internals and at-rule
 *   preludes are emitted exactly as they appear in the IR. The output is
 *   therefore the pretty output with structural whitespace removed.
 * - Output uses `\n` for structural newlines on every platform; CRLF or other
 *   bytes inside raw IR values are emitted unchanged.
 *
 * Native wrappers: a {@link NativeBlockIr} emits its own at-rule once, and
 * child rules pass the already-emitted wrapper chain so their `context` is not
 * emitted a second time. For a rule whose context is not represented by an
 * ancestor native block (normal lowering always represents it), the remaining
 * media contexts and the resolved Xessa condition are ANDed into one `@media`
 * wrapper when the parts can form a valid single query (plain conditions plus
 * at most one media type, which is placed first); `not`, comma lists and
 * top-level `or` nest as separate wrappers. Non-media contexts nest outside the
 * media wrapper (SPECIFICATION.md §3.5).
 */

/** Emitter options; `minify` is the opt-in compact output flag from §9. */
export interface EmitOptions {
  /** Compact structural whitespace only; authored tokens are preserved. */
  readonly minify: boolean;
  /** When present, emit a standard v3 source map and the trailing URL comment. */
  readonly sourceMap?: EmitSourceMapOptions;
}

/**
 * Source-map emission options.
 *
 * `file` is the **planned CSS output basename** (for example `button.css`), not
 * the map path: the trailing comment becomes
 * `/*# sourceMappingURL=button.css.map *&#47;` and the v3 `file` field records
 * the CSS basename. `sourceText` supplies the authored text a span belongs to
 * so UTF-16 offsets can become one-based line/column pairs; spans carry no
 * source copy. Sources whose text is unavailable are skipped (their mappings
 * are dropped, never guessed).
 */
export interface EmitSourceMapOptions {
  /** Planned CSS output basename, for example `button.css`. */
  readonly file: string;
  /** Authored text lookup keyed by a span's file path (absolute in pipeline IR). */
  readonly sourceText: (file: string) => string | undefined;
  /**
   * Optional normalization from a span's `file` to the map `sources` entry.
   * Pipeline spans carry canonical absolute paths; pass a workspace-relative
   * POSIX projection here to satisfy §6 and keep maps portable.
   */
  readonly sourcePath?: (file: string) => string;
  /** Optional `sourceRoot` applied by consumers that relocate sources. */
  readonly sourceRoot?: string;
  /** Include `sourcesContent` (default `false`) so maps are self-contained. */
  readonly includeSourcesContent?: boolean;
}

/** Emitted CSS plus any structural diagnostics. */
export interface EmitResult {
  /** Complete stylesheet text; empty when nothing emitted. */
  readonly css: string;
  /** Serialized v3 source map when `sourceMap` was requested. */
  readonly map?: string;
  /** XESSA1001 diagnostics for rejected selectors and invalid declarations. */
  readonly diagnostics: readonly Diagnostic[];
}

/** One deferred mapping: the authored span recorded at a marker. */
interface DeferredMapping {
  readonly span: Span;
}

/**
 * Mutable marker bookkeeping used only while a source map is requested.
 *
 * Instead of threading a writer through every recursive renderer, the emitter
 * inserts a zero-width NUL-delimited marker at each mapped position. Markers
 * contain no newline, so indentation, joining and minification are unchanged;
 * after the final text is assembled, {@link resolveMappings} replaces each
 * marker with nothing while recording its real generated line/column. With
 * source maps OFF no marker is ever inserted and output is byte-identical.
 */
interface MarkState {
  readonly marks: DeferredMapping[];
  readonly sourceText: (file: string) => string | undefined;
  readonly sourcePath: (file: string) => string;
}

/** Return the marker for one mapped span, or an empty string when maps are off. */
function mark(state: MarkState | undefined, span: Span): string {
  if (state === undefined) return "";
  const id = state.marks.length;
  state.marks.push({ span });
  return `\u0000${id}\u0000`;
}

/** Text with markers removed plus the mappings resolved at their real positions. */
interface ResolvedBody {
  readonly text: string;
  readonly mappings: readonly SourceMapping[];
  readonly content: Readonly<Record<string, string>>;
}

/** Replace markers with nothing, recording generated and authored positions. */
function resolveMappings(body: string, state: MarkState): ResolvedBody {
  let text = "";
  let generatedLine = 0;
  let generatedColumn = 0;
  let index = 0;
  const mappings: SourceMapping[] = [];
  const content: Record<string, string> = {};

  while (index < body.length) {
    const character = body.charAt(index);
    if (character === "\u0000") {
      const close = body.indexOf("\u0000", index + 1);
      if (close < 0) {
        text += character;
        index += 1;
        continue;
      }
      const id = Number(body.slice(index + 1, close));
      const entry = state.marks[id];
      if (entry !== undefined) {
        const sourceText = state.sourceText(entry.span.file);
        if (sourceText !== undefined) {
          const source = state.sourcePath(entry.span.file);
          const position = offsetToLineColumn(sourceText, entry.span.start);
          mappings.push({
            generatedLine,
            generatedColumn,
            source,
            sourceLine: position.line - 1,
            sourceColumn: position.column - 1,
          });
          content[source] = sourceText;
        }
      }
      index = close + 1;
      continue;
    }
    text += character;
    if (character === "\n") {
      generatedLine += 1;
      generatedColumn = 0;
    } else {
      generatedColumn += 1;
    }
    index += 1;
  }

  return { text, mappings, content };
}

/** One validated declaration ready for formatting. */
interface RenderedDeclaration {
  readonly property: string;
  readonly value: string;
  /** Origin of the authored value segment, used for source-map mappings. */
  readonly span: Span;
}

/** A rendered child inside a native at-rule block. */
interface RenderedChild {
  readonly kind: "declaration" | "block";
  readonly text: string;
}

/** A native wrapper that has already been emitted by an ancestor block. */
interface EmittedAtRule {
  readonly name: string;
  readonly prelude: string;
}

/** Media composition state for one rule. */
interface MediaParts {
  readonly media: readonly EmittedAtRule[];
  readonly other: readonly EmittedAtRule[];
}

function indent(text: string, levels: number): string {
  const padding = "  ".repeat(levels);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : padding + line))
    .join("\n");
}

function atRuleHeader(name: string, prelude: string): string {
  const trimmed = prelude.trim();
  return trimmed.length === 0 ? `@${name}` : `@${name} ${trimmed}`;
}

/** Structural whitespace flags of one media prelude. */
interface MediaFlags {
  readonly comma: boolean;
  readonly or: boolean;
}

/** Scan a media prelude for top-level commas and the `or` keyword. */
function mediaFlags(text: string): MediaFlags {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let inComment = false;
  let escaped = false;
  let comma = false;
  let or = false;

  const isNameCharacter = (character: string): boolean =>
    character !== "" && /[A-Za-z0-9_-]/.test(character);

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (inComment) {
      if (character === "*" && text.charAt(index + 1) === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "/" && text.charAt(index + 1) === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;

    if (character === ",") comma = true;
    if (character === "o" || character === "O") {
      const word = text.slice(index, index + 2).toLowerCase();
      const before = text.charAt(index - 1);
      const after = text.charAt(index + 2);
      if (word === "or" && !isNameCharacter(before) && !isNameCharacter(after)) {
        or = true;
      }
    }
  }

  return { comma, or };
}

/**
 * Combine media parts with `and` when the result is valid and meaning-preserving.
 *
 * A plain parenthesized condition can always be ANDed. A single media type (or
 * `only <type>`) may join too and is placed first, because media query grammar
 * requires the media type at the start; AND is commutative so this is a query
 * normalization, not declaration reordering. `not`, comma lists and top-level
 * `or` return `null` so the caller nests separate wrappers instead
 * (SPECIFICATION.md §4.3: native media lists pass through unchanged).
 */
function combineMediaParts(parts: readonly string[]): string | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;

  let mediaType: string | null = null;
  let hasOnly = false;
  const conditions: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") return null;
    const flags = mediaFlags(trimmed);
    if (flags.comma || flags.or) return null;
    if (/^not\s/i.test(trimmed)) return null;

    const onlyMatch = /^only\s+/i.exec(trimmed);
    if (onlyMatch !== null) {
      if (hasOnly || mediaType !== null) return null;
      hasOnly = true;
      mediaType = trimmed.slice(onlyMatch[0].length).trim();
      continue;
    }

    if (trimmed.startsWith("(")) {
      conditions.push(trimmed);
      continue;
    }

    if (/^[A-Za-z][A-Za-z0-9-]*(?:\s|$)/.test(trimmed)) {
      if (mediaType !== null) return null;
      mediaType = trimmed;
      continue;
    }

    return null;
  }

  const pieces: string[] = [];
  if (mediaType !== null) pieces.push(`${hasOnly ? "only " : ""}${mediaType}`);
  pieces.push(...conditions);
  return pieces.join(" and ");
}

function effectiveDeclarations(
  declarations: readonly DeclarationIr[],
  diagnostics: Diagnostic[],
): readonly RenderedDeclaration[] {
  const rendered: RenderedDeclaration[] = [];
  for (const declaration of declarations) {
    if (declaration.property.trim().length === 0) {
      diagnostics.push(
        error(
          "XESSA1001",
          "Empty declaration property: the declaration was omitted.",
          declaration.span,
        ),
      );
      continue;
    }
    if (declaration.value.trim().length === 0) {
      diagnostics.push(
        error(
          "XESSA1001",
          `Empty declaration value for "${declaration.property}": inline variants require a base value (SPECIFICATION.md §3.1); the declaration was omitted.`,
          declaration.span,
        ),
      );
      continue;
    }
    rendered.push({
      property: declaration.property,
      value: declaration.value,
      span: declaration.span,
    });
  }
  return rendered;
}

function renderRuleBlock(
  selector: string,
  selectorSpan: Span,
  declarations: readonly RenderedDeclaration[],
  minify: boolean,
  marks: MarkState | undefined,
): string {
  const markedSelector = `${mark(marks, selectorSpan)}${selector}`;
  if (minify) {
    const body = declarations
      .map(
        (declaration) =>
          `${mark(marks, declaration.span)}${declaration.property}:${declaration.value};`,
      )
      .join("");
    return `${markedSelector}{${body}}`;
  }
  const body = declarations
    .map(
      (declaration) =>
        `  ${mark(marks, declaration.span)}${declaration.property}: ${declaration.value};`,
    )
    .join("\n");
  return `${markedSelector} {\n${body}\n}`;
}

function renderDeclaration(
  declaration: RenderedDeclaration,
  minify: boolean,
  marks: MarkState | undefined,
): string {
  const marker = mark(marks, declaration.span);
  return minify
    ? `${marker}${declaration.property}:${declaration.value};`
    : `${marker}${declaration.property}: ${declaration.value};`;
}

function wrapAtRule(name: string, prelude: string, inner: string, minify: boolean): string {
  const header = atRuleHeader(name, prelude);
  return minify ? `${header}{${inner}}` : `${header} {\n${indent(inner, 1)}\n}`;
}

function pendingContext(
  context: readonly AtRuleContextIr[],
  emitted: readonly EmittedAtRule[],
): readonly AtRuleContextIr[] {
  let prefix = 0;
  while (prefix < emitted.length && prefix < context.length) {
    const emittedEntry = emitted[prefix];
    const contextEntry = context[prefix];
    if (
      emittedEntry === undefined ||
      contextEntry === undefined ||
      emittedEntry.name !== contextEntry.name ||
      emittedEntry.prelude !== contextEntry.prelude
    ) {
      break;
    }
    prefix += 1;
  }
  return context.slice(prefix);
}

function splitMediaContexts(context: readonly AtRuleContextIr[]): MediaParts {
  const media: EmittedAtRule[] = [];
  const other: EmittedAtRule[] = [];
  for (const entry of context) {
    const wrapper = { name: entry.name, prelude: entry.prelude };
    if (entry.name.toLowerCase() === "media") {
      media.push(wrapper);
    } else {
      other.push(wrapper);
    }
  }
  return { media, other };
}

function wrapRule(
  block: string,
  context: readonly AtRuleContextIr[],
  condition: MediaConditionIr | null,
  emitted: readonly EmittedAtRule[],
  minify: boolean,
): string {
  const pending = splitMediaContexts(pendingContext(context, emitted));
  const parts: string[] = pending.media.map((entry) => entry.prelude);
  if (condition !== null) parts.push(condition.query);

  let content = block;
  if (parts.length > 0) {
    const combined = combineMediaParts(parts);
    if (combined !== null) {
      content = wrapAtRule("media", combined, content, minify);
    } else {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part === undefined) continue;
        content = wrapAtRule("media", part, content, minify);
      }
    }
  }

  for (let index = pending.other.length - 1; index >= 0; index -= 1) {
    const entry = pending.other[index];
    if (entry === undefined) continue;
    content = wrapAtRule(entry.name, entry.prelude, content, minify);
  }

  return content;
}

function renderRule(
  rule: RuleIr,
  minify: boolean,
  diagnostics: Diagnostic[],
  emitted: readonly EmittedAtRule[],
  marks: MarkState | undefined,
): string | null {
  const flattened = flattenSelector(rule.selector, rule.ancestors);
  if (!flattened.ok) {
    diagnostics.push(
      error(
        "XESSA1001",
        `Cannot flatten selector "${rule.selector}": ${flattened.reason}`,
        rule.span,
      ),
    );
    return null;
  }

  const declarations = effectiveDeclarations(rule.declarations, diagnostics);
  if (declarations.length === 0) return null;

  const block = renderRuleBlock(flattened.selector, rule.span, declarations, minify, marks);
  return wrapRule(block, rule.context, rule.condition, emitted, minify);
}

function joinRenderedChildren(children: readonly RenderedChild[]): string {
  let output = "";
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    if (index > 0) {
      const previous = children[index - 1];
      const bothDeclarations =
        previous !== undefined && previous.kind === "declaration" && child.kind === "declaration";
      output += bothDeclarations ? "\n" : "\n\n";
    }
    output += child.text;
  }
  return output;
}

function renderNativeBlock(
  block: NativeBlockIr,
  minify: boolean,
  diagnostics: Diagnostic[],
  emitted: readonly EmittedAtRule[],
  marks: MarkState | undefined,
): string {
  const header = atRuleHeader(block.name, block.prelude);
  if (block.statement === true) return `${header};`;

  const emittedHere: readonly EmittedAtRule[] = [
    ...emitted,
    { name: block.name, prelude: block.prelude },
  ];
  const children: RenderedChild[] = [];

  for (const child of block.children) {
    if ("children" in child) {
      children.push({
        kind: "block",
        text: renderNativeBlock(child, minify, diagnostics, emittedHere, marks),
      });
      continue;
    }
    if ("declarations" in child) {
      const text = renderRule(child, minify, diagnostics, emittedHere, marks);
      if (text !== null) children.push({ kind: "block", text });
      continue;
    }
    const declarations = effectiveDeclarations([child], diagnostics);
    const declaration = declarations[0];
    if (declaration !== undefined) {
      children.push({ kind: "declaration", text: renderDeclaration(declaration, minify, marks) });
    }
  }

  if (children.length === 0) return minify ? `${header}{}` : `${header} {}`;
  if (minify) return `${header}{${children.map((child) => child.text).join("")}}`;
  return `${header} {\n${indent(joinRenderedChildren(children), 1)}\n}`;
}

function renderTopLevel(
  nodes: readonly (RuleIr | NativeBlockIr)[],
  minify: boolean,
  diagnostics: Diagnostic[],
  emitted: readonly EmittedAtRule[],
  marks: MarkState | undefined,
): string {
  const rendered: string[] = [];
  for (const node of nodes) {
    const text =
      "declarations" in node
        ? renderRule(node, minify, diagnostics, emitted, marks)
        : renderNativeBlock(node, minify, diagnostics, emitted, marks);
    if (text !== null) rendered.push(text);
  }
  return minify ? rendered.join("") : rendered.join("\n\n");
}

/**
 * Emit a stylesheet IR as CSS text.
 *
 * Pure and deterministic: identical IR and options produce byte-identical
 * output on every platform. Rules whose selector cannot be flattened or whose
 * only declarations are structurally invalid are omitted with XESSA1001
 * diagnostics; valid rules keep authored declaration order, selectors,
 * conditions and native wrapper order. `minify` defaults to `false`.
 *
 * Source maps are opt-in through `sourceMap`; when active the emitted CSS gains
 * a trailing `/*# sourceMappingURL=… *&#47;` comment and `map` carries the v3
 * JSON text. Mapping granularity is one entry per emitted rule selector and one
 * per emitted declaration property, both taken from the node's `Span` start;
 * minified output repositions every marker so the same generator stays correct.
 * With `sourceMap` unset, output bytes and diagnostics are unchanged.
 */
export function emitCss(ir: StylesheetIr, options: Partial<EmitOptions> = {}): EmitResult {
  const minify = options.minify === true;
  const sourceMap = options.sourceMap;
  const diagnostics: Diagnostic[] = [];
  const marks: MarkState | undefined =
    sourceMap === undefined
      ? undefined
      : {
          marks: [],
          sourceText: sourceMap.sourceText,
          sourcePath: sourceMap.sourcePath ?? ((file) => file),
        };
  const body = renderTopLevel(ir.rules, minify, diagnostics, [], marks);
  const resolved = marks === undefined ? undefined : resolveMappings(body, marks);

  const text = resolved === undefined ? body : resolved.text;
  let css = text.length === 0 ? "" : minify ? text : `${text}\n`;

  if (sourceMap === undefined || resolved === undefined) {
    return { css, diagnostics: Object.freeze(diagnostics) };
  }

  const comment = sourceMapComment(sourceMap.file);
  css = css.length === 0 ? `${comment}\n` : `${css}${css.endsWith("\n") ? "" : "\n"}${comment}\n`;
  const map = generateSourceMap(resolved.mappings, {
    file: sourceMap.file,
    ...(sourceMap.sourceRoot === undefined ? {} : { sourceRoot: sourceMap.sourceRoot }),
    ...(sourceMap.includeSourcesContent === true ? { sourcesContent: resolved.content } : {}),
  });

  return {
    css,
    map: serializeSourceMap(map),
    diagnostics: Object.freeze(diagnostics),
  };
}
