/**
 * Rendered-scope tests for the Xessa TextMate grammar.
 *
 * The grammar is tokenized with the same engine VS Code uses (`vscode-textmate` +
 * `vscode-oniguruma`, dev dependencies of `packages/vscode`). When the WASM toolchain cannot be
 * loaded, these tests are skipped with a recorded reason; they are never softened into fake
 * assertions. Fixture text comes from `tests/fixtures/` where possible.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type Renderer, type ScopedToken, createRenderer } from "./grammar-harness";

const renderer = await createRenderer();
const scopeSuite = renderer ? describe : describe.skip;

function activeRenderer(): Renderer {
  if (!renderer) {
    throw new Error("scope renderer unavailable");
  }
  return renderer;
}

function tokenize(source: string): ScopedToken[] {
  return activeRenderer().tokenize(source);
}

function fixture(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, "tests", "fixtures", relativePath), "utf8");
}

function tokensFor(tokens: ScopedToken[], text: string): ScopedToken[] {
  return tokens.filter((token) => token.text === text);
}

function expectScoped(tokens: ScopedToken[], text: string, scope: string): void {
  const matches = tokensFor(tokens, text);
  expect(matches.length).toBeGreaterThan(0);
  for (const token of matches) {
    expect(token.scopes).toContain(scope);
  }
}

function expectNeverScoped(tokens: ScopedToken[], text: string, scope: string): void {
  for (const token of tokensFor(tokens, text)) {
    expect(token.scopes).not.toContain(scope);
  }
}

scopeSuite("rendered scopes — canonical fixture", () => {
  test("@setup is a directive and @md/@xl are keyword.control.media variant markers", () => {
    const tokens = tokenize(fixture("canonical/button/input.cssx"));
    expectScoped(tokens, "@setup", "keyword.control.directive.xessa");
    expectNeverScoped(tokens, "@setup", "keyword.control.media.xessa");

    expectScoped(tokens, "@md", "keyword.control.media.xessa");
    expectScoped(tokens, "@md", "meta.variant.xessa");
    expectScoped(tokens, "@xl", "keyword.control.media.xessa");
    expectScoped(tokens, "@dark", "keyword.control.media.xessa");
    expectNeverScoped(tokens, "@dark", "keyword.control.at-rule.css");
  });

  test("selectors, properties, values and variables use category scopes", () => {
    const tokens = tokenize(fixture("canonical/button/input.cssx"));
    expectScoped(tokens, ".button", "entity.other.attribute-name.class.css");
    expectScoped(tokens, "display", "support.type.property-name.css");
    expectScoped(tokens, "flex", "support.constant.property-value.css");
    expectScoped(tokens, "$spacing", "variable.other.xessa");
    expectScoped(tokens, "$theme", "variable.other.xessa");
    expectScoped(tokens, "primary", "variable.other.member.xessa");
    expectScoped(tokens, "12", "constant.numeric.css");
    expectScoped(tokens, "px", "keyword.other.unit.css");
    expectScoped(tokens, "#1e40af", "constant.other.color.rgb-value.hex.css");
  });

  test("string contents stay inert (no alias or variable scopes)", () => {
    const tokens = tokenize(fixture("canonical/button/input.cssx"));
    expectScoped(tokens, "./theme.cssx", "string.quoted.double.css");
    expectNeverScoped(tokens, "./theme.cssx", "keyword.control.media.xessa");
    expectNeverScoped(tokens, "./theme.cssx", "variable.other.xessa");
    expectNeverScoped(tokens, "./theme.cssx", "keyword.control.directive.xessa");
  });
});

scopeSuite("rendered scopes — media, nesting and global fixtures", () => {
  test("combined, inline and declaration aliases use the variant marker scope", () => {
    const tokens = tokenize(fixture("media/inline-variants/input.cssx"));
    expectScoped(tokens, "@media-types", "keyword.control.directive.xessa");
    expectNeverScoped(tokens, "@media-types", "keyword.control.media.xessa");
    expectScoped(tokens, "@xl+dark", "keyword.control.media.xessa");
    expectScoped(tokens, "@compact", "keyword.control.media.xessa");
    expectScoped(tokens, "@xl", "keyword.control.media.xessa");
    expectScoped(tokens, "compact", "keyword.control.media.xessa");
  });

  test("parent references, combinators, pseudo-classes and pseudo-elements are distinct", () => {
    const tokens = tokenize(fixture("nesting/pseudo-combinators/input.cssx"));
    expectScoped(tokens, "&", "entity.other.attribute-name.parent-selector.css");
    expectScoped(tokens, ">", "keyword.operator.combinator.css");
    expectScoped(tokens, "+", "keyword.operator.combinator.css");
    expectScoped(tokens, ":hover", "entity.other.attribute-name.pseudo-class.css");
    expectScoped(tokens, "::before", "entity.other.attribute-name.pseudo-element.css");
    expectScoped(tokens, ":nth-child", "entity.other.attribute-name.pseudo-class.css");
    expectScoped(tokens, "2n", "constant.numeric.css");
  });

  test(":global keeps a pseudo-class scope and re-enters selector context", () => {
    const tokens = tokenize(fixture("global/escape/input.cssx"));
    expectScoped(tokens, ":global", "entity.other.attribute-name.pseudo-class.xessa");
    expectScoped(tokens, ".external-icon", "entity.other.attribute-name.class.css");
  });
});

scopeSuite("rendered scopes — synthetic coverage", () => {
  test(".ui-button, ids, type selectors and attribute selectors", () => {
    const tokens = tokenize(
      [
        '#app .ui-button > button[data-kind="primary"]::after { color: red; }',
        ".ui-button { color: red; }",
      ].join("\n"),
    );
    expectScoped(tokens, ".ui-button", "entity.other.attribute-name.class.css");
    expectScoped(tokens, "#app", "entity.other.attribute-name.id.css");
    expectScoped(tokens, "button", "entity.name.tag.css");
    expectScoped(tokens, "::after", "entity.other.attribute-name.pseudo-element.css");
    expectScoped(tokens, "data-kind", "entity.other.attribute-name.css");
  });

  test("native at-rules and preludes use css at-rule and property/constant scopes", () => {
    const tokens = tokenize(
      "@media (min-width: 768px) and (prefers-color-scheme: dark) { .a { color: red; } }",
    );
    expectScoped(tokens, "@media", "keyword.control.at-rule.css");
    expectScoped(tokens, "@media", "meta.at-rule.media.css");
    expectNeverScoped(tokens, "@media", "keyword.control.media.xessa");
    expectScoped(tokens, "min-width", "support.type.property-name.css");
    expectScoped(tokens, "768", "constant.numeric.css");
    expectScoped(tokens, "dark", "support.constant.property-value.css");
    expectNeverScoped(tokens, "dark", "keyword.control.media.xessa");
  });

  test("!important, calc() and units keep their standard css scopes", () => {
    const tokens = tokenize(".a { width: calc(100% - 8px); padding: 10px @md 20px !important; }");
    expectScoped(tokens, "calc", "support.function.calc.css");
    expectScoped(tokens, "!important", "keyword.other.important.css");
    expectScoped(tokens, "10", "constant.numeric.css");
    expectScoped(tokens, "px", "keyword.other.unit.css");
  });

  test("@ and $ inside strings and comments stay inert", () => {
    const tokens = tokenize(
      ["/* @md $x { } */", '.a { content: "@md $x { }"; }', "// @xl"].join("\n"),
    );
    expectScoped(tokens, "@md $x { }", "string.quoted.double.css");
    expectNeverScoped(tokens, "@md $x { }", "keyword.control.media.xessa");
    expectNeverScoped(tokens, "@md $x { }", "variable.other.xessa");
    expectScoped(tokens, " @md $x { } ", "comment.block.xessa");
    expectScoped(tokens, "// @xl", "comment.line.double-slash.xessa");
  });

  test("unterminated constructs fall through without hanging", () => {
    const tokens = tokenize(".a { color: red; .b { padding: 1px");
    expect(tokens.length).toBeGreaterThan(0);
    expectScoped(tokens, ".a", "entity.other.attribute-name.class.css");
    expectScoped(tokens, ".b", "entity.other.attribute-name.class.css");
  });
});

