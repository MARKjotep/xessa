import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { compileProject, createNodeHost } from "../../packages/compiler/src/index.ts";
import type { CompileResult, Diagnostic } from "../../packages/compiler/src/index.ts";

/**
 * Golden fixtures for reusable declaration groups (`@group.<name>`, ADR-0017,
 * SPECIFICATION.md §3.7, plan `.ai/plans/CSSX-PLAN-GROUPS.md` §8).
 *
 * Every case is compiled through {@link compileProject} with the fixture
 * directory as the project root: that is the real build path the CLI uses, it
 * resolves the fixture's own `@use` edges, and it surfaces the resolver's group
 * diagnostics (duplicate definitions) as well as the expansion diagnostics
 * (unknown/ambiguous groups, rejected `@runtime` defaults). The single-file
 * cases have no imports and are simply one-module projects. `compile()` is not
 * used here: its no-`@use` memory-host path keeps only parse diagnostics, so a
 * duplicate `@group` definition would not be observable (flagged to the lead
 * rather than worked around in the fixture).
 *
 * The chain is the full documented one: module graph → `expandGroupUseSites` →
 * `lower` → `substitute` → `renameClasses` → runtime emission → `groupRuns`
 * ("safe") → `flattenIr` → `emitCss` (pretty). Prefixes come from each fixture's
 * own `@setup`, and the fixtures leave them unset, so selectors stay as authored.
 *
 * `expected/css` is byte-exact emitted text; `expected/diagnostics.json`
 * follows the catalog format in `tests/fixtures/README.md` (code, severity,
 * `messageContains`, and a 1-based line/col position that must fall inside the
 * reported span). Every authored diagnostic must name the fixture's entry file:
 * expanded defaults keep their authored file, so a diagnostic never has to point
 * into a module for these cases.
 */

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const GROUPS = join(FIXTURES, "groups");

/** §8 single-file matrix: `input.cssx` → `expected/{css,diagnostics.json}`. */
const SINGLE_FILE_CASES = [
  "alias-group",
  "composed",
  "conditional-use-site",
  "duplicate-definition",
  "empty-group",
  "group-named-keyframes",
  "group-position",
  "important-default",
  "inline-variant-default",
  "nested-rule-in-definition",
  "no-override",
  "same-file",
  "two-use-sites",
  "unknown-group",
] as const;

/** §8 merged-build matrix: `entry.cssx` plus sibling `styles` modules. */
const MERGED_CASES = [
  "ambiguous-import",
  "cross-module-defining-tokens",
  "local-shadows-import",
  "runtime-ref",
  "style-import",
  "token-only",
  "transitive-visibility",
] as const;

interface ExpectedDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly messageContains: string;
  readonly span: { readonly line: number; readonly col: number };
}

interface Case {
  readonly name: string;
  readonly directory: string;
  /** Fixture entry file name: `input.cssx` or `entry.cssx`. */
  readonly entry: string;
  readonly source: string;
  readonly expectedCss: string;
  readonly expectedDiagnostics: readonly ExpectedDiagnostic[];
}

function readCase(name: string): Case {
  const directory = join(GROUPS, name);
  const entry = existsSync(join(directory, "input.cssx")) ? "input.cssx" : "entry.cssx";
  const raw = JSON.parse(readFileSync(join(directory, "expected", "diagnostics.json"), "utf8")) as
    | readonly ExpectedDiagnostic[]
    | null;
  if (raw === null) throw new Error(`groups/${name} needs authored diagnostics.json`);
  return {
    name,
    directory,
    entry,
    source: readFileSync(join(directory, entry), "utf8"),
    expectedCss: readFileSync(join(directory, "expected", "css"), "utf8"),
    expectedDiagnostics: raw,
  };
}

const discovered = readdirSync(GROUPS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const cases: readonly Case[] = discovered.map(readCase);

async function compileCase(fixture: Case): Promise<CompileResult> {
  const results = await compileProject([fixture.entry], createNodeHost(fixture.directory), {
    projectRoot: fixture.directory,
  });
  const result = results[fixture.entry];
  if (result === undefined) throw new Error(`groups/${fixture.name} produced no entry result`);
  return result;
}

/** Offset of a 1-based line/column position in `source`. */
function offsetOf(source: string, line: number, column: number): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
    currentLine += 1;
  }
  return Math.min(offset + column - 1, source.length);
}

/** One-to-one multiset comparison using the catalog matching policy. */
function diagnosis(id: string, fixture: Case, actual: readonly Diagnostic[]): string[] {
  const problems: string[] = [];
  const used = new Set<number>();

  for (const expected of fixture.expectedDiagnostics) {
    const position = offsetOf(fixture.source, expected.span.line, expected.span.col);
    const index = actual.findIndex((diagnostic, candidate) => {
      if (used.has(candidate)) return false;
      if (diagnostic.code !== expected.code) return false;
      if (diagnostic.severity !== expected.severity) return false;
      if (!diagnostic.message.toLowerCase().includes(expected.messageContains.toLowerCase())) {
        return false;
      }
      const { start, end } = diagnostic.span;
      return position >= start && position <= end;
    });
    if (index === -1) {
      problems.push(
        `missing ${expected.code} "${expected.messageContains}" at ${expected.span.line}:${expected.span.col} (actual: ${actual
          .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
          .join(" | ")})`,
      );
      continue;
    }
    used.add(index);
    const file = actual[index]?.span.file;
    if (file === undefined || basename(file) !== fixture.entry) {
      problems.push(`${expected.code} reported in ${String(file)}, expected ${fixture.entry}`);
    }
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (used.has(index)) continue;
    problems.push(`unexpected ${actual[index]?.code} "${actual[index]?.message}"`);
  }

  if (problems.length === 0) return [];
  return problems.map((problem) => `${id}: ${problem}`);
}

