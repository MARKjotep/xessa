import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { compileProject, createNodeHost } from "../../packages/compiler/src/index.ts";
import { stylesheetIr } from "../../packages/compiler/src/ir/factories.ts";
import type { DeclarationIr, RuleIr, StylesheetIr } from "../../packages/compiler/src/ir/types.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { ModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";
import { emitRuntimeTokens, substitute } from "../../packages/compiler/src/variables/index.ts";
import type {
  RuntimeEmitOptions,
  RuntimeEmitResult,
} from "../../packages/compiler/src/variables/index.ts";

/**
 * Runtime token emission tests (SPECIFICATION.md §6.2).
 *
 * The passes run against an in-memory `ModuleHost`; fixture directories are read
 * by the test harness only.
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

interface RuntimePipeline {
  readonly graph: ModuleGraph;
  readonly lowered: StylesheetIr;
  readonly substituted: StylesheetIr;
  readonly result: RuntimeEmitResult;
}

async function runRuntime(
  files: Readonly<Record<string, string>>,
  entry: string,
  options: RuntimeEmitOptions = { prefix: "ui" },
): Promise<RuntimePipeline> {
  const graph = await buildModuleGraph([entry], createHost(files), {
    file: entry,
  } as CompileOptions);
  const record = graph.modules.get(entry);
  if (record === undefined) throw new Error(`entry not loaded: ${entry}`);
  const lowered = lower(record.ast, { file: entry } as CompileOptions);
  const substituted = substitute(lowered.ir, graph, entry, options);
  const result = emitRuntimeTokens(substituted.ir, graph, entry, options);
  return { graph, lowered, substituted: substituted.ir, result };
}

function ruleSummary(rule: RuleIr): {
  selector: string;
  query: string | null;
  keys: readonly string[];
  declarations: ReadonlyArray<readonly [string, string]>;
} {
  return {
    selector: rule.selector,
    query: rule.condition?.query ?? null,
    keys: rule.condition?.keys ?? [],
    declarations: rule.declarations.map((declaration) => [declaration.property, declaration.value]),
  };
}

function rootRules(ir: StylesheetIr): RuleIr[] {
  const roots: RuleIr[] = [];
  for (const node of ir.rules) {
    if ("declarations" in node && node.selector === ":root") roots.push(node);
  }
  return roots;
}

function declarationsOf(ir: StylesheetIr): DeclarationIr[] {
  const declarations: DeclarationIr[] = [];
  for (const node of ir.rules) {
    if ("declarations" in node) declarations.push(...node.declarations);
  }
  return declarations;
}

describe("runtime tokens: fixtures", () => {
  test("runtime/basic emits a :root custom property and a conditional override", async () => {
    const entry = `${WORKSPACE}/runtime/basic/input.cssx`;
    const { result } = await runRuntime(fixtureFiles("runtime", "basic"), entry, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(
      result.ir.rules.map((node) => ("declarations" in node ? node.selector : "block")),
    ).toEqual([":root", ":root", ".card"]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [["--ui-primary", "#2563eb"]],
      },
      {
        selector: ":root",
        query: "(prefers-color-scheme: dark)",
        keys: ["dark"],
        declarations: [["--ui-primary", "#60a5fa"]],
      },
    ]);
    expect(declarationsOf(result.ir).map((declaration) => declaration.value)).toEqual([
      "#2563eb",
      "#60a5fa",
      "var(--ui-primary)",
    ]);
  });

  test("runtime/with-variant groups conditional overrides by resolved MediaConditionIr", async () => {
    const entry = `${WORKSPACE}/runtime/with-variant/input.cssx`;
    const { result } = await runRuntime(fixtureFiles("runtime", "with-variant"), entry, {
      prefix: "ui",
    });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [
          ["--ui-surface", "#ffffff"],
          ["--ui-accent", "#ec4899"],
        ],
      },
      {
        selector: ":root",
        query: "(prefers-color-scheme: dark)",
        keys: ["dark"],
        declarations: [["--ui-surface", "#111111"]],
      },
      {
        selector: ":root",
        query: "(min-width: 768px)",
        keys: ["md"],
        declarations: [["--ui-accent", "#db2777"]],
      },
      {
        selector: ":root",
        query: "(prefers-color-scheme: dark) and (min-width: 768px)",
        keys: ["dark", "md"],
        declarations: [["--ui-accent", "#be185d"]],
      },
    ]);
    expect(
      declarationsOf(result.ir)
        .filter(
          (declaration) =>
            declaration.property === "color" || declaration.property === "background",
        )
        .map((declaration) => declaration.value),
    ).toEqual(["var(--ui-surface)", "var(--ui-accent)"]);
  });

  test("runtime/collision-with-compile-time keeps the compile-time precedence from resolution", async () => {
    const entry = `${WORKSPACE}/runtime/collision-with-compile-time/input.cssx`;
    const { graph, result } = await runRuntime(
      fixtureFiles("runtime", "collision-with-compile-time"),
      entry,
      { prefix: "ui" },
    );

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-primary", "#0ea5e9"],
    ]);
    expect(declarationsOf(result.ir).at(-1)?.value).toBe("#2563eb");
  });
});

describe("runtime tokens: naming", () => {
  test("prefix and empty-prefix naming rules", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: "@runtime { primary: #fff; }\n.x { color: $primary; }\n",
    };
    const entry = `${WORKSPACE}/input.cssx`;

    const withUi = await runRuntime(files, entry, { prefix: "ui" });
    expect(rootRules(withUi.result.ir)[0]?.declarations[0]?.property).toBe("--ui-primary");

    const withoutPrefix = await runRuntime(files, entry, {});
    expect(rootRules(withoutPrefix.result.ir)[0]?.declarations[0]?.property).toBe("--primary");
    expect(declarationsOf(withoutPrefix.result.ir).at(-1)?.value).toBe("var(--primary)");

    const namingWins = await runRuntime(files, entry, { prefix: "ui", naming: { prefix: "app" } });
    expect(rootRules(namingWins.result.ir)[0]?.declarations[0]?.property).toBe("--app-primary");
    expect(declarationsOf(namingWins.result.ir).at(-1)?.value).toBe("var(--app-primary)");
  });
});

describe("runtime tokens: emission ownership", () => {
  test("unqualified imported runtime tokens are emitted in the consuming entrypoint", async () => {
    const files = {
      [`${WORKSPACE}/tokens.cssx`]: "@runtime { primary: #000000; }\n",
      [`${WORKSPACE}/input.cssx`]: '@use "./tokens.cssx";\n.x { color: $primary; }\n',
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-primary", "#000000"],
    ]);
    expect(declarationsOf(result.ir).at(-1)?.value).toBe("var(--ui-primary)");
  });

  test("a referenced namespaced runtime token is emitted; unreferenced ones are not", async () => {
    const files = {
      [`${WORKSPACE}/tokens.cssx`]: "@runtime { primary: #000000; unused: #111111; }\n",
      [`${WORKSPACE}/input.cssx`]:
        '@use "./tokens.cssx" as tokens;\n.x { color: $tokens.primary; }\n',
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-primary", "#000000"],
    ]);
    expect(declarationsOf(result.ir).at(-1)?.value).toBe("var(--ui-primary)");
  });

  test("two namespaces exporting one name resolve in merge order: the later module wins", async () => {
    const files = {
      [`${WORKSPACE}/a.cssx`]: "@runtime { primary: #aaaaaa; }\n",
      [`${WORKSPACE}/b.cssx`]: "@runtime { primary: #bbbbbb; }\n",
      [`${WORKSPACE}/input.cssx`]:
        '@use "./a.cssx" as a;\n@use "./b.cssx" as b;\n' +
        ".x { color: $a.primary; border-color: $b.primary; }\n",
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    // ADR-0016: no conflict diagnostic; the definition later in merge order wins.
    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-primary", "#bbbbbb"],
    ]);
    expect(declarationsOf(result.ir).map((declaration) => declaration.value)).toEqual([
      "#bbbbbb",
      "var(--ui-primary)",
      "var(--ui-primary)",
    ]);
  });
});

describe("runtime tokens: merge-order override (ADR-0016)", () => {
  test("an entry @runtime definition overrides a style-imported module's property", async () => {
    const theme = `${WORKSPACE}/theme.cssx`;
    const entry = `${WORKSPACE}/input.cssx`;
    const files = {
      [theme]: "@runtime { primary: #111111; }\n.theme { color: $primary; }\n",
      [entry]:
        '@use "./theme.cssx" styles;\n@runtime { primary: #222222; }\n.app { color: $primary; }\n',
    };
    const { result } = await runRuntime(files, entry, { prefix: "ui", ruleModules: [theme] });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [["--ui-primary", "#222222"]],
      },
    ]);
  });

  test("the later style module wins when two modules define one property", async () => {
    const a = `${WORKSPACE}/a.cssx`;
    const b = `${WORKSPACE}/b.cssx`;
    const entry = `${WORKSPACE}/input.cssx`;
    const files = {
      [a]: "@runtime { accent: #aaaaaa @md #bbbbbb; }\n.a { border-color: $accent; }\n",
      [b]: "@runtime { accent: #cccccc @md #dddddd; }\n.b { border-color: $accent; }\n",
      [entry]:
        '@use "./a.cssx" as a styles;\n@use "./b.cssx" as b styles;\n' +
        ".app { color: $a.accent; background: $b.accent; }\n",
    };
    const { result } = await runRuntime(files, entry, { prefix: "ui", ruleModules: [a, b] });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [["--ui-accent", "#cccccc"]],
      },
      {
        selector: ":root",
        query: "(min-width: 768px)",
        keys: ["md"],
        declarations: [["--ui-accent", "#dddddd"]],
      },
    ]);
  });

  test("the entry's variant wins over an imported module's same-query definition", async () => {
    const theme = `${WORKSPACE}/theme.cssx`;
    const entry = `${WORKSPACE}/input.cssx`;
    const files = {
      [theme]: "@runtime { surface: #ffffff @dark #111111; }\n.theme { background: $surface; }\n",
      [entry]:
        '@use "./theme.cssx" styles;\n@runtime { surface: #f8fafc @dark #0f172a; }\n.app { background: $surface; }\n',
    };
    const { result } = await runRuntime(files, entry, { prefix: "ui", ruleModules: [theme] });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [["--ui-surface", "#f8fafc"]],
      },
      {
        selector: ":root",
        query: "(prefers-color-scheme: dark)",
        keys: ["dark"],
        declarations: [["--ui-surface", "#0f172a"]],
      },
    ]);
  });

  test("merge-order resolution is deterministic across runs", async () => {
    const theme = `${WORKSPACE}/theme.cssx`;
    const entry = `${WORKSPACE}/input.cssx`;
    const files = {
      [theme]: "@runtime { primary: #111111; }\n.theme { color: $primary; }\n",
      [entry]:
        '@use "./theme.cssx" styles;\n@runtime { primary: #222222; }\n.app { color: $primary; }\n',
    };
    const options = { prefix: "ui", ruleModules: [theme] } as const;
    const first = await runRuntime(files, entry, options);
    const second = await runRuntime(files, entry, options);

    expect(JSON.stringify(second.result.ir)).toBe(JSON.stringify(first.result.ir));
    expect(second.result.diagnostics).toEqual(first.result.diagnostics);
  });
});

describe("runtime tokens: values", () => {
  test("runtime values expand compile-time tokens in their defining module", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@variables { base: #123456; }\n@runtime { brand: $base; }\n.x { color: $brand; }\n",
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-brand", "#123456"],
    ]);
  });

  test("runtime values reference other runtime tokens through var()", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { base: #ffffff; brand: $base; }\n.x { color: $brand; }\n",
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-base", "#ffffff"],
      ["--ui-brand", "var(--ui-base)"],
    ]);
  });

  test("an unknown alias in a runtime variant is XESSA3001 and only that override is dropped", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@runtime { surface: #ffffff @ultrawide #000000; }\n.x { color: $surface; }\n",
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA3001"]);
    expect(rootRules(result.ir).map(ruleSummary)).toEqual([
      {
        selector: ":root",
        query: null,
        keys: [],
        declarations: [["--ui-surface", "#ffffff"]],
      },
    ]);
  });

  test("a standalone call rewrites references in unsubstituted lowering IR", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        "@variables { width: 1px; }\n@runtime { primary: #ffffff; }\n" +
        ".x { border: $width solid $primary; }\n",
    };
    const entry = `${WORKSPACE}/input.cssx`;
    const graph = await buildModuleGraph([entry], createHost(files), {
      file: entry,
    } as CompileOptions);
    const record = graph.modules.get(entry);
    if (record === undefined) throw new Error("entry not loaded");
    const lowered = lower(record.ast, { file: entry } as CompileOptions);

    const result = emitRuntimeTokens(lowered.ir, graph, entry, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(declarationsOf(result.ir).at(-1)?.value).toBe("1px solid var(--ui-primary)");
  });
});

describe("runtime tokens: ordering and purity", () => {
  test("runtime rules are inserted after leading statement at-rules", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]:
        '@runtime { primary: #ffffff; }\n@import "base.css";\n.x { color: $primary; }\n',
    };
    const { result } = await runRuntime(files, `${WORKSPACE}/input.cssx`, { prefix: "ui" });

    expect(
      result.ir.rules.map((node) => ("declarations" in node ? node.selector : `@${node.name}`)),
    ).toEqual(["@import", ":root", ".x"]);
  });

  test("an empty IR still receives the runtime root rules", async () => {
    const files = {
      [`${WORKSPACE}/input.cssx`]: "@runtime { primary: #ffffff; }\n.x { color: $primary; }\n",
    };
    const entry = `${WORKSPACE}/input.cssx`;
    const graph = await buildModuleGraph([entry], createHost(files), {
      file: entry,
    } as CompileOptions);

    const result = emitRuntimeTokens(stylesheetIr([]), graph, entry, { prefix: "ui" });

    expect(result.diagnostics).toEqual([]);
    expect(rootRules(result.ir).map(ruleSummary)[0]?.declarations).toEqual([
      ["--ui-primary", "#ffffff"],
    ]);
  });

  test("no runtime tokens returns the input IR instance unchanged", async () => {
    const files = { [`${WORKSPACE}/input.cssx`]: ".x { color: red; }\n" };
    const entry = `${WORKSPACE}/input.cssx`;
    const { substituted, result } = await runRuntime(files, entry, { prefix: "ui" });

    expect(result.ir).toBe(substituted);
    expect(result.diagnostics).toEqual([]);
  });

  test("a missing entry module is a no-op rather than a throw", async () => {
    const files = { [`${WORKSPACE}/input.cssx`]: "@runtime { primary: red; }\n" };
    const entry = `${WORKSPACE}/input.cssx`;
    const { substituted } = await runRuntime(files, entry, { prefix: "ui" });

    const result = emitRuntimeTokens(
      substituted,
      { modules: new Map(), order: [], diagnostics: [] },
      entry,
      {
        prefix: "ui",
      },
    );

    expect(result.ir).toBe(substituted);
    expect(result.diagnostics).toEqual([]);
  });

  test("repeated runs are byte-identical and the input is not mutated", async () => {
    const entry = `${WORKSPACE}/runtime/with-variant/input.cssx`;
    const files = fixtureFiles("runtime", "with-variant");
    const first = await runRuntime(files, entry, { prefix: "ui" });
    const second = await runRuntime(files, entry, { prefix: "ui" });

    expect(JSON.stringify(second.result.ir)).toBe(JSON.stringify(first.result.ir));
    expect(second.result.diagnostics).toEqual(first.result.diagnostics);

    const before = JSON.stringify(first.substituted);
    emitRuntimeTokens(first.substituted, first.graph, entry, { prefix: "ui" });
    expect(JSON.stringify(first.substituted)).toBe(before);
  });
});

const MERGED_RUNTIME_CASES = ["override-entry", "override-modules", "override-variants"] as const;

describe("runtime tokens: merged-build merge order goldens", () => {
  async function compileMerged(name: string) {
    const directory = join(FIXTURES, "runtime", name);
    const results = await compileProject(["entry.cssx"], createNodeHost(directory), {
      projectRoot: directory,
    });
    const entry = results["entry.cssx"];
    if (entry === undefined) throw new Error(`fixture ${name} produced no entry result`);
    return { directory, entry };
  }

  for (const name of MERGED_RUNTIME_CASES) {
    test(`runtime/${name} matches expected/css with no diagnostics`, async () => {
      const { directory, entry } = await compileMerged(name);
      const expected = readFileSync(join(directory, "expected", "css"), "utf8");

      expect(entry.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
      expect(entry.css).toBe(expected);
    });
  }

  test("merged runtime goldens are byte-identical across repeated runs", async () => {
    for (const name of MERGED_RUNTIME_CASES) {
      const first = await compileMerged(name);
      const second = await compileMerged(name);
      expect({ name, css: second.entry.css }).toEqual({ name, css: first.entry.css });
      expect(second.entry.diagnostics).toEqual(first.entry.diagnostics);
    }
  });
});
