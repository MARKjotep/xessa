import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { compile, compileProject } from "../../packages/compiler/src/index.ts";
import type { RuleIr, StylesheetIr } from "../../packages/compiler/src/ir/index.ts";
import { expandGroupUseSites, lower } from "../../packages/compiler/src/lowering/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type {
  GroupResolution,
  ModuleGraph,
  ModuleRecord,
} from "../../packages/compiler/src/resolver/index.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";
import type { Diagnostic } from "../../packages/compiler/src/types/diagnostics.ts";
import type {
  CompileOptions,
  CompileProjectOptions,
  ModuleHost,
} from "../../packages/compiler/src/types/options.ts";

/**
 * Expansion half of reusable declaration groups (ADR-0017, plan G3).
 *
 * A use site is replaced in place by the group's defaults (definition order)
 * followed by the use-site block (authored order); nothing is filtered,
 * reordered or deduplicated. Defaults resolve `$refs` in the defining module and
 * overrides in the consumer, unknown/ambiguous groups and `@runtime` defaults are
 * XESSA2001 with exactly that construct omitted, and expanded spans stay
 * authored. Grammar lives in `groups.parser.test.ts`, collection/visibility in
 * `groups.resolver.test.ts`.
 */

const WORKSPACE = "/workspace";
const OPTIONS: CompileOptions = { file: "groups.expansion.test" };

function createHost(files: Readonly<Record<string, string>>): ModuleHost {
  const map = new Map(Object.entries(files));
  return {
    async readFile(path: string): Promise<string> {
      const content = map.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return map.has(path);
    },
    canonicalize(path: string): string {
      return path;
    },
    resolvePath(from: string, to: string): string {
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      return WORKSPACE;
    },
  };
}

function moduleAt(graph: ModuleGraph, file: string): ModuleRecord {
  const record = graph.modules.get(file);
  if (record === undefined) throw new Error(`module not loaded: ${file}`);
  return record;
}

interface ExpandedSource {
  readonly file: string;
  readonly ast: Stylesheet;
  readonly record: ModuleRecord;
  readonly diagnostics: readonly Diagnostic[];
  readonly ir: StylesheetIr["rules"];
}

/** Parse → resolve → expand → lower one module, without emitting CSS. */
async function expandSource(
  source: string,
  files: Readonly<Record<string, string>> = {},
  file = `${WORKSPACE}/single.cssx`,
): Promise<ExpandedSource> {
  const host = createHost({ ...files, [file]: source });
  const graph = await buildModuleGraph([file], host, OPTIONS);
  const record = moduleAt(graph, file);
  const scopes = new Map<string, ReadonlyMap<string, GroupResolution>>();
  for (const [module, moduleRecord] of graph.modules) scopes.set(module, moduleRecord.groups);
  const expanded = expandGroupUseSites(record.ast, {
    module: file,
    groups: record.groups,
    scopes,
  });
  const lowered = lower(expanded.ast, { file });
  for (const diagnostic of lowered.diagnostics) {
    if (diagnostic.code === "XESSA1001" || diagnostic.code === "XESSA3001") {
      throw new Error(`unexpected lowering diagnostic: ${diagnostic.message}`);
    }
  }
  return {
    file,
    ast: expanded.ast,
    record,
    diagnostics: expanded.diagnostics,
    ir: lowered.ir.rules,
  };
}

/** The single rule of an expanded module, asserted to exist. */
function onlyRule(ir: ExpandedSource["ir"]): RuleIr {
  expect(ir).toHaveLength(1);
  const rule = ir[0];
  if (rule === undefined || !("declarations" in rule)) throw new Error("expected one rule");
  return rule;
}

async function buildProject(
  files: Readonly<Record<string, string>>,
  root: string,
  entry = "entry.cssx",
  options: CompileProjectOptions = {},
) {
  const results = await compileProject([entry], createHost(files), {
    projectRoot: root,
    ...options,
  });
  const result = results[entry];
  if (result === undefined) throw new Error(`missing result for ${entry}`);
  return result;
}

