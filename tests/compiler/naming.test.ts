import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../packages/compiler/src/index.ts";
import type { StylesheetIr } from "../../packages/compiler/src/ir/types.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { scanSelectorClasses } from "../../packages/compiler/src/naming/scan.ts";
import type { ClassEntry } from "../../packages/compiler/src/naming/types.ts";

/**
 * Class rewrite tests (SPECIFICATION.md §7.2, ADR-0010).
 *
 * The suite drives the real parser and lowerer, then inspects the rewritten IR
 * and the class table. No fixture is edited here; malformed/exotic selectors are
 * authored inline so each boundary is explicit.
 */

const FIXTURES = join(import.meta.dir, "..", "fixtures");

function irFor(source: string, file = "input.cssx"): StylesheetIr {
  const parsed = parse(source, { file });
  return lower(parsed.ast, { file }).ir;
}

function selectors(ir: StylesheetIr): string[] {
  return ir.rules.map((node) => ("declarations" in node ? node.selector : `<${node.name}>`));
}

function entriesByName(entries: readonly ClassEntry[]): Record<string, ClassEntry> {
  return Object.fromEntries(entries.map((entry) => [entry.name, entry]));
}

describe("naming: prefix strategy", () => {
  test("canonical/button renames top-level and nested references with one table", () => {
    const source = readFileSync(join(FIXTURES, "canonical", "button", "input.cssx"), "utf8");
    const ir = irFor(source, "canonical/button/input.cssx");
    const result = renameClasses(ir, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(selectors(result.ir)).toContain(".ui-button > .ui-icon");
    expect(selectors(result.ir)).toContain(".ui-button:hover");
    const byName = entriesByName(result.classes.entries);
    expect(byName.button?.emitted).toBe("ui-button");
    expect(byName.icon?.emitted).toBe("ui-icon");
    expect(byName.button?.global).toBe(false);
    expect(result.classes.entries.map((entry) => entry.name)).toEqual(["button", "icon"]);
    expect(result.ir.rules.map((rule) => rule.span)).toEqual(ir.rules.map((rule) => rule.span));
  });

  test("naming/prefix and nesting/descendant-bare prefix every class token", () => {
    const prefixFixture = readFileSync(join(FIXTURES, "naming", "prefix", "input.cssx"), "utf8");
    const prefixed = renameClasses(irFor(prefixFixture), { prefix: "ui" });
    expect(selectors(prefixed.ir)).toEqual([".ui-card", ".ui-card-header"]);

    const nested = readFileSync(join(FIXTURES, "nesting", "descendant-bare", "input.cssx"), "utf8");
    const renamed = renameClasses(irFor(nested), { prefix: "ui" });
    expect(selectors(renamed.ir)).toEqual([
      ".ui-button",
      ".ui-button .ui-icon",
      ".ui-button .ui-label .ui-text",
    ]);
  });

  test("an empty prefix and strategy `none` leave classes unchanged", () => {
    const source = ".card { color: red; }";
    expect(renameClasses(irFor(source), { prefix: "" }).ir).toEqual(irFor(source));
    expect(renameClasses(irFor(source), { naming: { strategy: "none", prefix: "ui" } }).ir).toEqual(
      irFor(source),
    );
  });

  test("naming.prefix wins over the top-level prefix", () => {
    const result = renameClasses(irFor(".card { color: red; }"), {
      prefix: "unused",
      naming: { strategy: "prefix", prefix: "ui" },
    });
    expect(selectors(result.ir)).toEqual([".ui-card"]);
  });
});

describe("naming: :global escape", () => {
  test("global/escape unwraps the function, keeps the literal and marks it global", () => {
    const source = readFileSync(join(FIXTURES, "global", "escape", "input.cssx"), "utf8");
    const result = renameClasses(irFor(source), { prefix: "ui" });

    expect(selectors(result.ir)).toEqual([".ui-icon", ".external-icon", ".ui-card .external-icon"]);
    const byName = entriesByName(result.classes.entries);
    expect(byName["external-icon"]?.global).toBe(true);
    expect(byName["external-icon"]?.emitted).toBe("external-icon");
    expect(byName.card?.emitted).toBe("ui-card");
    expect(byName.icon?.emitted).toBe("ui-icon");
  });

  test("a global class is never renamed even when no prefix is applied", () => {
    const result = renameClasses(irFor(":global(.x) { color: red; }"), { prefix: "" });
    expect(selectors(result.ir)).toEqual([".x"]);
    expect(result.classes.entries[0]).toMatchObject({ name: "x", global: true, renamed: false });
  });

  test("a complex :global argument is left wrapped and its classes stay literal", () => {
    const result = renameClasses(irFor(":global(.a, .b) { color: red; }"), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([":global(.a, .b)"]);
    expect(result.classes.entries.map((entry) => [entry.name, entry.global])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  });

  test("a name used both locally and globally keeps the local entry and literal global occurrence", () => {
    const result = renameClasses(irFor(".icon { color: red; } :global(.icon) { color: blue; }"), {
      prefix: "ui",
    });
    expect(selectors(result.ir)).toEqual([".ui-icon", ".icon"]);
    expect(result.classes.entries).toHaveLength(1);
    expect(result.classes.entries[0]).toMatchObject({ name: "icon", emitted: "ui-icon" });
  });
});

describe("naming: rewrite safety", () => {
  test("ids, type selectors, attributes and strings are untouched", () => {
    const source =
      'h1#hero > .card[data-x=".icon"]:not(#id) { color: red; } ' +
      '[class~=".card"] { color: blue; }';
    const result = renameClasses(irFor(source), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([
      'h1#hero > .ui-card[data-x=".icon"]:not(#id)',
      '[class~=".card"]',
    ]);
  });

  test("an attribute value equal to the class name is never rewritten", () => {
    const source =
      '.card[data-x=".card"] { color: red; } ' +
      '[data-y=".card"] { color: blue; } ' +
      '.card[class~=".card"] { color: green; }';
    const result = renameClasses(irFor(source), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([
      '.ui-card[data-x=".card"]',
      '[data-y=".card"]',
      '.ui-card[class~=".card"]',
    ]);
    // Only the real class token enters the table; bracketed contents do not.
    expect(result.classes.entries.map((entry) => [entry.name, entry.emitted])).toEqual([
      ["card", "ui-card"],
    ]);
  });

  test("the class scanner treats bracketed attribute contents as opaque", () => {
    expect(scanSelectorClasses('.a[data-x=".b"]').classes.map((token) => token.name)).toEqual([
      "a",
    ]);
    expect(scanSelectorClasses(".a[data-x=.b]").classes.map((token) => token.name)).toEqual(["a"]);
    expect(scanSelectorClasses("[data-x=.b]").classes).toEqual([]);
  });

  test("class tokens inside functional pseudos are class selectors and are renamed", () => {
    const result = renameClasses(irFor(".wrap:is(.a, .b):not(.c) { color: red; }"), {
      prefix: "ui",
    });
    expect(selectors(result.ir)).toEqual([".ui-wrap:is(.ui-a, .ui-b):not(.ui-c)"]);
  });

  test("comments and escaped characters inside comments stay opaque", () => {
    const result = renameClasses(irFor(".a/* .b */ { color: red; }"), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([".ui-a/* .b */"]);
  });

  test("escaped class identifiers are decoded and re-emitted as a valid bare identifier", () => {
    const result = renameClasses(irFor(".\\31 23 { color: red; }"), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([".ui-123"]);
    expect(result.classes.entries[0]).toMatchObject({ name: "123", emitted: "ui-123" });
  });

  test("an unprefixed escaped class keeps its authored bytes", () => {
    const result = renameClasses(irFor(".\\31 23 { color: red; }"), { prefix: "" });
    expect(selectors(result.ir)).toEqual([".\\31 23"]);
    expect(result.classes.entries[0]).toMatchObject({ name: "123", emitted: "123" });
  });

  test("an anonymous :global pseudo-class is not unwrapped; its class still renames", () => {
    const result = renameClasses(irFor(":global (.x) { color: red; }"), { prefix: "ui" });
    expect(selectors(result.ir)).toEqual([":global (.ui-x)"]);
  });
});

describe("naming: invalid configuration fallback", () => {
  test("an invalid prefix reports XESSA4001 once and leaves classes unprefixed", () => {
    const source = ".card { color: red; } .button { color: blue; }";
    const result = renameClasses(irFor(source), { prefix: "2" });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA4001");
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("Invalid class prefix");
    expect(selectors(result.ir)).toEqual([".card", ".button"]);
    expect(result.classes.entries.map((entry) => entry.emitted)).toEqual(["card", "button"]);
  });

  test("an invalid prefixed result reports XESSA4001 and leaves only that class unprefixed", () => {
    const source = ".foo\\.bar { color: red; } .ok { color: blue; }";
    const result = renameClasses(irFor(source), { prefix: "ui" });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"ui-foo.bar"');
    expect(selectors(result.ir)).toEqual([".foo\\.bar", ".ui-ok"]);
    expect(result.classes.entries.map((entry) => entry.emitted)).toEqual(["foo.bar", "ui-ok"]);
  });

  test("an empty stylesheet yields an empty table and no diagnostics", () => {
    const ir = irFor("");
    const result = renameClasses(ir, { prefix: "2" });
    expect(result.ir).toBe(ir);
    expect(result.classes.entries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("naming: purity and determinism", () => {
  test("the input IR is not mutated and repeated runs agree byte for byte", () => {
    const source = readFileSync(join(FIXTURES, "nesting", "descendant-bare", "input.cssx"), "utf8");
    const ir = irFor(source);
    const before = JSON.stringify(ir);

    const first = renameClasses(ir, { prefix: "ui" });
    const second = renameClasses(ir, { prefix: "ui" });

    expect(JSON.stringify(ir)).toBe(before);
    expect(JSON.stringify(second.ir)).toBe(JSON.stringify(first.ir));
    expect(second.classes).toEqual(first.classes);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  test("the class table is first-appearance ordered across an IR walk", () => {
    const source = ".a { .b { color: red; } } .c { color: blue; }";
    const result = renameClasses(irFor(source), { prefix: "ui" });
    expect(result.classes.entries.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
  });

  test("scanner reports structural failures instead of guessing", () => {
    expect(scanSelectorClasses('.a[data-x="] { }').ok).toBe(false);
    expect(scanSelectorClasses(".a/* unterminated").ok).toBe(false);
    expect(scanSelectorClasses(".a\\").ok).toBe(false);
  });
});
