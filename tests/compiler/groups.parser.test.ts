import { describe, expect, test } from "bun:test";
import { parse } from "../../packages/compiler/src/index.ts";
import type {
  Declaration,
  GroupDefinition,
  GroupUseSite,
  Rule,
  Stylesheet,
} from "../../packages/compiler/src/types/ast.ts";
import type { Diagnostic } from "../../packages/compiler/src/types/diagnostics.ts";

/**
 * `@group.<name>` grammar (ADR-0017, SPECIFICATION.md §3.7, plan G1).
 *
 * The lexer keeps `@group`, `.` and the name as adjacent tokens, so the parser
 * recognises the contiguous dotted form and rejects whitespace or a missing
 * name. A top-level statement is a definition; the same statement inside a rule
 * body is a use site. Both blocks accept declarations only, and every rejection
 * is the existing XESSA1001 with statement-scoped recovery. Expansion, symbol
 * resolution and formatting belong to later phases.
 */

const FILE = "src/groups/parser.cssx";

function parseSource(source: string): {
  readonly ast: Stylesheet;
  readonly diagnostics: readonly Diagnostic[];
} {
  return parse(source, { file: FILE });
}

function codes(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function definitions(ast: Stylesheet): readonly GroupDefinition[] {
  return ast.items.filter((item): item is GroupDefinition => item.kind === "group-definition");
}

function onlyDefinition(ast: Stylesheet): GroupDefinition {
  const found = definitions(ast);
  expect(found).toHaveLength(1);
  return found[0] as GroupDefinition;
}

function onlyRule(ast: Stylesheet): Rule {
  const rules = ast.items.filter((item): item is Rule => item.kind === "rule");
  expect(rules).toHaveLength(1);
  return rules[0] as Rule;
}

function useSites(body: readonly { readonly kind: string }[]): readonly GroupUseSite[] {
  return body.filter((item): item is GroupUseSite => item.kind === "group-use-site");
}

function properties(declarations: GroupDefinition["declarations"]): readonly string[] {
  return declarations.map((declaration) => declaration.property);
}

describe("group definitions at the top level", () => {
  test("parses name, declaration order and the exact authored span", () => {
    const source = "@group.card {\n  padding: 12px;\n  color: black;\n}\n";
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    expect(ast.items).toHaveLength(1);
    const definition = onlyDefinition(ast);
    expect(definition.kind).toBe("group-definition");
    expect(definition.name).toBe("card");
    expect(properties(definition.declarations)).toEqual(["padding", "color"]);
    expect(definition.declarations[0]?.value).toBe("12px");
    expect(definition.declarations[1]?.value).toBe("black");
    expect(definition.span).toEqual({
      start: 0,
      end: source.indexOf("}") + 1,
      file: FILE,
    });
    expect(source.slice(definition.span.start, definition.span.end)).toBe(
      "@group.card {\n  padding: 12px;\n  color: black;\n}",
    );
    for (const declaration of definition.declarations) {
      expect(source.slice(declaration.span.start, declaration.span.end)).toBe(
        `${declaration.property}: ${declaration.value}`,
      );
    }
  });

  test("keeps authored order, inline variants and custom properties", () => {
    const source = "@group.surface {\n  --elevation: 2;\n  padding: 8px @md 12px;\n}\n";
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    const definition = onlyDefinition(ast);
    expect(properties(definition.declarations)).toEqual(["--elevation", "padding"]);
    const variant = definition.declarations[1]?.variants[0];
    expect(variant?.aliases).toEqual(["md"]);
    expect(variant?.value).toBe("12px");
  });

  test("an empty definition is legal, inert and diagnostic-free", () => {
    const { ast, diagnostics } = parseSource("@group.empty {}\n");
    expect(diagnostics).toEqual([]);
    const definition = onlyDefinition(ast);
    expect(definition.name).toBe("empty");
    expect(definition.declarations).toEqual([]);
  });

  test("@group.keyframes is an ordinary group name", () => {
    const source =
      "@group.keyframes {\n  color: black;\n}\n.a { @group.keyframes { color: red; } }";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    expect(onlyDefinition(ast).name).toBe("keyframes");
    expect(useSites(onlyRule(ast).body)[0]?.name).toBe("keyframes");
  });

  test("duplicate definitions are both kept; XESSA2001 belongs to the resolver", () => {
    const source = "@group.card { color: red; }\n@group.card { color: blue; }\n";
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    const found = definitions(ast);
    expect(found.map((definition) => definition.name)).toEqual(["card", "card"]);
    expect(found.map((definition) => definition.declarations[0]?.value)).toEqual(["red", "blue"]);
    expect(codes(diagnostics)).toEqual([]);
  });

  test("a definition after a rule is still top-level", () => {
    const { ast, diagnostics } = parseSource(".a { color: red; }\n@group.card { color: black; }\n");
    expect(diagnostics).toEqual([]);
    expect(ast.items.map((item) => item.kind)).toEqual(["rule", "group-definition"]);
  });
});

describe("group use sites in rule bodies", () => {
  test("parses at any nesting depth with exact spans", () => {
    const source = [
      ".a {",
      "  color: red;",
      "  @group.card {",
      "    padding: 20px;",
      "  }",
      "  .nested {",
      "    @group.card {",
      "      color: navy;",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration", "group-use-site", "rule"]);

    const outer = useSites(rule.body)[0] as GroupUseSite;
    expect(outer.kind).toBe("group-use-site");
    expect(outer.name).toBe("card");
    expect(properties(outer.declarations)).toEqual(["padding"]);
    expect(source.slice(outer.span.start, outer.span.end)).toBe(
      "@group.card {\n    padding: 20px;\n  }",
    );

    const nested = rule.body[2] as Rule;
    const inner = useSites(nested.body)[0] as GroupUseSite;
    expect(inner.name).toBe("card");
    expect(properties(inner.declarations)).toEqual(["color"]);
    expect(inner.declarations[0]?.value).toBe("navy");
  });

  test("an empty use-site block parses with no diagnostic", () => {
    const { ast, diagnostics } = parseSource(".a { @group.card {} }");
    expect(diagnostics).toEqual([]);
    const useSite = useSites(onlyRule(ast).body)[0] as GroupUseSite;
    expect(useSite.declarations).toEqual([]);
  });

  test("a group statement inside a rule is a use site, never a definition", () => {
    const { ast, diagnostics } = parseSource(".a { @group.card { color: red; } }");
    expect(diagnostics).toEqual([]);
    expect(definitions(ast)).toEqual([]);
    expect(ast.items.map((item) => item.kind)).toEqual(["rule"]);
    expect(useSites(onlyRule(ast).body)).toHaveLength(1);
  });

  test("a conditional block after a use-site block parses as an ordinary conditional block", () => {
    const source = ".a { @group.card { color: red; } @md { color: blue; } }";
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    const body = onlyRule(ast).body;
    expect(body.map((item) => item.kind)).toEqual(["group-use-site", "conditional-block"]);
    expect(useSites(body)).toHaveLength(1);
  });

  test("two use sites stay independent nodes in authored order", () => {
    const source = ".a { @group.card { color: red; } @group.tile { padding: 1px; } }";
    const { ast, diagnostics } = parseSource(source);
    expect(diagnostics).toEqual([]);
    const sites = useSites(onlyRule(ast).body);
    expect(sites.map((site) => site.name)).toEqual(["card", "tile"]);
  });
});

describe("declarations-only recovery inside a group block", () => {
  test("a nested rule inside a definition is one XESSA1001 and the rest survives", () => {
    const source = "@group.card { padding: 1px; &:hover { color: red; } color: black; }";
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    expect(diagnostics[0]?.message).toContain("@group.card");
    expect(diagnostics[0]?.message).toContain("declarations only");
    const definition = onlyDefinition(ast);
    expect(properties(definition.declarations)).toEqual(["padding", "color"]);
    expect(source.slice(definition.span.start, definition.span.end)).toBe(source);
  });

  test("conditional and native statements inside a definition are one diagnostic each", () => {
    const source = [
      "@group.card {",
      "  color: black;",
      "  @md { color: red; }",
      "  @media screen { color: blue; }",
      "  padding: 1px;",
      "}",
    ].join("\n");
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001", "XESSA1001"]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.message).toContain("@group.card");
      expect(diagnostic.message).toContain("declarations only");
    }
    const definition = onlyDefinition(ast);
    expect(properties(definition.declarations)).toEqual(["color", "padding"]);
    expect(definition.declarations[1]?.value).toBe("1px");
  });

  test("a well-formed nested group composition parses into definition.body in authored order", () => {
    const source = [
      "@group.base {",
      "  padding: 12px;",
      "}",
      "@group.card {",
      "  color: black;",
      "  @group.base {",
      "    padding: 20px;",
      "  }",
      "  margin: 0;",
      "}",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseSource(source);

    expect(diagnostics).toEqual([]);
    const definition = definitions(ast)[1] as GroupDefinition;
    expect(definition.name).toBe("card");
    // `declarations` stays the direct declarations for compatibility.
    expect(properties(definition.declarations)).toEqual(["color", "margin"]);
    expect(definition.body.map((item) => item.kind)).toEqual([
      "declaration",
      "group-use-site",
      "declaration",
    ]);
    const composition = definition.body[1] as GroupUseSite;
    expect(composition.name).toBe("base");
    expect(properties(composition.declarations)).toEqual(["padding"]);
    expect(composition.declarations[0]?.value).toBe("20px");
    expect(source.slice(composition.span.start, composition.span.end)).toBe(
      "@group.base {\n    padding: 20px;\n  }",
    );
  });

  test("the same rejections apply inside a use-site block", () => {
    const source = [
      ".a {",
      "  @group.card {",
      "    padding: 1px;",
      "    .nested { color: red; }",
      "    @md { color: blue; }",
      "    @font-face { font-family: x; }",
      "    @group.other { color: green; }",
      "    color: black;",
      "  }",
      "}",
    ].join("\n");
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001", "XESSA1001", "XESSA1001", "XESSA1001"]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.message).toContain("@group.card");
    }
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["group-use-site"]);
    const useSite = useSites(rule.body)[0] as GroupUseSite;
    expect(properties(useSite.declarations)).toEqual(["padding", "color"]);
  });

  test("a malformed declaration inside a definition is diagnosed without losing the block", () => {
    const { ast, diagnostics } = parseSource("@group.card { color: (; padding: 1px; }");
    expect(codes(diagnostics)).toEqual(["XESSA1003"]);
    const definition = onlyDefinition(ast);
    expect(properties(definition.declarations)).toEqual(["padding"]);
  });
});

