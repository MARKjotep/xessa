/**
 * `@setup { css-dir: "a", "b"; }` decoding (CSSX-F18, ADR-0019).
 *
 * One authored path keeps the single-value behaviour byte-for-byte. A list
 * decodes into `cssDirs`; duplicate or empty items are XESSA2001 setup errors
 * with a span inside the authored value.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../../packages/compiler/src/index.ts";

async function compileVirtual(source: string) {
  const root = mkdtempSync(join(tmpdir(), "xessa-css-list-"));
  try {
    return await compile(source, { file: "src/app.cssx", workspaceRoot: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function errors(result: Awaited<ReturnType<typeof compile>>) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

describe("css-dir list decoding", () => {
  test("a list is valid and leaves CSS generation unchanged", async () => {
    const result = await compileVirtual(
      '@setup { css-dir: "../client", "../src"; }\n.app { color: red; }\n',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain(".app{");
  });

  test("a single authored path keeps the current behaviour", async () => {
    const result = await compileVirtual('@setup { css-dir: "../client"; }\n.app { color: red; }\n');
    expect(result.diagnostics).toEqual([]);
    expect(result.css).toContain(".app{");
  });

  test("duplicate paths are XESSA2001 at the duplicate item", async () => {
    const source = '@setup { css-dir: "../out", "../out"; }\n.app { color: red; }\n';
    const result = await compileVirtual(source);
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("Duplicate");
    expect(found[0]?.span.start).toBeGreaterThanOrEqual(0);
    expect(found[0]?.span.end).toBeGreaterThan(found[0]?.span.start ?? 0);
    expect(source.slice(found[0]?.span.start ?? 0, found[0]?.span.end ?? 0)).toBe('"../out"');
  });

  test("duplicate normalised paths are XESSA2001 at the duplicate item", async () => {
    const source = '@setup { css-dir: "./out", "out/"; }\n.app { color: red; }\n';
    const result = await compileVirtual(source);
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("Duplicate");
    expect(source.slice(found[0]?.span.start ?? 0, found[0]?.span.end ?? 0)).toBe('"out/"');
  });

  test("an empty middle item is XESSA2001 with a span inside the value", async () => {
    const source = '@setup { css-dir: "../a", , "../b"; }\n.app { color: red; }\n';
    const result = await compileVirtual(source);
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("empty");
    expect(found[0]?.span.end).toBeGreaterThan(found[0]?.span.start ?? 0);
    expect(found[0]?.span.start).toBeGreaterThanOrEqual(source.indexOf('"../a"'));
    expect(found[0]?.span.end).toBeLessThanOrEqual(source.indexOf('"../b"') + '"../b"'.length);
  });

  test("a trailing empty item is XESSA2001", async () => {
    const source = '@setup { css-dir: "../a",; }\n.app { color: red; }\n';
    const result = await compileVirtual(source);
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("empty");
  });

  test("a leading empty item is XESSA2001", async () => {
    const source = '@setup { css-dir: , "../a"; }\n.app { color: red; }\n';
    const result = await compileVirtual(source);
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("empty");
  });

  test("an empty single value is XESSA2001 rather than a silent default", async () => {
    const result = await compileVirtual('@setup { css-dir: ""; }\n.app { color: red; }\n');
    const found = errors(result);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("XESSA2001");
    expect(found[0]?.message).toContain("empty");
  });
});
