import type { BlockItem, ConditionalBlock, Modifier, NativeAtRule, Rule } from "../types/ast.js";
import type { Token } from "../types/token.js";
import { lastContentIndex, skipTriviaAt, tokenAt, trimWhitespace } from "./cursor.js";
import { type ParseContext, parseDeclaration } from "./declaration.js";
import { messages } from "./diagnostics.js";
import { isGroupAtKeyword, parseGroupUseSite, rejectGroupConstruct } from "./group.js";
import { readModifier } from "./modifier.js";
import { recoverStatement, skipAtRule, skipBalancedBlock, skipStatementBlock } from "./recovery.js";
import { classifyStatement } from "./statement.js";

export type { StatementKind } from "./statement.js";
export { classifyStatement };

/**
 * Native CSS at-rules keep their authored meaning (SPECIFICATION.md §3.5) and
 * are never Xessa conditional blocks (ADR-0004). Names are matched
 * case-insensitively.
 */
const NATIVE_AT_RULES = new Set([
  "charset",
  "container",
  "counter-style",
  "document",
  "font-face",
  "font-feature-values",
  "font-palette-values",
  "import",
  "keyframes",
  "layer",
  "media",
  "namespace",
  "nest",
  "page",
  "position-try",
  "property",
  "scope",
  "starting-style",
  "supports",
  "view-transition",
]);

/** At-rule name without the leading `@`. */
export function atRuleName(token: Token): string {
  return token.value.startsWith("@") ? token.value.slice(1) : token.value;
}

export function isNativeAtRuleName(name: string): boolean {
  return NATIVE_AT_RULES.has(name.toLowerCase());
}

interface BlockOptions {
  /** Native at-rules may appear here (rule bodies and native blocks). */
  readonly allowNative: boolean;
  /** Conditional blocks may appear here (rule and conditional bodies). */
  readonly allowConditional: boolean;
  /** `@group.<name>` use sites may appear here (rule bodies and native blocks). */
  readonly allowGroup: boolean;
}

/**
 * Parse members of a `{ ... }` block, stopping before its `}` (the caller
 * consumes it) or at end of input. Every iteration advances at least one token.
 */
export function parseBlockItems(ctx: ParseContext, options: BlockOptions): readonly BlockItem[] {
  const { cursor, bag } = ctx;
  const items: BlockItem[] = [];

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") break;
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }

    if (token.kind === "lbrace") {
      bag.add("XESSA1001", messages.unexpectedToken, cursor.span(token));
      cursor.index = skipBalancedBlock(cursor.tokens, cursor.index, cursor.endOffset);
    } else if (token.kind === "at-keyword" || token.kind === "modifier") {
      const item = parseAtRuleInBlock(ctx, options);
      if (item !== undefined) items.push(item);
    } else if (classifyStatement(cursor) === "rule") {
      const rule = parseRule(ctx);
      if (rule !== undefined) items.push(rule);
    } else {
      const declaration = parseDeclaration(ctx);
      if (declaration !== undefined) items.push(declaration);
    }

    if (cursor.index === guard) {
      bag.add("XESSA1001", messages.internalRecovery, cursor.span(token));
      cursor.index++;
    }
  }

  return Object.freeze(items);
}

/**
 * Parse `selector { ... }`. The selector stays a raw slice with its own span
 * (D1/ADR-0002: bare nested selectors are ordinary rules here; descendant and
 * `&` semantics are lowering concerns per ADR-0012).
 */
export function parseRule(ctx: ParseContext): Rule | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const file = cursor.file;
  const startIndex = cursor.index;
  const startToken = cursor.current();

  const closers: Array<"rparen" | "rbracket"> = [];
  let index = cursor.index;
  let openIndex = -1;

  while (true) {
    const token = tokenAt(tokens, index, cursor.endOffset);
    if (token.kind === "eof") break;
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) break;
    } else if (closers.length === 0) {
      if (token.kind === "lbrace") {
        openIndex = index;
        break;
      }
      if (token.kind === "semicolon" || token.kind === "rbrace") break;
    }
    index++;
  }

  if (openIndex === -1) {
    bag.add("XESSA1001", messages.unexpectedStatement, cursor.span(startToken));
    recoverStatement(cursor);
    return undefined;
  }

  const selectorBounds = trimWhitespace(tokens, startIndex, openIndex);
  if (selectorBounds.start >= selectorBounds.end) {
    bag.add("XESSA1001", messages.emptySelector, cursor.spanOfRange(startIndex, openIndex));
    cursor.index = skipBalancedBlock(tokens, openIndex, cursor.endOffset);
    return undefined;
  }

  const selector = cursor.text(selectorBounds.start, selectorBounds.end);
  const selectorSpan = cursor.spanOfRange(selectorBounds.start, selectorBounds.end);

  cursor.index = openIndex + 1;
  const body = parseBlockItems(ctx, {
    allowNative: true,
    allowConditional: true,
    allowGroup: true,
  });

  let end = cursor.endOffset;
  const closing = cursor.current();
  if (closing.kind === "rbrace") {
    end = closing.end;
    cursor.index++;
  } else {
    bag.add("XESSA1001", messages.unclosedBlock(`rule "${selector}"`), {
      start: startToken.start,
      end: cursor.endOffset,
      file,
    });
  }

  return Object.freeze({
    kind: "rule",
    selector,
    selectorSpan,
    body,
    span: { start: startToken.start, end, file },
  });
}

