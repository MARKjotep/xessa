import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { compileProject } from "../../packages/compiler/src/index.ts";
import { parse } from "../../packages/compiler/src/index.ts";
import { lower } from "../../packages/compiler/src/lowering/index.ts";
import { generateClassMap, renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { stylesheetImportSpecifier } from "../../packages/compiler/src/output/import-path.ts";
import type { ModuleHost } from "../../packages/compiler/src/types/options.ts";

/**
 * Opt-in CSS side-effect import in the generated class map (ADR-0021, F21).
 *
 * `@setup { import-css: true; }` / `output.importCss` (default `false`) emits
 * exactly one `import "<relative stylesheet>";` at the top of the map. The
 * default-off path must stay byte-identical to the CSSX-A52 map, and a build
 * that emits no stylesheet must never produce a dangling import.
 */

const WORKSPACE = "/workspace";

function createHost(files: Readonly<Record<string, string>>, root = WORKSPACE): ModuleHost {
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
      return root;
    },
  };
}

async function compileOne(
  source: string,
  file = "src/button.cssx",
  output?: { readonly importCss?: boolean },
): Promise<{
  readonly js: string | undefined;
  readonly types: string | undefined;
  readonly css: string | undefined;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}> {
  const host = createHost({ [`${WORKSPACE}/${file}`]: source });
  const results = await compileProject([file], host, {
    projectRoot: WORKSPACE,
    ...(output === undefined ? {} : { output }),
  });
  const result = results[file];
  if (result === undefined) throw new Error(`missing result for ${file}`);
  return result;
}

function tableFor(source: string) {
  const parsed = parse(source, { file: "input.cssx" });
  return renameClasses(lower(parsed.ast, { file: "input.cssx" }).ir, { prefix: "ui" }).classes;
}

describe("mapgen: opt-in stylesheet import", () => {
  test("cssImport prepends exactly one side-effect import", () => {
    const result = generateClassMap(tableFor(".button { color: red; }"), {
      cssImport: "./button.css",
    });
    expect(result.js).toBe('import "./button.css";\nexport const button = "ui-button";\n');
    expect(result.js.match(/^import /gm)).toHaveLength(1);
    // Declarations stay pure: no import line.
    expect(result.types).toBe('export declare const button: "ui-button";\n');
  });

  test("without cssImport the map is unchanged (default off)", () => {
    const result = generateClassMap(tableFor(".button { color: red; }"));
    expect(result.js).toBe('export const button = "ui-button";\n');
    expect(result.js).not.toContain(".css");
  });

  test("an empty table still imports the stylesheet when requested", () => {
    const result = generateClassMap({ entries: [] }, { cssImport: "./only-styles.css" });
    expect(result.js).toBe('import "./only-styles.css";\n');
    expect(result.types).toBe("");
  });
});

describe("stylesheetImportSpecifier", () => {
  test("same directory is ./ prefixed", () => {
    expect(
      stylesheetImportSpecifier("/workspace/src/button.map.js", "/workspace/src/button.css"),
    ).toBe("./button.css");
  });

  test("a sibling directory climbs with ..", () => {
    expect(
      stylesheetImportSpecifier("/workspace/maps/button.map.js", "/workspace/src/button.css"),
    ).toBe("../src/button.css");
  });

  test("a nested destination keeps POSIX separators", () => {
    expect(
      stylesheetImportSpecifier(
        "/workspace/src/button.map.js",
        "/workspace/src/generated/styles/app.css",
      ),
    ).toBe("./generated/styles/app.css");
  });

  test("a destination above the map directory climbs with ..", () => {
    expect(
      stylesheetImportSpecifier("/workspace/src/maps/app.map.js", "/workspace/src/styles/app.css"),
    ).toBe("../styles/app.css");
  });
});

describe("compileProject: import-css side-effect import", () => {
  test("same directory emits ./<css-name> at the top of the map", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; import-css: true; }\n.button { color: red; }\n',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.js).toBe('import "./button.css";\nexport const button = "ui-button";\n');
  });

  test("a different map-dir produces a ../ relative path", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; map-dir: "../maps"; import-css: true; }\n.button { color: red; }\n',
    );
    expect(result.js).toBe('import "../src/button.css";\nexport const button = "ui-button";\n');
  });

  test("a custom css-name is the imported artifact", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; css-name: "app.css"; import-css: true; }\n.button { color: red; }\n',
    );
    expect(result.js).toBe('import "./app.css";\nexport const button = "ui-button";\n');
  });

  test("a css-dir list imports the first listed destination", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; css-dir: "../client", "../src/generated"; import-css: true; }\n.button { color: red; }\n',
    );
    expect(result.js).toBe('import "../client/button.css";\nexport const button = "ui-button";\n');
    expect(result.css).toBe(".ui-button{color:red;}");
  });

  test("default off leaves the map byte-identical and adds no import", async () => {
    const result = await compileOne('@setup { prefix: "ui"; }\n.button { color: red; }\n');
    expect(result.js).toBe('export const button = "ui-button";\n');
    expect(result.js).not.toContain("import");
  });

  test("emit-css: false suppresses the import and keeps the map", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; import-css: true; emit-css: false; }\n.button { color: red; }\n',
    );
    expect(result.js).toBe('export const button = "ui-button";\n');
    expect(result.css).toBeUndefined();
  });

  test("module: true without a restored emit-css never emits a dangling import", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; module: true; import-css: true; emit-map: true; }\n.button { color: red; }\n',
    );
    expect(result.js).toBe('export const button = "ui-button";\n');
    expect(result.css).toBeUndefined();
  });

  test("declarations stay pure declarations", async () => {
    const result = await compileOne(
      '@setup { prefix: "ui"; import-css: true; map-types: true; }\n.button { color: red; }\n',
    );
    expect(result.types).toBe('export declare const button: "ui-button";\n');
    expect(result.types).not.toContain("import");
  });

  test("project output.importCss applies and a file value overrides it", async () => {
    const inherited = await compileOne(
      '@setup { prefix: "ui"; }\n.button { color: red; }\n',
      "src/button.cssx",
      { importCss: true },
    );
    expect(inherited.js).toBe('import "./button.css";\nexport const button = "ui-button";\n');

    const overridden = await compileOne(
      '@setup { prefix: "ui"; import-css: false; }\n.button { color: red; }\n',
      "src/button.cssx",
      { importCss: true },
    );
    expect(overridden.js).toBe('export const button = "ui-button";\n');
  });

  test("import-css expects a boolean", async () => {
    const result = await compileOne("@setup { import-css: maybe; }\n.button { color: red; }\n");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("XESSA1001");
    expect(result.diagnostics[0]?.message).toContain('"import-css" expects true or false');
  });
});
