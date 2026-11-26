import type {
  AliasDeclaration,
  Declaration,
  MediaTypesBlock,
  RuntimeBlock,
  Setting,
  SetupBlock,
  Stylesheet,
  StylesheetItem,
  TokenDeclaration,
  UseImport,
  VariablesBlock,
} from "../types/ast.js";
import type { ParseResult } from "../types/result.js";
import type { Token } from "../types/token.js";
import {
  TokenCursor,
  lastContentIndex,
  skipTriviaAt,
  textOf,
  tokenAt,
  trimWhitespace,
} from "./cursor.js";
import { type ParseContext, parseDeclaration } from "./declaration.js";
import { DiagnosticBag, messages } from "./diagnostics.js";
import { isGroupAtKeyword, parseGroupDefinition } from "./group.js";
import { readModifier } from "./modifier.js";
import { recoverStatement, skipAtRule, skipBalancedBlock, skipStatementBlock } from "./recovery.js";
import {
  atRuleName,
  classifyStatement,
  isNativeAtRuleName,
  parseNativeAtRule,
  parseRule,
} from "./rule.js";
import { containsDollarRef } from "./value.js";

/** How a scalar `key: value` line ended. */
type SimpleTerminator = "semicolon" | "rbrace" | "eof" | "lbrace";

interface SimpleValue {
  readonly terminator: SimpleTerminator;
  readonly boundaryIndex: number;
  readonly malformed: boolean;
  readonly bounds: { readonly start: number; readonly end: number };
  readonly valueEnd: number;
}

/**
 * Scan a scalar value up to `;`, the closing `}`, or end of input while
 * balancing parentheses and brackets (used by `@setup`, `@variables` and
 * `@media-types`).
 */
function scanSimpleValue(ctx: ParseContext, startIndex: number): SimpleValue {
  const { cursor } = ctx;
  const tokens = cursor.tokens;
  const closers: Array<"rparen" | "rbracket"> = [];
  let malformed = false;
  let index = startIndex;
  let terminator: SimpleTerminator = "eof";

  while (true) {
    const token = tokenAt(tokens, index, cursor.endOffset);
    if (token.kind === "eof") {
      terminator = "eof";
      break;
    }
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) malformed = true;
    } else if (closers.length === 0) {
      if (token.kind === "semicolon") {
        terminator = "semicolon";
        break;
      }
      if (token.kind === "rbrace") {
        terminator = "rbrace";
        break;
      }
      if (token.kind === "lbrace") {
        terminator = "lbrace";
        break;
      }
    }
    index++;
  }

  const bounds = trimWhitespace(tokens, startIndex, index);
  const last = lastContentIndex(tokens, bounds.start, bounds.end);
  return {
    terminator,
    boundaryIndex: index,
    malformed: malformed || closers.length > 0,
    bounds,
    valueEnd: last >= bounds.start ? (tokens[last]?.end ?? 0) : 0,
  };
}

/** Consume a statement terminator, reporting a missing `;` when one is absent. */
function finishSimple(
  ctx: ParseContext,
  scan: SimpleValue,
  startTokenStart: number,
  fallbackEnd: number,
  what: string,
): number {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  if (scan.terminator === "semicolon") {
    const semicolon = tokenAt(tokens, scan.boundaryIndex, cursor.endOffset);
    cursor.index = scan.boundaryIndex + 1;
    return semicolon.end;
  }
  const end = scan.valueEnd > 0 ? scan.valueEnd : fallbackEnd;
  bag.add("XESSA1001", messages.missingSemicolon(what), {
    start: startTokenStart,
    end,
    file: cursor.file,
  });
  cursor.index = Math.min(scan.boundaryIndex, tokens.length);
  return end;
}

function expectBlockOpen(ctx: ParseContext, construct: string): boolean {
  const { cursor, bag } = ctx;
  cursor.skipTrivia();
  const token = cursor.current();
  if (token.kind === "lbrace") {
    cursor.index++;
    return true;
  }
  bag.add("XESSA1001", messages.missingBrace(construct), cursor.span(token));
  recoverStatement(cursor);
  return false;
}

