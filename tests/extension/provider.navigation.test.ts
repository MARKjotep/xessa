/**
 * Definition, references and rename tests for the pure navigation layer.
 *
 * Rename must use parser spans: strings, comments, selectors (including
 * `:global(...)` classes) and import paths are never rewritten, and namespace
 * members are refused with guidance instead of a partial cross-file edit.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalyzeOptions,
  type AnalyzeResult,
  type DocumentState,
  type Range,
  type SourceText,
  analyzeDocument,
  positionAt,
  tokenNameConflict,
} from "../../packages/vscode/src/analysis.ts";
import { groupHints } from "../../packages/vscode/src/group-hints.ts";
import {
  classAt,
  collectIdOccurrences,
  collectIdSelectors,
  completionsAt,
  contextAt,
  definitionsAt,
  groupDefinitionAt,
  idAt,
  keyframeAt,
  referencesAt,
  referencesToGroup,
  referencesToKeyframe,
  referencesToToken,
  renameAt,
  tokenAt,
  tokenDefinitionAt,
} from "../../packages/vscode/src/intelligence.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CANONICAL = "tests/fixtures/canonical/button/input.cssx";

function readModule(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function analyze(
  text: string,
  path = "rename.cssx",
  options: AnalyzeOptions = {},
): Promise<{ state: DocumentState; text: string }> {
  const source: SourceText = { text, path: join(ROOT, path), version: 1 };
  return {
    state: await analyzeDocument(source, { workspaceRoot: ROOT, readModule, ...options }),
    text,
  };
}

function offsetAt(analysis: AnalyzeResult, position: { line: number; character: number }): number {
  return (analysis.lineStarts[position.line] ?? 0) + position.character;
}

function rangeToOffsets(analysis: AnalyzeResult, range: Range): { start: number; end: number } {
  return { start: offsetAt(analysis, range.start), end: offsetAt(analysis, range.end) };
}

const TOKEN_DOCUMENT = [
  '@setup { prefix: "ui"; }',
  "@variables { gap: 8px; }",
  ".card {",
  '  content: "$gap";',
  "  padding: $gap;",
  "  &:global(.gap) { margin: $gap; }",
  '  background: url("$gap.png");',
  "}",
].join("\n");

describe("definition and references", () => {
  test("local tokens jump to their @variables declaration", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const offset = TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: $".length;
    const targets = definitionsAt(TOKEN_DOCUMENT, offset, { analysis: state.analysis });
    expect(targets).toHaveLength(1);
    const declarationOffset = TOKEN_DOCUMENT.indexOf("@variables { gap") + "@variables { ".length;
    const target = targets[0];
    if (target === undefined) throw new Error("expected a definition target");
    expect(rangeToOffsets(state.analysis, target.range)).toEqual({
      start: declarationOffset,
      end: declarationOffset + "$gap".length - 1,
    });
  });

  test("namespace members jump into the imported module", async () => {
    const text = readFileSync(join(ROOT, CANONICAL), "utf8");
    const { state } = await analyze(text, CANONICAL);
    const offset = text.indexOf("$theme.primary") + 1;
    const targets = definitionsAt(text, offset, { analysis: state.analysis });
    expect(targets[0]?.file.endsWith("theme.cssx")).toBe(true);
    expect(targets[0]?.name).toBe("primary");
  });

  test("references return the declaration and every value usage", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const offset = TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: $".length;
    const targets = referencesAt(TOKEN_DOCUMENT, offset, { analysis: state.analysis });
    expect(targets).toHaveLength(3);
    const offsets = targets.map((target) => rangeToOffsets(state.analysis, target.range).start);
    expect(new Set(offsets).size).toBe(3);
    expect(
      offsets.every(
        (start) =>
          TOKEN_DOCUMENT.startsWith("$gap", start) || TOKEN_DOCUMENT.startsWith("gap", start),
      ),
    ).toBe(true);
  });

  test("the cursor on a class or a string has no token target", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const classOffset = TOKEN_DOCUMENT.indexOf(".gap") + 1;
    expect(tokenAt(TOKEN_DOCUMENT, classOffset, state.analysis)).toBeUndefined();
    const stringOffset = TOKEN_DOCUMENT.indexOf('"$gap"') + 2;
    expect(tokenAt(TOKEN_DOCUMENT, stringOffset, state.analysis)).toBeUndefined();
  });
});

const REFERENCE_ROOT = "/virtual-xessa";
const REFERENCE_FILES: Readonly<Record<string, string>> = Object.freeze({
  [`${REFERENCE_ROOT}/refs-tokens.cssx`]: [
    "@variables {",
    "  brand: #2563eb;",
    "}",
    "@runtime {",
    "  surface: #ffffff;",
    "}",
  ].join("\n"),
  [`${REFERENCE_ROOT}/refs-alias.cssx`]: [
    '@use "./refs-tokens.cssx" as t;',
    ".alias {",
    "  color: $t.brand;",
    "  background: $t.surface;",
    "}",
  ].join("\n"),
  [`${REFERENCE_ROOT}/refs-plain.cssx`]: [
    '@use "./refs-tokens.cssx";',
    ".plain {",
    "  color: $brand;",
    "  background: $surface;",
    "}",
  ].join("\n"),
  [`${REFERENCE_ROOT}/refs-shadow.cssx`]: [
    '@use "./refs-tokens.cssx";',
    "@variables {",
    "  brand: #111111;",
    "}",
    ".shadow {",
    "  color: $brand;",
    "}",
  ].join("\n"),
  [`${REFERENCE_ROOT}/refs-other.cssx`]: "@variables { brand: #222222; }",
  [`${REFERENCE_ROOT}/refs-ambiguous.cssx`]: [
    '@use "./refs-tokens.cssx";',
    '@use "./refs-other.cssx";',
    ".clash {",
    "  color: $brand;",
    "}",
  ].join("\n"),
});

interface ReferenceAnalysis {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly analysis: AnalyzeResult;
}

function readReferenceModule(path: string): string | undefined {
  return REFERENCE_FILES[path];
}

async function referenceAnalyses(): Promise<readonly ReferenceAnalysis[]> {
  const files: ReferenceAnalysis[] = [];
  for (const [path, text] of Object.entries(REFERENCE_FILES)) {
    const source: SourceText = { text, path, version: 1 };
    const state = await analyzeDocument(source, {
      workspaceRoot: REFERENCE_ROOT,
      readModule: readReferenceModule,
      compile: false,
    });
    files.push({
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      text,
      analysis: state.analysis,
    });
  }
  return files;
}

function referenceOffset(text: string, needle: string, delta = 0): number {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`missing ${JSON.stringify(needle)}`);
  return index + delta;
}

function occurrenceShapes(
  occurrences: readonly { file: string; range: Range }[],
  analyses: readonly ReferenceAnalysis[],
): readonly { file: string; start: number; end: number }[] {
  const byPath = new Map(analyses.map((entry) => [entry.path, entry]));
  return occurrences
    .map((occurrence) => {
      const entry = byPath.get(occurrence.file);
      if (entry === undefined) throw new Error(`unknown occurrence file ${occurrence.file}`);
      const offsets = rangeToOffsets(entry.analysis, occurrence.range);
      return { file: entry.name, start: offsets.start, end: offsets.end };
    })
    .sort((left, right) =>
      left.file === right.file ? left.start - right.start : left.file.localeCompare(right.file),
    );
}

describe("reverse references", () => {
  test("a definition finds every resolving use across direct importers", async () => {
    const files = await referenceAnalyses();
    const tokens = files.find((entry) => entry.name === "refs-tokens.cssx");
    if (tokens === undefined) throw new Error("missing tokens analysis");
    const target = tokenDefinitionAt(
      tokens.text,
      referenceOffset(tokens.text, "brand:") + 2,
      tokens.analysis,
    );
    expect(target).toEqual({
      file: `${REFERENCE_ROOT}/refs-tokens.cssx`,
      name: "brand",
      kind: "compile",
    });
    if (target === undefined) throw new Error("expected a token definition");

    const occurrences = files.flatMap((entry) =>
      referencesToToken(entry.text, entry.analysis, target),
    );
    const alias = files.find((entry) => entry.name === "refs-alias.cssx");
    const plain = files.find((entry) => entry.name === "refs-plain.cssx");
    if (alias === undefined || plain === undefined) throw new Error("missing importer analysis");
    expect(occurrenceShapes(occurrences, files)).toEqual(
      [
        {
          file: "refs-tokens.cssx",
          start: referenceOffset(tokens.text, "brand:"),
          end: referenceOffset(tokens.text, "brand:") + "brand".length,
        },
        {
          file: "refs-alias.cssx",
          start: referenceOffset(alias.text, "$t.brand"),
          end: referenceOffset(alias.text, "$t.brand") + "$t.brand".length,
        },
        {
          file: "refs-plain.cssx",
          start: referenceOffset(plain.text, "$brand"),
          end: referenceOffset(plain.text, "$brand") + "$brand".length,
        },
      ].sort((left, right) =>
        left.file === right.file ? left.start - right.start : left.file.localeCompare(right.file),
      ),
    );
    expect(occurrences.some((occurrence) => occurrence.file.endsWith("refs-shadow.cssx"))).toBe(
      false,
    );
    expect(occurrences.some((occurrence) => occurrence.file.endsWith("refs-ambiguous.cssx"))).toBe(
      false,
    );
  });

  test("an importer resolves the same definition, including unqualified and runtime tokens", async () => {
    const files = await referenceAnalyses();
    const tokens = files.find((entry) => entry.name === "refs-tokens.cssx");
    const alias = files.find((entry) => entry.name === "refs-alias.cssx");
    const plain = files.find((entry) => entry.name === "refs-plain.cssx");
    const shadow = files.find((entry) => entry.name === "refs-shadow.cssx");
    const ambiguous = files.find((entry) => entry.name === "refs-ambiguous.cssx");
    if (
      tokens === undefined ||
      alias === undefined ||
      plain === undefined ||
      shadow === undefined ||
      ambiguous === undefined
    ) {
      throw new Error("missing reference analysis");
    }
    const brandTarget = tokenDefinitionAt(
      tokens.text,
      referenceOffset(tokens.text, "brand:") + 2,
      tokens.analysis,
    );
    if (brandTarget === undefined) throw new Error("expected brand definition");

    expect(
      tokenDefinitionAt(alias.text, referenceOffset(alias.text, "$t.brand") + 1, alias.analysis),
    ).toEqual(brandTarget);
    expect(
      tokenDefinitionAt(plain.text, referenceOffset(plain.text, "$brand") + 1, plain.analysis),
    ).toEqual(brandTarget);

    // A local definition shadows the unqualified import, so the same spelling
    // resolves to the shadowing module and never joins the imported set.
    const shadowTarget = tokenDefinitionAt(
      shadow.text,
      referenceOffset(shadow.text, "$brand") + 1,
      shadow.analysis,
    );
    expect(shadowTarget?.file).toBe(`${REFERENCE_ROOT}/refs-shadow.cssx`);
    expect(shadowTarget?.name).toBe("brand");

    // Two distinct unqualified providers are XESSA2001 and resolve to nothing.
    expect(
      tokenDefinitionAt(
        ambiguous.text,
        referenceOffset(ambiguous.text, "$brand") + 1,
        ambiguous.analysis,
      ),
    ).toBeUndefined();

    const surfaceTarget = tokenDefinitionAt(
      tokens.text,
      referenceOffset(tokens.text, "surface:") + 2,
      tokens.analysis,
    );
    if (surfaceTarget === undefined) throw new Error("expected surface definition");
    expect(surfaceTarget.kind).toBe("runtime");
    expect(
      tokenDefinitionAt(plain.text, referenceOffset(plain.text, "$surface") + 1, plain.analysis),
    ).toEqual(surfaceTarget);
    const surfaceOccurrences = files.flatMap((entry) =>
      referencesToToken(entry.text, entry.analysis, surfaceTarget),
    );
    expect(surfaceOccurrences).toHaveLength(3);
  });

  test("includeDeclaration false drops only the definition", async () => {
    const files = await referenceAnalyses();
    const tokens = files.find((entry) => entry.name === "refs-tokens.cssx");
    if (tokens === undefined) throw new Error("missing tokens analysis");
    const target = tokenDefinitionAt(
      tokens.text,
      referenceOffset(tokens.text, "brand:") + 2,
      tokens.analysis,
    );
    if (target === undefined) throw new Error("expected brand definition");
    const withoutDeclaration = files.flatMap((entry) =>
      referencesToToken(entry.text, entry.analysis, target, { includeDeclaration: false }),
    );
    expect(withoutDeclaration).toHaveLength(2);
    expect(
      withoutDeclaration.some(
        (occurrence) =>
          occurrence.file === target.file &&
          occurrence.range.start.line === 1 &&
          occurrence.range.start.character === 2,
      ),
    ).toBe(false);
  });
});

const GROUP_ROOT = "/virtual-xessa-groups";
const GROUP_FILES: Readonly<Record<string, string>> = Object.freeze({
  [`${GROUP_ROOT}/chrome.cssx`]: [
    "@group.card {",
    "  padding: 4px;",
    "}",
    ".chrome {",
    "  @group.card { padding: 6px; }",
    "}",
  ].join("\n"),
  [`${GROUP_ROOT}/entry.cssx`]: [
    '@use "./chrome.cssx" styles;',
    ".entry {",
    "  @group.card { padding: 8px; }",
    "}",
  ].join("\n"),
  [`${GROUP_ROOT}/shadow.cssx`]: [
    '@use "./chrome.cssx" styles;',
    "@group.card { padding: 99px; }",
    ".shadow { @group.card { padding: 1px; } }",
  ].join("\n"),
  [`${GROUP_ROOT}/other.cssx`]: "@group.card { padding: 88px; }",
  [`${GROUP_ROOT}/ambiguous.cssx`]: [
    '@use "./chrome.cssx" styles;',
    '@use "./other.cssx" styles;',
    ".clash { @group.card { padding: 2px; } }",
  ].join("\n"),
});

function readGroupModule(path: string): string | undefined {
  return GROUP_FILES[path];
}

async function groupAnalyses(): Promise<readonly ReferenceAnalysis[]> {
  const files: ReferenceAnalysis[] = [];
  for (const [path, text] of Object.entries(GROUP_FILES)) {
    const source: SourceText = { text, path, version: 1 };
    const state = await analyzeDocument(source, {
      workspaceRoot: GROUP_ROOT,
      readModule: readGroupModule,
      compile: false,
    });
    files.push({
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      text,
      analysis: state.analysis,
    });
  }
  return files;
}

function byFileThenOffset(
  left: { file: string; start: number },
  right: { file: string; start: number },
): number {
  return left.file === right.file ? left.start - right.start : left.file.localeCompare(right.file);
}

describe("group definition and references", () => {
  test("a local use site jumps to its own definition name", async () => {
    const text = ["@group.card { padding: 4px; }", ".local { @group.card { padding: 8px; } }"].join(
      "\n",
    );
    const { state } = await analyze(text);
    const targets = definitionsAt(text, groupNameOffset(text, "card", 10), {
      analysis: state.analysis,
    });
    expect(targets).toHaveLength(1);
    const target = targets[0];
    if (target === undefined) throw new Error("expected a local group definition");
    expect(target.name).toBe("card");
    const start = text.indexOf("@group.card") + "@group.".length;
    expect(rangeToOffsets(state.analysis, target.range)).toEqual({
      start,
      end: start + "card".length,
    });
  });

  test("a styles-imported use site jumps into the defining module", async () => {
    const files = await groupAnalyses();
    const chrome = files.find((entry) => entry.name === "chrome.cssx");
    const entry = files.find((entry) => entry.name === "entry.cssx");
    if (chrome === undefined || entry === undefined) throw new Error("missing group analysis");

    const targets = definitionsAt(entry.text, groupNameOffset(entry.text, "card"), {
      analysis: entry.analysis,
    });
    expect(targets).toHaveLength(1);
    const target = targets[0];
    if (target === undefined) throw new Error("expected an imported group definition");
    expect(target.file).toBe(`${GROUP_ROOT}/chrome.cssx`);
    expect(target.name).toBe("card");
    const start = chrome.text.indexOf("@group.card") + "@group.".length;
    expect(rangeToOffsets(chrome.analysis, target.range)).toEqual({
      start,
      end: start + "card".length,
    });

    // The definition header resolves to the same name bytes as the use site.
    expect(
      definitionsAt(chrome.text, groupNameOffset(chrome.text, "card"), {
        analysis: chrome.analysis,
      }),
    ).toEqual(targets);
  });

  test("the definition returns its declaration and every local/imported use site", async () => {
    const files = await groupAnalyses();
    const chrome = files.find((entry) => entry.name === "chrome.cssx");
    const entry = files.find((entry) => entry.name === "entry.cssx");
    if (chrome === undefined || entry === undefined) throw new Error("missing group analysis");
    const target = groupDefinitionAt(chrome.analysis, groupNameOffset(chrome.text, "card"));
    if (target === undefined) throw new Error("expected a group definition");

    const occurrences = files.flatMap((file) => referencesToGroup(file.analysis, target));
    const definitionStart = chrome.text.indexOf("@group.card") + "@group.".length;
    const localUseStart = chrome.text.lastIndexOf("@group.card") + "@group.".length;
    const importedUseStart = entry.text.indexOf("@group.card") + "@group.".length;
    expect(occurrenceShapes(occurrences, files)).toEqual(
      [
        {
          file: "chrome.cssx",
          start: definitionStart,
          end: definitionStart + "card".length,
        },
        {
          file: "chrome.cssx",
          start: localUseStart,
          end: localUseStart + "card".length,
        },
        {
          file: "entry.cssx",
          start: importedUseStart,
          end: importedUseStart + "card".length,
        },
      ].sort(byFileThenOffset),
    );
    expect(
      referencesAt(chrome.text, groupNameOffset(chrome.text, "card"), {
        analysis: chrome.analysis,
      }),
    ).toEqual(referencesToGroup(chrome.analysis, target));
  });

  test("a use site returns the same bidirectional set", async () => {
    const files = await groupAnalyses();
    const chrome = files.find((entry) => entry.name === "chrome.cssx");
    const entry = files.find((entry) => entry.name === "entry.cssx");
    if (chrome === undefined || entry === undefined) throw new Error("missing group analysis");
    const definitionTarget = groupDefinitionAt(
      chrome.analysis,
      groupNameOffset(chrome.text, "card"),
    );
    const useTarget = groupDefinitionAt(entry.analysis, groupNameOffset(entry.text, "card"));
    if (definitionTarget === undefined || useTarget === undefined) {
      throw new Error("expected the same group definition from both files");
    }
    expect(useTarget).toEqual(definitionTarget);

    const fromDefinition = files.flatMap((file) =>
      referencesToGroup(file.analysis, definitionTarget),
    );
    const fromUseSite = files.flatMap((file) => referencesToGroup(file.analysis, useTarget));
    expect(occurrenceShapes(fromUseSite, files)).toEqual(occurrenceShapes(fromDefinition, files));
    expect(fromUseSite).toHaveLength(3);
  });

  test("includeDeclaration false drops only the definition", async () => {
    const files = await groupAnalyses();
    const chrome = files.find((entry) => entry.name === "chrome.cssx");
    if (chrome === undefined) throw new Error("missing group analysis");
    const target = groupDefinitionAt(chrome.analysis, groupNameOffset(chrome.text, "card"));
    if (target === undefined) throw new Error("expected a group definition");

    const withoutDeclaration = files.flatMap((file) =>
      referencesToGroup(file.analysis, target, { includeDeclaration: false }),
    );
    expect(withoutDeclaration).toHaveLength(2);
    expect(
      withoutDeclaration.some(
        (occurrence) =>
          occurrence.file === target.file &&
          occurrence.range.start.line === 0 &&
          occurrence.range.start.character === "@group.".length,
      ),
    ).toBe(false);
  });

  test("shadowed and ambiguous groups contribute no references to the shadowed target", async () => {
    const files = await groupAnalyses();
    const chrome = files.find((entry) => entry.name === "chrome.cssx");
    const shadow = files.find((entry) => entry.name === "shadow.cssx");
    const ambiguous = files.find((entry) => entry.name === "ambiguous.cssx");
    if (chrome === undefined || shadow === undefined || ambiguous === undefined) {
      throw new Error("missing group analysis");
    }
    const target = groupDefinitionAt(chrome.analysis, groupNameOffset(chrome.text, "card"));
    if (target === undefined) throw new Error("expected a group definition");

    expect(referencesToGroup(shadow.analysis, target)).toEqual([]);
    expect(referencesToGroup(ambiguous.analysis, target)).toEqual([]);

    // The shadowing document resolves its use site to its own definition, and
    // the ambiguous document resolves to nothing (XESSA2001).
    const shadowUse = shadow.text.lastIndexOf("@group.card") + "@group.".length;
    const shadowTargets = definitionsAt(shadow.text, shadowUse + 1, {
      analysis: shadow.analysis,
    });
    expect(shadowTargets).toHaveLength(1);
    expect(shadowTargets[0]?.file).toBe(`${GROUP_ROOT}/shadow.cssx`);
    expect(
      definitionsAt(ambiguous.text, groupNameOffset(ambiguous.text, "card"), {
        analysis: ambiguous.analysis,
      }),
    ).toEqual([]);

    // An unknown group has no visible definition and no references either.
    const unknown = ".a { @group.nope { padding: 1px; } }";
    const { state: unknownState } = await analyze(unknown);
    expect(
      definitionsAt(unknown, groupNameOffset(unknown, "nope"), {
        analysis: unknownState.analysis,
      }),
    ).toEqual([]);
    expect(referencesToGroup(unknownState.analysis, target)).toEqual([]);
  });

  test("tokens inside a group body still resolve through the token path", async () => {
    const text = [
      "@variables { gap: 8px; }",
      "@group.card { padding: $gap; }",
      ".a { @group.card { margin: $gap; } }",
    ].join("\n");
    const { state } = await analyze(text);
    const offset = text.indexOf("padding: $gap") + "padding: $".length;
    const targets = definitionsAt(text, offset, { analysis: state.analysis });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe("gap");
    const declarationStart = text.indexOf("gap: 8px");
    expect(
      targets[0] === undefined ? undefined : rangeToOffsets(state.analysis, targets[0].range),
    ).toEqual({ start: declarationStart, end: declarationStart + "gap".length });
  });
});

const COMPOSITION_LOCAL = [
  "@group.base {",
  "  padding: 4px;",
  "  color: black;",
  "}",
  "@group.derived {",
  "  margin: 1px;",
  "  @group.base { padding: 8px; }",
  "  border: 1px solid red;",
  "}",
  ".use { @group.base { padding: 1px; } }",
  ".derived-use { @group.derived { color: red; } }",
].join("\n");

const COMPOSITION_SCOPE_ROOT = "/virtual-xessa-composition-scope";
const COMPOSITION_SCOPE_FILES: Readonly<Record<string, string>> = Object.freeze({
  [`${COMPOSITION_SCOPE_ROOT}/base.cssx`]: [
    "@group.token { padding: 1px; }",
    "@group.derived { @group.token { color: red; } }",
    "@group.shared { border: 1px solid black; }",
  ].join("\n"),
  [`${COMPOSITION_SCOPE_ROOT}/entry.cssx`]: [
    '@use "./base.cssx" styles;',
    "@group.token { padding: 99px; }",
    "@group.local-derived {",
    "  @group.shared { border-color: red; }",
    "}",
    ".a { @group.derived { margin: 0; } }",
    ".b { @group.shared { margin: 1px; } }",
  ].join("\n"),
});

/** Offset of the `@group.<name>` inside a definition body (composition site). */
function compositionOffset(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`missing composition ${JSON.stringify(needle)}`);
  return index + "@group.".length + 1;
}

