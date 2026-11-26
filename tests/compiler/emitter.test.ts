import { describe, expect, test } from "bun:test";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { parse } from "../../packages/compiler/src/index.ts";
import {
  atRuleContextIr,
  declarationIr,
  mediaConditionIr,
  nativeBlockIr,
  ruleIr,
  stylesheetIr,
} from "../../packages/compiler/src/ir/index.ts";
import type { StylesheetIr } from "../../packages/compiler/src/ir/index.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import type { Span } from "../../packages/compiler/src/types/span.ts";

/**
 * CSS emitter tests: pretty/minify formatting, native at-rule composition,
 * statement/descriptor/keyframe handling, structural diagnostics and
 * adversarial IR safety.
 */

const defaultSpan: Span = { start: 0, end: 0, file: "src/emitter.cssx" };

function lowerSource(source: string): StylesheetIr {
  const file = "src/emitter.cssx";
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  const lowered = lower(parsed.ast, { file });
  expect(lowered.diagnostics).toEqual([]);
  return lowered.ir;
}

function pretty(source: string): string {
  return emitCss(lowerSource(source), { minify: false }).css;
}

function minified(source: string): string {
  return emitCss(lowerSource(source), { minify: true }).css;
}

/**
 * Remove whitespace that only separates structural CSS tokens.
 *
 * Whitespace inside strings and parentheses (values, `calc`, `url`) is kept,
 * so this compares emitted structural differences rather than authored value
 * spacing. Used to prove minify mode differs from pretty only structurally.
 */
