/**
 * Canonical Xessa source formatter.
 *
 * The formatter is a pure `parse → print` pass with zero dependencies: it never
 * reads the filesystem, never mutates input and never throws. Values, aliases,
 * selectors and `!important` flags are printed from the AST's raw slices, so
 * formatting cannot change compilation semantics.
 *
 * Canonical style (documented for the CLI and the language service):
 *
 * - two-space indentation, one declaration per line, every declaration ends
 *   with `;`, and the file ends with a single `\n`;
 * - one blank line between top-level constructs, and inside a rule or at-rule
 *   block a blank line whenever either side is a nested rule/conditional block;
 * - inline variants stay on the declaration line (`padding: 12px @md 20px;`),
 *   and adjacent authored markers stay adjacent (`x: 1 @a@b 2;`) because
 *   `@a@b` and `@a @b` split into different variants;
 * - a directive entry keeps its authored `$` sigil (`$layout.margin: 4px;`), so
 *   a namespaced token declaration still reparses as the same declaration;
 * - a statement at-rule whose prelude leaves a `[` or `(` open prints without a
 *   terminator, because that `;` would be read back as prelude text and grow on
 *   every pass;
 * - directive blocks (`@setup`, `@variables`, `@runtime`, `@media-types`) hold
 *   one entry per line, and `@group.<name>` definitions and use sites print
 *   like other at-rule blocks with one declaration per line (ADR-0017);
 * - block comments are kept on their own lines, attached to the statement that
 *   follows them; comments embedded in values or selectors stay in the raw
 *   slice and are never duplicated;
 * - `@use` specifiers are re-emitted with double quotes (paths are opaque raw
 *   text; the AST does not retain the original quote character).
 *
 * Unparseable input is returned unchanged together with the parse diagnostics,
 * so a formatter run never destroys code. `format(format(x)) === format(x)` for
 * every accepted input.
 */

import { tokenize } from "../lexer/index.js";
import { parseTokens } from "../parser/index.js";
import type {
  AliasDeclaration,
  BlockItem,
  ConditionalBlock,
  ConditionalBlockItem,
  Declaration,
  GroupDefinition,
  GroupUseSite,
  MediaTypesBlock,
  NativeAtRule,
  Rule,
  RuntimeBlock,
  Setting,
  SetupBlock,
  Stylesheet,
  StylesheetItem,
  TokenDeclaration,
  UseImport,
  VariablesBlock,
} from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import type { Token } from "../types/token.js";

/** Result of formatting one source string. */
export interface FormatResult {
  /** Canonical source, or the original text when parsing reported an error. */
  readonly formatted: string;
  /** Parse diagnostics; errors leave `formatted` byte-identical to the input. */
  readonly diagnostics: readonly Diagnostic[];
}

/** A comment treated as free-standing rather than embedded in a raw slice. */
interface EmbeddedRange {
  readonly start: number;
  readonly end: number;
}

/** One printed statement chunk and whether it opens a nested block. */
interface Chunk {
  readonly lines: readonly string[];
  readonly block: boolean;
}

const INDENT = "  ";

function pad(level: number): string {
  return INDENT.repeat(level);
}

function itemStart(item: StylesheetItem): number {
  return item.kind === "rule" ? item.selectorSpan.start : item.span.start;
}

function blockItemStart(item: BlockItem | ConditionalBlockItem): number {
  if (item.kind === "rule") return item.selectorSpan.start;
  if (item.kind === "conditional-block") return item.variant.span.start;
  return item.span.start;
}

/** Range of a native at-rule header, whose prelude is printed verbatim. */
function nativeHeaderRange(item: NativeAtRule, tokens: readonly Token[]): EmbeddedRange {
  if (item.block === undefined) return { start: item.span.start, end: item.span.end };
  const first = item.block[0];
  const limit = first === undefined ? item.span.end : blockItemStart(first);
  // The header ends at the block's `{`, so comments after it stay free-standing.
  const open = tokens.find(
    (token) => token.kind === "lbrace" && token.start >= item.span.start && token.start < limit,
  );
  return { start: item.span.start, end: open?.start ?? limit };
}

/**
 * Collect comments that are already part of a printed raw slice.
 *
 * Declarations keep their authored value text (including an inline comment),
 * selectors keep their authored text, and directive entries keep raw values.
 * Those comments must not be printed a second time by the comment attachment
 * pass.
 */
