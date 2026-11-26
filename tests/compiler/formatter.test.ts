import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { format } from "../../packages/compiler/src/formatter/index.ts";
import { compile, parse } from "../../packages/compiler/src/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { flattenIr } from "../../packages/compiler/src/selectors/index.ts";
import type { BlockItem, Declaration, Stylesheet } from "../../packages/compiler/src/types/ast.ts";

/**
 * Canonical formatter contract: idempotence on every fixture, deterministic
 * directive/conditional/nested layout, comment preservation, safe error
 * fallback, and compilation invariance (formatting never changes CSS output).
 */

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

function collectFixtures(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (existsSync(join(path, "input.cssx"))) {
      found.push(path);
      continue;
    }
    found.push(...collectFixtures(path));
  }
  return found;
}

function setupPrefix(ast: Stylesheet): string {
  let prefix = "";
  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      if (setting.key !== "prefix") continue;
      const raw = setting.value.trim();
      prefix = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }
  return prefix;
}

interface Compiled {
  readonly css: string;
  readonly diagnostics: readonly string[];
}

function compileCss(source: string, file: string): Compiled {
  const parsed = parse(source, { file });
  const lowered = lower(parsed.ast, { file });
  const renamed = renameClasses(lowered.ir, { prefix: setupPrefix(parsed.ast) });
  const grouped = groupRuns(renamed.ir, "safe");
  const flattened = flattenIr(grouped);
  const emitted = emitCss(flattened.ir, { minify: false });
  return {
    css: emitted.css,
    diagnostics: [...parsed.diagnostics, ...lowered.diagnostics, ...emitted.diagnostics].map(
      (diagnostic) => diagnostic.code,
    ),
  };
}

interface GroupDeclarationShape {
  readonly property: string;
  readonly value: string;
  readonly variants: readonly string[];
  readonly raw: string;
}

interface GroupShape {
  readonly kind: string;
  readonly name: string;
  readonly declarations: readonly GroupDeclarationShape[];
}

/**
 * Group nodes in source order with their declaration text, for round-trip
 * comparison. `raw` is the authored declaration slice, so equal shapes prove
 * the formatter neither dropped nor rewrote a group declaration (ADR-0017).
 */
function groupShapes(ast: Stylesheet, source: string): GroupShape[] {
  const declarationShape = (declaration: Declaration): GroupDeclarationShape => ({
    property: declaration.property,
    value: declaration.value,
    variants: declaration.variants.map((variant) =>
      variant.value.length === 0
        ? `@${variant.aliases.join("+")}`
        : `@${variant.aliases.join("+")} ${variant.value}`,
    ),
    raw: source.slice(declaration.span.start, declaration.span.end),
  });

  const shapes: GroupShape[] = [];
  const visit = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "group-use-site") {
        shapes.push({
          kind: item.kind,
          name: item.name,
          declarations: item.declarations.map(declarationShape),
        });
      } else if (item.kind === "rule") {
        visit(item.body);
      } else if (item.kind === "native-at-rule" && item.block !== undefined) {
        visit(item.block);
      }
    }
  };

  for (const item of ast.items) {
    if (item.kind === "group-definition") {
      shapes.push({
        kind: item.kind,
        name: item.name,
        declarations: item.declarations.map(declarationShape),
      });
    } else if (item.kind === "rule") {
      visit(item.body);
    } else if (item.kind === "native-at-rule" && item.block !== undefined) {
      visit(item.block);
    }
  }
  return shapes;
}

const fixtures = collectFixtures(fixturesRoot)
  .sort()
  .map((directory) => {
    const id = relative(fixturesRoot, directory).split(sep).join("/");
    return { id, source: readFileSync(join(directory, "input.cssx"), "utf8") };
  });

describe("formatter idempotence", () => {
  test("format(format(x)) equals format(x) for every fixture input", () => {
    // 54 pre-existing fixtures + the 13 single-file `groups/` fixtures (G4a).
    expect(fixtures).toHaveLength(67);
    for (const fixture of fixtures) {
      const file = `${fixture.id}/input.cssx`;
      const once = format(fixture.source, file);
      const twice = format(once.formatted, file);
      expect({ id: fixture.id, formatted: twice.formatted }).toEqual({
        id: fixture.id,
        formatted: once.formatted,
      });
    }
  });

  test("parse errors leave the original source byte-identical", () => {
    const source = "@md {\n  .card { padding: 20px; }\n}\n";
    const result = format(source, "src/invalid.cssx");
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(result.formatted).toBe(source);
  });

  test("canonical output ends with exactly one newline", () => {
    const result = format(".a { color: red; }\n\n\n", "src/a.cssx");
    expect(result.formatted).toBe(".a {\n  color: red;\n}\n");
    expect(format("", "src/empty.cssx").formatted).toBe("");
  });
});

