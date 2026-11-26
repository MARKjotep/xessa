import { describe, expect, test } from "bun:test";
import { parse } from "../../packages/compiler/src/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import type {
  CompileOptions,
  DeclarationIr,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../../packages/compiler/src/lowering/index.ts";

/**
 * Lowering behavior beyond the media fixtures: cascade order, flush rules,
 * native at-rule contexts, restricted contexts and safe grouping.
 *
 * Every assertion works on the IR only. No CSS text is generated here; A06 owns
 * emission and nesting flattening.
 */

function isRule(node: unknown): node is RuleIr {
  return typeof node === "object" && node !== null && "declarations" in node;
}

function isNative(node: unknown): node is NativeBlockIr {
  return typeof node === "object" && node !== null && "children" in node;
}

function isDeclaration(node: unknown): node is DeclarationIr {
  return (
    typeof node === "object" && node !== null && "property" in node && !("declarations" in node)
  );
}

function lowerSource(source: string, options: Partial<CompileOptions> = {}) {
  const file = options.file ?? "src/lowering.cssx";
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  return lower(parsed.ast, { file, ...options });
}

function declarationsOf(ir: StylesheetIr): string[] {
  return ir.rules
    .filter(isRule)
    .flatMap((rule) =>
      rule.declarations.map((declaration) => `${declaration.property}:${declaration.value}`),
    );
}

describe("cascade contract (§5.1, §5.2)", () => {
  test("keeps a later base declaration after an earlier conditional one", () => {
    const { ir, diagnostics } = lowerSource(
      ".a {\n  color: red;\n  @md { color: green; }\n  color: blue;\n}",
    );
    expect(diagnostics).toEqual([]);
    expect(declarationsOf(ir)).toEqual(["color:red", "color:green", "color:blue"]);
    expect(ir.rules.filter(isRule).map((rule) => rule.condition?.query ?? null)).toEqual([
      null,
      "(min-width: 768px)",
      null,
    ]);
  });

  test("keeps duplicate shorthand/longhand declarations in authored order", () => {
    const { ir } = lowerSource(".a { margin: 0; margin-top: 4px; margin: 0 @md 8px; }");
    const [base, md] = ir.rules.filter(isRule);
    expect(
      base?.declarations.map((declaration) => `${declaration.property}:${declaration.value}`),
    ).toEqual(["margin:0", "margin-top:4px", "margin:0"]);
    expect(md?.condition?.query).toBe("(min-width: 768px)");
    expect(md?.declarations.map((declaration) => declaration.value)).toEqual(["8px"]);
  });

  test("expands variants in authored order, never sorted", () => {
    const { ir } = lowerSource(".a { padding: 1px @lg 2px @sm 3px @md 4px; }");
    expect(ir.rules.filter(isRule).map((rule) => rule.condition?.keys[0] ?? "base")).toEqual([
      "base",
      "lg",
      "sm",
      "md",
    ]);
  });

  test("keeps !important on the segment that authored it", () => {
    const { ir } = lowerSource(
      ".a { padding: 10px !important @md 20px; }\n.b { padding: 10px @md 20px !important; }",
    );
    const [aBase, aMd, bBase, bMd] = ir.rules.filter(isRule);
    expect(aBase?.declarations[0]?.important).toBe(true);
    expect(aBase?.declarations[0]?.value).toBe("10px !important");
    expect(aMd?.declarations[0]?.important).toBeUndefined();
    expect(bBase?.declarations[0]?.important).toBeUndefined();
    expect(bMd?.declarations[0]?.important).toBe(true);
  });

  test("flushes the run before a nested rule and keeps the ancestor chain", () => {
    const { ir } = lowerSource(
      ".card { color: red; .icon { width: 4px; } &:hover { color: blue; } padding: 1px; }",
    );
    const runs = ir.rules.filter(isRule);
    expect(runs.map((rule) => rule.selector)).toEqual([".card", ".icon", "&:hover", ".card"]);
    expect(runs.map((rule) => rule.ancestors)).toEqual([[], [".card"], [".card"], []]);
    expect(declarationsOf(ir)).toEqual(["color:red", "width:4px", "color:blue", "padding:1px"]);
  });

  test("nested rules inside a conditional block inherit its condition and ancestors", () => {
    const { ir } = lowerSource(".a { @md { .b { color: red; } } }");
    const runs = ir.rules.filter(isRule);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.selector).toBe(".b");
    expect(runs[0]?.ancestors).toEqual([".a"]);
    expect(runs[0]?.condition?.query).toBe("(min-width: 768px)");
  });

  test("combines a conditional block with an inline variant condition", () => {
    const { ir } = lowerSource(".a { @md { color: red @dark blue; } }");
    const runs = ir.rules.filter(isRule);
    expect(runs.map((rule) => rule.condition?.query ?? null)).toEqual([
      "(min-width: 768px)",
      "(min-width: 768px) and (prefers-color-scheme: dark)",
    ]);
    expect(runs.map((rule) => runKeys(rule))).toEqual([["md"], ["md", "dark"]]);
  });

  test("conditional blocks with the same condition stay separate runs", () => {
    const { ir } = lowerSource(".a { @md { color: red; } @md { color: blue; } }");
    expect(ir.rules.filter(isRule)).toHaveLength(2);
  });
});

