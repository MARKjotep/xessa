import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { parse } from "../../packages/compiler/src/index.ts";
import type { StylesheetIr } from "../../packages/compiler/src/ir/index.ts";
import { tokenize } from "../../packages/compiler/src/lexer/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { flattenIr } from "../../packages/compiler/src/selectors/index.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";

/**
 * CSS source maps (standard v3) plus the maps-off golden guarantee.
 *
 * Mappings are decoded with a deliberately small in-test VLQ decoder so the
 * assertions do not share code with the encoder under test. Granularity is
 * declaration-level: one mapping per emitted rule selector (taken from the
 * run's origin span) and one per declaration property.
 */

const fixturesRoot = join(import.meta.dir, "..", "fixtures");
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface DecodedMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceIndex: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}

interface DecodedMap {
  readonly version: number;
  readonly file?: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly mappings: string;
  readonly names?: unknown;
}

/** Decode one base64 VLQ segment into its signed integer components. */
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

/** Decode a complete v3 `mappings` string into absolute positions. */
function decodeMappings(mappings: string): DecodedMapping[] {
  const decoded: DecodedMapping[] = [];
  const lines = mappings.split(";");
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || line.length === 0) continue;
    let generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue;
      const values = decodeVlq(segment);
      const [deltaColumn, deltaSource, deltaSourceLine, deltaSourceColumn] = values;
      if (
        deltaColumn === undefined ||
        deltaSource === undefined ||
        deltaSourceLine === undefined ||
        deltaSourceColumn === undefined
      ) {
        throw new Error(`unexpected mapping segment shape: ${segment}`);
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

/** One-based line/column of a UTF-16 offset (independent of compiler helpers). */
function positionAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charAt(index) === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function zeroBasedAt(text: string, needle: string, from = 0): { line: number; column: number } {
  const index = text.indexOf(needle, from);
  if (index < 0) throw new Error(`missing ${JSON.stringify(needle)}`);
  const position = positionAt(text, index);
  return { line: position.line - 1, column: position.column - 1 };
}

function compileIr(source: string, file: string, prefix = "ui"): StylesheetIr {
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  const lowered = lower(parsed.ast, { file });
  expect(lowered.diagnostics).toEqual([]);
  const renamed = renameClasses(lowered.ir, { prefix });
  const grouped = groupRuns(renamed.ir, "safe");
  return flattenIr(grouped).ir;
}

const CANONICAL_FILE = "src/button.cssx";
const CANONICAL_SOURCE = `.button {
  display: flex;
  padding: 12px @md 20px;
}
`;

function canonicalIr(): StylesheetIr {
  return compileIr(CANONICAL_SOURCE, CANONICAL_FILE);
}

function emitMap(
  ir: StylesheetIr,
  minify: boolean,
  file = "button.css",
  source = CANONICAL_SOURCE,
): { css: string; map: DecodedMap } {
  const result = emitCss(ir, {
    minify,
    sourceMap: {
      file,
      sourceText: (candidate) => (candidate === CANONICAL_FILE ? source : undefined),
    },
  });
  expect(result.map).toBeDefined();
  return { css: result.css, map: JSON.parse(result.map ?? "{}") as DecodedMap };
}

function mappingAt(
  mappings: readonly DecodedMapping[],
  generated: { line: number; column: number },
): DecodedMapping {
  const found = mappings.find(
    (mapping) =>
      mapping.generatedLine === generated.line && mapping.generatedColumn === generated.column,
  );
  if (found === undefined) {
    throw new Error(`no mapping at generated ${generated.line}:${generated.column}`);
  }
  return found;
}

describe("source map v3 generation", () => {
  test("pretty output maps selectors and declarations to authored lines", () => {
    const { css, map } = emitMap(canonicalIr(), false);
    const mappings = decodeMappings(map.mappings);

    expect(map.version).toBe(3);
    expect(map.file).toBe("button.css");
    expect(map.sources).toEqual([CANONICAL_FILE]);
    expect(map.names).toBeUndefined();
    expect(css.endsWith("/*# sourceMappingURL=button.css.map */\n")).toBe(true);
    expect(css).not.toContain("\u0000");

    // Selector origin is the run's span, which lowering sets to its first
    // declaration segment (the IR carries no separate selector span).
    const display = zeroBasedAt(CANONICAL_SOURCE, "display");
    const selector = mappingAt(mappings, zeroBasedAt(css, ".ui-button"));
    expect({ line: selector.sourceLine, column: selector.sourceColumn }).toEqual(display);
    expect(selector.sourceIndex).toBe(0);

    const displayMapping = mappingAt(mappings, zeroBasedAt(css, "display"));
    expect({ line: displayMapping.sourceLine, column: displayMapping.sourceColumn }).toEqual(
      display,
    );

    // Base padding declaration maps to the authored `padding` property.
    const padding = zeroBasedAt(canonicalIrSource(), "padding");
    const paddingMapping = mappingAt(mappings, zeroBasedAt(css, "padding"));
    expect({ line: paddingMapping.sourceLine, column: paddingMapping.sourceColumn }).toEqual(
      padding,
    );

    // The md variant maps to its modifier origin (variant segment span start).
    const variant = zeroBasedAt(canonicalIrSource(), "@md");
    const variantMapping = mappingAt(mappings, zeroBasedAt(css, "padding: 20px"));
    expect({
      line: variantMapping.sourceLine,
      column: variantMapping.sourceColumn,
    }).toEqual(variant);
    expect(variantMapping.generatedLine).toBeGreaterThan(selector.generatedLine);
  });

  test("minified output repositions mappings to real compact columns", () => {
    const { css, map } = emitMap(canonicalIr(), true);
    const mappings = decodeMappings(map.mappings);

    expect(css.startsWith(".ui-button{display:flex;padding:12px;}")).toBe(true);
    expect(css.endsWith("/*# sourceMappingURL=button.css.map */\n")).toBe(true);

    const selector = mappingAt(mappings, zeroBasedAt(css, ".ui-button"));
    expect(selector.generatedLine).toBe(0);
    expect(selector.generatedColumn).toBe(0);
    expect(selector.sourceLine).toBe(zeroBasedAt(CANONICAL_SOURCE, "display").line);

    const firstPadding = mappingAt(mappings, zeroBasedAt(css, "padding"));
    expect(firstPadding.generatedLine).toBe(0);
    expect(firstPadding.generatedColumn).toBe(css.indexOf("padding"));
    expect(firstPadding.sourceLine).toBe(zeroBasedAt(CANONICAL_SOURCE, "padding").line);

    const mediaSelector = mappingAt(
      mappings,
      zeroBasedAt(css, ".ui-button", css.indexOf("@media")),
    );
    expect(mediaSelector.sourceColumn).toBe(zeroBasedAt(CANONICAL_SOURCE, "@md").column);
  });

  test("the URL comment follows the planned CSS basename, not the map path", () => {
    const { css } = emitMap(canonicalIr(), false, "theme.css");
    expect(css).toContain("/*# sourceMappingURL=theme.css.map */\n");
  });

  test("sourcePath projects span paths into the map sources", () => {
    const result = emitCss(canonicalIr(), {
      minify: false,
      sourceMap: {
        file: "button.css",
        sourceText: () => CANONICAL_SOURCE,
        sourcePath: (file) => `project/${file}`,
      },
    });
    const map = JSON.parse(result.map ?? "{}") as DecodedMap;
    expect(map.sources).toEqual(["project/src/button.cssx"]);
  });

  test("sourcesContent is opt-in and mirrors the authored text", () => {
    const result = emitCss(canonicalIr(), {
      minify: false,
      sourceMap: {
        file: "button.css",
        sourceText: () => CANONICAL_SOURCE,
        includeSourcesContent: true,
      },
    });
    const map = JSON.parse(result.map ?? "{}") as DecodedMap;
    expect(map.sourcesContent).toEqual([CANONICAL_SOURCE]);

    const plain = emitMap(canonicalIr(), false);
    expect(plain.map.sourcesContent).toBeUndefined();
  });

  test("a span whose source text is unavailable is skipped, never guessed", () => {
    const result = emitCss(canonicalIr(), {
      minify: false,
      sourceMap: { file: "button.css", sourceText: () => undefined },
    });
    const map = JSON.parse(result.map ?? "{}") as DecodedMap;
    expect(map.sources).toEqual([]);
    expect(map.mappings).toBe("");
    expect(result.css).toContain("/*# sourceMappingURL=button.css.map */\n");
  });
});

function canonicalIrSource(): string {
  return CANONICAL_SOURCE;
}

/** Collect fixture directories that contain an `input.cssx`, like the golden runner. */
function collectFixtures(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (existsSync(join(path, "input.cssx"))) {
      found.push(path);
      continue;
    }
    found.push(...collectFixtures(path));
  }
  return found;
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

interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly deferred: boolean;
  readonly expected: string;
}

