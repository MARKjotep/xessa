/**
 * Lexer unit tests: token shapes, the lossless invariant, `@`/`$` boundaries and
 * recovery. Every expectation is derived from the frozen `Token` JSDoc and
 * SPECIFICATION.md §3.1; none of them uses parser knowledge.
 */

import { describe, expect, test } from "bun:test";
import { tokenize } from "../../packages/compiler/src/lexer/index.ts";
import type { Token } from "../../packages/compiler/src/types/token.ts";

const FILE = "src/lexer-unit.cssx";

function run(source: string): readonly Token[] {
  return tokenize(source, FILE).tokens;
}

function kinds(source: string): readonly string[] {
  return run(source).map((token) => token.kind);
}

function slice(source: string, token: Token): string {
  return source.slice(token.start, token.end);
}

describe("tokenize stream invariants", () => {
  test("empty source yields only eof", () => {
    const { tokens, diagnostics } = tokenize("", FILE);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("eof");
    expect(tokens[0]?.value).toBe("");
    expect(tokens[0]?.start).toBe(0);
    expect(tokens[0]?.end).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  test("ends every stream with exactly one zero-width eof", () => {
    for (const source of ["", "a", "  ", "/* x */", "@md", "url(a)"]) {
      const tokens = run(source);
      const eofs = tokens.filter((token) => token.kind === "eof");
      expect(eofs).toHaveLength(1);
      const last = tokens[tokens.length - 1];
      expect(last?.kind).toBe("eof");
      expect(last?.start).toBe(source.length);
      expect(last?.end).toBe(source.length);
      expect(last?.value).toBe("");
    }
  });

  test("spans are contiguous half-open offsets that reproduce the source", () => {
    const source = '.a{color:red} @media (min-width: 10px){b:c} url("x@y") $v';
    const tokens = run(source);
    let offset = 0;
    for (const token of tokens) {
      expect(token.start).toBe(offset);
      expect(token.end).toBeGreaterThanOrEqual(token.start);
      if (token.kind !== "eof") expect(token.end).toBeGreaterThan(token.start);
      offset = token.end;
    }
    expect(offset).toBe(source.length);
    expect(tokens.map((token) => slice(source, token)).join("")).toBe(source);
    // The frozen contract keeps `value` equal to the covered slice for every
    // kind; `function` only differs from an inclusive-with-paren reading.
    for (const token of tokens) expect(token.value).toBe(slice(source, token));
  });

  test("whitespace runs and comments are their own fidelity tokens", () => {
    expect(kinds("a \n\t b")).toEqual(["ident", "whitespace", "ident", "eof"]);
    expect(kinds("/* one */a/*two*/")).toEqual(["comment", "ident", "comment", "eof"]);
    const tokens = run("  \r\n  ");
    expect(tokens[0]?.value).toBe("  \r\n  ");
  });

  test("never emits modifier: classification belongs to the parser", () => {
    const sources = [
      "@media screen { .a { color: red } }",
      ".card { padding: 12px @md 20px; }",
      ".card { background: white @xl+dark #101010; }",
      "@md { display: grid; }",
      "$theme.primary",
    ];
    for (const source of sources) {
      expect(run(source).some((token) => token.kind === "modifier")).toBe(false);
    }
  });
});

describe("strings, comments and urls", () => {
  test("keeps strings raw, including quotes and escaped quotes", () => {
    const source = String.raw`quotes: "\"quoted\" @xl"; other: 'single';`;
    const strings = run(source).filter((token) => token.kind === "string");
    expect(strings.map((token) => token.value)).toEqual([String.raw`"\"quoted\" @xl"`, "'single'"]);
    expect(strings.every((token) => token.value === slice(source, token))).toBe(true);
  });

  test("keeps @ and $ inert inside strings and comments", () => {
    const source = `content: "@dark $gap @md"; /* @lg $x */`;
    expect(kinds(source)).toEqual([
      "ident",
      "colon",
      "whitespace",
      "string",
      "semicolon",
      "whitespace",
      "comment",
      "eof",
    ]);
  });

  test("emits one url token for quoted and unquoted paths", () => {
    const source = `url("image@2x.png") url(image@2x.png) url() url( a\\)b.png )`;
    const tokens = run(source);
    expect(tokens.filter((token) => token.kind === "url").map((token) => token.value)).toEqual([
      `url("image@2x.png")`,
      "url(image@2x.png)",
      "url()",
      "url( a\\)b.png )",
    ]);
  });

  test("recognises url case-insensitively but only without whitespace", () => {
    expect(kinds("URL(x)")).toEqual(["url", "eof"]);
    expect(kinds("url (x)")).toEqual(["ident", "whitespace", "lparen", "ident", "rparen", "eof"]);
  });

  test("keeps a url's interior brackets out of the token stream", () => {
    const source = 'url("a(b)[c]")';
    expect(kinds(source)).toEqual(["url", "eof"]);
    expect(run(source)[0]?.value).toBe('url("a(b)[c]")');
  });
});

describe("functions, numbers, hashes and references", () => {
  test("emits a function name without its parenthesis, then a separate lparen", () => {
    const tokens = run("calc(1px)");
    expect(tokens.map((token) => token.kind)).toEqual([
      "function",
      "lparen",
      "number",
      "rparen",
      "eof",
    ]);
    expect(tokens[0]?.value).toBe("calc");
    expect(tokens[0]?.end).toBe(4);
    expect(tokens[1]?.start).toBe(4);
  });

  test("keeps units, fractions, exponents and percentages in one number token", () => {
    const source = "12 0.5 .5em -2px 1e3 10e3px 100% 12-3";
    expect(
      run(source)
        .filter((token) => token.kind === "number")
        .map((token) => token.value),
    ).toEqual(["12", "0.5", ".5em", "-2px", "1e3", "10e3px", "100%", "12-3"]);
  });

  test("scans hash values and rejects a bare hash", () => {
    expect(run("#2563eb").map((token) => [token.kind, token.value])).toEqual([
      ["hash", "#2563eb"],
      ["eof", ""],
    ]);
    expect(kinds("#")).toEqual(["delim", "eof"]);
  });

  test("scans $name and $name.member as single dollar-refs", () => {
    const source = "$spacing $theme.primary";
    const refs = run(source).filter((token) => token.kind === "dollar-ref");
    expect(refs.map((token) => token.value)).toEqual(["$spacing", "$theme.primary"]);
    // The frozen JSDoc lists exactly two forms, so a second member stays apart.
    expect(kinds("$a.b.c")).toEqual(["dollar-ref", "delim", "ident", "eof"]);
    expect(kinds("$ .x")).toEqual(["delim", "whitespace", "delim", "ident", "eof"]);
  });

  test("emits at-keyword for directives, aliases and digit-leading aliases", () => {
    const source = "@media @setup @md @2xl @md-types";
    const keywords = run(source).filter((token) => token.kind === "at-keyword");
    expect(keywords.map((token) => token.value)).toEqual([
      "@media",
      "@setup",
      "@md",
      "@2xl",
      "@md-types",
    ]);
    expect(kinds('@ @"x"')).toEqual(["delim", "whitespace", "delim", "string", "eof"]);
  });

  test("splits a combined alias into at-keyword, plus and ident", () => {
    expect(kinds("@xl+dark")).toEqual(["at-keyword", "delim", "ident", "eof"]);
    expect(run("@xl+dark").map((token) => token.value)).toEqual(["@xl", "+", "dark", ""]);
  });

  test("leaves 12px@md adjacent with no injected whitespace", () => {
    const tokens = run("12px@md");
    expect(tokens.map((token) => token.kind)).toEqual(["number", "at-keyword", "eof"]);
    expect(tokens[0]?.end).toBe(tokens[1]?.start);
  });

  test("preserves escapes verbatim and never decodes them", () => {
    const source = String.raw`\31 23 status\:active .status\:active`;
    const tokens = run(source);
    expect(tokens.filter((token) => token.kind === "ident").map((token) => token.value)).toEqual([
      String.raw`\31 23`,
      String.raw`status\:active`,
      String.raw`status\:active`,
    ]);
    expect(tokens[4]?.kind).toBe("delim");
    expect(tokens[4]?.value).toBe(".");
  });

  test("maps punctuation, braces and delimiters to their frozen kinds", () => {
    expect(kinds("{}(),;:[]")).toEqual([
      "lbrace",
      "rbrace",
      "lparen",
      "rparen",
      "comma",
      "semicolon",
      "colon",
      "lbracket",
      "rbracket",
      "eof",
    ]);
    const delimiters = "!&>+*/%|~=?#.@^";
    const expected = [...delimiters].map(() => "delim");
    expected.push("eof");
    expect(kinds(delimiters)).toEqual(expected);
    expect(run("!important").map((token) => [token.kind, token.value])).toEqual([
      ["delim", "!"],
      ["ident", "important"],
      ["eof", ""],
    ]);
  });
});

describe("lexical diagnostics and recovery", () => {
  function only(source: string) {
    const { diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    if (diagnostic === undefined) throw new Error("expected one diagnostic");
    return diagnostic;
  }

  test("reports an unterminated string at end of file and still emits eof", () => {
    const source = `content: "abc`;
    const { tokens, diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA1001");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("Unterminated string");
    expect(diagnostics[0]?.span.file).toBe(FILE);
    expect(diagnostics[0]?.span.start).toBe(9);
    expect(diagnostics[0]?.span.end).toBe(source.length);
    expect(tokens[tokens.length - 1]?.kind).toBe("eof");
  });

  test("recovers from an unterminated string at the line break", () => {
    const source = '.a { content: "oops\n color: red; }';
    const { tokens, diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.span.end).toBe(source.indexOf("\n"));
    // The `}` and the following declaration are lexed normally again.
    expect(tokens.filter((token) => token.kind === "rbrace")).toHaveLength(1);
    expect(tokens.filter((token) => token.kind === "semicolon")).toHaveLength(1);
    expect(tokens[tokens.length - 1]?.kind).toBe("eof");
  });

  test("reports an unterminated comment", () => {
    const diagnostic = only("/* @md $x");
    expect(diagnostic.message).toContain("Unterminated comment");
    expect(diagnostic.span).toEqual({ start: 0, end: 9, file: FILE });
  });

  test("reports an unterminated url", () => {
    const diagnostic = only("url(a.png");
    expect(diagnostic.message).toContain("Unterminated url");
    expect(diagnostic.span).toEqual({ start: 0, end: 9, file: FILE });
    // A closed quoted path with no closing parenthesis is still unterminated.
    expect(only('url("a"').message).toContain("Unterminated url");
  });

  test("reports a malformed quoted url after a recoverable boundary", () => {
    const source = 'url("a" b)';
    const { tokens, diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Malformed url");
    expect(tokens[0]?.kind).toBe("url");
    expect(tokens[0]?.end).toBe(8);
    expect(tokens.map((token) => token.kind)).toEqual(["url", "ident", "rparen", "eof"]);
  });

  test("reports illegal control characters and keeps them as delims", () => {
    const source = "a\u0000b";
    const { tokens, diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("U+0000");
    expect(diagnostics[0]?.span).toEqual({ start: 1, end: 2, file: FILE });
    expect(tokens.map((token) => token.kind)).toEqual(["ident", "delim", "ident", "eof"]);
  });

  test("reports a dangling escape instead of throwing", () => {
    const source = "a\\";
    const { tokens, diagnostics } = tokenize(source, FILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Invalid escape");
    expect(tokens.map((token) => token.kind)).toEqual(["ident", "delim", "eof"]);
  });

  test("keeps every diagnostic span inside the source", () => {
    const sources = [
      `"`,
      `'abc`,
      "/*",
      "url(",
      'url("a',
      'url("a" b)',
      "\u0001\u0002",
      "\\",
      '"\\',
      "'\r\n",
    ];
    for (const source of sources) {
      const { tokens, diagnostics } = tokenize(source, FILE);
      for (const diagnostic of diagnostics) {
        expect(diagnostic.code).toBe("XESSA1001");
        expect(diagnostic.severity).toBe("error");
        expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
        expect(diagnostic.span.start).toBeLessThanOrEqual(diagnostic.span.end);
      }
      expect(tokens[tokens.length - 1]?.kind).toBe("eof");
    }
  });
});

describe("group dotted form", () => {
  test("@group.<name> stays three adjacent tokens", () => {
    const source = "@group.card";
    const tokens = run(source);
    expect(tokens.map((token) => token.kind)).toEqual(["at-keyword", "delim", "ident", "eof"]);
    expect(tokens.map((token) => token.value)).toEqual(["@group", ".", "card", ""]);
    expect(tokens[0]?.end).toBe(tokens[1]?.start);
    expect(tokens[1]?.end).toBe(tokens[2]?.start);
    expect(tokens[0]?.value).toBe("@group");
  });

  test("@group.keyframes keeps keyframes as an ordinary name", () => {
    const tokens = run("@group.keyframes");
    expect(tokens.map((token) => token.kind)).toEqual(["at-keyword", "delim", "ident", "eof"]);
    expect(tokens[2]?.value).toBe("keyframes");
    // No native at-rule token is produced: the name is data for the parser.
    expect(
      tokens.some((token) => token.kind === "at-keyword" && token.value === "@keyframes"),
    ).toBe(false);
  });

  test("whitespace inside the dotted form is visible as a token", () => {
    expect(kinds("@group .card")).toEqual(["at-keyword", "whitespace", "delim", "ident", "eof"]);
    expect(kinds("@group. card")).toEqual(["at-keyword", "delim", "whitespace", "ident", "eof"]);
    expect(kinds("@group\n.card")).toEqual(["at-keyword", "whitespace", "delim", "ident", "eof"]);
    expect(kinds("@group/* gap */.card")).toEqual([
      "at-keyword",
      "comment",
      "delim",
      "ident",
      "eof",
    ]);
  });

  test("a missing or non-identifier name never becomes a dotted construct", () => {
    expect(kinds("@group")).toEqual(["at-keyword", "eof"]);
    expect(kinds("@group.")).toEqual(["at-keyword", "delim", "eof"]);
    // `@group.2xl`: a digit-leading tail is one number token, so the parser can
    // reject it as a non-identifier group name.
    expect(kinds("@group.2xl")).toEqual(["at-keyword", "number", "eof"]);
    expect(run("@group.2xl")[1]?.value).toBe(".2xl");
    expect(kinds("@group.-x")).toEqual(["at-keyword", "delim", "ident", "eof"]);
  });
});

describe("termination", () => {
  test("tokenizes adversarial input without throwing or looping", () => {
    const sources = [
      "@".repeat(5000),
      "/".repeat(5000),
      "*".repeat(5000),
      "\\".repeat(5000),
      '"'.repeat(3000),
      "/*".repeat(2000),
      "url(".repeat(1000),
      "a".repeat(50000),
      "@md ".repeat(4000),
      `${"$".repeat(2000)}x`,
      `url("${"@".repeat(1000)}`,
      '"\\'.repeat(2000),
    ];
    for (const source of sources) {
      const { tokens } = tokenize(source, FILE);
      expect(tokens[tokens.length - 1]?.kind).toBe("eof");
      expect(tokens.length).toBeLessThanOrEqual(source.length + 1);
      expect(tokens.map((token) => slice(source, token)).join("")).toBe(source);
    }
  });
});