describe("malformed dotted forms", () => {
  const cases: readonly { readonly source: string; readonly message: string }[] = [
    { source: "@group { color: red; }", message: '@group."' },
    { source: "@group. { color: red; }", message: "malformed group name" },
    { source: "@group .card { color: red; }", message: "contiguous" },
    { source: "@group. card { color: red; }", message: "contiguous" },
    { source: "@group.2xl { color: red; }", message: "malformed group name" },
    { source: "@group", message: '@group."' },
  ];

  for (const { source, message } of cases) {
    test(`rejects ${JSON.stringify(source)} with one XESSA1001`, () => {
      const { ast, diagnostics } = parseSource(source);
      expect(codes(diagnostics)).toEqual(["XESSA1001"]);
      expect(diagnostics[0]?.message).toContain(message);
      expect(definitions(ast)).toEqual([]);
    });
  }

  test("recovers after a malformed dotted form and keeps the next rule", () => {
    const source = "@group .card { color: red; }\n.a { color: blue; }";
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    expect(ast.items.map((item) => item.kind)).toEqual(["rule"]);
    expect(onlyRule(ast).selector).toBe(".a");
  });

  test("a bare include form is XESSA1001 and the enclosing rule keeps parsing", () => {
    const { ast, diagnostics } = parseSource(".a { padding: 1px; @group.card; color: black; }");

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    expect(diagnostics[0]?.message).toContain("@group.card");
    expect(diagnostics[0]?.message).toContain("block");
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration", "declaration"]);
    const declarations = rule.body.filter(
      (item): item is Declaration => item.kind === "declaration",
    );
    expect(properties(declarations)).toEqual(["padding", "color"]);
  });

  test("a malformed use site inside a rule omits the block but keeps the rule", () => {
    const { ast, diagnostics } = parseSource(".a { color: red; @group. { padding: 1px; } }");

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration"]);
  });
});

