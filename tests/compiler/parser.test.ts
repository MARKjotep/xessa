import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseTokens } from "../../packages/compiler/src/parser/index.ts";
import type {
  ConditionalBlock,
  Declaration,
  Rule,
  Stylesheet,
  StylesheetItem,
  UseImport,
} from "../../packages/compiler/src/types/ast.ts";
import type { Diagnostic } from "../../packages/compiler/src/types/diagnostics.ts";
import type { Span } from "../../packages/compiler/src/types/span.ts";
import type { Token, TokenKind } from "../../packages/compiler/src/types/token.ts";

/**
 * Test-only token scanner.
 *
 * The lexer is task A03's owned module and does not exist yet, so parser tests
 * build contract-faithful streams locally: token kinds, values and half-open
 * offsets follow `types/token.ts`, whitespace and comments are emitted, and a
 * `function` token excludes its `(`. The parser never sees the source text.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const length = source.length;
  let index = 0;

  const push = (kind: TokenKind, start: number, end: number, value?: string): void => {
    tokens.push({ kind, value: value ?? source.slice(start, end), start, end });
  };
  const charAt = (position: number): string => source.charAt(position);
  const isDigit = (char: string): boolean => char >= "0" && char <= "9";
  const isNameChar = (char: string): boolean =>
    /[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) >= 0x80;
  const isNameStart = (char: string): boolean =>
    /[A-Za-z_]/.test(char) || char.charCodeAt(0) >= 0x80;

  const readEscape = (position: number): number => {
    let cursor = position + 1;
    if (cursor >= length) return cursor;
    let hex = 0;
    while (hex < 6 && /[0-9a-fA-F]/.test(charAt(cursor + hex))) hex++;
    if (hex > 0) {
      cursor += hex;
      if (charAt(cursor) === " ") cursor++;
      return cursor;
    }
    return cursor + 1;
  };

  const readName = (position: number): number => {
    let cursor = position;
    while (cursor < length) {
      const char = charAt(cursor);
      if (char === "\\") {
        cursor = readEscape(cursor);
        continue;
      }
      if (isNameChar(char)) {
        cursor++;
        continue;
      }
      break;
    }
    return cursor;
  };

  while (index < length) {
    const char = charAt(index);

    if (/\s/.test(char)) {
      const start = index;
      while (index < length && /\s/.test(charAt(index))) index++;
      push("whitespace", start, index);
      continue;
    }

    if (char === "/" && charAt(index + 1) === "*") {
      const start = index;
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? length : close + 2;
      push("comment", start, index);
      continue;
    }

    if (char === '"' || char === "'") {
      const start = index;
      let cursor = index + 1;
      while (cursor < length) {
        const current = charAt(cursor);
        if (current === "\\") {
          cursor += 2;
          continue;
        }
        if (current === char) {
          cursor++;
          break;
        }
        cursor++;
      }
      index = Math.min(cursor, length);
      push("string", start, index);
      continue;
    }

    if (source.slice(index, index + 4).toLowerCase() === "url(") {
      const start = index;
      let cursor = index + 4;
      let depth = 1;
      while (cursor < length) {
        const current = charAt(cursor);
        if (current === "\\") {
          cursor += 2;
          continue;
        }
        if (current === "(") {
          depth++;
          cursor++;
          continue;
        }
        if (current === ")") {
          depth--;
          cursor++;
          if (depth === 0) break;
          continue;
        }
        if (current === '"' || current === "'") {
          const quote = current;
          cursor++;
          while (cursor < length) {
            const inner = charAt(cursor);
            if (inner === "\\") {
              cursor += 2;
              continue;
            }
            if (inner === quote) {
              cursor++;
              break;
            }
            cursor++;
          }
          continue;
        }
        cursor++;
      }
      index = Math.min(cursor, length);
      push("url", start, index);
      continue;
    }

    if (char === "@") {
      const start = index;
      let cursor = readName(index + 1);
      while (charAt(cursor) === "+") {
        const next = charAt(cursor + 1);
        if (!(isNameStart(next) || isDigit(next) || next === "\\")) break;
        const afterAlias = readName(cursor + 1);
        if (afterAlias === cursor + 1) break;
        cursor = afterAlias;
      }
      index = cursor;
      push("at-keyword", start, index);
      continue;
    }

    if (char === "$") {
      const start = index;
      let cursor = readName(index + 1);
      while (
        charAt(cursor) === "." &&
        (isNameStart(charAt(cursor + 1)) || isDigit(charAt(cursor + 1)))
      ) {
        const afterMember = readName(cursor + 1);
        if (afterMember === cursor + 1) break;
        cursor = afterMember;
      }
      index = cursor;
      push("dollar-ref", start, index);
      continue;
    }

    if (char === "#") {
      const start = index;
      index = readName(index + 1);
      push("hash", start, index);
      continue;
    }

    if (
      isDigit(char) ||
      (char === "." && isDigit(charAt(index + 1))) ||
      (char === "-" && (isDigit(charAt(index + 1)) || charAt(index + 1) === "."))
    ) {
      const start = index;
      let cursor = index;
      if (charAt(cursor) === "-" || charAt(cursor) === "+") cursor++;
      while (isDigit(charAt(cursor)) || charAt(cursor) === ".") cursor++;
      if (charAt(cursor) === "%") cursor++;
      else cursor = readName(cursor);
      index = cursor;
      push("number", start, index);
      continue;
    }

    const dashIdent =
      char === "-" &&
      (isNameStart(charAt(index + 1)) || charAt(index + 1) === "-" || charAt(index + 1) === "\\");
    if (isNameStart(char) || char === "\\" || dashIdent) {
      const start = index;
      const end = readName(index);
      if (end > start) {
        if (charAt(end) === "(") {
          push("function", start, end, source.slice(start, end));
          index = end;
          continue;
        }
        push("ident", start, end);
        index = end;
        continue;
      }
    }

    const single: Record<string, TokenKind> = {
      "{": "lbrace",
      "}": "rbrace",
      "(": "lparen",
      ")": "rparen",
      "[": "lbracket",
      "]": "rbracket",
      ":": "colon",
      ";": "semicolon",
      ",": "comma",
    };
    const kind = single[char];
    if (kind !== undefined) {
      push(kind, index, index + 1);
      index++;
      continue;
    }
    push("delim", index, index + 1);
    index++;
  }

  push("eof", length, length);
  return tokens;
}

const file = "src/sample.cssx";

function parseSource(
  source: string,
  sourceFile = file,
): { ast: Stylesheet; diagnostics: readonly Diagnostic[] } {
  return parseTokens(tokenize(source), sourceFile);
}

function indexOfText(source: string, needle: string, from = 0): number {
  const index = source.indexOf(needle, from);
  if (index === -1) throw new Error(`missing needle: ${needle}`);
  return index;
}

function endOfText(source: string, needle: string, from = 0): number {
  return indexOfText(source, needle, from) + needle.length;
}

function spanFor(sourceFile: string, start: number, end: number): Span {
  return { start, end, file: sourceFile };
}

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

function fixtureSource(id: string, entry = "input.cssx"): string {
  return readFileSync(join(fixturesRoot, id, entry), "utf8");
}

interface ExpectedDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly messageContains: string;
  readonly span: { readonly line: number; readonly col: number };
}

function expectedDiagnostics(id: string): readonly ExpectedDiagnostic[] | null {
  const text = readFileSync(join(fixturesRoot, id, "expected", "diagnostics.json"), "utf8");
  return JSON.parse(text) as readonly ExpectedDiagnostic[] | null;
}

/** Offset of a 1-based line/column position. */
function offsetOfPosition(source: string, line: number, column: number): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
    currentLine++;
  }
  return Math.min(offset + column - 1, source.length);
}

