/**
 * Pure document analysis for the Xessa VS Code extension.
 *
 * Everything here works on plain `{ text, path, version }` input and never
 * imports the `vscode` module, so `bun test` exercises the exact logic the
 * extension host uses. The compiler is reached only through its public barrel
 * (`parse`, `compile`), and every failure path is contained: a malformed
 * document or a failed compile degrades to parse-only analysis instead of
 * throwing into the editor.
 */

import { compile, parse } from "../../compiler/src/index.js";
import type {
  BlockItem,
  ConditionalBlock,
  Declaration,
  Diagnostic,
  MediaGroupingMode,
  NativeAtRule,
  OutputOptions,
  Rule,
  Stylesheet,
  StylesheetItem,
  TokenDeclaration,
  UseImport,
} from "../../compiler/src/index.js";
import type { GroupVisibility } from "./groups.js";
import { collectGroupVisibility } from "./groups.js";
import type { KeyframeVisibility } from "./keyframes.js";
import { collectKeyframeVisibility } from "./keyframes.js";
import { dirnamePath, joinPath } from "./paths.js";
import type { Position, Range } from "./positions.js";
import { computeLineStarts, positionAt, rangeAt } from "./positions.js";

export { computeLineStarts, positionAt, rangeAt } from "./positions.js";
export type { Position, Range } from "./positions.js";

/** Plain document input shared with the extension host shell. */
export interface SourceText {
  readonly text: string;
  /** Absolute platform path of the document (also the default span label). */
  readonly path: string;
  /** Monotonic document version used for stale-result discarding. */
  readonly version: number;
  /** Optional span label override (workspace-relative POSIX path). */
  readonly file?: string;
}

/** `@setup` keys of SPECIFICATION.md §4, in documentation order. */
export const SETUP_KEYS: readonly string[] = Object.freeze([
  "prefix",
  "css-dir",
  "css-name",
  "map-dir",
  "map-name",
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "module",
  "media-grouping",
]);

/** Boolean `@setup` keys, the only ones whose values complete to `true`/`false`. */
export const BOOLEAN_SETUP_KEYS: readonly string[] = Object.freeze([
  "emit-css",
  "emit-map",
  "map-types",
  "emit-types",
  "source-map",
  "minify",
  "module",
]);

/**
 * Built-in media aliases (SPECIFICATION.md §3.2).
 *
 * The compiler barrel does not export its frozen built-in table, so the editor
 * mirrors it here. The resolver layer remains authoritative; this table only
 * powers completion and hover detail for aliases that are always available.
 */
export const BUILTIN_MEDIA_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  smd: "(min-width: 624px)",
  sm: "(min-width: 640px)",
  md: "(min-width: 768px)",
  lg: "(min-width: 1024px)",
  xl: "(min-width: 1280px)",
  "2xl": "(min-width: 1536px)",
  dark: "(prefers-color-scheme: dark)",
  light: "(prefers-color-scheme: light)",
  portrait: "(orientation: portrait)",
  landscape: "(orientation: landscape)",
  screen: "screen",
  print: "print",
  reduced: "(prefers-reduced-motion: reduce)",
  // `no_hover` and `mobile` intentionally share the coarse-pointer condition.
  no_hover: "(pointer: coarse)",
  mobile: "(pointer: coarse)",
});

/** Layer a media alias definition came from; later layers win by key. */
export type MediaAliasLayer = "builtin" | "project" | "document";

/** One resolved media alias. */
export interface MediaAlias {
  readonly name: string;
  readonly condition: string;
  readonly layer: MediaAliasLayer;
  /** Range of the alias name for document definitions; absent for built-ins. */
  readonly range?: Range;
}

/** Severity mirror of the compiler contract. */
export type ProblemSeverity = "error" | "warning";

/** Editor-facing diagnostic with both compiler code and editor range. */
export interface AnalysisProblem {
  readonly code: string;
  readonly severity: ProblemSeverity;
  readonly message: string;
  /** Span label of the originating file (imported-module problems differ). */
  readonly file: string;
  readonly range: Range;
  readonly source: "parse" | "compile";
}

