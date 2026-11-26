import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { compileProject, createNodeHost, parse } from "../../packages/compiler/src/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { ModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import {
  collectKeyframes,
  visibleKeyframes,
} from "../../packages/compiler/src/resolver/keyframes.ts";
import { flattenIr } from "../../packages/compiler/src/selectors/index.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";
import { substitute } from "../../packages/compiler/src/variables/index.ts";

/**
 * Built-in `keyframes` namespace (ADR-0015).
 *
 * `@keyframes spin { … }` registers `spin` for `$keyframes.spin`, which expands
 * at compile time to the authored name text so the emitted CSS pairs
 * `animation-name: spin` with the native keyframe block. Visibility is the
 * build's own blocks plus the `styles` `@use` closure (the CSS the build
 * actually emits); token-only imports do not expose names. Every rejection is
 * the existing XESSA2001 with the declaration segment omitted.
 */

const WORKSPACE = "/workspace";

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

function files(entries: Readonly<Record<string, string>>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, source] of Object.entries(entries)) {
    map[`${WORKSPACE}/${name}`] = source;
  }
  return map;
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

interface Build {
  readonly graph: ModuleGraph;
  readonly css: string;
  readonly diagnostics: string[];
}

/** Compile one entry exactly as `compileEntry` orders the passes (single entry). */
async function build(sources: Readonly<Record<string, string>>, entry: string): Promise<Build> {
  const file = `${WORKSPACE}/${entry}`;
  const graph = await buildModuleGraph([file], createHost(files(sources)), {
    file,
  } as CompileOptions);
  const record = graph.modules.get(file);
  if (record === undefined) throw new Error(`entry not loaded: ${file}`);
  const prefix = setupPrefix(record.ast);
  const lowered = lower(record.ast, { file } as CompileOptions);
  const substituted = substitute(lowered.ir, graph, file, { prefix });
  const renamed = renameClasses(substituted.ir, { prefix });
  const grouped = groupRuns(renamed.ir, "safe");
  const flattened = flattenIr(grouped);
  const emitted = emitCss(flattened.ir, { minify: false });
  return {
    graph,
    css: emitted.css,
    diagnostics: [
      ...graph.diagnostics,
      ...lowered.diagnostics,
      ...substituted.diagnostics,
      ...renamed.diagnostics,
      ...flattened.diagnostics,
      ...emitted.diagnostics,
    ].map((diagnostic) => diagnostic.code),
  };
}

const SPIN = "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }";

describe("keyframes: collection", () => {
  test("top-level @keyframes names are collected in authored order, first definition wins", () => {
    const ast = parse(`${SPIN}\n@keyframes fade { from { opacity: 0; } }\n${SPIN}`, {
      file: "a.cssx",
    }).ast;
    expect(collectKeyframes(ast).map((entry) => entry.name)).toEqual(["spin", "fade"]);
  });

  test("at-rule names are matched case-insensitively and the span points at the at-rule", () => {
    const source = "@KEYFRAMES pulse { from { opacity: 0; } }";
    const ast = parse(source, { file: "a.cssx" }).ast;
    const [keyframe] = collectKeyframes(ast);
    expect(keyframe?.name).toBe("pulse");
    expect(keyframe?.span).toEqual({ start: 0, end: source.length, file: "a.cssx" });
  });

  test("string-named and non-identifier preludes stay native CSS and are not addressable", () => {
    const ast = parse(
      '@keyframes "fade" { from { opacity: 0; } }\n@keyframes 8 ball { from { opacity: 0; } }',
      { file: "a.cssx" },
    ).ast;
    expect(collectKeyframes(ast)).toEqual([]);
  });

  test("keyframes nested inside a rule or another at-rule block are not collected", () => {
    const ast = parse(
      ".a { @keyframes spin { from { opacity: 0; } } }\n@media print { @keyframes print-in { from { opacity: 0; } } }",
      { file: "a.cssx" },
    ).ast;
    expect(collectKeyframes(ast)).toEqual([]);
  });

  test("visibility is own blocks plus the transitive styles closure, never token-only imports", () => {
    const visible = visibleKeyframes(
      new Map([
        [
          "/workspace/entry.cssx",
          {
            own: [{ name: "own", module: "/workspace/entry.cssx", span: spanOf(0) }],
            styleDependencies: ["/workspace/a.cssx"],
          },
        ],
        [
          "/workspace/a.cssx",
          {
            own: [{ name: "outer", module: "/workspace/a.cssx", span: spanOf(0) }],
            styleDependencies: ["/workspace/b.cssx"],
          },
        ],
        [
          "/workspace/b.cssx",
          {
            own: [{ name: "inner", module: "/workspace/b.cssx", span: spanOf(0) }],
            styleDependencies: [],
          },
        ],
        [
          "/workspace/token.cssx",
          {
            own: [{ name: "hidden", module: "/workspace/token.cssx", span: spanOf(0) }],
            styleDependencies: [],
          },
        ],
      ]),
    );

    expect([...(visible.get("/workspace/entry.cssx")?.keys() ?? [])]).toEqual([
      "own",
      "outer",
      "inner",
    ]);
    expect(visible.get("/workspace/token.cssx")?.has("hidden")).toBe(true);
    expect(visible.get("/workspace/a.cssx")?.has("inner")).toBe(true);
  });
});

