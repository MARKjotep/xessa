import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type {
  Diagnostic,
  ModuleGraph,
  ModuleRecord,
  ScopedToken,
} from "../../packages/compiler/src/resolver/index.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";

/**
 * Resolver tests drive the real lexer/parser through `buildModuleGraph` and an
 * in-memory, call-recording `ModuleHost`. Fixture inputs are read from disk by
 * the test harness only; the resolver itself never touches `node:fs`.
 */

const WORKSPACE = "/workspace";
const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures", "variables");
const OPTIONS: CompileOptions = { file: "resolver.test" };

interface HostCalls {
  readonly readFile: string[];
  readonly fileExists: string[];
  readonly canonicalize: string[];
  readonly resolvePath: Array<readonly [string, string]>;
  workspaceRoot: number;
}

function createHost(
  initial: Readonly<Record<string, string>>,
  root = WORKSPACE,
): { readonly host: ModuleHost; readonly calls: HostCalls } {
  const files = new Map(Object.entries(initial));
  const calls: HostCalls = {
    readFile: [],
    fileExists: [],
    canonicalize: [],
    resolvePath: [],
    workspaceRoot: 0,
  };

  const host: ModuleHost = {
    async readFile(path: string): Promise<string> {
      calls.readFile.push(path);
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      calls.fileExists.push(path);
      return files.has(path);
    },
    canonicalize(path: string): string {
      calls.canonicalize.push(path);
      return path;
    },
    resolvePath(from: string, to: string): string {
      calls.resolvePath.push([from, to]);
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      calls.workspaceRoot += 1;
      return root;
    },
  };

  return { host, calls };
}

/** Load one `tests/fixtures/variables/<name>` directory into the host map. */
function fixtureFiles(name: string, root = WORKSPACE): Record<string, string> {
  const directory = join(FIXTURE_ROOT, name);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".cssx")) continue;
    files[`${root}/${name}/${entry}`] = readFileSync(join(directory, entry), "utf8");
  }
  return files;
}

function fixturePath(name: string, file = "input.cssx", root = WORKSPACE): string {
  return `${root}/${name}/${file}`;
}

function moduleAt(graph: ModuleGraph, file: string): ModuleRecord {
  const record = graph.modules.get(file);
  if (record === undefined) throw new Error(`module not loaded: ${file}`);
  return record;
}

function diagnosticAt(graph: ModuleGraph, index = 0): Diagnostic {
  const diagnostic = graph.diagnostics[index];
  if (diagnostic === undefined) throw new Error(`missing diagnostic ${index}`);
  return diagnostic;
}

function tokenAt(tokens: ReadonlyMap<string, ScopedToken>, name: string): ScopedToken {
  const token = tokens.get(name);
  if (token === undefined) throw new Error(`missing token: ${name}`);
  return token;
}