describe("canonical layout", () => {
  test("directives, declarations, variants, nesting and conditions", () => {
    const source = [
      '@setup { prefix: "ui"; css-dir: "../styles"; }',
      '@use "./theme.cssx" as theme;',
      "@variables { spacing: 12px; }",
      "@runtime { --brand: #2563eb; }",
      "@media-types { compact: (max-width: 500px); }",
      ".button {",
      "display:flex;",
      "padding: 12px @md 20px @xl 32px;",
      "margin: 10px !important @md 20px;",
      "&:hover { opacity: 0.85; }",
      "@xl { display: block; }",
      "}",
      "",
    ].join("\n");

    const result = format(source, "src/button.cssx");
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "@setup {",
        '  prefix: "ui";',
        '  css-dir: "../styles";',
        "}",
        "",
        '@use "./theme.cssx" as theme;',
        "",
        "@variables {",
        "  spacing: 12px;",
        "}",
        "",
        "@runtime {",
        "  --brand: #2563eb;",
        "}",
        "",
        "@media-types {",
        "  compact: (max-width: 500px);",
        "}",
        "",
        ".button {",
        "  display: flex;",
        "  padding: 12px @md 20px @xl 32px;",
        "  margin: 10px !important @md 20px;",
        "",
        "  &:hover {",
        "    opacity: 0.85;",
        "  }",
        "",
        "  @xl {",
        "    display: block;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("@use … styles keeps the rule-merge clause (and a literal `styles` alias stays an alias)", () => {
    // Regression for CSSX-A22/A24: `printUse` used to drop `UseImport.styles`,
    // silently downgrading a rule-merge import to a token-only one (ADR-0014).
    const source = [
      '@use "./x.cssx" as m styles;',
      '@use "./x.cssx" styles;',
      '@use "./x.cssx" as styles;',
      ".button { color: red; }",
      "",
    ].join("\n");

    const result = format(source, "src/imports.cssx");
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        '@use "./x.cssx" as m styles;',
        "",
        '@use "./x.cssx" styles;',
        "",
        '@use "./x.cssx" as styles;',
        "",
        ".button {",
        "  color: red;",
        "}",
        "",
      ].join("\n"),
    );
    expect(format(result.formatted, "src/imports.cssx").formatted).toBe(result.formatted);
  });

  test("comments in native preludes are not duplicated and block comments survive", () => {
    const source = [
      "@media screen /* prelude */ {",
      "  /* inside */",
      "  .a { color: red; /* value */ }",
      "}",
      "",
    ].join("\n");
    const result = format(source, "src/native.cssx");
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "@media screen /* prelude */ {",
        "  /* inside */",
        "  .a {",
        "    color: red;",
        "    /* value */",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.formatted.split("/* prelude */")).toHaveLength(2);
    expect(result.formatted.split("/* inside */")).toHaveLength(2);
  });

  test("comments stay on their own lines and are never duplicated", () => {
    const source = [
      "/* header */",
      ".button {",
      "  /* before */",
      "  color: red; /* trailing */",
      '  content: "/* not a comment */";',
      "}",
      "/* footer */",
      "",
    ].join("\n");

    const result = format(source, "src/comments.cssx");
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "/* header */",
        ".button {",
        "  /* before */",
        "  color: red;",
        "  /* trailing */",
        '  content: "/* not a comment */";',
        "}",
        "",
        "/* footer */",
        "",
      ].join("\n"),
    );
    expect(result.formatted.split("/* header */")).toHaveLength(2);
    expect(result.formatted).toContain('"/* not a comment */"');
  });
});

/** IR shape without positions, for authored-vs-formatted equality. */
const POSITION_KEYS = new Set([
  "span",
  "selectorSpan",
  "start",
  "end",
  "file",
  "offset",
  "line",
  "column",
]);
function normalizedIr(ast: Stylesheet): string {
  return JSON.stringify(ast, (key, value: unknown) => (POSITION_KEYS.has(key) ? undefined : value));
}

