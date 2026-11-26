import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { compileProject, parse } from "../../packages/compiler/src/index.ts";
import { GROUP_DIRECTIVE, collectGroups } from "../../packages/compiler/src/resolver/groups.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type {
  GroupResolution,
  ModuleGraph,
  ModuleRecord,
  VisibleGroup,
} from "../../packages/compiler/src/resolver/index.ts";
import type { Diagnostic } from "../../packages/compiler/src/types/diagnostics.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";

/**
 * Resolver side of reusable declaration groups (ADR-0017, plan G2).
 *
 * The resolver owns collection, the `styles` visibility closure and precedence:
 * duplicates inside one module are XESSA2001 at the later definition, a local
 * definition shadows imports without a diagnostic, two imported definitions
 * with no local one resolve as `ambiguous` (the use-site diagnostic belongs to
 * G3), token-only imports expose nothing, and `@use "…" as group` is XESSA2001
 * at the `@use`. Use-site grammar lives in `groups.parser.test.ts`; expansion is
 * G3 and is not implemented here.
 */

const WORKSPACE = "/workspace";
const OPTIONS: CompileOptions = { file: "groups.resolver.test" };

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

function resolved(record: ModuleRecord, name: string): VisibleGroup {
  const resolution = record.groups.get(name);
  if (resolution === undefined || resolution.kind !== "resolved") {
    throw new Error(`expected a resolved group "${name}"`);
  }
  return resolution.group;
}

function ambiguous(record: ModuleRecord, name: string): GroupResolution & { kind: "ambiguous" } {
  const resolution = record.groups.get(name);
  if (resolution === undefined || resolution.kind !== "ambiguous") {
    throw new Error(`expected an ambiguous group "${name}"`);
  }
  return resolution;
}