describe("group composition navigation", () => {
  test("effective defaults follow base, nested overrides and own declarations in authored order", async () => {
    const { state } = await analyze(COMPOSITION_LOCAL);
    const derived = state.analysis.groups.find((entry) => entry.name === "derived");
    if (derived === undefined || derived.kind !== "resolved") {
      throw new Error("expected a resolved derived group");
    }
    expect(derived.symbol.defaults.map((entry) => `${entry.property}:${entry.value}`)).toEqual([
      "margin:1px",
      "padding:4px",
      "color:black",
      "padding:8px",
      "border:1px solid red",
    ]);
    // Direct declarations stay available and exclude the composition expansion.
    expect(derived.symbol.declarations.map((entry) => entry.property)).toEqual([
      "margin",
      "border",
    ]);
  });

  test("override ghosts of a composed group compare against the effective defaults", async () => {
    const { state } = await analyze(COMPOSITION_LOCAL);
    const hints = groupHints({
      text: COMPOSITION_LOCAL,
      ast: state.analysis.ast,
      lineStarts: state.analysis.lineStarts,
      groups: state.analysis.groups,
    });
    // `.derived-use` overrides `color`, which it inherits from the base through
    // the composition, so the ghost shows the effective base value. The nested
    // composition block inside the definition is not a use site and adds none.
    expect(hints.map((hint) => `${hint.property}:${hint.value}`)).toEqual([
      "padding:4px",
      "color:black",
    ]);
  });

  test("a composition site resolves to the base and is a reference of it", async () => {
    const { state } = await analyze(COMPOSITION_LOCAL);
    const base = groupDefinitionAt(state.analysis, groupNameOffset(COMPOSITION_LOCAL, "base"));
    if (base === undefined) throw new Error("expected the base definition");
    const composition = compositionOffset(COMPOSITION_LOCAL, "@group.base { padding");

    expect(groupDefinitionAt(state.analysis, composition)).toEqual(base);
    expect(definitionsAt(COMPOSITION_LOCAL, composition, { analysis: state.analysis })).toEqual([
      base,
    ]);

    const occurrences = referencesToGroup(state.analysis, base);
    const starts = occurrences
      .map((occurrence) => rangeToOffsets(state.analysis, occurrence.range).start)
      .sort((left, right) => left - right);
    const definitionStart = COMPOSITION_LOCAL.indexOf("@group.base") + "@group.".length;
    const useStart = COMPOSITION_LOCAL.lastIndexOf("@group.base") + "@group.".length;
    expect(starts).toEqual([definitionStart, composition - 1, useStart]);
    expect(referencesAt(COMPOSITION_LOCAL, composition, { analysis: state.analysis })).toEqual(
      occurrences,
    );
  });

  test("renaming the base edits the definition, the composition site and the use site", async () => {
    const { state } = await analyze(COMPOSITION_LOCAL);
    const composition = compositionOffset(COMPOSITION_LOCAL, "@group.base { padding");
    const plan = renameAt(COMPOSITION_LOCAL, composition, "spacing", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("base");
    const starts = plan.edits
      .map((edit) => rangeToOffsets(state.analysis, edit.range).start)
      .sort((left, right) => left - right);
    const definitionStart = COMPOSITION_LOCAL.indexOf("@group.base") + "@group.".length;
    const useStart = COMPOSITION_LOCAL.lastIndexOf("@group.base") + "@group.".length;
    expect(starts).toEqual([definitionStart, composition - 1, useStart]);
    expect(plan.edits.every((edit) => edit.newText === "spacing")).toBe(true);
  });

  test("a styles-imported base composes in its own module's scope, not the consumer's", async () => {
    const entryText = COMPOSITION_SCOPE_FILES[`${COMPOSITION_SCOPE_ROOT}/entry.cssx`];
    if (entryText === undefined) throw new Error("missing entry module");
    const source: SourceText = {
      text: entryText,
      path: `${COMPOSITION_SCOPE_ROOT}/entry.cssx`,
      version: 1,
    };
    const state = await analyzeDocument(source, {
      workspaceRoot: COMPOSITION_SCOPE_ROOT,
      readModule: (path) => COMPOSITION_SCOPE_FILES[path],
      compile: false,
    });
    const derived = state.analysis.groups.find((group) => group.name === "derived");
    if (derived === undefined || derived.kind !== "resolved") {
      throw new Error("expected the imported derived group");
    }
    // The consumer shadows `token`, but the composition resolves in base.cssx.
    expect(derived.symbol.defaults.map((value) => `${value.property}:${value.value}`)).toEqual([
      "padding:1px",
      "color:red",
    ]);
    const token = state.analysis.groups.find((group) => group.name === "token");
    expect(token?.kind === "resolved" ? token.symbol.file : undefined).toBe(
      `${COMPOSITION_SCOPE_ROOT}/entry.cssx`,
    );
  });

  test("a composition site in an importer references and renames the imported base", async () => {
    const entryPath = `${COMPOSITION_SCOPE_ROOT}/entry.cssx`;
    const basePath = `${COMPOSITION_SCOPE_ROOT}/base.cssx`;
    const entryText = COMPOSITION_SCOPE_FILES[entryPath];
    if (entryText === undefined) throw new Error("missing entry module");
    const state = await analyzeDocument(
      { text: entryText, path: entryPath, version: 1 },
      {
        workspaceRoot: COMPOSITION_SCOPE_ROOT,
        readModule: (path) => COMPOSITION_SCOPE_FILES[path],
        compile: false,
      },
    );
    const composition = entryText.indexOf("@group.shared { border-color") + "@group.".length + 1;
    const target = groupDefinitionAt(state.analysis, composition);
    if (target === undefined) throw new Error("expected the imported base definition");
    expect(target.file).toBe(basePath);

    const occurrences = referencesToGroup(state.analysis, target);
    // The declaration lives in base.cssx; this module authored the composition
    // site and the selector use site.
    expect(occurrences).toHaveLength(2);
    expect(occurrences.every((occurrence) => occurrence.file === entryPath)).toBe(true);

    const plan = renameAt(entryText, composition, "common", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toHaveLength(3);
    expect(plan.edits.filter((edit) => edit.file === basePath)).toHaveLength(1);
    expect(plan.edits.filter((edit) => edit.file === entryPath)).toHaveLength(2);
  });

  test("a nested @group in a use-site block stays a compiler error and offers no names", async () => {
    const text = [".a {", "  @group.card {", "    @group.", "  }", "}"].join("\n");
    const { state } = await analyze(text);
    expect(state.analysis.problems.some((problem) => problem.code === "XESSA1001")).toBe(true);
    const offset = text.lastIndexOf("@group.") + "@group.".length;
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "group-member", word: "" });
    expect(completionsAt(text, offset, { analysis: state.analysis }).items).toEqual([]);
  });
});