describe("formatter defect regressions (CSSX-T05, CSSX-T01, CSSX-T02)", () => {
  test("CSSX-T05: a namespaced token declaration keeps its authored `$` sigil", () => {
    const file = "src/tokens.cssx";
    const source = "@variables {\n  $layout.margin: 4px;\n}\n";
    const result = format(source, file);
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(source);
    expect(format(result.formatted, file).formatted).toBe(result.formatted);

    const block = parse(result.formatted, { file }).ast.items.find(
      (item) => item.kind === "variables",
    );
    expect(block?.kind === "variables" ? block.tokens : []).toMatchObject([
      { kind: "token-declaration", name: "layout.margin", value: "4px" },
    ]);
    expect(parse(result.formatted, { file }).diagnostics).toEqual([]);
  });

  test("CSSX-T05: a plain `$name` keeps its sigil and an unsigiled name is unchanged", () => {
    const file = "src/tokens.cssx";
    // The sigil is authored, not invented: a source that omitted it keeps that
    // form (both parse to the same stripped `name`).
    expect(format("@variables {\n  $margin: 4px;\n}\n", file).formatted).toBe(
      "@variables {\n  $margin: 4px;\n}\n",
    );
    expect(format("@variables {\n  margin: 4px;\n}\n", file).formatted).toBe(
      "@variables {\n  margin: 4px;\n}\n",
    );

    const source = "@variables { $margin: 4px; }\n.a { margin: $margin; }\n";
    const formatted = format(source, file);
    expect(formatted.diagnostics).toEqual([]);
    expect(formatted.formatted).toContain("$margin: 4px;");
    const before = compileCss(source, file);
    const after = compileCss(formatted.formatted, file);
    expect({ css: after.css, diagnostics: after.diagnostics }).toEqual({
      css: before.css,
      diagnostics: before.diagnostics,
    });
  });

  test("CSSX-T01: an at-rule prelude that swallows the terminator stays a fixed point", () => {
    const file = "src/native.cssx";
    const cases: ReadonlyArray<readonly [source: string, formatted: string]> = [
      ["@x[a", "@x [a\n"],
      ["@media[x { a: b; }", "@media [x { a: b; }\n"],
      ["@x[a;", "@x [a;\n"],
      ["@x(a", "@x (a\n"],
    ];
    for (const [source, expected] of cases) {
      const once = format(source, file);
      expect({ source, diagnostics: once.diagnostics }).toEqual({ source, diagnostics: [] });
      expect({ source, formatted: once.formatted }).toEqual({ source, formatted: expected });
      expect({ source, twice: format(once.formatted, file).formatted }).toEqual({
        source,
        twice: once.formatted,
      });
      expect({
        source,
        after: normalizedIr(parse(once.formatted, { file }).ast),
      }).toEqual({
        source,
        after: normalizedIr(parse(source, { file }).ast),
      });
    }
    // A balanced prelude still gets its terminator.
    expect(format("@x[a]", file).formatted).toBe("@x [a];\n");
  });

  test("CSSX-T02: adjacent `@`-markers keep their variant split", () => {
    const file = "src/variants.cssx";
    const source = ".a { x: 1 @a@b 2; }";
    const once = format(source, file);
    expect(once.diagnostics).toEqual([]);
    expect(once.formatted).toBe(".a {\n  x: 1 @a@b 2;\n}\n");
    expect(format(once.formatted, file).formatted).toBe(once.formatted);

    const before = parse(source, { file }).ast;
    const after = parse(once.formatted, { file }).ast;
    expect(normalizedIr(after)).toBe(normalizedIr(before));
    // Plus-joined aliases stay one variant with two aliases.
    expect(format(".a { x: 1 @a+b 2; }", file).formatted).toBe(".a {\n  x: 1 @a+b 2;\n}\n");
  });
});

describe("compilation invariance", () => {
  const representative = [
    "lexical/calc",
    "media/inline-variants",
    "media/block-conditions",
    "nesting/descendant-bare",
    "important/per-segment",
    "media/combined-and",
  ];

  test("formatting representative fixtures keeps CSS and diagnostics identical", () => {
    for (const id of representative) {
      const fixture = fixtures.find((candidate) => candidate.id === id);
      expect(fixture).toBeDefined();
      if (fixture === undefined) continue;
      const file = `${id}/input.cssx`;
      const formatted = format(fixture.source, file);
      expect({ id, diagnostics: formatted.diagnostics }).toEqual({ id, diagnostics: [] });

      const before = compileCss(fixture.source, file);
      const after = compileCss(formatted.formatted, file);
      expect({ id, css: after.css, diagnostics: after.diagnostics }).toEqual({
        id,
        css: before.css,
        diagnostics: before.diagnostics,
      });
    }
  });
});