function itemAt(ast: Stylesheet, index: number): StylesheetItem {
  const item = ast.items[index];
  if (item === undefined) throw new Error(`missing stylesheet item ${index}`);
  return item;
}

function expectRule(item: StylesheetItem): Rule {
  if (item.kind !== "rule") throw new Error(`expected rule, got ${item.kind}`);
  return item;
}

function expectDeclaration(item: StylesheetItem | undefined): Declaration {
  if (item === undefined || item.kind !== "declaration") {
    throw new Error(`expected declaration, got ${item?.kind ?? "nothing"}`);
  }
  return item;
}

function expectConditional(item: StylesheetItem | undefined): ConditionalBlock {
  if (item === undefined || item.kind !== "conditional-block") {
    throw new Error(`expected conditional block, got ${item?.kind ?? "nothing"}`);
  }
  return item;
}

/**
 * Diagnostics owned by the parser: these are the errors derivable from tokens
 * alone. The three semantic fixtures (`unknown-modifier`, `unknown-setup-key`,
 * `duplicate-setting`) need alias tables, the settings schema or the merged
 * `@setup` view, which belong to later phases.
 */
const PARSER_ERROR_FIXTURES = [
  "errors/top-level-conditional",
  "errors/missing-semicolon",
  "errors/malformed-value",
  "errors/unclosed-block",
  "errors/semicolonless-modifier",
  "errors/semicolonless-before-nested-rule",
] as const;

describe("parser diagnostics reproduce authored error fixtures", () => {
  for (const id of PARSER_ERROR_FIXTURES) {
    test(id, () => {
      const source = fixtureSource(id);
      const expected = expectedDiagnostics(id);
      if (expected === null) throw new Error(`${id} needs authored diagnostics`);

      const { diagnostics } = parseSource(source, `${id}/input.cssx`);
      expect(diagnostics.length).toBe(expected.length);

      const used = new Set<number>();
      for (const entry of expected) {
        const position = offsetOfPosition(source, entry.span.line, entry.span.col);
        const found = diagnostics.findIndex(
          (diagnostic, index) =>
            !used.has(index) &&
            diagnostic.code === entry.code &&
            diagnostic.severity === entry.severity &&
            diagnostic.span.start <= position &&
            position <= diagnostic.span.end,
        );
        expect(found).toBeGreaterThanOrEqual(0);
        used.add(found);
      }
      expect(used.size).toBe(diagnostics.length);
    });
  }
});

