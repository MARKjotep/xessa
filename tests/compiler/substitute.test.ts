import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import {
  declarationIr,
  nativeBlockIr,
  ruleIr,
  stylesheetIr,
} from "../../packages/compiler/src/ir/factories.ts";
import type {
  DeclarationIr,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../../packages/compiler/src/ir/types.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { ModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";
import { substitute } from "../../packages/compiler/src/variables/index.ts";

/**
 * Compile-time substitution tests (SPECIFICATION.md §6.1).
 *
 * Tests drive the real lexer/parser/resolver/lowering through an in-memory
 * `ModuleHost`; fixture directories are read by the test harness only.
 */

const WORKSPACE = "/workspace";
const FIXTURES = join(import.meta.dir, "..", "fixtures");

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

function fixtureFiles(group: string, name: string): Record<string, string> {
  const directory = join(FIXTURES, group, name);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".cssx")) continue;
    files[`${WORKSPACE}/${group}/${name}/${entry}`] = readFileSync(join(directory, entry), "utf8");
  }
  return files;
}

interface FlatDeclaration {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly query: string | null;
  readonly important: boolean;
}

function collectDeclarations(ir: StylesheetIr): FlatDeclaration[] {
  const found: FlatDeclaration[] = [];
  const visitRule = (rule: RuleIr): void => {
    for (const declaration of rule.declarations) {
      found.push({
        selector: rule.selector,
        property: declaration.property,
        value: declaration.value,
        query: rule.condition?.query ?? null,
        important: declaration.important === true,
      });
    }
  };
  const visitChildren = (children: NativeBlockIr["children"]): void => {
    for (const child of children) {
      if ("declarations" in child) visitRule(child);
      else if ("children" in child) visitChildren(child.children);
      else {
        found.push({
          selector: "",
          property: (child as DeclarationIr).property,
          value: (child as DeclarationIr).value,
          query: null,
          important: (child as DeclarationIr).important === true,
        });
      }
    }
  };
  for (const node of ir.rules) {
    if ("declarations" in node) visitRule(node);
    else visitChildren(node.children);
  }
  return found;
}

interface Pipeline {
  readonly graph: ModuleGraph;
  readonly ir: StylesheetIr;
  readonly diagnostics: ReturnType<typeof substitute>["diagnostics"];
}

async function run(
  files: Readonly<Record<string, string>>,
  entry: string,
  prefix = "ui",
): Promise<Pipeline> {
  const graph = await buildModuleGraph([entry], createHost(files), {
    file: entry,
  } as CompileOptions);
  const record = graph.modules.get(entry);
  if (record === undefined) throw new Error(`entry not loaded: ${entry}`);
  const lowered = lower(record.ast, { file: entry } as CompileOptions);
  const substituted = substitute(lowered.ir, graph, entry, { prefix });
  return { graph, ir: substituted.ir, diagnostics: substituted.diagnostics };
}

