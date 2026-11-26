import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../packages/compiler/src/index.ts";
import type { StylesheetIr } from "../../packages/compiler/src/ir/types.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { generateClassMap, renameClasses } from "../../packages/compiler/src/naming/index.ts";
import type { ClassTable } from "../../packages/compiler/src/naming/types.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";

/**
 * JS class-map and declaration generation tests (SPECIFICATION.md §8,
 * ADR-0010, CSSX-A52), plus the map/d.ts goldens for
 * class-bearing fixtures.
 *
 * The pipeline here is `parse → lower → renameClasses → generateClassMap`.
 * Substitution is not needed because class selectors do not contain `$`
 * references. The map never imports its stylesheet; loading CSS is the
 * consumer's responsibility.
 */

const FIXTURES = join(import.meta.dir, "..", "fixtures");

function irFor(source: string, file = "input.cssx"): StylesheetIr {
  const parsed = parse(source, { file });
  return lower(parsed.ast, { file }).ir;
}

function tableFor(source: string, prefix = "ui"): ClassTable {
  return renameClasses(irFor(source), { prefix }).classes;
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

function jsNamedExports(js: string): string[] {
  return [...js.matchAll(/^export const (\S+) =/gm)].map((match) => match[1] ?? "");
}

function typeNamedExports(types: string): string[] {
  return [...types.matchAll(/^export declare const (\S+):/gm)].map((match) => match[1] ?? "");
}

/** Evaluate the generated ESM body and return its bindings keyed by identifier. */
function evaluate(js: string): Record<string, unknown> {
  const names = jsNamedExports(js);
  const body = js
    .replace(/^import .*;\n/m, "")
    .replace(/^export const /gm, "const ")
    .concat(`return { ${names.map((name) => `[${JSON.stringify(name)}]: ${name}`).join(", ")} };`);
  return new Function(body)() as Record<string, unknown>;
}

describe("mapgen: canonical shape", () => {
  test("canonical/button is one named const per class and a matching declaration", () => {
    const table = tableFor(
      readFileSync(join(FIXTURES, "canonical", "button", "input.cssx"), "utf8"),
      "ui",
    );
    const result = generateClassMap(table);

    expect(result.diagnostics).toEqual([]);
    expect(result.js).toBe(
      ['export const button = "ui-button";', 'export const icon = "ui-icon";', ""].join("\n"),
    );
    expect(result.types).toBe(
      [
        'export declare const button: "ui-button";',
        'export declare const icon: "ui-icon";',
        "",
      ].join("\n"),
    );
  });

  test("the map has no CSS side-effect import", () => {
    const table = tableFor(".card { color: red; }");
    const result = generateClassMap(table);
    expect(result.js).toBe('export const card = "ui-card";\n');
    expect(result.js).not.toContain(".css");
    expect(result.types).not.toContain(".css");
  });

  test("an empty table emits empty JS and declarations", () => {
    const result = generateClassMap({ entries: [] });
    expect(result.js).toBe("");
    expect(result.types).toBe("");
    expect(result.diagnostics).toEqual([]);
  });

  test("there is no default export or object literal in either artifact", () => {
    const result = generateClassMap(tableFor(".a-b { color: red; } .c { color: blue; }"));
    expect(result.js).not.toContain("export default");
    expect(result.js).not.toContain("{");
    expect(result.types).not.toContain("export default");
    expect(result.types).not.toContain("declare const map");
  });
});

describe("mapgen: identifiers and deterministic adjustments", () => {
  test("names split on hyphens and underscores and keep first-appearance order", () => {
    const result = generateClassMap(
      tableFor(
        ".card-header { color: red; } .panel_head { color: blue; } .z-last { color: green; }",
      ),
    );
    expect(jsNamedExports(result.js)).toEqual(["cardHeader", "panelHead", "zLast"]);
    expect(result.js).toBe(
      [
        'export const cardHeader = "ui-card-header";',
        'export const panelHead = "ui-panel_head";',
        'export const zLast = "ui-z-last";',
        "",
      ].join("\n"),
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("a camelCase collision keeps the first name and suffixes the rest", () => {
    const result = generateClassMap(tableFor(".foo-bar { color: red; } .fooBar { color: blue; }"));

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA4001");
    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.diagnostics[0]?.message).toContain('"fooBar_2"');
    expect(result.js).toBe(
      ['export const fooBar = "ui-foo-bar";', 'export const fooBar_2 = "ui-fooBar";', ""].join(
        "\n",
      ),
    );
    expect(typeNamedExports(result.types)).toEqual(jsNamedExports(result.js));
  });

  test("a suffix increments deterministically in first-authored order", () => {
    const result = generateClassMap(
      tableFor(".foo-bar { color: red; } .fooBar { color: blue; } .foo_bar { color: green; }"),
    );
    expect(jsNamedExports(result.js)).toEqual(["fooBar", "fooBar_2", "fooBar_3"]);
    expect(result.js).toContain('export const fooBar_3 = "ui-foo_bar";');
    expect(result.diagnostics).toHaveLength(2);
  });

  test("a class name with no identifier parts exports `_`", () => {
    const table: ClassTable = {
      entries: [
        {
          name: "-",
          emitted: "-",
          global: false,
          renamed: false,
          span: { start: 0, end: 0, file: "x.cssx" },
        },
      ],
    };
    const result = generateClassMap(table);
    expect(result.js).toBe('export const _ = "-";\n');
    expect(result.types).toBe('export declare const _: "-";\n');
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["XESSA4001"]);
  });

  test("reserved words, digit-leading names and invalid characters get valid bindings", () => {
    const source =
      ".default { color: red; } .delete { color: blue; } .button { color: green; } " +
      ".\\32 col { color: black; } .foo\\.bar { color: white; }";
    const result = generateClassMap(tableFor(source));

    expect(jsNamedExports(result.js)).toEqual([
      "_default",
      "_delete",
      "button",
      "_2col",
      "foo_bar",
    ]);
    expect(result.diagnostics).toHaveLength(4);
    expect(result.diagnostics.every((entry) => entry.code === "XESSA4001")).toBe(true);
    expect(result.diagnostics.every((entry) => entry.severity === "warning")).toBe(true);

    // Every emitted binding is a valid, unique JavaScript identifier.
    for (const name of jsNamedExports(result.js)) {
      expect({ name, valid: /^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u.test(name) }).toEqual({
        name,
        valid: true,
      });
    }
  });

  test("leading and trailing underscores survive the camelCase pass", () => {
    const result = generateClassMap(
      tableFor(".__proto__ { color: red; } ._private { color: blue; }"),
    );
    expect(jsNamedExports(result.js)).toEqual(["__proto__", "_private"]);
  });

  test("__proto__ is an ordinary binding and evaluates safely", () => {
    const result = generateClassMap(tableFor(".__proto__ { color: red; }"));

    expect(result.js).toBe('export const __proto__ = "ui-__proto__";\n');
    const bindings = evaluate(result.js);
    expect(Object.keys(bindings)).toEqual(["__proto__"]);
    expect(bindings.__proto__).toBe("ui-__proto__");
  });

  test("global classes are never exported", () => {
    const source = readFileSync(join(FIXTURES, "global", "escape", "input.cssx"), "utf8");
    const result = generateClassMap(renameClasses(irFor(source), { prefix: "ui" }).classes);

    expect(result.js).not.toContain("external-icon");
    expect(result.types).not.toContain("external-icon");
    expect(jsNamedExports(result.js)).toEqual(["icon", "card"]);
  });
});

describe("mapgen: declarations and determinism", () => {
  test("the declaration file mirrors the JS exports line for line", () => {
    const result = generateClassMap(
      tableFor(".card-header { color: red; } .icon { color: blue; } .default { color: green; }"),
    );

    expect(typeNamedExports(result.types)).toEqual(jsNamedExports(result.js));
    expect(result.types).not.toContain("any");
    expect(result.types).toContain('export declare const _default: "ui-default";');
    expect(result.types).toContain('export declare const cardHeader: "ui-card-header";');
  });

  test("output is byte-identical across runs", () => {
    const table = tableFor(
      ".a-b { color: red; } .a_b { color: blue; } .c { color: green; } .default { color: black; }",
    );
    const first = generateClassMap(table);
    const second = generateClassMap(table);

    expect(second.js).toBe(first.js);
    expect(second.types).toBe(first.types);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });
});

interface MapGolden {
  readonly group: string;
  readonly name: string;
  readonly diagnostics: readonly string[];
  /** This golden pins the opt-in declaration file as well as the JS map. */
  readonly types: boolean;
}

const MAP_GOLDENS: readonly MapGolden[] = [
  {
    group: "canonical",
    name: "button",
    diagnostics: [],
    types: true,
  },
  { group: "global", name: "escape", diagnostics: [], types: false },
  { group: "naming", name: "prefix", diagnostics: [], types: true },
  { group: "naming", name: "empty-prefix", diagnostics: [], types: false },
  {
    group: "naming",
    name: "camel-collision",
    diagnostics: ["XESSA4001"],
    types: false,
  },
  {
    group: "naming",
    name: "reserved-js-identifier",
    diagnostics: ["XESSA4001", "XESSA4001"],
    types: false,
  },
];

describe("mapgen: fixture goldens", () => {
  for (const golden of MAP_GOLDENS) {
    test(`${golden.group}/${golden.name} matches expected/map.js and its declarations`, () => {
      const directory = join(FIXTURES, golden.group, golden.name);
      const parsed = parse(readFileSync(join(directory, "input.cssx"), "utf8"), {
        file: `${golden.group}/${golden.name}/input.cssx`,
      });
      const ir = lower(parsed.ast, { file: `${golden.group}/${golden.name}/input.cssx` }).ir;
      const renamed = renameClasses(ir, { prefix: setupPrefix(parsed.ast) });
      const result = generateClassMap(renamed.classes);

      expect(result.diagnostics.map((entry) => entry.code)).toEqual(golden.diagnostics);
      expect(result.js).toBe(readFileSync(join(directory, "expected", "map.js"), "utf8"));
      if (golden.types) {
        expect(result.types).toBe(readFileSync(join(directory, "expected", "map.d.ts"), "utf8"));
      } else {
        expect(result.types).not.toBe("");
      }
    });
  }

  test("only declaration-bearing goldens ship expected/map.d.ts", () => {
    for (const golden of MAP_GOLDENS) {
      const declarations = existsSync(
        join(FIXTURES, golden.group, golden.name, "expected", "map.d.ts"),
      );
      expect({ id: `${golden.group}/${golden.name}`, declarations }).toEqual({
        id: `${golden.group}/${golden.name}`,
        declarations: golden.types,
      });
    }
  });
});
