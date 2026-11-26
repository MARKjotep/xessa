import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compileProject, createNodeHost } from "../../packages/compiler/src/index.ts";

/**
 * Rule-merge golden fixtures (ADR-0014).
 *
 * Every `tests/fixtures/modules/merge/<name>/` directory authors `entry.cssx`
 * plus one or more style-imported modules and pins the merged build:
 *
 * - `expected/css` — imported modules first (depth-first `@use` order), then the
 *   entry's rules; each module's classes keep that module's own `@setup` prefix.
 * - `expected/map.js` — ONE merged ESM map for the importing build, covering
 *   every module plus the entry.
 *
 * The fixtures intentionally use `entry.cssx` (not `input.cssx`) because the
 * single-file golden runner compiles `input.cssx` without a module graph; a
 * merged build needs the whole fixture directory as its module host root.
 *
 * Comments in the fixtures are absent by design: goldens are byte-exact output,
 * and `@setup` blocks are part of the authored source, not of the CSS.
 */

const FIXTURES = join(import.meta.dir, "..", "fixtures", "modules", "merge");

interface MergeCase {
  readonly name: string;
  /** Expected diagnostic codes from the merged compile, in reported order. */
  readonly diagnostics: readonly string[];
}

const CASES: readonly MergeCase[] = [
  { name: "basic", diagnostics: [] },
  { name: "prefix-independence", diagnostics: [] },
  { name: "collision", diagnostics: ["XESSA4001"] },
  { name: "tokens-plus-rules", diagnostics: [] },
  { name: "cycle", diagnostics: ["XESSA2001"] },
  { name: "module-flag", diagnostics: [] },
  { name: "chain", diagnostics: [] },
];

async function compileEntry(name: string) {
  const directory = join(FIXTURES, name);
  const results = await compileProject(["entry.cssx"], createNodeHost(directory), {
    projectRoot: directory,
  });
  const entry = results["entry.cssx"];
  if (entry === undefined) throw new Error(`fixture ${name} produced no entry result`);
  return entry;
}

describe("modules: rule-merge goldens", () => {
  test("the fixture group has exactly the seven documented cases", () => {
    const directories = readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(CASES.map((golden) => golden.name).sort());
    for (const golden of CASES) {
      expect(existsSync(join(FIXTURES, golden.name, "entry.cssx"))).toBe(true);
      expect(existsSync(join(FIXTURES, golden.name, "expected", "css"))).toBe(true);
      expect(existsSync(join(FIXTURES, golden.name, "expected", "map.js"))).toBe(true);
    }
  });

  for (const golden of CASES) {
    test(`merge/${golden.name} matches expected/css and expected/map.js`, async () => {
      const entry = await compileEntry(golden.name);
      const directory = join(FIXTURES, golden.name);
      const css = readFileSync(join(directory, "expected", "css"), "utf8");
      const map = readFileSync(join(directory, "expected", "map.js"), "utf8");

      expect(entry.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(golden.diagnostics);
      expect(entry.css).toBe(css);
      expect(entry.js).toBe(map);
    });
  }

  test("goldens are byte-identical across repeated runs", async () => {
    for (const golden of CASES) {
      const first = await compileEntry(golden.name);
      const second = await compileEntry(golden.name);
      expect({ name: golden.name, css: second.css }).toEqual({
        name: golden.name,
        css: first.css,
      });
      expect({ name: golden.name, js: second.js }).toEqual({ name: golden.name, js: first.js });
    }
  });

  test("imported rules precede the entry's rules", async () => {
    const order = [
      { name: "basic", imported: ".card-card", local: ".app-page" },
      { name: "prefix-independence", imported: ".ui-panel", local: ".admin-page" },
      { name: "chain", imported: ".c-charlie", local: ".app-root" },
    ];
    for (const item of order) {
      const entry = await compileEntry(item.name);
      const css = entry.css ?? "";
      expect({ name: item.name, first: css.indexOf(item.imported) }).toEqual({
        name: item.name,
        first: 0,
      });
      expect({ name: item.name, local: css.indexOf(item.local) > 0 }).toEqual({
        name: item.name,
        local: true,
      });
    }
  });
});