/** Compile-time or runtime token symbol. */
export interface TokenSymbol {
  /** Token name without the `$` sigil. */
  readonly name: string;
  /** Namespace alias for imported members (`layout` in `$layout.spacing`). */
  readonly namespace?: string;
  readonly kind: "compile" | "runtime";
  /** Raw authored base value. */
  readonly value: string;
  /** Inline variant segments for runtime tokens. */
  readonly variants: readonly TokenVariant[];
  /** Range of the declaration name. */
  readonly declaration: Range;
  /** Span label of the declaring file (absolute or workspace-relative POSIX). */
  readonly file: string;
}

/** One runtime token variant (`@dark #60a5fa`). */
export interface TokenVariant {
  readonly aliases: readonly string[];
  readonly value: string;
}

/** One `@use` import with the tokens its module defines. */
export interface ImportedModule {
  readonly specifier: string;
  readonly alias?: string;
  /** Absolute resolved module path used for definition jumps and reads. */
  readonly path: string;
  readonly tokens: readonly TokenSymbol[];
}

/** One authored `@setup` key/value pair. */
export interface SetupSetting {
  readonly key: string;
  readonly value: string;
  readonly range: Range;
}

/** One class token inside a selector, with its generated (prefixed) name. */
export interface ClassOccurrence {
  readonly name: string;
  readonly generated: string;
  readonly global: boolean;
  readonly range: Range;
  readonly selector: string;
}

/** One hex color found in a declaration value. */
export interface ColorOccurrence {
  readonly value: string;
  readonly range: Range;
}

/** Result of the synchronous part of document analysis. */
export interface AnalyzeResult {
  /** Span label of the document (workspace-relative POSIX path by default). */
  readonly file: string;
  /** Absolute document path used as the module identity for group resolution. */
  readonly path: string;
  readonly version: number;
  readonly lineStarts: readonly number[];
  readonly ast: Stylesheet;
  readonly problems: readonly AnalysisProblem[];
  readonly mediaAliases: readonly MediaAlias[];
  readonly tokens: readonly TokenSymbol[];
  readonly imports: readonly ImportedModule[];
  /** Groups visible from this document with the compiler's resolution rule. */
  readonly groups: readonly GroupVisibility[];
  /** `@keyframes` names visible to `$keyframes.<name>` (ADR-0015). */
  readonly keyframes: readonly KeyframeVisibility[];
  readonly settings: readonly SetupSetting[];
  /** Effective class prefix after strategy and `@setup` precedence. */
  readonly prefix: string;
  readonly classes: readonly ClassOccurrence[];
  readonly colors: readonly ColorOccurrence[];
}

/** Compile artifacts and semantic problems for one document. */
export interface CompileSummary {
  readonly css?: string;
  readonly js?: string;
  readonly types?: string;
  readonly classes: Readonly<Record<string, string>>;
  readonly dependencies: readonly string[];
  readonly problems: readonly AnalysisProblem[];
  /** Present when the compiler threw; the document keeps parse diagnostics. */
  readonly error?: string;
}

/** Combined analysis + optional compile summary consumed by the providers. */
export interface DocumentState {
  readonly analysis: AnalyzeResult;
  readonly compiled?: CompileSummary;
}

/** Options for {@link analyzeText} and {@link analyzeDocument}. */
export interface AnalyzeOptions {
  /** Project-level media aliases (`xessa.config.json` `media`). */
  readonly media?: Readonly<Record<string, string>>;
  /** Project-level class prefix (`classes.prefix`). */
  readonly prefix?: string;
  /** Project-level naming strategy; `none` disables prefixing. */
  readonly namingStrategy?: "prefix" | "none";
  /** Sync module reader used for `$ns.member` completion, hover and definition. */
  readonly readModule?: (absolutePath: string) => string | undefined;
  /** Absolute workspace root passed to `compile`. Defaults to the document directory. */
  readonly workspaceRoot?: string;
  /** Project output settings passed to `compile` so generated imports match the CLI. */
  readonly output?: OutputOptions;
  /** Project-level media grouping (`compiler.mediaGrouping`); file `@setup` still wins. */
  readonly mediaGrouping?: MediaGroupingMode;
  /** Run `compile` after parsing. Default `true`. */
  readonly compile?: boolean;
}

/**
 * Build the merged media alias table: built-ins, then project configuration,
 * then file `@media-types` (last definition per key wins, ADR-0006).
 */
