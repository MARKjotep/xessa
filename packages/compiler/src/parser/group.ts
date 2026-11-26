import type { Declaration, GroupDefinition, GroupUseSite } from "../types/ast.js";
import type { Span } from "../types/span.js";
import type { Token } from "../types/token.js";
import { skipTriviaAt, tokenAt } from "./cursor.js";
import { type ParseContext, parseDeclaration } from "./declaration.js";
import { messages } from "./diagnostics.js";
import { skipAtRule, skipBalancedBlock, skipStatementBlock } from "./recovery.js";
import { classifyStatement } from "./statement.js";

/**
 * `@group.<name>` definitions and use sites (ADR-0017, SPECIFICATION.md §3.7).
 *
 * The lexer keeps the three parts as an `at-keyword`, a `.` delim and an
 * identifier, so this module recognises the dotted form by requiring the three
 * tokens to be adjacent in the source: `@group.card` is a group construct, while
 * `@group .card`, `@group.` and a bare `@group` are malformed and reported as
 * XESSA1001. Position decides the node kind: a top-level statement is a
 * {@link GroupDefinition}, the same statement inside a rule body is a
 * {@link GroupUseSite} (§3.2 grammar).
 *
 * Both blocks accept declarations and nothing else. A nested rule, conditional
 * block, native at-rule or further `@group.` statement is one XESSA1001 per
 * offending statement, the statement is omitted and the rest of the block
 * survives. No expansion, printing or symbol resolution happens here — that is
 * plan G3/G5/G2 work.
 */

/** A well-formed `@group.<name>` header. */
interface GroupHeader {
  readonly kind: "group-header";
  /** Group name exactly as authored, without the `@group.` prefix. */
  readonly name: string;
  /** Covers `@group` through the name. */
  readonly span: Span;
  /** Raw index of the first token after the name. */
  readonly nextIndex: number;
}

/** A `@group` attempt whose dotted form is missing, spaced or not an identifier. */
interface MalformedGroupHeader {
  readonly kind: "malformed-group-header";
  readonly message: string;
  /** Covers `@group` through whatever dotted parts were authored. */
  readonly span: Span;
  /**
   * `statement` skips the whole construct (including a following block);
   * `token` advances past `@group` only, so a following rule on a later line
   * still parses after a missing dotted form.
   */
  readonly recover: "statement" | "token";
}

/** Declarations and bounds parsed from one group block. */
interface GroupBody {
  readonly declarations: readonly Declaration[];
  /** Covers the closing `}`, or end of input when the block is unclosed. */
  readonly end: number;
}

/** True when `token` is the reserved `@group` directive name (case-insensitive). */
export function isGroupAtKeyword(token: Token): boolean {
  if (token.kind !== "at-keyword") return false;
  const name = token.value.startsWith("@") ? token.value.slice(1) : token.value;
  return name.toLowerCase() === "group";
}

/** Display form of a group name for diagnostic messages (`@group.card`). */
function groupText(name: string): string {
  return `@group.${name}`;
}

/**
 * Read a `@group.<name>` header at `index`, or describe why it is malformed.
 *
 * Contiguity is token adjacency: the `.` must start where `@group` ends and the
 * name where `.` ends, so any whitespace or comment in the dotted form is
 * rejected. The name must be a CSS identifier, which rules out digit-leading
 * members such as `@group.2xl`.
 */
function readGroupHeader(ctx: ParseContext, index: number): GroupHeader | MalformedGroupHeader {
  const { cursor } = ctx;
  const tokens = cursor.tokens;
  const file = cursor.file;
  const at = tokenAt(tokens, index, cursor.endOffset);
  const dot = tokenAt(tokens, index + 1, cursor.endOffset);
  const name = tokenAt(tokens, index + 2, cursor.endOffset);

  if (
    dot.kind === "delim" &&
    dot.value === "." &&
    dot.start === at.end &&
    name.kind === "ident" &&
    name.start === dot.end
  ) {
    return {
      kind: "group-header",
      name: name.value,
      span: { start: at.start, end: name.end, file },
      nextIndex: index + 3,
    };
  }

  // Point the diagnostic at the whole authored attempt: `@group`, an optional
  // (possibly spaced) dot and an optional name-like token after it.
  const afterAtIndex = skipTriviaAt(tokens, index + 1);
  const afterAt = tokenAt(tokens, afterAtIndex, cursor.endOffset);
  const spacedDot = afterAt.kind === "delim" && afterAt.value === ".";
  // `@group.2xl` lexes the dotted tail as one number token, so a name that
  // cannot be an identifier is still recognised as a dotted-form attempt.
  const numericTail = afterAt.kind === "number" && afterAt.value.startsWith(".");
  const startsWithDot = spacedDot || numericTail;

  let end = at.end;
  let message: string = messages.groupMissingName;
  if (startsWithDot) {
    end = afterAt.end;
    message = messages.groupMalformedName;
    if (spacedDot) {
      const afterDot = tokenAt(tokens, skipTriviaAt(tokens, afterAtIndex + 1), cursor.endOffset);
      if (afterDot.kind === "ident" || afterDot.kind === "number") end = afterDot.end;
    }
  }

  return {
    kind: "malformed-group-header",
    message,
    span: { start: at.start, end, file },
    recover:
      message === messages.groupMissingName && afterAt.kind !== "lbrace" ? "token" : "statement",
  };
}

