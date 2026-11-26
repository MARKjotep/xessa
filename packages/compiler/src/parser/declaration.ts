import type { Declaration } from "../types/ast.js";
import type { Token } from "../types/token.js";
import {
  type TokenCursor,
  isTrivia,
  lastContentIndex,
  startsNewLine,
  tokenAt,
  trimWhitespace,
} from "./cursor.js";
import type { DiagnosticBag } from "./diagnostics.js";
import { messages } from "./diagnostics.js";
import { recoverStatement, skipBalancedBlock } from "./recovery.js";
import { containsDollarRef, findSemicolonlessRuleStart, segmentValue } from "./value.js";

/** Shared mutable parse state for one file. */
export interface ParseContext {
  readonly cursor: TokenCursor;
  readonly bag: DiagnosticBag;
}

/** How a declaration value ended. */
type Terminator = "semicolon" | "rbrace" | "eof" | "lbrace" | "next-declaration";

interface ScannedValue {
  readonly terminator: Terminator;
  /** Raw index of the terminator token (or the new statement start). */
  readonly boundaryIndex: number;
  readonly malformed: boolean;
}

/** True when `property:` begins at `index` (trivia tolerant). */
function looksLikeProperty(tokens: readonly Token[], index: number, eofOffset: number): boolean {
  let cursor = index;
  while (true) {
    const token = tokenAt(tokens, cursor, eofOffset);
    if (token.kind === "eof") return false;
    if (isTrivia(token)) {
      cursor++;
      continue;
    }
    if (token.kind !== "colon") return false;
    const after = tokenAt(tokens, cursor + 1, eofOffset);
    return after.kind !== "eof" && after.kind !== "rbrace" && after.kind !== "semicolon";
  }
}

/** Raw index of the declaration's property colon, or `-1`. */
function findPropertyColon(
  tokens: readonly Token[],
  startIndex: number,
  eofOffset: number,
): number {
  let depth = 0;
  let index = startIndex;
  while (true) {
    const token = tokenAt(tokens, index, eofOffset);
    if (token.kind === "eof") return -1;
    if (token.kind === "lparen" || token.kind === "lbracket") depth++;
    else if (token.kind === "rparen" || token.kind === "rbracket") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (token.kind === "colon") return index;
      if (token.kind === "semicolon" || token.kind === "rbrace" || token.kind === "lbrace") {
        return -1;
      }
    }
    index++;
  }
}

/**
 * Scan a value up to its statement boundary, tracking paren/bracket balance.
 *
 * A `;` always ends the statement even when brackets are unbalanced (XESSA1003
 * recovery), and a `property:` that starts on a later line ends a declaration
 * that forgot its semicolon (XESSA1002, errors/missing-semicolon).
 *
 * A balanced `{` ends the statement too: when the prefix is a declaration and
 * the brace opens a nested rule (`color: red` then `&:hover {`), the boundary
 * moves to the selector start so the declaration keeps its authored value and
 * XESSA1002 recovery can resume at the rule (ADR-0011). Otherwise the brace
 * stays malformed (XESSA1003).
 */
function scanValue(
  tokens: readonly Token[],
  statementStart: number,
  startIndex: number,
  eofOffset: number,
): ScannedValue {
  const closers: Array<"rparen" | "rbracket"> = [];
  let malformed = false;
  let index = startIndex;

  while (true) {
    const token = tokenAt(tokens, index, eofOffset);
    if (token.kind === "eof") {
      return { terminator: "eof", boundaryIndex: index, malformed };
    }
    if (token.kind === "semicolon") {
      return {
        terminator: "semicolon",
        boundaryIndex: index,
        malformed: malformed || closers.length > 0,
      };
    }
    if (token.kind === "rbrace") {
      return {
        terminator: "rbrace",
        boundaryIndex: index,
        malformed: malformed || closers.length > 0,
      };
    }
    if (token.kind === "lbrace" && closers.length === 0) {
      if (malformed) return { terminator: "lbrace", boundaryIndex: index, malformed: true };
      const ruleIndex = findSemicolonlessRuleStart(tokens, statementStart, index);
      if (ruleIndex === -1) {
        return { terminator: "lbrace", boundaryIndex: index, malformed: true };
      }
      return { terminator: "lbrace", boundaryIndex: ruleIndex, malformed: false };
    }
    if (token.kind === "lparen") closers.push("rparen");
    else if (token.kind === "lbracket") closers.push("rbracket");
    else if (token.kind === "rparen" || token.kind === "rbracket") {
      if (closers.pop() !== token.kind) malformed = true;
    }

    if (
      closers.length === 0 &&
      token.kind === "ident" &&
      index > startIndex &&
      startsNewLine(tokens[index - 1]) &&
      looksLikeProperty(tokens, index + 1, eofOffset)
    ) {
      return { terminator: "next-declaration", boundaryIndex: index, malformed };
    }

    index++;
  }
}