const KEYFRAME_ROOT = "/virtual-xessa-keyframes";
const KEYFRAME_FILES: Readonly<Record<string, string>> = Object.freeze({
  [`${KEYFRAME_ROOT}/motion.cssx`]: [
    "@keyframes spin {",
    "  from { opacity: 0; }",
    "  to { opacity: 1; }",
    "}",
    ".spinner { animation-name: spin; }",
    ".shorthand { animation: spin 1s linear infinite; }",
  ].join("\n"),
  [`${KEYFRAME_ROOT}/entry.cssx`]: [
    '@use "./motion.cssx" styles;',
    ".entry {",
    "  animation-name: $keyframes.spin;",
    "}",
    ".literal { animation-name: spin; }",
  ].join("\n"),
  [`${KEYFRAME_ROOT}/shadow.cssx`]: [
    '@use "./motion.cssx" styles;',
    "@keyframes spin { from { opacity: 0.5; } }",
    ".shadow { animation-name: $keyframes.spin; }",
  ].join("\n"),
  [`${KEYFRAME_ROOT}/other.cssx`]: "@keyframes spin { from { opacity: 0.25; } }",
  [`${KEYFRAME_ROOT}/ambiguous.cssx`]: [
    '@use "./motion.cssx" styles;',
    '@use "./other.cssx" styles;',
    ".clash { animation-name: $keyframes.spin; }",
    ".clash-literal { animation-name: spin; }",
  ].join("\n"),
  [`${KEYFRAME_ROOT}/token-only.cssx`]: [
    '@use "./motion.cssx";',
    ".plain { animation-name: $keyframes.spin; }",
  ].join("\n"),
});