export function resolveMediaAliases(
  ast: Stylesheet,
  lineStarts: readonly number[],
  project?: Readonly<Record<string, string>>,
): readonly MediaAlias[] {
  const aliases = new Map<string, MediaAlias>();
  for (const [name, condition] of Object.entries(BUILTIN_MEDIA_ALIASES)) {
    aliases.set(name, { name, condition, layer: "builtin" });
  }
  if (project !== undefined) {
    for (const [name, condition] of Object.entries(project)) {
      aliases.set(name, { name, condition, layer: "project" });
    }
  }
  for (const item of ast.items) {
    if (item.kind !== "media-types") continue;
    for (const alias of item.aliases) {
      aliases.set(alias.name, {
        name: alias.name,
        condition: alias.media,
        layer: "document",
        range: rangeAt(lineStarts, alias.span.start, alias.span.start + alias.name.length),
      });
    }
  }
  return [...aliases.values()];
}

/** Effective prefix for a document: file `@setup` then project config then empty. */
export function resolvePrefix(
  ast: Stylesheet,
  projectPrefix: string | undefined,
  strategy: "prefix" | "none" | undefined,
): string {
  if ((strategy ?? "prefix") === "none") return "";
  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      if (setting.key === "prefix") return unquote(setting.value);
    }
  }
  return projectPrefix ?? "";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Collect every `@setup` key/value pair with its key range. */
function collectSettings(ast: Stylesheet, lineStarts: readonly number[]): readonly SetupSetting[] {
  const settings: SetupSetting[] = [];
  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      settings.push({
        key: setting.key,
        value: unquote(setting.value),
        range: rangeAt(lineStarts, setting.span.start, setting.span.start + setting.key.length),
      });
    }
  }
  return settings;
}

/** Walk every declaration in a stylesheet, including nested and conditional bodies. */
export function forEachDeclaration(
  ast: Stylesheet,
  visit: (declaration: Declaration) => void,
): void {
  const walkItems = (items: readonly (StylesheetItem | BlockItem)[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "declaration":
          visit(item);
          break;
        case "rule":
          walkItems(item.body);
          break;
        case "conditional-block":
          walkItems(item.body);
          break;
        case "runtime":
          for (const declaration of item.declarations) visit(declaration);
          break;
        // `@group.<name>` bodies hold declarations only, at authored spans, so
        // `$token` references inside a definition or a use site behave exactly
        // like the same reference in a rule body (CSSX-U05).
        case "group-definition":
        case "group-use-site":
          for (const declaration of item.declarations) visit(declaration);
          break;
        case "native-at-rule":
          if (item.block !== undefined) walkItems(item.block);
          break;
        default:
          break;
      }
    }
  };
  walkItems(ast.items);
}

/** One raw value slice with its absolute source offset. */
export interface ValueSegment {
  readonly text: string;
  readonly start: number;
  readonly aliases?: readonly string[];
}

/** Skip spaces, tabs, carriage returns and newlines. */
function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") index += 1;
    else break;
  }
  return index;
}

/** Find `needle` at or after `from` without searching past `limit`. */
function locate(text: string, needle: string, from: number, limit: number): number {
  if (needle.length === 0) return -1;
  const direct = text.startsWith(needle, from) ? from : -1;
  if (direct >= 0) return direct;
  const index = text.indexOf(needle, from);
  if (index < 0 || index + needle.length > limit) return -1;
  return index;
}

/**
 * Split one declaration into its base value and inline variant segments using
 * parser spans only. The offsets recovered here are the exact authored value
 * slices, so `$` references and hex colors are located without regexes.
 */
export function declarationSegments(
  text: string,
  declaration: Declaration,
): readonly ValueSegment[] {
  const segments: ValueSegment[] = [];
  let cursor = declaration.span.start + declaration.property.length;
  while (cursor < declaration.span.end && text.charAt(cursor) !== ":") cursor += 1;
  cursor = skipWhitespace(text, cursor + 1);
  const baseStart = locate(text, declaration.value, cursor, declaration.span.end);
  if (baseStart >= 0) segments.push({ text: declaration.value, start: baseStart });
  for (const variant of declaration.variants) {
    const valueStart = locate(text, variant.value, variant.span.end, declaration.span.end);
    if (valueStart >= 0) {
      segments.push({ text: variant.value, start: valueStart, aliases: variant.aliases });
    }
  }
  return segments;
}