scopeSuite("rendered scopes — @group definitions, use sites and members", () => {
  test("a top-level definition and a rule-body use site have distinct containers", () => {
    const definition = tokenize("@group.card {\n  padding: 12px;\n}");
    expectScoped(definition, "@group", "meta.directive.group.xessa");
    expectScoped(definition, "@group", "keyword.control.directive.xessa");
    expectNeverScoped(definition, "@group", "meta.group.use.xessa");
    expectNeverScoped(definition, "@group", "keyword.control.media.xessa");
    expectNeverScoped(definition, "@group", "keyword.control.at-rule.css");
    expectScoped(definition, "card", "entity.name.type.group.xessa");
    expectNeverScoped(definition, "card", "keyword.control.media.xessa");
    expectNeverScoped(definition, "card", "variable.other.member.xessa");
    expectScoped(definition, "padding", "support.type.property-name.css");

    const useSite = tokenize(".panel {\n  @group.card {\n    color: navy;\n  }\n}");
    expectScoped(useSite, "@group", "meta.group.use.xessa");
    expectScoped(useSite, "@group", "keyword.control.directive.xessa");
    expectNeverScoped(useSite, "@group", "meta.directive.group.xessa");
    expectNeverScoped(useSite, "@group", "keyword.control.media.xessa");
    expectNeverScoped(useSite, "@group", "variable.other.member.xessa");
    expectScoped(useSite, "card", "entity.name.type.group.xessa");
    expectScoped(useSite, "navy", "support.constant.property-value.css");
  });

  test("@group.keyframes is an ordinary group member, unlike $keyframes.spin", () => {
    const tokens = tokenize(
      [
        "@group.keyframes { animation-duration: 0.5s; }",
        ".spinner { animation: $keyframes.spin 1s; @group.keyframes { animation-name: fade; } }",
      ].join("\n"),
    );
    expectScoped(tokens, "keyframes", "entity.name.type.group.xessa");
    expectNeverScoped(tokens, "keyframes", "keyword.control.at-rule.css");
    expectNeverScoped(tokens, "keyframes", "meta.at-rule.keyframes.css");
    expectNeverScoped(tokens, "keyframes", "variable.other.member.xessa");
    expectScoped(tokens, "spin", "variable.other.member.xessa");
    expectNeverScoped(tokens, "spin", "entity.name.type.group.xessa");
  });

  test("@group stays distinct from media aliases and sibling directives", () => {
    const tokens = tokenize(
      [
        "@group.card {",
        "  padding: 12px @md 20px;",
        "}",
        ".panel {",
        "  @group.card {",
        "    padding: 20px;",
        "  }",
        "}",
        "@setup {",
        '  prefix: "ui";',
        "}",
      ].join("\n"),
    );
    expectScoped(tokens, "@md", "keyword.control.media.xessa");
    expectScoped(tokens, "@md", "meta.variant.xessa");
    expectNeverScoped(tokens, "@md", "keyword.control.directive.xessa");
    expectScoped(tokens, "@setup", "keyword.control.directive.xessa");
    expectNeverScoped(tokens, "@setup", "keyword.control.media.xessa");
    expectNeverScoped(tokens, "@group", "keyword.control.media.xessa");
    expectNeverScoped(tokens, "@group", "meta.variant.xessa");
  });

  test("bare and spaced @group forms degrade without mis-scoping following content", () => {
    const tokens = tokenize(
      [
        "@group",
        ".after { color: red; }",
        "@group .card {",
        "  color: blue;",
        "}",
        ".panel {",
        "  @group .card { color: green; }",
        "  @group;",
        "  color: black;",
        "}",
        ".tail { margin: 0; }",
      ].join("\n"),
    );
    expectScoped(tokens, "@group", "keyword.control.directive.xessa");
    expectNeverScoped(tokens, "@group", "meta.directive.group.xessa");
    expectNeverScoped(tokens, "@group", "meta.group.use.xessa");
    expectNeverScoped(tokens, "@group", "keyword.control.media.xessa");
    expectScoped(tokens, ".after", "entity.other.attribute-name.class.css");
    expectScoped(tokens, ".panel", "entity.other.attribute-name.class.css");
    expectScoped(tokens, ".tail", "entity.other.attribute-name.class.css");
    expectScoped(tokens, "color", "support.type.property-name.css");
    expectScoped(tokens, "margin", "support.type.property-name.css");
  });
});

