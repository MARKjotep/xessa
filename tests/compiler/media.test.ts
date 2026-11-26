import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../packages/compiler/src/index.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import type {
  CompileOptions,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../../packages/compiler/src/lowering/index.ts";

/**
 * Media lowering goldens and XESSA3001 rejection cases.
 *
 * Inputs are parsed through the public barrel and lowered with `lower`. The
 * expected arrays are inline IR goldens (order, resolved query strings, alias
 * keys and declaration sequence). CSS text emission is A06 and is deliberately
 * not asserted here.
 */

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

interface RunSummary {
  readonly selector: string;
  readonly query: string | null;
  readonly keys: readonly string[];
  readonly declarations: readonly string[];
}

function isRule(node: unknown): node is RuleIr {
  return typeof node === "object" && node !== null && "declarations" in node;
}

function summarize(ir: StylesheetIr): RunSummary[] {
  return ir.rules.filter(isRule).map((rule) => ({
    selector: rule.selector,
    query: rule.condition?.query ?? null,
    keys: rule.condition?.keys ?? [],
    declarations: rule.declarations.map(
      (declaration) =>
        `${declaration.property}:${declaration.value}${declaration.important === true ? " !important" : ""}`,
    ),
  }));
}

function lowerSource(source: string, options: Partial<CompileOptions> = {}) {
  const file = options.file ?? "src/media.cssx";
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  return lower(parsed.ast, { file, ...options });
}

function fixtureSource(id: string): string {
  return readFileSync(join(fixturesRoot, "media", id, "input.cssx"), "utf8");
}

function lowerFixture(id: string, options: Partial<CompileOptions> = {}) {
  return lowerSource(fixtureSource(id), { file: `media/${id}/input.cssx`, ...options });
}

describe("media fixture IR goldens", () => {
  test("media/inline-variants expands every segment in authored order", () => {
    const { ir, diagnostics } = lowerFixture("inline-variants");
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)).toEqual([
      { selector: ".card", query: null, keys: [], declarations: ["padding:12px"] },
      {
        selector: ".card",
        query: "(min-width: 768px)",
        keys: ["md"],
        declarations: ["padding:20px"],
      },
      {
        selector: ".card",
        query: "(min-width: 1280px)",
        keys: ["xl"],
        declarations: ["padding:32px"],
      },
      { selector: ".card", query: null, keys: [], declarations: ["background:white"] },
      {
        selector: ".card",
        query: "(prefers-color-scheme: dark)",
        keys: ["dark"],
        declarations: ["background:#181818"],
      },
      {
        selector: ".card",
        query: "(min-width: 1280px) and (prefers-color-scheme: dark)",
        keys: ["xl", "dark"],
        declarations: ["background:#101010"],
      },
      {
        selector: ".card",
        query: "(min-width: 1280px)",
        keys: ["xl"],
        declarations: ["display:grid", "gap:24px"],
      },
      {
        selector: ".card",
        query: "(max-width: 500px)",
        keys: ["compact"],
        declarations: ["display:block"],
      },
    ]);
  });

  test("media/inline-variants segment spans tile the declaration exactly", () => {
    const source = fixtureSource("inline-variants");
    const { ir } = lowerFixture("inline-variants");
    const [base, md, xl] = ir.rules.filter(isRule);
    expect(base).toBeDefined();
    expect(md).toBeDefined();
    expect(xl).toBeDefined();
    if (base === undefined || md === undefined || xl === undefined) return;

    const baseSpan = base.declarations[0]?.span;
    const mdSpan = md.declarations[0]?.span;
    const xlSpan = xl.declarations[0]?.span;
    expect(baseSpan).toBeDefined();
    expect(mdSpan).toBeDefined();
    expect(xlSpan).toBeDefined();
    if (baseSpan === undefined || mdSpan === undefined || xlSpan === undefined) return;

    expect(source.slice(baseSpan.start, baseSpan.end).trimEnd()).toBe("padding: 12px");
    expect(source.slice(mdSpan.start, mdSpan.end).trimEnd()).toBe("@md 20px");
    expect(source.slice(xlSpan.start, xlSpan.end)).toBe("@xl 32px");
    expect(baseSpan.end).toBe(mdSpan.start);
    expect(mdSpan.end).toBe(xlSpan.start);
    expect(base.span).toEqual(baseSpan);
  });

  test("media/combined-and ANDs aliases and normalizes the query", () => {
    const { ir, diagnostics } = lowerFixture("combined-and");
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)).toEqual([
      { selector: ".panel", query: null, keys: [], declarations: ["background:white"] },
      {
        selector: ".panel",
        query: "(prefers-color-scheme: dark)",
        keys: ["dark"],
        declarations: ["background:#181818"],
      },
      {
        selector: ".panel",
        query: "(min-width: 1280px) and (prefers-color-scheme: dark)",
        keys: ["xl", "dark"],
        declarations: ["background:#101010"],
      },
      { selector: ".panel", query: null, keys: [], declarations: ["color:black"] },
      {
        selector: ".panel",
        query: "(min-width: 768px) and (orientation: landscape)",
        keys: ["md", "landscape"],
        declarations: ["color:white"],
      },
      { selector: ".panel", query: null, keys: [], declarations: ["padding:4px"] },
      {
        selector: ".panel",
        query: "(min-width: 1536px)",
        keys: ["2xl"],
        declarations: ["padding:8px"],
      },
    ]);
  });

  test("media/block-conditions inherits and nests block conditions", () => {
    const { ir, diagnostics } = lowerFixture("block-conditions");
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)).toEqual([
      { selector: ".card", query: null, keys: [], declarations: ["display:block"] },
      {
        selector: ".card",
        query: "(min-width: 768px)",
        keys: ["md"],
        declarations: ["display:grid", "gap:16px"],
      },
      {
        selector: ".card",
        query: "(min-width: 768px) and (prefers-color-scheme: dark)",
        keys: ["md", "dark"],
        declarations: ["background:#111111"],
      },
      {
        selector: ".card",
        query: "print",
        keys: ["print"],
        declarations: ["display:none"],
      },
    ]);
  });

  test("media/custom-alias-override lets file aliases win over built-ins", () => {
    const { ir, diagnostics } = lowerFixture("custom-alias-override");
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)).toEqual([
      { selector: ".grid", query: null, keys: [], declarations: ["columns:1"] },
      {
        selector: ".grid",
        query: "(min-width: 700px)",
        keys: ["md"],
        declarations: ["columns:2"],
      },
      {
        selector: ".grid",
        query: "(min-width: 600px) and (max-width: 900px)",
        keys: ["tablet"],
        declarations: ["columns:3"],
      },
    ]);
  });

  test("media/duplicate-aliases normalizes repeated aliases", () => {
    const { ir, diagnostics } = lowerFixture("duplicate-aliases");
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)).toEqual([
      { selector: ".box", query: null, keys: [], declarations: ["padding:4px"] },
      {
        selector: ".box",
        query: "(min-width: 768px)",
        keys: ["md"],
        declarations: ["padding:8px"],
      },
      {
        selector: ".box",
        query: "(min-width: 1280px) and (prefers-color-scheme: dark)",
        keys: ["xl", "dark"],
        declarations: ["padding:16px"],
      },
    ]);
  });
});

