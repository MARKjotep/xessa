import { describe, expect, test } from "bun:test";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { parse } from "../../packages/compiler/src/index.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";

/**
 * Native attribute-selector coverage (SPECIFICATION.md §7.1, ADR-0002/ADR-0012).
 *
 * Attribute selectors are authored CSS and are deliberately opaque to every
 * Xessa transformation. This matrix pins the operator/flag/namespace forms, the
 * byte-for-byte value cases, selector composition and the prefixing boundary:
 * a local class outside the brackets is renamed while attribute names,
 * operators, values and flags are never touched, never enter the class table
 * and never supply ids. Malformed-bracket/string rejections stay owned by
 * `selectors.test.ts` and are not duplicated here.
 */

const FILE = "src/attribute-selectors.cssx";

interface Emitted {
  readonly css: string;
  readonly minified: string;
  readonly classes: readonly string[];
}

/** Parse, lower, rename one document and emit both modes. */
function emitted(source: string, prefix = "ui"): Emitted {
  const parsed = parse(source, { file: FILE });
  expect(parsed.diagnostics).toEqual([]);
  const lowered = lower(parsed.ast, { file: FILE });
  expect(lowered.diagnostics).toEqual([]);
  const renamed = renameClasses(lowered.ir, { prefix });
  expect(renamed.diagnostics).toEqual([]);
  return {
    css: emitCss(renamed.ir, { minify: false }).css,
    minified: emitCss(renamed.ir, { minify: true }).css,
    classes: renamed.classes.entries.map((entry) => entry.name),
  };
}

/** One `.card<attribute> { color: red; }` rule emitted in both modes. */
function ruleWithAttribute(attribute: string): Emitted {
  return emitted(`.card${attribute} { color: red; }`);
}

describe("attribute operator, flag and namespace matrix", () => {
  const MATRIX = [
    "[attr]",
    '[attr="v"]',
    "[attr='v']",
    "[attr=v]",
    '[attr~="v"]',
    '[attr|="v"]',
    '[attr^="v"]',
    '[attr$="v"]',
    '[attr*="v"]',
    '[attr="v" i]',
    '[attr="v" s]',
    "[ns|attr]",
    '[ ns | attr = "v" ]',
    '[data-x = "v"  i ]',
  ] as const;

  test("presence, equality, operators, flags and namespaces pass through untouched", () => {
    for (const attribute of MATRIX) {
      const result = ruleWithAttribute(attribute);
      expect(result.css, attribute).toBe(`.ui-card${attribute} {\n  color: red;\n}\n`);
      expect(result.minified, attribute).toBe(`.ui-card${attribute}{color:red;}`);
      expect(result.classes, attribute).toEqual(["card"]);
    }
  });
});

describe("attribute values that look like Xessa syntax", () => {
  const VALUES = [
    '[data-x=".icon"]',
    '[data-x="#id"]',
    '[data-x="A & B"]',
    '[data-x="$token"]',
    '[data-x="https://example.com/a?b=c#d"]',
    '[data-x="a\\"b"]',
    '[data-x="héllo → ✓"]',
    '[data-x="a  b"]',
    '[data-x=""]',
  ] as const;

  test("class, id, token, URL, escaped-quote, unicode and spacing bytes survive", () => {
    for (const attribute of VALUES) {
      const result = ruleWithAttribute(attribute);
      expect(result.css, attribute).toBe(`.ui-card${attribute} {\n  color: red;\n}\n`);
      expect(result.minified, attribute).toBe(`.ui-card${attribute}{color:red;}`);
      expect(result.classes, attribute).toEqual(["card"]);
    }
  });
});

describe("attribute selector composition", () => {
  test("compound selectors rename only the class token outside the brackets", () => {
    const result = emitted('h1#hero > .card[data-x=".icon"]:not(#id) { color: red; }');
    expect(result.css).toBe('h1#hero > .ui-card[data-x=".icon"]:not(#id) {\n  color: red;\n}\n');
    expect(result.classes).toEqual(["card"]);
  });

  test("& composes with an attribute selector and flattens the value unchanged", () => {
    const result = emitted(
      '.card { &[aria-expanded="true"]:hover { opacity: 0.5; } &[data-x="A & B"] { color: red; } }',
    );
    expect(result.css).toBe(
      [
        '.ui-card[aria-expanded="true"]:hover {',
        "  opacity: 0.5;",
        "}",
        "",
        '.ui-card[data-x="A & B"] {',
        "  color: red;",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.classes).toEqual(["card"]);
  });

  test("comma lists mix attribute selectors with classes without splitting inside brackets", () => {
    const result = emitted(
      '[data-a="1"], .card[data-b], .other[ns|attr], [data-list="a,b"] { color: red; }',
    );
    expect(result.css).toBe(
      '[data-a="1"], .ui-card[data-b], .ui-other[ns|attr], [data-list="a,b"] {\n  color: red;\n}\n',
    );
    expect(result.classes).toEqual(["card", "other"]);
  });
});

describe("prefixing and class-table isolation", () => {
  test("classes outside brackets rename while attribute selectors never enter the class table", () => {
    const result = emitted(
      '.card[data-x=".icon"] { color: red; } [data-y=".card"] { color: blue; } [data-z=card] { color: green; }',
    );
    expect(result.css).toBe(
      [
        '.ui-card[data-x=".icon"] {',
        "  color: red;",
        "}",
        "",
        '[data-y=".card"] {',
        "  color: blue;",
        "}",
        "",
        "[data-z=card] {",
        "  color: green;",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.classes).toEqual(["card"]);
  });

  test("an empty prefix leaves the class token and every attribute byte unchanged", () => {
    const source = '.card[data-x=".card"] { color: red; }';
    const result = emitted(source, "");
    expect(result.css).toBe('.card[data-x=".card"] {\n  color: red;\n}\n');
  });
});
