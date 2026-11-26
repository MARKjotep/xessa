import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { compile } from "../../packages/compiler/src/index.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";

/**
 * CSSX-U04 compiler half: a single-file document with a duplicate
 * `@variables`/`@runtime` key must report the resolver's XESSA2001.
 *
 * `compile()` builds a memory-only module graph when the source has no `@use`.
 * That graph reparses the same source and produces the same entry diagnostics
 * as the module-graph path; the former code kept only `parse()`'s diagnostics
 * and silently dropped them. These tests pin:
 *
 * - exactly one diagnostic with the resolver's code, message and span;
 * - byte-identical CSS (first value still wins);
 * - the `@use` path still reports exactly one copy (no double reporting);
 * - the single-file diagnostic is identical to `buildModuleGraph()`'s.
 */

const ROOT = "/virtual/xessa-single-file";
const ENTRY = `${ROOT}/single.cssx`;

/** In-memory host with the same identity canonicalization `compile()` uses. */
function memoryHost(files: Readonly<Record<string, string>>, root: string): ModuleHost {
  return {
    async readFile(path: string): Promise<string> {
      const source = files[path];
      if (source === undefined) throw new Error(`ENOENT: ${path}`);
      return source;
    },
    async fileExists(path: string): Promise<boolean> {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
    canonicalize(path: string): string {
      return path;
    },
    resolvePath(from: string, to: string): string {
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      return root;
    },
  };
}

function compileOptions(file: string, workspaceRoot: string): CompileOptions {
  return { file, workspaceRoot };
}

describe("single-file duplicate @variables keys (CSSX-U04)", () => {
  const source = [
    "@variables {",
    "  gap: 8px;",
    "  gap: 16px;",
    "}",
    ".card { padding: $gap; }",
  ].join("\n");

  test("compile() reports exactly one XESSA2001 with the resolver's message and span", async () => {
    const result = await compile(source, compileOptions(ENTRY, ROOT));

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    const later = source.indexOf("gap: 16px");
    expect(diagnostic).toEqual({
      code: "XESSA2001",
      severity: "error",
      message: `Duplicate local compile-time variable "$gap" in "${ENTRY}".`,
      span: { start: later, end: source.indexOf(";", later) + 1, file: ENTRY },
    });
    // The later declaration is the reported span, and it stays in bounds.
    expect(diagnostic?.span.end).toBeLessThanOrEqual(source.length);

    // First definition still wins and the emission is unchanged.
    expect(result.css).toBe(".card{padding:8px;}");
  });

  test("the single-file diagnostic is identical to buildModuleGraph()'s", async () => {
    const files = { [ENTRY]: source };
    const graph = await buildModuleGraph([ENTRY], memoryHost(files, ROOT), {
      file: ENTRY,
    });
    const graphDiagnostic = graph.diagnostics.find((diagnostic) => diagnostic.code === "XESSA2001");
    expect(graphDiagnostic).toBeDefined();

    const result = await compile(source, compileOptions(ENTRY, ROOT));
    expect(result.diagnostics).toEqual([graphDiagnostic]);
  });

  test("a duplicate @runtime key is reported once at the later declaration", async () => {
    const runtimeSource = [
      "@runtime {",
      "  primary: red;",
      "  primary: blue;",
      "}",
      ".card { color: $primary; }",
    ].join("\n");
    const result = await compile(runtimeSource, compileOptions(ENTRY, ROOT));

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    const later = runtimeSource.indexOf("primary: blue");
    expect(diagnostic?.message).toBe(`Duplicate local runtime variable "$primary" in "${ENTRY}".`);
    expect(diagnostic?.span).toEqual({
      start: later,
      end: runtimeSource.indexOf(";", later),
      file: ENTRY,
    });
    // The first runtime value still wins.
    expect(result.css).toContain("--primary:red;");
    expect(result.css).toContain("color:var(--primary);");
  });

  test("a compile-time/runtime collision is reported once at the later declaration", async () => {
    const collisionSource = [
      "@variables { primary: #2563eb; }",
      "@runtime { primary: #0ea5e9; }",
      ".card { color: $primary; }",
    ].join("\n");
    const result = await compile(collisionSource, compileOptions(ENTRY, ROOT));

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    const diagnostic = result.diagnostics[0];
    const later = collisionSource.indexOf("primary: #0ea5e9");
    expect(diagnostic?.message).toBe(
      `"$primary" cannot be both a compile-time and a runtime variable in "${ENTRY}".`,
    );
    expect(diagnostic?.span).toEqual({
      start: later,
      end: collisionSource.indexOf(";", later),
      file: ENTRY,
    });
  });
});

describe("module-graph duplicate keys stay single-reporting (CSSX-U04)", () => {
  test("an @use document reports its entry duplicate exactly once", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-u04-"));
    try {
      writeFileSync(join(root, "theme.cssx"), "@variables { space: 4px; }\n");
      const source = [
        '@use "./theme.cssx";',
        "@variables {",
        "  gap: 8px;",
        "  gap: 16px;",
        "}",
        ".card { padding: $gap $space; }",
      ].join("\n");
      const result = await compile(source, compileOptions("input.cssx", root));

      const duplicates = result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "XESSA2001" &&
          /duplicate local compile-time/i.test(diagnostic.message),
      );
      expect(duplicates).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.css).toBe(".card{padding:8px 4px;}");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the fixture golden still compiles to its expected CSS", async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const file = "tests/fixtures/variables/duplicate-local/input.cssx";
    const source = readFileSync(join(repoRoot, file), "utf8");
    const result = await compile(source, compileOptions(file, repoRoot));

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    expect(result.css).toBe(
      readFileSync(
        join(repoRoot, "tests/fixtures/variables/duplicate-local/expected/minified"),
        "utf8",
      ),
    );
  });
});