describe("alias precedence (ADR-0006)", () => {
  test("built-in < project media < file @media-types", () => {
    const project = lowerSource(".a { width: 1px @md 2px @sm 3px; }", {
      media: { md: "(min-width: 700px)" },
    });
    expect(summarize(project.ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["width:1px"] },
      { selector: ".a", query: "(min-width: 700px)", keys: ["md"], declarations: ["width:2px"] },
      { selector: ".a", query: "(min-width: 640px)", keys: ["sm"], declarations: ["width:3px"] },
    ]);

    const file = lowerSource(
      "@media-types { md: (min-width: 710px); }\n.a { width: 1px @md 2px; }",
      { media: { md: "(min-width: 700px)" } },
    );
    expect(summarize(file.ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["width:1px"] },
      { selector: ".a", query: "(min-width: 710px)", keys: ["md"], declarations: ["width:2px"] },
    ]);
    expect(file.diagnostics).toEqual([]);
  });

  test("later duplicate definitions in one file win in document order", () => {
    const { ir } = lowerSource(
      "@media-types { md: (min-width: 700px); }\n@media-types { md: (min-width: 720px); }\n.a { width: 1px @md 2px; }",
    );
    expect(summarize(ir)[1]).toEqual({
      selector: ".a",
      query: "(min-width: 720px)",
      keys: ["md"],
      declarations: ["width:2px"],
    });
  });

  test("project media does not leak into an unrelated alias", () => {
    const { ir } = lowerSource(".a { width: 1px @lg 2px; }", { media: { md: "(max-width: 1px)" } });
    expect(summarize(ir)[1]?.query).toBe("(min-width: 1024px)");
  });
});

