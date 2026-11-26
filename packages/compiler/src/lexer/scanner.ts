/**
 * Stateful single-pass scanner: source text to tokens plus lexical diagnostics.
 *
 * The loop advances by whole tokens, and every token covers at least one source
 * code unit, so the scan terminates in at most `source.length + 1` iterations
 * for any input. There is no backtracking and no regular expression, and the
 * tokenizer never throws: malformed input produces recovered tokens plus
 * `XESSA1001` diagnostics and always ends with a single `eof` token.
 *
 * Whitespace runs and block comments become their own tokens so the stream
 * reproduces the source exactly. `@` classification is intentionally absent —
 * see `at-keywords.ts` and the frozen `modifier` JSDoc.
 */

import type { Diagnostic } from "../types/diagnostics.js";
import type { Token, TokenKind } from "../types/token.js";
import { scanAtKeyword } from "./at-keywords.js";
import { escapeEnd, isIllegalCode, isNameCode, isWhitespaceCode } from "./characters.js";
import { scanComment } from "./comments.js";
import { LEXICAL_MESSAGES, illegalCharacterMessage, lexicalError } from "./diagnostics.js";
import { scanDollarRef } from "./dollar-refs.js";
import { identEnd, isIdentStartAt, nameEnd } from "./names.js";
import { isNumberStartAt, numberEnd } from "./numbers.js";
import { scanString } from "./strings.js";
import { isUrlName, scanUrl } from "./urls.js";

/** Tokens and diagnostics produced by one scan. */
export interface ScanResult {
  /** Tokens in source order, always ending with exactly one zero-width `eof`. */
  readonly tokens: readonly Token[];
  /** Lexical errors in source order; empty for valid source. */
  readonly diagnostics: readonly Diagnostic[];
}

const PUNCTUATION: Readonly<Record<string, TokenKind>> = {
  ":": "colon",
  ";": "semicolon",
  ",": "comma",
  "{": "lbrace",
  "}": "rbrace",
  "(": "lparen",
  ")": "rparen",
  "[": "lbracket",
  "]": "rbracket",
};

const QUOTE_DOUBLE = 0x22;
const QUOTE_SINGLE = 0x27;
const BACKSLASH = 0x5c;
const SLASH = 0x2f;
const STAR = 0x2a;
const AT = 0x40;
const DOLLAR = 0x24;
const HASH = 0x23;
const OPEN_PAREN = 0x28;

function makeToken(
  kind: TokenKind,
  source: string,
  start: number,
  end: number,
  value?: string,
): Token {
  return { kind, value: value ?? source.slice(start, end), start, end };
}

/**
 * Scan `source` in one pass.
 *
 * `file` is copied into every diagnostic span; token spans stay plain offsets,
 * as the frozen `Span` contract requires.
 */
export function scan(source: string, file: string): ScanResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const length = source.length;
  let index = 0;

  while (index < length) {
    const code = source.charCodeAt(index);

    if (isWhitespaceCode(code)) {
      let end = index + 1;
      while (end < length && isWhitespaceCode(source.charCodeAt(end))) end += 1;
      tokens.push(makeToken("whitespace", source, index, end));
      index = end;
      continue;
    }

    if (code === SLASH && source.charCodeAt(index + 1) === STAR) {
      const comment = scanComment(source, index);
      tokens.push(makeToken("comment", source, index, comment.end));
      if (!comment.closed) {
        diagnostics.push(
          lexicalError(LEXICAL_MESSAGES.unterminatedComment, index, comment.end, file),
        );
      }
      index = comment.end;
      continue;
    }

    if (code === QUOTE_DOUBLE || code === QUOTE_SINGLE) {
      const literal = scanString(source, index);
      tokens.push(makeToken("string", source, index, literal.end));
      if (!literal.closed) {
        diagnostics.push(
          lexicalError(LEXICAL_MESSAGES.unterminatedString, index, literal.end, file),
        );
      }
      index = literal.end;
      continue;
    }

    if (code === AT) {
      const end = scanAtKeyword(source, index);
      tokens.push(makeToken(end > index + 1 ? "at-keyword" : "delim", source, index, end));
      index = end;
      continue;
    }

    if (code === DOLLAR) {
      const end = scanDollarRef(source, index);
      if (end === null) {
        tokens.push(makeToken("delim", source, index, index + 1));
        index += 1;
      } else {
        tokens.push(makeToken("dollar-ref", source, index, end));
        index = end;
      }
      continue;
    }

    if (code === HASH) {
      const nameStart = index + 1;
      const named =
        isNameCode(source.charCodeAt(nameStart)) || escapeEnd(source, nameStart) > nameStart;
      const end = named ? nameEnd(source, nameStart) : index + 1;
      tokens.push(makeToken(named ? "hash" : "delim", source, index, end));
      index = end;
      continue;
    }

    if (isNumberStartAt(source, index)) {
      const end = numberEnd(source, index);
      tokens.push(makeToken("number", source, index, end));
      index = end;
      continue;
    }

    if (isIdentStartAt(source, index)) {
      const end = identEnd(source, index);
      if (source.charCodeAt(end) === OPEN_PAREN) {
        const name = source.slice(index, end);
        if (isUrlName(source, index, end)) {
          const url = scanUrl(source, end);
          tokens.push(makeToken("url", source, index, url.end));
          if (url.problem !== null) {
            diagnostics.push(
              lexicalError(
                url.problem === "malformed"
                  ? LEXICAL_MESSAGES.malformedUrl
                  : LEXICAL_MESSAGES.unterminatedUrl,
                index,
                url.end,
                file,
              ),
            );
          }
          index = url.end;
          continue;
        }
        tokens.push(makeToken("function", source, index, end, name));
        index = end;
        continue;
      }
      tokens.push(makeToken("ident", source, index, end));
      index = end;
      continue;
    }

    const punctuation = PUNCTUATION[source.charAt(index)];
    if (punctuation !== undefined) {
      tokens.push(makeToken(punctuation, source, index, index + 1));
      index += 1;
      continue;
    }

    if (code === BACKSLASH) {
      diagnostics.push(lexicalError(LEXICAL_MESSAGES.invalidEscape, index, index + 1, file));
    } else if (isIllegalCode(code)) {
      diagnostics.push(lexicalError(illegalCharacterMessage(code), index, index + 1, file));
    }
    tokens.push(makeToken("delim", source, index, index + 1));
    index += 1;
  }

  tokens.push({ kind: "eof", value: "", start: length, end: length });
  return { tokens, diagnostics };
}