function stripStructuralWhitespace(css: string): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  let index = 0;

  while (index < css.length) {
    const character = css.charAt(index);

    if (quote !== null) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      output += character;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      output += character;
      index += 1;
      continue;
    }
    if (depth > 0) {
      output += character;
      index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      let next = index;
      while (next < css.length && /\s/.test(css.charAt(next))) next += 1;
      const previous = output.charAt(output.length - 1);
      const following = css.charAt(next);
      const structural =
        previous === "" ||
        following === "" ||
        "{};:,>+~".includes(previous) ||
        "{};:,>+~".includes(following);
      if (!structural) output += " ";
      index = next;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

describe("pretty and minify formatting", () => {
  test("pretty output uses two-space indentation and a trailing semicolon", () => {
    expect(pretty(".button { display: flex; color: red; }")).toBe(
      ".button {\n  display: flex;\n  color: red;\n}\n",
    );
  });

  test("minify output compacts structural whitespace only", () => {
    expect(minified(".button { display: flex; color: red; }")).toBe(
      ".button{display:flex;color:red;}",
    );
  });

  test("multiple rules are separated by one blank line in pretty mode", () => {
    expect(pretty(".a { color: red; } .b { color: blue; }")).toBe(
      ".a {\n  color: red;\n}\n\n.b {\n  color: blue;\n}\n",
    );
  });

  test("an empty stylesheet emits an empty string in both modes", () => {
    expect(emitCss(stylesheetIr([]), { minify: false }).css).toBe("");
    expect(emitCss(stylesheetIr([]), { minify: true }).css).toBe("");
  });

  test("pretty and minify differ only in structural whitespace", () => {
    const sources = [
      ".a { color: red; }",
      ".a { color: red @md blue; }",
      '.x { content: "@md"; background: url("image@2x.png"); width: calc(100% - 20px); }',
      "@supports (display: grid) { @media (min-width: 900px) { .a { display: grid @md flex; } } }",
      ".a { padding: 10px !important @md 20px; }",
      '@font-face { font-family: "X"; src: url("x.woff2"); }',
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
    ];
    for (const source of sources) {
      const ir = lowerSource(source);
      const prettyCss = emitCss(ir, { minify: false }).css;
      const minifiedCss = emitCss(ir, { minify: true }).css;
      expect({ source, stripped: stripStructuralWhitespace(prettyCss) }).toEqual({
        source,
        stripped: stripStructuralWhitespace(minifiedCss),
      });
    }
  });
});

describe("native at-rule composition", () => {
  test("a top-level native media block emits its wrapper once", () => {
    expect(pretty("@media (min-width: 900px) { .a { color: red; } }")).toBe(
      "@media (min-width: 900px) {\n  .a {\n    color: red;\n  }\n}\n",
    );
    expect(minified("@media (min-width: 900px) { .a { color: red; } }")).toBe(
      "@media (min-width: 900px){.a{color:red;}}",
    );
  });

  test("a rule inside a native media block emits its condition as a nested wrapper", () => {
    expect(pretty("@media (min-width: 900px) { .a { color: red @md blue; } }")).toBe(
      [
        "@media (min-width: 900px) {",
        "  .a {",
        "    color: red;",
        "  }",
        "",
        "  @media (min-width: 768px) {",
        "    .a {",
        "      color: blue;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("remaining media context and condition AND into one wrapper", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: mediaConditionIr("(min-width: 768px)", ["md"]),
        context: [atRuleContextIr("media", "(min-width: 900px)", defaultSpan)],
        span: defaultSpan,
      }),
    ]);
    expect(emitCss(ir, { minify: false }).css).toBe(
      "@media (min-width: 900px) and (min-width: 768px) {\n  .a {\n    color: red;\n  }\n}\n",
    );
    expect(emitCss(ir, { minify: true }).css).toBe(
      "@media (min-width: 900px) and (min-width: 768px){.a{color:red;}}",
    );
  });

  test("non-media contexts nest outside the combined media wrapper", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: mediaConditionIr("(min-width: 768px)", ["md"]),
        context: [
          atRuleContextIr("media", "(min-width: 900px)", defaultSpan),
          atRuleContextIr("supports", "(display: grid)", defaultSpan),
        ],
        span: defaultSpan,
      }),
    ]);
    expect(emitCss(ir, { minify: false }).css).toBe(
      [
        "@supports (display: grid) {",
        "  @media (min-width: 900px) and (min-width: 768px) {",
        "    .a {",
        "      color: red;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("several native media contexts and a condition join into one wrapper", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: mediaConditionIr("(prefers-color-scheme: dark)", ["dark"]),
        context: [
          atRuleContextIr("media", "(min-width: 600px)", defaultSpan),
          atRuleContextIr("media", "(min-width: 900px)", defaultSpan),
        ],
        span: defaultSpan,
      }),
    ]);
    expect(emitCss(ir, { minify: false }).css).toBe(
      [
        "@media (min-width: 600px) and (min-width: 900px) and (prefers-color-scheme: dark) {",
        "  .a {",
        "    color: red;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a condition inside a non-media native block nests under it", () => {
    expect(pretty("@supports (display: grid) { .a { display: grid @md flex; } }")).toBe(
      [
        "@supports (display: grid) {",
        "  .a {",
        "    display: grid;",
        "  }",
        "",
        "  @media (min-width: 768px) {",
        "    .a {",
        "      display: flex;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("supports and layer nest in authored order around a media query", () => {
    expect(
      pretty("@supports (display: grid) { @media (min-width: 900px) { .a { display: grid; } } }"),
    ).toBe(
      [
        "@supports (display: grid) {",
        "  @media (min-width: 900px) {",
        "    .a {",
        "      display: grid;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(pretty("@layer base { .a { color: red; } }")).toBe(
      "@layer base {\n  .a {\n    color: red;\n  }\n}\n",
    );
  });

  test("media lists and media types pass through and nest instead of being joined", () => {
    expect(pretty("@media screen, print { .a { color: red; } }")).toBe(
      "@media screen, print {\n  .a {\n    color: red;\n  }\n}\n",
    );
    expect(pretty("@media screen { .a { color: red @md blue; } }")).toBe(
      [
        "@media screen {",
        "  .a {",
        "    color: red;",
        "  }",
        "",
        "  @media (min-width: 768px) {",
        "    .a {",
        "      color: blue;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("a plain media type joins with the condition and moves first", () => {
    const build = (prelude: string, query: string) =>
      stylesheetIr([
        ruleIr({
          selector: ".a",
          ancestors: [],
          declarations: [declarationIr("color", "red", defaultSpan)],
          condition: mediaConditionIr(query, ["alias"]),
          context: [atRuleContextIr("media", prelude, defaultSpan)],
          span: defaultSpan,
        }),
      ]);

    expect(emitCss(build("screen", "(min-width: 768px)"), { minify: true }).css).toBe(
      "@media screen and (min-width: 768px){.a{color:red;}}",
    );
    expect(emitCss(build("only screen", "(min-width: 768px)"), { minify: true }).css).toBe(
      "@media only screen and (min-width: 768px){.a{color:red;}}",
    );
    expect(emitCss(build("(min-width: 900px)", "print"), { minify: true }).css).toBe(
      "@media print and (min-width: 900px){.a{color:red;}}",
    );
    expect(emitCss(build("not print", "(min-width: 768px)"), { minify: true }).css).toBe(
      "@media not print{@media (min-width: 768px){.a{color:red;}}}",
    );
    expect(emitCss(build("screen, print", "(min-width: 768px)"), { minify: true }).css).toBe(
      "@media screen, print{@media (min-width: 768px){.a{color:red;}}}",
    );
  });

  test("an empty native block stays an empty block", () => {
    expect(pretty("@layer utilities {}")).toBe("@layer utilities {}\n");
    expect(minified("@layer utilities {}")).toBe("@layer utilities{}");
  });
});

describe("native statements, descriptors and keyframes", () => {
  test("statement at-rules emit as @name prelude;", () => {
    expect(pretty('@charset "utf-8";\n@import "a.css";')).toBe(
      '@charset "utf-8";\n\n@import "a.css";\n',
    );
    expect(minified('@charset "utf-8";\n@import "a.css";')).toBe(
      '@charset "utf-8";@import "a.css";',
    );
  });

  test("descriptor at-rules emit declaration children directly", () => {
    expect(pretty('@font-face { font-family: "X"; src: url("x.woff2"); }')).toBe(
      '@font-face {\n  font-family: "X";\n  src: url("x.woff2");\n}\n',
    );
    expect(minified('@font-face { font-family: "X"; src: url("x.woff2"); }')).toBe(
      '@font-face{font-family:"X";src:url("x.woff2");}',
    );
  });

  test("keyframe steps emit as rules with authored keyframe selectors", () => {
    expect(pretty("@keyframes spin { from { opacity: 0; } to { opacity: 1; } }")).toBe(
      [
        "@keyframes spin {",
        "  from {",
        "    opacity: 0;",
        "  }",
        "",
        "  to {",
        "    opacity: 1;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(minified("@keyframes spin { 0%, 100% { opacity: 1; } }")).toBe(
      "@keyframes spin{0%, 100%{opacity:1;}}",
    );
  });

  test("nested native blocks recurse and keep authored order", () => {
    expect(pretty("@layer base { @media (min-width: 900px) { .a { color: red; } } }")).toBe(
      [
        "@layer base {",
        "  @media (min-width: 900px) {",
        "    .a {",
        "      color: red;",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("structural validation (SPECIFICATION.md §3.1)", () => {
  test("an empty declaration value is diagnosed and omitted", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [
          declarationIr("color", "", defaultSpan),
          declarationIr("padding", "4px", defaultSpan),
        ],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
    ]);
    const result = emitCss(ir, { minify: false });
    expect(result.css).toBe(".a {\n  padding: 4px;\n}\n");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA1001");
    expect(result.diagnostics[0]?.message.toLowerCase()).toContain("empty declaration value");
    expect(result.diagnostics[0]?.message).toContain("inline variants require a base value");
  });

  test("an inline variant without a base value omits only the base segment", () => {
    const result = emitCss(lowerSource(".a { color: @md red; }"), { minify: false });
    expect(result.css).toBe("@media (min-width: 768px) {\n  .a {\n    color: red;\n  }\n}\n");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("base value");
  });

  test("an empty property is diagnosed and omitted", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr(" ", "red", defaultSpan)],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
    ]);
    const result = emitCss(ir, { minify: false });
    expect(result.css).toBe("");
    expect(result.diagnostics[0]?.code).toBe("XESSA1001");
    expect(result.diagnostics[0]?.message).toContain("Empty declaration property");
  });
});

describe("cascade fidelity", () => {
  test("per-segment !important is preserved without duplication", () => {
    const result = emitCss(lowerSource(".a { padding: 10px !important @md 20px; }"), {
      minify: false,
    });
    expect(result.css).toBe(
      [
        ".a {",
        "  padding: 10px !important;",
        "}",
        "",
        "@media (min-width: 768px) {",
        "  .a {",
        "    padding: 20px;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.css).not.toContain("!important !important");
  });

  test("declaration order and duplicates are never changed", () => {
    expect(pretty(".a { margin: 0; margin-top: 4px; margin: 0; }")).toBe(
      ".a {\n  margin: 0;\n  margin-top: 4px;\n  margin: 0;\n}\n",
    );
  });
});

describe("minify token preservation", () => {
  test("strings, urls, calc spacing, custom properties and preludes stay exact", () => {
    const source = [
      ".x {",
      '  content: "@md @media";',
      '  background: url("image@2x.png");',
      "  width: calc(100% - 20px);",
      '  --label: "a  b";',
      "  color: red @md blue;",
      "}",
    ].join("\n");
    expect(minified(source)).toBe(
      [
        '.x{content:"@md @media";background:url("image@2x.png");',
        'width:calc(100% - 20px);--label:"a  b";color:red;}',
        "@media (min-width: 768px){.x{color:blue;}}",
      ].join(""),
    );
  });
});

describe("adversarial IR never throws", () => {
  test("invalid selectors are diagnosed and skipped", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: "&:hover",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
      ruleIr({
        selector: "",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
      ruleIr({
        selector: ".ok",
        ancestors: [],
        declarations: [declarationIr("color", "red", defaultSpan)],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
    ]);
    const result = emitCss(ir, { minify: true });
    expect(result.css).toBe(".ok{color:red;}");
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === "XESSA1001")).toBe(true);
  });

  test("statement blocks ignore malformed children and empty preludes stay valid", () => {
    const statement = nativeBlockIr({
      name: "import",
      prelude: '"a.css"',
      statement: true,
      children: [declarationIr("color", "red", defaultSpan)],
      span: defaultSpan,
    });
    const anonymousLayer = nativeBlockIr({
      name: "layer",
      prelude: "",
      children: [],
      span: defaultSpan,
    });
    const result = emitCss(stylesheetIr([statement, anonymousLayer]), { minify: false });
    expect(result.css).toBe('@import "a.css";\n\n@layer {}\n');
    expect(result.diagnostics).toEqual([]);
  });

  test("emitting a non-flattened nested IR works without a separate flatten step", () => {
    expect(pretty(".a { .b { color: red; } }")).toBe(".a .b {\n  color: red;\n}\n");
  });

  test("raw IR value bytes, including CRLF, are emitted unchanged", () => {
    const ir = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("content", '"a\r\nb"', defaultSpan)],
        condition: null,
        context: [],
        span: defaultSpan,
      }),
    ]);
    const css = emitCss(ir, { minify: false }).css;
    expect(css).toBe('.a {\n  content: "a\r\nb";\n}\n');
    expect(css.split("\r\n")).toHaveLength(2);
  });

  test("output is deterministic across calls", () => {
    const ir = lowerSource(".a { color: red @md blue; .b { color: green; } }");
    const first = emitCss(ir, { minify: false });
    const second = emitCss(ir, { minify: false });
    expect(second.css).toBe(first.css);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });
});