function endOfRawRange(
  tokens: readonly Token[],
  start: number,
  end: number,
  fallback: number,
): number {
  const last = lastContentIndex(tokens, start, end);
  return last >= start ? (tokens[last]?.end ?? fallback) : fallback;
}

/**
 * Parse one `property: value [@alias value]... ;` declaration.
 *
 * Terminator policy (ADR-0011): a plain CSS final declaration without `;`
 * before `}` is accepted; one carrying a modifier or `$` reference is reported
 * as XESSA1002 and omitted. A declaration that runs into a nested rule's `{`
 * is reported as XESSA1002, kept, and parsing resumes at that rule, so the
 * authored value and the nested rule both survive. Malformed values report
 * XESSA1003 once and recover at the next statement boundary. The returned node
 * is frozen and its span stops at the last value character, excluding the `;`.
 */
export function parseDeclaration(ctx: ParseContext): Declaration | undefined {
  const { cursor, bag } = ctx;
  const tokens = cursor.tokens;
  const file = cursor.file;
  const startIndex = cursor.index;
  const propertyToken = cursor.current();

  const colonIndex = findPropertyColon(tokens, startIndex, cursor.endOffset);
  if (colonIndex === -1) {
    bag.add("XESSA1001", messages.unexpectedStatement, cursor.span(propertyToken));
    recoverStatement(cursor);
    return undefined;
  }

  const propertyBounds = trimWhitespace(tokens, startIndex, colonIndex);
  const property = cursor.text(propertyBounds.start, propertyBounds.end);
  if (property.length === 0) {
    bag.add("XESSA1001", messages.emptyProperty, cursor.span(propertyToken));
    recoverStatement(cursor);
    return undefined;
  }

  const valueStart = colonIndex + 1;
  const scan = scanValue(tokens, startIndex, valueStart, cursor.endOffset);
  const valueBounds = trimWhitespace(tokens, valueStart, scan.boundaryIndex);
  const colonToken = tokenAt(tokens, colonIndex, cursor.endOffset);
  const boundaryToken = tokenAt(tokens, scan.boundaryIndex, cursor.endOffset);
  const valueEnd = endOfRawRange(tokens, valueStart, scan.boundaryIndex, colonToken.end);

  const statementSpan = { start: propertyToken.start, end: valueEnd, file };

  if (scan.malformed) {
    bag.add("XESSA1003", messages.malformedValue, {
      start: propertyToken.start,
      end: scan.terminator === "lbrace" ? valueEnd : boundaryToken.end,
      file,
    });
    if (scan.terminator === "lbrace") {
      cursor.index = skipBalancedBlock(tokens, scan.boundaryIndex, cursor.endOffset);
    } else if (scan.terminator === "semicolon") {
      cursor.index = scan.boundaryIndex + 1;
    } else {
      cursor.index = Math.min(scan.boundaryIndex, tokens.length);
    }
    return undefined;
  }

  const parts = segmentValue(tokens, valueBounds.start, valueBounds.end, file);
  const xessaValue =
    parts.variants.length > 0 || containsDollarRef(tokens, valueStart, scan.boundaryIndex);

  const declaration: Declaration = Object.freeze({
    kind: "declaration",
    property,
    value: parts.base.value,
    ...(parts.base.tokens === undefined ? {} : { tokens: parts.base.tokens }),
    variants: parts.variants,
    ...(parts.base.important === undefined ? {} : { important: parts.base.important }),
    span: statementSpan,
  });

  if (scan.terminator === "semicolon") {
    cursor.index = scan.boundaryIndex + 1;
    return declaration;
  }
  if (scan.terminator === "next-declaration") {
    bag.add("XESSA1002", messages.missingSemicolon("a declaration"), statementSpan);
    cursor.index = Math.min(scan.boundaryIndex, tokens.length);
    return undefined;
  }
  if (scan.terminator === "lbrace") {
    // `color: red` immediately before `&:hover { … }`: the declaration lost its
    // semicolon. Keep the authored declaration, report once and resume at the
    // nested rule so it still parses (ADR-0011, invariant 2).
    bag.add("XESSA1002", messages.missingSemicolon("a declaration"), statementSpan);
    cursor.index = Math.min(scan.boundaryIndex, tokens.length);
    return declaration;
  }
  if (xessaValue) {
    bag.add("XESSA1002", messages.missingSemicolon("a Xessa declaration"), statementSpan);
    cursor.index = Math.min(scan.boundaryIndex, tokens.length);
    return undefined;
  }
  cursor.index = Math.min(scan.boundaryIndex, tokens.length);
  return declaration;
}