function reportUnclosed(ctx: ParseContext, startOffset: number, construct: string): void {
  ctx.bag.add("XESSA1001", messages.unclosedBlock(construct), {
    start: startOffset,
    end: ctx.cursor.endOffset,
    file: ctx.cursor.file,
  });
}

/**
 * Parse `@setup { key: scalar; ... }`.
 *
 * Settings keep authored order and duplicates; the resolver merges blocks and
 * rejects duplicate or unknown keys (AST `SetupBlock` JSDoc). Values stay raw,
 * quotes included.
 */
export function parseSetupBlock(ctx: ParseContext): SetupBlock | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const startToken = cursor.current();
  cursor.index++;
  if (!expectBlockOpen(ctx, "@setup")) return undefined;

  const settings: Setting[] = [];
  let end = cursor.endOffset;
  let closed = false;

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") {
      end = token.end;
      cursor.index++;
      closed = true;
      break;
    }
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }
    if (token.kind !== "ident") {
      bag.add("XESSA1001", messages.expectedSettingKey, cursor.span(token));
      recoverStatement(cursor);
    } else {
      const setting = parseSetting(ctx, token);
      if (setting !== undefined) settings.push(setting);
    }

    if (cursor.index === guard) cursor.index++;
  }

  if (!closed) reportUnclosed(ctx, startToken.start, "@setup");
  return Object.freeze({
    kind: "setup",
    settings: Object.freeze(settings),
    span: { start: startToken.start, end, file },
  });
}

function parseSetting(ctx: ParseContext, keyToken: Token): Setting | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  cursor.index++;
  cursor.skipTrivia();

  const colon = cursor.current();
  if (colon.kind !== "colon") {
    bag.add("XESSA1001", messages.expectedSettingColon, cursor.span(colon));
    recoverStatement(cursor);
    return undefined;
  }
  cursor.index++;

  const scan = scanSimpleValue(ctx, cursor.index);
  if (scan.malformed) {
    bag.add("XESSA1003", messages.malformedValue, {
      start: keyToken.start,
      end: scan.valueEnd > 0 ? scan.valueEnd : keyToken.end,
      file,
    });
    if (scan.terminator === "lbrace") {
      cursor.index = skipBalancedBlock(cursor.tokens, scan.boundaryIndex, cursor.endOffset);
    } else if (scan.terminator === "semicolon") {
      cursor.index = scan.boundaryIndex + 1;
    } else {
      cursor.index = Math.min(scan.boundaryIndex, cursor.tokens.length);
    }
    return undefined;
  }

  const value = textOf(cursor.tokens, scan.bounds.start, scan.bounds.end);
  const valueSpan =
    scan.bounds.start < scan.bounds.end
      ? {
          start: cursor.tokens[scan.bounds.start]?.start ?? colon.end,
          end: cursor.tokens[scan.bounds.end - 1]?.end ?? colon.end,
          file,
        }
      : { start: colon.end, end: colon.end, file };
  const end = finishSimple(ctx, scan, keyToken.start, keyToken.end, "a setup setting");
  return Object.freeze({
    kind: "setting",
    key: keyToken.value,
    value,
    valueSpan,
    span: { start: keyToken.start, end, file },
  });
}

/**
 * Parse `@use "..." [as alias] [styles];` (SPECIFICATION.md §3.2, ADR-0014).
 *
 * The optional `styles` clause merges the target's rules into the importing
 * build; it is recorded as `styles: true` and is absent for token-only imports.
 */