function runKeys(rule: RuleIr): readonly string[] {
  return rule.condition?.keys ?? [];
}

describe("native at-rules (§3.5)", () => {
  test("records the native wrapper on the context stack", () => {
    const { ir, diagnostics } = lowerSource(
      ".card {\n  color: black;\n  @media (min-width: 900px) {\n    color: blue;\n    .icon { width: 16px; }\n  }\n}",
    );
    expect(diagnostics).toEqual([]);
    const [outer, block] = ir.rules;
    expect(outer !== undefined && isRule(outer)).toBe(true);
    expect(block !== undefined && isNative(block)).toBe(true);
    if (block === undefined || !isNative(block)) return;
    expect(block.name).toBe("media");
    expect(block.prelude).toBe("(min-width: 900px)");
    expect(block.statement).toBeUndefined();
    expect(block.children).toHaveLength(2);

    const [direct, nested] = block.children;
    expect(direct !== undefined && isRule(direct)).toBe(true);
    expect(nested !== undefined && isRule(nested)).toBe(true);
    if (direct === undefined || !isRule(direct) || nested === undefined || !isRule(nested)) return;
    expect(direct.selector).toBe(".card");
    expect(direct.context.map((entry) => `${entry.name}:${entry.prelude}`)).toEqual([
      "media:(min-width: 900px)",
    ]);
    expect(nested.selector).toBe(".icon");
    expect(nested.ancestors).toEqual([".card"]);
    expect(nested.context.map((entry) => entry.name)).toEqual(["media"]);
  });

  test("nested native at-rules stack outermost-first", () => {
    const { ir } = lowerSource(
      "@layer base { @supports (display: grid) { .a { display: grid; } } }",
    );
    const layer = ir.rules[0];
    expect(layer !== undefined && isNative(layer)).toBe(true);
    if (layer === undefined || !isNative(layer)) return;
    const supports = layer.children[0];
    expect(supports !== undefined && isNative(supports)).toBe(true);
    if (supports === undefined || !isNative(supports)) return;
    const rule = supports.children[0];
    expect(rule !== undefined && isRule(rule)).toBe(true);
    if (rule === undefined || !isRule(rule)) return;
    expect(rule.context.map((entry) => entry.name)).toEqual(["layer", "supports"]);
  });

  test("reports XESSA1001 for a declaration outside a rule and skips it", () => {
    const source = [
      "@media (min-width: 100px) { color: red; .a { color: blue; } }",
      "@keyframes spin { opacity: 0; from { opacity: 1; } }",
    ].join("\n");
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.severity}`)).toEqual([
      "XESSA1001:error",
      "XESSA1001:error",
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "declaration outside a rule",
      "declaration outside a rule",
    ]);
    expect(
      diagnostics.map((diagnostic) => source.slice(diagnostic.span.start, diagnostic.span.end)),
    ).toEqual(["color: red", "opacity: 0"]);

    const [media, keyframes] = ir.rules;
    if (media === undefined || !isNative(media)) throw new Error("expected @media");
    if (keyframes === undefined || !isNative(keyframes)) throw new Error("expected @keyframes");
    expect(media.children).toHaveLength(1);
    const mediaChild = media.children[0];
    expect(mediaChild !== undefined && isRule(mediaChild) && mediaChild.selector === ".a").toBe(
      true,
    );
    expect(keyframes.children).toHaveLength(1);
    const step = keyframes.children[0];
    expect(step !== undefined && isRule(step) && step.selector === "from").toBe(true);
  });

  test("reports XESSA1001 for a conditional block outside a rule and skips the block", () => {
    const source = "@media (min-width: 100px) { @md { .a { color: red; } } .b { color: blue; } }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA1001");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toBe("conditional block outside a rule");
    if (diagnostics[0] !== undefined) {
      expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe(
        "@md { .a { color: red; } }",
      );
    }
    const block = ir.rules[0];
    if (block === undefined || !isNative(block)) throw new Error("expected a native block");
    expect(block.children).toHaveLength(1);
    const child = block.children[0];
    expect(child !== undefined && isRule(child) && child.selector === ".b").toBe(true);
  });

  test("statement at-rules keep their authored prelude and are marked as statements", () => {
    const { ir, diagnostics } = lowerSource(
      '@import "theme.css";\n@layer base, utilities;\n.a { color: red; }',
    );
    expect(diagnostics).toEqual([]);
    expect(ir.rules).toHaveLength(3);
    const [imported, layer] = ir.rules;
    expect(imported !== undefined && isNative(imported) && imported.statement === true).toBe(true);
    expect(imported !== undefined && isNative(imported) && imported.prelude).toBe('"theme.css"');
    expect(layer !== undefined && isNative(layer) && layer.prelude).toBe("base, utilities");
    expect(layer !== undefined && isNative(layer) && layer.children).toEqual([]);
  });
});

describe("restricted native contexts (§3.5, §4.3)", () => {
  test("rejects an inline modifier inside @keyframes and omits that step's run", () => {
    const source = "@keyframes spin {\n  from { opacity: 0; }\n  to { opacity: 1 @md 0.5; }\n}";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA3001");
    expect(diagnostics[0]?.message).toContain("Unsupported Xessa transformation in this context");
    expect(diagnostics[0]?.message).toContain("@keyframes");
    if (diagnostics[0] !== undefined) {
      expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe(
        "opacity: 1 @md 0.5",
      );
    }
    const keyframes = ir.rules[0];
    if (keyframes === undefined || !isNative(keyframes)) throw new Error("expected @keyframes");
    expect(keyframes.children).toHaveLength(1);
    const step = keyframes.children[0];
    expect(step !== undefined && isRule(step) && step.selector === "from").toBe(true);
    expect(step !== undefined && isRule(step) && step.declarations[0]?.value).toBe("0");
  });

  test("rejects a conditional block inside @font-face but keeps plain declarations", () => {
    const source = "@font-face { font-family: X; @md { src: url(a); } }";
    const { ir, diagnostics } = lowerSource(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA3001");
    expect(diagnostics[0]?.message).toContain("@font-face");
    const fontFace = ir.rules[0];
    if (fontFace === undefined || !isNative(fontFace)) throw new Error("expected @font-face");
    expect(fontFace.children).toHaveLength(1);
    const declaration = fontFace.children[0];
    expect(declaration !== undefined && isDeclaration(declaration)).toBe(true);
    expect(declaration !== undefined && isDeclaration(declaration) && declaration.property).toBe(
      "font-family",
    );
  });

  test("passes classic @page declarations through without diagnostics", () => {
    const { ir, diagnostics } = lowerSource("@page { margin: 1cm; }");
    expect(diagnostics).toEqual([]);
    const page = ir.rules[0];
    if (page === undefined || !isNative(page)) throw new Error("expected @page");
    expect(page.name).toBe("page");
    expect(page.prelude).toBe("");
    expect(page.statement).toBeUndefined();
    expect(page.children).toHaveLength(1);
    const declaration = page.children[0];
    if (declaration === undefined || !isDeclaration(declaration)) {
      throw new Error("expected a descriptor declaration");
    }
    expect(declaration.property).toBe("margin");
    expect(declaration.value).toBe("1cm");
  });

  test("passes descriptor declarations through @font-face and @property", () => {
    const { ir, diagnostics } = lowerSource(
      '@font-face { font-family: "X"; src: url(x.woff2); }\n@property --x { syntax: "<color>"; inherits: false; initial-value: red; }',
    );
    expect(diagnostics).toEqual([]);
    const [fontFace, property] = ir.rules;
    if (fontFace === undefined || !isNative(fontFace)) throw new Error("expected @font-face");
    if (property === undefined || !isNative(property)) throw new Error("expected @property");
    expect(
      fontFace.children.filter(isDeclaration).map((declaration) => declaration.property),
    ).toEqual(["font-family", "src"]);
    expect(property.children.filter(isDeclaration).map((declaration) => declaration.value)).toEqual(
      ['"<color>"', "false", "red"],
    );
  });
});

describe("groupRuns (§5.3)", () => {
  test("safe merges adjacent identical runs and keeps the first span", () => {
    const { ir } = lowerSource(".a { @md { color: red; } @md { color: blue; } }");
    const raw = ir.rules.filter(isRule);
    expect(raw).toHaveLength(2);
    const grouped = groupRuns(ir);
    const runs = grouped.rules.filter(isRule);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.declarations.map((declaration) => declaration.value)).toEqual(["red", "blue"]);
    expect(runs[0]?.span).toEqual(raw[0]?.span);
    expect(runs[0]?.condition?.query).toBe("(min-width: 768px)");
  });

  test("different conditions never merge", () => {
    const { ir } = lowerSource(".a { @md { color: red; } @lg { color: blue; } }");
    expect(groupRuns(ir).rules.filter(isRule)).toHaveLength(2);
  });

  test("different ancestor chains never merge even with identical selector text", () => {
    const { ir } = lowerSource(".a { .b { x: 1; } } .c { .b { x: 2; } }");
    const runs = ir.rules.filter(isRule);
    expect(runs.map((rule) => rule.ancestors)).toEqual([[".a"], [".c"]]);
    expect(groupRuns(ir).rules.filter(isRule)).toHaveLength(2);
  });

  test("a nested rule blocks a merge", () => {
    const { ir } = lowerSource(".a { color: red; .b { x: 1; } color: blue; }");
    expect(ir.rules).toHaveLength(3);
    expect(groupRuns(ir).rules).toHaveLength(3);
  });

  test("different native contexts never merge", () => {
    const { ir } = lowerSource(
      "@media (min-width: 100px) { .a { color: red; } }\n@supports (display: grid) { .a { color: red; } }",
    );
    expect(groupRuns(ir).rules).toHaveLength(2);
  });

  test("children of one native block merge among themselves", () => {
    const { ir } = lowerSource(
      "@media (min-width: 100px) { .a { color: red; } .a { color: blue; } }",
    );
    const block = ir.rules[0];
    if (block === undefined || !isNative(block)) throw new Error("expected a native block");
    expect(block.children.filter(isRule)).toHaveLength(2);

    const grouped = groupRuns(ir);
    const groupedBlock = grouped.rules[0];
    if (groupedBlock === undefined || !isNative(groupedBlock))
      throw new Error("expected a native block");
    const merged = groupedBlock.children.filter(isRule);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.declarations.map((declaration) => declaration.value)).toEqual([
      "red",
      "blue",
    ]);
    expect(merged[0]?.context.map((entry) => entry.prelude)).toEqual(["(min-width: 100px)"]);
  });

  test("mode none returns the authored IR unchanged", () => {
    const { ir } = lowerSource(".a { @md { color: red; } @md { color: blue; } }");
    expect(groupRuns(ir, "none")).toBe(ir);
    expect(groupRuns(ir, "none").rules.filter(isRule)).toHaveLength(2);
  });
});

describe("determinism, immutability and directive scope", () => {
  const source =
    '@setup { prefix: "ui"; }\n@media-types { compact: (max-width: 500px); }\n.card { padding: 1px @md 2px @compact 3px; .icon { width: 4px; } }';

  test("lowering the same AST twice yields deeply equal, frozen IR", () => {
    const file = "src/determinism.cssx";
    const parsed = parse(source, { file });
    const before = JSON.stringify(parsed.ast);
    const first = lower(parsed.ast, { file });
    const second = lower(parsed.ast, { file });
    expect(first.ir).toEqual(second.ir);
    expect(JSON.stringify(first.ir)).toBe(JSON.stringify(second.ir));
    expect(JSON.stringify(parsed.ast)).toBe(before);
    expect(first.diagnostics).toEqual([]);

    expect(Object.isFrozen(first.ir)).toBe(true);
    expect(Object.isFrozen(first.ir.rules)).toBe(true);
    const rule = first.ir.rules.filter(isRule)[0];
    expect(rule !== undefined && Object.isFrozen(rule)).toBe(true);
    expect(rule !== undefined && Object.isFrozen(rule.declarations)).toBe(true);
    expect(rule !== undefined && Object.isFrozen(rule.declarations[0])).toBe(true);
  });

  test("every rule span stays inside the source and covers its first declaration", () => {
    const file = "src/spans.cssx";
    const parsed = parse(source, { file });
    const { ir } = lower(parsed.ast, { file });
    for (const rule of ir.rules.filter(isRule)) {
      expect(rule.span.file).toBe(file);
      expect(rule.span.start).toBeGreaterThanOrEqual(0);
      expect(rule.span.end).toBeLessThanOrEqual(source.length);
      expect(rule.span.start).toBeLessThan(rule.span.end);
      const first = rule.declarations[0];
      if (first !== undefined) expect(rule.span).toEqual(first.span);
    }
  });

  test("@setup, @use, @variables, @media-types and @runtime emit no IR", () => {
    const { ir, diagnostics } = lowerSource(
      '@setup { prefix: "ui"; }\n@use "./theme.cssx";\n@variables { gap: 1px; }\n@runtime { primary: red @dark blue; }\n@media-types { compact: (max-width: 500px); }',
    );
    expect(diagnostics).toEqual([]);
    expect(ir.rules).toEqual([]);
  });

  test("an empty stylesheet lowers to an empty rule list", () => {
    expect(lowerSource("").ir.rules).toEqual([]);
  });
});
