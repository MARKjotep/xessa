/**
 * Lexical fixture tests.
 *
 * Every `tests/fixtures/lexical/*` input is tokenized and pinned: the exact kind
 * sequence, the lossless round-trip, a single trailing `eof`, no lexical
 * diagnostics, and the `@`-boundary facts that SPECIFICATION.md §3.1 and the
 * frozen `Token` JSDoc rely on. The helper at the bottom replays brace and
 * parenthesis depth over the token stream to show which `at-keyword` tokens sit
 * in a position the parser may promote to `modifier` — the lexer itself never
 * makes that decision.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "../../packages/compiler/src/lexer/index.ts";
import type { Token } from "../../packages/compiler/src/types/token.ts";

const FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "lexical");

interface Fixture {
  readonly id: string;
  readonly source: string;
  readonly tokens: readonly Token[];
}

function load(id: string): Fixture {
  const source = readFileSync(join(FIXTURE_DIR, id, "input.cssx"), "utf8");
  return { id, source, tokens: tokenize(source, `${id}/input.cssx`).tokens };
}

const fixtureIds = readdirSync(FIXTURE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const fixtures = new Map(fixtureIds.map((id) => [id, load(id)]));

function fixture(id: string): Fixture {
  const loaded = fixtures.get(id);
  if (loaded === undefined) throw new Error(`missing lexical fixture: ${id}`);
  return loaded;
}

function kinds(tokens: readonly Token[]): readonly string[] {
  return tokens.map((token) => token.kind);
}

function values(tokens: readonly Token[], kind: string): readonly string[] {
  return tokens.filter((token) => token.kind === kind).map((token) => token.value);
}

describe("lexical fixture catalog", () => {
  test("covers every lexical fixture in the frozen catalog", () => {
    expect(fixtureIds).toEqual([
      "at-in-string",
      "at-mid-value",
      "calc",
      "comments-escapes",
      "final-no-semicolon",
      "no-whitespace-modifier",
      "url-at",
    ]);
  });

  test("every fixture round-trips byte for byte and ends with one eof", () => {
    for (const { id, source, tokens } of fixtures.values()) {
      const rebuilt = tokens.map((token) => source.slice(token.start, token.end)).join("");
      expect({ id, rebuilt }).toEqual({ id, rebuilt: source });
      const eofs = tokens.filter((token) => token.kind === "eof");
      expect({ id, eofs: eofs.length }).toEqual({ id, eofs: 1 });
      const last = tokens[tokens.length - 1];
      expect({ id, lastStart: last?.start, lastEnd: last?.end }).toEqual({
        id,
        lastStart: source.length,
        lastEnd: source.length,
      });
    }
  });

  test("no lexical fixture produces a diagnostic", () => {
    // Four fixtures author `[]`; the rest leave the compile expectation
    // unauthored (`null`). Lexically they are all valid source, which this pins.
    for (const id of fixtureIds) {
      const source = readFileSync(join(FIXTURE_DIR, id, "input.cssx"), "utf8");
      const diagnostics = tokenize(source, `${id}/input.cssx`).diagnostics;
      expect({ id, diagnostics }).toEqual({ id, diagnostics: [] });
    }
  });

  test("no lexical fixture emits a modifier token", () => {
    for (const { id, tokens } of fixtures.values()) {
      expect({ id, modifiers: values(tokens, "modifier") }).toEqual({ id, modifiers: [] });
    }
  });
});

describe("pinned token kind sequences", () => {
  const expected: Readonly<Record<string, readonly string[]>> = {
    "at-in-string": [
      "delim",
      "ident",
      "colon",
      "colon",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    "at-mid-value": [
      "at-keyword",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "url",
      "whitespace",
      "at-keyword",
      "whitespace",
      "ident",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    calc: [
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "function",
      "lparen",
      "number",
      "whitespace",
      "delim",
      "whitespace",
      "at-keyword",
      "whitespace",
      "number",
      "rparen",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "function",
      "lparen",
      "number",
      "whitespace",
      "delim",
      "whitespace",
      "number",
      "rparen",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    "comments-escapes": [
      "comment",
      "whitespace",
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "ident",
      "semicolon",
      "whitespace",
      "comment",
      "whitespace",
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "ident",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    "final-no-semicolon": [
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "ident",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "number",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    "no-whitespace-modifier": [
      "at-keyword",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "number",
      "at-keyword",
      "whitespace",
      "number",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
    "url-at": [
      "delim",
      "ident",
      "whitespace",
      "lbrace",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "url",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "url",
      "semicolon",
      "whitespace",
      "ident",
      "colon",
      "whitespace",
      "url",
      "whitespace",
      "number",
      "whitespace",
      "number",
      "comma",
      "whitespace",
      "ident",
      "semicolon",
      "whitespace",
      "rbrace",
      "whitespace",
      "eof",
    ],
  };

  for (const id of fixtureIds) {
    test(id, () => {
      expect(kinds(fixture(id).tokens)).toEqual(expected[id] ?? []);
    });
  }
});

/**
 * Position facts the parser needs to promote an `at-keyword` to `modifier`
 * (SPECIFICATION.md §3.1: top-level value depth, after whitespace, outside
 * functions). Derived from the token stream only.
 */