export function parseUseImport(ctx: ParseContext): UseImport | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const file = cursor.file;
  const startToken = cursor.current();
  cursor.index++;
  cursor.skipTrivia();

  const specifier = cursor.current();
  if (specifier.kind !== "string") {
    bag.add("XESSA1001", messages.expectedModuleSpecifier, cursor.span(specifier));
    recoverStatement(cursor);
    return undefined;
  }
  const path = unquote(specifier.value);
  cursor.index++;
  cursor.skipTrivia();

  let alias: string | undefined;
  const maybeAs = cursor.current();
  if (maybeAs.kind === "ident" && maybeAs.value.toLowerCase() === "as") {
    cursor.index++;
    cursor.skipTrivia();
    const aliasToken = cursor.current();
    if (aliasToken.kind !== "ident" && aliasToken.kind !== "number") {
      bag.add("XESSA1001", messages.expectedImportAlias, cursor.span(aliasToken));
      recoverStatement(cursor);
      return undefined;
    }
    alias = aliasToken.value;
    cursor.index++;
    cursor.skipTrivia();
  }

  let styles: boolean | undefined;
  const maybeStyles = cursor.current();
  if (maybeStyles.kind === "ident" && maybeStyles.value === "styles") {
    styles = true;
    cursor.index++;
    cursor.skipTrivia();
  }

  const terminator = cursor.current();
  let end: number;
  if (terminator.kind === "semicolon") {
    end = terminator.end;
    cursor.index++;
  } else {
    end = cursor.span(specifier).end;
    bag.add("XESSA1001", messages.missingSemicolon("an @use import"), {
      start: startToken.start,
      end,
      file,
    });
    cursor.index = Math.min(cursor.index, tokens.length);
  }

  return Object.freeze({
    kind: "use",
    path,
    ...(alias === undefined ? {} : { alias }),
    ...(styles === undefined ? {} : { styles }),
    span: { start: startToken.start, end, file },
  });
}

/** Strip one matching pair of quotes without decoding escapes. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  }
  return value;
}

/** Parse `@variables { name: value; ... }` with raw values and optional tokens. */
export function parseVariablesBlock(ctx: ParseContext): VariablesBlock | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const startToken = cursor.current();
  cursor.index++;
  if (!expectBlockOpen(ctx, "@variables")) return undefined;

  const tokens: TokenDeclaration[] = [];
  let end = cursor.endOffset;
  let closed = false;

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") {
      end = token.end;
      cursor.index++;
      closed = true;
      break;
    }
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }
    if (token.kind !== "ident" && token.kind !== "dollar-ref") {
      bag.add("XESSA1001", messages.expectedTokenName, cursor.span(token));
      recoverStatement(cursor);
    } else {
      const declaration = parseTokenDeclaration(ctx, token);
      if (declaration !== undefined) tokens.push(declaration);
    }

    if (cursor.index === guard) cursor.index++;
  }

  if (!closed) reportUnclosed(ctx, startToken.start, "@variables");
  return Object.freeze({
    kind: "variables",
    tokens: Object.freeze(tokens),
    span: { start: startToken.start, end, file },
  });
}

function parseTokenDeclaration(ctx: ParseContext, nameToken: Token): TokenDeclaration | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const name = nameToken.value.startsWith("$") ? nameToken.value.slice(1) : nameToken.value;
  cursor.index++;
  cursor.skipTrivia();

  const colon = cursor.current();
  if (colon.kind !== "colon") {
    bag.add("XESSA1001", messages.missingColon(name), cursor.span(colon));
    recoverStatement(cursor);
    return undefined;
  }
  cursor.index++;

  const scan = scanSimpleValue(ctx, cursor.index);
  if (scan.malformed) {
    bag.add("XESSA1003", messages.malformedValue, {
      start: nameToken.start,
      end: scan.valueEnd > 0 ? scan.valueEnd : nameToken.end,
      file,
    });
    if (scan.terminator === "lbrace") {
      cursor.index = skipBalancedBlock(cursor.tokens, scan.boundaryIndex, cursor.endOffset);
    } else if (scan.terminator === "semicolon") {
      cursor.index = scan.boundaryIndex + 1;
    } else {
      cursor.index = Math.min(scan.boundaryIndex, cursor.tokens.length);
    }
    return undefined;
  }

  const value = textOf(cursor.tokens, scan.bounds.start, scan.bounds.end);
  const valueTokens = containsDollarRef(cursor.tokens, scan.bounds.start, scan.bounds.end)
    ? Object.freeze(cursor.tokens.slice(scan.bounds.start, scan.bounds.end))
    : undefined;
  const end = finishSimple(ctx, scan, nameToken.start, nameToken.end, "a token declaration");

  return Object.freeze({
    kind: "token-declaration",
    name,
    value,
    ...(valueTokens === undefined ? {} : { tokens: valueTokens }),
    span: { start: nameToken.start, end, file },
  });
}