/** Value segment of one `@variables` token declaration. */
export function tokenDeclarationSegment(
  text: string,
  declaration: TokenDeclaration,
): ValueSegment | undefined {
  const from = declaration.span.start + declaration.name.length;
  const start = locate(text, declaration.value, from, declaration.span.end);
  return start < 0 ? undefined : { text: declaration.value, start };
}

/** One `$` reference with its absolute source range. */
export interface TokenReference {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly name: string;
  readonly namespace?: string;
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

/** Whether `text` at `index` starts a `url(` token (case-insensitive). */
function isUrlStart(text: string, index: number): boolean {
  if (index > 0 && isIdentifierPart(text[index - 1])) return false;
  return text.slice(index, index + 4).toLowerCase() === "url(";
}

/**
 * Scan one raw value slice for `$name` / `$ns.member` references.
 *
 * Quoted strings, comments and `url(...)` contents are skipped so a literal
 * `"$gap"` or `url("a$b.png")` is never reported as a reference. The scanner
 * is plain character logic (no regular expressions) and returns exact offsets.
 */
export function tokenReferencesInSegment(
  text: string,
  absoluteStart: number,
  options: { skipUrls?: boolean } = {},
): readonly TokenReference[] {
  const references: TokenReference[] = [];
  const skipUrls = options.skipUrls !== false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close < 0 ? text.length : close + 2;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (skipUrls && isUrlStart(text, index)) {
      index = skipParentheses(text, index + 3);
      continue;
    }
    if (char === "$" && isIdentifierStart(text[index + 1])) {
      let end = index + 2;
      while (isIdentifierPart(text[end])) end += 1;
      let name = text.slice(index + 1, end);
      let namespace: string | undefined;
      if (text[end] === "." && isIdentifierStart(text[end + 1])) {
        let memberEnd = end + 2;
        while (isIdentifierPart(text[memberEnd])) memberEnd += 1;
        namespace = name;
        name = text.slice(end + 1, memberEnd);
        end = memberEnd;
      }
      references.push({
        start: absoluteStart + index,
        end: absoluteStart + end,
        text: text.slice(index, end),
        name,
        ...(namespace === undefined ? {} : { namespace }),
      });
      index = end;
      continue;
    }
    index += 1;
  }
  return references;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

function skipParentheses(text: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth <= 0) return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/** Collect compile-time and runtime tokens defined in one stylesheet. */
function collectTokens(
  ast: Stylesheet,
  lineStarts: readonly number[],
  file: string,
  namespace: string | undefined,
): TokenSymbol[] {
  const tokens: TokenSymbol[] = [];
  for (const item of ast.items) {
    if (item.kind === "variables") {
      for (const token of item.tokens) {
        tokens.push({
          name: token.name,
          ...(namespace === undefined ? {} : { namespace }),
          kind: "compile",
          value: token.value,
          variants: [],
          declaration: rangeAt(lineStarts, token.span.start, token.span.start + token.name.length),
          file,
        });
      }
    }
    if (item.kind === "runtime") {
      for (const declaration of item.declarations) {
        tokens.push({
          name: declaration.property,
          ...(namespace === undefined ? {} : { namespace }),
          kind: "runtime",
          value: declaration.value,
          variants: declaration.variants.map((variant) => ({
            aliases: variant.aliases,
            value: variant.value,
          })),
          declaration: rangeAt(
            lineStarts,
            declaration.span.start,
            declaration.span.start + declaration.property.length,
          ),
          file,
        });
      }
    }
  }
  return tokens;
}

/**
 * Local token-name conflicts, mirroring the compiler's `collectLocalSymbols`.
 *
 * The single-file compile path currently keeps only the caller-facing parse
 * diagnostics, so a duplicate `@variables` key in a document without `@use` is
 * silent even though the compiler resolver reports XESSA2001 (CSSX-U04). This
 * walk reproduces the resolver's rule over the parsed AST so the editor
 * diagnoses the duplicate in both the module-graph and the single-file case.
 *
 * Messages, spans and the `file` label match `resolver/scopes.ts`. The walk is
 * only used for documents without `@use`: those never reach the resolver's
 * entry diagnostics through `compile()`, while a module graph already reports
 * the duplicate (and must not be reported twice).
 */
function collectTokenNameProblems(
  ast: Stylesheet,
  lineStarts: readonly number[],
  file: string,
): AnalysisProblem[] {
  const problems: AnalysisProblem[] = [];
  const compile = new Map<string, TokenDeclaration>();
  const runtime = new Map<string, Declaration>();

  const duplicate = (
    name: string,
    span: { readonly start: number; readonly end: number },
    label: "compile-time" | "runtime",
  ): void => {
    problems.push({
      code: "XESSA2001",
      severity: "error",
      message: `Duplicate local ${label} variable "$${name}" in "${file}".`,
      file,
      range: rangeAt(lineStarts, span.start, span.end),
      source: "compile",
    });
  };

  for (const item of ast.items) {
    if (item.kind === "variables") {
      for (const token of item.tokens) {
        if (compile.has(token.name)) duplicate(token.name, token.span, "compile-time");
        else compile.set(token.name, token);
      }
    } else if (item.kind === "runtime") {
      for (const declaration of item.declarations) {
        if (runtime.has(declaration.property)) {
          duplicate(declaration.property, declaration.span, "runtime");
        } else {
          runtime.set(declaration.property, declaration);
        }
      }
    }
  }

  // Compile-time and runtime declarations share the `$name` namespace; the
  // later declaration is XESSA2001 exactly as the compiler reports it.
  for (const [name, runtimeDeclaration] of runtime) {
    const compileDeclaration = compile.get(name);
    if (compileDeclaration === undefined) continue;
    const later =
      compileDeclaration.span.start <= runtimeDeclaration.span.start
        ? runtimeDeclaration.span
        : compileDeclaration.span;
    problems.push({
      code: "XESSA2001",
      severity: "error",
      message: `"$${name}" cannot be both a compile-time and a runtime variable in "${file}".`,
      file,
      range: rangeAt(lineStarts, later.start, later.end),
      source: "compile",
    });
  }

  return problems;
}

/** Whether two editor ranges cover the same text. */
function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

/**
 * A different local token that already declares `name`.
 *
 * Rename uses this to refuse a target name before building the
 * `WorkspaceEdit`: `analysis.tokens` holds the document's own compile-time and
 * runtime declarations (imported members stay in `analysis.imports`), and both
 * symbol spaces share the `$name` namespace. The symbol being renamed is
 * excluded, so renaming a token to its own name stays a no-op (CSSX-U04).
 */
export function tokenNameConflict(
  analysis: AnalyzeResult,
  name: string,
  renaming: TokenSymbol,
): TokenSymbol | undefined {
  return analysis.tokens.find(
    (token) => token.name === name && !sameRange(token.declaration, renaming.declaration),
  );
}

function moduleAlias(item: UseImport): string {
  if (item.alias !== undefined) return item.alias;
  const base = item.path.split("/").pop() ?? item.path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function collectImports(
  ast: Stylesheet,
  source: SourceText,
  options: AnalyzeOptions,
): readonly ImportedModule[] {
  const imports: ImportedModule[] = [];
  for (const item of ast.items) {
    if (item.kind !== "use") continue;
    const specifier = item.path;
    const alias = item.alias ?? moduleAlias(item);
    const absolute = joinPath(dirnamePath(source.path), specifier);
    let tokens: readonly TokenSymbol[] = [];
    if (options.readModule !== undefined) {
      let text: string | undefined;
      try {
        text = options.readModule(absolute);
      } catch {
        text = undefined;
      }
      if (text !== undefined) {
        const parsed = parse(text, { file: absolute });
        const lineStarts = computeLineStarts(text);
        tokens = collectTokens(parsed.ast, lineStarts, absolute, alias);
      }
    }
    imports.push({ specifier, alias, path: absolute, tokens });
  }
  return imports;
}

/** Class-token scanner result for one selector slice. */
interface SelectorScan {
  readonly classes: readonly { name: string; global: boolean; start: number; end: number }[];
}

/**
 * Scan one authored selector for class tokens.
 *
 * Attribute strings, escapes and `:global(...)` arguments are handled with
 * plain character logic: `:global(.icon)` is recorded as global and excluded
 * from renaming, and quoted attribute values are inert.
 */
export function scanSelector(selector: string): SelectorScan {
  const classes: { name: string; global: boolean; start: number; end: number }[] = [];
  let index = 0;
  let bracketDepth = 0;
  let globalDepth = 0;
  while (index < selector.length) {
    const char = selector[index] ?? "";
    if (char === '"' || char === "'") {
      index = skipString(selector, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }
    if (selector.startsWith(":global(", index)) {
      globalDepth += 1;
      index += ":global(".length;
      continue;
    }
    if (char === ")" && globalDepth > 0) {
      globalDepth -= 1;
      index += 1;
      continue;
    }
    if (char === "." && isIdentifierStart(selector[index + 1])) {
      let end = index + 2;
      while (isIdentifierPart(selector[end]) || selector[end] === "\\") {
        end += selector[end] === "\\" ? 2 : 1;
      }
      classes.push({
        name: selector.slice(index + 1, end),
        global: globalDepth > 0 || bracketDepth > 0,
        start: index + 1,
        end,
      });
      index = end;
      continue;
    }
    index += 1;
  }
  return { classes };
}

function collectClasses(
  ast: Stylesheet,
  lineStarts: readonly number[],
  prefix: string,
): readonly ClassOccurrence[] {
  const occurrences: ClassOccurrence[] = [];
  const visitRule = (rule: Rule): void => {
    for (const token of scanSelector(rule.selector).classes) {
      occurrences.push({
        name: token.name,
        generated: token.global || prefix === "" ? token.name : `${prefix}-${token.name}`,
        global: token.global,
        range: rangeAt(
          lineStarts,
          rule.selectorSpan.start + token.start,
          rule.selectorSpan.start + token.end,
        ),
        selector: rule.selector,
      });
    }
    walkBody(rule.body);
  };
  const walkBody = (items: readonly (BlockItem | ConditionalBlock | NativeAtRule)[]): void => {
    for (const item of items) {
      if (item.kind === "rule") visitRule(item);
      else if (item.kind === "conditional-block") walkBody(item.body);
      else if (item.kind === "native-at-rule" && item.block !== undefined) walkBody(item.block);
    }
  };
  for (const item of ast.items) {
    if (item.kind === "rule") visitRule(item);
  }
  return occurrences;
}

/** Hex colors authored in declaration values (`#rgb` through `#rrggbbaa`). */
function collectColors(
  ast: Stylesheet,
  lineStarts: readonly number[],
  text: string,
): readonly ColorOccurrence[] {
  const colors: ColorOccurrence[] = [];
  forEachDeclaration(ast, (declaration) => {
    for (const segment of declarationSegments(text, declaration)) {
      let index = 0;
      while (index < segment.text.length) {
        const char = segment.text[index];
        if (char === '"' || char === "'") {
          index = skipString(segment.text, index);
          continue;
        }
        if (char === "#") {
          let end = index + 1;
          while (end < segment.text.length && /[0-9A-Fa-f]/.test(segment.text[end] ?? "")) end += 1;
          const digits = end - index - 1;
          if (digits === 3 || digits === 4 || digits === 6 || digits === 8) {
            colors.push({
              value: segment.text.slice(index, end),
              range: rangeAt(lineStarts, segment.start + index, segment.start + end),
            });
          }
          index = end;
          continue;
        }
        index += 1;
      }
    }
  });
  return colors;
}

function toProblems(
  diagnostics: readonly Diagnostic[],
  lineStarts: readonly number[],
  source: "parse" | "compile",
): AnalysisProblem[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: diagnostic.span.file,
    range: rangeAt(lineStarts, diagnostic.span.start, diagnostic.span.end),
    source,
  }));
}