function codes(diagnostics: readonly { readonly code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

const CARD_SOURCE = [
  "@group.card {",
  "  padding: 12px;",
  "  border-radius: 8px;",
  "  color: black;",
  "}",
  ".panel {",
  "  @group.card {",
  "    padding: 20px;",
  "    color: navy;",
  "  }",
  "}",
  "",
].join("\n");

describe("groups: expansion is a splice at the authored position", () => {
  test("defaults keep definition order and every same-property repeat survives in the IR", async () => {
    const expanded = await expandSource(CARD_SOURCE);
    expect(expanded.diagnostics).toEqual([]);
    const rule = onlyRule(expanded.ir);
    const declarations = rule.declarations.map(
      (declaration) => `${declaration.property}: ${declaration.value}`,
    );

    expect(declarations).toEqual([
      "padding: 12px",
      "border-radius: 8px",
      "color: black",
      "padding: 20px",
      "color: navy",
    ]);
    // Invariant 3: no filter, no dedupe. Both `padding` lines are present.
    expect(declarations).toContain("padding: 12px");
    expect(declarations).toContain("padding: 20px");
    // Spans stay authored: defaults point at the definition, overrides at the
    // use-site block, and no position is invented.
    expect(rule.declarations.map((declaration) => declaration.span.start)).toEqual([
      CARD_SOURCE.indexOf("padding: 12px"),
      CARD_SOURCE.indexOf("border-radius: 8px"),
      CARD_SOURCE.indexOf("color: black"),
      CARD_SOURCE.indexOf("padding: 20px"),
      CARD_SOURCE.indexOf("color: navy"),
    ]);
    expect(rule.declarations.every((declaration) => declaration.span.file === expanded.file)).toBe(
      true,
    );
  });

  test("the emitted CSS repeats both declarations in authored order", async () => {
    const file = `${WORKSPACE}/entry.cssx`;
    const result = await buildProject({ [file]: CARD_SOURCE }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(
      ".panel{padding:12px;border-radius:8px;color:black;padding:20px;color:navy;}",
    );
  });

  test("two use sites expand independently and safe grouping is unchanged", async () => {
    const source = [
      "@group.card {",
      "  padding: 12px;",
      "  border-radius: 8px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    padding: 20px;",
      "  }",
      "}",
      ".tile {",
      "  @group.card {",
      "    border-radius: 0;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(
      ".panel{padding:12px;border-radius:8px;padding:20px;}.tile{padding:12px;border-radius:8px;border-radius:0;}",
    );
  });

  test("use sites expand at any depth: nested rules, conditional blocks and native blocks", async () => {
    const source = [
      "@group.card {",
      "  padding: 12px;",
      "}",
      ".outer {",
      "  @group.card {",
      "    gap: 1px;",
      "  }",
      "  .inner {",
      "    @group.card {",
      "      margin: 0;",
      "    }",
      "  }",
      "  @md {",
      "    .cond {",
      "      @group.card {",
      "        color: red;",
      "      }",
      "    }",
      "  }",
      "  @supports (display: grid) {",
      "    @group.card {",
      "      display: grid;",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(
      ".outer{padding:12px;gap:1px;}.outer .inner{padding:12px;margin:0;}@media (min-width: 768px){.outer .cond{padding:12px;color:red;}}@supports (display: grid){.outer{padding:12px;display:grid;}}",
    );
  });

  test("a style-imported module expands its own use sites before the entry", async () => {
    const root = `${WORKSPACE}/module-use`;
    const entry = `${root}/entry.cssx`;
    const definerSource = [
      "@group.card {",
      "  padding: 12px;",
      "}",
      ".card {",
      "  @group.card {",
      "    color: black;",
      "  }",
      "}",
      "",
    ].join("\n");
    const entrySource = [
      '@use "./card.cssx" styles;',
      ".panel {",
      "  @group.card {",
      "    color: navy;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject(
      { [entry]: entrySource, [`${root}/card.cssx`]: definerSource },
      root,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(".card{padding:12px;color:black;}.panel{padding:12px;color:navy;}");
  });

  test("an empty definition expands to the use-site declarations only", async () => {
    const source = [
      "@group.empty {",
      "}",
      ".x {",
      "  @group.empty {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(".x{color:red;}");
  });

  test("the single-source compile() path expands through the same wiring", async () => {
    const result = await compile(CARD_SOURCE, {
      file: "single.cssx",
      workspaceRoot: WORKSPACE,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(
      ".panel{padding:12px;border-radius:8px;color:black;padding:20px;color:navy;}",
    );
  });

  test("a definition emits nothing and a group-free AST is returned unchanged", async () => {
    const definitionOnly = ["@group.card {", "  padding: 12px;", "}", ""].join("\n");
    const expanded = await expandSource(definitionOnly);
    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.ir).toEqual([]);

    const plain = await expandSource(".panel {\n  color: red;\n}\n");
    // No use site: the pass returns the same AST instance (no churn, and
    // group-free sources keep byte-identical output downstream).
    expect(plain.ast).toBe(plain.record.ast);
  });
});

describe("groups: token attribution across modules", () => {
  test("a default resolves $refs in the defining module and overrides in the consumer", async () => {
    const root = `${WORKSPACE}/defining-tokens`;
    const entry = `${root}/entry.cssx`;
    const definer = `${root}/definer.cssx`;
    const entrySource = [
      '@use "./definer.cssx" styles;',
      "@variables {",
      "  pad: 40px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    margin: $pad;",
      "  }",
      "}",
      "",
    ].join("\n");
    const definerSource = [
      "@variables {",
      "  pad: 12px;",
      "}",
      "@group.card {",
      "  padding: $pad;",
      "}",
      "",
    ].join("\n");

    const result = await buildProject({ [entry]: entrySource, [definer]: definerSource }, root);
    expect(result.diagnostics).toEqual([]);
    // The entry's identically named `$pad` must not leak into the default.
    expect(result.css).toBe(".panel{padding:12px;margin:40px;}");
    expect(result.css).not.toContain("padding: 40px");
  });

  test("a @runtime reference in a use-site block registers its custom property", async () => {
    const root = `${WORKSPACE}/use-site-runtime`;
    const entry = `${root}/entry.cssx`;
    const source = [
      '@use "./theme.cssx" as t;',
      "@group.card {",
      "  padding: 12px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    gap: $t.space;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject(
      { [entry]: source, [`${root}/theme.cssx`]: "@runtime {\n  space: 4px;\n}\n" },
      root,
    );
    expect(result.diagnostics).toEqual([]);
    // The namespaced runtime member is only known from the use-site declaration,
    // so reference attribution must walk group use sites or the `var()` would
    // point at a custom property that is never declared.
    expect(result.css).toBe(":root{--space:4px;}.panel{padding:12px;gap:var(--space);}");
  });

  test("an unresolved $ref in a use-site block reports the exact reference span", async () => {
    const source = [
      "@group.card {",
      "  padding: 12px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    color: $missing;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing diagnostic");
    const start = source.indexOf("$missing");
    expect(diagnostic.span).toEqual({
      start,
      end: start + "$missing".length,
      file: `${WORKSPACE}/entry.cssx`,
    });
    expect(result.css).toBe(".panel{padding:12px;}");
  });

  test("a spliced declaration maps to its authored file and line in the source map", async () => {
    const root = `${WORKSPACE}/group-map`;
    const entry = `${root}/entry.cssx`;
    const definer = `${root}/definer.cssx`;
    const entrySource = [
      '@use "./definer.cssx" styles;',
      ".panel {",
      "  @group.card {",
      "    margin: 0;",
      "  }",
      "}",
      "",
    ].join("\n");
    const definerSource = ["@group.card {", "  padding: 12px;", "}", ""].join("\n");

    const result = await buildProject(
      { [entry]: entrySource, [definer]: definerSource },
      root,
      "entry.cssx",
      { output: { sourceMap: true } },
    );
    expect(result.diagnostics).toEqual([]);
    const css = result.css ?? "";
    const map = JSON.parse(result.sourceMap ?? "{}") as {
      readonly sources: readonly string[];
      readonly mappings: string;
    };
    expect(map.sources).toEqual(["definer.cssx", "entry.cssx"]);

    const mappings = decodeMappings(map.mappings);
    const generated = zeroBasedAt(css, "padding");
    const mapping = mappings.find(
      (candidate) =>
        candidate.generatedLine === generated.line &&
        candidate.generatedColumn === generated.column,
    );
    if (mapping === undefined) throw new Error("missing mapping for the spliced declaration");
    expect(map.sources[mapping.sourceIndex]).toBe("definer.cssx");
    expect({ line: mapping.sourceLine, column: mapping.sourceColumn }).toEqual(
      zeroBasedAt(definerSource, "padding"),
    );

    // The use-site override keeps its own consumer position.
    const override = zeroBasedAt(css, "margin");
    const overrideMapping = mappings.find(
      (candidate) =>
        candidate.generatedLine === override.line && candidate.generatedColumn === override.column,
    );
    if (overrideMapping === undefined) throw new Error("missing mapping for the override");
    expect(map.sources[overrideMapping.sourceIndex]).toBe("entry.cssx");
    expect({ line: overrideMapping.sourceLine, column: overrideMapping.sourceColumn }).toEqual(
      zeroBasedAt(entrySource, "margin"),
    );
  });
});

describe("groups: diagnostics and recovery", () => {
  test("an unknown group omits exactly the use-site block and the rule continues", async () => {
    const source = [
      ".panel {",
      "  color: red;",
      "  @group.missing {",
      "    color: blue;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing diagnostic");
    expect(diagnostic.message).toContain('Unknown group "@group.missing"');
    expect(diagnostic.message).toContain(`${WORKSPACE}/entry.cssx`);
    expect(diagnostic.span.file).toBe(`${WORKSPACE}/entry.cssx`);
    expect(source.slice(diagnostic.span.start, diagnostic.span.end)).toBe(
      "@group.missing {\n    color: blue;\n  }",
    );
    expect(result.css).toBe(".panel{color:red;}");
  });

  test("a rule emptied by the rejection is dropped like any other", async () => {
    const source = [".panel {", "  @group.missing {", "    color: blue;", "  }", "}", ""].join(
      "\n",
    );
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    expect(result.css).toBe("");
  });

  test("a token-only import exposes no group, so the use site is unknown", async () => {
    const root = `${WORKSPACE}/token-only`;
    const entry = `${root}/entry.cssx`;
    const source = [
      '@use "./theme.cssx";',
      ".panel {",
      "  @group.card {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject(
      {
        [entry]: source,
        [`${root}/theme.cssx`]: "@group.card {\n  padding: 8px;\n}\n",
      },
      root,
    );
    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    expect(result.diagnostics[0]?.message).toContain('Unknown group "@group.card"');
    expect(result.css).toBe("");
  });

  test("an ambiguous group names both defining modules, omits the block and stays inert", async () => {
    const root = `${WORKSPACE}/ambiguous`;
    const entry = `${root}/entry.cssx`;
    const source = [
      '@use "./a.cssx" styles;',
      '@use "./b.cssx" styles;',
      ".panel {",
      "  margin: 0;",
      "  @group.card {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject(
      {
        [entry]: source,
        [`${root}/a.cssx`]: "@group.card {\n  padding: 8px;\n}\n",
        [`${root}/b.cssx`]: "@group.card {\n  padding: 12px;\n}\n",
      },
      root,
    );

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing diagnostic");
    expect(diagnostic.message).toContain('Ambiguous group "@group.card"');
    expect(diagnostic.message).toContain(`${root}/a.cssx`);
    expect(diagnostic.message).toContain(`${root}/b.cssx`);
    // Both definitions stay inert and never emit `padding`.
    expect(result.css).toBe(".panel{margin:0;}");
  });

  test("a local definition shadows an imported one without a diagnostic", async () => {
    const root = `${WORKSPACE}/shadow`;
    const entry = `${root}/entry.cssx`;
    const source = [
      '@use "./a.cssx" styles;',
      "@group.card {",
      "  padding: 99px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject(
      { [entry]: source, [`${root}/a.cssx`]: "@group.card {\n  padding: 8px;\n}\n" },
      root,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(".panel{padding:99px;color:red;}");
  });

  test("a duplicate definition is XESSA2001 at the later statement and the first expands", async () => {
    const source = [
      "@group.card {",
      "  padding: 8px;",
      "}",
      "@group.card {",
      "  padding: 99px;",
      "}",
      ".p {",
      "  @group.card {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing diagnostic");
    expect(diagnostic.message).toContain('Duplicate group definition "@group.card"');
    expect(source.slice(diagnostic.span.start, diagnostic.span.end)).toBe(
      "@group.card {\n  padding: 99px;\n}",
    );
    expect(result.css).toBe(".p{padding:8px;color:red;}");
  });

  test("a @runtime reference in a default is XESSA2001 and only that default is omitted", async () => {
    const source = [
      "@runtime {",
      "  space: 4px;",
      "}",
      "@group.card {",
      "  padding: $space;",
      "  border: 1px solid;",
      "}",
      ".panel {",
      "  @group.card {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    expect(result.diagnostics[0]?.message).toContain("A @runtime token is not allowed");
    expect(result.diagnostics[0]?.span.file).toBe(`${WORKSPACE}/entry.cssx`);
    // The offending default segment is gone; the remaining default (`border`)
    // and the use-site override (`color`) still expand.
    const css = result.css ?? "";
    expect(css).not.toContain("padding");
    expect(css).not.toContain("var(");
    expect(css).toContain("border:1px solid;");
    expect(css).toContain("color:red;");
  });
});

describe("groups: authored declaration shapes", () => {
  test("inline variants in defaults expand in authored order", async () => {
    const source = [
      "@group.resp {",
      "  padding: 10px @md 20px;",
      "}",
      ".p {",
      "  @group.resp {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    const css = result.css ?? "";

    // Authored order: base segment, then the `@md` segment, then the override.
    const base = css.indexOf("padding:10px;");
    const media = css.indexOf("@media (min-width: 768px)");
    const variant = css.indexOf("padding:20px;");
    const override = css.indexOf("color:red;");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(media).toBeGreaterThan(base);
    expect(variant).toBeGreaterThan(media);
    expect(override).toBeGreaterThan(variant);
  });

  test("a group default's !important is not beaten by a plain use-site declaration", async () => {
    const source = [
      "@group.imp {",
      "  padding: 12px !important;",
      "}",
      ".panel {",
      "  @group.imp {",
      "    padding: 20px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(".panel{padding:12px !important;padding:20px;}");
  });
});

describe("groups: composition inside definitions (ADR-0025)", () => {
  test("a local composition expands its overrides in authored order with the cascade intact", async () => {
    const source = [
      "@group.base {",
      "  padding: 12px;",
      "  color: black;",
      "}",
      "@group.card {",
      "  @group.base {",
      "    padding: 16px;",
      "  }",
      "  margin: 0;",
      "  @group.base {",
      "    color: navy;",
      "  }",
      "}",
      ".panel {",
      "  @group.card {",
      "    padding: 20px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(result.diagnostics).toEqual([]);
    // Every composed line and every override stays in authored order; nothing is
    // deduplicated even though `base` is composed twice.
    expect(result.css).toBe(
      ".panel{padding:12px;color:black;padding:16px;margin:0;padding:12px;color:black;color:navy;padding:20px;}",
    );
  });

  test("transitive composition resolves through each definition's own body", async () => {
    const source = [
      "@group.a { padding: 1px; }",
      "@group.b {",
      "  @group.a { margin: 2px; }",
      "  color: blue;",
      "}",
      "@group.c {",
      "  @group.b { border: 1px solid; }",
      "}",
      ".x {",
      "  @group.c { gap: 3px; }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBe(".x{padding:1px;margin:2px;color:blue;border:1px solid;gap:3px;}");
  });

  test("a styles-imported base resolves in the defining module, not the consumer's shadow", async () => {
    const root = `${WORKSPACE}/composition-module`;
    const entry = `${root}/entry.cssx`;
    const definer = `${root}/definer.cssx`;
    const entrySource = [
      '@use "./definer.cssx" styles;',
      "@group.base {",
      "  padding: 99px;",
      "}",
      ".panel {",
      "  @group.card {",
      "    gap: 1px;",
      "  }",
      "}",
      ".other {",
      "  @group.base {",
      "  }",
      "}",
      "",
    ].join("\n");
    const definerSource = [
      "@group.base {",
      "  padding: 8px;",
      "}",
      "@group.card {",
      "  @group.base {",
      "    color: red;",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = await buildProject({ [entry]: entrySource, [definer]: definerSource }, root);
    expect(result.diagnostics).toEqual([]);
    // `card` is defined in the imported module, so its composition of `base`
    // uses that module's scope; the entry's `base` shadow cannot rebind it.
    expect(result.css).toBe(".panel{padding:8px;color:red;gap:1px;}.other{padding:99px;}");
  });

  test("a composition cycle is XESSA2001 with the chain and only that statement is omitted", async () => {
    const source = [
      "@group.a {",
      "  @group.b {",
      "    color: red;",
      "  }",
      "  padding: 1px;",
      "}",
      "@group.b {",
      "  @group.a {",
      "    margin: 2px;",
      "  }",
      "}",
      ".x {",
      "  @group.a {",
      "    gap: 3px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing cycle diagnostic");
    expect(diagnostic.message).toContain("Cyclic group composition");
    expect(diagnostic.message).toContain("@group.a -> @group.b -> @group.a");
    expect(source.slice(diagnostic.span.start, diagnostic.span.end)).toBe(
      "@group.a {\n    margin: 2px;\n  }",
    );
    // The closing statement is omitted; every other line still expands.
    expect(result.css).toBe(".x{color:red;padding:1px;gap:3px;}");
  });

  test("composition depth is capped at 64 without a stack overflow", async () => {
    const lines: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      lines.push(`@group.g${index} {`);
      if (index === 0) lines.push("  padding: 1px;");
      lines.push(`  @group.g${index + 1} {`);
      lines.push("  }");
      lines.push("}");
    }
    lines.push("@group.g65 {");
    lines.push("  color: red;");
    lines.push("}");
    lines.push(".x {");
    lines.push("  @group.g0 {");
    lines.push("  }");
    lines.push("}");
    const source = `${lines.join("\n")}\n`;

    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    expect(result.diagnostics[0]?.message).toContain("depth limit of 64");
    expect(result.css).toBe(".x{padding:1px;}");
  });

  test("an unknown nested composition is XESSA2001 and only that statement is omitted", async () => {
    const source = [
      "@group.card {",
      "  @group.missing {",
      "    color: red;",
      "  }",
      "  padding: 1px;",
      "}",
      ".x {",
      "  @group.card {",
      "    gap: 3px;",
      "  }",
      "}",
      ".y {",
      "  @group.card {",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    // The same broken nested statement reached from two use sites reports once.
    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing unknown diagnostic");
    expect(diagnostic.message).toContain('Unknown group "@group.missing"');
    expect(source.slice(diagnostic.span.start, diagnostic.span.end)).toBe(
      "@group.missing {\n    color: red;\n  }",
    );
    expect(result.css).toBe(".x{padding:1px;gap:3px;}.y{padding:1px;}");
  });

  test("an ambiguous nested composition names both modules and stays inert", async () => {
    const root = `${WORKSPACE}/composition-ambiguous`;
    const entry = `${root}/entry.cssx`;
    const entrySource = [
      '@use "./a.cssx" styles;',
      '@use "./b.cssx" styles;',
      "@group.card {",
      "  @group.base {",
      "    color: red;",
      "  }",
      "  padding: 1px;",
      "}",
      ".x {",
      "  @group.card {",
      "    gap: 3px;",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = await buildProject(
      {
        [entry]: entrySource,
        [`${root}/a.cssx`]: "@group.base {\n  padding: 8px;\n}\n",
        [`${root}/b.cssx`]: "@group.base {\n  padding: 12px;\n}\n",
      },
      root,
    );

    expect(codes(result.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing ambiguous diagnostic");
    expect(diagnostic.message).toContain('Ambiguous group "@group.base"');
    expect(diagnostic.message).toContain(`${root}/a.cssx`);
    expect(diagnostic.message).toContain(`${root}/b.cssx`);
    expect(result.css).toBe(".x{padding:1px;gap:3px;}");
  });

  test("base defaults and nested overrides keep their defining module's token scope", async () => {
    const root = `${WORKSPACE}/composition-tokens`;
    const entry = `${root}/entry.cssx`;
    const definer = `${root}/definer.cssx`;
    const entrySource = [
      '@use "./definer.cssx" styles;',
      "@variables {",
      "  pad: 40px;",
      "}",
      "@group.card {",
      "  @group.base {",
      "    margin: $pad;",
      "  }",
      "}",
      ".x {",
      "  @group.card {",
      "    gap: $pad;",
      "  }",
      "}",
      "",
    ].join("\n");
    const definerSource = [
      "@variables {",
      "  pad: 8px;",
      "}",
      "@group.base {",
      "  padding: $pad;",
      "}",
      "",
    ].join("\n");

    const result = await buildProject({ [entry]: entrySource, [definer]: definerSource }, root);
    expect(result.diagnostics).toEqual([]);
    // Base default: `definer` scope (8px). Composition override and use site:
    // the entry's scope (40px). No consumer value leaks into the base.
    expect(result.css).toBe(".x{padding:8px;margin:40px;gap:40px;}");
  });

  test("a composition override authored in the defining module resolves there", async () => {
    const root = `${WORKSPACE}/composition-override-tokens`;
    const entry = `${root}/entry.cssx`;
    const definer = `${root}/definer.cssx`;
    const entrySource = [
      '@use "./definer.cssx" styles;',
      "@variables {",
      "  pad: 40px;",
      "}",
      ".x {",
      "  @group.card {",
      "    gap: $pad;",
      "  }",
      "}",
      "",
    ].join("\n");
    const definerSource = [
      "@variables {",
      "  pad: 8px;",
      "}",
      "@group.base {",
      "  padding: 12px;",
      "}",
      "@group.card {",
      "  @group.base {",
      "    margin: $pad;",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = await buildProject({ [entry]: entrySource, [definer]: definerSource }, root);
    expect(result.diagnostics).toEqual([]);
    // The override was authored inside `definer`, so it resolves to 8px even
    // though the entry defines an identically named `$pad`.
    expect(result.css).toBe(".x{padding:12px;margin:8px;gap:40px;}");
  });

  test("a @runtime reference in a composed default or nested override is XESSA2001", async () => {
    const source = [
      "@runtime {",
      "  space: 4px;",
      "}",
      "@group.base {",
      "  padding: $space;",
      "  border: 1px solid;",
      "}",
      "@group.card {",
      "  @group.base {",
      "    margin: $space;",
      "  }",
      "  color: black;",
      "}",
      ".x {",
      "  @group.card {",
      "    gap: 1px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    // One diagnostic for the composed base default, one for the nested override.
    expect(codes(result.diagnostics)).toEqual(["XESSA2001", "XESSA2001"]);
    expect(
      result.diagnostics.every((diagnostic) =>
        diagnostic.message.includes("A @runtime token is not allowed"),
      ),
    ).toBe(true);
    // Only the rejected segments are omitted; the rest of the chain and the use
    // site still expand, and no `var()` is produced for either default.
    expect(result.css).toBe(":root{--space:4px;}.x{border:1px solid;color:black;gap:1px;}");
    expect(result.css).not.toContain("var(");
  });

  test("a nested @group statement in a use-site block is still XESSA1001", async () => {
    const source = [
      "@group.card { padding: 1px; }",
      ".x {",
      "  @group.card {",
      "    @group.base {",
      "      color: red;",
      "    }",
      "    gap: 3px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = await buildProject({ [`${WORKSPACE}/entry.cssx`]: source }, WORKSPACE);

    expect(codes(result.diagnostics)).toEqual(["XESSA1001"]);
    expect(result.diagnostics[0]?.message).toContain("@group.card");
    expect(result.diagnostics[0]?.message).toContain("declarations only");
    expect(result.css).toBe(".x{padding:1px;gap:3px;}");
  });
});

describe("groups: determinism", () => {
  test("repeated builds of the same input are byte-identical", async () => {
    const root = `${WORKSPACE}/repeat`;
    const entry = `${root}/entry.cssx`;
    const files = {
      [entry]: [
        '@use "./definer.cssx" styles;',
        "@variables {",
        "  pad: 40px;",
        "}",
        ".panel {",
        "  @group.card {",
        "    margin: $pad;",
        "  }",
        "}",
        "",
      ].join("\n"),
      [`${root}/definer.cssx`]: [
        "@variables {",
        "  pad: 12px;",
        "}",
        "@group.card {",
        "  padding: $pad;",
        "  color: black;",
        "}",
        "",
      ].join("\n"),
    };

    const first = await buildProject(files, root, "entry.cssx", { output: { sourceMap: true } });
    const second = await buildProject(files, root, "entry.cssx", { output: { sourceMap: true } });
    expect(second.css).toBe(first.css);
    expect(second.sourceMap).toBe(first.sourceMap);
    expect(first.diagnostics).toEqual([]);
  });
});

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface DecodedMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceIndex: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}

/** Decode one base64 VLQ segment (in-test decoder, independent of the emitter). */
function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new Error(`invalid base64 VLQ character ${character}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

/** Decode a v3 `mappings` string into absolute positions. */
function decodeMappings(mappings: string): DecodedMapping[] {
  const decoded: DecodedMapping[] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  const lines = mappings.split(";");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || line.length === 0) continue;
    let generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue;
      const [deltaColumn, deltaSource, deltaSourceLine, deltaSourceColumn] = decodeVlq(segment);
      if (
        deltaColumn === undefined ||
        deltaSource === undefined ||
        deltaSourceLine === undefined ||
        deltaSourceColumn === undefined
      ) {
        throw new Error(`unexpected mapping segment shape: ${segment}`);
      }
      generatedColumn += deltaColumn;
      source += deltaSource;
      sourceLine += deltaSourceLine;
      sourceColumn += deltaSourceColumn;
      decoded.push({
        generatedLine: lineIndex,
        generatedColumn,
        sourceIndex: source,
        sourceLine,
        sourceColumn,
      });
    }
  }
  return decoded;
}

/** Zero-based line/column of a needle in authored text. */
function zeroBasedAt(text: string, needle: string): { line: number; column: number } {
  const offset = text.indexOf(needle);
  if (offset < 0) throw new Error(`missing ${JSON.stringify(needle)}`);
  let line = 0;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text.charAt(index) === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
