import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../../packages/compiler/src/index.ts";
import { FLATTEN_LIMITS, flattenSelector } from "../../packages/compiler/src/selectors/index.ts";

/**
 * CSSX-T04 — bounded `&`-nesting expansion.
 *
 * Every nesting level that carries two `&`s duplicates the flattened selector
 * (or squares a selector list), so a pathological but syntactically valid
 * document used to grow exponentially: 12 levels emitted ~12 KB and 1 000
 * levels never finished. These cases pin the {@link FLATTEN_LIMITS} contract:
 * legal nesting (including the committed scale shape) is unchanged, moderate
 * `& &` nesting still compiles as today, and pathological input fails fast with
 * one typed XESSA1001 diagnostic whose span is in bounds.
 */

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xessa-nesting-bound-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** `.a { & & { & & { … color: red; } } }` with `levels` nesting levels in total. */
function ampersandChain(levels: number): string {
  const lines: string[] = [".a {"];
  for (let level = 1; level < levels; level += 1) {
    lines.push(`${"  ".repeat(level)}& & {`);
  }
  lines.push(`${"  ".repeat(levels)}color: red;`);
  for (let level = levels - 1; level >= 0; level -= 1) {
    lines.push(`${"  ".repeat(level)}}`);
  }
  return `${lines.join("\n")}\n`;
}

function validSpan(start: number, end: number, sourceLength: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    0 <= start &&
    start <= end &&
    end <= sourceLength
  );
}

describe("CSSX-T04 nesting expansion bound", () => {
  test("12-level `& &` nesting still compiles as today", async () => {
    const source = ampersandChain(12);
    const result = await compile(source, {
      file: "src/moderate.cssx",
      workspaceRoot: await workspace(),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBeDefined();
    // Each `& &` duplicates the parent compound: `.a` → `.a .a` → `.a .a .a .a` …
    expect(result.css).toContain(".a .a");
    expect(result.css).toContain("red");
  });

  test("1 000-level `& &` chain fails fast with one typed, in-bounds diagnostic", async () => {
    const source = ampersandChain(1_000);
    const started = performance.now();
    const result = await compile(source, {
      file: "src/pathological.cssx",
      workspaceRoot: await workspace(),
    });
    const elapsed = performance.now() - started;

    // The old defect never finished inside 180 s; the bound must be prompt.
    expect(elapsed).toBeLessThan(30_000);
    expect(result.diagnostics).toHaveLength(1);

    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("XESSA1001");
    expect(diagnostic?.message).toContain("flattening limit");
    expect(diagnostic?.message).toContain("nesting depth 1000");
    expect(diagnostic?.span.start).toBeGreaterThanOrEqual(0);
    expect(validSpan(diagnostic?.span.start ?? -1, diagnostic?.span.end ?? -1, source.length)).toBe(
      true,
    );
    // The offending rule is dropped and compilation continues.
    expect((result.css ?? "").trim()).toBe("");
  });

  test("a selector product past the selector-count bound is rejected, not expanded", async () => {
    // 400 equal-specificity alternatives squared by `& &` = 160 000 selectors.
    const parent = Array.from({ length: 400 }, (_, index) => `.s${index}`).join(", ");
    const result = flattenSelector("& &", [parent]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("flattening limit");
    expect(result.reason).toContain(`${FLATTEN_LIMITS.maxSelectors} selectors`);
  });

  test("a selector exactly at the character bound still flattens", () => {
    const selector = `.${"a".repeat(FLATTEN_LIMITS.maxSelectorChars - 1)}`;
    const result = flattenSelector(selector, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selector).toHaveLength(FLATTEN_LIMITS.maxSelectorChars);
  });

  test("one character past the bound is rejected with the typed reason", () => {
    const selector = `.${"a".repeat(FLATTEN_LIMITS.maxSelectorChars)}`;
    const result = flattenSelector(selector, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("flattening limit");
    expect(result.reason).toContain(`${FLATTEN_LIMITS.maxSelectorChars} characters`);
  });

  test("large legal nesting below the bound is unchanged", async () => {
    // A long `&.m<n>` chain ending in a selector list, in the committed scale shape.
    const depth = 150;
    const list = Array.from({ length: 40 }, (_, index) => `&.s${index}`).join(", ");
    const lines: string[] = [".chain {"];
    for (let level = 0; level < depth; level += 1) lines.push(`  &.m${level} {`);
    lines.push(`    ${list} {`);
    lines.push("      color: red;");
    lines.push("    }");
    for (let level = 0; level <= depth; level += 1) lines.push("  }");
    const source = `${lines.join("\n")}\n`;

    const result = await compile(source, {
      file: "src/legal.cssx",
      workspaceRoot: await workspace(),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.css).toBeDefined();
    // One rule with 40 flattened alternatives survives intact.
    expect(result.css?.match(/\.chain\.m0/g)).toHaveLength(40);
  });
});