describe("XESSA3001 media rejections", () => {
  test("unknown alias reports the exact alias span and drops only that segment", () => {
    const source = ".a { color: red @ultrawide blue; }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    const diagnostic = diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA3001");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("Unknown media alias");
    expect(diagnostic?.message).toContain("ultrawide");
    if (diagnostic === undefined) return;
    expect(source.slice(diagnostic.span.start, diagnostic.span.end)).toBe("ultrawide");
    expect(summarize(ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["color:red"] },
    ]);
  });

  test("unknown alias in a conditional block omits the whole block", () => {
    const source = ".a { color: red; @nope { color: blue; padding: 1px; } }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("Unknown media alias");
    if (diagnostics[0] !== undefined) {
      // The diagnostic points at the exact alias text, while the whole block is omitted.
      expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe("nope");
    }
    expect(summarize(ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["color:red"] },
    ]);
  });

  test("a comma-list alias is rejected even when used alone", () => {
    const source = "@media-types { wide: screen, print; }\n.a { color: red @wide blue; }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA3001");
    expect(diagnostics[0]?.message).toContain("comma-separated media query lists");
    if (diagnostics[0] !== undefined) {
      expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe("wide");
    }
    expect(summarize(ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["color:red"] },
    ]);
  });

  test("a comma-list alias is rejected when combined", () => {
    const { diagnostics } = lowerSource(
      "@media-types { wide: screen, print; }\n.a { color: red @md+wide blue; }",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA3001");
  });

  test("print + screen is an incompatible combination", () => {
    const source = "@media-types { p: print; s: screen; }\n.a { color: red @p+s blue; }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("incompatible media types");
    if (diagnostics[0] !== undefined) {
      expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe("@p+s");
    }
    expect(summarize(ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["color:red"] },
    ]);
  });

  test("a media type is normalized to the front of a combined query", () => {
    const { ir, diagnostics } = lowerSource(
      "@media-types { p: print; }\n.a { display: none @p+md block; }",
    );
    expect(diagnostics).toEqual([]);
    expect(summarize(ir)[1]).toEqual({
      selector: ".a",
      query: "print and (min-width: 768px)",
      keys: ["p", "md"],
      declarations: ["display:block"],
    });
  });

  test("`not`/`only` definitions are usable alone but not in combinations", () => {
    const alone = lowerSource(
      "@media-types { no-print: not print; }\n.a { display: none @no-print block; }",
    );
    expect(alone.diagnostics).toEqual([]);
    expect(summarize(alone.ir)[1]?.query).toBe("not print");

    const combined = lowerSource(
      "@media-types { no-print: not print; }\n.a { display: none @no-print+md block; }",
    );
    expect(combined.diagnostics).toHaveLength(1);
    expect(combined.diagnostics[0]?.code).toBe("XESSA3001");
    expect(summarize(combined.ir)).toEqual([
      { selector: ".a", query: null, keys: [], declarations: ["display:none"] },
    ]);
  });

  test("an empty definition cannot form a valid query", () => {
    const { diagnostics } = lowerSource(
      "@media-types { broken: ; }\n.a { color: red @broken blue; }",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("cannot form a valid single media query");
  });

  test("native media lists pass through unchanged as a native prelude", () => {
    const source = "@media screen, print { .a { color: red; } }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toEqual([]);
    const block = ir.rules[0] as NativeBlockIr | undefined;
    expect(block?.name).toBe("media");
    expect(block?.prelude).toBe("screen, print");
    if (block === undefined) return;
    const child = block.children[0];
    expect(child !== undefined && "context" in child).toBe(true);
    if (child === undefined || !("context" in child)) return;
    expect(child.context.map((entry) => entry.prelude)).toEqual(["screen, print"]);
    expect(child.condition).toBeNull();
  });
});