function readKeyframeModule(path: string): string | undefined {
  return KEYFRAME_FILES[path];
}

async function keyframeAnalyses(): Promise<readonly ReferenceAnalysis[]> {
  const files: ReferenceAnalysis[] = [];
  for (const [path, text] of Object.entries(KEYFRAME_FILES)) {
    const source: SourceText = { text, path, version: 1 };
    const state = await analyzeDocument(source, {
      workspaceRoot: KEYFRAME_ROOT,
      readModule: readKeyframeModule,
      compile: false,
    });
    files.push({
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      text,
      analysis: state.analysis,
    });
  }
  return files;
}

describe("keyframe definition and references", () => {
  /** Offset of the name in an exact `animation-name: <name>` value. */
  function animationNameOffset(text: string, name: string, from = 0): number {
    const index = text.indexOf(`animation-name: ${name}`, from);
    if (index < 0) throw new Error(`missing animation-name: ${name}`);
    return index + "animation-name: ".length;
  }

  function keyframeShape(file: ReferenceAnalysis, needle: string, delta: number, length: number) {
    return {
      file: file.name,
      start: referenceOffset(file.text, needle, delta),
      end: referenceOffset(file.text, needle, delta) + length,
    };
  }

  test("the header, $keyframes reference and exact animation-name value share one target", async () => {
    const text = [
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
      "@keyframes fade { from { opacity: 0; } }",
      ".a { animation-name: $keyframes.spin; }",
      ".b { animation-name: spin; }",
      ".c { animation: spin 1s linear infinite; }",
      ".d { animation-name: spin, fade; }",
    ].join("\n");
    const { state } = await analyze(text);
    const declarationStart = keyframeDefinitionOffset(text, "spin");
    const expected = { file: join(ROOT, "rename.cssx"), name: "spin" };

    for (const offset of [
      keyframeDefinitionOffset(text, "spin"),
      keyframeReferenceOffset(text, "spin"),
      animationNameOffset(text, "spin"),
    ]) {
      const targets = definitionsAt(text, offset, { analysis: state.analysis });
      expect(targets).toHaveLength(1);
      expect(targets[0]?.name).toBe(expected.name);
      expect(targets[0]?.file).toBe(expected.file);
      expect(
        targets[0] === undefined ? undefined : rangeToOffsets(state.analysis, targets[0].range),
      ).toEqual({ start: declarationStart, end: declarationStart + "spin".length });
    }

    // The `animation` shorthand, comma lists and unknown names are not values.
    expect(
      definitionsAt(text, text.indexOf("animation: spin") + "animation: ".length, {
        analysis: state.analysis,
      }),
    ).toEqual([]);
    expect(
      definitionsAt(text, text.indexOf("animation-name: spin,") + "animation-name: ".length, {
        analysis: state.analysis,
      }),
    ).toEqual([]);
  });

  test("a styles-imported reference or value jumps into the defining module", async () => {
    const files = await keyframeAnalyses();
    const motion = files.find((entry) => entry.name === "motion.cssx");
    const entry = files.find((entry) => entry.name === "entry.cssx");
    if (motion === undefined || entry === undefined) throw new Error("missing keyframe analysis");

    const fromDefinition = definitionsAt(
      motion.text,
      keyframeDefinitionOffset(motion.text, "spin"),
      {
        analysis: motion.analysis,
      },
    );
    expect(fromDefinition).toHaveLength(1);
    const target = fromDefinition[0];
    if (target === undefined) throw new Error("expected a keyframe definition");
    expect(target.file).toBe(`${KEYFRAME_ROOT}/motion.cssx`);
    expect(target.name).toBe("spin");
    const start = motion.text.indexOf("@keyframes spin") + "@keyframes ".length;
    expect(rangeToOffsets(motion.analysis, target.range)).toEqual({
      start,
      end: start + "spin".length,
    });

    // Both the `$keyframes` reference and the exact animation-name value in the
    // importer resolve to the same definition bytes.
    for (const offset of [
      keyframeReferenceOffset(entry.text, "spin"),
      animationNameOffset(entry.text, "spin"),
    ]) {
      expect(definitionsAt(entry.text, offset, { analysis: entry.analysis })).toEqual(
        fromDefinition,
      );
    }
  });

  test("definition and use sites return the same declaration + $keyframes + animation-name set", async () => {
    const files = await keyframeAnalyses();
    const motion = files.find((entry) => entry.name === "motion.cssx");
    const entry = files.find((entry) => entry.name === "entry.cssx");
    if (motion === undefined || entry === undefined) throw new Error("missing keyframe analysis");
    const target = definitionsAt(motion.text, keyframeDefinitionOffset(motion.text, "spin"), {
      analysis: motion.analysis,
    })[0];
    if (target === undefined) throw new Error("expected a keyframe definition");

    const expected = [
      keyframeShape(motion, "@keyframes spin", "@keyframes ".length, "spin".length),
      keyframeShape(motion, "animation-name: spin", "animation-name: ".length, "spin".length),
      keyframeShape(entry, "$keyframes.spin", "$keyframes.".length, "spin".length),
      keyframeShape(entry, "animation-name: spin", "animation-name: ".length, "spin".length),
    ].sort(byFileThenOffset);

    const fromDefinition = files.flatMap((file) => referencesToKeyframe(file.analysis, target));
    expect(occurrenceShapes(fromDefinition, files)).toEqual(expected);

    // The `animation` shorthand is never a reference, so no occurrence starts
    // on its name bytes.
    const shorthandStart = referenceOffset(motion.text, "animation: spin", "animation: ".length);
    expect(
      fromDefinition.some(
        (occurrence) =>
          occurrence.file === `${KEYFRAME_ROOT}/motion.cssx` &&
          rangeToOffsets(motion.analysis, occurrence.range).start === shorthandStart,
      ),
    ).toBe(false);

    // A `$keyframes` use site and an animation-name value yield the same set.
    for (const offset of [
      keyframeReferenceOffset(entry.text, "spin"),
      animationNameOffset(entry.text, "spin"),
    ]) {
      const useTarget = definitionsAt(entry.text, offset, { analysis: entry.analysis })[0];
      if (useTarget === undefined) throw new Error("expected a use-site target");
      expect(useTarget).toEqual(target);
      const fromUse = files.flatMap((file) => referencesToKeyframe(file.analysis, useTarget));
      expect(occurrenceShapes(fromUse, files)).toEqual(expected);
    }

    // `referencesAt` mirrors the per-module resolver, like the group contract.
    expect(
      referencesAt(motion.text, keyframeDefinitionOffset(motion.text, "spin"), {
        analysis: motion.analysis,
      }),
    ).toEqual(referencesToKeyframe(motion.analysis, target));
  });

  test("includeDeclaration false drops only the definition", async () => {
    const files = await keyframeAnalyses();
    const motion = files.find((entry) => entry.name === "motion.cssx");
    if (motion === undefined) throw new Error("missing keyframe analysis");
    const target = definitionsAt(motion.text, keyframeDefinitionOffset(motion.text, "spin"), {
      analysis: motion.analysis,
    })[0];
    if (target === undefined) throw new Error("expected a keyframe definition");

    const withoutDeclaration = files.flatMap((file) =>
      referencesToKeyframe(file.analysis, target, { includeDeclaration: false }),
    );
    expect(withoutDeclaration).toHaveLength(3);
    expect(
      withoutDeclaration.some(
        (occurrence) =>
          occurrence.file === target.file &&
          occurrence.range.start.line === 0 &&
          occurrence.range.start.character === "@keyframes ".length,
      ),
    ).toBe(false);
  });

  test("unknown, ambiguous, token-only and later-duplicate definitions have no target", async () => {
    const unknown = [
      ".a { animation-name: $keyframes.nope; }",
      ".b { animation-name: nope; }",
    ].join("\n");
    const { state: unknownState } = await analyze(unknown);
    for (const offset of [
      keyframeReferenceOffset(unknown, "nope"),
      animationNameOffset(unknown, "nope"),
    ]) {
      expect(definitionsAt(unknown, offset, { analysis: unknownState.analysis })).toEqual([]);
      expect(referencesAt(unknown, offset, { analysis: unknownState.analysis })).toEqual([]);
    }

    const files = await keyframeAnalyses();
    const motion = files.find((entry) => entry.name === "motion.cssx");
    const ambiguous = files.find((entry) => entry.name === "ambiguous.cssx");
    const shadow = files.find((entry) => entry.name === "shadow.cssx");
    const tokenOnly = files.find((entry) => entry.name === "token-only.cssx");
    if (
      motion === undefined ||
      ambiguous === undefined ||
      shadow === undefined ||
      tokenOnly === undefined
    ) {
      throw new Error("missing keyframe analysis");
    }
    const target = definitionsAt(motion.text, keyframeDefinitionOffset(motion.text, "spin"), {
      analysis: motion.analysis,
    })[0];
    if (target === undefined) throw new Error("expected a keyframe definition");

    // Two styles imports of the same name: neither use site resolves.
    for (const offset of [
      keyframeReferenceOffset(ambiguous.text, "spin"),
      animationNameOffset(ambiguous.text, "spin"),
    ]) {
      expect(definitionsAt(ambiguous.text, offset, { analysis: ambiguous.analysis })).toEqual([]);
    }
    expect(referencesToKeyframe(ambiguous.analysis, target)).toEqual([]);

    // A local definition shadows the import; the importer's target is local.
    const shadowTargets = definitionsAt(shadow.text, keyframeReferenceOffset(shadow.text, "spin"), {
      analysis: shadow.analysis,
    });
    expect(shadowTargets).toHaveLength(1);
    expect(shadowTargets[0]?.file).toBe(`${KEYFRAME_ROOT}/shadow.cssx`);
    expect(referencesToKeyframe(shadow.analysis, target)).toEqual([]);

    // A token-only import exposes no keyframe names at all.
    expect(
      definitionsAt(tokenOnly.text, keyframeReferenceOffset(tokenOnly.text, "spin"), {
        analysis: tokenOnly.analysis,
      }),
    ).toEqual([]);
    expect(referencesToKeyframe(tokenOnly.analysis, target)).toEqual([]);

    // The first duplicate header wins; the later header is not addressable.
    const duplicate = [
      "@keyframes spin { from { opacity: 0; } }",
      "@keyframes spin { from { opacity: 1; } }",
      ".a { animation-name: $keyframes.spin; }",
      ".b { animation-name: spin; }",
    ].join("\n");
    const { state: duplicateState } = await analyze(duplicate);
    expect(
      definitionsAt(duplicate, keyframeDefinitionOffset(duplicate, "spin", 10), {
        analysis: duplicateState.analysis,
      }),
    ).toEqual([]);
    const first = definitionsAt(duplicate, keyframeDefinitionOffset(duplicate, "spin"), {
      analysis: duplicateState.analysis,
    });
    expect(first).toHaveLength(1);
    for (const offset of [
      keyframeReferenceOffset(duplicate, "spin"),
      animationNameOffset(duplicate, "spin"),
    ]) {
      expect(definitionsAt(duplicate, offset, { analysis: duplicateState.analysis })).toEqual(
        first,
      );
    }
  });

  test("token and group navigation still resolve in a document with keyframes", async () => {
    const text = [
      "@variables { gap: 8px; }",
      "@keyframes spin { from { opacity: 0; } }",
      "@group.card { padding: 8px; }",
      ".a { @group.card { padding: 4px; } animation-name: $keyframes.spin; color: $gap; }",
    ].join("\n");
    const { state } = await analyze(text);

    const token = definitionsAt(text, text.indexOf("$gap") + 1, { analysis: state.analysis });
    expect(token).toHaveLength(1);
    expect(token[0]?.name).toBe("gap");

    const group = definitionsAt(text, text.indexOf("@group.card") + "@group.".length, {
      analysis: state.analysis,
    });
    expect(group).toHaveLength(1);
    expect(group[0]?.name).toBe("card");

    const keyframe = definitionsAt(
      text,
      text.lastIndexOf("$keyframes.spin") + "$keyframes.".length,
      { analysis: state.analysis },
    );
    expect(keyframe).toHaveLength(1);
    expect(keyframe[0]?.name).toBe("spin");

    // The same three cursors keep their reference sets.
    expect(
      referencesAt(text, text.indexOf("$gap") + 1, { analysis: state.analysis }).length,
    ).toBeGreaterThan(0);
    expect(
      referencesAt(text, text.indexOf("@group.card") + "@group.".length, {
        analysis: state.analysis,
      }),
    ).toHaveLength(2);
    expect(
      referencesAt(text, text.lastIndexOf("$keyframes.spin") + "$keyframes.".length, {
        analysis: state.analysis,
      }),
    ).toHaveLength(2);
  });
});