function embeddedCommentRanges(
  ast: Stylesheet,
  tokens: readonly Token[],
): readonly EmbeddedRange[] {
  const ranges: EmbeddedRange[] = [];

  const visitDeclaration = (declaration: Declaration): void => {
    ranges.push({ start: declaration.span.start, end: declaration.span.end });
  };
  const visitItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "declaration":
          visitDeclaration(item);
          break;
        case "rule":
          ranges.push({ start: item.selectorSpan.start, end: item.selectorSpan.end });
          visitItems(item.body);
          break;
        case "conditional-block":
          visitConditional(item);
          break;
        case "native-at-rule":
          visitNative(item);
          break;
        case "group-use-site":
          for (const declaration of item.declarations) visitDeclaration(declaration);
          break;
      }
    }
  };
  const visitConditional = (block: ConditionalBlock): void => {
    for (const item of block.body) {
      if (item.kind === "declaration") visitDeclaration(item);
      else if (item.kind === "rule") {
        ranges.push({ start: item.selectorSpan.start, end: item.selectorSpan.end });
        visitItems(item.body);
      } else visitConditional(item);
    }
  };
  const visitNative = (item: NativeAtRule): void => {
    ranges.push(nativeHeaderRange(item, tokens));
    if (item.block !== undefined) visitItems(item.block);
  };

  for (const item of ast.items) {
    switch (item.kind) {
      case "setup":
        for (const setting of item.settings) ranges.push(setting.span);
        break;
      case "use":
        ranges.push(item.span);
        break;
      case "variables":
        for (const token of item.tokens) ranges.push(token.span);
        break;
      case "runtime":
        for (const declaration of item.declarations) visitDeclaration(declaration);
        break;
      case "media-types":
        for (const alias of item.aliases) ranges.push(alias.span);
        break;
      case "group-definition":
        for (const declaration of item.declarations) visitDeclaration(declaration);
        break;
      case "rule":
        ranges.push({ start: item.selectorSpan.start, end: item.selectorSpan.end });
        visitItems(item.body);
        break;
      case "native-at-rule":
        visitNative(item);
        break;
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

/** Stateful printer that consumes free-standing comments in source order. */
class Printer {
  private readonly comments: readonly Token[];
  private readonly embedded: readonly EmbeddedRange[];
  private readonly source: string;
  private readonly file: string;
  private commentIndex = 0;

  constructor(
    comments: readonly Token[],
    embedded: readonly EmbeddedRange[],
    source: string,
    file: string,
  ) {
    this.comments = comments;
    this.embedded = embedded;
    this.source = source;
    this.file = file;
  }

  /** Comments to print before `offset`, skipping any embedded in raw slices. */
  takeComments(offset: number, level: number): string[] {
    const lines: string[] = [];
    while (this.commentIndex < this.comments.length) {
      const token = this.comments[this.commentIndex];
      if (token === undefined || token.start >= offset) break;
      this.commentIndex += 1;
      if (this.isEmbedded(token)) continue;
      lines.push(...commentLines(token.value, level));
    }
    return lines;
  }

  /** Any comments left after the last statement, printed at the given level. */
  takeRest(level: number): string[] {
    return this.takeComments(Number.POSITIVE_INFINITY, level);
  }

  private isEmbedded(token: Token): boolean {
    for (const range of this.embedded) {
      if (range.start > token.start) return false;
      if (token.start >= range.start && token.end <= range.end) return true;
    }
    return false;
  }

  printStylesheet(ast: Stylesheet): string[] {
    const chunks: Chunk[] = [];
    for (const item of ast.items) {
      const comments = this.takeComments(itemStart(item), 0);
      const printed = this.printItem(item, 0);
      const lines = [...comments, ...(printed?.lines ?? [])];
      if (lines.length > 0) chunks.push({ lines, block: printed?.block ?? false });
    }
    const rest = this.takeRest(0);
    if (rest.length > 0) chunks.push({ lines: rest, block: false });

    const output: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk === undefined) continue;
      if (index > 0) output.push("");
      output.push(...chunk.lines);
    }
    return output;
  }

  private printItem(item: StylesheetItem, level: number): Chunk | undefined {
    switch (item.kind) {
      case "setup":
        return this.printSetup(item, level);
      case "use":
        return this.printUse(item, level);
      case "variables":
        return this.printVariables(item, level);
      case "runtime":
        return this.printRuntime(item, level);
      case "media-types":
        return this.printMediaTypes(item, level);
      case "group-definition":
        return this.printGroupDefinition(item, level);
      case "rule":
        return this.printRule(item, level);
      case "native-at-rule":
        return this.printNative(item, level);
    }
  }

  private printSetup(block: SetupBlock, level: number): Chunk {
    const lines = [`${pad(level)}@setup {`];
    for (const setting of block.settings) {
      lines.push(...this.takeComments(setting.span.start, level + 1));
      lines.push(`${pad(level + 1)}${printSetting(setting)}`);
    }
    lines.push(...this.takeComments(block.span.end, level + 1));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printUse(item: UseImport, level: number): Chunk {
    const alias = item.alias === undefined ? "" : ` as ${item.alias}`;
    // `styles` is semantic, not cosmetic: dropping it would downgrade a
    // rule-merge import to a token-only one (ADR-0014, SPECIFICATION.md §6.3).
    const styles = item.styles === true ? " styles" : "";
    return { lines: [`${pad(level)}@use "${item.path}"${alias}${styles};`], block: false };
  }

  private printVariables(block: VariablesBlock, level: number): Chunk {
    const lines = [`${pad(level)}@variables {`];
    for (const token of block.tokens) {
      lines.push(...this.takeComments(token.span.start, level + 1));
      lines.push(`${pad(level + 1)}${printTokenDeclaration(token, this.source)}`);
    }
    lines.push(...this.takeComments(block.span.end, level + 1));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printRuntime(block: RuntimeBlock, level: number): Chunk {
    const lines = [`${pad(level)}@runtime {`];
    const body = this.printBlockItems(block.declarations, level + 1, block.span.end);
    lines.push(...body);
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printMediaTypes(block: MediaTypesBlock, level: number): Chunk {
    const lines = [`${pad(level)}@media-types {`];
    for (const alias of block.aliases) {
      lines.push(...this.takeComments(alias.span.start, level + 1));
      lines.push(`${pad(level + 1)}${printAlias(alias)}`);
    }
    lines.push(...this.takeComments(block.span.end, level + 1));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  /**
   * Print a `@group.<name>` definition or use site (ADR-0017).
   *
   * Both node kinds are the same authored construct at different positions, so
   * they share one layout: the `@group` header, then one declaration per line at
   * the next depth. Declarations are ordinary {@link Declaration} nodes, so
   * inline variants and per-segment `!important` print exactly as they do in a
   * rule body; only the block's own comments and trailing comments are printed
   * here. Omitting either node would delete an authored group on format-on-save
   * (ADR-0017 item 8), which is why the printer handles both kinds explicitly.
   */
  private printGroup(
    name: string,
    declarations: readonly Declaration[],
    endOffset: number,
    level: number,
  ): Chunk {
    const lines = [`${pad(level)}@group.${name} {`];
    lines.push(...this.printBlockItems(declarations, level + 1, endOffset));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printGroupDefinition(block: GroupDefinition, level: number): Chunk {
    return this.printGroup(block.name, block.declarations, block.span.end, level);
  }

  private printGroupUseSite(block: GroupUseSite, level: number): Chunk {
    return this.printGroup(block.name, block.declarations, block.span.end, level);
  }

  private printRule(rule: Rule, level: number): Chunk {
    const lines = [`${pad(level)}${rule.selector} {`];
    lines.push(...this.printBlockItems(rule.body, level + 1, rule.span.end));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printConditional(block: ConditionalBlock, level: number): Chunk {
    const header = `@${block.variant.aliases.join("+")}`;
    const lines = [`${pad(level)}${header} {`];
    const body: ConditionalBlockItem[] = [...block.body];
    lines.push(...this.printBlockItems(body, level + 1, block.span.end));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printNative(item: NativeAtRule, level: number): Chunk {
    const header = item.prelude.length === 0 ? `@${item.name}` : `@${item.name} ${item.prelude}`;
    if (item.block === undefined) {
      const terminator = preludeSwallowsTerminator(item.prelude, this.file) ? "" : ";";
      return { lines: [`${pad(level)}${header}${terminator}`], block: false };
    }
    const lines = [`${pad(level)}${header} {`];
    lines.push(...this.printBlockItems(item.block, level + 1, item.span.end));
    lines.push(`${pad(level)}}`);
    return { lines, block: true };
  }

  private printBlockItems(
    items: readonly (BlockItem | ConditionalBlockItem | Declaration)[],
    level: number,
    endOffset: number,
  ): string[] {
    const chunks: Chunk[] = [];
    for (const item of items) {
      const start = blockItemStart(item);
      const comments = this.takeComments(start, level);
      const printed = this.printBlockItem(item, level);
      const lines = [...comments, ...(printed?.lines ?? [])];
      if (lines.length > 0) chunks.push({ lines, block: printed?.block ?? false });
    }
    const trailing = this.takeComments(endOffset, level);
    if (trailing.length > 0) chunks.push({ lines: trailing, block: false });

    const output: string[] = [];
    let previousBlock = false;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk === undefined) continue;
      if (index > 0 && (previousBlock || chunk.block)) output.push("");
      output.push(...chunk.lines);
      previousBlock = chunk.block;
    }
    return output;
  }

  private printBlockItem(
    item: BlockItem | ConditionalBlockItem | Declaration,
    level: number,
  ): Chunk | undefined {
    switch (item.kind) {
      case "declaration":
        return { lines: [`${pad(level)}${printDeclaration(item)}`], block: false };
      case "rule":
        return this.printRule(item, level);
      case "conditional-block":
        return this.printConditional(item, level);
      case "native-at-rule":
        return this.printNative(item, level);
      case "group-use-site":
        return this.printGroupUseSite(item, level);
    }
  }
}

function commentLines(value: string, level: number): string[] {
  return value.split("\n").map((line, index) => {
    const text = index === 0 ? line : line.replace(/^[ \t]*/, "");
    return `${pad(level)}${text}`;
  });
}

function printSetting(setting: Setting): string {
  return `${setting.key}: ${setting.value};`;
}

/**
 * Whether a `;` printed after this prelude would be read back as part of it.
 *
 * The parser ends a statement at-rule's prelude only at a top-level `{`, `;` or
 * `}`; while a `[` or `(` is still open, those tokens are prelude text. A
 * prelude with a dangling opener therefore swallows the formatter's terminator,
 * and re-formatting would add one `;` per pass. In that case the authored form
 * has no terminator to restore, so printing none is both stable and lossless.
 * The token stack mirrors `parseNativeAtRule`, so strings and comments (which
 * the lexer already collapsed) cannot be miscounted.
 */
function preludeSwallowsTerminator(prelude: string, file: string): boolean {
  if (prelude.length === 0) return false;
  let tokens: readonly Token[];
  try {
    tokens = tokenize(prelude, file).tokens;
  } catch {
    return false;
  }
  const closers: Array<"rparen" | "rbracket"> = [];
  for (const token of tokens) {
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      // A mismatched closer ends the prelude rather than nesting it.
      if (closers.pop() !== token.kind) return false;
    } else if (
      closers.length === 0 &&
      (token.kind === "lbrace" || token.kind === "semicolon" || token.kind === "rbrace")
    ) {
      return false;
    }
  }
  return closers.length > 0;
}

function printTokenDeclaration(token: TokenDeclaration, source: string): string {
  // The parser strips the authored `$` from `name`; keep it so a namespaced
  // declaration (`$layout.margin: 4px`) still reparses as a token declaration.
  const sigil = source[token.span.start] === "$" ? "$" : "";
  return `${sigil}${token.name}: ${token.value};`;
}

function printAlias(alias: AliasDeclaration): string {
  return `${alias.name}: ${alias.media};`;
}

/** Print one declaration with its inline variants on the same line. */
function printDeclaration(declaration: Declaration): string {
  let text = `${declaration.property}: ${declaration.value}`;
  for (const variant of declaration.variants) {
    const modifier = `@${variant.aliases.join("+")}`;
    if (variant.value.length === 0) {
      text += ` ${modifier}`;
      continue;
    }
    // The parser treats a marker directly after another marker as part of the
    // same variant's value; inserting a space would split one variant into two
    // and change which conditional block the value lands in.
    const separator = variant.value.startsWith("@") ? "" : " ";
    text += ` ${modifier}${separator}${variant.value}`;
  }
  return `${text};`;
}

/**
 * Format one Xessa source string canonically.
 *
 * @param source Authored source text; never mutated.
 * @param file Workspace-relative POSIX path used for diagnostics and spans.
 * @returns The canonical text plus parse diagnostics. Any error diagnostic
 *   returns the original `source` unchanged so no data is lost.
 */
export function format(source: string, file: string): FormatResult {
  const lexed = tokenize(source, file);
  const parsed = parseTokens(lexed.tokens, file);
  const diagnostics = Object.freeze([...lexed.diagnostics, ...parsed.diagnostics]);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return Object.freeze({ formatted: source, diagnostics });
  }

  const comments = lexed.tokens.filter((token) => token.kind === "comment");
  const printer = new Printer(
    comments,
    embeddedCommentRanges(parsed.ast, lexed.tokens),
    source,
    file,
  );
  const lines = printer.printStylesheet(parsed.ast);
  return Object.freeze({
    formatted: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
    diagnostics,
  });
}