describe("parser-owned diagnostics carry statement/construct spans", () => {
  test("top-level conditional points at @md and recovery keeps later rules", () => {
    const source = fixtureSource("errors/top-level-conditional");
    const { ast, diagnostics } = parseSource(source, "errors/top-level-conditional/input.cssx");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA1001");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.span).toEqual(
      spanFor("errors/top-level-conditional/input.cssx", 0, "@md".length),
    );
    expect(ast.items).toHaveLength(1);
    const rule = expectRule(itemAt(ast, 0));
    expect(rule.selector).toBe(".card");
    expect(rule.body).toHaveLength(1);
  });

  test("missing semicolon reports XESSA1002 at the statement start and resumes", () => {
    const source = fixtureSource("errors/missing-semicolon");
    const { ast, diagnostics } = parseSource(source, "errors/missing-semicolon/input.cssx");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);
    const statementStart = indexOfText(source, "color: red");
    expect(diagnostics[0]?.span).toEqual(
      spanFor(
        "errors/missing-semicolon/input.cssx",
        statementStart,
        statementStart + "color: red".length,
      ),
    );
    const rule = expectRule(itemAt(ast, 1));
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration"]);
    expect(expectDeclaration(rule.body[0]).property).toBe("background");
  });

  test("malformed value reports XESSA1003 once and recovers to the next declaration", () => {
    const source = fixtureSource("errors/malformed-value");
    const { ast, diagnostics } = parseSource(source, "errors/malformed-value/input.cssx");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1003"]);
    const statementStart = indexOfText(source, "width: calc(");
    expect(diagnostics[0]?.span).toEqual(
      spanFor(
        "errors/malformed-value/input.cssx",
        statementStart,
        endOfText(source, "calc(100% - 20px;"),
      ),
    );
    const rule = expectRule(itemAt(ast, 1));
    expect(rule.body).toHaveLength(1);
    expect(expectDeclaration(rule.body[0]).property).toBe("height");
  });

  test("unclosed block reports XESSA1001 at end of file and keeps the partial rule", () => {
    const source = fixtureSource("errors/unclosed-block");
    const { ast, diagnostics } = parseSource(source, "errors/unclosed-block/input.cssx");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA1001");
    expect(diagnostics[0]?.span.end).toBe(source.length);
    expect(ast.items).toHaveLength(2);
    const rule = expectRule(itemAt(ast, 1));
    expect(rule.span.end).toBe(source.length);
    expect(rule.body).toHaveLength(1);
  });

  test("semicolonless modified declaration is omitted with XESSA1002", () => {
    const source = fixtureSource("errors/semicolonless-modifier");
    const { ast, diagnostics } = parseSource(source, "errors/semicolonless-modifier/input.cssx");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);
    const statementStart = indexOfText(source, "padding: 10px");
    expect(diagnostics[0]?.span).toEqual(
      spanFor(
        "errors/semicolonless-modifier/input.cssx",
        statementStart,
        endOfText(source, "padding: 10px @md 20px"),
      ),
    );
    const rule = expectRule(itemAt(ast, 1));
    expect(rule.body).toHaveLength(0);
  });
});

describe("semicolonless declaration before a nested rule (ADR-0011, XESSA1002)", () => {
  const file = "errors/semicolonless-before-nested-rule/input.cssx";

  test("keeps the authored declaration, reports once and keeps the nested rule", () => {
    const source = fixtureSource("errors/semicolonless-before-nested-rule");
    const { ast, diagnostics } = parseSource(source, file);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);

    const statementStart = indexOfText(source, "color: red");
    const statementEnd = endOfText(source, "color: red");
    expect(diagnostics[0]?.span).toEqual(spanFor(file, statementStart, statementEnd));

    const rule = expectRule(itemAt(ast, 1));
    expect(rule.selector).toBe(".button");
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration", "rule"]);

    const declaration = expectDeclaration(rule.body[0]);
    expect(declaration.property).toBe("color");
    expect(declaration.value).toBe("red");
    expect(declaration.span).toEqual(spanFor(file, statementStart, statementEnd));

    const hover = expectRule(rule.body[1]);
    expect(hover.selector).toBe("&:hover");
    expect(hover.selectorSpan).toEqual(
      spanFor(file, indexOfText(source, "&:hover"), endOfText(source, "&:hover")),
    );
    expect(expectDeclaration(hover.body[0]).property).toBe("color");
    expect(expectDeclaration(hover.body[0]).value).toBe("blue");
  });

  test("an inline reproduction parses the same way with one diagnostic", () => {
    const source = ".button {\n  color: red\n  &:hover { color: blue; }\n}\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);
    const body = expectRule(itemAt(ast, 0)).body;
    expect(body.map((item) => item.kind)).toEqual(["declaration", "rule"]);
    expect(expectDeclaration(body[0]).value).toBe("red");
    expect(expectRule(body[1]).selector).toBe("&:hover");
  });

  test("a plain-CSS final declaration still omits its semicolon without a diagnostic", () => {
    const source = fixtureSource("lexical/final-no-semicolon");
    const { ast, diagnostics } = parseSource(source, "lexical/final-no-semicolon/input.cssx");
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 0)).body.map((item) => expectDeclaration(item));
    expect(body.map((declaration) => declaration.property)).toEqual(["color", "padding"]);
    expect(body[1]?.value).toBe("10px");
  });

  test("valid nested selectors on one line stay rules, not missing semicolons", () => {
    const source =
      ".list {\n  div:hover .child { color: red; }\n  li:nth-child(2n) > a { color: blue; }\n}\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 0)).body;
    expect(body.map((item) => item.kind)).toEqual(["rule", "rule"]);
    expect(
      body.map((item) => {
        if (item.kind !== "rule") throw new Error("expected nested rule");
        return item.selector;
      }),
    ).toEqual(["div:hover .child", "li:nth-child(2n) > a"]);
  });

  test("a selector list continued after a line break is not a declaration", () => {
    const source = ".list {\n  div:hover,\n  .child { color: red; }\n}\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 0)).body;
    expect(body).toHaveLength(1);
    expect(expectRule(body[0]).selector).toBe("div:hover,\n  .child");
  });

  test("a hash value before the nested rule is never the selector start", () => {
    const source = '.a {\n  background: #fff\n  &::before { content: ""; }\n}\n';
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);
    const body = expectRule(itemAt(ast, 0)).body;
    expect(body.map((item) => item.kind)).toEqual(["declaration", "rule"]);
    expect(expectDeclaration(body[0]).value).toBe("#fff");
    expect(expectRule(body[1]).selector).toBe("&::before");
  });
});