describe("keyframes: expansion", () => {
  test("a same-file name expands to the authored keyframe name text", async () => {
    const result = await build(
      {
        "entry.cssx": `@setup { prefix: "ui"; }\n${SPIN}\n.spinner { animation-name: $keyframes.spin; animation-duration: 1s; }`,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain(".ui-spinner {");
    expect(result.css).toContain("animation-name: spin;");
    expect(result.css).toContain("@keyframes spin {");
    expect(result.css).not.toContain("$");
  });

  test("repeated and surrounding references in one value all expand", async () => {
    const result = await build(
      {
        "entry.cssx": `${SPIN}\n.a { animation: $keyframes.spin 1s $keyframes.spin; }`,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain("animation: spin 1s spin;");
  });

  test("an unknown member is XESSA2001 and the declaration is omitted, never emitted raw", async () => {
    const result = await build(
      {
        "entry.cssx": `${SPIN}\n.a { animation: $keyframes.fade 1s; }`,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual(["XESSA2001"]);
    expect(result.css).not.toContain("$");
    expect(result.css).not.toContain(".a");
    expect(result.css).toContain("@keyframes spin {");
  });

  test("a bare $keyframes follows the bare-namespace XESSA2001 rule", async () => {
    const result = await build(
      { "entry.cssx": `${SPIN}\n.a { animation-name: $keyframes; }` },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual(["XESSA2001"]);
    expect(result.css).not.toContain("animation-name");
  });

  test("string-named keyframes are not addressable", async () => {
    const result = await build(
      {
        "entry.cssx":
          '@keyframes "fade" { from { opacity: 0; } }\n.a { animation-name: $keyframes.fade; }',
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual(["XESSA2001"]);
    expect(result.css).toContain('@keyframes "fade" {');
    expect(result.css).not.toContain(".a");
  });
});

describe("keyframes: visibility follows style imports", () => {
  test("a styles import makes the module's keyframe names referenceable", async () => {
    const result = await build(
      {
        "entry.cssx": '@use "./motion.cssx" styles;\n.a { animation-name: $keyframes.spin; }',
        "motion.cssx": SPIN,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain("animation-name: spin;");
    // The imported block itself is emitted only in the merged build; the
    // style-import fixture and `compileEntry` cover that (ADR-0014).
  });

  test("a token-only import does not: referencing would emit a name with no keyframe block", async () => {
    const result = await build(
      {
        "entry.cssx": '@use "./motion.cssx";\n.a { animation-name: $keyframes.spin; }',
        "motion.cssx": SPIN,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual(["XESSA2001"]);
    expect(result.css).toBe("");
  });

  test("a transitive styles chain is visible", async () => {
    const result = await build(
      {
        "entry.cssx": '@use "./a.cssx" styles;\n.a { animation-name: $keyframes.inner; }',
        "a.cssx": '@use "./b.cssx" styles;\n.mid { color: red; }',
        "b.cssx": "@keyframes inner { from { opacity: 0; } }",
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain("animation-name: inner;");
    // `inner` is declared two style edges away: reachability is transitive.
    expect(result.graph.modules.get(`${WORKSPACE}/entry.cssx`)?.keyframes.has("inner")).toBe(true);
  });

  test("the importing file's own name wins provenance but never changes the emitted text", async () => {
    const result = await build(
      {
        "entry.cssx":
          '@use "./motion.cssx" styles;\n@keyframes spin { from { opacity: 0.5; } }\n.a { animation-name: $keyframes.spin; }',
        "motion.cssx": SPIN,
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual([]);
    const visible = result.graph.modules.get(`${WORKSPACE}/entry.cssx`)?.keyframes.get("spin");
    expect(visible?.module).toBe(`${WORKSPACE}/entry.cssx`);
    // The module's own block (motion's is only in the merged build, see the
    // duplicate-name fixture) and the bare name text, not a prefixed identifier.
    expect(result.css).toContain("@keyframes spin {");
    expect(result.css).toContain("animation-name: spin;");
  });
});

describe("keyframes: the built-in namespace cannot be shadowed", () => {
  test("an @use alias named keyframes is XESSA2001 and does not replace the built-in namespace", async () => {
    const result = await build(
      {
        "entry.cssx":
          '@use "./theme.cssx" as keyframes;\n@keyframes spin { from { opacity: 0; } }\n.a { animation-name: $keyframes.spin; }',
        "theme.cssx": "@variables { spin: 4px; }",
      },
      "entry.cssx",
    );

    expect(result.diagnostics).toEqual(["XESSA2001"]);
    expect(
      result.graph.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("built-in namespace"),
      ),
    ).toBe(true);
    // The built-in member still resolves: the alias never created a namespace.
    expect(result.css).toContain("animation-name: spin;");
  });
});

describe("keyframes: merged fixture builds", () => {
  test("style-import/entry.cssx references an imported keyframe and emits its block", async () => {
    const entry = await compileFixtureBuild("style-import");
    expect(entry.diagnostics).toEqual([]);
    expect(entry.css?.indexOf("@keyframes spin{")).toBe(0);
    expect(entry.css).toContain("animation-name:spin;");
  });

  test("token-only/entry.cssx is rejected because the imported block is not emitted", async () => {
    const entry = await compileFixtureBuild("token-only");
    expect(entry.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    expect(entry.css).toBe("");
  });

  test("a name declared by two merged modules is authored CSS, never a diagnostic", async () => {
    const entry = await compileFixtureBuild("duplicate-name");
    expect(entry.diagnostics).toEqual([]);
    const css = entry.css ?? "";
    expect(css.split("@keyframes spin{")).toHaveLength(3);
    expect(css).toContain("animation-name:spin;");
  });

  test("every merged fixture matches its expected/css byte-exact", async () => {
    for (const name of ["style-import", "token-only", "duplicate-name"]) {
      const entry = await compileFixtureBuild(name);
      const expected = readFileSync(join(MERGED, name, "expected", "css"), "utf8");
      expect({ name, css: entry.css }).toEqual({ name, css: expected });
    }
  });
});

const MERGED = join(import.meta.dir, "..", "fixtures", "keyframes");

async function compileFixtureBuild(name: string) {
  const directory = join(MERGED, name);
  const results = await compileProject(["entry.cssx"], createNodeHost(directory), {
    projectRoot: directory,
  });
  const entry = results["entry.cssx"];
  if (entry === undefined) throw new Error(`fixture ${name} produced no entry result`);
  return entry;
}

function spanOf(start: number): { start: number; end: number; file: string } {
  return { start, end: start, file: "test.cssx" };
}