/** Run the synchronous part of analysis: parse, media aliases, tokens, classes, colors. */
export function analyzeText(source: SourceText, options: AnalyzeOptions = {}): AnalyzeResult {
  const lineStarts = computeLineStarts(source.text);
  const file = source.file ?? source.path;
  const parsed = parse(source.text, { file });
  const prefix = resolvePrefix(parsed.ast, options.prefix, options.namingStrategy);
  return {
    file,
    path: source.path,
    version: source.version,
    lineStarts,
    ast: parsed.ast,
    problems: [
      ...toProblems(parsed.diagnostics, lineStarts, "parse"),
      // The compiler already reports duplicate local names for a module graph
      // (`@use` present); this walk fills only the single-file gap (CSSX-U04).
      ...(parsed.ast.items.some((item) => item.kind === "use")
        ? []
        : collectTokenNameProblems(parsed.ast, lineStarts, file)),
    ],
    mediaAliases: resolveMediaAliases(parsed.ast, lineStarts, options.media),
    tokens: collectTokens(parsed.ast, lineStarts, file, undefined),
    imports: collectImports(parsed.ast, source, options),
    groups: collectGroupVisibility(
      { file: source.path, ast: parsed.ast, lineStarts },
      options.readModule,
    ),
    keyframes: collectKeyframeVisibility(
      { file: source.path, ast: parsed.ast, text: source.text, lineStarts },
      options.readModule,
    ),
    settings: collectSettings(parsed.ast, lineStarts),
    prefix,
    classes: collectClasses(parsed.ast, lineStarts, prefix),
    colors: collectColors(parsed.ast, lineStarts, source.text),
  };
}

