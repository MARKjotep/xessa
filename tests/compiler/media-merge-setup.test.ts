import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, compileProject, createNodeHost } from "../../packages/compiler/src/index.ts";

/**
 * `media-grouping` setup resolution (ADR-0024).
 *
 * Precedence is defaults (`safe`) < project/API option < file `@setup`.
 * `merge` is opt-in; the default never changes here. Invalid values are
 * XESSA1001 diagnostics whose span stays inside the authored value.
 */

const MERGE_SOURCE = [
  "@setup { media-grouping: merge; }",
  ".a { @md { color: red; } }",
  ".b { padding: 1px; }",
  ".a { @md { color: blue; } }",
].join("\n");

const DEFAULT_SOURCE = [
  ".a { @md { color: red; } }",
  ".b { padding: 1px; }",
  ".a { @md { color: blue; } }",
].join("\n");

function mediaBlockCount(css: string | undefined): number {
  return (css?.match(/@media/g) ?? []).length;
}

describe("media-grouping setup key", () => {
  test("safe remains the default", async () => {
    const result = await compile(DEFAULT_SOURCE, { file: "src/default.cssx", minify: true });
    expect(result.diagnostics).toEqual([]);
    expect(mediaBlockCount(result.css)).toBe(2);
  });

  test("an API/project option enables merge", async () => {
    const result = await compile(DEFAULT_SOURCE, {
      file: "src/api.cssx",
      minify: true,
      mediaGrouping: "merge",
    });
    expect(result.diagnostics).toEqual([]);
    expect(mediaBlockCount(result.css)).toBe(1);
    expect(result.css).toContain("color:red;color:blue");
  });

  test("file @setup overrides a project/API none or safe value", async () => {
    for (const mediaGrouping of ["none", "safe"] as const) {
      const result = await compile(MERGE_SOURCE, {
        file: "src/file-wins.cssx",
        minify: true,
        mediaGrouping,
      });
      expect(result.diagnostics).toEqual([]);
      expect(mediaBlockCount(result.css)).toBe(1);
    }
  });

  test("quoted values decode like the other scalar setup keys", async () => {
    const result = await compile(MERGE_SOURCE.replace("merge;", '"merge";'), {
      file: "src/quoted.cssx",
      minify: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(mediaBlockCount(result.css)).toBe(1);
  });

  test("an invalid value is XESSA1001 with an in-bounds span and falls back", async () => {
    const source = [
      "@setup { media-grouping: unsafe; }",
      ".a { @md { color: red; } }",
      ".b { padding: 1px; }",
      ".a { @md { color: blue; } }",
    ].join("\n");
    const result = await compile(source, {
      file: "src/bad.cssx",
      minify: true,
      mediaGrouping: "none",
    });
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA1001");
    expect(diagnostic?.message).toContain('"media-grouping"');
    expect(diagnostic?.span.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic?.span.end).toBeGreaterThan(diagnostic?.span.start ?? 0);
    expect(diagnostic?.span.end).toBeLessThanOrEqual(source.length);
    // The invalid file value is ignored: the project/API layer wins.
    expect(mediaBlockCount(result.css)).toBe(2);
  });

  test("duplicate media-grouping keys are rejected", async () => {
    const result = await compile(
      "@setup { media-grouping: merge; media-grouping: safe; }\n.a { color: red; }",
      { file: "src/duplicate.cssx" },
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1001"]);
    expect(result.diagnostics[0]?.message).toContain("Duplicate @setup setting");
  });

  test("compileProject applies the same file-over-project precedence", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-media-merge-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "entry.cssx"), MERGE_SOURCE);

      const results = await compileProject(["src/entry.cssx"], createNodeHost(root), {
        projectRoot: root,
        mediaGrouping: "none",
      });
      const result = results["src/entry.cssx"];
      expect(result).toBeDefined();
      if (result === undefined) return;
      expect(result.diagnostics).toEqual([]);
      expect(mediaBlockCount(result.css)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