describe("@group formatting (ADR-0017)", () => {
  const file = "src/groups.cssx";

  // The ADR-0017 example, plus an inline-variant default and an inline
  // `!important` override, authored compactly enough that the definition
  // declarations are already canonical: their raw slices must survive verbatim.
  const source = [
    "@group.card {",
    "  padding: 12px @md 20px;",
    "  border-radius: 8px;",
    "  border: 1px solid #ddd;",
    "  color: black;",
    "}",
    "",
    ".panel {",
    "  @group.card {",
    "    padding: 20px !important;",
    "    color: navy;",
    "  }",
    "}",
    "",
    ".tile { @group.card { border-radius: 0; } }",
    "",
  ].join("\n");

  test("definitions and use sites print like other at-rule blocks", () => {
    const result = format(source, file);
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "@group.card {",
        "  padding: 12px @md 20px;",
        "  border-radius: 8px;",
        "  border: 1px solid #ddd;",
        "  color: black;",
        "}",
        "",
        ".panel {",
        "  @group.card {",
        "    padding: 20px !important;",
        "    color: navy;",
        "  }",
        "}",
        "",
        ".tile {",
        "  @group.card {",
        "    border-radius: 0;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("round trip keeps both node kinds with byte-identical declarations", () => {
    // Regression for the G1 finding: pre-G5 `format()` returned `.panel {\n}\n`
    // for this source — the definition and both use sites were dropped with no
    // diagnostic, so format-on-save would have deleted authored groups.
    const result = format(source, file);
    const before = groupShapes(parse(source, { file }).ast, source);
    const after = groupShapes(parse(result.formatted, { file }).ast, result.formatted);

    expect(after).toEqual(before);
    expect(after.map((shape) => shape.kind)).toEqual([
      "group-definition",
      "group-use-site",
      "group-use-site",
    ]);
    expect(after.map((shape) => shape.name)).toEqual(["card", "card", "card"]);
    expect(after[0]?.declarations.map((declaration) => declaration.raw)).toEqual([
      "padding: 12px @md 20px",
      "border-radius: 8px",
      "border: 1px solid #ddd",
      "color: black",
    ]);
    expect(after[1]?.declarations.map((declaration) => declaration.raw)).toEqual([
      "padding: 20px !important",
      "color: navy",
    ]);
  });

  test("formatting is idempotent and never empties a group source", () => {
    const once = format(source, file);
    expect(once.formatted).not.toBe("");
    expect(once.formatted).toContain("@group.card {");
    expect(format(once.formatted, file).formatted).toBe(once.formatted);
  });

  test("every group fixture keeps its authored @group statements", () => {
    const groupFixtures = fixtures.filter((fixture) => fixture.id.startsWith("groups/"));
    expect(groupFixtures.length).toBeGreaterThanOrEqual(13);

    for (const fixture of groupFixtures) {
      const fixtureFile = `${fixture.id}/input.cssx`;
      const once = format(fixture.source, fixtureFile);
      const twice = format(once.formatted, fixtureFile);
      const authoredRefs = fixture.source.match(/@group\./g)?.length ?? 0;
      const printedRefs = once.formatted.match(/@group\./g)?.length ?? 0;

      expect({ id: fixture.id, formatted: twice.formatted }).toEqual({
        id: fixture.id,
        formatted: once.formatted,
      });
      // Parse-error fixtures are returned unchanged, so both sides match there
      // too; accepted fixtures must print every definition and use site.
      expect({ id: fixture.id, refs: printedRefs }).toEqual({
        id: fixture.id,
        refs: authoredRefs,
      });
    }
  });

  test("a semicolonless final declaration prints like a rule body (ADR-0011)", () => {
    const missing = [
      "@group.card {",
      "  padding: 12px;",
      "  color: black",
      "}",
      "",
      ".panel {",
      "  @group.card {",
      "    color: navy",
      "  }",
      "}",
      "",
      ".plain { color: red }",
      "",
    ].join("\n");

    const result = format(missing, file);
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "@group.card {",
        "  padding: 12px;",
        "  color: black;",
        "}",
        "",
        ".panel {",
        "  @group.card {",
        "    color: navy;",
        "  }",
        "}",
        "",
        ".plain {",
        "  color: red;",
        "}",
        "",
      ].join("\n"),
    );
    expect(format(result.formatted, file).formatted).toBe(result.formatted);
  });

  test("comments in group bodies are never duplicated or dropped", () => {
    // Calibration standard is the A24 `printUse` fix: authored detail must not
    // vanish. An inline value comment stays in the declaration slice (and is
    // excluded from the free-standing comment pass); a trailing comment gets
    // its own line like everywhere else.
    const source = [
      "/* header */",
      "@group.card {",
      "  /* before */",
      "  width: calc(1px /* in value */ + 2px);",
      "  /* trailing */",
      "}",
      ".panel {",
      "  @group.card {",
      "    color: red; /* override */",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = format(source, file);
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "/* header */",
        "@group.card {",
        "  /* before */",
        "  width: calc(1px /* in value */ + 2px);",
        "  /* trailing */",
        "}",
        "",
        ".panel {",
        "  @group.card {",
        "    color: red;",
        "    /* override */",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.formatted.split("/* in value */")).toHaveLength(2);
    expect(result.formatted.split("/* before */")).toHaveLength(2);
    expect(format(result.formatted, file).formatted).toBe(result.formatted);
  });

  test("parse errors are returned unchanged when group syntax is present", () => {
    const malformed = "@group .card {\n  padding: 12px;\n}\n";
    const malformedResult = format(malformed, file);
    expect(malformedResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(
      true,
    );
    expect(malformedResult.formatted).toBe(malformed);

    const invalid = [
      "@group.card {",
      "  padding: 12px;",
      "}",
      "",
      "@md {",
      "  .card { padding: 20px; }",
      "}",
      "",
    ].join("\n");
    const invalidResult = format(invalid, file);
    expect(invalidResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(
      true,
    );
    expect(invalidResult.formatted).toBe(invalid);
  });

  test("group-free sources keep the pre-G5 canonical layout byte for byte", () => {
    // Every sibling printer path in one source: the group support may only add
    // `@group` output, never churn an existing construct's layout.
    const groupFree = [
      '@setup { prefix: "ui"; }',
      '@use "./theme.cssx" as theme styles;',
      "@variables { spacing: 12px; }",
      "@runtime { --brand: #2563eb; }",
      "@media-types { compact: (max-width: 500px); }",
      "@keyframes spin { from { opacity: 0 } to { opacity: 1 } }",
      ".button { display:flex; padding: 12px @md 20px; margin: 10px !important @md 20px; &:hover { opacity: 0.85 } @xl { display: block } }",
      "",
    ].join("\n");

    const result = format(groupFree, file);
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(
      [
        "@setup {",
        '  prefix: "ui";',
        "}",
        "",
        '@use "./theme.cssx" as theme styles;',
        "",
        "@variables {",
        "  spacing: 12px;",
        "}",
        "",
        "@runtime {",
        "  --brand: #2563eb;",
        "}",
        "",
        "@media-types {",
        "  compact: (max-width: 500px);",
        "}",
        "",
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
        ".button {",
        "  display: flex;",
        "  padding: 12px @md 20px;",
        "  margin: 10px !important @md 20px;",
        "",
        "  &:hover {",
        "    opacity: 0.85;",
        "  }",
        "",
        "  @xl {",
        "    display: block;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.formatted).not.toContain("@group");
    expect(format(result.formatted, file).formatted).toBe(result.formatted);
  });

  test("formatting a group source does not change compiled CSS", async () => {
    const groupSource = [
      "@group.card {",
      "  padding: 12px;",
      "  color: black;",
      "}",
      "",
      ".panel {",
      "  @group.card {",
      "    color: navy;",
      "  }",
      "}",
      "",
    ].join("\n");
    const formatted = format(groupSource, file);
    expect(formatted.diagnostics).toEqual([]);

    const before = await compile(groupSource, { file });
    const after = await compile(formatted.formatted, { file });
    expect(after.css).toBe(before.css);
    expect(after.css).toContain("padding:12px;");
    expect(after.css).toContain("color:navy;");
    expect(after.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      before.diagnostics.map((diagnostic) => diagnostic.code),
    );
  });
});