interface AtContext {
  readonly value: string;
  readonly braceDepth: number;
  readonly parenDepth: number;
  readonly precededByWhitespace: boolean;
  /** True at the start of a block body or statement, where no whitespace precedes. */
  readonly atBoundary: boolean;
  /** A position the parser may promote, per §3.1. */
  readonly promotable: boolean;
}

function atContexts(tokens: readonly Token[]): readonly AtContext[] {
  const contexts: AtContext[] = [];
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.kind === "lbrace") {
      braceDepth += 1;
      continue;
    }
    if (token.kind === "rbrace") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (token.kind === "lparen") {
      parenDepth += 1;
      continue;
    }
    if (token.kind === "rparen") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (token.kind !== "at-keyword") continue;

    const previous = tokens[index - 1];
    const precededByWhitespace = previous?.kind === "whitespace";
    const atBoundary =
      previous === undefined || previous.kind === "lbrace" || previous.kind === "semicolon";
    contexts.push({
      value: token.value,
      braceDepth,
      parenDepth,
      precededByWhitespace,
      atBoundary,
      promotable:
        braceDepth >= 1 &&
        parenDepth === 0 &&
        (precededByWhitespace || atBoundary) &&
        !token.value.includes("+"),
    });
  }
  return contexts;
}

describe("@ boundary behaviour pinned by the fixtures", () => {
  test("at-in-string: @ inside strings is literal content", () => {
    const { tokens, source } = fixture("at-in-string");
    expect(values(tokens, "at-keyword")).toEqual([]);
    expect(values(tokens, "string")).toEqual(['"@dark"', '"@md"', '"@xl+dark"']);
    expect(atContexts(tokens)).toEqual([]);
    expect(source).toContain('"@xl+dark"');
  });

  test("url-at: @ inside quoted and unquoted urls is literal", () => {
    const { tokens } = fixture("url-at");
    expect(values(tokens, "url")).toEqual([
      'url("image@2x.png")',
      "url(image@2x.png)",
      'url("icons/cursor@32.png")',
    ]);
    expect(values(tokens, "at-keyword")).toEqual([]);
    expect(atContexts(tokens)).toEqual([]);
  });

  test("at-mid-value: url @ stays inert, whitespace-preceded @md is a promotable position", () => {
    const { tokens } = fixture("at-mid-value");
    expect(values(tokens, "url")).toEqual(['url("a@b.png")']);
    const contexts = atContexts(tokens);
    expect(contexts).toEqual([
      {
        value: "@setup",
        braceDepth: 0,
        parenDepth: 0,
        precededByWhitespace: false,
        atBoundary: true,
        promotable: false,
      },
      {
        value: "@md",
        braceDepth: 1,
        parenDepth: 0,
        precededByWhitespace: true,
        atBoundary: false,
        promotable: true,
      },
    ]);
  });

  test("calc: a modifier-looking token inside a function is not promotable", () => {
    const { tokens } = fixture("calc");
    expect(values(tokens, "function")).toEqual(["calc", "calc"]);
    const contexts = atContexts(tokens);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toEqual({
      value: "@md",
      braceDepth: 1,
      parenDepth: 1,
      precededByWhitespace: true,
      atBoundary: false,
      promotable: false,
    });
  });

  test("no-whitespace-modifier: 12px@md leaves @md literal (no whitespace, no gap)", () => {
    const { tokens } = fixture("no-whitespace-modifier");
    const contexts = atContexts(tokens);
    expect(contexts).toEqual([
      {
        value: "@setup",
        braceDepth: 0,
        parenDepth: 0,
        precededByWhitespace: false,
        atBoundary: true,
        promotable: false,
      },
      {
        value: "@md",
        braceDepth: 1,
        parenDepth: 0,
        precededByWhitespace: false,
        atBoundary: false,
        promotable: false,
      },
    ]);

    const numberIndex = tokens.findIndex((token) => token.value === "12px");
    const atKeyword = tokens[numberIndex + 1];
    expect(atKeyword?.kind).toBe("at-keyword");
    expect(atKeyword?.value).toBe("@md");
    expect(tokens[numberIndex]?.end).toBe(atKeyword?.start);
  });

  test("comments-escapes: comments, quoted @ and escaped colons stay inert", () => {
    const { tokens } = fixture("comments-escapes");
    expect(values(tokens, "at-keyword")).toEqual([]);
    expect(values(tokens, "dollar-ref")).toEqual([]);
    expect(values(tokens, "comment")).toEqual([
      '/* Mentions @md, $radius and "strings" but must stay inert. */',
      "/* trailing @lg comment */",
    ]);
    expect(values(tokens, "ident")).toContain("--label");
    expect(values(tokens, "ident")).toContain(String.raw`status\:active`);
    expect(values(tokens, "string")).toContain(String.raw`"\"quoted\" @xl"`);
    expect(atContexts(tokens)).toEqual([]);
  });

  test("final-no-semicolon: a plain final declaration needs no terminator token", () => {
    const { tokens } = fixture("final-no-semicolon");
    const lastRbrace = tokens.findLastIndex((token) => token.kind === "rbrace");
    expect(tokens[lastRbrace - 1]?.kind).toBe("whitespace");
    expect(tokens[lastRbrace - 2]?.kind).toBe("number");
    expect(tokens[lastRbrace - 2]?.value).toBe("10px");
    expect(values(tokens, "semicolon")).toEqual([";"]);
  });
});