describe("substitute: fixtures", () => {
  test("variables/basic substitutes local tokens including token-to-token references", async () => {
    const entry = `${WORKSPACE}/variables/basic/input.cssx`;
    const result = await run(fixtureFiles("variables", "basic"), entry);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)).toEqual([
      {
        selector: ".card",
        property: "border-radius",
        value: "16px",
        query: null,
        important: false,
      },
      { selector: ".card", property: "padding", value: "8px", query: null, important: false },
      {
        selector: ".card",
        property: "border",
        value: "1px solid 16px",
        query: null,
        important: false,
      },
    ]);
  });

  test("variables/local-overrides-imported keeps the imported module immutable", async () => {
    const entry = `${WORKSPACE}/variables/local-overrides-imported/input.cssx`;
    const tokensFile = `${WORKSPACE}/variables/local-overrides-imported/tokens.cssx`;
    const result = await run(fixtureFiles("variables", "local-overrides-imported"), entry);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      "24px",
    ]);

    const imported = result.graph.modules.get(tokensFile);
    const local = result.graph.modules.get(entry);
    const importedGap = imported?.compileScope.tokens.get("gap");
    const localGap = local?.compileScope.tokens.get("gap");
    expect(importedGap?.declaration.value).toBe("8px");
    expect(localGap?.declaration.value).toBe("24px");
    expect(localGap?.origin.kind).toBe("local");
  });

  test("variables/namespaced-members resolves members only through the namespace", async () => {
    const entry = `${WORKSPACE}/variables/namespaced-members/input.cssx`;
    const result = await run(fixtureFiles("variables", "namespaced-members"), entry);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      "12px",
      "4px",
    ]);
  });

  test("variables/undefined-ref reports XESSA2001 at the exact reference span and omits the rule", async () => {
    const entry = `${WORKSPACE}/variables/undefined-ref/input.cssx`;
    const source = fixtureFiles("variables", "undefined-ref")[entry] as string;
    const result = await run(fixtureFiles("variables", "undefined-ref"), entry);

    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA2001");
    expect(diagnostic?.message).toContain('Undefined token "$missing"');
    expect(diagnostic?.span).toEqual({
      start: source.indexOf("$missing"),
      end: source.indexOf("$missing") + "$missing".length,
      file: entry,
    });
    expect(result.ir.rules).toEqual([]);
  });

  test("variables/cycle reports the chain and emits no CSS", async () => {
    const entry = `${WORKSPACE}/variables/cycle/input.cssx`;
    const result = await run(fixtureFiles("variables", "cycle"), entry);

    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA2001");
    expect(diagnostic?.message).toContain("$a -> $b -> $a");
    expect(diagnostic?.span.file).toBe(`${WORKSPACE}/variables/cycle/b.cssx`);
    expect(result.ir.rules).toEqual([]);
  });

  test("variables/ambiguous-import recovers with the first provider (resolver already diagnosed)", async () => {
    const entry = `${WORKSPACE}/variables/ambiguous-import/input.cssx`;
    const result = await run(fixtureFiles("variables", "ambiguous-import"), entry);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual(["8px"]);
  });
});