describe("token rename", () => {
  test("renames the declaration and usages but never strings, urls or :global classes", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const offset = TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: $".length;
    const plan = renameAt(TOKEN_DOCUMENT, offset, "space", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const declarationOffset = TOKEN_DOCUMENT.indexOf("@variables { gap") + "@variables { ".length;
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
    }));
    expect(edits).toHaveLength(3);
    expect(edits.map((edit) => edit.newText)).toEqual(["space", "$space", "$space"]);
    expect(edits.map((edit) => edit.start).sort((left, right) => left - right)).toEqual(
      [
        declarationOffset,
        TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: ".length,
        TOKEN_DOCUMENT.indexOf("margin: $gap") + "margin: ".length,
      ].sort((left, right) => left - right),
    );

    // No edit overlaps the authored string, the url() content or the global class.
    const untouched = [
      { start: TOKEN_DOCUMENT.indexOf('"$gap"'), end: TOKEN_DOCUMENT.indexOf('"$gap"') + 7 },
      { start: TOKEN_DOCUMENT.indexOf("$gap.png"), end: TOKEN_DOCUMENT.indexOf("$gap.png") + 4 },
      { start: TOKEN_DOCUMENT.indexOf(".gap"), end: TOKEN_DOCUMENT.indexOf(".gap") + 4 },
    ];
    for (const edit of edits) {
      for (const range of untouched) {
        expect(edit.start >= range.end || edit.end <= range.start).toBe(true);
      }
    }
  });

  test("refuses cross-module member rename with guidance", async () => {
    const text = readFileSync(join(ROOT, CANONICAL), "utf8");
    const { state } = await analyze(text, CANONICAL);
    const plan = renameAt(text, text.indexOf("$theme.primary") + 1, "accent", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("Cross-module rename");
  });

  test("refuses class rename and invalid token names", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const classPlan = renameAt(TOKEN_DOCUMENT, TOKEN_DOCUMENT.indexOf(".gap") + 1, "other", {
      analysis: state.analysis,
    });
    expect(classPlan.ok).toBe(false);

    const offset = TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: $".length;
    const invalid = renameAt(TOKEN_DOCUMENT, offset, "1bad", { analysis: state.analysis });
    expect(invalid.ok).toBe(false);
  });

  test("runtime tokens rename their custom-property declaration and usages", async () => {
    const text = [
      '@setup { prefix: "ui"; }',
      "@runtime { primary: #2563eb; }",
      ".card { color: $primary; }",
    ].join("\n");
    const { state } = await analyze(text);
    const plan = renameAt(text, text.indexOf("color: $primary") + "color: $".length, "brand", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits.map((edit) => edit.newText)).toEqual(["brand", "$brand"]);
  });

  test("token rename stays single-file and leaves group edits untouched", async () => {
    const { state } = await analyze(TOKEN_DOCUMENT);
    const offset = TOKEN_DOCUMENT.indexOf("padding: $gap") + "padding: $".length;
    const plan = renameAt(TOKEN_DOCUMENT, offset, "space", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The existing contract: token edits carry no module and apply to the document.
    expect(plan.edits.every((edit) => edit.file === undefined)).toBe(true);
    expect(plan.edits).toHaveLength(3);
  });

  test("a rename target that already exists is a token conflict (CSSX-U04)", async () => {
    const text = [
      "@variables {",
      "  accent: #2563eb;",
      "  gap: 4px;",
      "}",
      ".card { color: $accent; padding: $gap; }",
    ].join("\n");
    const { state } = await analyze(text);
    const accentAt = text.indexOf("color: $accent") + "color: $".length;
    const accent = tokenAt(text, accentAt, state.analysis);
    if (accent === undefined) throw new Error("expected the accent token");

    const conflict = tokenNameConflict(state.analysis, "gap", accent.symbol);
    expect(conflict?.name).toBe("gap");
    expect(conflict?.kind).toBe("compile");
    // The renamed symbol itself never counts, and a free name is accepted.
    expect(tokenNameConflict(state.analysis, "accent", accent.symbol)).toBeUndefined();
    expect(tokenNameConflict(state.analysis, "space", accent.symbol)).toBeUndefined();
  });

  test("token rename covers group definition and use-site bodies (CSSX-U05)", async () => {
    const text = [
      "@variables { gap: 8px; }",
      "@group.card { padding: $gap; }",
      ".a {",
      "  padding: $gap;",
      "  @group.card {",
      "    border-radius: $gap;",
      "  }",
      "}",
    ].join("\n");
    const { state } = await analyze(text);
    const offset = text.indexOf("padding: $gap;") + "padding: $".length;
    const plan = renameAt(text, offset, "space", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
    }));
    // Declaration + rule body + group definition body + group use-site body.
    expect(edits).toHaveLength(4);
    expect(edits.map((edit) => edit.newText)).toEqual(["space", "$space", "$space", "$space"]);
    const editedSlices = edits
      .map((edit) => text.slice(edit.start, edit.end))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    expect(editedSlices).toEqual(["$gap", "$gap", "$gap", "gap"]);
  });
});

