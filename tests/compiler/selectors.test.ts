import { describe, expect, test } from "bun:test";
import { parse } from "../../packages/compiler/src/index.ts";
import type { RuleIr } from "../../packages/compiler/src/ir/types.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import type { CompileOptions } from "../../packages/compiler/src/lowering/index.ts";
import { flattenIr, flattenSelector } from "../../packages/compiler/src/selectors/index.ts";

/**
 * Selector flattening matrix.
 *
 * Pins ADR-0002 descendant nesting, ADR-0012 `&` substitution (leading,
 * trailing, repeated, escaped, inside strings/attribute selectors), the
 * documented parent-list `:is(...)` policy, cross-product order and every
 * rejection case the emitter turns into XESSA1001.
 */

function flattened(selector: string, ancestors: readonly string[] = []): string {
  const result = flattenSelector(selector, ancestors);
  if (!result.ok) throw new Error(`unexpected rejection of "${selector}": ${result.reason}`);
  return result.selector;
}

function rejection(selector: string, ancestors: readonly string[] = []): string {
  const result = flattenSelector(selector, ancestors);
  if (result.ok) throw new Error(`expected rejection of "${selector}", got "${result.selector}"`);
  return result.reason;
}

function lowerSource(source: string, options: Partial<CompileOptions> = {}) {
  const file = options.file ?? "src/selectors.cssx";
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  return lower(parsed.ast, { file, ...options });
}

describe("ADR-0002 descendant nesting", () => {
  test("a bare nested selector combines with one space", () => {
    expect(flattened(".icon", [".button"])).toBe(".button .icon");
  });

  test("multi-level descendant chains combine outermost-first", () => {
    expect(flattened(".text", [".button", ".label"])).toBe(".button .label .text");
  });

  test("an authored descendant selector keeps its own space", () => {
    expect(flattened(".label .text", [".button"])).toBe(".button .label .text");
  });

  test("a top-level selector is returned trimmed and unchanged", () => {
    expect(flattened("  .a,  .b  ")).toBe(".a, .b");
  });

  test("a top-level selector list keeps per-item specificity", () => {
    expect(flattened(".a, #b")).toBe(".a, #b");
  });
});

describe("ADR-0012 ampersand substitution", () => {
  test("leading and compound forms substitute directly", () => {
    expect(flattened("&:hover", [".button"])).toBe(".button:hover");
    expect(flattened("&::before", [".button"])).toBe(".button::before");
    expect(flattened("&:nth-child(2n)", [".button"])).toBe(".button:nth-child(2n)");
  });

  test("complex combinator forms substitute directly", () => {
    expect(flattened("& > .icon", [".button"])).toBe(".button > .icon");
    expect(flattened("& + .button", [".button"])).toBe(".button + .button");
    expect(flattened("& ~ .item", [".button"])).toBe(".button ~ .item");
  });

  test("a trailing ampersand substitutes in place", () => {
    expect(flattened(".icon &", [".button"])).toBe(".icon .button");
  });

  test("multiple ampersands substitute every occurrence", () => {
    expect(flattened("& + &", [".field"])).toBe(".field + .field");
    expect(flattened("&&", [".field"])).toBe(".field.field");
    expect(flattened("&&:hover", [".field"])).toBe(".field.field:hover");
    expect(flattened(".row & + .item", [".field"])).toBe(".row .field + .item");
  });

  test("an escaped ampersand stays literal", () => {
    expect(flattened(".x\\&y", [".a"])).toBe(".a .x\\&y");
    expect(flattened("& .x\\&y", [".a"])).toBe(".a .x\\&y");
    expect(flattened("\\&", [".a"])).toBe(".a \\&");
  });

  test("ampersands inside strings, attribute selectors and comments are never rewritten", () => {
    expect(flattened('&[data-label="A&B"]', [".a"])).toBe('.a[data-label="A&B"]');
    expect(flattened('&[data-label="&"]:hover', [".a"])).toBe('.a[data-label="&"]:hover');
    expect(flattened(':is(&) [data-x="&"]', [".a"])).toBe(':is(.a) [data-x="&"]');
    expect(flattened(".x /* & */", [".a"])).toBe(".a .x /* & */");
    expect(flattened("& /* not & */", [".a"])).toBe(".a /* not & */");
  });

  test("ampersands inside functional pseudos substitute", () => {
    expect(flattened(":is(&:hover, & .x)", [".a"])).toBe(":is(.a:hover, .a .x)");
  });
});