describe("semantic error fixtures parse structurally (diagnostics belong to later phases)", () => {
  test("errors/unknown-modifier: an unknown alias still splits a Variant", () => {
    const source = fixtureSource("errors/unknown-modifier");
    const { ast, diagnostics } = parseSource(source, "errors/unknown-modifier/input.cssx");
    // XESSA3001 needs the alias registry (media phase); parsing keeps the shape.
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 1));
    const declaration = expectDeclaration(rule.body[0]);
    expect(declaration.value).toBe("red");
    expect(declaration.variants).toHaveLength(1);
    expect(declaration.variants[0]?.aliases).toEqual(["ultrawide"]);
    expect(declaration.variants[0]?.value).toBe("blue");
    expect(declaration.variants[0]?.span.start).toBe(offsetOfPosition(source, 3, 14));
  });

  test("errors/unknown-setup-key: unknown keys are preserved for configuration validation", () => {
    const source = fixtureSource("errors/unknown-setup-key");
    const { ast, diagnostics } = parseSource(source, "errors/unknown-setup-key/input.cssx");
    // The settings schema belongs to the configuration layer (ast Setting JSDoc).
    expect(diagnostics).toEqual([]);
    const setup = itemAt(ast, 0);
    if (setup.kind !== "setup") throw new Error("expected setup");
    expect(setup.settings.map((setting) => setting.key)).toEqual(["prefix", "theme"]);
    expect(setup.settings[1]?.value).toBe('"midnight"');
    expect(setup.settings[1]?.span.start).toBe(offsetOfPosition(source, 3, 3));
  });

  test("errors/duplicate-setting: duplicates stay separate nodes for the resolver", () => {
    const source = fixtureSource("errors/duplicate-setting");
    const { ast, diagnostics } = parseSource(source, "errors/duplicate-setting/input.cssx");
    // SPECIFICATION.md §3.2: duplicate settings are rejected after @setup merge.
    expect(diagnostics).toEqual([]);
    const setup = itemAt(ast, 0);
    if (setup.kind !== "setup") throw new Error("expected setup");
    expect(setup.settings.map((setting) => setting.key)).toEqual(["prefix", "prefix"]);
    expect(setup.settings.map((setting) => setting.value)).toEqual(['"ui"', '"admin"']);
    expect(setup.settings[1]?.span.start).toBe(offsetOfPosition(source, 3, 3));
  });
});

