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
  tokenNameConflict,
} from "../../packages/vscode/src/analysis.ts";
import {
  classAt,
  collectIdOccurrences,
  collectIdSelectors,
  definitionsAt,
  idAt,
  referencesAt,
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