describe("substitute: resolution scope", () => {
  test("an imported token's nested references resolve in its defining module", async () => {
    const files = {
      [`${WORKSPACE}/tokens.cssx`]: "@variables { base: 4px; size: $base; }\n",
      [`${WORKSPACE}/input.cssx`]:
        '@use "./tokens.cssx";\n@variables { base: 99px; }\n.x { margin: $size; padding: $base; }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)).toEqual([
      { selector: ".x", property: "margin", value: "4px", query: null, important: false },
      { selector: ".x", property: "padding", value: "99px", query: null, important: false },
    ]);
  });

  test("an unknown namespace member reports XESSA2001 and omits the declaration", async () => {
    const files = {
      [`${WORKSPACE}/layout.cssx`]: "@variables { spacing: 12px; }\n",
      [`${WORKSPACE}/input.cssx`]:
        '@use "./layout.cssx" as layout;\n.x { padding: $layout.nope; margin: 1px; }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("does not export");
    expect(collectDeclarations(result.ir).map((declaration) => declaration.property)).toEqual([
      "margin",
    ]);
  });

  test("an unknown namespace reports XESSA2001", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: ".x { padding: $nope.spacing; }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Unknown token namespace");
    expect(result.ir.rules).toEqual([]);
  });

  test("a bare namespace reference is diagnosed as a namespace, not a token", async () => {
    const files = {
      [`${WORKSPACE}/layout.cssx`]: "@variables { spacing: 12px; }\n",
      [`${WORKSPACE}/input.cssx`]: '@use "./layout.cssx" as layout;\n.x { padding: $layout; }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("is a namespace");
    expect(result.ir.rules).toEqual([]);
  });

  test("a namespaced member is not visible as a bare name", async () => {
    const files = {
      [`${WORKSPACE}/layout.cssx`]: "@variables { spacing: 12px; }\n",
      [`${WORKSPACE}/input.cssx`]: '@use "./layout.cssx" as layout;\n.x { padding: $spacing; }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('Undefined token "$spacing"');
  });

  test("expansion aborts a chain longer than the depth guard", async () => {
    const tokens: string[] = [];
    for (let index = 0; index < 70; index++) {
      const value = index === 0 ? "1px" : `$t${index - 1}`;
      tokens.push(`  t${index}: ${value};`);
    }
    const files = {
      [`${WORKSPACE}/input.cssx`]: `@variables {\n${tokens.join("\n")}\n}\n.x { margin: $t69; }\n`,
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA2001");
    expect(result.diagnostics[0]?.message).toContain("exceeded");
    expect(result.ir.rules).toEqual([]);
  });
});

describe("substitute: value forms", () => {
  test("descriptor at-rules and keyframe steps are substituted", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: [
        '@variables { family: "Inter"; weight: 700; start: 0.25; }',
        "@font-face { font-family: $family; font-weight: $weight; }",
        "@keyframes fade { from { opacity: $start; } to { opacity: 1; } }",
      ].join("\n"),
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toEqual([]);
    const values = collectDeclarations(result.ir).map((declaration) => [
      declaration.property,
      declaration.value,
    ]);
    expect(values).toEqual([
      ["font-family", '"Inter"'],
      ["font-weight", "700"],
      ["opacity", "0.25"],
      ["opacity", "1"],
    ]);
  });

  test("raw slice fidelity: whitespace, calc() spacing and multiple references are preserved", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@variables { gap: 8px; width: 2px; color: #123456; }\n" +
        ".x {\n  width: calc($gap + 2px);\n  border: $width  solid   $color;\n}\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      "calc(8px + 2px)",
      "2px  solid   #123456",
    ]);
  });

  test("strings and URLs never treat `$` as a reference", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        '@variables { gap: 8px; }\n.x { content: "$gap"; background: url($gap.png); }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      '"$gap"',
      "url($gap.png)",
    ]);
  });

  test("a rejected variant segment omits only that segment and keeps its exact span", async () => {
    const entry = `${WORKSPACE}/input.cssx`;
    const source = "@variables { gap: 2px; }\n.x { padding: 1px @md $gap @lg $missing; }\n";
    const result = await run({ [entry]: source }, entry);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.span).toEqual({
      start: source.indexOf("$missing"),
      end: source.indexOf("$missing") + "$missing".length,
      file: entry,
    });
    expect(collectDeclarations(result.ir)).toEqual([
      { selector: ".x", property: "padding", value: "1px", query: null, important: false },
      {
        selector: ".x",
        property: "padding",
        value: "2px",
        query: "(min-width: 768px)",
        important: false,
      },
    ]);
  });

  test("important flags and values are preserved", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: "@variables { gap: 8px; }\n.x { padding: $gap !important; }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`);

    expect(collectDeclarations(result.ir)).toEqual([
      {
        selector: ".x",
        property: "padding",
        value: "8px !important",
        query: null,
        important: true,
      },
    ]);
  });
});