function codes(diagnostics: readonly { readonly code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("groups: per-module collection", () => {
  test("top-level definitions are collected in authored order with their spans and nodes", () => {
    const source = [
      "@group.card {",
      "  padding: 12px;",
      "}",
      ".panel {",
      "  @group.tile {",
      "    color: red;",
      "  }",
      "}",
      "@group.tile {",
      "  color: blue;",
      "}",
      "@group.empty {",
      "}",
      "",
    ].join("\n");
    const diagnostics: Diagnostic[] = [];
    const ast = parse(source, { file: "a.cssx" }).ast;
    const groups = collectGroups("a.cssx", ast, (diagnostic) => diagnostics.push(diagnostic));

    expect(diagnostics).toEqual([]);
    expect(groups.map((group) => group.name)).toEqual(["card", "tile", "empty"]);
    expect(groups.every((group) => group.module === "a.cssx")).toBe(true);

    const [card, tile, empty] = groups;
    if (card === undefined || tile === undefined || empty === undefined) {
      throw new Error("missing collected groups");
    }
    // The `@group.tile` inside `.panel` is a use site, never a definition: only
    // the top-level statement is collected (position decides the node kind).
    expect(source.slice(card.span.start, card.span.end)).toBe("@group.card {\n  padding: 12px;\n}");
    expect(source.slice(tile.span.start, tile.span.end)).toBe("@group.tile {\n  color: blue;\n}");
    expect(card.definition.declarations[0]?.property).toBe("padding");
    expect(tile.definition.kind).toBe("group-definition");
    expect(empty.definition.declarations).toEqual([]);
  });

  test("a duplicate definition is XESSA2001 at the later statement and the first one wins", async () => {
    const file = `${WORKSPACE}/duplicate/entry.cssx`;
    const source = [
      "@group.card {",
      "  padding: 1px;",
      "}",
      "@group.card {",
      "  padding: 2px;",
      "}",
      ".panel { color: red; }",
      "",
    ].join("\n");
    const graph = await buildModuleGraph([file], createHost({ [file]: source }), OPTIONS);

    expect(codes(graph.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = graph.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing duplicate diagnostic");
    expect(diagnostic.message).toContain('Duplicate group definition "@group.card"');
    expect(diagnostic.message).toContain(file);

    const later = source.lastIndexOf("@group.card {");
    expect(diagnostic.span).toEqual({
      start: later,
      end: later + "@group.card {\n  padding: 2px;\n}".length,
      file,
    });

    // First definition wins, so the record and every consumer see `padding: 1px`.
    const card = resolved(moduleAt(graph, file), "card");
    expect(card.definition.declarations[0]?.value).toBe("1px");
    expect(card.span.start).toBe(source.indexOf("@group.card {"));
  });
});

describe("groups: styles visibility (owner decision (a))", () => {
  test("own definitions plus the transitive styles closure, in authored order", async () => {
    const root = `${WORKSPACE}/visibility`;
    const host = createHost({
      [`${root}/entry.cssx`]: [
        '@use "./a.cssx" styles;',
        '@use "./token.cssx";',
        "@group.own { padding: 1px; }",
        ".panel { color: red; }",
        "",
      ].join("\n"),
      [`${root}/a.cssx`]: [
        '@use "./b.cssx" styles;',
        "@group.outer { padding: 2px; }",
        ".mid { color: red; }",
        "",
      ].join("\n"),
      [`${root}/b.cssx`]: "@group.inner { padding: 3px; }\n",
      [`${root}/token.cssx`]: "@group.hidden { padding: 4px; }\n@variables { gap: 1px; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect([...entry.groups.keys()]).toEqual(["own", "outer", "inner"]);
    expect(resolved(entry, "inner").module).toBe(`${root}/b.cssx`);
    expect(resolved(entry, "outer").module).toBe(`${root}/a.cssx`);

    // A token-only import exposes no groups even though it defines one.
    expect(entry.groups.has("hidden")).toBe(false);
    expect(resolved(moduleAt(graph, `${root}/token.cssx`), "hidden").module).toBe(
      `${root}/token.cssx`,
    );
  });

  test("a token-only import of a group-defining module is invisible, same-file is always visible", async () => {
    const root = `${WORKSPACE}/token-only`;
    const host = createHost({
      [`${root}/entry.cssx`]: [
        '@use "./card.cssx";',
        "@group.own { padding: 1px; }",
        ".panel { color: red; }",
        "",
      ].join("\n"),
      [`${root}/card.cssx`]: "@group.card { padding: 8px; }\n.card { color: blue; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    const entry = moduleAt(graph, `${root}/entry.cssx`);
    expect([...entry.groups.keys()]).toEqual(["own"]);
    expect(resolved(moduleAt(graph, `${root}/card.cssx`), "card").module).toBe(`${root}/card.cssx`);
  });

  test("a styles cycle is already XESSA2001 and the closure walk stays deterministic", async () => {
    const root = `${WORKSPACE}/cycle`;
    const host = createHost({
      [`${root}/entry.cssx`]: '@use "./a.cssx" styles;\n',
      [`${root}/a.cssx`]:
        '@use "./b.cssx" styles;\n@group.from-a { padding: 1px; }\n.a { color: red; }\n',
      [`${root}/b.cssx`]:
        '@use "./a.cssx" styles;\n@group.from-b { padding: 2px; }\n.b { color: blue; }\n',
    });

    const first = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    const second = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);

    expect(codes(first.diagnostics)).toEqual(["XESSA2001"]);
    expect(first.diagnostics[0]?.message).toContain("Import cycle detected");
    expect(first.order).toEqual([`${root}/entry.cssx`]);
    // Every module still resolves its own definition.
    expect(resolved(moduleAt(first, `${root}/a.cssx`), "from-a").module).toBe(`${root}/a.cssx`);
    expect(resolved(moduleAt(first, `${root}/b.cssx`), "from-b").module).toBe(`${root}/b.cssx`);
    // A back edge contributes nothing, but the result never varies between runs.
    expect([...moduleAt(first, `${root}/entry.cssx`).groups.keys()]).toEqual([
      ...moduleAt(second, `${root}/entry.cssx`).groups.keys(),
    ]);
  });
});

describe("groups: precedence (ADR-0017 item 5)", () => {
  test("a local definition shadows an imported one without a diagnostic", async () => {
    const root = `${WORKSPACE}/shadow`;
    const host = createHost({
      [`${root}/entry.cssx`]: [
        '@use "./card.cssx" styles;',
        "@group.card { padding: 24px; }",
        ".panel { color: red; }",
        "",
      ].join("\n"),
      [`${root}/card.cssx`]: "@group.card { padding: 8px; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    const card = resolved(moduleAt(graph, `${root}/entry.cssx`), "card");
    expect(card.module).toBe(`${root}/entry.cssx`);
    expect(card.definition.declarations[0]?.value).toBe("24px");
    // The imported definition is not mutated by the local shadow.
    expect(resolved(moduleAt(graph, `${root}/card.cssx`), "card").module).toBe(`${root}/card.cssx`);
  });

  test("two imported definitions with no local one resolve as ambiguous, with no resolver error", async () => {
    const root = `${WORKSPACE}/ambiguous`;
    const host = createHost({
      [`${root}/entry.cssx`]:
        '@use "./a.cssx" styles;\n@use "./b.cssx" styles;\n.panel { color: red; }\n',
      [`${root}/a.cssx`]: "@group.card { padding: 8px; }\n.a { color: red; }\n",
      [`${root}/b.cssx`]: "@group.card { padding: 12px; }\n.b { color: blue; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    const resolution = ambiguous(moduleAt(graph, `${root}/entry.cssx`), "card");
    expect(resolution.name).toBe("card");
    // Authored order: the first `styles` import's definition comes first.
    expect(resolution.candidates.map((group) => group.module)).toEqual([
      `${root}/a.cssx`,
      `${root}/b.cssx`,
    ]);
    // Each defining module keeps its own definition resolved.
    expect(resolved(moduleAt(graph, `${root}/a.cssx`), "card").module).toBe(`${root}/a.cssx`);
    expect(resolved(moduleAt(graph, `${root}/b.cssx`), "card").module).toBe(`${root}/b.cssx`);
  });

  test("a direct and a transitive definition of one name are both imported: ambiguous at the consumer", async () => {
    const root = `${WORKSPACE}/ambiguous-transitive`;
    const host = createHost({
      [`${root}/entry.cssx`]: '@use "./a.cssx" styles;\n.panel { color: red; }\n',
      [`${root}/a.cssx`]:
        '@use "./b.cssx" styles;\n@group.card { padding: 8px; }\n.a { color: red; }\n',
      [`${root}/b.cssx`]: "@group.card { padding: 12px; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);

    // Visibility is transitive (ADR-0017 item 4); neither import is more local,
    // so the consumer sees two imported definitions and no local one.
    const resolution = ambiguous(moduleAt(graph, `${root}/entry.cssx`), "card");
    expect(resolution.candidates.map((group) => group.module)).toEqual([
      `${root}/a.cssx`,
      `${root}/b.cssx`,
    ]);
    // `a` defines it locally, so its own view is resolved.
    expect(resolved(moduleAt(graph, `${root}/a.cssx`), "card").module).toBe(`${root}/a.cssx`);
  });

  test("a diamond contributes one definition, so the consumer resolves instead of flagging ambiguity", async () => {
    const root = `${WORKSPACE}/diamond`;
    const host = createHost({
      [`${root}/entry.cssx`]:
        '@use "./a.cssx" styles;\n@use "./b.cssx" styles;\n.panel { color: red; }\n',
      [`${root}/a.cssx`]: '@use "./c.cssx" styles;\n.a { color: red; }\n',
      [`${root}/b.cssx`]: '@use "./c.cssx" styles;\n.b { color: blue; }\n',
      [`${root}/c.cssx`]: "@group.card { padding: 8px; }\n",
    });

    const graph = await buildModuleGraph([`${root}/entry.cssx`], host, OPTIONS);
    expect(graph.diagnostics).toEqual([]);
    expect(resolved(moduleAt(graph, `${root}/entry.cssx`), "card").module).toBe(`${root}/c.cssx`);
  });
});

describe("groups: the `group` directive name is reserved", () => {
  test("an @use alias named group is XESSA2001 at the @use and creates no namespace", async () => {
    const root = `${WORKSPACE}/alias`;
    const entry = `${root}/entry.cssx`;
    const source = [
      `@use "./theme.cssx" as ${GROUP_DIRECTIVE};`,
      '@use "./theme.cssx";',
      "@group.card { padding: 8px; }",
      ".panel { color: $primary; }",
      "",
    ].join("\n");
    const host = createHost({
      [entry]: source,
      [`${root}/theme.cssx`]: "@variables { primary: #111; }\n",
    });

    const graph = await buildModuleGraph([entry], host, OPTIONS);

    expect(codes(graph.diagnostics)).toEqual(["XESSA2001"]);
    const diagnostic = graph.diagnostics[0];
    if (diagnostic === undefined) throw new Error("missing alias diagnostic");
    expect(diagnostic.message).toContain(`"${GROUP_DIRECTIVE}" is a reserved directive name`);
    expect(diagnostic.message).toContain("ADR-0017");
    expect(diagnostic.span).toEqual({
      start: 0,
      end: `@use "./theme.cssx" as ${GROUP_DIRECTIVE};`.length,
      file: entry,
    });

    const record = moduleAt(graph, entry);
    // No namespace was created, and the rejected alias never shadows the
    // built-in construct: the definition still resolves.
    expect(record.compileScope.namespaces.has(GROUP_DIRECTIVE)).toBe(false);
    expect(resolved(record, "card").module).toBe(entry);
    // The edge itself is otherwise valid: the plain import still provides tokens.
    expect(record.dependencies).toEqual([`${root}/theme.cssx`]);
    expect(record.compileScope.tokens.get("primary")?.module).toBe(`${root}/theme.cssx`);
  });
});

describe("groups: `$group.<name>` stays an unknown token namespace", () => {
  test("substitution reports XESSA2001 through the existing unknown-namespace path", async () => {
    const root = `${WORKSPACE}/dollar-group`;
    const host = createHost({
      [`${root}/entry.cssx`]: [
        "@group.card { padding: 8px; }",
        ".panel { color: $group.card; }",
        "",
      ].join("\n"),
    });

    const results = await compileProject(["entry.cssx"], host, { projectRoot: root });
    const entry = results["entry.cssx"];
    if (entry === undefined) throw new Error("missing entry result");

    expect(codes(entry.diagnostics)).toEqual(["XESSA2001"]);
    expect(entry.diagnostics[0]?.message).toContain('Unknown token namespace "$group"');
    expect(entry.css ?? "").not.toContain("$");
  });
});