describe("canonical button fixture AST", () => {
  const sourceFile = "canonical/button/input.cssx";
  const source = fixtureSource("canonical/button");
  const { ast, diagnostics } = parseSource(source, sourceFile);
  const setupEnd = indexOfText(source, "}\n@use") + 1;
  const ruleStart = indexOfText(source, ".button {");

  test("parses with no diagnostics and spans the whole file", () => {
    expect(diagnostics).toEqual([]);
    expect(ast.kind).toBe("stylesheet");
    expect(ast.file).toBe(sourceFile);
    expect(ast.span).toEqual(spanFor(sourceFile, 0, source.length));
    expect(ast.items.map((item) => item.kind)).toEqual(["setup", "use", "variables", "rule"]);
  });

  test("@setup keeps authored order, raw quoted values and key-to-semicolon spans", () => {
    const setup = itemAt(ast, 0);
    if (setup.kind !== "setup") throw new Error("expected setup");
    expect(setup.span).toEqual(spanFor(sourceFile, indexOfText(source, "@setup"), setupEnd));
    expect(setup.settings.map((setting) => setting.key)).toEqual([
      "prefix",
      "css-dir",
      "css-name",
      "map-dir",
      "map-name",
    ]);
    expect(setup.settings.map((setting) => setting.value)).toEqual([
      '"ui"',
      '"../generated/styles"',
      '"button.css"',
      '"../generated/maps"',
      '"button.map.js"',
    ]);
    expect(setup.settings[0]?.span).toEqual(
      spanFor(sourceFile, indexOfText(source, "prefix:"), endOfText(source, 'prefix: "ui";')),
    );
    expect(setup.settings[4]?.span).toEqual(
      spanFor(
        sourceFile,
        indexOfText(source, "map-name:"),
        endOfText(source, 'map-name: "button.map.js";'),
      ),
    );
  });

  test("@use keeps the raw specifier and the alias", () => {
    const use = itemAt(ast, 1);
    if (use.kind !== "use") throw new Error("expected use");
    expect(use.path).toBe("./theme.cssx");
    expect(use.alias).toBe("theme");
    expect(use.span).toEqual(
      spanFor(
        sourceFile,
        indexOfText(source, "@use"),
        endOfText(source, '@use "./theme.cssx" as theme;'),
      ),
    );
  });

  test("@variables keeps raw literal values without token sequences", () => {
    const variables = itemAt(ast, 2);
    if (variables.kind !== "variables") throw new Error("expected variables");
    expect(variables.tokens.map((token) => token.name)).toEqual(["spacing", "radius"]);
    expect(variables.tokens.map((token) => token.value)).toEqual(["12px", "8px"]);
    expect(variables.tokens[0]?.span).toEqual(
      spanFor(sourceFile, indexOfText(source, "spacing:"), endOfText(source, "spacing: 12px;")),
    );
    for (const token of variables.tokens) expect(token.tokens).toBeUndefined();
  });

  test(".button keeps selector span, member order and per-segment variants", () => {
    const rule = expectRule(itemAt(ast, 3));
    expect(rule.selector).toBe(".button");
    expect(rule.selectorSpan).toEqual(
      spanFor(sourceFile, ruleStart, endOfText(source, ".button", ruleStart)),
    );
    expect(rule.span).toEqual(spanFor(sourceFile, ruleStart, source.lastIndexOf("}") + 1));
    expect(rule.body.map((item) => item.kind)).toEqual([
      "declaration",
      "declaration",
      "declaration",
      "declaration",
      "declaration",
      "rule",
      "rule",
      "rule",
    ]);

    const display = expectDeclaration(rule.body[0]);
    expect(display.property).toBe("display");
    expect(display.value).toBe("flex");
    expect(display.variants).toEqual([]);
    expect(display.tokens).toBeUndefined();
    expect(display.important).toBeUndefined();
    expect(display.span).toEqual(
      spanFor(sourceFile, indexOfText(source, "display:"), endOfText(source, "display: flex")),
    );

    const padding = expectDeclaration(rule.body[1]);
    expect(padding.value).toBe("$spacing");
    expect(padding.tokens?.map((token) => token.kind)).toEqual(["dollar-ref"]);
    expect(padding.tokens?.[0]?.value).toBe("$spacing");
    expect(padding.variants.map((variant) => variant.aliases)).toEqual([["md"], ["xl"]]);
    expect(padding.variants.map((variant) => variant.value)).toEqual(["20px", "32px"]);
    expect(padding.span).toEqual(
      spanFor(
        sourceFile,
        indexOfText(source, "padding:"),
        endOfText(source, "$spacing @md 20px @xl 32px"),
      ),
    );
    const mdStart = indexOfText(source, "@md 20px");
    expect(padding.variants[0]?.span).toEqual(spanFor(sourceFile, mdStart, mdStart + "@md".length));
    const xlStart = indexOfText(source, "@xl 32px");
    expect(padding.variants[1]?.span).toEqual(spanFor(sourceFile, xlStart, xlStart + "@xl".length));

    const radius = expectDeclaration(rule.body[2]);
    expect(radius.value).toBe("$radius");
    expect(radius.span).toEqual(
      spanFor(
        sourceFile,
        indexOfText(source, "border-radius:"),
        endOfText(source, "border-radius: $radius"),
      ),
    );

    const background = expectDeclaration(rule.body[3]);
    expect(background.value).toBe("$theme.primary");
    expect(background.tokens?.[0]?.value).toBe("$theme.primary");
    expect(background.variants.map((variant) => variant.aliases)).toEqual([["dark"]]);
    expect(background.variants[0]?.value).toBe("#1e40af");
    const darkStart = indexOfText(source, "@dark #1e40af");
    expect(background.variants[0]?.span).toEqual(
      spanFor(sourceFile, darkStart, darkStart + "@dark".length),
    );

    const fontSize = expectDeclaration(rule.body[4]);
    expect(fontSize.value).toBe("14px");
    expect(fontSize.variants.map((variant) => [variant.aliases, variant.value])).toEqual([
      [["md"], "16px"],
    ]);
  });

  test("nested rules keep raw selectors including & and combinators", () => {
    const rule = expectRule(itemAt(ast, 3));
    const hover = expectRule(rule.body[5]);
    expect(hover.selector).toBe("&:hover");
    expect(hover.selectorSpan).toEqual(
      spanFor(sourceFile, indexOfText(source, "&:hover {"), endOfText(source, "&:hover")),
    );
    expect(hover.body.map((item) => item.kind)).toEqual(["declaration"]);
    expect(expectDeclaration(hover.body[0]).value).toBe("0.85");

    const disabled = expectRule(rule.body[6]);
    expect(disabled.selector).toBe("&:disabled");
    expect(disabled.body.map((item) => item.kind)).toEqual(["declaration", "declaration"]);

    const icon = expectRule(rule.body[7]);
    expect(icon.selector).toBe("& > .icon");
    const width = expectDeclaration(icon.body[0]);
    expect(width.value).toBe("16px");
    expect(width.variants.map((variant) => [variant.aliases, variant.value])).toEqual([
      [["lg"], "20px"],
    ]);
  });
});