describe("out-of-v1 constructs", () => {
  test("a conditional use site is XESSA1001 and the surrounding rule survives", () => {
    const source = ".a { padding: 1px; @group.x @md { color: blue; } color: black; }";
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    expect(diagnostics[0]?.message).toContain("conditional group use site");
    expect(diagnostics[0]?.message).toContain("@group.x");
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration", "declaration"]);
  });

  test("a use site inside a conditional block is XESSA1001 and the conditional survives", () => {
    const source = ".a { @md { @group.card { color: blue; } padding: 2px; } }";
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1001"]);
    expect(diagnostics[0]?.message).toContain("@group.card");
    expect(diagnostics[0]?.message).toContain("conditional block");
    expect(onlyRule(ast).body.map((item) => item.kind)).toEqual(["conditional-block"]);
  });
});

describe("existing recovery with group nodes present", () => {
  test("a declaration that lost its semicolon before a nested rule still reports XESSA1002", () => {
    const source = [
      "@group.card { color: black; }",
      ".a {",
      "  color: red",
      "  &:hover { color: blue; }",
      "  @group.card { padding: 1px; }",
      "}",
    ].join("\n");
    const { ast, diagnostics } = parseSource(source);

    expect(codes(diagnostics)).toEqual(["XESSA1002"]);
    expect(diagnostics[0]?.message).toContain("semicolon");
    const rule = onlyRule(ast);
    expect(rule.body.map((item) => item.kind)).toEqual(["declaration", "rule", "group-use-site"]);
    const declaration = rule.body[0] as { readonly property: string; readonly value: string };
    expect(declaration.property).toBe("color");
    expect(declaration.value).toBe("red");
    expect((rule.body[1] as Rule).selector).toBe("&:hover");
    expect(useSites(rule.body)).toHaveLength(1);
  });
});