const CLASS_DOCUMENT = [
  '@setup { prefix: "ui"; }',
  "@variables { card: 1px; }",
  ".card {",
  "  padding: $card;",
  "  &:hover { color: red; }",
  "  &.card-active, .card:not(.card) { color: blue; }",
  "  :is(.card, .cardinal) { color: green; }",
  "  &:global(.card) { color: black; }",
  '  content: ".card";',
  "}",
  ".card { margin: 0; }",
  ".cardinal { margin: 1px; }",
  "#panel { color: gray; }",
].join("\n");

function applyRename(
  text: string,
  analysis: AnalyzeResult,
  edits: readonly { range: Range; newText: string }[],
): string {
  const ordered = edits
    .map((edit) => ({ ...rangeToOffsets(analysis, edit.range), newText: edit.newText }))
    .sort((left, right) => right.start - left.start);
  let result = text;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

describe("class rename", () => {
  test("renames every non-global occurrence in the current document and nothing else", async () => {
    const { state } = await analyze(CLASS_DOCUMENT);
    const plan = renameAt(CLASS_DOCUMENT, CLASS_DOCUMENT.indexOf(".card {") + 1, "panel", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("card");
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
    }));
    // Base, comma/`:not()` pair, `:is()` argument and the second base rule.
    // The `:global(.card)` occurrence, the `$card` token, the `"card"` string
    // and the longer `card-active`/`cardinal` names are never part of the set.
    expect(edits).toHaveLength(5);
    expect(edits.map((edit) => edit.newText)).toEqual([
      "panel",
      "panel",
      "panel",
      "panel",
      "panel",
    ]);
    expect(edits.map((edit) => CLASS_DOCUMENT.slice(edit.start, edit.end))).toEqual([
      "card",
      "card",
      "card",
      "card",
      "card",
    ]);
    expect(applyRename(CLASS_DOCUMENT, state.analysis, plan.edits)).toBe(
      [
        '@setup { prefix: "ui"; }',
        "@variables { card: 1px; }",
        ".panel {",
        "  padding: $card;",
        "  &:hover { color: red; }",
        "  &.card-active, .panel:not(.panel) { color: blue; }",
        "  :is(.panel, .cardinal) { color: green; }",
        "  &:global(.card) { color: black; }",
        '  content: ".card";',
        "}",
        ".panel { margin: 0; }",
        ".cardinal { margin: 1px; }",
        "#panel { color: gray; }",
      ].join("\n"),
    );
  });

  test("attribute selector names, operators and values are never renamed", async () => {
    const text = [
      '.card[data-x=".card"] { color: red; }',
      '[data-y=".card"], .card[class~=".card"] { color: blue; }',
      ".card[data-z=card] { color: green; }",
    ].join("\n");
    const { state } = await analyze(text);
    const plan = renameAt(text, text.indexOf(".card[") + 1, "panel", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
    }));
    // One edit per real class token, none for the bracketed values.
    expect(edits.map((edit) => text.slice(edit.start, edit.end))).toEqual(["card", "card", "card"]);
    expect(applyRename(text, state.analysis, plan.edits)).toBe(
      [
        '.panel[data-x=".card"] { color: red; }',
        '[data-y=".card"], .panel[class~=".card"] { color: blue; }',
        ".panel[data-z=card] { color: green; }",
      ].join("\n"),
    );

    // A cursor inside an attribute value is not a class occurrence.
    const valuePlan = renameAt(text, text.indexOf('".card"') + 2, "panel", {
      analysis: state.analysis,
    });
    expect(valuePlan.ok).toBe(false);
    if (!valuePlan.ok) expect(valuePlan.reason).toContain("Place the cursor on a Xessa token");
  });

  test("the class-name range excludes the dot and global selection is refused", async () => {
    const { state } = await analyze(CLASS_DOCUMENT);
    const occurrence = classAt(
      state.analysis,
      CLASS_DOCUMENT.indexOf(":is(.card") + ":is(.".length,
    );
    expect(occurrence?.name).toBe("card");
    if (occurrence === undefined) return;
    const offsets = rangeToOffsets(state.analysis, occurrence.range);
    expect(CLASS_DOCUMENT.slice(offsets.start, offsets.end)).toBe("card");
    expect(CLASS_DOCUMENT[offsets.start - 1]).toBe(".");

    const globalAt = CLASS_DOCUMENT.indexOf(":global(.card)") + ":global(.".length;
    const globalPlan = renameAt(CLASS_DOCUMENT, globalAt, "other", { analysis: state.analysis });
    expect(globalPlan.ok).toBe(false);
    if (globalPlan.ok) return;
    expect(globalPlan.reason).toContain("Global classes");
  });

  test("invalid, existing and non-class rename targets are refused", async () => {
    const { state } = await analyze(CLASS_DOCUMENT);
    const cardAt = CLASS_DOCUMENT.indexOf(".card {") + 1;

    const invalid = renameAt(CLASS_DOCUMENT, cardAt, "1bad", { analysis: state.analysis });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toContain("Class names must start");

    const existing = renameAt(CLASS_DOCUMENT, cardAt, "cardinal", { analysis: state.analysis });
    expect(existing.ok).toBe(false);
    if (!existing.ok) {
      expect(existing.reason).toContain('A class named ".cardinal" already exists');
    }

    // Non-class tokens keep their own paths: an id dispatches to the id rename
    // (feature 28), not to the class rename, and a pseudo name still falls
    // through to the generic refusal.
    const idPlan = renameAt(CLASS_DOCUMENT, CLASS_DOCUMENT.indexOf("#panel") + 1, "other", {
      analysis: state.analysis,
    });
    expect(idPlan.ok).toBe(true);
    if (idPlan.ok) expect(idPlan.placeholder).toBe("panel");

    const pseudoPlan = renameAt(CLASS_DOCUMENT, CLASS_DOCUMENT.indexOf(":hover") + 1, "other", {
      analysis: state.analysis,
    });
    expect(pseudoPlan.ok).toBe(false);
  });

  test("renaming to the identical name is a pinned no-op edit set", async () => {
    const { state } = await analyze(CLASS_DOCUMENT);
    const plan = renameAt(CLASS_DOCUMENT, CLASS_DOCUMENT.indexOf(".card {") + 1, "card", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toHaveLength(5);
    expect(plan.edits.every((edit) => edit.newText === "card")).toBe(true);
    expect(applyRename(CLASS_DOCUMENT, state.analysis, plan.edits)).toBe(CLASS_DOCUMENT);
  });
});

const ID_DOCUMENT = [
  '@setup { prefix: "ui"; }',
  "#panel { color: red; }",
  "#panel, .panel #inner { color: blue; }",
  ".card {",
  "  &#panel:hover { color: green; }",
  "  &:is(#panel, #panel-header) { color: teal; }",
  "  &:not(#panel) { color: gray; }",
  "  &:has(> #panel) { color: black; }",
  '  content: "#panel";',
  '  &[data-id="#panel"] { color: white; }',
  "}",
  ":global(#panel) .x { color: purple; }",
].join("\n");