/** Parse `@runtime { declaration ... }`, including inline variant segments. */
export function parseRuntimeBlock(ctx: ParseContext): RuntimeBlock | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const startToken = cursor.current();
  cursor.index++;
  if (!expectBlockOpen(ctx, "@runtime")) return undefined;

  const declarations: Declaration[] = [];
  let end = cursor.endOffset;
  let closed = false;

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") {
      end = token.end;
      cursor.index++;
      closed = true;
      break;
    }
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }
    if (token.kind === "at-keyword" || token.kind === "modifier") {
      bag.add("XESSA1001", messages.unexpectedAtRule, cursor.span(token));
      cursor.index = skipAtRule(cursor.tokens, cursor.index, cursor.endOffset);
    } else if (token.kind === "lbrace") {
      bag.add("XESSA1001", messages.unexpectedToken, cursor.span(token));
      cursor.index = skipBalancedBlock(cursor.tokens, cursor.index, cursor.endOffset);
    } else if (classifyStatement(cursor) === "rule") {
      bag.add("XESSA1001", messages.unexpectedStatement, cursor.span(token));
      cursor.index = skipStatementBlock(cursor.tokens, cursor.index, cursor.endOffset);
    } else {
      const declaration = parseDeclaration(ctx);
      if (declaration !== undefined) declarations.push(declaration);
    }

    if (cursor.index === guard) cursor.index++;
  }

  if (!closed) reportUnclosed(ctx, startToken.start, "@runtime");
  return Object.freeze({
    kind: "runtime",
    declarations: Object.freeze(declarations),
    span: { start: startToken.start, end, file },
  });
}

/** Parse `@media-types { alias: condition; ... }` with raw trimmed conditions. */
export function parseMediaTypesBlock(ctx: ParseContext): MediaTypesBlock | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const startToken = cursor.current();
  cursor.index++;
  if (!expectBlockOpen(ctx, "@media-types")) return undefined;

  const aliases: AliasDeclaration[] = [];
  let end = cursor.endOffset;
  let closed = false;

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") {
      end = token.end;
      cursor.index++;
      closed = true;
      break;
    }
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }
    if (token.kind !== "ident" && token.kind !== "number") {
      bag.add("XESSA1001", messages.expectedAliasName, cursor.span(token));
      recoverStatement(cursor);
    } else {
      const alias = parseAliasDeclaration(ctx, token);
      if (alias !== undefined) aliases.push(alias);
    }

    if (cursor.index === guard) cursor.index++;
  }

  if (!closed) reportUnclosed(ctx, startToken.start, "@media-types");
  return Object.freeze({
    kind: "media-types",
    aliases: Object.freeze(aliases),
    span: { start: startToken.start, end, file },
  });
}

function parseAliasDeclaration(ctx: ParseContext, nameToken: Token): AliasDeclaration | undefined {
  const { cursor, bag } = ctx;
  const file = cursor.file;
  const name = nameToken.value.startsWith("@") ? nameToken.value.slice(1) : nameToken.value;
  cursor.index++;
  cursor.skipTrivia();

  const colon = cursor.current();
  if (colon.kind !== "colon") {
    bag.add("XESSA1001", messages.missingColon(name), cursor.span(colon));
    recoverStatement(cursor);
    return undefined;
  }
  cursor.index++;

  const scan = scanSimpleValue(ctx, cursor.index);
  if (scan.malformed) {
    bag.add("XESSA1003", messages.malformedCondition, {
      start: nameToken.start,
      end: scan.valueEnd > 0 ? scan.valueEnd : nameToken.end,
      file,
    });
    if (scan.terminator === "lbrace") {
      cursor.index = skipBalancedBlock(cursor.tokens, scan.boundaryIndex, cursor.endOffset);
    } else if (scan.terminator === "semicolon") {
      cursor.index = scan.boundaryIndex + 1;
    } else {
      cursor.index = Math.min(scan.boundaryIndex, cursor.tokens.length);
    }
    return undefined;
  }

  const media = textOf(cursor.tokens, scan.bounds.start, scan.bounds.end);
  const end = finishSimple(ctx, scan, nameToken.start, nameToken.end, "an alias declaration");
  return Object.freeze({
    kind: "alias-declaration",
    name,
    media,
    span: { start: nameToken.start, end, file },
  });
}