/** Report a malformed header and resume at the next statement boundary. */
function requireGroupHeader(ctx: ParseContext): GroupHeader | undefined {
  const { cursor, bag } = ctx;
  const startIndex = cursor.index;
  const header = readGroupHeader(ctx, startIndex);
  if (header.kind === "group-header") return header;

  bag.add("XESSA1001", header.message, header.span);
  if (header.recover === "token") {
    cursor.index = Math.min(startIndex + 1, cursor.tokens.length);
    return undefined;
  }
  cursor.index = Math.min(
    skipStatementBlock(cursor.tokens, startIndex, cursor.endOffset),
    cursor.tokens.length,
  );
  return undefined;
}

/**
 * Parse `{ declaration ... }` after a validated header.
 *
 * Returns `undefined` when the required block is missing; a conditional use
 * site (`@group.x @md { ... }`) is reported as unsupported and skipped as one
 * statement so the enclosing rule keeps parsing.
 */
function parseGroupBlock(ctx: ParseContext, header: GroupHeader): GroupBody | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const startIndex = cursor.index;
  cursor.index = header.nextIndex;
  cursor.skipTrivia();

  const open = cursor.current();
  if (open.kind !== "lbrace") {
    const conditional = open.kind === "at-keyword" || open.kind === "modifier";
    const span = {
      start: header.span.start,
      end: open.kind === "eof" ? header.span.end : open.end,
      file: cursor.file,
    };
    bag.add(
      "XESSA1001",
      conditional
        ? messages.groupConditionalUseSite(groupText(header.name))
        : messages.groupNeedsBlock(groupText(header.name)),
      span,
    );
    cursor.index = Math.min(
      skipStatementBlock(tokens, startIndex, cursor.endOffset),
      tokens.length,
    );
    return undefined;
  }

  cursor.index++;
  return parseGroupBody(ctx, header.name, header.span.start);
}

/** Parse declarations only, reporting and skipping every other statement. */
function parseGroupBody(ctx: ParseContext, name: string, startOffset: number): GroupBody {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const declarations: Declaration[] = [];
  let end = cursor.endOffset;

  while (true) {
    cursor.skipTrivia();
    const guard = cursor.index;
    const token = cursor.current();

    if (token.kind === "eof") break;
    if (token.kind === "rbrace") {
      end = token.end;
      cursor.index++;
      return { declarations: Object.freeze(declarations), end };
    }
    if (token.kind === "semicolon") {
      cursor.index++;
      continue;
    }

    if (token.kind === "at-keyword" || token.kind === "modifier") {
      bag.add("XESSA1001", messages.groupDeclarationsOnly(groupText(name)), cursor.span(token));
      cursor.index = Math.min(skipAtRule(tokens, cursor.index, cursor.endOffset), tokens.length);
    } else if (token.kind === "lbrace") {
      bag.add("XESSA1001", messages.groupDeclarationsOnly(groupText(name)), cursor.span(token));
      cursor.index = Math.min(
        skipBalancedBlock(tokens, cursor.index, cursor.endOffset),
        tokens.length,
      );
    } else if (classifyStatement(cursor) === "rule") {
      bag.add("XESSA1001", messages.groupDeclarationsOnly(groupText(name)), cursor.span(token));
      cursor.index = Math.min(
        skipStatementBlock(tokens, cursor.index, cursor.endOffset),
        tokens.length,
      );
    } else {
      const declaration = parseDeclaration(ctx);
      if (declaration !== undefined) declarations.push(declaration);
    }

    if (cursor.index === guard) cursor.index++;
  }

  bag.add("XESSA1001", messages.unclosedBlock(`group "${groupText(name)}"`), {
    start: startOffset,
    end: cursor.endOffset,
    file: cursor.file,
  });
  return { declarations: Object.freeze(declarations), end };
}

/**
 * Parse a top-level `@group.<name> { declaration ... }` definition.
 *
 * The definition is inert; its declarations are kept in authored order and the
 * resolver owns duplicate and visibility semantics (plan G2).
 */
export function parseGroupDefinition(ctx: ParseContext): GroupDefinition | undefined {
  const { cursor } = ctx;
  const header = requireGroupHeader(ctx);
  if (header === undefined) return undefined;
  const body = parseGroupBlock(ctx, header);
  if (body === undefined) return undefined;

  return Object.freeze({
    kind: "group-definition",
    name: header.name,
    declarations: body.declarations,
    span: { start: header.span.start, end: body.end, file: cursor.file },
  });
}

/**
 * Parse a `@group.<name> { declaration ... }` use site inside a rule body.
 *
 * The block is required in v0.1 and holds overrides only; expansion is G3.
 */
export function parseGroupUseSite(ctx: ParseContext): GroupUseSite | undefined {
  const { cursor } = ctx;
  const header = requireGroupHeader(ctx);
  if (header === undefined) return undefined;
  const body = parseGroupBlock(ctx, header);
  if (body === undefined) return undefined;

  return Object.freeze({
    kind: "group-use-site",
    name: header.name,
    declarations: body.declarations,
    span: { start: header.span.start, end: body.end, file: cursor.file },
  });
}

/**
 * Reject a group statement in a context that cannot hold a use site.
 *
 * Conditional blocks are declaration/rule/conditional containers only, so a
 * group use site there is XESSA1001 and the whole statement is omitted.
 */
export function rejectGroupConstruct(ctx: ParseContext, context: string): void {
  const { cursor, bag } = ctx;
  const startIndex = cursor.index;
  const header = readGroupHeader(ctx, startIndex);
  const label = header.kind === "group-header" ? groupText(header.name) : "@group";
  bag.add("XESSA1001", messages.groupNotAllowedHere(label, context), header.span);
  cursor.index = Math.min(
    skipStatementBlock(cursor.tokens, startIndex, cursor.endOffset),
    cursor.tokens.length,
  );
}