describe("resolver: fixtures", () => {
  test("variables/basic builds one record and exposes local compile-time tokens", async () => {
    const entry = fixturePath("basic");
    const { host, calls } = createHost(fixtureFiles("basic"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);

    expect(graph.diagnostics).toEqual([]);
    expect([...graph.modules.keys()]).toEqual([entry]);
    expect(graph.order).toEqual([entry]);
    expect(calls.readFile).toEqual([entry]);
    expect(calls.workspaceRoot).toBeGreaterThan(0);

    const record = moduleAt(graph, entry);
    expect(record.hasRules).toBe(true);
    expect([...record.compileScope.tokens.keys()]).toEqual([
      "radius",
      "gap",
      "border",
      "shadow",
      "elevation",
    ]);
    expect([...record.runtimeScope.tokens.keys()]).toEqual([]);

    const radius = tokenAt(record.compileScope.tokens, "radius");
    expect(radius.tokenType).toBe("compile");
    expect(radius.origin).toEqual({ kind: "local" });
    expect(radius.unqualified).toBe(true);
    expect(radius.module).toBe(entry);
    expect(radius.declaration.value).toBe("16px");
    expect(radius.span).toEqual(radius.declaration.span);

    const elevation = tokenAt(record.compileScope.tokens, "elevation");
    expect(elevation.declaration.value).toBe("$shadow");
    expect(elevation.declaration.tokens?.map((token) => token.kind)).toEqual(["dollar-ref"]);
  });

  test("variables/cycle reports XESSA2001 with the path, keeps modules, excludes members from order", async () => {
    const entry = fixturePath("cycle");
    const aPath = fixturePath("cycle", "a.cssx");
    const bPath = fixturePath("cycle", "b.cssx");
    const { host } = createHost(fixtureFiles("cycle"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);

    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.message).toContain(aPath);
    expect(diagnostic.message).toContain(bPath);
    expect(diagnostic.message).toContain("Import cycle detected");

    // b.cssx closes the cycle: its first statement is `@use "./a.cssx";`.
    expect(diagnostic.span).toEqual({
      start: 0,
      end: '@use "./a.cssx";'.length,
      file: bPath,
    });

    expect([...graph.modules.keys()].sort()).toEqual([aPath, bPath, entry].sort());
    expect(graph.order).toContain(entry);
    expect(graph.order).not.toContain(aPath);
    expect(graph.order).not.toContain(bPath);
  });

  test("variables/namespaced-members exposes members only through the namespace", async () => {
    const entry = fixturePath("namespaced-members");
    const layoutPath = fixturePath("namespaced-members", "layout.cssx");
    const { host } = createHost(fixtureFiles("namespaced-members"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const input = moduleAt(graph, entry);
    const layout = moduleAt(graph, layoutPath);
    expect(layout.hasRules).toBe(false);
    expect(input.hasRules).toBe(true);

    // `$layout.spacing` resolves; bare `$layout` deliberately does not.
    expect(tokenAt(input.compileScope.tokens, "gap").declaration.value).toBe("$layout.spacing");
    expect(input.compileScope.tokens.has("layout")).toBe(false);
    expect(input.compileScope.tokens.has("spacing")).toBe(false);

    const namespace = input.compileScope.namespaces.get("layout");
    if (namespace === undefined) throw new Error("missing layout namespace");
    expect(namespace.module).toBe(layoutPath);
    expect([...namespace.members.keys()].sort()).toEqual(["margin", "spacing"]);

    const spacing = tokenAt(namespace.members, "spacing");
    expect(spacing.module).toBe(layoutPath);
    expect(spacing.declaration.value).toBe("12px");
    expect(spacing.unqualified).toBe(false);
    expect(spacing.origin.kind).toBe("import");
    if (spacing.origin.kind !== "import") throw new Error("expected import origin");
    expect(spacing.origin.namespace).toBe("layout");
    expect(spacing.origin.module).toBe(layoutPath);
    expect(spacing.span.file).toBe(layoutPath);
    expect(spacing.span).toEqual(spacing.declaration.span);
  });

  test("variables/local-overrides-imported keeps the local value and the imported module intact", async () => {
    const entry = fixturePath("local-overrides-imported");
    const tokensPath = fixturePath("local-overrides-imported", "tokens.cssx");
    const { host } = createHost(fixtureFiles("local-overrides-imported"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const input = moduleAt(graph, entry);
    const gap = tokenAt(input.compileScope.tokens, "gap");
    expect(gap.origin).toEqual({ kind: "local" });
    expect(gap.declaration.value).toBe("24px");

    const radius = tokenAt(input.compileScope.tokens, "radius");
    expect(radius.origin.kind).toBe("import");
    expect(radius.module).toBe(tokensPath);
    expect(radius.unqualified).toBe(true);
    expect(radius.declaration.value).toBe("4px");
    if (radius.origin.kind !== "import") throw new Error("expected import origin");
    expect(radius.origin.module).toBe(tokensPath);
    expect(radius.origin.namespace).toBeUndefined();

    const imported = moduleAt(graph, tokensPath);
    expect(tokenAt(imported.compileScope.tokens, "gap").declaration.value).toBe("8px");
  });

  test("variables/ambiguous-import reports the second conflicting @use span", async () => {
    const entry = fixturePath("ambiguous-import");
    const aPath = fixturePath("ambiguous-import", "a.cssx");
    const bPath = fixturePath("ambiguous-import", "b.cssx");
    const { host } = createHost(fixtureFiles("ambiguous-import"));
    const source = readFileSync(join(FIXTURE_ROOT, "ambiguous-import", "input.cssx"), "utf8");

    const graph = await buildModuleGraph([entry], host, OPTIONS);

    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain("Ambiguous unqualified import");
    expect(diagnostic.message).toContain('"$spacing"');
    expect(diagnostic.message).toContain(aPath);
    expect(diagnostic.message).toContain(bPath);

    const secondUse = source.indexOf('@use "./b.cssx"');
    expect(diagnostic.span).toEqual({
      start: secondUse,
      end: secondUse + '@use "./b.cssx";'.length,
      file: entry,
    });

    // Deterministic recovery: the first provider stays visible for downstream
    // tooling; the error diagnostic is the contract that output is rejected.
    const input = moduleAt(graph, entry);
    expect(tokenAt(input.compileScope.tokens, "spacing").module).toBe(aPath);
    expect([...input.dependencies]).toEqual([aPath, bPath]);
  });

  test("variables/undefined-ref is left to A08 and produces no resolver diagnostic", async () => {
    const entry = fixturePath("undefined-ref");
    const { host } = createHost(fixtureFiles("undefined-ref"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);

    expect(graph.diagnostics).toEqual([]);
    expect(moduleAt(graph, entry).compileScope.tokens.size).toBe(0);
  });
});

describe("resolver: namespace independence", () => {
  test("two modules exporting the same name under different aliases do not conflict", async () => {
    const root = `${WORKSPACE}/namespaces`;
    const { host } = createHost({
      [`${root}/x.cssx`]: "@variables {\n  primary: #111;\n}\n",
      [`${root}/y.cssx`]: "@variables {\n  primary: #222;\n}\n",
      [`${root}/entry.cssx`]: [
        '@use "./x.cssx" as t1;',
        '@use "./y.cssx" as t2;',
        ".card { color: $t1.primary; background: $t2.primary; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect(entry.compileScope.tokens.has("primary")).toBe(false);
    expect([...entry.compileScope.namespaces.keys()]).toEqual(["t1", "t2"]);

    const first = entry.compileScope.namespaces.get("t1");
    const second = entry.compileScope.namespaces.get("t2");
    if (first === undefined || second === undefined) throw new Error("missing namespaces");
    expect(tokenAt(first.members, "primary").module).toBe(`${root}/x.cssx`);
    expect(tokenAt(second.members, "primary").module).toBe(`${root}/y.cssx`);
  });

  test("one unqualified and one namespaced import of the same name do not conflict", async () => {
    const root = `${WORKSPACE}/mixed`;
    const { host } = createHost({
      [`${root}/a.cssx`]: "@variables {\n  primary: #111;\n}\n",
      [`${root}/b.cssx`]: "@variables {\n  primary: #222;\n}\n",
      [`${root}/entry.cssx`]: [
        '@use "./a.cssx";',
        '@use "./b.cssx" as alt;',
        ".card { color: $primary; border-color: $alt.primary; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect(tokenAt(entry.compileScope.tokens, "primary").module).toBe(`${root}/a.cssx`);
    const alt = entry.compileScope.namespaces.get("alt");
    if (alt === undefined) throw new Error("missing alt namespace");
    expect(tokenAt(alt.members, "primary").module).toBe(`${root}/b.cssx`);
  });

  test("a repeated alias for different targets is XESSA2001; the same target is harmless", async () => {
    const root = `${WORKSPACE}/aliases`;
    const { host } = createHost({
      [`${root}/a.cssx`]: "@variables {\n  primary: #111;\n}\n",
      [`${root}/b.cssx`]: "@variables {\n  primary: #222;\n}\n",
      [`${root}/entry.cssx`]: [
        '@use "./a.cssx" as theme;',
        '@use "./b.cssx" as theme;',
        ".card { color: $theme.primary; }",
        "",
      ].join("\n"),
      [`${root}/same.cssx`]: [
        '@use "./a.cssx" as theme;',
        '@use "./a.cssx" as theme;',
        ".card { color: $theme.primary; }",
        "",
      ].join("\n"),
    });

    const conflict = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(conflict.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(conflict);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain('Duplicate namespace "theme"');
    const uses = conflict.modules
      .get(`${root}/entry.cssx`)
      ?.ast.items.filter((item) => item.kind === "use" && item.alias === "theme");
    const secondUse = uses?.[1];
    if (secondUse === undefined) throw new Error("missing second @use");
    expect(diagnostic.span).toEqual(secondUse.span);

    const duplicate = await buildModuleGraph([`${root}/same.cssx`], host, OPTIONS);
    expect(duplicate.diagnostics).toEqual([]);
    const same = moduleAt(duplicate, `${root}/same.cssx`);
    expect([...same.dependencies]).toEqual([`${root}/a.cssx`]);
  });
});

describe("resolver: scope-level errors", () => {
  test("duplicate local definitions inside one block are XESSA2001 at the later declaration", async () => {
    const root = `${WORKSPACE}/duplicate`;
    const source = "@variables {\n  gap: 1px;\n  gap: 2px;\n}\n.card { gap: $gap; }\n";
    const { host } = createHost({ [`${root}/entry.cssx`]: source });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);

    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain('Duplicate local compile-time variable "$gap"');

    const second = source.indexOf("gap: 2px;");
    expect(diagnostic.span).toEqual({
      start: second,
      end: second + "gap: 2px;".length,
      file: `${root}/entry.cssx`,
    });

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect(entry.compileScope.tokens.size).toBe(1);
    expect(tokenAt(entry.compileScope.tokens, "gap").declaration.value).toBe("1px");
  });

  test("duplicate local definitions across blocks are XESSA2001", async () => {
    const root = `${WORKSPACE}/duplicate-blocks`;
    const source = [
      "@variables {",
      "  gap: 1px;",
      "}",
      "@variables {",
      "  gap: 2px;",
      "}",
      "",
    ].join("\n");
    const { host } = createHost({ [`${root}/entry.cssx`]: source });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);
    expect(diagnosticAt(graph).message).toContain('"$gap"');
    expect(diagnosticAt(graph).span.start).toBe(source.lastIndexOf("gap: 2px;"));
  });

  test("a local definition suppresses unqualified-import ambiguity", async () => {
    const root = `${WORKSPACE}/shadowed-ambiguity`;
    const { host } = createHost({
      [`${root}/a.cssx`]: "@variables {\n  spacing: 8px;\n}\n",
      [`${root}/b.cssx`]: "@variables {\n  spacing: 12px;\n}\n",
      [`${root}/entry.cssx`]: [
        '@use "./a.cssx";',
        '@use "./b.cssx";',
        "@variables {",
        "  spacing: 24px;",
        "}",
        ".card { padding: $spacing; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const spacing = tokenAt(moduleAt(graph, `${root}/entry.cssx`).compileScope.tokens, "spacing");
    expect(spacing.origin).toEqual({ kind: "local" });
    expect(spacing.declaration.value).toBe("24px");
  });

  test("compile-time and runtime imports of the same unqualified name are ambiguous", async () => {
    const root = `${WORKSPACE}/cross-kind`;
    const { host } = createHost({
      [`${root}/a.cssx`]: "@variables {\n  gap: 8px;\n}\n",
      [`${root}/b.cssx`]: "@runtime {\n  gap: 12px;\n}\n",
      [`${root}/entry.cssx`]: [
        '@use "./a.cssx";',
        '@use "./b.cssx";',
        ".card { gap: $gap; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain('"$gap"');
    expect(diagnostic.message).toContain(`${root}/a.cssx`);
    expect(diagnostic.message).toContain(`${root}/b.cssx`);

    // Deterministic recovery: the first provider wins and stays in its space.
    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect(tokenAt(entry.compileScope.tokens, "gap").module).toBe(`${root}/a.cssx`);
    expect(entry.runtimeScope.tokens.has("gap")).toBe(false);
  });

  test("compile-time and runtime symbols sharing a local name are XESSA2001 at the later span", async () => {
    const root = `${WORKSPACE}/collision`;
    const { host } = createHost({
      [`${root}/entry.cssx`]: [
        "@variables {",
        "  primary: #2563eb;",
        "}",
        "@runtime {",
        "  primary: #60a5fa;",
        "}",
        ".card { color: $primary; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);

    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain("both a compile-time and a runtime variable");

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    const runtimeBlock = entry.ast.items.find((item) => item.kind === "runtime");
    if (runtimeBlock === undefined || runtimeBlock.kind !== "runtime") {
      throw new Error("missing runtime block");
    }
    const runtimeDeclaration = runtimeBlock.declarations[0];
    if (runtimeDeclaration === undefined) throw new Error("missing runtime declaration");
    expect(diagnostic.span).toEqual(runtimeDeclaration.span);

    // Both scopes still record their own definition for downstream recovery.
    expect([...entry.compileScope.tokens.keys()]).toEqual(["primary"]);
    expect([...entry.runtimeScope.tokens.keys()]).toEqual(["primary"]);
  });

  test("runtime-first ordering reports the compile-time declaration as the later one", async () => {
    const root = `${WORKSPACE}/collision-reverse`;
    const source = [
      "@runtime {",
      "  primary: #60a5fa;",
      "}",
      "@variables {",
      "  primary: #2563eb;",
      "}",
      "",
    ].join("\n");
    const { host } = createHost({ [`${root}/entry.cssx`]: source });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    const entry = moduleAt(graph, `${root}/entry.cssx`);
    const variablesBlock = entry.ast.items.find((item) => item.kind === "variables");
    if (variablesBlock === undefined || variablesBlock.kind !== "variables") {
      throw new Error("missing variables block");
    }
    const declaration = variablesBlock.tokens[0];
    if (declaration === undefined) throw new Error("missing token declaration");
    expect(diagnosticAt(graph).span).toEqual(declaration.span);
  });

  test("a token-only module records hasRules false", async () => {
    const root = `${WORKSPACE}/token-only`;
    const { host } = createHost({
      [`${root}/tokens.cssx`]: "@variables {\n  gap: 8px;\n}\n",
      [`${root}/entry.cssx`]: '@use "./tokens.cssx";\n@variables {\n  pad: $gap;\n}\n',
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    expect(moduleAt(graph, `${root}/tokens.cssx`).hasRules).toBe(false);
    expect(moduleAt(graph, `${root}/entry.cssx`).hasRules).toBe(false);
    expect(
      tokenAt(moduleAt(graph, `${root}/entry.cssx`).compileScope.tokens, "pad").declaration.value,
    ).toBe("$gap");
  });
});

describe("resolver: containment, resolution and dedupe", () => {
  test("imports are not transitively re-exported", async () => {
    const root = `${WORKSPACE}/transitive`;
    const { host } = createHost({
      [`${root}/a.cssx`]: "@variables {\n  a: 1px;\n}\n",
      [`${root}/b.cssx`]: '@use "./a.cssx";\n@variables {\n  b: $a;\n}\n',
      [`${root}/entry.cssx`]: '@use "./b.cssx";\n.card { gap: $b; }\n',
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect([...entry.compileScope.tokens.keys()]).toEqual(["b"]);
    expect(entry.compileScope.tokens.has("a")).toBe(false);

    const middle = moduleAt(graph, `${root}/b.cssx`);
    expect([...middle.compileScope.tokens.keys()].sort()).toEqual(["a", "b"]);
  });

  test("CSS string escapes in @use specifiers are decoded before resolution", async () => {
    const root = `${WORKSPACE}/escapes`;
    const { host } = createHost({
      [`${root}/theme.cssx`]: "@variables {\n  primary: #2563eb;\n}\n",
      [`${root}/entry.cssx`]: '@use "./\\74 heme.cssx";\n.card { color: $primary; }\n',
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    expect(moduleAt(graph, `${root}/entry.cssx`).dependencies).toEqual([`${root}/theme.cssx`]);
  });

  test("an import outside the workspace root is XESSA2001 before existence checks", async () => {
    const source = '@use "../../outside.cssx";\n.card { gap: 1px; }\n';
    const { host, calls } = createHost({
      [`${WORKSPACE}/src/button.cssx`]: source,
      "/outside.cssx": "@variables {\n  gap: 1px;\n}\n",
    });

    const graph = await buildModuleGraph([`${WORKSPACE}/src/button.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);

    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain("outside the workspace root");
    expect(diagnostic.message).toContain(WORKSPACE);
    expect(diagnostic.message).toContain("/outside.cssx");
    expect(diagnostic.span).toEqual({
      start: 0,
      end: '@use "../../outside.cssx";'.length,
      file: `${WORKSPACE}/src/button.cssx`,
    });

    // Containment is decided lexically, before existence/canonicalization.
    expect(calls.fileExists).not.toContain("/outside.cssx");
    expect(calls.canonicalize).not.toContain("/outside.cssx");
    expect(graph.modules.size).toBe(1);
  });

  test("a canonical target that leaves the workspace through a symlink is rejected", async () => {
    const root = `${WORKSPACE}/symlink`;
    const base = createHost({
      [`${root}/entry.cssx`]: '@use "./link.cssx";\n.card { gap: 1px; }\n',
      "/elsewhere/target.cssx": "@variables {\n  gap: 1px;\n}\n",
    });
    const host: ModuleHost = {
      ...base.host,
      canonicalize(path: string): string {
        return path.endsWith("link.cssx") ? "/elsewhere/target.cssx" : path;
      },
    };

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain("escapes the workspace root");
    expect(diagnostic.message).toContain("/elsewhere/target.cssx");
    expect(base.calls.fileExists).not.toContain("/elsewhere/target.cssx");
  });

  test("sibling-relative imports resolve from the importing file's directory", async () => {
    const { host } = createHost({
      [`${WORKSPACE}/src/button.cssx`]: '@use "./theme.cssx";\n.card { color: $primary; }\n',
      [`${WORKSPACE}/src/theme.cssx`]: "@variables {\n  primary: #2563eb;\n}\n",
    });

    const graph = await buildModuleGraph([`${WORKSPACE}/src/button.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    expect(moduleAt(graph, `${WORKSPACE}/src/button.cssx`).dependencies).toEqual([
      `${WORKSPACE}/src/theme.cssx`,
    ]);
    expect(graph.order).toEqual([`${WORKSPACE}/src/theme.cssx`, `${WORKSPACE}/src/button.cssx`]);
  });

  test("a missing import is XESSA2001 and adds no edge", async () => {
    const entry = `${WORKSPACE}/missing/entry.cssx`;
    const { host } = createHost({
      [entry]: '@use "./nope.cssx";\n.card { gap: 1px; }\n',
    });

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain("cannot be resolved");
    expect(diagnostic.message).toContain(`${WORKSPACE}/missing/nope.cssx`);
    expect(diagnostic.span.start).toBe(0);
    expect(moduleAt(graph, entry).dependencies).toEqual([]);
    expect(graph.order).toEqual([entry]);
  });

  test("repeated imports of one canonical target keep one edge and parse once", async () => {
    const root = `${WORKSPACE}/dedupe`;
    const theme = `${root}/theme.cssx`;
    const entry = `${root}/button.cssx`;
    const { host, calls } = createHost({
      [theme]: "@variables {\n  primary: #2563eb;\n}\n",
      [entry]: [
        '@use "./theme.cssx";',
        '@use "./theme.cssx";',
        ".card { color: $primary; }",
        "",
      ].join("\n"),
    });

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const record = moduleAt(graph, entry);
    expect(record.dependencies).toEqual([theme]);
    expect(moduleAt(graph, theme).importedBy).toEqual([entry]);
    expect(calls.readFile.filter((path) => path === theme)).toHaveLength(1);
    expect(tokenAt(record.compileScope.tokens, "primary").module).toBe(theme);
  });
});

describe("resolver: cycle and order edge cases", () => {
  test("self-import is a cycle and excludes its module from order", async () => {
    const entry = `${WORKSPACE}/self/self.cssx`;
    const { host } = createHost({
      [entry]: '@use "./self.cssx";\n@variables {\n  gap: 1px;\n}\n',
    });

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.diagnostics).toHaveLength(1);
    const diagnostic = diagnosticAt(graph);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.message).toContain(`${entry} -> ${entry}`);
    expect(graph.modules.has(entry)).toBe(true);
    expect(graph.order).toEqual([]);
  });

  test("order is dependencies-first with canonical-path tie breaking", async () => {
    const root = `${WORKSPACE}/diamond`;
    const { host } = createHost({
      [`${root}/a.cssx`]: '@use "./b.cssx";\n@use "./c.cssx";\n@variables {\n  a: $b;\n}\n',
      [`${root}/b.cssx`]: '@use "./d.cssx";\n@variables {\n  b: 1px;\n}\n',
      [`${root}/c.cssx`]: '@use "./d.cssx";\n@variables {\n  c: 2px;\n}\n',
      [`${root}/d.cssx`]: "@variables {\n  d: 3px;\n}\n",
    });

    const graph = await buildModuleGraph([`${root}/a.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.order).toEqual([
      `${root}/d.cssx`,
      `${root}/b.cssx`,
      `${root}/c.cssx`,
      `${root}/a.cssx`,
    ]);
    expect(moduleAt(graph, `${root}/d.cssx`).importedBy).toEqual([
      `${root}/b.cssx`,
      `${root}/c.cssx`,
    ]);
  });

  test("empty entry lists yield an empty, diagnostic-free graph", async () => {
    const { host, calls } = createHost({});
    const graph = await buildModuleGraph([], host, OPTIONS);
    expect(graph.modules.size).toBe(0);
    expect(graph.order).toEqual([]);
    expect(graph.diagnostics).toEqual([]);
    expect(calls.readFile).toEqual([]);
  });
});

describe("resolver: determinism and purity", () => {
  test("identical inputs produce identical order, modules and diagnostics", async () => {
    const entry = fixturePath("ambiguous-import");
    const first = await buildModuleGraph(
      [entry],
      createHost(fixtureFiles("ambiguous-import")).host,
      OPTIONS,
    );
    const second = await buildModuleGraph(
      [entry],
      createHost(fixtureFiles("ambiguous-import")).host,
      OPTIONS,
    );

    expect(first.order).toEqual(second.order);
    expect([...first.modules.keys()]).toEqual([...second.modules.keys()]);
    expect(first.diagnostics).toEqual(second.diagnostics);

    const firstInput = moduleAt(first, entry);
    const secondInput = moduleAt(second, entry);
    expect([...firstInput.compileScope.tokens.keys()]).toEqual([
      ...secondInput.compileScope.tokens.keys(),
    ]);
    expect([...firstInput.compileScope.namespaces.keys()]).toEqual([
      ...secondInput.compileScope.namespaces.keys(),
    ]);
  });

  test("every file access goes through the injected ModuleHost", async () => {
    const entry = fixturePath("namespaced-members");
    const { host, calls } = createHost(fixtureFiles("namespaced-members"));

    const graph = await buildModuleGraph([entry], host, OPTIONS);
    expect(graph.modules.size).toBe(2);
    expect(calls.workspaceRoot).toBeGreaterThan(0);
    expect(calls.canonicalize.length).toBeGreaterThan(0);
    expect(calls.resolvePath.length).toBeGreaterThan(0);
    expect(calls.fileExists.length).toBeGreaterThan(0);
    expect(calls.readFile.length).toBe(2);
  });

  test("src/resolver imports no Node filesystem or path modules", () => {
    const directory = join(import.meta.dir, "..", "..", "packages", "compiler", "src", "resolver");
    const sources = readdirSync(directory).filter((file) => file.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const text = readFileSync(join(directory, file), "utf8");
      expect(text).not.toMatch(/^\s*(?:import|export)[^;]*?from\s+["']node:/m);
      expect(text).not.toMatch(/\brequire\(\s*["']node:/);
      expect(text).not.toMatch(/^\s*import\s+["']node:/m);
    }
  });
});