describe("rules, nesting and blocks", () => {
  test("bare nested selectors stay Rule nodes for descendant lowering (D1)", () => {
    const source = fixtureSource("nesting/descendant-bare");
    const { ast, diagnostics } = parseSource(source, "nesting/descendant-bare/input.cssx");
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 1));
    const nested = rule.body.filter((item): item is Rule => item.kind === "rule");
    expect(nested.map((item) => item.selector)).toEqual([".icon", ".label .text"]);
  });

  test("multiple & references are preserved raw (ADR-0012)", () => {
    const source = fixtureSource("nesting/multiple-amp");
    const { ast, diagnostics } = parseSource(source, "nesting/multiple-amp/input.cssx");
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 1));
    const nested = rule.body.filter((item): item is Rule => item.kind === "rule");
    expect(nested.map((item) => item.selector)).toEqual(["& + &", ".row &"]);
  });

  test("selector lists and functional pseudos stay one raw slice", () => {
    const selector = '.a, .b:is(.c, .d) > .e:not([data-x="y"])';
    const source = `${selector} {\n  color: red;\n}\n`;
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 0));
    expect(rule.selector).toBe(selector);
    expect(rule.selectorSpan).toEqual(spanFor(file, 0, selector.length));
    expect(expectDeclaration(rule.body[0]).value).toBe("red");
  });

  test("conditional blocks are rule-scoped and nest (D3)", () => {
    const source = fixtureSource("media/block-conditions");
    const { ast, diagnostics } = parseSource(source, "media/block-conditions/input.cssx");
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 1));
    expect(rule.body.map((item) => item.kind)).toEqual([
      "declaration",
      "conditional-block",
      "conditional-block",
    ]);

    const md = expectConditional(rule.body[1]);
    expect(md.variant.aliases).toEqual(["md"]);
    expect(md.span.start).toBe(indexOfText(source, "@md {"));
    expect(md.body.map((item) => item.kind)).toEqual([
      "declaration",
      "declaration",
      "conditional-block",
    ]);

    const dark = expectConditional(md.body[2]);
    expect(dark.variant.aliases).toEqual(["dark"]);

    const print = expectConditional(rule.body[2]);
    expect(print.variant.aliases).toEqual(["print"]);
  });

  test("native at-rules pass through at top level (block and statement forms)", () => {
    const source =
      '@media (min-width: 600px) {\n  .card { color: red; }\n}\n@import "./reset.css";\n';
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);

    const media = itemAt(ast, 0);
    if (media.kind !== "native-at-rule") throw new Error("expected native at-rule");
    expect(media.name).toBe("media");
    expect(media.prelude).toBe("(min-width: 600px)");
    expect(media.block?.map((item) => item.kind)).toEqual(["rule"]);
    expect(media.span).toEqual(spanFor(file, 0, indexOfText(source, "}\n@import") + 1));
    const card = media.block?.[0];
    if (card?.kind !== "rule") throw new Error("expected nested rule");
    expect(card.selector).toBe(".card");

    const importRule = itemAt(ast, 1);
    if (importRule.kind !== "native-at-rule") throw new Error("expected native at-rule");
    expect(importRule.name).toBe("import");
    expect(importRule.prelude).toBe('"./reset.css"');
    expect(importRule.block).toBeUndefined();
    expect(importRule.span).toEqual(
      spanFor(file, indexOfText(source, "@import"), endOfText(source, '@import "./reset.css";')),
    );
  });

  test("native at-rules inside a rule keep their own block", () => {
    const source = ".card {\n  @supports (display: grid) {\n    display: grid;\n  }\n}\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 0));
    expect(rule.body.map((item) => item.kind)).toEqual(["native-at-rule"]);

    const supports = rule.body[0];
    if (supports?.kind !== "native-at-rule") throw new Error("expected native at-rule");
    expect(supports.name).toBe("supports");
    expect(supports.prelude).toBe("(display: grid)");
    expect(supports.block?.map((item) => item.kind)).toEqual(["declaration"]);
    expect(expectDeclaration(supports.block?.[0]).property).toBe("display");
  });

  test("a native at-rule inside a conditional block is XESSA1001 with recovery", () => {
    const source = ".card {\n  @md {\n    @media print { color: red; }\n  }\n}\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA1001");
    const rule = expectRule(itemAt(ast, 0));
    const md = expectConditional(rule.body[0]);
    expect(md.body).toHaveLength(0);
  });

  test("multiple @setup blocks produce one node each", () => {
    const source = '@setup { prefix: "ui"; }\n@setup { emit-css: false; }\n.a { color: red; }\n';
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    expect(ast.items.map((item) => item.kind)).toEqual(["setup", "setup", "rule"]);
    const first = itemAt(ast, 0);
    const second = itemAt(ast, 1);
    if (first.kind !== "setup" || second.kind !== "setup") throw new Error("expected setups");
    expect(first.settings.map((setting) => setting.key)).toEqual(["prefix"]);
    expect(second.settings.map((setting) => setting.key)).toEqual(["emit-css"]);
    expect(second.settings[0]?.value).toBe("false");
  });

  test("@use without `as` leaves the alias absent", () => {
    const { ast, diagnostics } = parseSource('@use "./tokens.cssx";');
    expect(diagnostics).toEqual([]);
    const use = itemAt(ast, 0) as UseImport;
    expect(use.path).toBe("./tokens.cssx");
    expect("alias" in use).toBe(false);
  });

  test("@media-types keeps raw trimmed conditions", () => {
    const source = fixtureSource("media/inline-variants");
    const { ast, diagnostics } = parseSource(source, "media/inline-variants/input.cssx");
    expect(diagnostics).toEqual([]);
    const mediaTypes = itemAt(ast, 0);
    if (mediaTypes.kind !== "media-types") throw new Error("expected media-types");
    expect(mediaTypes.aliases.map((alias) => alias.name)).toEqual(["compact"]);
    expect(mediaTypes.aliases[0]?.media).toBe("(max-width: 500px)");

    const rule = expectRule(itemAt(ast, 1));
    expect(rule.body.map((item) => item.kind)).toEqual([
      "declaration",
      "declaration",
      "conditional-block",
      "conditional-block",
    ]);
  });

  test("duplicate aliases stay authored until lowering normalizes them", () => {
    const source = fixtureSource("media/duplicate-aliases");
    const { ast, diagnostics } = parseSource(source, "media/duplicate-aliases/input.cssx");
    expect(diagnostics).toEqual([]);
    const padding = expectDeclaration(expectRule(itemAt(ast, 1)).body[0]);
    expect(padding.variants.map((variant) => variant.aliases)).toEqual([
      ["md", "md"],
      ["xl", "dark", "dark"],
    ]);
  });

  test("combined aliases parse as separate alias entries (logical AND)", () => {
    const source = fixtureSource("media/combined-and");
    const { ast, diagnostics } = parseSource(source, "media/combined-and/input.cssx");
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 1)).body;
    expect(expectDeclaration(body[0]).variants.map((variant) => variant.aliases)).toEqual([
      ["dark"],
      ["xl", "dark"],
    ]);
    expect(expectDeclaration(body[1]).variants.map((variant) => variant.aliases)).toEqual([
      ["md", "landscape"],
    ]);
    expect(expectDeclaration(body[2]).variants.map((variant) => variant.aliases)).toEqual([
      ["2xl"],
    ]);
  });

  test("@runtime declarations support inline variants", () => {
    const source = fixtureSource("runtime/with-variant");
    const { ast, diagnostics } = parseSource(source, "runtime/with-variant/input.cssx");
    expect(diagnostics).toEqual([]);
    const runtime = itemAt(ast, 1);
    if (runtime.kind !== "runtime") throw new Error("expected runtime");
    expect(runtime.declarations.map((declaration) => declaration.property)).toEqual([
      "surface",
      "accent",
    ]);
    expect(runtime.declarations[0]?.variants.map((variant) => variant.aliases)).toEqual([["dark"]]);
    expect(runtime.declarations[1]?.variants.map((variant) => variant.aliases)).toEqual([
      ["md"],
      ["dark", "md"],
    ]);
    expect(runtime.span.end).toBe(indexOfText(source, "}\n.card") + 1);
  });

  test("!important binds per segment (ADR-0003)", () => {
    const source = fixtureSource("important/per-segment");
    const { ast, diagnostics } = parseSource(source, "important/per-segment/input.cssx");
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 1)).body.map((item) => expectDeclaration(item));
    const [border, padding, margin, gap] = body;

    expect(border?.value).toBe("1px solid red !important");
    expect(border?.important).toBe(true);
    expect(border?.variants).toHaveLength(0);

    expect(padding?.value).toBe("10px");
    expect(padding?.important).toBeUndefined();
    expect(padding?.variants[0]?.value).toBe("20px !important");
    expect(padding?.variants[0]?.important).toBe(true);

    expect(margin?.value).toBe("10px !important");
    expect(margin?.important).toBe(true);
    expect(margin?.variants[0]?.value).toBe("20px");
    expect(margin?.variants[0]?.important).toBeUndefined();

    expect(gap?.important).toBeUndefined();
    expect(gap?.variants.map((variant) => [variant.value, variant.important])).toEqual([
      ["8px !important", true],
      ["12px !important", true],
    ]);
  });
});