/**
 * Top-level dispatch: Xessa directives, rules and native at-rules.
 *
 * A top-level conditional block (an unknown `@alias {`) is a XESSA1001 error and
 * produces no node; recovery skips the balanced block (D3/ADR-0004).
 */
function parseTopLevelAtRule(ctx: ParseContext): StylesheetItem | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const startToken = cursor.current();
  const name = atRuleName(startToken).toLowerCase();

  if (isGroupAtKeyword(startToken)) return parseGroupDefinition(ctx);

  switch (name) {
    case "setup":
      return parseSetupBlock(ctx);
    case "use":
      return parseUseImport(ctx);
    case "variables":
      return parseVariablesBlock(ctx);
    case "runtime":
      return parseRuntimeBlock(ctx);
    case "media-types":
      return parseMediaTypesBlock(ctx);
    default:
      break;
  }

  if (isNativeAtRuleName(name)) return parseNativeAtRule(ctx);

  const read = readModifier(tokens, cursor.index, tokens.length, cursor.file);
  const afterModifier = read === undefined ? cursor.index + 1 : read.nextIndex;
  const openIndex = skipTriviaAt(tokens, afterModifier);
  const open = tokenAt(tokens, openIndex, cursor.endOffset);

  if (open.kind === "lbrace") {
    bag.add("XESSA1001", messages.topLevelConditional, cursor.span(startToken));
    cursor.index = skipBalancedBlock(tokens, openIndex, cursor.endOffset);
    return undefined;
  }

  return parseNativeAtRule(ctx);
}

/**
 * Tolerant recursive-descent parse of a top-level stylesheet.
 *
 * Never throws: statement-level recovery keeps prior items, every iteration
 * advances, and a recovered AST is always returned (SPECIFICATION.md §12).
 */
export function parseStylesheet(tokens: readonly Token[], file: string): ParseResult {
  const cursor = new TokenCursor(tokens, file);
  const bag = new DiagnosticBag();
  const ctx: ParseContext = { cursor, bag };
  const items: StylesheetItem[] = [];

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }
    if (token.kind === "rbrace") {
      bag.add("XESSA1001", messages.unexpectedToken, cursor.span(token));
      cursor.index++;
      continue;
    }
    if (token.kind === "lbrace") {
      bag.add("XESSA1001", messages.unexpectedToken, cursor.span(token));
      cursor.index = skipBalancedBlock(tokens, cursor.index, cursor.endOffset);
    } else if (token.kind === "at-keyword" || token.kind === "modifier") {
      const item = parseTopLevelAtRule(ctx);
      if (item !== undefined) items.push(item);
    } else if (classifyStatement(cursor) === "rule") {
      const rule = parseRule(ctx);
      if (rule !== undefined) items.push(rule);
    } else {
      bag.add("XESSA1001", messages.unexpectedStatement, cursor.span(token));
      recoverStatement(cursor);
    }

    if (cursor.index === guard) {
      bag.add("XESSA1001", messages.internalRecovery, cursor.span(token));
      cursor.index++;
    }
  }

  const ast: Stylesheet = Object.freeze({
    kind: "stylesheet",
    file,
    items: Object.freeze(items),
    span: { start: 0, end: cursor.endOffset, file },
  });

  return { ast, diagnostics: bag.finish() };
}
