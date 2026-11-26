import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compile,
  compileProject,
  createNodeHost,
  format,
} from "../../packages/compiler/src/index.ts";

/**
 * Minimal independent v3 decoder for the API wiring test: no shared encoder
 * code, just the base64 VLQ grammar from the source-map specification.
 */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface DecodedMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceIndex: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}

function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new Error(`invalid base64 VLQ character ${character}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

function decodeMappings(mappings: string): DecodedMapping[] {
  const decoded: DecodedMapping[] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  const lines = mappings.split(";");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || line.length === 0) continue;
    let generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue;
      const [deltaColumn, deltaSource, deltaSourceLine, deltaSourceColumn] = decodeVlq(segment);
      if (
        deltaColumn === undefined ||
        deltaSource === undefined ||
        deltaSourceLine === undefined ||
        deltaSourceColumn === undefined
      ) {
        throw new Error(`unexpected mapping segment ${segment}`);
      }
      generatedColumn += deltaColumn;
      source += deltaSource;
      sourceLine += deltaSourceLine;
      sourceColumn += deltaSourceColumn;
      decoded.push({
        generatedLine: lineIndex,
        generatedColumn,
        sourceIndex: source,
        sourceLine,
        sourceColumn,
      });
    }
  }
  return decoded;
}

/**
 * End-to-end integration for the public `compile`/`compileProject` API.
 *
 * The canonical fixture is compiled in a temporary workspace so the "never
 * writes" contract is observable: no generated directory may appear, and the
 * fixture directory keeps only its authored files. Expected CSS/JS/declarations
 * are read from the frozen fixture goldens, not regenerated here.
 */

const repoRoot = join(import.meta.dir, "..", "..");
const canonicalDirectory = join(repoRoot, "tests", "fixtures", "canonical", "button");
const canonicalEntry = "tests/fixtures/canonical/button/input.cssx";
const variablesEntry = "tests/fixtures/variables/basic/input.cssx";

function fixture(path: string): string {
  return readFileSync(join(canonicalDirectory, path), "utf8");
}

describe("compile() end-to-end", () => {
  test("canonical/button matches CSS, JS and declaration goldens without writing", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-compile-"));
    try {
      const fixtureDirectory = join(root, "fixture", "button");
      mkdirSync(fixtureDirectory, { recursive: true });
      copyFileSync(join(canonicalDirectory, "input.cssx"), join(fixtureDirectory, "input.cssx"));
      copyFileSync(join(canonicalDirectory, "theme.cssx"), join(fixtureDirectory, "theme.cssx"));

      const source = fixture("input.cssx");
      const result = await compile(source, {
        file: "fixture/button/input.cssx",
        workspaceRoot: root,
        // Declarations are opt-in (CSSX-A52); this test pins the golden `.d.ts`.
        mapTypes: true,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.css).toBe(fixture("expected/minified"));
      expect(result.css).toContain(".ui-button > .ui-icon");
      expect(result.css).toContain("@media (prefers-color-scheme: dark)");
      expect(result.js).toBe(fixture("expected/map.js"));
      expect(result.types).toBe(fixture("expected/map.d.ts"));
      expect(result.sourceMap).toBeUndefined();
      expect(result.dependencies).toEqual(["fixture/button/theme.cssx"]);

      expect(Object.getPrototypeOf(result.classes)).toBeNull();
      expect({ ...result.classes }).toEqual({ button: "ui-button", icon: "ui-icon" });
      expect(result.classes.button).toBe("ui-button");
      expect(result.classes.icon).toBe("ui-icon");

      expect(existsSync(join(root, "fixture", "generated"))).toBe(false);
      expect(readdirSync(fixtureDirectory).sort()).toEqual(["input.cssx", "theme.cssx"]);
      expect(readdirSync(root)).toEqual(["fixture"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an explicit API prefix overrides the file @setup prefix", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-prefix-"));
    try {
      const result = await compile('@setup { prefix: "ui"; } .x { color: red; }', {
        file: "virtual/x.cssx",
        workspaceRoot: root,
        prefix: "app",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.css).toContain(".app-x");
      expect(result.classes.x).toBe("app-x");
      expect(existsSync(join(root, "virtual"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a source without @use compiles from memory even when the file is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-memory-"));
    try {
      const result = await compile("@runtime { primary: red; } .x { color: $primary; }", {
        file: "virtual/memory.cssx",
        workspaceRoot: root,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.css).toContain(":root");
      expect(result.css).toContain("--primary:red");
      expect(result.css).toContain("var(--primary)");
      expect(existsSync(join(root, "virtual"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("map-types is opt-in and mirrors the named export bindings", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-map-types-"));
    try {
      const plain = await compile('@setup { prefix: "ui"; } .card-header { color: red; }', {
        file: "src/card.cssx",
        workspaceRoot: root,
      });
      expect(plain.diagnostics).toEqual([]);
      expect(plain.js).toBe('export const cardHeader = "ui-card-header";\n');
      expect(plain.types).toBeUndefined();

      const optedIn = await compile(
        '@setup { prefix: "ui"; map-types: true; } .card-header { color: red; }',
        { file: "src/card.cssx", workspaceRoot: root },
      );
      expect(optedIn.diagnostics).toEqual([]);
      expect(optedIn.types).toBe('export declare const cardHeader: "ui-card-header";\n');

      // The legacy alias still resolves to the same flag.
      const legacy = await compile(
        '@setup { prefix: "ui"; emit-types: true; } .card-header { color: red; }',
        { file: "src/card.cssx", workspaceRoot: root },
      );
      expect(legacy.types).toBe(optedIn.types);
      expect(existsSync(join(root, "src"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source-map: true emits a v3 map whose URL names the planned CSS basename", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-sourcemap-"));
    try {
      const source = [
        "@setup {",
        '  prefix: "ui";',
        "  source-map: true;",
        "}",
        ".button {",
        "  display: flex;",
        "  padding: 12px;",
        "}",
        "",
      ].join("\n");
      const result = await compile(source, {
        file: "src/button.cssx",
        workspaceRoot: root,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.css?.endsWith("/*# sourceMappingURL=button.css.map */\n")).toBe(true);
      expect(result.css).toContain(".ui-button{");
      expect(result.sourceMap).toBeDefined();

      const map = JSON.parse(result.sourceMap ?? "{}") as {
        version?: number;
        file?: string;
        sources?: string[];
        sourcesContent?: (string | null)[];
        mappings?: string;
      };
      expect(map.version).toBe(3);
      expect(map.file).toBe("button.css");
      expect(map.sources).toEqual(["src/button.cssx"]);
      expect(map.sourcesContent).toEqual([source]);
      expect(typeof map.mappings).toBe("string");
      expect((map.mappings ?? "").length).toBeGreaterThan(0);

      const mappings = decodeMappings(map.mappings ?? "");
      const selector = mappings.find(
        (mapping) => mapping.generatedLine === 0 && mapping.generatedColumn === 0,
      );
      expect(selector).toBeDefined();
      const displayLine = source.split("\n").indexOf("  display: flex;");
      expect(selector?.sourceIndex).toBe(0);
      expect(selector?.sourceLine).toBe(displayLine);
      expect(selector?.sourceColumn).toBe(2);

      // The class-map output remains unaffected by the source map.
      expect(result.classes.button).toBe("ui-button");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("maps stay off by default", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-nomap-"));
    try {
      const result = await compile(".x { color: red; }", {
        file: "src/x.cssx",
        workspaceRoot: root,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.sourceMap).toBeUndefined();
      expect(result.css?.includes("sourceMappingURL")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("format is exported from the public barrel", () => {
    expect(typeof format).toBe("function");
    const result = format(".x{color:red;}\n", "src/x.cssx");
    expect(result.diagnostics).toEqual([]);
    expect(result.formatted).toBe(".x {\n  color: red;\n}\n");
  });
});

describe("compileProject() end-to-end", () => {
  test("compileProject retains authored source for maps and workspace-relative sources", async () => {
    const root = mkdtempSync(join(tmpdir(), "xessa-project-map-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      const source = '@setup { prefix: "ui"; source-map: true; }\n.a { color: red; }\n';
      writeFileSync(join(root, "src", "a.cssx"), source);

      const results = await compileProject(["src/a.cssx"], createNodeHost(root), {
        projectRoot: root,
      });
      const result = results["src/a.cssx"];
      expect(result).toBeDefined();
      if (result === undefined) return;
      expect(result.diagnostics).toEqual([]);
      const map = JSON.parse(result.sourceMap ?? "{}") as {
        file?: string;
        sources?: string[];
        sourcesContent?: (string | null)[];
      };
      expect(map.file).toBe("a.css");
      expect(map.sources).toEqual(["src/a.cssx"]);
      expect(map.sourcesContent).toEqual([source]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two entries share one graph and return distinct results", async () => {
    const canonicalExpected = fixture("expected/minified");
    const entries = [canonicalEntry, variablesEntry];
    const results = await compileProject(entries, createNodeHost(repoRoot), {});

    expect(Object.keys(results)).toEqual(entries);
    const canonical = results[canonicalEntry];
    const variables = results[variablesEntry];
    expect(canonical).toBeDefined();
    expect(variables).toBeDefined();
    if (canonical === undefined || variables === undefined) return;

    expect(canonical.diagnostics).toEqual([]);
    expect(variables.diagnostics).toEqual([]);
    expect(canonical.css).toBe(canonicalExpected);
    expect(variables.css).toContain(".ui-card");
    expect(variables.css).not.toContain(".ui-button");
    expect(canonical.classes.button).toBe("ui-button");
    expect(variables.classes.card).toBe("ui-card");
    expect(canonical.dependencies).toEqual(["tests/fixtures/canonical/button/theme.cssx"]);

    expect(existsSync(join(repoRoot, "tests", "fixtures", "canonical", "generated"))).toBe(false);
    expect(existsSync(join(repoRoot, "tests", "fixtures", "variables", "basic", "input.css"))).toBe(
      false,
    );
    expect(
      existsSync(join(repoRoot, "tests", "fixtures", "variables", "basic", "input.map.js")),
    ).toBe(false);
  });
});
