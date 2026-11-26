/**
 * Lexer invariants: losslessness, coverage, eof termination, diagnostic
 * well-formedness and the absence of `modifier`. Inputs are exhaustive over a
 * hostile mini alphabet and randomized beyond it, so any unbounded loop or
 * dropped character fails here rather than in P7's fuzz run.
 */

import { describe, expect, test } from "bun:test";
import { tokenize } from "../../packages/compiler/src/lexer/index.ts";

const FILE = "src/fuzz.cssx";

/** Every frozen `TokenKind`; the lexer may emit all but `modifier`. */
const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "ident",
  "number",
  "string",
  "url",
  "function",
  "delim",
  "colon",
  "semicolon",
  "comma",
  "lbrace",
  "rbrace",
  "lparen",
  "rparen",
  "lbracket",
  "rbracket",
  "hash",
  "at-keyword",
  "dollar-ref",
  "modifier",
  "whitespace",
  "comment",
  "eof",
]);

/**
 * Assert every stream invariant for one source. Failures carry the source text
 * so a fuzz failure is reproducible without a seed log.
 */
function assertInvariants(source: string): void {
  let result: ReturnType<typeof tokenize>;
  try {
    result = tokenize(source, FILE);
  } catch (error) {
    throw new Error(`tokenize threw for ${JSON.stringify(source)}: ${String(error)}`);
  }

  const { tokens, diagnostics } = result;

  expect({ source, empty: tokens.length === 0 }).toEqual({ source, empty: false });

  const last = tokens[tokens.length - 1];
  expect({ source, lastKind: last?.kind }).toEqual({ source, lastKind: "eof" });
  expect({ source, eofs: tokens.filter((token) => token.kind === "eof").length }).toEqual({
    source,
    eofs: 1,
  });
  expect({ source, eofStart: last?.start, eofEnd: last?.end }).toEqual({
    source,
    eofStart: source.length,
    eofEnd: source.length,
  });

  let offset = 0;
  for (const token of tokens) {
    expect({ source, kind: token.kind, known: KNOWN_KINDS.has(token.kind) }).toEqual({
      source,
      kind: token.kind,
      known: true,
    });
    expect({ source, modifier: token.kind === "modifier" }).toEqual({ source, modifier: false });
    expect({ source, start: token.start, offset }).toEqual({ source, start: offset, offset });
    if (token.kind !== "eof") {
      expect({ source, kind: token.kind, forward: token.end > token.start }).toEqual({
        source,
        kind: token.kind,
        forward: true,
      });
    }
    expect({ source, value: token.value }).toEqual({
      source,
      value: source.slice(token.start, token.end),
    });
    offset = token.end;
  }
  expect({ source, covered: offset }).toEqual({ source, covered: source.length });

  // Every token but eof consumes at least one code unit, so this bounds the loop.
  expect({ source, bounded: tokens.length <= source.length + 1 }).toEqual({
    source,
    bounded: true,
  });

  let previousStart = -1;
  for (const diagnostic of diagnostics) {
    expect({ source, code: diagnostic.code, severity: diagnostic.severity }).toEqual({
      source,
      code: "XESSA1001",
      severity: "error",
    });
    expect({
      source,
      inside:
        diagnostic.span.start >= 0 &&
        diagnostic.span.end <= source.length &&
        diagnostic.span.start <= diagnostic.span.end,
    }).toEqual({ source, inside: true });
    expect({ source, ordered: diagnostic.span.start >= previousStart }).toEqual({
      source,
      ordered: true,
    });
    previousStart = diagnostic.span.start;
  }
}

function* strings(alphabet: readonly string[], maxLength: number): Generator<string> {
  const build = function* (prefix: string, remaining: number): Generator<string> {
    if (prefix.length > 0) yield prefix;
    if (remaining === 0) return;
    for (const character of alphabet) {
      yield* build(prefix + character, remaining - 1);
    }
  };
  yield* build("", maxLength);
}

describe("lexer invariants", () => {
  test("holds for every source over a hostile alphabet up to length four", () => {
    const alphabet = ["@", "$", '"', "\\", "/", "*", "a", "1", ")", "}"];
    let checked = 0;
    for (const source of strings(alphabet, 4)) {
      assertInvariants(source);
      checked += 1;
    }
    expect(checked).toBe(11110);
  });

  test("holds for deterministic pseudo-random sources", () => {
    const alphabet = [
      ..."@$\"'\\/*{}()[];:,#+-.!%&|~=<>?^_ \n\r\t0123456789abcxyzURL",
      "\u0000",
      "\u0007",
      "é",
    ];
    let state = 0x2f6e2b1;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state;
    };

    for (let iteration = 0; iteration < 1500; iteration += 1) {
      const length = next() % 160;
      let source = "";
      for (let index = 0; index < length; index += 1) {
        const character = alphabet[next() % alphabet.length];
        source += character ?? "";
      }
      assertInvariants(source);
    }
  });

  test("keeps large single-token runs linear and terminated", () => {
    const sources = [
      "@".repeat(20000),
      "a".repeat(20000),
      " ".repeat(20000),
      '"'.repeat(20000),
      "/*".repeat(10000),
      "url(".repeat(5000),
      "\\".repeat(20000),
      `url("${"a".repeat(20000)}")`,
    ];
    for (const source of sources) {
      assertInvariants(source);
    }
  });
});