describe("lexical fixtures stay inert and raw", () => {
  test("@ inside strings is literal content", () => {
    const source = fixtureSource("lexical/at-in-string");
    const { ast, diagnostics } = parseSource(source, "lexical/at-in-string/input.cssx");
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 0));
    expect(rule.selector).toBe(".message::before");
    const body = rule.body.map((item) => expectDeclaration(item));
    expect(body[0]?.value).toBe('"@dark"');
    expect(body[0]?.variants).toHaveLength(0);
    expect(body[1]?.value).toBe('"@md" "@xl+dark"');
    expect(body[1]?.variants).toHaveLength(0);
  });

  test("url() contents never become modifiers or references", () => {
    const source = fixtureSource("lexical/url-at");
    const { ast, diagnostics } = parseSource(source, "lexical/url-at/input.cssx");
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 0)).body.map((item) => expectDeclaration(item));
    expect(body[0]?.value).toBe('url("image@2x.png")');
    expect(body[1]?.value).toBe("url(image@2x.png)");
    expect(body[2]?.value).toBe('url("icons/cursor@32.png") 0 0, auto');
    for (const declaration of body) expect(declaration.variants).toHaveLength(0);
  });

  test("a modifier without preceding whitespace stays literal", () => {
    const source = fixtureSource("lexical/no-whitespace-modifier");
    const { ast, diagnostics } = parseSource(source, "lexical/no-whitespace-modifier/input.cssx");
    expect(diagnostics).toEqual([]);
    const declaration = expectDeclaration(expectRule(itemAt(ast, 1)).body[0]);
    expect(declaration.value).toBe("12px@md 20px");
    expect(declaration.variants).toHaveLength(0);
  });

  test("a modifier inside a function argument stays literal", () => {
    const source = fixtureSource("lexical/calc");
    const { ast, diagnostics } = parseSource(source, "lexical/calc/input.cssx");
    expect(diagnostics).toEqual([]);
    const body = expectRule(itemAt(ast, 0)).body.map((item) => expectDeclaration(item));
    expect(body[0]?.value).toBe("calc(100% - @md 20px)");
    expect(body[0]?.variants).toHaveLength(0);
    expect(body[1]?.value).toBe("calc(100px + 2rem)");
  });

  test("a whitespace-preceded @ after a url is still a modifier", () => {
    const source = fixtureSource("lexical/at-mid-value");
    const { ast, diagnostics } = parseSource(source, "lexical/at-mid-value/input.cssx");
    expect(diagnostics).toEqual([]);
    const declaration = expectDeclaration(expectRule(itemAt(ast, 1)).body[0]);
    expect(declaration.value).toBe('url("a@b.png")');
    expect(declaration.variants.map((variant) => [variant.aliases, variant.value])).toEqual([
      [["md"], "red"],
    ]);
  });

  test("comments and escaped identifiers stay raw", () => {
    const source = fixtureSource("lexical/comments-escapes");
    const { ast, diagnostics } = parseSource(source, "lexical/comments-escapes/input.cssx");
    expect(diagnostics).toEqual([]);
    const rule = expectRule(itemAt(ast, 0));
    expect(rule.selector).toBe(".button");
    expect(rule.body.map((item) => item.kind)).toEqual([
      "declaration",
      "declaration",
      "declaration",
      "rule",
    ]);
    const body = rule.body;
    expect(expectDeclaration(body[0]).property).toBe("--label");
    expect(expectDeclaration(body[0]).value).toBe('"@dark /* not a comment */"');
    expect(expectDeclaration(body[1]).value).toBe('"\\"quoted\\" @xl"');
    expect(expectDeclaration(body[2]).value).toBe("red");
    const status = expectRule(body[3]);
    expect(status.selector).toBe(".status\\:active");
    expect(expectDeclaration(status.body[0]).value).toBe("green");
  });
});