/** Parse `@alias { ... }` (rule-scoped conditional block, D3/ADR-0004). */
export function parseConditionalBlock(
  ctx: ParseContext,
  variant: Modifier,
  openIndex: number,
): ConditionalBlock {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;

  cursor.index = openIndex + 1;
  const parsedBody = parseBlockItems(ctx, {
    allowNative: false,
    allowConditional: true,
    allowGroup: false,
  });
  const body: ConditionalBlock["body"] = parsedBody.filter(
    (item): item is ConditionalBlock["body"][number] => item.kind !== "native-at-rule",
  );

  let end = cursor.endOffset;
  const closing = cursor.current();
  if (closing.kind === "rbrace") {
    end = closing.end;
    cursor.index++;
  } else {
    bag.add("XESSA1001", messages.unclosedBlock("conditional block"), {
      start: variant.span.start,
      end: cursor.endOffset,
      file: cursor.file,
    });
  }

  return Object.freeze({
    kind: "conditional-block",
    variant,
    body: Object.freeze(body),
    span: { start: variant.span.start, end, file: cursor.file },
  });
}

function parseAtRuleInBlock(ctx: ParseContext, options: BlockOptions): BlockItem | undefined {
  const { cursor, bag } = ctx;
  const startToken = cursor.current();
  const name = atRuleName(startToken).toLowerCase();

  if (isGroupAtKeyword(startToken)) {
    if (!options.allowGroup) {
      rejectGroupConstruct(ctx, "a conditional block");
      return undefined;
    }
    return parseGroupUseSite(ctx);
  }

  if (isNativeAtRuleName(name)) {
    if (!options.allowNative) {
      bag.add("XESSA1001", messages.nativeInConditional, cursor.span(startToken));
      cursor.index = skipAtRule(cursor.tokens, cursor.index, cursor.endOffset);
      return undefined;
    }
    return parseNativeAtRule(ctx);
  }

  const read = readModifier(cursor.tokens, cursor.index, cursor.tokens.length, cursor.file);
  if (read !== undefined) {
    const openIndex = skipTriviaAt(cursor.tokens, read.nextIndex);
    const open = tokenAt(cursor.tokens, openIndex, cursor.endOffset);
    if (open.kind === "lbrace") {
      if (!options.allowConditional) {
        bag.add("XESSA1001", messages.unexpectedAtRule, cursor.span(startToken));
        cursor.index = skipAtRule(cursor.tokens, cursor.index, cursor.endOffset);
        return undefined;
      }
      return parseConditionalBlock(ctx, read.modifier, openIndex);
    }
  }

  if (!options.allowNative) {
    bag.add("XESSA1001", messages.unexpectedAtRule, cursor.span(startToken));
    cursor.index = skipAtRule(cursor.tokens, cursor.index, cursor.endOffset);
    return undefined;
  }
  return parseNativeAtRule(ctx);
}

/**
 * Parse a native at-rule, with or without a block.
 *
 * The prelude stays a raw trimmed slice; block members are parsed with the
 * normal rule-body grammar so `@media`/`@supports` contents keep their authored
 * declarations and nested rules.
 */
export function parseNativeAtRule(ctx: ParseContext): NativeAtRule | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const file = cursor.file;
  const startToken = cursor.current();
  const name = atRuleName(startToken);

  const closers: Array<"rparen" | "rbracket"> = [];
  let index = cursor.index + 1;
  let terminator: "lbrace" | "semicolon" | "end" = "end";
  let boundaryIndex = index;

  while (true) {
    const token = tokenAt(tokens, index, cursor.endOffset);
    if (token.kind === "eof") {
      boundaryIndex = index;
      break;
    }
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) {
        boundaryIndex = index;
        break;
      }
    } else if (closers.length === 0) {
      if (token.kind === "lbrace") {
        terminator = "lbrace";
        boundaryIndex = index;
        break;
      }
      if (token.kind === "semicolon") {
        terminator = "semicolon";
        boundaryIndex = index;
        break;
      }
      if (token.kind === "rbrace") {
        boundaryIndex = index;
        break;
      }
    }
    index++;
  }

  const preludeBounds = trimWhitespace(tokens, cursor.index + 1, boundaryIndex);
  const prelude = cursor.text(preludeBounds.start, preludeBounds.end);
  const preludeEnd = lastContentIndex(tokens, preludeBounds.start, preludeBounds.end);

  if (terminator === "lbrace") {
    cursor.index = boundaryIndex + 1;
    const block = parseBlockItems(ctx, {
      allowNative: true,
      allowConditional: true,
      allowGroup: true,
    });
    let end = cursor.endOffset;
    const closing = cursor.current();
    if (closing.kind === "rbrace") {
      end = closing.end;
      cursor.index++;
    } else {
      bag.add("XESSA1001", messages.unclosedBlock(`at-rule "@${name}"`), {
        start: startToken.start,
        end: cursor.endOffset,
        file,
      });
    }
    return Object.freeze({
      kind: "native-at-rule",
      name,
      prelude,
      block,
      span: { start: startToken.start, end, file },
    });
  }

  if (terminator === "semicolon") {
    const semicolon = tokenAt(tokens, boundaryIndex, cursor.endOffset);
    cursor.index = boundaryIndex + 1;
    return Object.freeze({
      kind: "native-at-rule",
      name,
      prelude,
      span: { start: startToken.start, end: semicolon.end, file },
    });
  }

  cursor.index = Math.min(boundaryIndex, tokens.length);
  const fallbackEnd =
    preludeEnd >= preludeBounds.start
      ? (tokens[preludeEnd]?.end ?? startToken.end)
      : startToken.end;
  return Object.freeze({
    kind: "native-at-rule",
    name,
    prelude,
    span: { start: startToken.start, end: fallbackEnd, file },
  });
}
