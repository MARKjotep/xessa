/**
 * CSSX-T03: every diagnostic span stays inside the source it points at.
 *
 * An invalid `@setup prefix` containing `$` renders a runtime reference as
 * `var(--$-p)`. Re-reading that generated text with the authored value offsets
 * used to invent a `$-p` reference at `46..49` in a 44-character file. The
 * synthesized `$` is not authored, so no diagnostic may report it, and every
 * span that is reported must satisfy `0 <= start <= end <= source.length`.
 *
 * Authored references keep their exact spans, so the guard does not hide real
 * undefined-token diagnostics or shift them.
 */

import { describe, expect, test } from "bun:test";
import { compile } from "../../packages/compiler/src/index.ts";
import type { Diagnostic } from "../../packages/compiler/src/index.ts";

const FILE = "tests/fixtures/runtime/basic/input.cssx";
const WORKSPACE_ROOT = process.cwd();

/** Compile one source through the public entry point. */
async function compileSource(source: string): Promise<readonly Diagnostic[]> {
  const result = await compile(source, { file: FILE, workspaceRoot: WORKSPACE_ROOT });
  return result.diagnostics;
}

/** Assert the span contract for every diagnostic of one source. */
function expectInBounds(source: string, diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
    expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
  }
}

describe("CSSX-T03 setup prefix diagnostic spans", () => {
  test("an invalid `$` prefix keeps every span in bounds", async () => {
    const source = '@setup{prefix:"$";}@runtime{p:red;}.c{c:$p;}';
    expect(source).toHaveLength(44);
    const diagnostics = await compileSource(source);
    expectInBounds(source, diagnostics);
    // `$p` is the authored runtime reference; only the invalid class prefix is
    // reported, and never as the synthesized `$-p` custom-property text.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA4001"]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('"$-p"'))).toBe(false);
  });

  test("the same guard holds when the value has leading text", async () => {
    const source = '@setup{prefix:"$";}@runtime{p:red;}.c{c:1px solid $p;}';
    const diagnostics = await compileSource(source);
    expectInBounds(source, diagnostics);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "XESSA2001")).toBe(false);
  });

  test("an authored undefined reference next to a `$` prefix keeps its span", async () => {
    const source = '@setup{prefix:"$";}@runtime{p:red;}.c{c:$nope $p;}';
    const diagnostics = await compileSource(source);
    expectInBounds(source, diagnostics);
    const undefinedToken = diagnostics.find((diagnostic) => diagnostic.code === "XESSA2001");
    expect(undefinedToken?.message).toContain('Undefined token "$nope"');
    expect({ start: undefinedToken?.span.start, end: undefinedToken?.span.end }).toEqual({
      start: 40,
      end: 45,
    });
  });

  test("a reference after leading value text is reported at its authored offset", async () => {
    const source = ".c{c:red $nope;}";
    const diagnostics = await compileSource(source);
    expectInBounds(source, diagnostics);
    const undefinedToken = diagnostics.find((diagnostic) => diagnostic.code === "XESSA2001");
    expect(undefinedToken?.message).toContain('Undefined token "$nope"');
    expect({ start: undefinedToken?.span.start, end: undefinedToken?.span.end }).toEqual({
      start: 9,
      end: 14,
    });
  });
});