describe("substitute: runtime references", () => {
  test("a runtime reference becomes var(--prefix-name)", async () => {
    const entry = `${WORKSPACE}/runtime/basic/input.cssx`;
    const result = await run(fixtureFiles("runtime", "basic"), entry, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)).toEqual([
      {
        selector: ".card",
        property: "color",
        value: "var(--ui-primary)",
        query: null,
        important: false,
      },
    ]);
  });

  test("an empty prefix yields var(--name)", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: "@runtime { primary: #fff; }\n.x { color: $primary; }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "");

    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--primary)");
  });

  test("a namespaced runtime member becomes var(--prefix-member)", async () => {
    const files = {
      [`${WORKSPACE}/theme.cssx`]: "@runtime { primary: #fff; }\n",
      [`${WORKSPACE}/input.cssx`]: '@use "./theme.cssx" as theme;\n.x { color: $theme.primary; }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--ui-primary)");
  });

  test("compile-time values may embed runtime references", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #fff; }\n@variables { accent: $primary; }\n.x { color: $accent; }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--ui-primary)");
  });

  test("a runtime reference in the first var() argument becomes the property name", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #2563eb; }\n.x { color: var($primary, #333); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--ui-primary, #333)");
  });

  test("a namespaced runtime token in the first var() argument uses the same prefix", async () => {
    const files = {
      [`${WORKSPACE}/theme.cssx`]: "@runtime { primary: #2563eb; }\n",
      [`${WORKSPACE}/input.cssx`]:
        '@use "./theme.cssx" as theme;\n.x { color: var($theme.primary, black); }\n',
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--ui-primary, black)");
  });

  test("nested var() calls resolve their own first arguments", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { a: #111; b: #222; }\n.x { color: var($a, var($b, red)); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--ui-a, var(--ui-b, red))");
  });

  test("runtime references outside the name position still become var(--...)", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #2563eb; }\n.x { color: var(--brand, $primary); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--brand, var(--ui-primary))");
  });

  test("first-argument shorthand preserves spacing and matches VAR( case-insensitively", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #2563eb; }\n" +
        ".x { color: var( $primary , #333 ); border-color: VAR($primary,#333); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      "var( --ui-primary , #333 )",
      "VAR(--ui-primary,#333)",
    ]);
  });

  test("first-argument shorthand honors empty and custom prefixes", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #2563eb; }\n.x { color: var($primary, #333); }\n",
    };
    const empty = await run(files, `${WORKSPACE}/input.cssx`, "");
    const custom = await run(files, `${WORKSPACE}/input.cssx`, "app");

    expect(collectDeclarations(empty.ir)[0]?.value).toBe("var(--primary, #333)");
    expect(collectDeclarations(custom.ir)[0]?.value).toBe("var(--app-primary, #333)");
  });

  test("naming.prefix wins over prefix for the var() name shorthand", async () => {
    const entry = `${WORKSPACE}/input.cssx`;
    const files = {
      [entry]: "@runtime { primary: #2563eb; }\n.x { color: var($primary, #333); }\n",
    };
    const graph = await buildModuleGraph([entry], createHost(files), {
      file: entry,
    } as CompileOptions);
    const record = graph.modules.get(entry);
    if (record === undefined) throw new Error("entry not loaded");
    const lowered = lower(record.ast, { file: entry } as CompileOptions);

    const result = substitute(lowered.ir, graph, entry, {
      prefix: "ui",
      naming: { prefix: "app" },
    });

    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--app-primary, #333)");
  });

  test("a compile-time token in the first var() argument is XESSA2001 with and without fallback", async () => {
    for (const written of ["var($pad)", "var($pad, 4px)"]) {
      const files = {
        [`${WORKSPACE}/input.cssx`]: `@variables { pad: 4px; }\n.x { padding: ${written}; }\n`,
      };
      const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

      expect(result.diagnostics).toHaveLength(1);
      const diagnostic = result.diagnostics[0];
      expect(diagnostic?.code).toBe("XESSA2001");
      expect(diagnostic?.message).toContain('"$pad"');
      expect(diagnostic?.message).toContain("var(--name)");
      expect(diagnostic?.span.file).toBe(`${WORKSPACE}/input.cssx`);
      expect(result.ir.rules).toEqual([]);
    }
  });

  test("a compile-time token in the fallback position still inlines", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: "@variables { pad: 4px; }\n.x { padding: var(--gap, $pad); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--gap, 4px)");
  });

  test("hand-written var() references are untouched", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { primary: #2563eb; }\n.x { color: var(--anything, #333); }\n",
    };
    const result = await run(files, `${WORKSPACE}/input.cssx`, "ui");

    expect(result.diagnostics).toEqual([]);
    expect(collectDeclarations(result.ir)[0]?.value).toBe("var(--anything, #333)");
  });
});