scopeSuite("rendered scopes — semantic-token fallbacks", () => {
  test("a namespaced reference splits the $ns prefix from the member", () => {
    const tokens = tokenize('@use "./theme.cssx" as theme;\n.a { color: $theme.primary; }');
    expectScoped(tokens, "$theme", "variable.other.xessa");
    expectScoped(tokens, "$theme", "variable.other.namespace.xessa");
    expectNeverScoped(tokens, "$theme", "variable.other.member.xessa");
    expectScoped(tokens, "primary", "variable.other.member.xessa");
    expectNeverScoped(tokens, "primary", "variable.other.namespace.xessa");
  });

  test("a bare $token stays a plain variable, never a namespace", () => {
    const tokens = tokenize("@variables { spacing: 4px; }\n.a { padding: $spacing; }");
    expectScoped(tokens, "$spacing", "variable.other.xessa");
    expectNeverScoped(tokens, "$spacing", "variable.other.namespace.xessa");
  });

  test("a $keyframes member carries the member and keyframe fallback scopes", () => {
    const tokens = tokenize(".a { animation: $keyframes.spin 1s; }");
    expectScoped(tokens, "$keyframes", "variable.other.xessa");
    expectScoped(tokens, "$keyframes", "variable.other.namespace.xessa");
    expectScoped(tokens, "spin", "variable.other.member.xessa");
    expectScoped(tokens, "spin", "variable.other.keyframe.xessa");
  });

  test("--custom-property references are scoped in values but not as property names", () => {
    const value = tokenize(".a { background: var(--brand); }");
    expectScoped(value, "--brand", "variable.other.custom-property.xessa");

    const declaration = tokenize(".a { --brand: red; }");
    expectScoped(declaration, "--brand", "support.type.property-name.css");
    expectNeverScoped(declaration, "--brand", "variable.other.custom-property.xessa");

    const atProperty = tokenize('@property --gap { syntax: "<length>"; }');
    expectScoped(atProperty, "--gap", "variable.other.custom-property.xessa");
  });

  test("@runtime declarations expose the runtime declaration scope only there", () => {
    const runtime = tokenize("@runtime { accent: #2563eb; }");
    expectScoped(runtime, "accent", "support.type.property-name.css");
    expectScoped(runtime, "accent", "variable.other.declared.runtime.xessa");

    const rule = tokenize(".a { accent: #2563eb; }");
    expectScoped(rule, "accent", "support.type.property-name.css");
    expectNeverScoped(rule, "accent", "variable.other.declared.runtime.xessa");
  });
});