describe("parent selector lists (§7.1)", () => {
  test("equal-specificity lists expand as the cross-product in authored order", () => {
    expect(flattened("&:hover", [".a, .b"])).toBe(".a:hover, .b:hover");
    expect(flattened(".child", [".a, .b"])).toBe(".a .child, .b .child");
    expect(flattened("& + &", [".a, .b"])).toBe(".a + .a, .a + .b, .b + .a, .b + .b");
  });

  test("mixed-specificity lists substitute :is(...) instead of expanding", () => {
    expect(flattened("&:hover", [".a, #b"])).toBe(":is(.a, #b):hover");
    expect(flattened(".child", [".a, #b"])).toBe(":is(.a, #b) .child");
    expect(flattened("& + &", [".a, #b"])).toBe(":is(.a, #b) + :is(.a, #b)");
  });

  test("a complex single parent wraps only for prefix-attached ampersands", () => {
    expect(flattened("&:hover", [".a > .b"])).toBe(".a > .b:hover");
    expect(flattened("& > .icon", [".a > .b"])).toBe(".a > .b > .icon");
    expect(flattened(".x&", [".a > .b"])).toBe(".x:is(.a > .b)");
    expect(flattened("&&", [".a > .b"])).toBe(":is(.a > .b):is(.a > .b)");
  });

  test("mixed lists with pseudo-elements are rejected rather than using :is(...)", () => {
    expect(rejection(".child", [".p::before, #q"])).toContain("pseudo-elements");
    expect(rejection(".child", [".p:before, #q"])).toContain("pseudo-elements");
    expect(flattened(".p::before, .q")).toBe(".p::before, .q");
  });

  test("nested selector lists expand as the cross-product in authored order", () => {
    expect(flattened(".x, .y", [".a, .b"])).toBe(".a .x, .b .x, .a .y, .b .y");
    expect(flattened("&:hover, .y", [".a, .b"])).toBe(".a:hover, .b:hover, .a .y, .b .y");
  });

  test("multi-level lists stay in authored cross-product order", () => {
    expect(flattened("&:hover", [".a, .b", ".c, .d"])).toBe(
      ".a .c:hover, .b .c:hover, .a .d:hover, .b .d:hover",
    );
    expect(flattened(".child", [".a, #b", ".x"])).toBe(":is(.a, #b) .x .child");
  });
});

describe("rejections", () => {
  test("a top-level ampersand has no parent", () => {
    expect(rejection("&:hover")).toContain("no enclosing rule");
  });

  test("an empty selector or empty list item is rejected", () => {
    expect(rejection("", [".a"])).toContain("empty selector list item");
    expect(rejection(".a,", [".a"])).toContain("empty selector list item");
  });

  test("a leading combinator needs an explicit ampersand", () => {
    expect(rejection("> .icon", [".button"])).toContain("explicit");
    expect(rejection("+ .icon", [".button"])).toContain("explicit");
  });

  test("unbalanced structures are rejected instead of throwing", () => {
    expect(rejection(".a[data-x", [".b"])).toContain("unbalanced");
    expect(rejection('.a[data-x="', [".b"])).toContain("unterminated string");
  });
});

describe("flattenIr pipeline step", () => {
  function rulesOf(ir: ReturnType<typeof lowerSource>["ir"]): RuleIr[] {
    return ir.rules.filter((node): node is RuleIr => "declarations" in node);
  }

  test("rewrites nested selectors and clears ancestors", () => {
    const { ir } = lowerSource(
      ".button { color: navy; .icon { width: 16px; } &:hover { opacity: .5; } }",
    );
    const flat = flattenIr(ir);
    expect(flat.diagnostics).toEqual([]);
    expect(rulesOf(flat.ir).map((rule) => [rule.selector, rule.ancestors])).toEqual([
      [".button", []],
      [".button .icon", []],
      [".button:hover", []],
    ]);
  });

  test("flattens rules inside native blocks", () => {
    const { ir } = lowerSource("@media (min-width: 900px) { .a { .b { color: red; } } }");
    const flat = flattenIr(ir);
    expect(flat.diagnostics).toEqual([]);
    const block = flat.ir.rules[0];
    expect(block !== undefined && "children" in block).toBe(true);
    if (block === undefined || !("children" in block)) return;
    const child = block.children[0];
    expect(child !== undefined && "declarations" in child).toBe(true);
    if (child === undefined || !("declarations" in child)) return;
    expect(child.selector).toBe(".a .b");
    expect(child.ancestors).toEqual([]);
  });

  test("drops a rule whose selector cannot be flattened and reports XESSA1001", () => {
    const { ir } = lowerSource("&:hover { color: red; }");
    const flat = flattenIr(ir);
    expect(flat.ir.rules).toEqual([]);
    expect(flat.diagnostics).toHaveLength(1);
    expect(flat.diagnostics[0]?.code).toBe("XESSA1001");
    expect(flat.diagnostics[0]?.message).toContain("no enclosing rule");
  });

  test("is idempotent and deterministic", () => {
    const { ir } = lowerSource(".a, .b { .x, .y { color: red; } }");
    const once = flattenIr(ir);
    const twice = flattenIr(once.ir);
    expect(twice.diagnostics).toEqual([]);
    expect(twice.ir).toEqual(once.ir);
    expect(JSON.stringify(twice.ir)).toBe(JSON.stringify(once.ir));
  });
});