describe("value token sequences (ADR-0005)", () => {
  test("variables and declarations gain token sequences only for $ references", () => {
    const source = fixtureSource("variables/namespaced-members");
    const { ast, diagnostics } = parseSource(source, "variables/namespaced-members/input.cssx");
    expect(diagnostics).toEqual([]);

    const variables = itemAt(ast, 2);
    if (variables.kind !== "variables") throw new Error("expected variables");
    expect(variables.tokens[0]?.value).toBe("$layout.spacing");
    expect(variables.tokens[0]?.tokens?.map((token) => token.kind)).toEqual(["dollar-ref"]);

    const rule = expectRule(itemAt(ast, 3));
    const padding = expectDeclaration(rule.body[0]);
    expect(padding.tokens?.map((token) => token.kind)).toEqual(["dollar-ref"]);
    const margin = expectDeclaration(rule.body[1]);
    expect(margin.tokens?.[0]?.value).toBe("$layout.margin");
  });

  test("literal values never carry token sequences", () => {
    const source = "@variables { radius: 16px; }\n.a { color: red; }\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const variables = itemAt(ast, 0);
    if (variables.kind !== "variables") throw new Error("expected variables");
    expect(variables.tokens[0]?.tokens).toBeUndefined();
    const declaration = expectDeclaration(expectRule(itemAt(ast, 1)).body[0]);
    expect(declaration.tokens).toBeUndefined();
  });

  test("multi-token segments keep their trimmed raw token range", () => {
    const source = ".a { padding: 1px $gap solid; }\n";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const declaration = expectDeclaration(expectRule(itemAt(ast, 0)).body[0]);
    expect(declaration.value).toBe("1px $gap solid");
    expect(declaration.tokens?.map((token) => token.kind)).toEqual([
      "number",
      "whitespace",
      "dollar-ref",
      "whitespace",
      "ident",
    ]);
  });
});

describe("total parsing and recovery guarantees", () => {
  test("every fixture input parses; only parser-owned error fixtures diagnose", () => {
    const parserOwned = new Set<string>([
      ...PARSER_ERROR_FIXTURES,
      // ADR-0017 §3.7 authored group syntax misuse: declarations-only blocks and
      // out-of-v1 conditional use sites are parser diagnostics by design.
      "groups/nested-rule-in-definition",
      "groups/conditional-use-site",
    ]);
    const groups = readdirSync(fixturesRoot)
      .filter((entry) => statSync(join(fixturesRoot, entry)).isDirectory())
      .sort();

    for (const group of groups) {
      const fixtures = readdirSync(join(fixturesRoot, group))
        .filter((entry) => statSync(join(fixturesRoot, group, entry)).isDirectory())
        .sort();
      for (const fixture of fixtures) {
        const id = `${group}/${fixture}`;
        const entries = readdirSync(join(fixturesRoot, id));
        if (!entries.includes("input.cssx")) continue;

        const source = fixtureSource(id);
        const { ast, diagnostics } = parseSource(source, `${id}/input.cssx`);
        expect(ast.kind).toBe("stylesheet");
        expect(ast.file).toBe(`${id}/input.cssx`);
        if (parserOwned.has(id)) expect(diagnostics.length).toBeGreaterThan(0);
        else expect(diagnostics).toEqual([]);
      }
    }
  });

  test("empty input yields an empty stylesheet", () => {
    const { ast, diagnostics } = parseSource("");
    expect(diagnostics).toEqual([]);
    expect(ast.items).toEqual([]);
    expect(ast.span).toEqual(spanFor(file, 0, 0));
  });

  test("tokens without a trailing eof still parse", () => {
    const source = ".a { color: red; }";
    const stream = tokenize(source).slice(0, -1);
    const { ast, diagnostics } = parseTokens(stream, file);
    expect(diagnostics).toEqual([]);
    expect(ast.items).toHaveLength(1);
    expect(ast.span.end).toBe(source.length);
  });

  test("truncated token streams never throw and always yield a stylesheet", () => {
    const source = fixtureSource("canonical/button");
    const tokens = tokenize(source);
    for (let length = 0; length <= tokens.length; length++) {
      const { ast } = parseTokens(tokens.slice(0, length), "src/truncated.cssx");
      expect(ast.kind).toBe("stylesheet");
      expect(ast.file).toBe("src/truncated.cssx");
    }
  });

  test("garbage input recovers with diagnostics instead of throwing", () => {
    const garbage = "}}}{{{;;; @ @@@ . ; @md { color: red }";
    const { ast, diagnostics } = parseSource(garbage, "src/garbage.cssx");
    expect(ast.kind).toBe("stylesheet");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code.startsWith("XESSA1")).toBe(true);
  });

  test("nodes and collections are frozen", () => {
    const { ast } = parseSource(".a { color: red; }");
    expect(Object.isFrozen(ast)).toBe(true);
    expect(Object.isFrozen(ast.items)).toBe(true);
    const rule = expectRule(itemAt(ast, 0));
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(rule.body)).toBe(true);
    const declaration = expectDeclaration(rule.body[0]);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.variants)).toBe(true);
  });
});