const fixtures: readonly FixtureCase[] = collectFixtures(fixturesRoot)
  .sort()
  .map((directory) => {
    const id = relative(fixturesRoot, directory).split(sep).join("/");
    const source = readFileSync(join(directory, "input.cssx"), "utf8");
    const expected = readFileSync(join(directory, "expected", "css"), "utf8");
    const deferred = tokenize(source, `${id}/input.cssx`).tokens.some(
      (token) => token.kind === "dollar-ref",
    );
    return { id, source, deferred, expected };
  });

function fixtureIr(fixture: FixtureCase): StylesheetIr {
  const file = `${fixture.id}/input.cssx`;
  const parsed = parse(fixture.source, { file });
  const lowered = lower(parsed.ast, { file });
  const renamed = renameClasses(lowered.ir, { prefix: setupPrefix(parsed.ast) });
  const grouped = groupRuns(renamed.ir, "safe");
  return flattenIr(grouped).ir;
}

describe("maps-off golden stability", () => {
  test("the 54 golden CSS files are unchanged with source maps off", () => {
    expect(fixtures).toHaveLength(67);
    const sentinel = "/* no css: see expected/diagnostics.json */";
    // `@group.<name>` fixtures are asserted by groups.golden.test.ts through the
    // expansion pre-pass, which this chain does not run (ADR-0017, plan G4a).
    const preGroup = fixtures.filter((fixture) => !fixture.id.startsWith("groups/"));
    expect(preGroup).toHaveLength(54);
    let checked = 0;

    for (const fixture of preGroup) {
      if (fixture.deferred) continue;
      const css = emitCss(fixtureIr(fixture), { minify: false }).css;
      if (fixture.expected.startsWith(sentinel)) {
        expect({ id: fixture.id, css }).toEqual({ id: fixture.id, css: "" });
      } else {
        expect({ id: fixture.id, css }).toEqual({ id: fixture.id, css: fixture.expected });
      }
      checked += 1;
    }
    // 39 plain fixtures; the 15 dollar-ref fixtures are deferred to A08.
    expect(checked).toBe(39);
  });

  test("enabling maps appends only the URL comment and never reshapes CSS", () => {
    for (const fixture of fixtures) {
      const ir = fixtureIr(fixture);
      const file = `${fixture.id}/input.cssx`;
      for (const minify of [false, true]) {
        const plain = emitCss(ir, { minify }).css;
        const mapped = emitCss(ir, {
          minify,
          sourceMap: {
            file: "out.css",
            sourceText: (candidate) => (candidate === file ? fixture.source : undefined),
          },
        }).css;
        const suffix = `${plain.length === 0 || plain.endsWith("\n") ? "" : "\n"}/*# sourceMappingURL=out.css.map */\n`;
        expect({ id: fixture.id, minify, css: mapped }).toEqual({
          id: fixture.id,
          minify,
          css: `${plain}${suffix}`,
        });
      }
    }
  });
});