describe("groups: golden fixture catalog (plan §8)", () => {
  test("discovers exactly the 14 single-file and 7 merged cases", () => {
    expect(discovered).toEqual([...SINGLE_FILE_CASES, ...MERGED_CASES].sort());
    expect(discovered).toHaveLength(21);
  });

  test("every case owns an entry source and both expected artifacts", () => {
    const single: readonly string[] = SINGLE_FILE_CASES;
    for (const fixture of cases) {
      // Single-file cases compile `input.cssx`; merged cases compile `entry.cssx`.
      expect({ name: fixture.name, entry: fixture.entry }).toEqual({
        name: fixture.name,
        entry: single.includes(fixture.name) ? "input.cssx" : "entry.cssx",
      });
      expect(existsSync(join(fixture.directory, "expected", "css"))).toBe(true);
      expect(existsSync(join(fixture.directory, "expected", "diagnostics.json"))).toBe(true);
    }
  });
});

describe("groups: expected/css is the emitted CSS byte for byte", () => {
  for (const fixture of cases) {
    test(fixture.name, async () => {
      const result = await compileCase(fixture);
      expect(diagnosis(fixture.name, fixture, result.diagnostics)).toEqual([]);
      expect({ name: fixture.name, css: result.css ?? "" }).toEqual({
        name: fixture.name,
        css: fixture.expectedCss,
      });
    });
  }
});

describe("groups: deterministic repeat builds", () => {
  test("every case emits identical CSS and diagnostics twice", async () => {
    for (const fixture of cases) {
      const first = await compileCase(fixture);
      const second = await compileCase(fixture);
      expect({ name: fixture.name, css: second.css ?? "" }).toEqual({
        name: fixture.name,
        css: first.css ?? "",
      });
      expect(second.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
        first.diagnostics.map((diagnostic) => diagnostic.message),
      );
    }
  });
});

describe("groups: ADR-0017 semantics the goldens pin", () => {
  test("same-file keeps every repeated property in authored order (no dedupe, no filter)", async () => {
    const fixture = cases.find((candidate) => candidate.name === "same-file");
    if (fixture === undefined) throw new Error("same-file fixture is missing");
    const result = await compileCase(fixture);
    const css = result.css ?? "";

    const order = [
      "padding:12px;",
      "border:1px solid #ddd;",
      "color:black;",
      "padding:20px;",
      "color:navy;",
    ].map((line) => css.indexOf(line));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(order.every((index) => index !== -1)).toBe(true);
  });

  test("two-use-sites expands independently and safe grouping keeps both runs inline", async () => {
    const fixture = cases.find((candidate) => candidate.name === "two-use-sites");
    if (fixture === undefined) throw new Error("two-use-sites fixture is missing");
    const css = (await compileCase(fixture)).css ?? "";

    // One merged `.status` block: the second use site sees the first rule's
    // override-free defaults, not a mutated group.
    expect(css.match(/^\.status\{/gm)).toHaveLength(1);
    expect(css.match(/font-size:12px;/g)).toHaveLength(2);
    expect(css.indexOf("border-radius:0;")).toBeGreaterThan(css.indexOf("border-radius:4px;"));
  });

  test("important-default keeps the group's !important ahead of the plain override", async () => {
    const fixture = cases.find((candidate) => candidate.name === "important-default");
    if (fixture === undefined) throw new Error("important-default fixture is missing");
    const css = (await compileCase(fixture)).css ?? "";
    expect(css.indexOf("display:flex !important;")).toBeGreaterThan(-1);
    expect(css.indexOf("display:flex !important;")).toBeLessThan(css.indexOf("display:block;"));
  });

  test("ambiguous-import names both defining modules in the message", async () => {
    const fixture = cases.find((candidate) => candidate.name === "ambiguous-import");
    if (fixture === undefined) throw new Error("ambiguous-import fixture is missing");
    const result = await compileCase(fixture);
    const message = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
    expect(message).toContain("a.cssx");
    expect(message).toContain("b.cssx");
    // Both definitions stay inert: neither module's declarations reach `.panel`.
    expect(result.css ?? "").not.toContain(".panel");
  });

  test("cross-module-defining-tokens never leaks the entry's same-named token", async () => {
    const fixture = cases.find((candidate) => candidate.name === "cross-module-defining-tokens");
    if (fixture === undefined) throw new Error("cross-module-defining-tokens fixture is missing");
    const result = await compileCase(fixture);
    const css = result.css ?? "";

    expect(result.diagnostics).toEqual([]);
    expect(css).toContain("padding:12px;");
    expect(css).not.toContain("40px");
    expect(css.indexOf("padding:12px;")).toBeLessThan(css.indexOf("padding:24px;"));
  });

  test("token-only omits the block, drops the emptied rule and emits no CSS", async () => {
    const fixture = cases.find((candidate) => candidate.name === "token-only");
    if (fixture === undefined) throw new Error("token-only fixture is missing");
    const result = await compileCase(fixture);

    expect(result.css ?? "").toBe("");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA2001"]);
  });

  test("runtime-ref keeps the runtime declaration and expands the rest of the group", async () => {
    const fixture = cases.find((candidate) => candidate.name === "runtime-ref");
    if (fixture === undefined) throw new Error("runtime-ref fixture is missing");
    const result = await compileCase(fixture);
    const css = result.css ?? "";

    expect(css).toContain("--gap:4px;");
    expect(css).toContain("padding:12px;");
    expect(css).toContain("color:navy;");
    expect(css).not.toContain("var(--gap)");
  });
});