/** Compile one document in memory; never throws. */
export async function compileSource(
  source: SourceText,
  options: AnalyzeOptions = {},
  effectivePrefix?: string,
): Promise<CompileSummary> {
  const workspaceRoot = options.workspaceRoot ?? dirnamePath(source.path);
  try {
    const result = await compile(source.text, {
      file: source.file ?? source.path,
      workspaceRoot,
      ...(options.media === undefined ? {} : { media: options.media }),
      ...(options.mediaGrouping === undefined ? {} : { mediaGrouping: options.mediaGrouping }),
      naming: { strategy: options.namingStrategy ?? "prefix" },
      ...(effectivePrefix === undefined ? {} : { prefix: effectivePrefix }),
      ...(options.output ?? {}),
    });
    const problems = result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: diagnostic.span.file,
      range: rangeAt(computeLineStarts(source.text), diagnostic.span.start, diagnostic.span.end),
      source: "compile" as const,
    }));
    return {
      ...(result.css === undefined ? {} : { css: result.css }),
      ...(result.js === undefined ? {} : { js: result.js }),
      ...(result.types === undefined ? {} : { types: result.types }),
      classes: result.classes,
      dependencies: result.dependencies,
      problems,
    };
  } catch (error) {
    return {
      classes: Object.freeze(Object.create(null)) as Readonly<Record<string, string>>,
      dependencies: [],
      problems: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function problemKey(problem: AnalysisProblem): string {
  return [
    problem.code,
    problem.file,
    problem.range.start.line,
    problem.range.start.character,
    problem.range.end.line,
    problem.range.end.character,
    problem.message,
  ].join("\u0000");
}

/**
 * Full document analysis: tolerant parse plus an in-memory compile whose
 * semantic diagnostics are merged after the parse diagnostics (deduplicated).
 */
export async function analyzeDocument(
  source: SourceText,
  options: AnalyzeOptions = {},
): Promise<DocumentState> {
  const analysis = analyzeText(source, options);
  if (options.compile === false) return { analysis };

  const compiled = await compileSource(source, options, analysis.prefix);
  const seen = new Set(analysis.problems.map(problemKey));
  const merged = [...analysis.problems];
  for (const problem of compiled.problems) {
    const key = problemKey(problem);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(problem);
  }
  return {
    analysis: { ...analysis, problems: merged },
    compiled,
  };
}

/** All `$` references in every declaration and token value of the document. */
export function collectTokenReferences(text: string, ast: Stylesheet): readonly TokenReference[] {
  const references: TokenReference[] = [];
  forEachDeclaration(ast, (declaration) => {
    for (const segment of declarationSegments(text, declaration)) {
      references.push(...tokenReferencesInSegment(segment.text, segment.start));
    }
  });
  for (const item of ast.items) {
    if (item.kind !== "variables") continue;
    for (const token of item.tokens) {
      const segment = tokenDeclarationSegment(text, token);
      if (segment === undefined) continue;
      references.push(...tokenReferencesInSegment(segment.text, segment.start));
    }
  }
  return references;
}