describe("substitute: purity and determinism", () => {
  test("the same input yields byte-identical output and diagnostics", async () => {
    const entry = `${WORKSPACE}/canonical/button/input.cssx`;
    const files = fixtureFiles("canonical", "button");
    const first = await run(files, entry);
    const second = await run(files, entry);

    expect(JSON.stringify(second.ir)).toBe(JSON.stringify(first.ir));
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  test("the input IR is not mutated", async () => {
    const entry = `${WORKSPACE}/variables/basic/input.cssx`;
    const files = fixtureFiles("variables", "basic");
    const graph = await buildModuleGraph([entry], createHost(files), {
      file: entry,
    } as CompileOptions);
    const record = graph.modules.get(entry);
    if (record === undefined) throw new Error("entry not loaded");
    const lowered = lower(record.ast, { file: entry } as CompileOptions);
    const before = JSON.stringify(lowered.ir);

    substitute(lowered.ir, graph, entry, { prefix: "ui" });

    expect(JSON.stringify(lowered.ir)).toBe(before);
  });

  test("a missing entry module is a no-op rather than a throw", async () => {
    const files = { [`${WORKSPACE}/input.cssx`]: ".x { color: red; }\n" };
    const entry = `${WORKSPACE}/input.cssx`;
    const graph = await buildModuleGraph([entry], createHost(files), {
      file: entry,
    } as CompileOptions);
    const record = graph.modules.get(entry);
    if (record === undefined) throw new Error("entry not loaded");
    const lowered = lower(record.ast, { file: entry } as CompileOptions);

    const result = substitute(lowered.ir, graph, `${WORKSPACE}/missing.cssx`);

    expect(result.ir).toBe(lowered.ir);
    expect(result.diagnostics).toEqual([]);
  });

  test("an empty stylesheet substitutes to itself", async () => {
    const files = { [`${WORKSPACE}/input.cssx`]: "" };
    const entry = `${WORKSPACE}/input.cssx`;
    const result = await run(files, entry);

    expect(result.ir.rules).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("substitute: adversarial IR", () => {
  test("fabricated declarations resolve without AST provenance and use the segment span for errors", async () => {
    const entry = `${WORKSPACE}/variables/basic/input.cssx`;
    const graph = await buildModuleGraph([entry], createHost(fixtureFiles("variables", "basic")), {
      file: entry,
    } as CompileOptions);
    const span = { start: 999, end: 999, file: entry };
    const ir: StylesheetIr = stylesheetIr([
      ruleIr({
        selector: ".fabricated",
        ancestors: [],
        declarations: [
          declarationIr("border-radius", "$radius", span),
          declarationIr("padding", "$missing", span),
        ],
        condition: null,
        context: [],
        span,
      }),
    ]);

    const result = substitute(ir, graph, entry, { prefix: "ui" });

    expect(result.ir.rules).toHaveLength(1);
    expect(collectDeclarations(result.ir).map((declaration) => declaration.value)).toEqual([
      "16px",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.span).toEqual(span);
  });

  test("killed declarations prune their containers but authored empties are preserved", async () => {
    const entry = `${WORKSPACE}/variables/basic/input.cssx`;
    const graph = await buildModuleGraph([entry], createHost(fixtureFiles("variables", "basic")), {
      file: entry,
    } as CompileOptions);
    const span = { start: 0, end: 0, file: entry };
    const ir: StylesheetIr = stylesheetIr([
      ruleIr({
        selector: ".empty",
        ancestors: [],
        declarations: [],
        condition: null,
        context: [],
        span,
      }),
      nativeBlockIr({ name: "media", prelude: "(min-width: 1px)", children: [], span }),
      nativeBlockIr({ name: "import", prelude: '"x.css"', statement: true, children: [], span }),
      ruleIr({
        selector: ".drop",
        ancestors: [],
        declarations: [declarationIr("color", "$missing", span)],
        condition: null,
        context: [],
        span,
      }),
      nativeBlockIr({
        name: "supports",
        prelude: "(display: grid)",
        children: [declarationIr("color", "$missing", span)],
        span,
      }),
    ]);

    const result = substitute(ir, graph, entry);

    expect(result.ir.rules).toHaveLength(3);
    expect(result.ir.rules[0]).toMatchObject({ selector: ".empty" });
    expect(result.ir.rules[1]).toMatchObject({ name: "media", children: [] });
    expect(result.ir.rules[2]).toMatchObject({ name: "import", statement: true });
    expect(result.diagnostics).toHaveLength(2);
  });
});