describe("id rename (feature 28)", () => {
  test("renames every occurrence in the current document and nothing else", async () => {
    const { state } = await analyze(ID_DOCUMENT);
    const occurrences = collectIdOccurrences(state.analysis).filter(
      (entry) => entry.name === "panel",
    );
    expect(occurrences).toHaveLength(7);

    const plan = renameAt(ID_DOCUMENT, ID_DOCUMENT.indexOf("#panel {") + 1, "main", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("panel");
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
    }));
    // Base, comma list, `&` nesting and `:is()`/`:not()`/`:has()` arguments,
    // plus the `:global(#panel)` occurrence — ids have no local/global split.
    // The longer `#panel-header`, the `.panel` class with the same name, the
    // `"#panel"` string and the `[data-id="#panel"]` attribute value stay out.
    expect(edits).toHaveLength(7);
    expect(edits.map((edit) => edit.newText)).toEqual([
      "main",
      "main",
      "main",
      "main",
      "main",
      "main",
      "main",
    ]);
    expect(edits.map((edit) => ID_DOCUMENT.slice(edit.start, edit.end))).toEqual([
      "panel",
      "panel",
      "panel",
      "panel",
      "panel",
      "panel",
      "panel",
    ]);
    for (const edit of edits) {
      expect(ID_DOCUMENT[edit.start - 1]).toBe("#");
    }
    expect(applyRename(ID_DOCUMENT, state.analysis, plan.edits)).toBe(
      [
        '@setup { prefix: "ui"; }',
        "#main { color: red; }",
        "#main, .panel #inner { color: blue; }",
        ".card {",
        "  &#main:hover { color: green; }",
        "  &:is(#main, #panel-header) { color: teal; }",
        "  &:not(#main) { color: gray; }",
        "  &:has(> #main) { color: black; }",
        '  content: "#panel";',
        '  &[data-id="#panel"] { color: white; }',
        "}",
        ":global(#main) .x { color: purple; }",
      ].join("\n"),
    );
  });

  test("the id-name range excludes the hash and id completion is unchanged", async () => {
    const { state } = await analyze(ID_DOCUMENT);
    const occurrence = idAt(state.analysis, ID_DOCUMENT.indexOf(":is(#panel") + ":is(#".length);
    expect(occurrence?.name).toBe("panel");
    if (occurrence === undefined) return;
    const offsets = rangeToOffsets(state.analysis, occurrence.range);
    expect(ID_DOCUMENT.slice(offsets.start, offsets.end)).toBe("panel");
    expect(ID_DOCUMENT[offsets.start - 1]).toBe("#");

    // The completion collector still reports one entry per distinct name in
    // first-appearance order; rename does not change that surface.
    expect(collectIdSelectors(state.analysis).map((entry) => entry.name)).toEqual([
      "panel",
      "inner",
      "panel-header",
    ]);
  });

  test("invalid, existing and non-id rename targets are refused", async () => {
    const { state } = await analyze(ID_DOCUMENT);
    const panelAt = ID_DOCUMENT.indexOf("#panel {") + 1;

    const invalid = renameAt(ID_DOCUMENT, panelAt, "1bad", { analysis: state.analysis });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toContain("Id names must start");

    const existing = renameAt(ID_DOCUMENT, panelAt, "panel-header", {
      analysis: state.analysis,
    });
    expect(existing.ok).toBe(false);
    if (!existing.ok) {
      expect(existing.reason).toContain('An id named "#panel-header" already exists');
    }

    // A cursor inside an authored string or attribute value is not an id.
    const stringAt = ID_DOCUMENT.indexOf('"#panel"') + 1;
    const stringPlan = renameAt(ID_DOCUMENT, stringAt, "main", { analysis: state.analysis });
    expect(stringPlan.ok).toBe(false);
    if (!stringPlan.ok) {
      expect(stringPlan.reason).toContain("Place the cursor on a Xessa token");
    }

    const attributeAt = ID_DOCUMENT.indexOf('[data-id="#panel"]') + '[data-id="#'.length;
    const attributePlan = renameAt(ID_DOCUMENT, attributeAt, "main", {
      analysis: state.analysis,
    });
    expect(attributePlan.ok).toBe(false);
  });

  test("renaming to the identical name is a pinned no-op edit set", async () => {
    const { state } = await analyze(ID_DOCUMENT);
    const plan = renameAt(ID_DOCUMENT, ID_DOCUMENT.indexOf("#panel {") + 1, "panel", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toHaveLength(7);
    expect(plan.edits.every((edit) => edit.newText === "panel")).toBe(true);
    expect(applyRename(ID_DOCUMENT, state.analysis, plan.edits)).toBe(ID_DOCUMENT);
  });
});

const GROUP_RENAME_DOCUMENT = [
  "@group.card {",
  "  padding: 12px;",
  "  color: black;",
  "}",
  "",
  ".a { @group.card { padding: 20px; } }",
  ".b { @group.card { } }",
].join("\n");

function groupNameOffset(text: string, name: string, from = 0): number {
  return text.indexOf(`@group.${name}`, from) + "@group.".length + 1;
}

describe("group rename", () => {
  test("renames the definition and every same-file use site", async () => {
    const { state } = await analyze(GROUP_RENAME_DOCUMENT);
    const plan = renameAt(
      GROUP_RENAME_DOCUMENT,
      groupNameOffset(GROUP_RENAME_DOCUMENT, "card"),
      "panel",
      {
        analysis: state.analysis,
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("card");
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
      file: edit.file,
    }));
    expect(edits).toHaveLength(3);
    expect(edits.map((edit) => edit.newText)).toEqual(["panel", "panel", "panel"]);
    const documentPath = join(ROOT, "rename.cssx");
    expect(edits.every((edit) => edit.file === documentPath)).toBe(true);
    expect(edits.map((edit) => edit.start).sort((left, right) => left - right)).toEqual(
      [
        GROUP_RENAME_DOCUMENT.indexOf("@group.card") + "@group.".length,
        GROUP_RENAME_DOCUMENT.indexOf(".a { @group.card") + ".a { @group.".length,
        GROUP_RENAME_DOCUMENT.indexOf(".b { @group.card") + ".b { @group.".length,
      ].sort((left, right) => left - right),
    );
  });

  test("the same plan is produced from a use-site member", async () => {
    const { state } = await analyze(GROUP_RENAME_DOCUMENT);
    const offset = groupNameOffset(GROUP_RENAME_DOCUMENT, "card", 40);
    const plan = renameAt(GROUP_RENAME_DOCUMENT, offset, "panel", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("card");
    expect(plan.edits).toHaveLength(3);
  });

  test("renames definitions and references in styles-imported modules", async () => {
    const relative = "tests/fixtures/groups/style-import/entry.cssx";
    const text = readFileSync(join(ROOT, relative), "utf8");
    const { state } = await analyze(text, relative);
    const offset = groupNameOffset(text, "card");
    const plan = renameAt(text, offset, "surface", { analysis: state.analysis });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("card");
    expect(plan.edits).toHaveLength(2);
    expect(plan.edits.map((edit) => edit.newText)).toEqual(["surface", "surface"]);
    const definition = plan.edits.find((edit) => edit.file?.endsWith("chrome.cssx"));
    expect(definition).toBeDefined();
    expect(definition?.range.start.character).toBe(7);
    const reference = plan.edits.find((edit) => edit.file?.endsWith("entry.cssx"));
    expect(reference).toBeDefined();
    if (reference === undefined) return;
    expect(rangeToOffsets(state.analysis, reference.range)).toEqual({
      start: text.indexOf("@group.card") + "@group.".length,
      end: text.indexOf("@group.card") + "@group.".length + "card".length,
    });
  });

  test("refuses an ambiguous group and names both modules", async () => {
    const relative = "tests/fixtures/groups/ambiguous-import/entry.cssx";
    const text = readFileSync(join(ROOT, relative), "utf8");
    const { state } = await analyze(text, relative);
    const plan = renameAt(text, groupNameOffset(text, "card"), "surface", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("Ambiguous group");
    expect(plan.reason).toContain("@group.card");
    expect(plan.reason).toContain("a.cssx");
    expect(plan.reason).toContain("b.cssx");
  });

  test("refuses unknown groups and invalid names", async () => {
    const unknown = ".a { @group.nope { padding: 1px; } }";
    const { state: unknownState } = await analyze(unknown);
    const unknownPlan = renameAt(unknown, groupNameOffset(unknown, "nope"), "other", {
      analysis: unknownState.analysis,
    });
    expect(unknownPlan.ok).toBe(false);
    if (unknownPlan.ok) return;
    expect(unknownPlan.reason).toContain("Unknown group");

    const { state } = await analyze(GROUP_RENAME_DOCUMENT);
    const invalid = renameAt(
      GROUP_RENAME_DOCUMENT,
      groupNameOffset(GROUP_RENAME_DOCUMENT, "card"),
      "1bad",
      {
        analysis: state.analysis,
      },
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.reason).toContain("Group names");
  });
});

const KEYFRAME_RENAME_DOCUMENT = [
  "@keyframes spin {",
  "  from { opacity: 0; }",
  "  to { opacity: 1; }",
  "}",
  ".a { animation-name: spin; }",
  ".b { animation-name: $keyframes.spin; }",
  ".c { animation: spin 1s linear infinite; }",
  ".d { animation-name: spin, fade; }",
].join("\n");

const AMBIGUOUS_KEYFRAMES_PATH = "virtual/keyframes/ambiguous/entry.cssx";

/** Offset of the name in the first `@keyframes <name>` definition. */
function keyframeDefinitionOffset(text: string, name: string, from = 0): number {
  return text.indexOf(`@keyframes ${name}`, from) + "@keyframes ".length;
}

/** Offset of the member name in the first `$keyframes.<name>` reference. */
function keyframeReferenceOffset(text: string, name: string, from = 0): number {
  return text.indexOf(`$keyframes.${name}`, from) + "$keyframes.".length;
}

/** Virtual styles modules for the two-imports-one-name ambiguity case. */
function ambiguousKeyframeModules(): Readonly<Record<string, string>> {
  const directory = join(ROOT, "virtual/keyframes/ambiguous");
  return {
    [join(directory, "a.cssx")]:
      '@setup { prefix: "a"; }\n@keyframes spin {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}\n',
    [join(directory, "b.cssx")]:
      '@setup { prefix: "b"; }\n@keyframes spin {\n  from { opacity: 0.25; }\n  to { opacity: 0.75; }\n}\n',
  };
}

function virtualReader(modules: Readonly<Record<string, string>>) {
  return (path: string): string | undefined => modules[path] ?? readModule(path);
}

describe("keyframe rename", () => {
  test("renames the definition, $keyframes reference and exact animation-name value", async () => {
    const { state } = await analyze(KEYFRAME_RENAME_DOCUMENT);
    const plan = renameAt(
      KEYFRAME_RENAME_DOCUMENT,
      keyframeDefinitionOffset(KEYFRAME_RENAME_DOCUMENT, "spin"),
      "turn",
      { analysis: state.analysis },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("spin");
    const edits = plan.edits.map((edit) => ({
      ...rangeToOffsets(state.analysis, edit.range),
      newText: edit.newText,
      file: edit.file,
    }));
    expect(edits).toHaveLength(3);
    expect(edits.map((edit) => edit.newText)).toEqual(["turn", "turn", "turn"]);
    const documentPath = join(ROOT, "rename.cssx");
    expect(edits.every((edit) => edit.file === documentPath)).toBe(true);
    expect(edits.map((edit) => edit.start).sort((left, right) => left - right)).toEqual(
      [
        keyframeDefinitionOffset(KEYFRAME_RENAME_DOCUMENT, "spin"),
        KEYFRAME_RENAME_DOCUMENT.indexOf("animation-name: spin") + "animation-name: ".length,
        keyframeReferenceOffset(KEYFRAME_RENAME_DOCUMENT, "spin"),
      ].sort((left, right) => left - right),
    );

    // The `animation:` shorthand and the multi-name value are never rewritten.
    const untouched = [
      {
        start: KEYFRAME_RENAME_DOCUMENT.indexOf("animation: spin") + "animation: ".length,
        end: KEYFRAME_RENAME_DOCUMENT.indexOf("animation: spin") + "animation: spin".length,
      },
      {
        start:
          KEYFRAME_RENAME_DOCUMENT.indexOf("animation-name: spin,") + "animation-name: ".length,
        end:
          KEYFRAME_RENAME_DOCUMENT.indexOf("animation-name: spin,") +
          "animation-name: spin,".length,
      },
    ];
    for (const edit of edits) {
      for (const range of untouched) {
        expect(edit.start >= range.end || edit.end <= range.start).toBe(true);
      }
    }
  });

  test("the same plan is produced from a $keyframes reference", async () => {
    const { state } = await analyze(KEYFRAME_RENAME_DOCUMENT);
    const plan = renameAt(
      KEYFRAME_RENAME_DOCUMENT,
      keyframeReferenceOffset(KEYFRAME_RENAME_DOCUMENT, "spin"),
      "turn",
      { analysis: state.analysis },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("spin");
    expect(plan.edits).toHaveLength(3);
  });

  test("the same plan and cursor are produced from an exact animation-name value", async () => {
    const { state } = await analyze(KEYFRAME_RENAME_DOCUMENT);
    const valueOffset =
      KEYFRAME_RENAME_DOCUMENT.indexOf("animation-name: spin") + "animation-name: ".length;
    const fromDefinition = renameAt(
      KEYFRAME_RENAME_DOCUMENT,
      keyframeDefinitionOffset(KEYFRAME_RENAME_DOCUMENT, "spin"),
      "turn",
      { analysis: state.analysis },
    );
    const fromValue = renameAt(KEYFRAME_RENAME_DOCUMENT, valueOffset, "turn", {
      analysis: state.analysis,
    });
    expect(fromValue).toEqual(fromDefinition);
    expect(fromValue.ok).toBe(true);
    if (!fromValue.ok) return;
    expect(fromValue.placeholder).toBe("spin");
    expect(fromValue.edits).toHaveLength(3);

    // prepareRename (and hover) read the same cursor: the reference shape over
    // the value bytes, never the property or the whole declaration.
    const valueRange = {
      start: positionAt(state.analysis.lineStarts, valueOffset),
      end: positionAt(state.analysis.lineStarts, valueOffset + "spin".length),
    };
    expect(keyframeAt(KEYFRAME_RENAME_DOCUMENT, valueOffset + 1, state.analysis)).toEqual({
      site: "reference",
      name: "spin",
      nameRange: valueRange,
      keywordRange: valueRange,
    });
  });

  test("renames a styles-imported definition and reference across modules", async () => {
    const relative = "tests/fixtures/keyframes/style-import/entry.cssx";
    const text = readFileSync(join(ROOT, relative), "utf8");
    const { state } = await analyze(text, relative);
    const plan = renameAt(text, keyframeReferenceOffset(text, "spin"), "rotate", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placeholder).toBe("spin");
    expect(plan.edits).toHaveLength(2);
    expect(plan.edits.map((edit) => edit.newText)).toEqual(["rotate", "rotate"]);
    const definition = plan.edits.find((edit) => edit.file?.endsWith("motion.cssx"));
    expect(definition).toBeDefined();
    expect(definition?.range.start.character).toBe(11);
    const reference = plan.edits.find((edit) => edit.file?.endsWith("entry.cssx"));
    expect(reference).toBeDefined();
    if (reference === undefined) return;
    expect(rangeToOffsets(state.analysis, reference.range)).toEqual({
      start: keyframeReferenceOffset(text, "spin"),
      end: keyframeReferenceOffset(text, "spin") + "spin".length,
    });
    // The imported module's `animation: spin …` shorthand stays untouched.
    expect(
      plan.edits.some(
        (edit) => edit.file?.endsWith("motion.cssx") && edit.range.start.character > 11,
      ),
    ).toBe(false);
  });

  test("refuses an ambiguous keyframe and names both modules", async () => {
    const text = [
      '@use "./a.cssx" styles;',
      '@use "./b.cssx" styles;',
      ".page { animation-name: $keyframes.spin; }",
    ].join("\n");
    const { state } = await analyze(text, AMBIGUOUS_KEYFRAMES_PATH, {
      compile: false,
      readModule: virtualReader(ambiguousKeyframeModules()),
    });
    const plan = renameAt(text, keyframeReferenceOffset(text, "spin"), "rotate", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("Ambiguous keyframe");
    expect(plan.reason).toContain("$keyframes.spin");
    expect(plan.reason).toContain("a.cssx");
    expect(plan.reason).toContain("b.cssx");
  });

  test("refuses invalid identifiers, unknown names and a name already in scope", async () => {
    const { state } = await analyze(KEYFRAME_RENAME_DOCUMENT);
    const offset = keyframeDefinitionOffset(KEYFRAME_RENAME_DOCUMENT, "spin");
    for (const invalidName of ["1bad", "-1bad", "has space", "semi;colon"]) {
      const plan = renameAt(KEYFRAME_RENAME_DOCUMENT, offset, invalidName, {
        analysis: state.analysis,
      });
      expect(plan.ok).toBe(false);
      if (plan.ok) continue;
      expect(plan.reason).toContain("valid CSS identifier");
    }

    const unknown = ".page { animation-name: $keyframes.nope; }";
    const { state: unknownState } = await analyze(unknown);
    const unknownPlan = renameAt(unknown, keyframeReferenceOffset(unknown, "nope"), "other", {
      analysis: unknownState.analysis,
    });
    expect(unknownPlan.ok).toBe(false);
    if (unknownPlan.ok) return;
    expect(unknownPlan.reason).toContain("Unknown keyframe");

    const collision = [
      "@keyframes spin { from { opacity: 0; } }",
      "@keyframes fade { from { opacity: 0; } }",
      ".page { animation-name: $keyframes.spin; }",
    ].join("\n");
    const { state: collisionState } = await analyze(collision);
    const collisionPlan = renameAt(collision, keyframeReferenceOffset(collision, "spin"), "fade", {
      analysis: collisionState.analysis,
    });
    expect(collisionPlan.ok).toBe(false);
    if (collisionPlan.ok) return;
    expect(collisionPlan.reason).toContain('"fade"');
    expect(collisionPlan.reason).toContain("already exists in scope");
  });

  test("refuses a later duplicate definition header (first definition wins)", async () => {
    const text = [
      "@keyframes spin { from { opacity: 0; } }",
      "@keyframes spin { from { opacity: 1; } }",
      ".page { animation-name: $keyframes.spin; }",
    ].join("\n");
    const { state } = await analyze(text);
    const plan = renameAt(text, keyframeDefinitionOffset(text, "spin", 10), "turn", {
      analysis: state.analysis,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("Duplicate keyframe definition");
  });

  test("token and group rename contracts are unchanged in a document with keyframes", async () => {
    const text = [
      "@variables { gap: 8px; }",
      "@keyframes spin { from { opacity: 0; } }",
      "@group.card { padding: 8px; }",
      ".a { @group.card { } animation-name: $keyframes.spin; color: $gap; }",
    ].join("\n");
    const { state } = await analyze(text);

    const tokenPlan = renameAt(text, text.indexOf("$gap") + 1, "space", {
      analysis: state.analysis,
    });
    expect(tokenPlan.ok).toBe(true);
    if (tokenPlan.ok) {
      expect(tokenPlan.edits.every((edit) => edit.file === undefined)).toBe(true);
      expect(tokenPlan.edits).toHaveLength(2);
    }

    const groupPlan = renameAt(text, text.indexOf("@group.card") + "@group.".length, "panel", {
      analysis: state.analysis,
    });
    expect(groupPlan.ok).toBe(true);
    if (groupPlan.ok) {
      expect(groupPlan.placeholder).toBe("card");
      expect(groupPlan.edits).toHaveLength(2);
    }
  });
});
