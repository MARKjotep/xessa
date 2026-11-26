/**
 * Pure intelligence-layer tests: completion contexts, hover values, colors and
 * the outline, all without the `vscode` module.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalyzeOptions,
  type AnalyzeResult,
  type DocumentState,
  SETUP_KEYS,
  type SourceText,
  analyzeDocument,
  computeLineStarts,
  positionAt,
} from "../../packages/vscode/src/analysis.ts";
import {
  collectIdSelectors,
  colorsAt,
  colorsOf,
  completionsAt,
  contextAt,
  definitionsAt,
  documentSymbols,
  hexColorToRgba,
  hoverAt,
  rgbaToHex,
} from "../../packages/vscode/src/intelligence.ts";
import { CSS_PROPERTY_DOCS } from "../../packages/vscode/src/property-docs.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CANONICAL = "tests/fixtures/canonical/button/input.cssx";

function fixture(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function readModule(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function analyze(
  text: string,
  options: AnalyzeOptions = {},
  path = "example.cssx",
): Promise<DocumentState> {
  const source: SourceText = { text, path: join(ROOT, path), version: 1 };
  return analyzeDocument(source, { workspaceRoot: ROOT, readModule, ...options });
}

function labels(items: readonly { label: string }[]): string[] {
  return items.map((item) => item.label);
}

function aliasLabels(analysis: AnalyzeResult, text: string, offset: number): string[] {
  return labels(completionsAt(text, offset, { analysis }).items);
}

/** One suggestion by label; a missing label fails with the offered labels. */
function suggestion(
  result: { readonly items: readonly { label: string; insertText: string }[] },
  label: string,
): {
  readonly label: string;
  readonly insertText: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly snippet?: string;
  readonly sortText?: string;
  readonly replaceStart?: number;
  readonly retriggerSuggest?: boolean;
} {
  const found = result.items.find((item) => item.label === label);
  if (found === undefined) {
    throw new Error(`missing suggestion "${label}" in [${labels(result.items).join(", ")}]`);
  }
  return found;
}

/** Document text after the editor accepts one suggestion over its replacement range. */
function accept(
  text: string,
  result: { readonly replaceStart: number; readonly replaceEnd: number },
  item: { readonly insertText: string; readonly replaceStart?: number },
): string {
  // Items may narrow the shared range themselves (a unit suffix, the typed `&`
  // of a selector starter); the editor applies the item's own start.
  const start = item.replaceStart ?? result.replaceStart;
  return text.slice(0, start) + item.insertText + text.slice(result.replaceEnd);
}

describe("completion contexts", () => {
  test("built-in and document media aliases complete after @ (including @2xl)", async () => {
    const text = [
      "@media-types { compact: (max-width: 500px); }",
      ".card { padding: 10px @ }",
    ].join("\n");
    const state = await analyze(text);
    const offset = text.indexOf("@ }") + 1;
    const context = contextAt(text, offset, state.analysis);
    expect(context.kind).toBe("directive");
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    const byLabel = new Map(items.map((item) => [item.label, item]));
    expect(byLabel.get("@2xl")?.detail).toContain("(min-width: 1536px)");
    expect(byLabel.get("@smd")?.detail).toContain("(min-width: 624px)");
    expect(byLabel.get("@no_hover")?.detail).toContain("(pointer: coarse)");
    expect(byLabel.get("@mobile")?.detail).toContain("(pointer: coarse)");
    expect(byLabel.get("@screen")?.detail).toContain("screen");
    expect(byLabel.get("@md")?.detail).toContain("(min-width: 768px)");
    expect(byLabel.get("@compact")?.detail).toContain("(max-width: 500px)");
  });

  test("$ completes local tokens and namespaces, and ns. completes members", async () => {
    const canonical = fixture(CANONICAL);
    const text = `${canonical}\n.extra { color: $theme. }`;
    const state = await analyze(text, {}, CANONICAL);
    const memberOffset = text.lastIndexOf("$theme.") + "$theme.".length;
    expect(contextAt(text, memberOffset, state.analysis)).toEqual({
      kind: "member",
      namespace: "theme",
      word: "",
    });
    const members = completionsAt(text, memberOffset, { analysis: state.analysis }).items;
    expect(labels(members)).toEqual(["primary"]);

    const tokenText = "@variables { gap: 8px; }\n.card { padding: $gap; }";
    const tokens = await analyze(tokenText);
    const tokenOffset = tokenText.indexOf("$") + 1;
    expect(aliasLabels(tokens.analysis, tokenText, tokenOffset)).toContain("$gap");
  });

  test("setup keys and boolean setup values complete", async () => {
    const keyText = "@setup {\n  pre";
    const keyState = await analyze(keyText);
    const keyOffset = keyText.length;
    expect(contextAt(keyText, keyOffset, keyState.analysis)).toEqual({
      kind: "setup-key",
      word: "pre",
    });
    expect(aliasLabels(keyState.analysis, keyText, keyOffset)).toContain("prefix");

    const valueText = "@setup {\n  emit-css: ";
    const valueState = await analyze(valueText);
    expect(contextAt(valueText, valueText.length, valueState.analysis)).toEqual({
      kind: "setup-value",
      key: "emit-css",
      word: "",
    });
    expect(
      labels(completionsAt(valueText, valueText.length, { analysis: valueState.analysis }).items),
    ).toEqual(["true", "false"]);

    // ADR-0020's module-side switch completes as a key and a boolean value.
    const inheritKey = "@setup {\n  map-in";
    const inheritState = await analyze(inheritKey);
    const inheritItems = completionsAt(inheritKey, inheritKey.length, {
      analysis: inheritState.analysis,
    }).items;
    expect(labels(inheritItems)).toEqual(["map-inherit"]);
    expect(inheritItems[0]?.kind).toBe("setup-key");
    expect(inheritItems[0]?.documentation).toContain("importer's map");

    const inheritValue = "@setup {\n  map-inherit: ";
    const inheritValueState = await analyze(inheritValue);
    expect(contextAt(inheritValue, inheritValue.length, inheritValueState.analysis)).toEqual({
      kind: "setup-value",
      key: "map-inherit",
      word: "",
    });
    expect(
      labels(
        completionsAt(inheritValue, inheritValue.length, {
          analysis: inheritValueState.analysis,
        }).items,
      ),
    ).toEqual(["true", "false"]);

    // ADR-0021's opt-in stylesheet import completes as a key and a boolean value.
    const cssKey = "@setup {\n  import-c";
    const cssState = await analyze(cssKey);
    const cssItems = completionsAt(cssKey, cssKey.length, {
      analysis: cssState.analysis,
    }).items;
    expect(labels(cssItems)).toEqual(["import-css"]);
    expect(cssItems[0]?.kind).toBe("setup-key");
    expect(cssItems[0]?.documentation).toContain("side-effect import");

    const cssValue = "@setup {\n  import-css: ";
    const cssValueState = await analyze(cssValue);
    expect(contextAt(cssValue, cssValue.length, cssValueState.analysis)).toEqual({
      kind: "setup-value",
      key: "import-css",
      word: "",
    });
    expect(
      labels(
        completionsAt(cssValue, cssValue.length, {
          analysis: cssValueState.analysis,
        }).items,
      ),
    ).toEqual(["true", "false"]);

    // ADR-0024's opt-in merge mode completes as a key and three values.
    const groupingKey = "@setup {\n  media-";
    const groupingState = await analyze(groupingKey);
    const groupingItems = completionsAt(groupingKey, groupingKey.length, {
      analysis: groupingState.analysis,
    }).items;
    expect(labels(groupingItems)).toEqual(["media-grouping"]);
    expect(groupingItems[0]?.kind).toBe("setup-key");
    expect(groupingItems[0]?.documentation).toContain("disjoint-family");

    const groupingValue = "@setup {\n  media-grouping: ";
    const groupingValueState = await analyze(groupingValue);
    expect(contextAt(groupingValue, groupingValue.length, groupingValueState.analysis)).toEqual({
      kind: "setup-value",
      key: "media-grouping",
      word: "",
    });
    const groupingValues = completionsAt(groupingValue, groupingValue.length, {
      analysis: groupingValueState.analysis,
    }).items;
    expect(labels(groupingValues)).toEqual(["merge", "safe", "none"]);
    expect(groupingValues.map((item) => item.detail)).toEqual([
      "Merge disjoint-family conditional runs (ADR-0024)",
      "Merge adjacent compatible runs (default)",
      "No grouping; emit runs in place",
    ]);
  });

  test("import paths complete inside @use strings through the injected lister", async () => {
    const text = '@use "./';
    const state = await analyze(text);
    const offset = text.length;
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "import-path", typed: "./" });
    const items = completionsAt(text, offset, {
      analysis: state.analysis,
      listDirectory: () => ["theme.cssx", "layout.cssx", "sub"],
    }).items;
    expect(labels(items)).toEqual(["./layout.cssx", "./sub/", "./theme.cssx"]);
  });

  test("native at-rules complete at top level after @ (includes @keyframes)", async () => {
    const text = ['@setup { prefix: "ui"; }', "", "@"].join("\n");
    const state = await analyze(text);
    const offset = text.length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "directive",
      word: "",
      inSelector: false,
    });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    const byLabel = new Map(items.map((item) => [item.label, item]));
    const native = [
      "@keyframes",
      "@media",
      "@font-face",
      "@import",
      "@property",
      "@supports",
      "@layer",
      "@container",
      "@page",
      "@charset",
    ];
    for (const label of native) {
      expect(byLabel.get(label)?.detail).toBe("native at-rule");
      expect(byLabel.get(label)?.documentation?.length ?? 0).toBeGreaterThan(0);
    }
    const ordered = items.map((item) => item.label);
    for (const directive of ["@setup", "@use", "@variables", "@runtime", "@media-types"]) {
      expect(ordered).toContain(directive);
    }
    // Xessa directives stay ahead of the native at-rules.
    expect(ordered.indexOf("@setup")).toBeLessThan(ordered.indexOf("@keyframes"));
    expect(ordered.indexOf("@media-types")).toBeLessThan(ordered.indexOf("@media"));
    // The adapter maps these optional sort keys, so the grouping holds in VS Code too.
    expect(byLabel.get("@setup")?.sortText).toBe("0-setup");
    expect(byLabel.get("@keyframes")?.sortText).toBe("1-keyframes");
    expect(byLabel.get("@keyframes")?.insertText).toBe("@keyframes ");
  });

  test("the typed prefix filters native at-rules and Xessa directives", async () => {
    const top = ".a { color: red; }\n@me";
    const topState = await analyze(top);
    expect(aliasLabels(topState.analysis, top, top.length)).toEqual(["@media-types", "@media"]);

    const keyframes = "@k";
    const keyframesState = await analyze(keyframes);
    expect(aliasLabels(keyframesState.analysis, keyframes, keyframes.length)).toEqual([
      "@keyframes",
    ]);

    const setup = "@se";
    const setupState = await analyze(setup);
    expect(aliasLabels(setupState.analysis, setup, setup.length)).toEqual(["@setup"]);
  });

  test("rule bodies only offer CSS-nesting-legal native at-rules", async () => {
    const text = ".a {\n  @\n}";
    const state = await analyze(text);
    const offset = text.indexOf("@") + 1;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "directive",
      word: "",
      inSelector: true,
    });
    const items = aliasLabels(state.analysis, text, offset);
    for (const legal of ["@media", "@supports", "@layer", "@container"]) {
      expect(items).toContain(legal);
    }
    for (const topLevelOnly of [
      "@keyframes",
      "@font-face",
      "@charset",
      "@import",
      "@property",
      "@page",
    ]) {
      expect(items).not.toContain(topLevelOnly);
    }
    // Media aliases keep completing inside a rule body.
    expect(items).toContain("@md");
  });

  test("native at-rules are not offered mid-declaration but aliases still are", async () => {
    const text = ".a {\n  padding: 10px @m\n}";
    const state = await analyze(text);
    const offset = text.indexOf("@m") + 2;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "directive",
      word: "m",
      inSelector: true,
    });
    expect(aliasLabels(state.analysis, text, offset)).toEqual(["@md", "@mobile"]);
  });

  test("top-level @ completion survives recovery-pending statements", async () => {
    const text = [
      "@variables { gap: 8px; }",
      ".card {",
      "  padding: $gap",
      "  & .label { color: red; }",
      "}",
      "",
      "@",
    ].join("\n");
    const state = await analyze(text);
    expect(state.analysis.problems.some((problem) => problem.severity === "error")).toBe(true);
    const offset = text.length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "directive",
      word: "",
      inSelector: false,
    });
    const items = aliasLabels(state.analysis, text, offset);
    expect(items).toContain("@setup");
    expect(items).toContain("@keyframes");
  });

  test("property, value, selector and pseudo contexts are distinguished", async () => {
    const propertyText = ".a {\n  dis";
    const propertyState = await analyze(propertyText);
    expect(aliasLabels(propertyState.analysis, propertyText, propertyText.length)).toContain(
      "display",
    );

    const valueText = ".a {\n  display: f;\n}";
    const valueState = await analyze(valueText);
    const valueOffset = valueText.indexOf("f;") + 1;
    expect(contextAt(valueText, valueOffset, valueState.analysis)).toMatchObject({
      kind: "value",
      property: "display",
    });
    expect(aliasLabels(valueState.analysis, valueText, valueOffset)).toContain("flex");

    const selectorText = ".a {\n  & { color: red; }\n}";
    const selectorState = await analyze(selectorText);
    const ampersand = selectorText.indexOf("&") + 1;
    expect(contextAt(selectorText, ampersand, selectorState.analysis)).toMatchObject({
      kind: "selector",
    });
    expect(aliasLabels(selectorState.analysis, selectorText, ampersand)).toContain("&:hover");

    const pseudoText = ".a {\n  &: { color: red; }\n}";
    const pseudoState = await analyze(pseudoText);
    const colon = pseudoText.indexOf(":") + 1;
    expect(contextAt(pseudoText, colon, pseudoState.analysis)).toMatchObject({ kind: "pseudo" });
    const pseudos = aliasLabels(pseudoState.analysis, pseudoText, colon);
    expect(pseudos).toContain(":hover");
    expect(pseudos).toContain("::before");
  });

  test("property completion survives a missing semicolon and a following nested rule", async () => {
    const unterminated = ".card {\n  color: red\n  dis\n}";
    const unterminatedState = await analyze(unterminated);
    const unterminatedOffset = unterminated.indexOf("dis") + 3;
    expect(contextAt(unterminated, unterminatedOffset, unterminatedState.analysis)).toEqual({
      kind: "property",
      word: "dis",
    });
    expect(aliasLabels(unterminatedState.analysis, unterminated, unterminatedOffset)).toContain(
      "display",
    );

    const nested = ".card {\n  color: red\n  dis\n  &:hover { color: blue; }\n}";
    const nestedState = await analyze(nested);
    const nestedOffset = nested.indexOf("dis") + 3;
    expect(contextAt(nested, nestedOffset, nestedState.analysis)).toEqual({
      kind: "property",
      word: "dis",
    });
    expect(aliasLabels(nestedState.analysis, nested, nestedOffset)).toContain("display");

    // Multi-line values stay value contexts: a comma-wrapped continuation and a
    // wrapped first value line are not new declarations.
    const wrapped = ".card {\n  display:\n  fl\n}";
    const wrappedState = await analyze(wrapped);
    const wrappedOffset = wrapped.indexOf("fl") + 2;
    expect(contextAt(wrapped, wrappedOffset, wrappedState.analysis)).toEqual({
      kind: "value",
      property: "display",
      word: "fl",
    });
    expect(aliasLabels(wrappedState.analysis, wrapped, wrappedOffset)).toContain("flex");

    const shadow = ".card {\n  box-shadow: 0 1px 2px black,\n    0 2px 4px gray\n}";
    const shadowState = await analyze(shadow);
    const shadowOffset = shadow.indexOf("gray") + 4;
    expect(contextAt(shadow, shadowOffset, shadowState.analysis)).toMatchObject({
      kind: "value",
      property: "box-shadow",
    });
  });

  test("property completion items carry documentation", async () => {
    const text = ".a {\n  dis";
    const state = await analyze(text);
    const items = completionsAt(text, text.length, { analysis: state.analysis }).items;
    const display = items.find((item) => item.label === "display");
    expect(display?.detail).toBe("CSS property");
    expect(display?.insertText).toBe("display: ");
    expect(display?.documentation?.length ?? 0).toBeGreaterThan(0);
    expect(display?.documentation).toContain("display type");
  });

  test("@setup keeps completing keys after a completed setting", async () => {
    // A completed `prefix: "ui";` line used to leave its colon as the nearest
    // one, turning the fresh line into a value context with no candidates.
    const text = ["@setup {", '  prefix: "ui";', "  ", "}"].join("\n");
    const offset = text.indexOf(";\n") + ";\n".length + 2;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "setup-key", word: "" });
    expect(aliasLabels(state.analysis, text, offset)).toEqual([
      ...SETUP_KEYS,
      "map-inherit",
      "import-css",
    ]);

    // The second setting still completes its boolean values.
    const booleanText = ["@setup {", '  prefix: "ui";', "  emit-css: ", "}"].join("\n");
    const booleanOffset = booleanText.indexOf("emit-css: ") + "emit-css: ".length;
    const booleanState = await analyze(booleanText);
    expect(contextAt(booleanText, booleanOffset, booleanState.analysis)).toEqual({
      kind: "setup-value",
      key: "emit-css",
      word: "",
    });
    expect(
      labels(completionsAt(booleanText, booleanOffset, { analysis: booleanState.analysis }).items),
    ).toEqual(["true", "false"]);
  });

  test("a fresh line inside an @keyframes body completes frame selectors", async () => {
    const text = ["@keyframes spin {", "  ", "}"].join("\n");
    const offset = text.indexOf("{\n  ") + "{\n  ".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "keyframe-selector",
      word: "",
    });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    expect(labels(items)).toEqual(["from", "to", "0%", "25%", "50%", "75%", "100%"]);
    const byLabel = new Map(items.map((item) => [item.label, item]));
    // Percentage frames insert their `%`; from/to carry a one-line description.
    expect(byLabel.get("50%")?.insertText).toBe("50%");
    expect(byLabel.get("100%")?.insertText).toBe("100%");
    expect(byLabel.get("from")?.documentation?.length ?? 0).toBeGreaterThan(0);
    expect(byLabel.get("to")?.documentation?.length ?? 0).toBeGreaterThan(0);
  });

  test("the typed keyframe frame prefix filters frame selectors", async () => {
    const typed = ["@keyframes spin {", "  fr", "}"].join("\n");
    const typedOffset = typed.indexOf("  fr") + "  fr".length;
    const typedState = await analyze(typed);
    expect(contextAt(typed, typedOffset, typedState.analysis)).toEqual({
      kind: "keyframe-selector",
      word: "fr",
    });
    expect(aliasLabels(typedState.analysis, typed, typedOffset)).toEqual(["from"]);

    // The `%` belongs to the frame word so the replacement range covers it.
    const percent = ["@keyframes spin {", "  50%", "}"].join("\n");
    const percentOffset = percent.indexOf("  50%") + "  50%".length;
    const percentState = await analyze(percent);
    expect(contextAt(percent, percentOffset, percentState.analysis)).toEqual({
      kind: "keyframe-selector",
      word: "50%",
    });
    const percentResult = completionsAt(percent, percentOffset, {
      analysis: percentState.analysis,
    });
    expect(labels(percentResult.items)).toEqual(["50%"]);
    expect(percentOffset - percentResult.replaceStart).toBe("50%".length);
  });

  test("a keyframe frame block behaves like a rule body", async () => {
    const text = ["@keyframes spin {", "  from {", "    ", "  }", "}"].join("\n");
    const offset = text.indexOf("from {\n    ") + "from {\n    ".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "property", word: "" });
    expect(aliasLabels(state.analysis, text, offset)).toContain("opacity");

    const valueText = ["@keyframes spin {", "  from {", "    opacity: ", "  }", "}"].join("\n");
    const valueOffset = valueText.indexOf("opacity: ") + "opacity: ".length;
    const valueState = await analyze(valueText);
    expect(contextAt(valueText, valueOffset, valueState.analysis)).toMatchObject({
      kind: "value",
      property: "opacity",
      word: "",
    });
    const valueLabels = aliasLabels(valueState.analysis, valueText, valueOffset);
    expect(valueLabels).toContain("inherit");
    expect(valueLabels).toContain("blur(");
  });

  test("directives inside an @keyframes body and other native at-rules are unchanged", async () => {
    const text = ["@keyframes spin {", "  @", "}"].join("\n");
    const offset = text.indexOf("  @") + "  @".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "directive",
      word: "",
      inSelector: true,
    });
    expect(aliasLabels(state.analysis, text, offset)).toContain("@media");

    // A bare statement inside a non-keyframes native block stays without
    // frame-selector candidates (frame selectors are keyframes-only).
    const mediaText = ["@media (min-width: 10px) {", "  ", "}"].join("\n");
    const mediaOffset = mediaText.indexOf("{\n  ") + "{\n  ".length;
    const mediaState = await analyze(mediaText);
    const mediaLabels = aliasLabels(mediaState.analysis, mediaText, mediaOffset);
    expect(mediaLabels).not.toContain("from");
    expect(mediaLabels).not.toContain("50%");
  });

  test("value completion starts as soon as the property colon is typed", async () => {
    // The tolerant AST ends the declaration span at the colon, so these cursors
    // sat outside the declaration and fell back to the property list.
    const tolerant = ".button {\n  width: ";
    const tolerantState = await analyze(tolerant);
    expect(contextAt(tolerant, tolerant.length, tolerantState.analysis)).toEqual({
      kind: "value",
      property: "width",
      word: "",
    });
    const tolerantItems = completionsAt(tolerant, tolerant.length, {
      analysis: tolerantState.analysis,
    }).items;
    expect(tolerantItems.length).toBeGreaterThan(0);
    expect(tolerantItems.every((item) => item.kind === "value")).toBe(true);
    expect(labels(tolerantItems)).toContain("auto");

    const terminated = ".button {\n  width: \n}";
    const terminatedOffset = terminated.indexOf("width: ") + "width: ".length;
    const terminatedState = await analyze(terminated);
    expect(contextAt(terminated, terminatedOffset, terminatedState.analysis)).toEqual({
      kind: "value",
      property: "width",
      word: "",
    });
    expect(
      labels(
        completionsAt(terminated, terminatedOffset, { analysis: terminatedState.analysis }).items,
      ),
    ).toContain("auto");

    // Cursor immediately after the colon with no space is a value context too.
    const tight = ".button {\n  width:";
    const tightState = await analyze(tight);
    expect(contextAt(tight, tight.length, tightState.analysis)).toEqual({
      kind: "value",
      property: "width",
      word: "",
    });

    // Property completion on a bare word keeps winning in the same position.
    const propertyText = ".button {\n  wid";
    const propertyState = await analyze(propertyText);
    expect(contextAt(propertyText, propertyText.length, propertyState.analysis)).toEqual({
      kind: "property",
      word: "wid",
    });
  });

  test("value context offers CSS functions after the keyword values", async () => {
    const text = ".a {\n  width: \n}";
    const offset = text.indexOf("width: ") + "width: ".length;
    const state = await analyze(text);
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    const calc = items.find((item) => item.label === "calc(");
    expect(calc?.kind).toBe("value");
    expect(calc?.detail).toBe("CSS function");
    expect(calc?.insertText).toBe("calc(");
    expect(calc?.documentation).toContain("calc(100% - 20px)");
    expect(calc?.sortText?.startsWith("1-")).toBe(true);
    expect(items.find((item) => item.label === "color-mix(")?.documentation).toContain(
      "color-mix(in oklab, red, blue)",
    );
    // `var(` keeps the `--` of a custom property reference in its insert text.
    expect(items.find((item) => item.label === "var(")?.insertText).toBe("var(--");
    // Keyword values stay ahead of the functions.
    expect(items.find((item) => item.label === "auto")?.sortText).toBe("0-auto");
    const details = items.map((item) => item.detail);
    expect(details.indexOf("CSS function")).toBeGreaterThan(details.lastIndexOf("CSS value"));
  });

  test("CSS functions filter by the typed word and ignore the property", async () => {
    const calcText = ".a {\n  width: ca\n}";
    const calcOffset = calcText.indexOf("ca\n") + 2;
    const calcState = await analyze(calcText);
    expect(contextAt(calcText, calcOffset, calcState.analysis)).toEqual({
      kind: "value",
      property: "width",
      word: "ca",
    });
    expect(aliasLabels(calcState.analysis, calcText, calcOffset)).toEqual(["calc("]);

    const mixText = ".a {\n  color: col\n}";
    const mixOffset = mixText.indexOf("col\n") + 3;
    const mixState = await analyze(mixText);
    expect(aliasLabels(mixState.analysis, mixText, mixOffset)).toEqual(["color-mix("]);

    // Values stay raw CSS behind a variant modifier segment.
    const variantText = ".a {\n  padding: @md ca\n}";
    const variantOffset = variantText.indexOf("ca\n") + 2;
    const variantState = await analyze(variantText);
    expect(contextAt(variantText, variantOffset, variantState.analysis)).toEqual({
      kind: "value",
      property: "padding",
      word: "ca",
    });
    expect(aliasLabels(variantState.analysis, variantText, variantOffset)).toEqual(["calc("]);
  });

  test("animation longhands complete with documentation", async () => {
    const text = ".a {\n  animation-";
    const state = await analyze(text);
    const items = completionsAt(text, text.length, { analysis: state.analysis }).items;
    const expected = [
      "animation-delay",
      "animation-direction",
      "animation-duration",
      "animation-fill-mode",
      "animation-iteration-count",
      "animation-name",
      "animation-play-state",
      "animation-timing-function",
    ];
    for (const property of expected) {
      const item = items.find((candidate) => candidate.label === property);
      expect(item?.detail).toBe("CSS property");
      expect(item?.documentation?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("$ completion offers the built-in keyframes namespace beside imported aliases", async () => {
    const text = ".card { animation-name: $; }";
    const offset = text.indexOf("$") + 1;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "token", word: "" });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    const keyframes = items.find((item) => item.label === "$keyframes.");
    expect(keyframes?.kind).toBe("token");
    expect(keyframes?.detail).toBe("built-in keyframe namespace");
    expect(keyframes?.insertText).toBe("$keyframes.");
    expect(keyframes?.documentation).toContain("$keyframes.<name>");

    const typed = ".card { animation-name: $key; }";
    const typedOffset = typed.indexOf("$key") + "$key".length;
    const typedState = await analyze(typed);
    expect(aliasLabels(typedState.analysis, typed, typedOffset)).toEqual(["$keyframes."]);
  });

  test("the completion provider registers structural triggers and every digit", () => {
    // The controller imports `vscode`, so the registration list is asserted from
    // its source: `&` is not a word character and needs an explicit trigger, and
    // a digit opens the unit list (`margin: 1` → `1rem`, board bug 28).
    const source = readFileSync(join(ROOT, "packages/vscode/src/controller.ts"), "utf8");
    const start = source.indexOf("vscode.languages.registerCompletionItemProvider(");
    expect(start).toBeGreaterThan(-1);
    const registration = source.slice(start, start + 600);
    for (const trigger of ["@", "$", ".", ":", "/", "&", ..."0123456789"]) {
      expect(registration).toContain(`"${trigger}",`);
    }
  });
});

describe("completion ranges and merged selector lines (A46)", () => {
  test("accepting a pseudo after a typed colon replaces the colon instead of duplicating it", async () => {
    // A46 bug A: after `&:` the pseudo items used to be inserted *behind* the
    // typed colon, so accepting `:hover` left `&::hover` (owner saw `&:::hover`
    // after a retrigger). The replacement range must cover the typed colons.
    const single = ".a {\n  &:\n}";
    const singleOffset = single.indexOf("&:") + 2;
    const singleState = await analyze(single);
    expect(contextAt(single, singleOffset, singleState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "",
    });
    const singleResult = completionsAt(single, singleOffset, { analysis: singleState.analysis });
    expect(singleResult.replaceStart).toBe(singleOffset - 1);
    expect(accept(single, singleResult, suggestion(singleResult, ":hover"))).toBe(
      ".a {\n  &:hover\n}",
    );

    const pair = ".a {\n  &::\n}";
    const pairOffset = pair.indexOf("&::") + 3;
    const pairState = await analyze(pair);
    expect(contextAt(pair, pairOffset, pairState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "",
    });
    const pairResult = completionsAt(pair, pairOffset, { analysis: pairState.analysis });
    expect(pairResult.replaceStart).toBe(pairOffset - 2);
    expect(accept(pair, pairResult, suggestion(pairResult, "::after"))).toBe(".a {\n  &::after\n}");
    expect(accept(pair, pairResult, suggestion(pairResult, "::before"))).toBe(
      ".a {\n  &::before\n}",
    );
  });

  test("typed pseudo prefixes filter the pseudo list and stay single-colon", async () => {
    const typed = ".a {\n  &:hov\n}";
    const typedOffset = typed.indexOf("&:hov") + "&:hov".length;
    const typedState = await analyze(typed);
    expect(contextAt(typed, typedOffset, typedState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "hov",
    });
    const typedResult = completionsAt(typed, typedOffset, { analysis: typedState.analysis });
    expect(labels(typedResult.items)).toEqual([":hover"]);
    expect(accept(typed, typedResult, suggestion(typedResult, ":hover"))).toBe(
      ".a {\n  &:hover\n}",
    );

    const element = ".a {\n  &::a\n}";
    const elementOffset = element.indexOf("&::a") + "&::a".length;
    const elementState = await analyze(element);
    expect(contextAt(element, elementOffset, elementState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "a",
    });
    const elementResult = completionsAt(element, elementOffset, {
      analysis: elementState.analysis,
    });
    expect(labels(elementResult.items)).toEqual([":active", "::after"]);
    expect(accept(element, elementResult, suggestion(elementResult, "::after"))).toBe(
      ".a {\n  &::after\n}",
    );
  });

  test("declaration-shaped a: lines and top-level a: selectors keep their context", async () => {
    // Regression pins: a bare word plus colon inside a rule body stays a value
    // context (the A45 `width:` contract), so no pseudo item can duplicate a
    // colon there.
    for (const declaration of ["a:", "a::"]) {
      const text = `.a {\n  ${declaration}\n}`;
      const offset = text.indexOf(declaration) + declaration.length;
      const state = await analyze(text);
      expect(contextAt(text, offset, state.analysis)).toEqual({
        kind: "value",
        property: "a",
        word: "",
      });
      expect(aliasLabels(state.analysis, text, offset)).not.toContain(":hover");
    }

    // Outside a rule body the same text is a tag selector, so the pseudo range
    // fix applies there too: `a:` + `:hover` is `a:hover`, never `a::hover`.
    const topLevel = "a:\n.b { color: red; }";
    const topLevelOffset = topLevel.indexOf("a:") + 2;
    const topLevelState = await analyze(topLevel);
    expect(contextAt(topLevel, topLevelOffset, topLevelState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "",
    });
    const topLevelResult = completionsAt(topLevel, topLevelOffset, {
      analysis: topLevelState.analysis,
    });
    expect(accept(topLevel, topLevelResult, suggestion(topLevelResult, ":hover"))).toBe(
      "a:hover\n.b { color: red; }",
    );
  });

  test("accepting a class after &. keeps the typed dot", async () => {
    // A46 bug B: `.` is a word character, so the replacement range covered the
    // typed dot while class items insert the bare name — `&.test` became `&test`.
    const dot = ".a {\n  &.\n}\n.test { color: blue; }";
    const dotOffset = dot.indexOf("&.") + 2;
    const dotState = await analyze(dot);
    expect(contextAt(dot, dotOffset, dotState.analysis)).toMatchObject({
      kind: "selector",
      word: ".",
    });
    const dotResult = completionsAt(dot, dotOffset, { analysis: dotState.analysis });
    expect(dotResult.replaceStart).toBe(dotOffset);
    expect(accept(dot, dotResult, suggestion(dotResult, ".test"))).toBe(
      ".a {\n  &.test\n}\n.test { color: blue; }",
    );

    const typed = ".a {\n  &.te\n  color: red;\n}\n.test > a { color: blue; }";
    const typedOffset = typed.indexOf("&.te") + "&.te".length;
    const typedState = await analyze(typed);
    expect(contextAt(typed, typedOffset, typedState.analysis)).toMatchObject({
      kind: "selector",
      word: ".te",
    });
    const typedResult = completionsAt(typed, typedOffset, { analysis: typedState.analysis });
    expect(typedResult.replaceStart).toBe(typedOffset - "te".length);
    expect(accept(typed, typedResult, suggestion(typedResult, ".test"))).toBe(
      ".a {\n  &.test\n  color: red;\n}\n.test > a { color: blue; }",
    );

    // A class written at a rule-body top level keeps the dot for the same reason.
    const plain = ".test { color: blue; }\n.a {\n  color: red;\n  .te\n}";
    const plainOffset = plain.indexOf("  .te") + "  .te".length;
    const plainState = await analyze(plain);
    const plainResult = completionsAt(plain, plainOffset, { analysis: plainState.analysis });
    expect(accept(plain, plainResult, suggestion(plainResult, ".test"))).toContain("  .test\n}");

    // SELECTOR_STARTERS keep the caret range at the result level; each starter
    // item narrows it over the authored `&` (CSSX-U02).
    const starter = ".a {\n  &\n}";
    const starterOffset = starter.indexOf("&") + 1;
    const starterState = await analyze(starter);
    const starterResult = completionsAt(starter, starterOffset, {
      analysis: starterState.analysis,
    });
    expect(starterResult.replaceStart).toBe(starterOffset);
    expect(suggestion(starterResult, "&:hover").replaceStart).toBe(starterOffset - 1);
    expect(labels(starterResult.items)).toContain("&:hover");

    // No class list outside a rule body; the top-level result stays `none`.
    const top = ".test { color: blue; }\n.te";
    expect(contextAt(top, top.length, (await analyze(top)).analysis)).toEqual({ kind: "none" });
  });

  test("a line directly above a & selector still completes CSS properties", async () => {
    // A46 bug C: the tolerant parser glues the statement line and the following
    // `&` line into one multi-line selector, so the cursor sat inside a
    // selector span and the property list disappeared.
    const shapes: readonly { readonly text: string; readonly marker: string }[] = [
      { text: ".a {\n  color: red;\n  co\n  &:hover { }\n}", marker: "co" },
      { text: ".a {\n  color: red;\n  co\n  &:hover { color: blue; }\n}", marker: "co" },
      { text: ".a {\n  co\n  &:hover { color: blue; }\n}", marker: "co" },
      { text: ".a {\n  co\n  &::after { }\n}", marker: "co" },
      { text: ".a {\n  co\n  &.test { }\n}", marker: "co" },
      { text: ".a {\n  co\n  & { }\n}", marker: "co" },
      { text: ".a {\n  color: red\n  co\n  &:hover { }\n}", marker: "co" },
    ];
    for (const shape of shapes) {
      const offset = shape.text.indexOf(shape.marker) + shape.marker.length;
      const state = await analyze(shape.text);
      expect(contextAt(shape.text, offset, state.analysis)).toEqual({
        kind: "property",
        word: "co",
      });
      const result = completionsAt(shape.text, offset, { analysis: state.analysis });
      expect(labels(result.items)).toContain("color");
    }

    // An empty line directly above the `&` line completes properties too.
    const blank = ".a {\n  color: red;\n  \n  &:hover { }\n}";
    const blankOffset = blank.indexOf("  \n  &:") + 2;
    const blankState = await analyze(blank);
    expect(contextAt(blank, blankOffset, blankState.analysis)).toEqual({
      kind: "property",
      word: "",
    });
    expect(
      completionsAt(blank, blankOffset, { analysis: blankState.analysis }).items.length,
    ).toBeGreaterThan(50);

    // A typed declaration above the `&` line stays a value context.
    const declaration = ".a {\n  co: \n  &:hover { }\n}";
    const declarationOffset = declaration.indexOf("co: ") + "co: ".length;
    const declarationState = await analyze(declaration);
    expect(contextAt(declaration, declarationOffset, declarationState.analysis)).toEqual({
      kind: "value",
      property: "co",
      word: "",
    });

    // The `&` line itself keeps its selector/pseudo classification.
    const onSelector = ".a {\n  color: red;\n  &\n}";
    const onSelectorOffset = onSelector.indexOf("  &\n") + 3;
    const onSelectorState = await analyze(onSelector);
    expect(contextAt(onSelector, onSelectorOffset, onSelectorState.analysis)).toMatchObject({
      kind: "selector",
    });
    expect(aliasLabels(onSelectorState.analysis, onSelector, onSelectorOffset)).toContain(
      "&:hover",
    );

    const onPseudo = ".a {\n  color: red;\n  &:\n}";
    const onPseudoOffset = onPseudo.indexOf("  &:\n") + 4;
    const onPseudoState = await analyze(onPseudo);
    expect(contextAt(onPseudo, onPseudoOffset, onPseudoState.analysis)).toMatchObject({
      kind: "pseudo",
    });

    // A second `&` line under the first stays selector text as well.
    const secondLine = ".a {\n  co\n  &:h\n}";
    const secondOffset = secondLine.indexOf("&:h") + "&:h".length;
    const secondState = await analyze(secondLine);
    expect(contextAt(secondLine, secondOffset, secondState.analysis)).toMatchObject({
      kind: "pseudo",
      word: "h",
    });
    expect(aliasLabels(secondState.analysis, secondLine, secondOffset)).toEqual([":hover"]);
  });
});

describe("completion punctuation repairs (CSSX-U01, CSSX-U02, CSSX-U03)", () => {
  test("the imported namespace item keeps the `$` its range replaces", async () => {
    // CSSX-U01: the alias item used to be labelled `theme.` while its shared
    // range covered the typed `$`, so accepting it wrote the invalid `theme.`.
    const text = `${fixture(CANONICAL)}\n.extra { color: $ }`;
    const offset = text.lastIndexOf("$") + 1;
    const state = await analyze(text, {}, CANONICAL);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "token", word: "" });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    // One item per imported alias, plus the built-in namespace.
    expect(labels(result.items).filter((label) => label.endsWith("."))).toEqual([
      "$keyframes.",
      "$theme.",
    ]);
    const namespace = suggestion(result, "$theme.");
    expect(namespace.insertText).toBe("$theme.");
    expect(accept(text, result, namespace)).toMatch(/\.extra \{ color: \$theme\. \}/);
  });

  test("a lone `&` starter replaces the typed ampersand", async () => {
    // CSSX-U02: the starters insert their own leading `&`, so an empty range at
    // the caret doubled the authored punctuation (`&&:hover`).
    const text = ".a {\n  &\n}\n.b { color: red; }";
    const offset = text.indexOf("&") + 1;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "selector", word: "" });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    for (const label of ["&", "&:hover", "&:focus-visible", "&:disabled", "& >", "& +"]) {
      const item = suggestion(result, label);
      expect(item.replaceStart).toBe(offset - 1);
      expect(item.insertText.startsWith("&")).toBe(true);
      expect(accept(text, result, item)).not.toContain("&&");
    }
    expect(accept(text, result, suggestion(result, "&:hover"))).toBe(
      ".a {\n  &:hover\n}\n.b { color: red; }",
    );
    // The class items keep the caret range; only the starters move.
    expect(result.replaceStart).toBe(offset);
    expect(suggestion(result, ".b").replaceStart).toBeUndefined();
  });

  test("a `&.` class context lists classes only", async () => {
    // CSSX-U03: the `&` starters were appended after the typed dot and wrote
    // `&.&:hover`; a class context must offer class names only.
    const text = ".a {\n  &.\n}\n.test { color: blue; }";
    const offset = text.indexOf("&.") + 2;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "selector", word: "." });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(labels(result.items).filter((label) => label.startsWith("&"))).toEqual([]);
    const classItem = suggestion(result, ".test");
    expect(classItem.replaceStart).toBeUndefined();
    expect(result.replaceStart).toBe(offset);
    expect(accept(text, result, classItem)).toBe(".a {\n  &.test\n}\n.test { color: blue; }");

    // A typed class prefix keeps the same class-only list.
    const typed = ".a {\n  &.te\n}\n.test { color: blue; }";
    const typedOffset = typed.indexOf("&.te") + "&.te".length;
    const typedState = await analyze(typed);
    const typedResult = completionsAt(typed, typedOffset, { analysis: typedState.analysis });
    expect(labels(typedResult.items).filter((label) => label.startsWith("&"))).toEqual([]);
    expect(accept(typed, typedResult, suggestion(typedResult, ".test"))).toBe(
      ".a {\n  &.test\n}\n.test { color: blue; }",
    );
  });
});

describe("hover", () => {
  test("media-grouping setup key shows the exact mode card and ADR pointer", async () => {
    const text = ["@setup {", "  media-grouping: merge;", "}"].join("\n");
    const state = await analyze(text);
    const offset = text.indexOf("media-grouping") + 4;
    const hover = hoverAt(text, offset, { analysis: state.analysis });
    expect(hover?.markdown).toBe(
      [
        "**`media-grouping`** — Xessa `@setup` key",
        "",
        "Controls how emitted CSS groups conditional declaration runs.",
        "",
        "- `none` — no grouping; every run is emitted where it was authored.",
        "- `safe` — default; merges only adjacent runs with the same selector, condition and native at-rule context.",
        "- `merge` — additionally merges same-selector/same-condition media runs across declarations whose property families are provably disjoint. It never merges across a shared property family, `all`, a `var()` value, or a different selector or condition.",
        "",
        "Default: `safe`, unless the project config or this file overrides it. See ADR-0024.",
      ].join("\n"),
    );
    const start = text.indexOf("media-grouping");
    expect(hover?.range.start.character).toBe(2);
    expect(hover?.range.end.character).toBe(2 + "media-grouping".length);
    expect(start).toBeGreaterThan(0);

    // The value word is not a key hover.
    const valueHover = hoverAt(text, text.indexOf("merge"), { analysis: state.analysis });
    expect(valueHover).toBeUndefined();
  });

  test("compile-time tokens show the resolved value", async () => {
    const text = fixture(CANONICAL);
    const state = await analyze(text, {}, CANONICAL);
    const offset = text.indexOf("$spacing") + 1;
    const hover = hoverAt(text, offset, { analysis: state.analysis });
    expect(hover?.markdown).toContain("compile-time token");
    expect(hover?.markdown).toContain("12px");
  });

  test("runtime tokens show the custom property and variants", async () => {
    const text = [
      '@setup { prefix: "ui"; }',
      "@runtime { primary: #2563eb @dark #60a5fa; }",
      ".card { color: $primary; }",
    ].join("\n");
    const state = await analyze(text);
    const hover = hoverAt(text, text.indexOf("$primary") + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("--ui-primary");
    expect(hover?.markdown).toContain("#2563eb");
    expect(hover?.markdown).toContain("`@dark`: `#60a5fa`");
  });

  test("namespace members resolve through the imported module", async () => {
    const text = fixture(CANONICAL);
    const state = await analyze(text, {}, CANONICAL);
    const hover = hoverAt(text, text.indexOf("$theme.primary") + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("$theme.primary");
    expect(hover?.markdown).toContain("#2563eb");
    expect(hover?.markdown).toContain("./theme.cssx");
  });

  test("media aliases show the resolved condition", async () => {
    const text = ".card { padding: 1px @md 2px; }";
    const state = await analyze(text);
    const hover = hoverAt(text, text.indexOf("@md") + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("(min-width: 768px)");
    expect(hover?.markdown).toContain("builtin");
  });

  test("combined aliases show the AND expression", async () => {
    const text = ".card { color: red @xl+dark blue; }";
    const state = await analyze(text);
    const hover = hoverAt(text, text.indexOf("@xl+dark") + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("(min-width: 1280px) and (prefers-color-scheme: dark)");
  });

  test("selector classes show the generated class from the compile", async () => {
    const text = fixture(CANONICAL);
    const state = await analyze(text, {}, CANONICAL);
    const hover = hoverAt(text, text.indexOf(".button") + 1, {
      analysis: state.analysis,
      ...(state.compiled === undefined ? {} : { classMap: state.compiled.classes }),
    });
    expect(hover?.markdown).toContain("ui-button");
  });

  test("properties show one-sentence docs, values and unknown words do not", async () => {
    const text = ".card { display: flex; }";
    const state = await analyze(text);
    const display = hoverAt(text, text.indexOf("display") + 1, { analysis: state.analysis });
    expect(display?.markdown).toContain("CSS property");
    expect(display?.markdown).toContain("display type");
    expect(hoverAt(text, text.indexOf("flex") + 1, { analysis: state.analysis })).toBeUndefined();

    const misspelled = ".card { colorr: red; }";
    const misspelledState = await analyze(misspelled);
    expect(
      hoverAt(misspelled, misspelled.indexOf("colorr") + 1, {
        analysis: misspelledState.analysis,
      }),
    ).toBeUndefined();

    const unterminated = ".card {\n  color: red\n}";
    const unterminatedState = await analyze(unterminated);
    const color = hoverAt(unterminated, unterminated.indexOf("color") + 1, {
      analysis: unterminatedState.analysis,
    });
    expect(color?.markdown).toContain("CSS property");
    expect(color?.markdown).toContain("foreground text");
  });
});

describe("CSS function tooltips (A47)", () => {
  /** Every curated function with the sample call its documentation must show. */
  const CURATED: readonly { readonly name: string; readonly example: string }[] = [
    { name: "calc", example: "calc(100% - 20px)" },
    { name: "min", example: "min(50%, 40rem)" },
    { name: "max", example: "max(50%, 40rem)" },
    { name: "clamp", example: "clamp(0.5rem, 1rem + 2vw, 2rem)" },
    { name: "var", example: "var(--ui-color)" },
    { name: "env", example: "env(safe-area-inset-top)" },
    { name: "attr", example: "attr(data-label)" },
    { name: "url", example: 'url("./icon.svg")' },
    { name: "rgb", example: "rgb(37 99 235)" },
    { name: "rgba", example: "rgba(37, 99, 235, 0.5)" },
    { name: "hsl", example: "hsl(220 80% 55%)" },
    { name: "hsla", example: "hsla(220, 80%, 55%, 0.5)" },
    { name: "color-mix", example: "color-mix(in oklab, red, blue)" },
    { name: "linear-gradient", example: "linear-gradient(to right, red, blue)" },
    { name: "radial-gradient", example: "radial-gradient(circle, red, blue)" },
    { name: "conic-gradient", example: "conic-gradient(from 45deg, red, blue)" },
    {
      name: "repeating-linear-gradient",
      example: "repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)",
    },
    { name: "cubic-bezier", example: "cubic-bezier(0.4, 0, 0.2, 1)" },
    { name: "steps", example: "steps(4, end)" },
    { name: "translate", example: "translate(10px, 20px)" },
    { name: "rotate", example: "rotate(45deg)" },
    { name: "scale", example: "scale(1.05)" },
    { name: "blur", example: "blur(4px)" },
    { name: "brightness", example: "brightness(1.2)" },
    { name: "counter", example: "counter(item)" },
  ];

  test("hovering calc shows the usage, the example and the name-only range", async () => {
    const text = ".a {\n  width: calc(100% - 20px);\n}";
    const state = await analyze(text);
    const nameStart = text.indexOf("calc");
    const expected = [
      "**calc()** — CSS function",
      "",
      "Math expression mixing units, e.g. percentages and pixels.",
      "",
      "Example: `calc(100% - 20px)`",
    ].join("\n");
    // Start, middle and end of the name word all resolve, and the range stays
    // on the name (`calc`), never the arguments.
    for (const offset of [nameStart, nameStart + 2, nameStart + "calc".length]) {
      const hover = hoverAt(text, offset, { analysis: state.analysis });
      expect(hover?.markdown).toBe(expected);
      expect(hover?.range).toEqual({
        start: { line: 1, character: 9 },
        end: { line: 1, character: 13 },
      });
    }
    // Hovering an argument keeps its own (absent) hover.
    expect(hoverAt(text, text.indexOf("100%") + 1, { analysis: state.analysis })).toBeUndefined();
  });

  test("representative functions hover with their own usage sentence", async () => {
    const cases = [
      {
        text: ".a {\n  color: var(--ui-color);\n}",
        name: "var",
        usage: "Reads a custom property at computed-value time.",
        example: "var(--ui-color)",
      },
      {
        text: ".a {\n  background: color-mix(in oklab, red, blue);\n}",
        name: "color-mix",
        usage: "Mixes two colors in a color space.",
        example: "color-mix(in oklab, red, blue)",
      },
      {
        text: ".a {\n  background: linear-gradient(to right, red, blue);\n}",
        name: "linear-gradient",
        usage: "Gradient along a straight line.",
        example: "linear-gradient(to right, red, blue)",
      },
      {
        text: ".a {\n  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\n}",
        name: "cubic-bezier",
        usage: "Custom easing curve.",
        example: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    ];
    for (const entry of cases) {
      const state = await analyze(entry.text);
      const hover = hoverAt(entry.text, entry.text.indexOf(entry.name) + 1, {
        analysis: state.analysis,
      });
      expect(hover?.markdown.split("\n")[0]).toBe(`**${entry.name}()** — CSS function`);
      expect(hover?.markdown).toContain(entry.usage);
      expect(hover?.markdown.endsWith(`Example: \`${entry.example}\``)).toBe(true);
    }
  });

  test("every curated function hovers with a title, a unique usage and its example", async () => {
    const usages = new Set<string>();
    for (const entry of CURATED) {
      const text = `.a {\n  width: ${entry.example};\n}`;
      const state = await analyze(text);
      const hover = hoverAt(text, text.indexOf(entry.name) + 1, { analysis: state.analysis });
      expect(hover?.markdown.split("\n")[0]).toBe(`**${entry.name}()** — CSS function`);
      expect(hover?.markdown.endsWith(`Example: \`${entry.example}\``)).toBe(true);
      const usage = (hover?.markdown ?? "").split("\n\n")[1] ?? "";
      expect(usage.length).toBeGreaterThan(0);
      usages.add(usage);
    }
    // Every function carries its own description, not a shared placeholder.
    expect(usages.size).toBe(CURATED.length);
    expect(CURATED.length).toBe(25);
  });

  test("non-call words, strings, comments and arguments never show a function hover", async () => {
    const cases: readonly {
      readonly label: string;
      readonly text: string;
      readonly find: string;
      readonly delta: number;
    }[] = [
      {
        label: "bare steps keyword",
        text: ".a {\n  animation-timing-function: steps;\n}",
        find: "steps",
        delta: 2,
      },
      {
        label: "bare brightness keyword",
        text: ".a {\n  filter: brightness;\n}",
        find: "brightness",
        delta: 3,
      },
      {
        label: "min-width media feature",
        text: "@media (min-width: 768px) {\n  .a { color: red; }\n}",
        find: "min-width",
        delta: 1,
      },
      {
        label: "unknown function name",
        text: ".a {\n  width: foo(1px);\n}",
        find: "foo",
        delta: 1,
      },
      {
        label: "inside a string",
        text: '.a {\n  content: "calc(100% - 20px)";\n}',
        find: "calc",
        delta: 1,
      },
      {
        label: "inside a comment",
        text: ".a {\n  /* calc(100% - 20px) */\n  width: 1px;\n}",
        find: "calc",
        delta: 1,
      },
      {
        label: "inside a url() argument",
        text: '.a {\n  background: url("./steps(4).svg");\n}',
        find: "steps",
        delta: 1,
      },
    ];
    for (const entry of cases) {
      const state = await analyze(entry.text);
      const offset = entry.text.indexOf(entry.find) + entry.delta;
      expect([entry.label, hoverAt(entry.text, offset, { analysis: state.analysis })]).toEqual([
        entry.label,
        undefined,
      ]);
    }
    // The `url` name itself is still a call, so it hovers.
    const urlText = '.a {\n  background: url("./icon.svg");\n}';
    const urlState = await analyze(urlText);
    const url = hoverAt(urlText, urlText.indexOf("url(") + 1, { analysis: urlState.analysis });
    expect(url?.markdown).toContain("**url()** — CSS function");
  });

  test("a property word and a function call word in the same declaration keep their own hovers", async () => {
    const text = ".a {\n  filter: blur(4px);\n}";
    const state = await analyze(text);
    const property = hoverAt(text, text.indexOf("filter") + 1, { analysis: state.analysis });
    expect(property?.markdown.split("\n")[0]).toBe("**filter** — CSS property");
    const fn = hoverAt(text, text.indexOf("blur(") + 1, { analysis: state.analysis });
    expect(fn?.markdown.split("\n")[0]).toBe("**blur()** — CSS function");
    expect(fn?.markdown).toContain("Example: `blur(4px)`");
  });

  test("function completion documentation is the usage sentence plus the sample call", async () => {
    const text = ".a {\n  width: \n}";
    const offset = text.indexOf("width: ") + "width: ".length;
    const state = await analyze(text);
    const items = completionsAt(text, offset, { analysis: state.analysis }).items.filter(
      (item) => item.detail === "CSS function",
    );
    expect(items.map((item) => item.label)).toEqual(CURATED.map((entry) => `${entry.name}(`));
    const calc = items.find((item) => item.label === "calc(");
    expect(calc?.documentation).toBe(
      "Math expression mixing units, e.g. percentages and pixels.\n\nExample: `calc(100% - 20px)`",
    );
    // One format for every function: one usage line, a blank line, the example.
    for (const item of items) {
      expect(item.documentation).toMatch(/^[^\n]+\n\nExample: `.+`$/);
      expect(item.documentation).not.toContain("CSS function, for example");
      const entry = CURATED.find((candidate) => item.label === `${candidate.name}(`);
      expect(item.documentation?.endsWith(`Example: \`${entry?.example}\``)).toBe(true);
    }
    expect(new Set(items.map((item) => item.documentation)).size).toBe(items.length);
  });
});

describe("semicolon and unit completions (A48)", () => {
  /** Every unit offered after a bare number, in `CSS_UNITS` order. */
  const UNITS = [
    "px",
    "rem",
    "em",
    "%",
    "vh",
    "vw",
    "vmin",
    "vmax",
    "ch",
    "ex",
    "cm",
    "mm",
    "in",
    "pt",
    "pc",
    "q",
    "fr",
    "deg",
    "grad",
    "rad",
    "turn",
    "s",
    "ms",
    "hz",
    "khz",
    "dpi",
    "dppx",
  ];

  /** A suggestion with every field the two new behaviours can set. */
  interface Item {
    readonly label: string;
    readonly insertText: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly snippet?: string;
    readonly sortText?: string;
    readonly replaceStart?: number;
    readonly retriggerSuggest?: boolean;
  }

  /** The item with `label`, or a failure listing what was offered. */
  function pick(items: readonly Item[], label: string): Item {
    const found = items.find((item) => item.label === label);
    if (found === undefined) {
      throw new Error(`missing suggestion "${label}" in [${items.map((i) => i.label).join(", ")}]`);
    }
    return found;
  }

  /** Only the unit items of a result. */
  function unitsOf(items: readonly Item[]): Item[] {
    return items.filter((item) => item.detail === "CSS unit");
  }

  /**
   * Document text and caret offset after accepting one suggestion: a snippet's
   * `$0` becomes the caret (the adapter's snippet semantics) and an item's own
   * `replaceStart` wins over the shared result range.
   */
  function applySnippet(
    text: string,
    result: { readonly replaceStart: number; readonly replaceEnd: number },
    item: Item,
  ): { readonly text: string; readonly caret: number } {
    const insert = item.snippet ?? item.insertText;
    const caretInInsert = insert.indexOf("$0");
    const plain = caretInInsert < 0 ? insert : insert.replace("$0", "");
    const start = item.replaceStart ?? result.replaceStart;
    return {
      text: text.slice(0, start) + plain + text.slice(result.replaceEnd),
      caret: start + (caretInInsert < 0 ? plain.length : caretInInsert),
    };
  }

  test("accepting a property inserts the semicolon and parks the cursor before it", async () => {
    // Typed fully: `.a { color| }`
    const text = ".a {\n  color\n}";
    const offset = text.indexOf("\n}", 3);
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "property", word: "color" });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    const color = pick(result.items, "color");
    expect(color.snippet).toBe("color: $0;");
    // The plain insert text is unchanged, so non-snippet consumers keep working.
    expect(color.insertText).toBe("color: ");
    const applied = applySnippet(text, result, color);
    expect(applied.text).toBe(".a {\n  color: ;\n}");
    expect(applied.text[applied.caret - 1]).toBe(" ");
    expect(applied.text[applied.caret]).toBe(";");

    // Filtered from `col`: the range covers the typed word, so it is replaced
    // whole instead of appended to.
    const filtered = ".a {\n  col\n}";
    const filteredOffset = filtered.indexOf("\n}", 3);
    const filteredState = await analyze(filtered);
    const filteredResult = completionsAt(filtered, filteredOffset, {
      analysis: filteredState.analysis,
    });
    expect(filteredResult.replaceStart).toBe(filtered.indexOf("col"));
    const filteredApplied = applySnippet(
      filtered,
      filteredResult,
      pick(filteredResult.items, "color"),
    );
    expect(filteredApplied.text).toBe(".a {\n  color: ;\n}");
    expect(filteredApplied.caret).toBe(".a {\n  color: ".length);
    // Accepting a property must reopen the value list (board bug 29).
    expect(color.retriggerSuggest).toBe(true);
  });

  test("the semicolon insert is gated by the setting and leaves other contexts alone", async () => {
    const text = ".a {\n  col\n}";
    const offset = text.indexOf("\n}", 3);
    const state = await analyze(text);
    const off = completionsAt(text, offset, {
      analysis: state.analysis,
      completePropertyWithSemicolon: false,
    });
    const offColor = pick(off.items, "color");
    expect(offColor.snippet).toBeUndefined();
    expect(offColor.insertText).toBe("color: ");
    expect(applySnippet(text, off, offColor).text).toBe(".a {\n  color: \n}");
    // The retrigger is independent of the semicolon setting: the plain insert
    // still parks the cursor in the value position.
    expect(offColor.retriggerSuggest).toBe(true);

    // Explicit `true` matches the default.
    const on = completionsAt(text, offset, {
      analysis: state.analysis,
      completePropertyWithSemicolon: true,
    });
    expect(pick(on.items, "color").snippet).toBe("color: $0;");
    expect(pick(on.items, "color").retriggerSuggest).toBe(true);

    // Value, pseudo and selector items never carry a snippet or a retrigger.
    const shapes: readonly { readonly text: string; readonly offset: number }[] = [
      { text: ".a {\n  width: \n}", offset: ".a {\n  width: ".length },
      { text: ".a {\n  &:\n}", offset: ".a {\n  &:".length },
      { text: ".a {\n  &.te\n}", offset: ".a {\n  &.te".length },
    ];
    for (const shape of shapes) {
      const shapeState = await analyze(shape.text);
      const items = completionsAt(shape.text, shape.offset, {
        analysis: shapeState.analysis,
      }).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.snippet === undefined)).toBe(true);
      expect(items.every((item) => item.retriggerSuggest === undefined)).toBe(true);
    }
  });

  test("a typed number offers CSS units that append without deleting the digits", async () => {
    const text = ".a {\n  margin: 1\n}";
    const offset = text.indexOf("margin: 1") + "margin: 1".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "margin",
      word: "1",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(unitsOf(result.items).map((item) => item.label)).toEqual(UNITS);
    // Nothing in the value list matches `1`, so the units are the whole list.
    expect(result.items.length).toBe(UNITS.length);
    expect(result.items.every((item) => item.snippet === undefined)).toBe(true);
    expect(result.items.every((item) => item.retriggerSuggest === undefined)).toBe(true);

    const rem = pick(result.items, "rem");
    // The replacement starts after the typed number, so the digits stay put.
    expect(rem.replaceStart).toBe(offset);
    expect(rem.sortText).toBe("0~rem");
    expect(applySnippet(text, result, rem).text).toBe(".a {\n  margin: 1rem\n}");
    expect(applySnippet(text, result, pick(result.items, "px")).text).toBe(
      ".a {\n  margin: 1px\n}",
    );

    // `.5`, `10` and `0.5` behave the same, including the leading-dot form.
    for (const [value, expected] of [
      [".5", ".a {\n  margin: .5rem\n}"],
      ["10", ".a {\n  margin: 10rem\n}"],
      ["0.5", ".a {\n  margin: 0.5rem\n}"],
    ] as const) {
      const shaped = `.a {\n  margin: ${value}\n}`;
      const shapedOffset = shaped.indexOf(`margin: ${value}`) + `margin: ${value}`.length;
      const shapedState = await analyze(shaped);
      const shapedResult = completionsAt(shaped, shapedOffset, { analysis: shapedState.analysis });
      expect(unitsOf(shapedResult.items).map((item) => item.label)).toEqual(UNITS);
      expect(applySnippet(shaped, shapedResult, pick(shapedResult.items, "rem")).text).toBe(
        expected,
      );
    }
  });

  test("the typed unit suffix filters the units and the digits stay intact", async () => {
    const text = ".a {\n  margin: 1r\n}";
    const offset = text.indexOf("margin: 1r") + "margin: 1r".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "margin",
      word: "1r",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    // `r` matches the two `r` units only; `rem` comes first.
    expect(unitsOf(result.items).map((item) => item.label)).toEqual(["rem", "rad"]);
    const rem = pick(result.items, "rem");
    // Only the typed `r` is replaced, never the digit.
    expect(rem.replaceStart).toBe(offset - 1);
    expect(applySnippet(text, result, rem).text).toBe(".a {\n  margin: 1rem\n}");

    // No number, no units: the plain value list is untouched.
    for (const [shaped, marker] of [
      [".a {\n  margin: r\n}", "margin: r"],
      [".a {\n  margin: \n}", "margin: "],
    ] as const) {
      const shapedOffset = shaped.indexOf(marker) + marker.length;
      const shapedState = await analyze(shaped);
      const items = completionsAt(shaped, shapedOffset, { analysis: shapedState.analysis }).items;
      expect(unitsOf(items)).toEqual([]);
      // Keyword values and functions are the only families left.
      expect(
        items.every((item) => item.detail === "CSS value" || item.detail === "CSS function"),
      ).toBe(true);
    }
  });

  test("unit items carry a description and sort between the values and the functions", async () => {
    // `font-weight` has digit-leading keyword values (`400`), which must keep
    // the shared range while the units append after the typed digit.
    const text = ".a {\n  font-weight: 4\n}";
    const offset = text.indexOf("font-weight: 4") + "font-weight: 4".length;
    const state = await analyze(text);
    const result = completionsAt(text, offset, { analysis: state.analysis });
    const weight = pick(result.items, "400");
    expect(weight.replaceStart).toBeUndefined();
    expect(weight.sortText).toBe("0-400");
    expect(applySnippet(text, result, weight).text).toBe(".a {\n  font-weight: 400\n}");
    const rem = pick(result.items, "rem");
    expect(rem.replaceStart).toBe(offset);
    expect(applySnippet(text, result, rem).text).toBe(".a {\n  font-weight: 4rem\n}");

    const units = unitsOf(result.items);
    expect(units.map((item) => item.label)).toEqual(UNITS);
    for (const unit of units) {
      expect(unit.detail).toBe("CSS unit");
      expect(unit.documentation?.length ?? 0).toBeGreaterThan(10);
      expect(unit.sortText).toBe(`0~${unit.label}`);
      // After every keyword value, before every function.
      expect((unit.sortText ?? "").localeCompare("0-auto")).toBeGreaterThan(0);
      expect((unit.sortText ?? "").localeCompare("1-calc")).toBeLessThan(0);
      expect(unit.insertText).toBe(unit.label);
    }

    // Keyword values and functions keep their own shape and ordering.
    const widthText = ".a {\n  width: \n}";
    const widthOffset = widthText.indexOf("width: ") + "width: ".length;
    const widthState = await analyze(widthText);
    const widthItems = completionsAt(widthText, widthOffset, {
      analysis: widthState.analysis,
    }).items;
    expect(unitsOf(widthItems)).toEqual([]);
    expect(pick(widthItems, "auto").sortText).toBe("0-auto");
    const calc = pick(widthItems, "calc(");
    expect(calc.sortText).toBe("1-calc");
    expect(calc.documentation).toContain("Example: `calc(100% - 20px)`");
  });

  test("a typed percent keeps the authored unit and adds no unit suggestions", async () => {
    // `%` is not a word character, so the scan stops before it and the word is
    // empty: no number prefix, no units, and the authored `%` stays as typed.
    for (const [text, marker] of [
      [".a {\n  margin: 10%\n}", "margin: 10%"],
      [".a {\n  margin: 10 %\n}", "margin: 10 %"],
    ] as const) {
      const offset = text.indexOf(marker) + marker.length;
      const state = await analyze(text);
      expect(contextAt(text, offset, state.analysis)).toMatchObject({ kind: "value", word: "" });
      const result = completionsAt(text, offset, { analysis: state.analysis });
      expect(unitsOf(result.items)).toEqual([]);
      expect(result.items.some((item) => item.label === "%")).toBe(false);
      // Nothing is replaced in front of the authored `%`.
      expect(result.replaceStart).toBe(offset);
    }
  });
});

describe("!important completion (CSSX-U07)", () => {
  interface Item {
    readonly label: string;
    readonly insertText: string;
    readonly filterText?: string;
    readonly replaceStart?: number;
    readonly detail?: string;
  }

  /** Apply one suggestion over the reported range. */
  function accept(
    text: string,
    result: { readonly replaceStart: number; readonly replaceEnd: number },
    item: Item,
  ): string {
    const start = item.replaceStart ?? result.replaceStart;
    return text.slice(0, start) + item.insertText + text.slice(result.replaceEnd);
  }

  function resultAt(text: string, offset: number) {
    return { text, offset };
  }

  test("a typed `!` offers only `!important` and accepting repairs the bang", async () => {
    for (const [text, marker] of [
      [".a {\n  color: red!\n}", "color: red!"],
      [".a {\n  margin: 4px !\n}", "margin: 4px !"],
    ] as const) {
      const shape = resultAt(text, text.indexOf(marker) + marker.length);
      const state = await analyze(shape.text);
      expect(contextAt(shape.text, shape.offset, state.analysis)).toMatchObject({
        kind: "important",
        word: "",
      });
      const result = completionsAt(shape.text, shape.offset, { analysis: state.analysis });
      expect(result.items.map((item) => item.label)).toEqual(["!important"]);
      const item = result.items[0] as Item;
      expect(item.insertText).toBe("!important");
      expect(item.filterText).toBe("!important");
      // The range covers exactly the typed bang, so the space (if any) stays.
      expect(result.replaceStart).toBe(shape.text.lastIndexOf("!", shape.offset));
      expect(result.replaceEnd).toBe(shape.offset);
      const expected = `${text.slice(0, shape.text.lastIndexOf("!", shape.offset))}!important${text.slice(shape.offset)}`;
      expect(accept(shape.text, result, item)).toBe(expected);
      expect(expected).toContain("!important");
      expect(accept(shape.text, result, item)).not.toContain("!!");
    }
  });

  test("`!im` filters to `!important` and replaces the typed suffix", async () => {
    const text = ".a {\n  color: red!im\n}";
    const offset = text.indexOf("red!im") + "red!im".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "important",
      word: "im",
      start: text.indexOf("!im"),
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(result.items.map((item) => item.label)).toEqual(["!important"]);
    expect(accept(text, result, result.items[0] as Item)).toBe(".a {\n  color: red!important\n}");
  });

  test("an already complete `!important` is offered without doubling the bang", async () => {
    const text = ".a {\n  color: red!!\n}";
    const offset = text.indexOf("red!!") + "red!!".length;
    const state = await analyze(text);
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(result.items.map((item) => item.label)).toEqual(["!important"]);
    expect(result.replaceStart).toBe(text.indexOf("!!"));
    expect(accept(text, result, result.items[0] as Item)).toBe(".a {\n  color: red!important\n}");

    const complete = ".a {\n  color: red!important\n}";
    const completeOffset = complete.indexOf("red!important") + "red!important".length;
    const completeState = await analyze(complete);
    const completeResult = completionsAt(complete, completeOffset, {
      analysis: completeState.analysis,
    });
    expect(completeResult.items.map((item) => item.label)).toEqual(["!important"]);
    expect(accept(complete, completeResult, completeResult.items[0] as Item)).toBe(complete);
  });

  test("selectors, property-name positions and empty values offer no `!` items", async () => {
    const shapes: readonly { readonly text: string; readonly marker: string }[] = [
      { text: ".card! { color: red; }", marker: ".card!" },
      { text: ".a {\n  color: !\n}", marker: "color: !" },
      { text: ".a {\n  col!\n}", marker: "col!" },
    ];
    for (const shape of shapes) {
      const offset = shape.text.indexOf(shape.marker) + shape.marker.length;
      const state = await analyze(shape.text);
      const result = completionsAt(shape.text, offset, { analysis: state.analysis });
      expect(result.items.some((item) => item.label === "!important")).toBe(false);
    }
  });
});

describe("colors and outline", () => {
  test("hex colors convert to RGBA and back", () => {
    expect(hexColorToRgba("#fff")).toEqual({ red: 1, green: 1, blue: 1, alpha: 1 });
    const rgba = hexColorToRgba("#2563eb80");
    expect(rgba?.alpha).toBeCloseTo(0.502, 2);
    expect(rgbaToHex(0, 0, 0, 1)).toBe("#000000");
  });

  test("colorsOf exposes value ranges from declarations", async () => {
    const text = fixture(CANONICAL);
    const state = await analyze(text, {}, CANONICAL);
    const colors = colorsOf(state.analysis);
    expect(colors.map((color) => color.value)).toContain("#1e40af");
    const lineStarts = computeLineStarts(text);
    const expected = positionAt(lineStarts, text.indexOf("#1e40af"));
    expect(colors.find((color) => color.value === "#1e40af")?.range.start).toEqual(expected);
  });

  test("outline nests directives and rules", async () => {
    const text = fixture(CANONICAL);
    const state = await analyze(text, {}, CANONICAL);
    const symbols = documentSymbols(state.analysis);
    const names = symbols.map((symbol) => symbol.name);
    expect(names).toContain("@setup");
    expect(names).toContain("@use ./theme.cssx");
    expect(names).toContain("@variables");
    const button = symbols.find((symbol) => symbol.name === ".button");
    expect(button?.children.map((child) => child.name)).toContain("&:hover");
    expect(button?.children.map((child) => child.name)).toContain("padding");
  });
});

const GROUP_DOCUMENT = [
  "@group.card {",
  "  padding: 12px;",
  "  color: black;",
  "}",
  "",
  ".panel {",
  "  @group.card {",
  "    padding: 20px;",
  "  }",
  "}",
].join("\n");

const STYLE_IMPORT = "tests/fixtures/groups/style-import/entry.cssx";
const AMBIGUOUS_IMPORT = "tests/fixtures/groups/ambiguous-import/entry.cssx";

/** Offset of the first character of the `name` in the first `@group.<name>`. */
function groupNameOffset(text: string, name: string, from = 0): number {
  return text.indexOf(`@group.${name}`, from) + "@group.".length + 1;
}

describe("group completion", () => {
  test("use-site context lists local groups first and imported ones with their module", async () => {
    const text = [
      '@use "./tests/fixtures/groups/style-import/chrome.cssx" styles;',
      "@group.surface { background: white; }",
      ".panel { @group. }",
    ].join("\n");
    const state = await analyze(text);
    const offset = text.lastIndexOf("@group.") + "@group.".length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "group-member",
      word: "",
    });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    // Local definitions sort before imported ones, and imports keep names.
    expect(labels(items)).toEqual(["surface", "card"]);
    const local = items[0];
    expect(local?.detail).toContain("this file");
    expect(local?.sortText?.startsWith("0-")).toBe(true);
    expect(local?.insertText).toBe("surface {\n  \n}");
    const imported = items[1];
    expect(imported?.detail).toContain("chrome.cssx");
    expect(imported?.sortText?.startsWith("1-")).toBe(true);
    expect(imported?.insertText).toBe("card {\n  \n}");
  });

  test("the typed member filters visible groups", async () => {
    const text = [
      "@group.card { padding: 1px; }",
      "@group.chrome { padding: 2px; }",
      ".panel { @group.ch }",
    ].join("\n");
    const state = await analyze(text);
    const offset = text.lastIndexOf("@group.ch") + "@group.ch".length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "group-member",
      word: "ch",
    });
    expect(labels(completionsAt(text, offset, { analysis: state.analysis }).items)).toEqual([
      "chrome",
    ]);
  });

  test("ambiguous visible groups are marked with both defining modules", async () => {
    const text = [
      '@use "./tests/fixtures/groups/ambiguous-import/a.cssx" styles;',
      '@use "./tests/fixtures/groups/ambiguous-import/b.cssx" styles;',
      ".panel { @group. }",
    ].join("\n");
    const state = await analyze(text);
    const offset = text.lastIndexOf("@group.") + "@group.".length;
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    expect(labels(items)).toEqual(["card"]);
    expect(items[0]?.detail).toContain("ambiguous");
    expect(items[0]?.detail).toContain("a.cssx");
    expect(items[0]?.detail).toContain("b.cssx");
    expect(items[0]?.sortText?.startsWith("2-")).toBe(true);
  });

  test("definition context after a top-level @group. completes visible names", async () => {
    const text = ["@group.card { padding: 1px; }", ".panel { color: red; }", "@group."].join("\n");
    const state = await analyze(text);
    const offset = text.length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "group-member",
      word: "",
    });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    expect(labels(items)).toEqual(["card"]);
    expect(items[0]?.insertText).toBe("card {\n  \n}");
  });

  test("group definition and use-site bodies offer the rule-body property set (bug 25)", async () => {
    const ruleText = [".a {", "  ", "}"].join("\n");
    const ruleOffset = ruleText.indexOf("  \n") + 2;
    const ruleState = await analyze(ruleText);
    const ruleItems = completionsAt(ruleText, ruleOffset, { analysis: ruleState.analysis }).items;

    const definitionText = ['@setup { prefix: "ui"; }', "@group.card {", "  ", "}"].join("\n");
    const definitionOffset = definitionText.indexOf("@group.card {") + "@group.card {".length + 3;
    const definitionState = await analyze(definitionText);
    expect(contextAt(definitionText, definitionOffset, definitionState.analysis)).toEqual({
      kind: "property",
      word: "",
    });
    const definitionItems = completionsAt(definitionText, definitionOffset, {
      analysis: definitionState.analysis,
    }).items;
    expect(definitionItems.length).toBeGreaterThan(0);
    expect(labels(definitionItems)).toEqual(labels(ruleItems));
    const paddingItem = definitionItems.find((item) => item.label === "padding");
    expect(paddingItem?.kind).toBe("property");
    expect(paddingItem?.snippet).toBe("padding: $0;");

    const useSiteText = [".a {", "  @group.card {", "    ", "  }", "}"].join("\n");
    const useSiteOffset = useSiteText.indexOf("    \n") + 4;
    const useSiteState = await analyze(useSiteText);
    expect(contextAt(useSiteText, useSiteOffset, useSiteState.analysis)).toEqual({
      kind: "property",
      word: "",
    });
    const useSiteItems = completionsAt(useSiteText, useSiteOffset, {
      analysis: useSiteState.analysis,
    }).items;
    expect(useSiteItems.length).toBeGreaterThan(0);
    expect(labels(useSiteItems)).toEqual(labels(ruleItems));
    expect(suggestion({ items: useSiteItems }, "color").kind).toBe("property");

    // A colon inside either group body switches to the ordinary value state.
    for (const [text, offset] of [
      [definitionText, definitionOffset],
      [useSiteText, useSiteOffset],
    ] as const) {
      const colonText = `${text.slice(0, offset)}padding: ${text.slice(offset)}`;
      const state = await analyze(colonText);
      const valueOffset = offset + "padding: ".length;
      expect(contextAt(colonText, valueOffset, state.analysis)).toEqual({
        kind: "value",
        property: "padding",
        word: "",
      });
      expect(
        labels(completionsAt(colonText, valueOffset, { analysis: state.analysis }).items),
      ).toContain("inherit");
    }
  });

  test("the @group directive completes after @ at top level and in rule bodies", async () => {
    const top = "@gro";
    const topState = await analyze(top);
    expect(contextAt(top, top.length, topState.analysis)).toEqual({
      kind: "directive",
      word: "gro",
      inSelector: false,
    });
    const topItems = completionsAt(top, top.length, { analysis: topState.analysis }).items;
    expect(labels(topItems)).toEqual(["@group"]);
    expect(topItems[0]?.detail).toBe("Xessa directive");
    expect(topItems[0]?.documentation).toContain("@group.card");
    expect(topItems[0]?.insertText).toBe("@group.");

    const nested = ".a {\n  @gro\n}";
    const nestedState = await analyze(nested);
    const nestedOffset = nested.indexOf("@gro") + 4;
    expect(contextAt(nested, nestedOffset, nestedState.analysis)).toEqual({
      kind: "directive",
      word: "gro",
      inSelector: true,
    });
    expect(
      labels(completionsAt(nested, nestedOffset, { analysis: nestedState.analysis }).items),
    ).toEqual(["@group"]);
  });
});

describe("group hover and outline", () => {
  test("use site shows defaults, defining module and overridden properties", async () => {
    const text = fixture(STYLE_IMPORT);
    const state = await analyze(text, {}, STYLE_IMPORT);
    const index = text.indexOf("@group.card");
    const hover = hoverAt(text, index + "@group.".length + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("@group.card");
    expect(hover?.markdown).toContain("group use site");
    expect(hover?.markdown).toContain("chrome.cssx");
    expect(hover?.markdown).toContain("`padding: $pad`");
    expect(hover?.markdown).toContain("`border: 1px solid #ddd`");
    expect(hover?.markdown).toContain("**Defaults**");
    expect(hover?.markdown).toContain("**Overrides at this use site**\n- `padding`");
    expect(hover?.markdown).not.toContain("Overrides in this use site");
    // The hover range covers the whole `@group.card` keyword.
    expect(hover?.range).toEqual({
      start: positionAt(state.analysis.lineStarts, index),
      end: positionAt(state.analysis.lineStarts, index + "@group.card".length),
    });
  });

  test("definition hover shows the definition's own declarations", async () => {
    const chrome = readFileSync(
      join(ROOT, "tests/fixtures/groups/style-import/chrome.cssx"),
      "utf8",
    );
    const state = await analyze(chrome, {}, "tests/fixtures/groups/style-import/chrome.cssx");
    const hover = hoverAt(chrome, groupNameOffset(chrome, "card"), {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("group definition");
    expect(hover?.markdown).toContain("`padding: $pad`");
    expect(hover?.markdown).toContain("`border: 1px solid #ddd`");
  });

  test("hover renders defaults as real bullet lines and overrides as their own section", async () => {
    const state = await analyze(GROUP_DOCUMENT);
    const definition = hoverAt(GROUP_DOCUMENT, GROUP_DOCUMENT.indexOf("@group.card") + 3, {
      analysis: state.analysis,
    });
    expect(definition?.markdown).toBe(
      [
        "**@group.card** — group definition",
        "",
        "**Defaults**",
        "- `padding: 12px`",
        "- `color: black`",
      ].join("\n"),
    );

    const useSiteIndex = GROUP_DOCUMENT.indexOf("@group.card", 5);
    const useSite = hoverAt(GROUP_DOCUMENT, useSiteIndex + 4, { analysis: state.analysis });
    expect(useSite?.markdown).toBe(
      [
        "**@group.card** — group use site",
        "",
        "Defined in this file.",
        "",
        "**Defaults**",
        "- `padding: 12px`",
        "- `color: black`",
        "",
        "**Overrides at this use site**",
        "- `padding`",
      ].join("\n"),
    );

    const plainText = [
      "@group.card {",
      "  padding: 12px;",
      "  color: black;",
      "}",
      "",
      ".panel {",
      "  @group.card {",
      "    margin: 0;",
      "  }",
      "}",
    ].join("\n");
    const plainState = await analyze(plainText);
    const plainUseSiteIndex = plainText.indexOf("@group.card", 5);
    const plainUseSite = hoverAt(plainText, plainUseSiteIndex + 4, {
      analysis: plainState.analysis,
    });
    expect(plainUseSite?.markdown).toBe(
      [
        "**@group.card** — group use site",
        "",
        "Defined in this file.",
        "",
        "**Defaults**",
        "- `padding: 12px`",
        "- `color: black`",
      ].join("\n"),
    );

    const emptyText = [
      "@group.empty {",
      "}",
      "",
      ".panel {",
      "  @group.empty {",
      "    color: red;",
      "  }",
      "}",
    ].join("\n");
    const emptyState = await analyze(emptyText);
    const emptyDefinition = hoverAt(emptyText, emptyText.indexOf("@group.empty") + 3, {
      analysis: emptyState.analysis,
    });
    expect(emptyDefinition?.markdown).toBe(
      [
        "**@group.empty** — group definition",
        "",
        "_No default declarations; the group is inert._",
      ].join("\n"),
    );
    const emptyUseSiteIndex = emptyText.indexOf("@group.empty", 5);
    const emptyUseSite = hoverAt(emptyText, emptyUseSiteIndex + 4, {
      analysis: emptyState.analysis,
    });
    expect(emptyUseSite?.markdown).toBe(
      [
        "**@group.empty** — group use site",
        "",
        "Defined in this file.",
        "",
        "_No default declarations._",
      ].join("\n"),
    );
  });

  test("the @group keyword part of a definition and use site resolves to group hover", async () => {
    const state = await analyze(GROUP_DOCUMENT);
    const definition = hoverAt(GROUP_DOCUMENT, GROUP_DOCUMENT.indexOf("@group.card") + 3, {
      analysis: state.analysis,
    });
    expect(definition?.markdown).toContain("group definition");
    expect(definition?.markdown).toContain("`padding: 12px`");
    expect(definition?.markdown).not.toContain("Unknown media alias");

    const useSiteIndex = GROUP_DOCUMENT.indexOf("@group.card", 5);
    const useSite = hoverAt(GROUP_DOCUMENT, useSiteIndex + 4, { analysis: state.analysis });
    expect(useSite?.markdown).toContain("group use site");
    expect(useSite?.markdown).toContain("`padding: 12px`");
    expect(useSite?.markdown).toContain("**Defaults**");
    expect(useSite?.markdown).toContain("**Overrides at this use site**\n- `padding`");
    expect(useSite?.markdown).not.toContain("Unknown media alias");
  });

  test("a bare @group states the directive instead of a media-alias error", async () => {
    for (const text of ["@group", "@group."]) {
      const state = await analyze(text);
      const hover = hoverAt(text, 3, { analysis: state.analysis });
      expect(hover?.markdown).toContain("@group");
      expect(hover?.markdown).toContain("Xessa directive");
      expect(hover?.markdown).not.toContain("Unknown media alias");
    }
  });

  test("ambiguous and unknown use sites are stated explicitly", async () => {
    const ambiguous = fixture(AMBIGUOUS_IMPORT);
    const ambiguousState = await analyze(ambiguous, {}, AMBIGUOUS_IMPORT);
    const ambiguousHover = hoverAt(ambiguous, groupNameOffset(ambiguous, "card"), {
      analysis: ambiguousState.analysis,
    });
    expect(ambiguousHover?.markdown).toContain("Ambiguous group");
    expect(ambiguousHover?.markdown).toContain("a.cssx");
    expect(ambiguousHover?.markdown).toContain("b.cssx");

    const unknown = ".a { @group.nope { padding: 1px; } }";
    const unknownState = await analyze(unknown);
    const unknownHover = hoverAt(unknown, groupNameOffset(unknown, "nope"), {
      analysis: unknownState.analysis,
    });
    expect(unknownHover?.markdown).toContain("Unknown group");
  });

  test("outline lists the definition and use-site nodes", async () => {
    const state = await analyze(GROUP_DOCUMENT);
    const symbols = documentSymbols(state.analysis);
    const definition = symbols.find((symbol) => symbol.name === "@group.card");
    expect(definition?.kind).toBe("group");
    expect(definition?.detail).toBe("group definition");
    expect(definition?.children.map((child) => child.name)).toEqual(["padding", "color"]);

    const panel = symbols.find((symbol) => symbol.name === ".panel");
    const useSite = panel?.children.find((child) => child.name === "@group.card");
    expect(useSite?.kind).toBe("group");
    expect(useSite?.detail).toBe("group use");
    expect(useSite?.children.map((child) => child.name)).toEqual(["padding"]);
  });

  test("token references inside group definition and use-site bodies resolve (CSSX-U05)", async () => {
    const text = [
      "@variables {",
      "  gap: 8px;",
      "  radius: 3px;",
      "}",
      "@group.card {",
      "  padding: $gap;",
      "}",
      ".a {",
      "  padding: $gap;",
      "  @group.card {",
      "    border-radius: $radius;",
      "  }",
      "}",
    ].join("\n");
    const state = await analyze(text);
    // The analysis was already clean before the fix; it must stay clean.
    expect(state.analysis.problems).toEqual([]);

    const definitionOffset = text.indexOf("padding: $gap;") + "padding: $".length;
    const definitionHover = hoverAt(text, definitionOffset, { analysis: state.analysis });
    expect(definitionHover?.markdown).toContain("**$gap** — compile-time token");
    expect(definitionHover?.markdown).toContain("Value: `8px`");
    const definitionTargets = definitionsAt(text, definitionOffset, { analysis: state.analysis });
    expect(definitionTargets).toHaveLength(1);
    expect(definitionTargets[0]?.name).toBe("gap");
    // The target is the `@variables` declaration name, not the reference.
    expect(definitionTargets[0]?.range.start).toEqual({ line: 1, character: 2 });
    expect(definitionTargets[0]?.range.end).toEqual({ line: 1, character: 5 });

    const useSiteOffset = text.indexOf("border-radius: $radius") + "border-radius: $".length;
    const useSiteHover = hoverAt(text, useSiteOffset, { analysis: state.analysis });
    expect(useSiteHover?.markdown).toContain("**$radius** — compile-time token");
    expect(useSiteHover?.markdown).toContain("Value: `3px`");
    const useSiteTargets = definitionsAt(text, useSiteOffset, { analysis: state.analysis });
    expect(useSiteTargets).toHaveLength(1);
    expect(useSiteTargets[0]?.name).toBe("radius");
  });
});

describe("editor/compiler group agreement", () => {
  test("a use site the compiler reports ambiguous resolves ambiguous in the editor", async () => {
    const text = fixture(AMBIGUOUS_IMPORT);
    const state = await analyze(text, {}, AMBIGUOUS_IMPORT);
    const entry = state.analysis.groups.find((group) => group.name === "card");
    expect(entry?.kind).toBe("ambiguous");
    if (entry?.kind === "ambiguous") {
      expect(entry.candidates.map((candidate) => candidate.file.split("/").pop())).toEqual([
        "a.cssx",
        "b.cssx",
      ]);
    }
    const ambiguity = state.analysis.problems.find(
      (problem) => problem.code === "XESSA2001" && problem.message.includes("Ambiguous"),
    );
    expect(ambiguity).toBeDefined();
    expect(ambiguity?.message).toContain('"@group.card"');
  });

  test("a styles-imported group resolves in both the compiler and the editor", async () => {
    const text = fixture(STYLE_IMPORT);
    const state = await analyze(text, {}, STYLE_IMPORT);
    expect(state.analysis.problems).toEqual([]);
    const entry = state.analysis.groups.find((group) => group.name === "card");
    expect(entry?.kind).toBe("resolved");
    if (entry?.kind === "resolved") {
      expect(entry.symbol.file.endsWith("chrome.cssx")).toBe(true);
      expect(entry.symbol.references).toHaveLength(1);
    }
  });
});

const KEYFRAMES_SAME_FILE = "tests/fixtures/keyframes/same-file/input.cssx";
const KEYFRAMES_STYLE_IMPORT = "tests/fixtures/keyframes/style-import/entry.cssx";
const KEYFRAMES_TOKEN_ONLY = "tests/fixtures/keyframes/token-only/entry.cssx";
const KEYFRAMES_DUPLICATE = "tests/fixtures/keyframes/duplicate-name/entry.cssx";

const AMBIGUOUS_KEYFRAMES_PATH = "virtual/keyframes/ambiguous/entry.cssx";

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

/** Offset of the member name in the first `$keyframes.<name>` reference. */
function keyframeReferenceOffset(text: string, name: string, from = 0): number {
  return text.indexOf(`$keyframes.${name}`, from) + "$keyframes.".length;
}

describe("keyframe completion", () => {
  test("$keyframes. lists local names first and imported names with their module", async () => {
    const local = [
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
      "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }",
      ".page { animation-name: $keyframes. }",
    ].join("\n");
    const localState = await analyze(local);
    const offset = local.lastIndexOf("$keyframes.") + "$keyframes.".length;
    expect(contextAt(local, offset, localState.analysis)).toEqual({
      kind: "member",
      namespace: "keyframes",
      word: "",
    });
    const localItems = completionsAt(local, offset, { analysis: localState.analysis }).items;
    expect(labels(localItems)).toEqual(["spin", "fade"]);
    expect(localItems[0]?.detail).toContain("this file");
    expect(localItems[0]?.sortText).toBe("0-spin");
    expect(localItems[0]?.insertText).toBe("spin");

    const imported = fixture(KEYFRAMES_STYLE_IMPORT);
    const importedState = await analyze(imported, {}, KEYFRAMES_STYLE_IMPORT);
    const importedOffset = keyframeReferenceOffset(imported, "spin");
    const importedItems = completionsAt(imported, importedOffset, {
      analysis: importedState.analysis,
    }).items;
    expect(labels(importedItems)).toEqual(["spin"]);
    expect(importedItems[0]?.detail).toContain("motion.cssx");
    expect(importedItems[0]?.sortText).toBe("1-spin");
  });

  test("the typed member filters visible keyframe names", async () => {
    const text = [
      "@keyframes spin { from { opacity: 0; } }",
      "@keyframes fade { from { opacity: 0; } }",
      ".page { animation-name: $keyframes.fa }",
    ].join("\n");
    const state = await analyze(text);
    const offset = text.lastIndexOf("$keyframes.fa") + "$keyframes.fa".length;
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "member",
      namespace: "keyframes",
      word: "fa",
    });
    expect(labels(completionsAt(text, offset, { analysis: state.analysis }).items)).toEqual([
      "fade",
    ]);
  });

  test("duplicate names list each definition with its module and no diagnostic", async () => {
    const text = fixture(KEYFRAMES_DUPLICATE);
    const state = await analyze(text, {}, KEYFRAMES_DUPLICATE);
    expect(state.analysis.problems).toEqual([]);
    const offset = keyframeReferenceOffset(text, "spin");
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    expect(labels(items)).toEqual(["spin", "spin"]);
    expect(items[0]?.detail).toContain("this file");
    expect(items[0]?.sortText).toBe("0-spin");
    expect(items[1]?.detail).toContain("motion.cssx");
    expect(items[1]?.detail).toContain("duplicate name");
    expect(items[1]?.sortText).toBe("2-spin");
  });

  test("token-only imports expose no keyframe names", async () => {
    const text = fixture(KEYFRAMES_TOKEN_ONLY);
    const state = await analyze(text, {}, KEYFRAMES_TOKEN_ONLY);
    expect(state.analysis.keyframes).toEqual([]);
    const offset = keyframeReferenceOffset(text, "spin");
    expect(completionsAt(text, offset, { analysis: state.analysis }).items).toEqual([]);
  });
});

describe("keyframe hover", () => {
  test("a styles-imported reference shows the module and a frames summary", async () => {
    const text = fixture(KEYFRAMES_STYLE_IMPORT);
    const state = await analyze(text, {}, KEYFRAMES_STYLE_IMPORT);
    const index = text.indexOf("$keyframes.spin");
    const hover = hoverAt(text, index + "$keyframes.".length + 1, { analysis: state.analysis });
    expect(hover?.markdown).toContain("$keyframes.spin");
    expect(hover?.markdown).toContain("motion.cssx");
    expect(hover?.markdown).toContain("Frames: `from`, `to`");
    // The hover range covers the whole `$keyframes.spin` reference.
    expect(hover?.range).toEqual({
      start: positionAt(state.analysis.lineStarts, index),
      end: positionAt(state.analysis.lineStarts, index + "$keyframes.spin".length),
    });
  });

  test("the keyframes namespace word of a defined reference resolves to the keyframe hover", async () => {
    const text = fixture(KEYFRAMES_STYLE_IMPORT);
    const state = await analyze(text, {}, KEYFRAMES_STYLE_IMPORT);
    const index = text.indexOf("$keyframes.spin");
    // Inside `key|frames`, i.e. the namespace word, not the `$` or the name.
    const offset = index + "$key".length;
    const hover = hoverAt(text, offset, { analysis: state.analysis });
    expect(hover?.markdown).toContain("$keyframes.spin");
    expect(hover?.markdown).toContain("Frames: `from`, `to`");
    expect(hover?.range).toEqual({
      start: positionAt(state.analysis.lineStarts, index),
      end: positionAt(state.analysis.lineStarts, index + "$keyframes.spin".length),
    });
  });

  test("the keyframes namespace word of an unknown reference states the unknown hover", async () => {
    const text = ".page { animation-name: $keyframes.nope; }";
    const state = await analyze(text);
    const offset = text.indexOf("$keyframes.nope") + "$key".length;
    const hover = hoverAt(text, offset, { analysis: state.analysis });
    expect(hover?.markdown).toContain("Unknown keyframe");
    expect(hover?.markdown).toContain("XESSA2001");
  });

  test("a definition header shows its frames", async () => {
    const text = fixture(KEYFRAMES_SAME_FILE);
    const state = await analyze(text, {}, KEYFRAMES_SAME_FILE);
    const hover = hoverAt(text, text.indexOf("@keyframes spin") + "@keyframes s".length, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("@keyframes spin");
    expect(hover?.markdown).toContain("keyframe definition");
    expect(hover?.markdown).toContain("Frames: `from`, `to`");
  });

  test("percentage stops appear in the frames summary", async () => {
    const text = [
      "@keyframes pulse {",
      "  0% { opacity: 0; }",
      "  50% { opacity: 0.5; }",
      "  100% { opacity: 1; }",
      "}",
      ".page { animation-name: $keyframes.pulse; }",
    ].join("\n");
    const state = await analyze(text);
    const hover = hoverAt(text, keyframeReferenceOffset(text, "pulse") + 1, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("Frames: `0%`, `50%`, `100%`");
  });

  test("an unknown name states the XESSA2001 visibility rule", async () => {
    const text = ".page { animation-name: $keyframes.nope; }";
    const state = await analyze(text);
    const hover = hoverAt(text, keyframeReferenceOffset(text, "nope") + 1, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("Unknown keyframe");
    expect(hover?.markdown).toContain("XESSA2001");
    expect(hover?.markdown).toContain("token-only");
  });

  test("a name defined by two imported modules is ambiguous and names both", async () => {
    const text = [
      '@use "./a.cssx" styles;',
      '@use "./b.cssx" styles;',
      ".page { animation-name: $keyframes.spin; }",
    ].join("\n");
    const state = await analyze(
      text,
      { compile: false, readModule: virtualReader(ambiguousKeyframeModules()) },
      AMBIGUOUS_KEYFRAMES_PATH,
    );
    const hover = hoverAt(text, keyframeReferenceOffset(text, "spin") + 1, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("Ambiguous keyframe");
    expect(hover?.markdown).toContain("a.cssx");
    expect(hover?.markdown).toContain("b.cssx");
  });

  test("a local duplicate notes the shadowed import without calling it an error", async () => {
    const text = fixture(KEYFRAMES_DUPLICATE);
    const state = await analyze(text, {}, KEYFRAMES_DUPLICATE);
    const hover = hoverAt(text, keyframeReferenceOffset(text, "spin") + 1, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("Defined in this file.");
    expect(hover?.markdown).toContain("Also declared in");
    expect(hover?.markdown).toContain("motion.cssx");
    expect(hover?.markdown).not.toContain("Ambiguous keyframe");
  });
});

describe("keyframe outline and compiler agreement", () => {
  test("outline lists an @keyframes block with its name", async () => {
    const text = fixture(KEYFRAMES_SAME_FILE);
    const state = await analyze(text, {}, KEYFRAMES_SAME_FILE);
    const node = documentSymbols(state.analysis).find((symbol) => symbol.name === "@keyframes");
    expect(node?.kind).toBe("native");
    expect(node?.detail).toBe("spin");
  });

  test("a styles-imported keyframe resolves in both the compiler and the editor", async () => {
    const text = fixture(KEYFRAMES_STYLE_IMPORT);
    const state = await analyze(text, {}, KEYFRAMES_STYLE_IMPORT);
    expect(state.analysis.problems).toEqual([]);
    const entry = state.analysis.keyframes.find((keyframe) => keyframe.name === "spin");
    expect(entry?.kind).toBe("resolved");
    if (entry?.kind === "resolved") {
      expect(entry.symbol.file.endsWith("motion.cssx")).toBe(true);
      expect(entry.symbol.references).toHaveLength(1);
      expect(entry.duplicates).toEqual([]);
    }
  });

  test("a token-only import is invisible to the editor and XESSA2001 in the compiler", async () => {
    const text = fixture(KEYFRAMES_TOKEN_ONLY);
    const state = await analyze(text, {}, KEYFRAMES_TOKEN_ONLY);
    expect(state.analysis.keyframes).toEqual([]);
    const problem = state.analysis.problems.find((entry) => entry.code === "XESSA2001");
    expect(problem).toBeDefined();
    expect(problem?.message).toContain('"$keyframes.spin"');
    expect(problem?.message).toContain("styles");
  });

  test("duplicate names compile without a diagnostic and resolve to the local definition", async () => {
    const text = fixture(KEYFRAMES_DUPLICATE);
    const state = await analyze(text, {}, KEYFRAMES_DUPLICATE);
    expect(state.analysis.problems).toEqual([]);
    const entry = state.analysis.keyframes.find((keyframe) => keyframe.name === "spin");
    expect(entry?.kind).toBe("resolved");
    if (entry?.kind === "resolved") {
      expect(entry.symbol.file.endsWith("entry.cssx")).toBe(true);
      expect(entry.duplicates.map((duplicate) => duplicate.file.split("/").pop())).toEqual([
        "motion.cssx",
      ]);
    }
  });
});

describe("named colors, one-line rules and duplicate classes (A49)", () => {
  /** A suggestion with every field these tests inspect. */
  interface Item {
    readonly label: string;
    readonly kind?: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly insertText: string;
    readonly snippet?: string;
    readonly sortText?: string;
    readonly replaceStart?: number;
  }

  /** The item with `label`, or a failure listing what was offered. */
  function pick(items: readonly Item[], label: string): Item {
    const found = items.find((item) => item.label === label);
    if (found === undefined) {
      throw new Error(`missing suggestion "${label}" in [${items.map((i) => i.label).join(", ")}]`);
    }
    return found;
  }

  /** Only the named-color items of a result. */
  function colorsOf(items: readonly Item[]): Item[] {
    return items.filter((item) => item.detail === "CSS color");
  }

  /** Properties whose value grammar accepts a `<color>`. */
  const COLOR_PROPERTIES = [
    "color",
    "background-color",
    "border-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "text-decoration-color",
    "accent-color",
    "caret-color",
    "column-rule-color",
    "-webkit-tap-highlight-color",
    "-webkit-text-fill-color",
    "-webkit-text-stroke-color",
    "fill",
    "stroke",
  ] as const;

  /** Document text after accepting one suggestion (a snippet's `$0` is the caret). */
  function applySnippet(
    text: string,
    result: { readonly replaceStart: number; readonly replaceEnd: number },
    item: Item,
  ): { readonly text: string; readonly caret: number } {
    const insert = item.snippet ?? item.insertText;
    const caretInInsert = insert.indexOf("$0");
    const plain = caretInInsert < 0 ? insert : insert.replace("$0", "");
    const start = item.replaceStart ?? result.replaceStart;
    return {
      text: text.slice(0, start) + plain + text.slice(result.replaceEnd),
      caret: start + (caretInInsert < 0 ? plain.length : caretInInsert),
    };
  }

  test("every color-accepting property offers the standard named colors", async () => {
    for (const property of COLOR_PROPERTIES) {
      const text = `.a {\n  ${property}: \n}`;
      const offset = text.indexOf(`${property}: `) + `${property}: `.length;
      const state = await analyze(text);
      expect(contextAt(text, offset, state.analysis)).toEqual({
        kind: "value",
        property,
        word: "",
      });
      const result = completionsAt(text, offset, { analysis: state.analysis });
      const colors = colorsOf(result.items);
      // The full standard set (CSS Color 4 named colors, no keywords).
      expect(colors.length).toBe(148);
      for (const name of ["aliceblue", "rebeccapurple", "red", "yellowgreen"]) {
        expect(colors.some((item) => item.label === name)).toBe(true);
      }
      const red = pick(result.items, "red");
      // A51: colors are `color` items so the suggest widget paints a swatch.
      expect(red.kind).toBe("color");
      expect(red.detail).toBe("CSS color");
      expect(red.insertText).toBe("red");
      // Stable `0-` family: alphabetical among keyword values, before functions.
      expect(red.sortText).toBe("0-red");
      expect(red.snippet).toBeUndefined();
      expect(red.replaceStart).toBeUndefined();
      expect(accept(text, result, red)).toBe(`.a {\n  ${property}: red\n}`);
      // The existing families keep their place beside the colors.
      expect(labels(result.items)).toContain("auto");
      expect(labels(result.items)).toContain("calc(");
      expect(pick(result.items, "auto").sortText).toBe("0-auto");
      expect(pick(result.items, "calc(").sortText).toBe("1-calc");
    }
  });

  test("the typed word filters the colors and non-color properties stay color-free", async () => {
    const text = ".a {\n  background-color: re\n}";
    const offset = text.indexOf("background-color: re") + "background-color: re".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "background-color",
      word: "re",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    // Constant order is alphabetical, so `rebeccapurple` precedes `red`.
    expect(colorsOf(result.items).map((item) => item.label)).toEqual(["rebeccapurple", "red"]);
    for (const color of colorsOf(result.items)) {
      expect(color.label.startsWith("re")).toBe(true);
      expect(color.sortText).toBe(`0-${color.label}`);
    }
    // Keyword values and functions are filtered by the same word, untouched.
    expect(labels(result.items)).toContain("relative");
    expect(labels(result.items)).toContain("repeating-linear-gradient(");
    expect(accept(text, result, pick(result.items, "red"))).toBe(
      ".a {\n  background-color: red\n}",
    );

    // A property that accepts no `<color>` never lists one.
    for (const property of ["width", "display", "margin", "opacity", "font-weight"]) {
      const shaped = `.a {\n  ${property}: \n}`;
      const shapedOffset = shaped.indexOf(`${property}: `) + `${property}: `.length;
      const shapedState = await analyze(shaped);
      const items = completionsAt(shaped, shapedOffset, { analysis: shapedState.analysis }).items;
      expect(colorsOf(items)).toEqual([]);
      const all = labels(items);
      expect(all).not.toContain("red");
      expect(all).not.toContain("rebeccapurple");
      expect(all).not.toContain("aliceblue");
    }
  });

  test("one-line rule bodies classify exactly like multi-line rules", async () => {
    const shapes: readonly {
      readonly oneLine: string;
      readonly oneMarker: string;
      readonly multiLine: string;
      readonly multiMarker: string;
      readonly context: { readonly kind: string; readonly word: string };
    }[] = [
      {
        oneLine: ".a { color: ; }",
        oneMarker: ".a { color: ",
        multiLine: ".a {\n  color: ;\n}",
        multiMarker: "\n  color: ",
        context: { kind: "value", word: "" },
      },
      {
        oneLine: ".a { color: }",
        oneMarker: ".a { color: ",
        multiLine: ".a {\n  color: \n}",
        multiMarker: "\n  color: ",
        context: { kind: "value", word: "" },
      },
      {
        oneLine: ".a { color: re; }",
        oneMarker: ".a { color: re",
        multiLine: ".a {\n  color: re;\n}",
        multiMarker: "\n  color: re",
        context: { kind: "value", word: "re" },
      },
      {
        oneLine: ".a { col }",
        oneMarker: ".a { col",
        multiLine: ".a {\n  col\n}",
        multiMarker: "\n  col",
        context: { kind: "property", word: "col" },
      },
      {
        oneLine: ".a { }",
        oneMarker: ".a { ",
        multiLine: ".a {\n  \n}",
        multiMarker: "\n  ",
        context: { kind: "property", word: "" },
      },
      {
        oneLine: ".a { color: red; col }",
        oneMarker: ".a { color: red; col",
        multiLine: ".a {\n  color: red;\n  col\n}",
        multiMarker: "\n  col",
        context: { kind: "property", word: "col" },
      },
      {
        oneLine: ".a { color: red; background: }",
        oneMarker: ".a { color: red; background: ",
        multiLine: ".a {\n  color: red;\n  background: \n}",
        multiMarker: "\n  background: ",
        context: { kind: "value", word: "" },
      },
      {
        oneLine: ".a { &:hover { color: } }",
        oneMarker: ".a { &:hover { color: ",
        multiLine: ".a {\n  &:hover { color: \n  }\n}",
        multiMarker: "&:hover { color: ",
        context: { kind: "value", word: "" },
      },
      {
        oneLine: ".a { &:hover { color: ; } }",
        oneMarker: ".a { &:hover { color: ",
        multiLine: ".a {\n  &:hover { color: ; }\n}",
        multiMarker: "&:hover { color: ",
        context: { kind: "value", word: "" },
      },
      {
        oneLine: ".a { &:hover { col } }",
        oneMarker: ".a { &:hover { col",
        multiLine: ".a {\n  &:hover {\n    col\n  }\n}",
        multiMarker: "    col",
        context: { kind: "property", word: "col" },
      },
      {
        oneLine: "@media (min-width: 600px) { .a { col } }",
        oneMarker: ".a { col",
        multiLine: "@media (min-width: 600px) {\n  .a {\n    col\n  }\n}",
        multiMarker: "    col",
        context: { kind: "property", word: "col" },
      },
      {
        oneLine: ".a{col}",
        oneMarker: ".a{col",
        multiLine: ".a{\ncol\n}",
        multiMarker: "\ncol",
        context: { kind: "property", word: "col" },
      },
    ];
    for (const shape of shapes) {
      const oneOffset = shape.oneLine.indexOf(shape.oneMarker) + shape.oneMarker.length;
      const multiOffset = shape.multiLine.indexOf(shape.multiMarker) + shape.multiMarker.length;
      const oneState = await analyze(shape.oneLine);
      const multiState = await analyze(shape.multiLine);
      const oneContext = contextAt(shape.oneLine, oneOffset, oneState.analysis);
      const multiContext = contextAt(shape.multiLine, multiOffset, multiState.analysis);
      expect(oneContext).toMatchObject(shape.context);
      expect(multiContext).toEqual(oneContext);
      const oneResult = completionsAt(shape.oneLine, oneOffset, {
        analysis: oneState.analysis,
      });
      const multiResult = completionsAt(shape.multiLine, multiOffset, {
        analysis: multiState.analysis,
      });
      expect(labels(oneResult.items)).toEqual(labels(multiResult.items));
      expect(oneResult.replaceStart).toBe(oneOffset - shape.context.word.length);
    }

    // Accepting in a one-line rule edits only the cursor word.
    const valueLine = ".a { color: ; }";
    const valueOffset = valueLine.indexOf(".a { color: ") + ".a { color: ".length;
    const valueState = await analyze(valueLine);
    const valueResult = completionsAt(valueLine, valueOffset, { analysis: valueState.analysis });
    expect(accept(valueLine, valueResult, pick(valueResult.items, "red"))).toBe(
      ".a { color: red; }",
    );

    const nestedLine = ".a { &:hover { color: } }";
    const nestedOffset = nestedLine.indexOf("&:hover { color: ") + "&:hover { color: ".length;
    const nestedState = await analyze(nestedLine);
    const nestedResult = completionsAt(nestedLine, nestedOffset, {
      analysis: nestedState.analysis,
    });
    expect(accept(nestedLine, nestedResult, pick(nestedResult.items, "red"))).toBe(
      ".a { &:hover { color: red} }",
    );

    // Property typing carries the A48 snippet and covers only the typed word.
    const propertyLine = ".a { col }";
    const propertyOffset = propertyLine.indexOf(".a { col") + ".a { col".length;
    const propertyState = await analyze(propertyLine);
    const propertyResult = completionsAt(propertyLine, propertyOffset, {
      analysis: propertyState.analysis,
    });
    const color = pick(propertyResult.items, "color");
    expect(color.snippet).toBe("color: $0;");
    expect(propertyResult.replaceStart).toBe(propertyLine.indexOf("col"));
    const applied = applySnippet(propertyLine, propertyResult, color);
    expect(applied.text).toBe(".a { color: ; }");
    expect(applied.caret).toBe(propertyLine.indexOf("col") + "color: ".length);
  });

  test("class suggestions list every distinct name exactly once", async () => {
    const docs: readonly { readonly text: string; readonly cursor: string }[] = [
      {
        // The class is defined once and referenced again through `&.class`.
        text: ".a { &.class { color: red; } }\n.class { color: blue; }",
        cursor: "&.cl",
      },
      {
        text: ".class { color: blue; }\n.a { &.class { color: red; } }",
        cursor: "&.cl",
      },
      {
        // Two definitions of the same name.
        text: ".class { color: blue; }\n.a {\n  &.cl\n}\n.class:hover { color: red; }",
        cursor: "&.cl",
      },
      {
        // Plain class typed at a rule-body top level.
        text: ".class { color: blue; }\n.a { &.class { color: red; } }\n.b { .cl }",
        cursor: ".cl",
      },
    ];
    for (const doc of docs) {
      const cursorEnd = doc.text.lastIndexOf(doc.cursor) + doc.cursor.length;
      const state = await analyze(doc.text);
      // The analysis keeps one occurrence per authored class token.
      expect(state.analysis.classes.filter((entry) => entry.name === "class").length).toBe(2);
      expect(contextAt(doc.text, cursorEnd, state.analysis)).toMatchObject({ kind: "selector" });
      const items = completionsAt(doc.text, cursorEnd, { analysis: state.analysis }).items;
      const classItems = items.filter((item) => item.label === ".class");
      expect(classItems.length).toBe(1);
      // Every other class keeps its own single item.
      expect(items.filter((item) => item.label === ".a").length).toBeLessThanOrEqual(1);
      // A class context lists classes only: a `&` starter appended after the
      // typed dot would yield `&.&:hover` (CSSX-U03).
      expect(items.filter((item) => item.label.startsWith("&"))).toEqual([]);
    }

    // Accepting the single `.class` item keeps the typed dot (A46).
    const dot = ".a { &.cl }\n.class { color: blue; }";
    const dotOffset = dot.indexOf("&.cl") + "&.cl".length;
    const dotState = await analyze(dot);
    const dotResult = completionsAt(dot, dotOffset, { analysis: dotState.analysis });
    expect(accept(dot, dotResult, pick(dotResult.items, ".class"))).toBe(
      ".a { &.class }\n.class { color: blue; }",
    );

    // A generated class and the same name inside `:global(...)` collapse into
    // one item that keeps the useful generated detail, in either authored order.
    const globalFirst =
      '@setup { prefix: "ui"; }\n.a { :global(.icon) { color: blue; } }\n.icon { color: red; }\n.b { &.ic }';
    const localFirst =
      '@setup { prefix: "ui"; }\n.icon { color: red; }\n.a { :global(.icon) { color: blue; } }\n.b { &.ic }';
    for (const doc of [globalFirst, localFirst]) {
      const offset = doc.indexOf("&.ic") + "&.ic".length;
      const state = await analyze(doc);
      const items = completionsAt(doc, offset, { analysis: state.analysis }).items;
      const icons = items.filter((item) => item.label === ".icon");
      expect(icons.length).toBe(1);
      expect(icons[0]?.detail).toBe("generated class .ui-icon");
      expect(items.filter((item) => item.label === ".a").length).toBe(1);
      expect(items.filter((item) => item.label === ".b").length).toBe(1);
    }
  });
});

describe("paren-triggered function suggestions (A50)", () => {
  /** A suggestion with every field these tests inspect. */
  interface Item {
    readonly label: string;
    readonly kind?: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly insertText: string;
    readonly snippet?: string;
    readonly sortText?: string;
    readonly replaceStart?: number;
  }

  /** The curated functions in constant order; the paren state offers exactly these. */
  const FUNCTION_LABELS = [
    "calc(",
    "min(",
    "max(",
    "clamp(",
    "var(",
    "env(",
    "attr(",
    "url(",
    "rgb(",
    "rgba(",
    "hsl(",
    "hsla(",
    "color-mix(",
    "linear-gradient(",
    "radial-gradient(",
    "conic-gradient(",
    "repeating-linear-gradient(",
    "cubic-bezier(",
    "steps(",
    "translate(",
    "rotate(",
    "scale(",
    "blur(",
    "brightness(",
    "counter(",
  ] as const;

  /** Offset directly after the last `token` in `text`. */
  function cursorAfter(text: string, token: string): number {
    const start = text.lastIndexOf(token);
    if (start < 0) throw new Error(`missing token "${token}"`);
    return start + token.length;
  }

  /** The item with `label`, or a failure listing what was offered. */
  function pick(items: readonly Item[], label: string): Item {
    const found = items.find((item) => item.label === label);
    if (found === undefined) {
      throw new Error(`missing suggestion "${label}" in [${items.map((i) => i.label).join(", ")}]`);
    }
    return found;
  }

  /** Document text after accepting one item over its own replacement range. */
  function applyAccept(
    text: string,
    result: { readonly replaceStart: number; readonly replaceEnd: number },
    item: Item,
  ): string {
    const start = item.replaceStart ?? result.replaceStart;
    return text.slice(0, start) + item.insertText + text.slice(result.replaceEnd);
  }

  /** Every item is a curated function; nothing from the keyword/color/unit families. */
  function expectFunctionsOnly(items: readonly Item[]): void {
    expect(items.length).toBe(FUNCTION_LABELS.length);
    expect(items.map((item) => item.label)).toEqual([...FUNCTION_LABELS]);
    expect(items.every((item) => item.detail === "CSS function")).toBe(true);
    expect(items.every((item) => item.kind === "value")).toBe(true);
  }

  test("a typed paren in a value position offers only the curated functions", async () => {
    for (const property of [
      "width",
      "color",
      "background-color",
      "margin",
      "opacity",
      "transform",
    ]) {
      const text = `.a {\n  ${property}: (\n}`;
      const offset = cursorAfter(text, `${property}: (`);
      const state = await analyze(text);
      // The context is the ordinary value context; the paren state is a
      // completion concern so nothing authored changes shape.
      expect(contextAt(text, offset, state.analysis)).toEqual({
        kind: "value",
        property,
        word: "",
      });
      const result = completionsAt(text, offset, { analysis: state.analysis });
      expectFunctionsOnly(result.items);

      // Every item replaces the typed `(` so accepting swaps the opener.
      for (const item of result.items) expect(item.replaceStart).toBe(offset - 1);
      // No keyword values, named colors or units leak into the state.
      expect(labels(result.items)).not.toContain("auto");
      expect(result.items.some((item) => item.detail === "CSS color")).toBe(false);
      expect(result.items.some((item) => item.detail === "CSS unit")).toBe(false);

      const calc = pick(result.items, "calc(");
      expect(calc.sortText).toBe("1-calc");
      expect(calc.snippet).toBeUndefined();
      expect(calc.insertText).toBe("calc(");
      const clampItem = pick(result.items, "clamp(");
      expect(clampItem.documentation).toContain("Clamps a preferred value");
      expect(clampItem.documentation).toContain("Example: `clamp(0.5rem, 1rem + 2vw, 2rem)`");
      // The curated `var` insert form is kept in the paren state.
      const varItem = pick(result.items, "var(");
      expect(varItem.insertText).toBe("var(--");
      expect(applyAccept(text, result, varItem)).toBe(`.a {\n  ${property}: var(--\n}`);
      // Accepting replaces the typed `(` instead of duplicating it.
      expect(applyAccept(text, result, clampItem)).toBe(`.a {\n  ${property}: clamp(\n}`);
    }
  });

  test("the word after the paren filters the functions and the range still covers the paren", async () => {
    const text = ".a {\n  width: (cl\n}";
    const offset = cursorAfter(text, "width: (cl");
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "width",
      word: "cl",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(labels(result.items)).toEqual(["clamp("]);
    const clampItem = pick(result.items, "clamp(");
    // The range covers `(cl`, not just `cl`, so the typed paren is swapped.
    expect(clampItem.replaceStart).toBe(offset - 3);
    expect(applyAccept(text, result, clampItem)).toBe(".a {\n  width: clamp(\n}");

    // A keyword value that shares the prefix stays out of the paren state:
    // before this change `margin: (re` listed `relative` and `revert`.
    const margin = ".a {\n  margin: (re\n}";
    const marginOffset = cursorAfter(margin, "margin: (re");
    const marginState = await analyze(margin);
    const marginResult = completionsAt(margin, marginOffset, { analysis: marginState.analysis });
    expect(labels(marginResult.items)).toEqual(["repeating-linear-gradient("]);

    // The filter word is the text after the paren, in constant order.
    const wide = ".a {\n  width: (c\n}";
    const wideOffset = cursorAfter(wide, "width: (c");
    const wideState = await analyze(wide);
    const wideResult = completionsAt(wide, wideOffset, { analysis: wideState.analysis });
    expect(labels(wideResult.items)).toEqual([
      "calc(",
      "clamp(",
      "color-mix(",
      "conic-gradient(",
      "cubic-bezier(",
      "counter(",
    ]);

    // A one-line rule body filters the same way.
    const oneLine = ".a { width: (cl }";
    const oneLineOffset = cursorAfter(oneLine, "width: (cl");
    const oneLineState = await analyze(oneLine);
    const oneLineResult = completionsAt(oneLine, oneLineOffset, {
      analysis: oneLineState.analysis,
    });
    expect(labels(oneLineResult.items)).toEqual(["clamp("]);
    expect(applyAccept(oneLine, oneLineResult, pick(oneLineResult.items, "clamp("))).toBe(
      ".a { width: clamp( }",
    );
  });

  test("the paren state reaches every authored value shape", async () => {
    const shapes: readonly {
      readonly text: string;
      readonly token: string;
      readonly accepted: string;
    }[] = [
      {
        text: ".a { width: ( }",
        token: "width: (",
        accepted: ".a { width: clamp( }",
      },
      {
        text: ".a {\n  &:hover {\n    color: (\n  }\n}",
        token: "color: (",
        accepted: ".a {\n  &:hover {\n    color: clamp(\n  }\n}",
      },
      {
        text: "@media (min-width: 600px) { .a { width: ( } }",
        token: "width: (",
        accepted: "@media (min-width: 600px) { .a { width: clamp( } }",
      },
      {
        text: "@keyframes spin {\n  from {\n    width: (\n  }\n}",
        token: "width: (",
        accepted: "@keyframes spin {\n  from {\n    width: clamp(\n  }\n}",
      },
    ];
    for (const shape of shapes) {
      const offset = cursorAfter(shape.text, shape.token);
      const state = await analyze(shape.text);
      expect(contextAt(shape.text, offset, state.analysis)).toMatchObject({ kind: "value" });
      const result = completionsAt(shape.text, offset, { analysis: state.analysis });
      expectFunctionsOnly(result.items);
      expect(pick(result.items, "clamp(").replaceStart).toBe(offset - 1);
      expect(applyAccept(shape.text, result, pick(result.items, "clamp("))).toBe(shape.accepted);
    }

    // A second opener behaves like the first, for nested and top-level values
    // that were not required but are trivially reachable.
    const nested = ".a {\n  width: calc((\n}";
    const nestedOffset = cursorAfter(nested, "calc((");
    const nestedState = await analyze(nested);
    const nestedResult = completionsAt(nested, nestedOffset, { analysis: nestedState.analysis });
    expectFunctionsOnly(nestedResult.items);
    expect(pick(nestedResult.items, "clamp(").replaceStart).toBe(nestedOffset - 1);
    expect(applyAccept(nested, nestedResult, pick(nestedResult.items, "clamp("))).toBe(
      ".a {\n  width: calc(clamp(\n}",
    );

    // `@setup` values and selector positions keep their pre-change behaviour:
    // the paren state is a declaration-value concern only.
    const setup = "@setup {\n  prefix: (\n}";
    const setupOffset = cursorAfter(setup, "prefix: (");
    const setupState = await analyze(setup);
    expect(contextAt(setup, setupOffset, setupState.analysis)).toMatchObject({
      kind: "setup-value",
    });
    expect(completionsAt(setup, setupOffset, { analysis: setupState.analysis }).items).toEqual([]);

    const selector = ".a { .cl( }";
    const selectorOffset = cursorAfter(selector, ".cl(");
    const selectorState = await analyze(selector);
    expect(contextAt(selector, selectorOffset, selectorState.analysis)).toMatchObject({
      kind: "selector",
    });
    const selectorResult = completionsAt(selector, selectorOffset, {
      analysis: selectorState.analysis,
    });
    expect(selectorResult.items.some((item) => item.detail === "CSS function")).toBe(false);
  });

  test("editing inside an existing call keeps the ordinary value behaviour", async () => {
    // A cursor after value content inside the call: units after a number, and
    // no function item ever covers the call's own opener.
    const inside = ".a {\n  width: calc(100% - 2\n}";
    const insideOffset = cursorAfter(inside, "calc(100% - 2");
    const insideState = await analyze(inside);
    const insideResult = completionsAt(inside, insideOffset, { analysis: insideState.analysis });
    expect(insideResult.items.length).toBe(27);
    expect(insideResult.items.every((item) => item.detail === "CSS unit")).toBe(true);
    expect(insideResult.items.some((item) => item.label === "clamp(")).toBe(false);

    // A cursor right after the value content (`100%` is not a word: `%` ends the
    // scan) keeps the ordinary list and no paren-replacing range.
    const afterContent = ".a {\n  width: calc(100%\n}";
    const afterContentOffset = cursorAfter(afterContent, "calc(100%");
    const afterContentState = await analyze(afterContent);
    const afterContentResult = completionsAt(afterContent, afterContentOffset, {
      analysis: afterContentState.analysis,
    });
    expect(afterContentResult.items.length).toBe(53);
    expect(labels(afterContentResult.items)).toContain("auto");
    expect(labels(afterContentResult.items)).toContain("clamp(");
    expect(pick(afterContentResult.items, "clamp(").replaceStart).toBeUndefined();
    expect(afterContentResult.replaceStart).toBe(afterContentOffset);

    // A paren that belongs to a named call is not an opener the author can
    // replace: `calc(` keeps the ordinary list, so accepting cannot eat it.
    const namedCall = ".a {\n  width: calc(\n}";
    const namedCallOffset = cursorAfter(namedCall, "width: calc(");
    const namedCallState = await analyze(namedCall);
    const namedCallResult = completionsAt(namedCall, namedCallOffset, {
      analysis: namedCallState.analysis,
    });
    expect(namedCallResult.items.length).toBe(53);
    const namedClamp = pick(namedCallResult.items, "clamp(");
    expect(namedClamp.replaceStart).toBeUndefined();
    expect(applyAccept(namedCall, namedCallResult, namedClamp)).toBe(
      ".a {\n  width: calc(clamp(\n}",
    );

    // The same guard holds for a call already typing an argument-less opener.
    const typedCall = ".a {\n  width: (clamp(\n}";
    const typedCallOffset = cursorAfter(typedCall, "width: (clamp(");
    const typedCallState = await analyze(typedCall);
    const typedCallResult = completionsAt(typedCall, typedCallOffset, {
      analysis: typedCallState.analysis,
    });
    expect(typedCallResult.items.length).toBe(53);
    expect(pick(typedCallResult.items, "clamp(").replaceStart).toBeUndefined();

    // A48/A49 families are untouched outside the paren state.
    const plain = ".a {\n  width: \n}";
    const plainState = await analyze(plain);
    const plainItems = completionsAt(plain, cursorAfter(plain, "width: "), {
      analysis: plainState.analysis,
    }).items;
    expect(plainItems.length).toBe(53);
    const color = ".a {\n  color: \n}";
    const colorState = await analyze(color);
    const colorItems = completionsAt(color, cursorAfter(color, "color: "), {
      analysis: colorState.analysis,
    }).items;
    expect(colorItems.length).toBe(236);
    expect(colorItems.filter((item) => item.detail === "CSS color").length).toBe(148);
    // A51 added the curated hex palette beside the named colors.
    expect(colorItems.filter((item) => item.label.startsWith("#")).length).toBe(35);
    const unit = ".a {\n  margin: 1\n}";
    const unitState = await analyze(unit);
    const unitItems = completionsAt(unit, cursorAfter(unit, "margin: 1"), {
      analysis: unitState.analysis,
    }).items;
    expect(unitItems.length).toBe(27);
  });

  test("the completion provider registers ( as a trigger character", () => {
    // The controller imports `vscode`, so the trigger list is asserted from its
    // source: `(` is not a word character and needs an explicit trigger.
    const source = readFileSync(join(ROOT, "packages/vscode/src/controller.ts"), "utf8");
    const start = source.indexOf("vscode.languages.registerCompletionItemProvider(");
    expect(start).toBeGreaterThan(-1);
    const registration = source.slice(start, start + 400);
    for (const trigger of ["@", "$", ".", ":", "/", "&", "("]) {
      expect(registration).toContain(`"${trigger}",`);
    }
  });
});

describe("hex colors, color kind, decorations and filter text (A51)", () => {
  /** A suggestion with every field these tests inspect. */
  interface Item {
    readonly label: string;
    readonly kind?: string;
    readonly detail?: string;
    readonly insertText: string;
    readonly snippet?: string;
    readonly sortText?: string;
    readonly replaceStart?: number;
    readonly filterText?: string;
  }

  /** Properties whose value grammar accepts a `<color>` (A49 derivation). */
  const COLOR_PROPERTIES = [
    "color",
    "background-color",
    "border-color",
    "border-top-color",
    "outline-color",
    "text-decoration-color",
    "accent-color",
    "caret-color",
    "column-rule-color",
    "-webkit-tap-highlight-color",
    "-webkit-text-fill-color",
    "-webkit-text-stroke-color",
    "fill",
    "stroke",
  ] as const;

  /** The curated palette in constant order, so order changes are visible. */
  const PALETTE_HEAD = ["#000000", "#111827", "#374151", "#6b7280", "#9ca3af"];

  /** Offset directly after the last `token` in `text`. */
  function cursorAfter(text: string, token: string): number {
    const start = text.lastIndexOf(token);
    if (start < 0) throw new Error(`missing token "${token}"`);
    return start + token.length;
  }

  /** The item with `label`, or a failure listing what was offered. */
  function pick(items: readonly Item[], label: string): Item {
    const found = items.find((item) => item.label === label);
    if (found === undefined) {
      throw new Error(`missing suggestion "${label}" in [${items.map((i) => i.label).join(", ")}]`);
    }
    return found;
  }

  /** Only the named colours (the hex items carry their hex in the detail). */
  function named(items: readonly Item[]): Item[] {
    return items.filter((item) => item.detail === "CSS color");
  }

  /** Only the curated hex items. */
  function hex(items: readonly Item[]): Item[] {
    return items.filter((item) => item.label.startsWith("#"));
  }

  /** Document text after accepting one item over its own replacement range. */
  function applyAccept(
    text: string,
    result: { readonly replaceStart: number; readonly replaceEnd: number },
    item: Item,
  ): string {
    const start = item.replaceStart ?? result.replaceStart;
    return text.slice(0, start) + item.insertText + text.slice(result.replaceEnd);
  }

  test("a color property offers named colors and the curated hex palette", async () => {
    for (const property of COLOR_PROPERTIES) {
      const text = `.a {\n  ${property}: \n}`;
      const offset = cursorAfter(text, `${property}: `);
      const state = await analyze(text);
      const result = completionsAt(text, offset, { analysis: state.analysis });
      expect(named(result.items).length).toBe(148);
      expect(hex(result.items).length).toBe(35);
      expect(result.items.filter((item) => item.kind === "color").length).toBe(183);
      for (const item of [...named(result.items), ...hex(result.items)]) {
        expect(item.kind).toBe("color");
      }
    }

    const text = ".a {\n  color: \n}";
    const state = await analyze(text);
    const result = completionsAt(text, cursorAfter(text, "color: "), {
      analysis: state.analysis,
    });
    // Palette order is authored (neutrals first), not re-sorted by label.
    expect(
      hex(result.items)
        .map((item) => item.label)
        .slice(0, 5),
    ).toEqual(PALETTE_HEAD);
    const swatch = pick(result.items, "#e74c3c");
    expect(swatch.kind).toBe("color");
    expect(swatch.detail).toBe("CSS color #e74c3c");
    expect(swatch.insertText).toBe("#e74c3c");
    expect(swatch.sortText).toBe("0-#e74c3c");
    expect(swatch.snippet).toBeUndefined();
    expect(swatch.replaceStart).toBeUndefined();
    expect(applyAccept(text, result, swatch)).toBe(".a {\n  color: #e74c3c\n}");
    // The named colors keep their A49 shape and the families keep their place.
    const red = pick(result.items, "red");
    expect(red.kind).toBe("color");
    expect(red.detail).toBe("CSS color");
    expect(red.sortText).toBe("0-red");
    expect(pick(result.items, "auto").sortText).toBe("0-auto");
    expect(pick(result.items, "calc(").sortText).toBe("1-calc");
    // A typed word filters the names; the palette joins only for an empty word.
    const typed = ".a {\n  color: re\n}";
    const typedState = await analyze(typed);
    const typedResult = completionsAt(typed, cursorAfter(typed, "color: re"), {
      analysis: typedState.analysis,
    });
    expect(named(typedResult.items).map((item) => item.label)).toEqual(["rebeccapurple", "red"]);
    expect(hex(typedResult.items)).toEqual([]);

    // A property without a `<color>` offers neither family.
    for (const property of ["width", "display", "margin", "opacity", "font-weight"]) {
      const shaped = `.a {\n  ${property}: \n}`;
      const shapedState = await analyze(shaped);
      const items = completionsAt(shaped, cursorAfter(shaped, `${property}: `), {
        analysis: shapedState.analysis,
      }).items;
      expect(named(items)).toEqual([]);
      expect(hex(items)).toEqual([]);
      expect(items.some((item) => item.kind === "color")).toBe(false);
    }
  });

  test("vendor color properties offer the named colors too", async () => {
    // The curated vendor color longhands inherit the same value list, so a named
    // color accepts exactly like it does for the standard `color` property.
    const text = ".a {\n  -webkit-text-fill-color: re\n}";
    const offset = cursorAfter(text, "-webkit-text-fill-color: re");
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "-webkit-text-fill-color",
      word: "re",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(named(result.items).map((item) => item.label)).toEqual(["rebeccapurple", "red"]);
    const red = pick(result.items, "red");
    expect(applyAccept(text, result, red)).toBe(".a {\n  -webkit-text-fill-color: red\n}");
  });

  test("a typed # lists the colors and replaces the typed prefix", async () => {
    const text = ".a {\n  color: #\n}";
    const offset = cursorAfter(text, "color: #");
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "color",
      word: "",
    });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    // Only colours: no keyword values, units or functions behind a `#`.
    expect(result.items.length).toBe(183);
    expect(result.items.every((item) => item.kind === "color")).toBe(true);
    const hash = offset - 1;
    const swatch = pick(result.items, "#e74c3c");
    expect(swatch.replaceStart).toBe(hash);
    expect(applyAccept(text, result, swatch)).toBe(".a {\n  color: #e74c3c\n}");
    const red = pick(result.items, "red");
    expect(red.replaceStart).toBe(hash);
    // Accepting the name drops the typed `#` instead of gluing `#red` together.
    expect(applyAccept(text, result, red)).toBe(".a {\n  color: red\n}");

    /** Labels offered for one authored cursor. */
    async function labelsAt(typed: string): Promise<Item[]> {
      const doc = `.a {\n  ${typed}\n}`;
      const docState = await analyze(doc);
      return completionsAt(doc, cursorAfter(doc, typed), { analysis: docState.analysis }).items;
    }

    // `#f` narrows the palette by hex digits and matches names whose hex starts
    // with `f`, plus names that start with `f` themselves.
    const f = await labelsAt("color: #f");
    expect(hex(f).map((item) => item.label)).toEqual([
      "#ffffff",
      "#f97316",
      "#f59e0b",
      "#fbbf24",
      "#f43f5e",
    ]);
    const names = named(f);
    expect(names.length).toBe(49);
    // Names match either by their own prefix (`fuchsia`) or by their hex
    // (`red` is `#ff0000`, `aliceblue` is `#f0f8ff`); a name whose hex and name
    // both miss is absent (`blue` is `#0000ff`, `olive` is `#808000`).
    expect(names.some((item) => item.label === "fuchsia")).toBe(true);
    expect(names.some((item) => item.label === "red")).toBe(true);
    expect(names.some((item) => item.label === "aliceblue")).toBe(true);
    expect(names.some((item) => item.label === "blue")).toBe(false);
    expect(names.some((item) => item.label === "olive")).toBe(false);

    // A longer prefix narrows further: no palette entry starts with `f0`.
    const f0 = await labelsAt("color: #f0");
    expect(hex(f0)).toEqual([]);
    expect(named(f0).map((item) => item.label)).toEqual([
      "aliceblue",
      "azure",
      "honeydew",
      "khaki",
      "lightcoral",
    ]);
    const e7 = await labelsAt("color: #e7");
    expect(hex(e7).map((item) => item.label)).toEqual(["#e74c3c"]);
    expect(named(e7)).toEqual([]);

    // Accepting after a typed prefix replaces the whole `#…`, never appends.
    const typedText = ".a {\n  color: #e7\n}";
    const typedState = await analyze(typedText);
    const typedResult = completionsAt(typedText, cursorAfter(typedText, "color: #e7"), {
      analysis: typedState.analysis,
    });
    expect(applyAccept(typedText, typedResult, pick(typedResult.items, "#e74c3c"))).toBe(
      ".a {\n  color: #e74c3c\n}",
    );
    const namedText = ".a {\n  color: #re\n}";
    const namedState = await analyze(namedText);
    const namedResult = completionsAt(namedText, cursorAfter(namedText, "color: #re"), {
      analysis: namedState.analysis,
    });
    expect(applyAccept(namedText, namedResult, pick(namedResult.items, "red"))).toBe(
      ".a {\n  color: red\n}",
    );

    // Outside a colour property a `#` is no value at all.
    for (const property of ["width", "display", "margin", "opacity", "background"]) {
      const doc = `.a {\n  ${property}: #\n}`;
      const docState = await analyze(doc);
      const items = completionsAt(doc, cursorAfter(doc, `${property}: #`), {
        analysis: docState.analysis,
      }).items;
      expect(items).toEqual([]);
    }
    // A colour property still lists them behind a space-less colon and in a
    // one-line rule body.
    for (const doc of [".a { color: # }", ".a {\n  background-color: #\n}"]) {
      const docState = await analyze(doc);
      const items = completionsAt(doc, cursorAfter(doc, "#"), {
        analysis: docState.analysis,
      }).items;
      expect(items.length).toBe(183);
    }
  });

  test("colorsAt finds named and hex colors in declaration values", async () => {
    const doc = [
      ".a {",
      "  color: Red;",
      "  background: #fff teal;",
      "  border-color: navy;",
      "  --brand: #2563eb seagreen;",
      '  content: "black";',
      "  font-family: -apple-system;",
      "  box-shadow: 0 0 4px #2563eb;",
      "  color: $red;",
      "  outline-color: url(red.svg);",
      "}",
    ].join("\n");
    const state = await analyze(doc);
    const lines = doc.split("\n");
    const found = colorsAt(doc, state.analysis).map((entry) => ({
      text: (lines[entry.range.start.line] ?? "").slice(
        entry.range.start.character,
        entry.range.end.character,
      ),
      line: entry.range.start.line,
      character: entry.range.start.character,
      color: entry.color,
    }));
    // Named colours only inside colour-accepting declarations (`Red`, `navy`,
    // `seagreen`), hex anywhere (`#fff`, both `#2563eb`), never a string, a
    // `$token` or an identifier such as `-apple-system`.
    expect(found.map((entry) => entry.text)).toEqual([
      "#fff",
      "#2563eb",
      "#2563eb",
      "Red",
      "navy",
      "seagreen",
    ]);
    expect(found.map((entry) => entry.color)).toEqual([
      { red: 1, green: 1, blue: 1, alpha: 1 },
      { red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1 },
      { red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1 },
      { red: 1, green: 0, blue: 0, alpha: 1 },
      { red: 0, green: 0, blue: 128 / 255, alpha: 1 },
      { red: 46 / 255, green: 139 / 255, blue: 87 / 255, alpha: 1 },
    ]);
    // Exact authored offsets: `Red` sits after `color: ` on line 1.
    const red = found.find((entry) => entry.text === "Red");
    expect(red?.line).toBe(1);
    expect(red?.character).toBe(lines[1]?.indexOf("Red") ?? -1);
    // The shorthand `background` decorates its hex but not the named `teal`:
    // named colours stay behind A49's derived colour-property set.
    expect(found.some((entry) => entry.text === "teal")).toBe(false);
    // `url(red.svg)` is a file name, not a color, and `$red` is a token.
    expect(found.length).toBe(6);
    // Alpha-carrying hex values keep their channels.
    const alphaDoc = ".a {\n  color: #2563eb80;\n}";
    const alphaState = await analyze(alphaDoc);
    const alphaColor = colorsAt(alphaDoc, alphaState.analysis)[0]?.color;
    expect(alphaColor?.alpha).toBeCloseTo(128 / 255, 5);
  });

  test("items that replace a prefix carry filterText for the editor", async () => {
    // A50 follow-up: the paren state replaces `(cl`, so the filter text keeps the
    // paren the editor's narrowing sees in the replacement text.
    const paren = ".a {\n  width: (cl\n}";
    const parenState = await analyze(paren);
    const parenItems = completionsAt(paren, cursorAfter(paren, "width: (cl"), {
      analysis: parenState.analysis,
    }).items;
    expect(parenItems.map((item) => item.label)).toEqual(["clamp("]);
    expect(parenItems[0]?.filterText).toBe("(clamp");
    // A51: the `#` state replaces `#…`, so a name matched by its hex carries the
    // hex as filter text and a name matched by its own prefix carries `#name`.
    const byName = ".a {\n  color: #re\n}";
    const byNameState = await analyze(byName);
    const byNameItems = completionsAt(byName, cursorAfter(byName, "color: #re"), {
      analysis: byNameState.analysis,
    }).items;
    expect(pick(byNameItems, "red").filterText).toBe("#red");
    expect(pick(byNameItems, "rebeccapurple").filterText).toBe("#rebeccapurple");
    const byHex = ".a {\n  color: #ff\n}";
    const byHexState = await analyze(byHex);
    const byHexItems = completionsAt(byHex, cursorAfter(byHex, "color: #ff"), {
      analysis: byHexState.analysis,
    }).items;
    expect(pick(byHexItems, "red").filterText).toBe("#ff0000");
    // Hex items filter on their own label, so they need no filter text.
    expect(pick(byHexItems, "#ffffff").filterText).toBeUndefined();
    // Ordinary items never carry one; the adapter falls back to the label.
    const plain = ".a {\n  color: re\n}";
    const plainState = await analyze(plain);
    const plainItems = completionsAt(plain, cursorAfter(plain, "color: re"), {
      analysis: plainState.analysis,
    }).items;
    expect(plainItems.every((item) => item.filterText === undefined)).toBe(true);
  });

  test("picking a color writes lowercase hex back", () => {
    expect(rgbaToHex(1, 0, 0, 1)).toBe("#ff0000");
    const swatch = hexColorToRgba("#E74C3C");
    expect(swatch).toBeDefined();
    expect(
      rgbaToHex(swatch?.red ?? 0, swatch?.green ?? 0, swatch?.blue ?? 0, swatch?.alpha ?? 1),
    ).toBe("#e74c3c");
    // Alpha appears only when it is not opaque.
    expect(rgbaToHex(1, 1, 1, 0.5)).toBe("#ffffff80");
    expect(rgbaToHex(1, 1, 1, 1)).toBe("#ffffff");
  });

  test("the color provider, kind and trigger are wired in the extension", () => {
    // The adapters import `vscode`, so their wiring is asserted from source and
    // typechecked by `bun run typecheck`; the pure behaviour above is unit-tested.
    const controller = readFileSync(join(ROOT, "packages/vscode/src/controller.ts"), "utf8");
    expect(controller).toContain("vscode.languages.registerColorProvider(");
    expect(controller).toContain("new XessaColorProvider(this.service)");
    const start = controller.indexOf("vscode.languages.registerCompletionItemProvider(");
    expect(start).toBeGreaterThan(-1);
    const registration = controller.slice(start, start + 600);
    for (const trigger of ["@", "$", ".", ":", "/", "&", "(", "#", "!", ..."0123456789"]) {
      expect(registration).toContain(`"${trigger}",`);
    }
    const adapter = readFileSync(join(ROOT, "packages/vscode/src/adapter.ts"), "utf8");
    expect(adapter).toContain('case "color":');
    expect(adapter).toContain("vscode.CompletionItemKind.Color");
    const colorProvider = readFileSync(
      join(ROOT, "packages/vscode/src/providers/color.ts"),
      "utf8",
    );
    expect(colorProvider).toContain("provideColorPresentations");
    expect(colorProvider).toContain("colorsAt(source.text, state.analysis)");
    expect(colorProvider).toContain("rgbaToHex(");
    const completionProvider = readFileSync(
      join(ROOT, "packages/vscode/src/providers/completion.ts"),
      "utf8",
    );
    expect(completionProvider).toContain("suggestion.filterText ?? suggestion.label");
    // The stale trigger comment of A50 now lists the call opener and `#`.
    const header = completionProvider.slice(0, completionProvider.indexOf("import * as vscode"));
    expect(header).toContain("`(`");
    expect(header).toContain("`#`");
    // The post-accept retrigger and the digit trigger are documented there too.
    expect(header).toContain("retriggerSuggest");
    expect(header).toContain("`0`–`9`");
  });
});

describe("id selector completion (feature 26)", () => {
  /** Authored text under one range, for collection assertions. */
  function rangeText(
    text: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
  ): string {
    const line = text.split("\n")[range.start.line] ?? "";
    return line.slice(range.start.character, range.end.character);
  }

  test("collects selector ids in first-appearance order and skips non-selector hashes", async () => {
    const text = [
      "#panel, .card #inner { color: #fff; }",
      ".card {",
      "  &:is(#panel, #hovered) { color: blue; }",
      "  &:not(#excluded) { color: grey; }",
      "  &:has(> #nested-id) { color: teal; }",
      "  .nested#deep { color: green; }",
      '  content: "#not-id";',
      '  &[data-id="#attr"] { color: black; }',
      "}",
      ":global(#shell) .x { color: red; }",
      "#a /* #ghost */, #b { color: red; }",
    ].join("\n");
    const state = await analyze(text);
    const ids = collectIdSelectors(state.analysis);

    // Base selectors, comma lists, `&` nesting and `:is()`/`:not()`/`:has()`
    // arguments are all selector positions; `:global(#shell)` stays an id.
    // Declaration values (`#fff`), strings (`#not-id`), attribute values
    // (`#attr`) and selector comments (`#ghost`) never enter the list, and a
    // repeated name keeps its first appearance only.
    expect(ids.map((entry) => entry.name)).toEqual([
      "panel",
      "inner",
      "hovered",
      "excluded",
      "nested-id",
      "deep",
      "shell",
      "a",
      "b",
    ]);
    for (const entry of ids) {
      expect(entry.range.start.line).toBeGreaterThanOrEqual(0);
      expect(rangeText(text, entry.range)).toBe(entry.name);
    }
    expect(ids.find((entry) => entry.name === "panel")?.range.start.line).toBe(0);
    expect(ids.find((entry) => entry.name === "shell")?.range.start.line).toBe(9);
  });

  test("selector # offers the document ids, narrows by prefix and accepts one #", async () => {
    const text = [
      "#panel { color: red; }",
      "#panel-header { color: blue; }",
      "#sidebar { color: green; }",
      ":global(#shell) .x { color: red; }",
      ".card {",
      "  #",
      "}",
    ].join("\n");
    const offset = text.indexOf("  #\n") + 3;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "selector", word: "" });
    const result = completionsAt(text, offset, { analysis: state.analysis });

    expect(labels(result.items)).toEqual(["#panel", "#panel-header", "#sidebar", "#shell"]);
    for (const item of result.items) {
      expect(item.kind).toBe("selector");
      expect(item.detail).toBe("id selector");
      expect(item.insertText).toBe(item.label);
    }
    // A selector `#` is an id state only: no colours/hex values, no class items,
    // no nested-selector starters and no directives leak into it.
    expect(result.items.some((item) => item.kind === "color")).toBe(false);
    expect(result.items.some((item) => item.detail?.startsWith("CSS color"))).toBe(false);
    expect(
      labels(result.items).some((label) => label.startsWith(".") || label.startsWith("&")),
    ).toBe(false);
    expect(labels(result.items).some((label) => label.startsWith("@"))).toBe(false);

    const panel = result.items.find((item) => item.label === "#panel");
    expect(panel?.replaceStart).toBe(offset - 1);
    if (panel === undefined) throw new Error("missing #panel suggestion");
    expect(accept(text, result, panel)).toBe(text.replace("  #\n", "  #panel\n"));

    // A typed prefix narrows the same list and the whole `#…` word is replaced.
    const typed = [
      "#panel { color: red; }",
      "#panel-header { color: blue; }",
      "#sidebar { color: green; }",
      ".card {",
      "  #pan",
      "}",
    ].join("\n");
    const typedOffset = typed.indexOf("  #pan\n") + "  #pan".length;
    const typedState = await analyze(typed);
    const typedResult = completionsAt(typed, typedOffset, { analysis: typedState.analysis });
    expect(labels(typedResult.items)).toEqual(["#panel", "#panel-header"]);
    const header = typedResult.items.find((item) => item.label === "#panel-header");
    expect(header?.replaceStart).toBe(typedOffset - "#pan".length);
    if (header === undefined) throw new Error("missing #panel-header suggestion");
    expect(accept(typed, typedResult, header)).toBe(typed.replace("  #pan\n", "  #panel-header\n"));
    expect(accept(typed, typedResult, header).includes("##")).toBe(false);
  });

  test("a value # on a colour property stays the colour state only", async () => {
    const text = ["#panel { color: red; }", ".card {", "  color: #", "}"].join("\n");
    const offset = text.indexOf("  color: #\n") + "  color: #".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({
      kind: "value",
      property: "color",
      word: "",
    });
    const items = completionsAt(text, offset, { analysis: state.analysis }).items;
    expect(items.length).toBe(183);
    expect(items.every((item) => item.kind === "color")).toBe(true);
    expect(items.some((item) => item.detail === "id selector")).toBe(false);
    expect(labels(items)).not.toContain("#panel");
  });
});

describe("class completion inside attribute values", () => {
  test("a quoted attribute value is inert: no class suggestions and no class occurrence", async () => {
    const text = [
      ".card { color: red; }",
      ".card-active { color: blue; }",
      '.card[data-x=".car"] { color: green; }',
    ].join("\n");
    const state = await analyze(text);
    const valueOffset = text.indexOf('".car"') + 3;

    // `contextAt` sees the enclosing string first, so the attribute value is
    // not a selector state and the completion list stays empty.
    expect(contextAt(text, valueOffset, state.analysis)).toEqual({ kind: "none" });
    expect(completionsAt(text, valueOffset, { analysis: state.analysis }).items).toEqual([]);
    // The value's `.car` never becomes an analysis class occurrence.
    expect(state.analysis.classes.every((entry) => entry.name !== "car")).toBe(true);

    // Outside the brackets the same line still completes selector classes, so
    // the empty result above is not a general failure to complete.
    const classOffset = text.indexOf(".card[") + ".card".length;
    expect(contextAt(text, classOffset, state.analysis)).toEqual({
      kind: "selector",
      word: ".card",
    });
    expect(labels(completionsAt(text, classOffset, { analysis: state.analysis }).items)).toContain(
      ".card",
    );
  });
});

describe("curated CSS properties and vendor pseudos (editor properties + vendor selectors)", () => {
  /** The completion fields these tests inspect. */
  interface OfferedProperty {
    readonly label: string;
    readonly kind?: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly insertText: string;
    readonly snippet?: string;
    readonly sortText?: string;
    readonly replaceStart?: number;
    readonly retriggerSuggest?: boolean;
  }

  /** Every property offered from a rule body, with its item. */
  async function allProperties(): Promise<readonly OfferedProperty[]> {
    const text = ".a {\n  ";
    const state = await analyze(text);
    expect(contextAt(text, text.length, state.analysis)).toEqual({ kind: "property", word: "" });
    return completionsAt(text, text.length, { analysis: state.analysis }).items;
  }

  /** Every vendor property in one engine family, from a typed prefix. */
  async function vendorFamily(word: string): Promise<readonly OfferedProperty[]> {
    const text = `.a {\n  ${word}\n}`;
    const offset = text.indexOf(word) + word.length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "property", word });
    return completionsAt(text, offset, { analysis: state.analysis }).items;
  }

  /** Sort comparator used by the editor for plain labels and sort keys. */
  function byLabel(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  test("the curated lists are sorted, duplicate-free and fully documented", async () => {
    const items = await allProperties();
    const offered = items.map((item) => item.label);
    // Real count: 123 curated properties before the owner request, plus 74.
    expect(offered.length).toBe(197);
    expect(new Set(offered).size).toBe(offered.length);
    expect(offered).toEqual([...offered].sort(byLabel));
    // The empty property position lists standard properties only.
    expect(offered.some((label) => label.startsWith("-"))).toBe(false);
    for (const item of items) {
      expect(item.detail).toBe("CSS property");
      const doc = item.documentation ?? "";
      expect(doc.length).toBeGreaterThan(0);
      expect(doc.endsWith(".")).toBe(true);
    }

    // Vendor spellings are offered only when their engine family is typed;
    // `web` and `moz` between them cover the whole curated vendor set. Each
    // family is alphabetical on its own (the data is authored that way).
    const web = await vendorFamily("web");
    const moz = await vendorFamily("moz");
    expect(web.map((item) => item.label)).toEqual(web.map((item) => item.label).sort(byLabel));
    expect(moz.map((item) => item.label)).toEqual(moz.map((item) => item.label).sort(byLabel));
    const vendor: OfferedProperty[] = [...web, ...moz];
    const vendorLabels = vendor.map((item) => item.label);
    expect(vendorLabels.length).toBe(43);
    expect(new Set(vendorLabels).size).toBe(vendorLabels.length);
    for (const item of vendor) {
      expect(item.kind).toBe("property");
      expect(item.detail).toBe("vendor-prefixed property");
      expect(item.insertText).toBe(`${item.label}: `);
      expect(item.snippet).toBe(`${item.label}: $0;`);
      expect(item.retriggerSuggest).toBe(true);
      const doc = item.documentation ?? "";
      expect(doc.length).toBeGreaterThan(0);
      expect(doc.endsWith(".")).toBe(true);
    }

    // Full coverage both ways over every offered name (standard and vendor):
    // every offered property has a doc entry, and no doc entry names a
    // property the editor never offers.
    expect([...Object.keys(CSS_PROPERTY_DOCS)].sort()).toEqual(
      [...offered, ...vendorLabels].sort(),
    );
  });

  test("a base name surfaces its vendor variants after the standard property", async () => {
    const text = ".a {\n  appear\n}";
    const offset = text.indexOf("appear") + "appear".length;
    const state = await analyze(text);
    expect(contextAt(text, offset, state.analysis)).toEqual({ kind: "property", word: "appear" });
    const result = completionsAt(text, offset, { analysis: state.analysis });
    expect(labels(result.items)).toEqual(["appearance", "-moz-appearance", "-webkit-appearance"]);
    expect(result.items[0]?.detail).toBe("CSS property");

    for (const label of ["-moz-appearance", "-webkit-appearance"]) {
      const item = suggestion(result, label);
      expect(item.label).toBe(label);
      expect(item.insertText).toBe(`${label}: `);
      expect(item.documentation).toContain("appearance");
      expect(item.retriggerSuggest).toBe(true);
      // The shared range covers the typed base word, so accept replaces it.
      expect(accept(text, result, item)).toBe(`.a {\n  ${label}: \n}`);
    }

    // The sort keys place a variant directly after its base property in the
    // editor: a plain label sorts before the same label with a suffix, `-`
    // sorts before `~`, and an exact standard name sorts before the prefixed
    // sibling of its longer base (`transform-origin` before `transform~…`).
    expect(byLabel("appearance", "appearance~-moz-appearance")).toBe(-1);
    expect(byLabel("appearance~-moz-appearance", "appearance~-webkit-appearance")).toBe(-1);
    expect(byLabel("transform-origin", "transform~-webkit-transform")).toBe(-1);
    expect("-" < "~").toBe(true);

    // With the semicolon setting off the vendor item keeps the plain insert.
    const plain = completionsAt(text, offset, {
      analysis: state.analysis,
      completePropertyWithSemicolon: false,
    });
    const moz = plain.items.find((item) => item.label === "-moz-appearance");
    expect(moz?.insertText).toBe("-moz-appearance: ");
    expect(moz?.snippet).toBeUndefined();
    expect(moz?.retriggerSuggest).toBe(true);
  });

  test("web/moz prefixes list their vendor family and replace the typed prefix", async () => {
    for (const spelling of ["web", "-web"]) {
      const items = await vendorFamily(spelling);
      expect(items.length).toBe(33);
      expect(items.every((item) => item.label.startsWith("-webkit-"))).toBe(true);
      expect(items.some((item) => item.label === "-webkit-appearance")).toBe(true);
      expect(items.every((item) => item.detail === "vendor-prefixed property")).toBe(true);
    }
    for (const spelling of ["moz", "-moz"]) {
      const items = await vendorFamily(spelling);
      expect(items.length).toBe(10);
      expect(items.every((item) => item.label.startsWith("-moz-"))).toBe(true);
      expect(items.some((item) => item.label === "-moz-appearance")).toBe(true);
      expect(items.every((item) => item.detail === "vendor-prefixed property")).toBe(true);
    }

    const text = ".a {\n  -web\n}";
    const offset = text.indexOf("-web") + "-web".length;
    const state = await analyze(text);
    const result = completionsAt(text, offset, { analysis: state.analysis });
    // The replacement range covers the typed leading `-`, so accept never
    // leaves `--webkit-appearance`.
    expect(accept(text, result, suggestion(result, "-webkit-appearance"))).toBe(
      ".a {\n  -webkit-appearance: \n}",
    );
  });

  test("vendor properties never leak into other completion contexts", async () => {
    const vendorLabels = ["-moz-appearance", "-webkit-appearance", "-webkit-scrollbar"];
    const cases: readonly { readonly text: string; readonly offset: number }[] = [
      { text: ".a {\n  color: ", offset: ".a {\n  color: ".length },
      { text: ".a {\n  &", offset: 8 },
      { text: ".a {\n  &:", offset: 9 },
      { text: "@setup {\n  ", offset: "@setup {\n  ".length },
      { text: "@", offset: 1 },
      { text: "", offset: 0 },
    ];
    for (const { text, offset } of cases) {
      const state = await analyze(text);
      const items = completionsAt(text, offset, { analysis: state.analysis }).items;
      for (const label of vendorLabels) {
        expect(labels(items)).not.toContain(label);
      }
      expect(labels(items).some((label) => label.startsWith("-webkit-"))).toBe(false);
      expect(labels(items).some((label) => label.startsWith("-moz-"))).toBe(false);
    }
  });

  test("hover resolves a vendor property through its doc sentence", async () => {
    const text = ".a {\n  -webkit-appearance: none;\n}";
    const state = await analyze(text);
    const hover = hoverAt(text, text.indexOf("-webkit-appearance") + 2, {
      analysis: state.analysis,
    });
    expect(hover?.markdown).toContain("**-webkit-appearance** — CSS property");
    expect(hover?.markdown).toContain("appearance");
    expect(hover?.range.start.line).toBe(1);
  });

  test("new properties complete with documentation", async () => {
    const text = ".a {\n  ";
    const state = await analyze(text);
    const items = completionsAt(text, text.length, { analysis: state.analysis }).items;
    const representative = [
      "scrollbar-color",
      "container-type",
      "text-shadow",
      "will-change",
      "translate",
    ];
    for (const property of representative) {
      const item = items.find((entry) => entry.label === property);
      expect(item).toBeDefined();
      expect(item?.detail).toBe("CSS property");
      expect((item?.documentation ?? "").length).toBeGreaterThan(0);
    }
    expect(items.find((entry) => entry.label === "scrollbar-color")?.documentation).toContain(
      "scrollbar",
    );
    expect(items.find((entry) => entry.label === "container-type")?.documentation).toContain(
      "container",
    );
  });

  test("vendor pseudos follow the standard set with vendor details and last sort keys", async () => {
    const text = ".a {\n  &:\n}";
    const offset = text.indexOf("&:") + 2;
    const state = await analyze(text);
    const result = completionsAt(text, offset, { analysis: state.analysis });
    const items = result.items;
    const vendor = items.filter((item) => item.detail?.startsWith("vendor-prefixed "));
    expect(vendor.map((item) => item.label)).toEqual([
      ":-moz-any(",
      ":-moz-full-screen",
      ":-webkit-any(",
      ":-webkit-autofill",
      ":-webkit-full-screen",
      "::-moz-focus-inner",
      "::-moz-placeholder",
      "::-moz-selection",
      "::-webkit-calendar-picker-indicator",
      "::-webkit-file-upload-button",
      "::-webkit-input-placeholder",
      "::-webkit-scrollbar",
      "::-webkit-scrollbar-thumb",
      "::-webkit-scrollbar-track",
    ]);
    // Standards stay first and keep their old shape; every vendor item follows.
    const lastStandard = items.findIndex((item) => item.label === "::selection");
    expect(lastStandard).toBeGreaterThanOrEqual(0);
    const firstVendor = items.findIndex((item) => item.label === ":-moz-any(");
    expect(firstVendor).toBeGreaterThan(lastStandard);
    expect(items.find((item) => item.label === ":hover")?.detail).toBeUndefined();
    expect(items.find((item) => item.label === ":hover")?.sortText).toBeUndefined();

    for (const item of vendor) {
      expect(item.kind).toBe("pseudo");
      expect(item.insertText).toBe(item.label);
      expect(item.sortText).toBe(`z-${item.label}`);
      expect(["vendor-prefixed pseudo-class", "vendor-prefixed pseudo-element"]).toContain(
        item.detail,
      );
    }
    expect(items.find((item) => item.label === ":-moz-any(")?.detail).toBe(
      "vendor-prefixed pseudo-class",
    );
    expect(items.find((item) => item.label === "::-moz-selection")?.detail).toBe(
      "vendor-prefixed pseudo-element",
    );

    // `z-` sorts after every colon-prefixed standard label in the editor.
    expect("z-::-webkit-scrollbar" > ":hover").toBe(true);

    expect(accept(text, result, suggestion(result, "::-webkit-scrollbar"))).toBe(
      ".a {\n  &::-webkit-scrollbar\n}",
    );
    expect(accept(text, result, suggestion(result, ":-webkit-autofill"))).toBe(
      ".a {\n  &:-webkit-autofill\n}",
    );

    // Standard behaviour is unchanged: `&:` + `:hover` stays single-colon.
    expect(accept(text, result, suggestion(result, ":hover"))).toBe(".a {\n  &:hover\n}");
  });

  test("web/moz prefixes filter vendor pseudos and replace the typed colons", async () => {
    for (const spelling of ["web", "-web"]) {
      const text = `.a {\n  &::${spelling}\n}`;
      const offset = text.indexOf(`&::${spelling}`) + `&::${spelling}`.length;
      const state = await analyze(text);
      expect(contextAt(text, offset, state.analysis)).toEqual({
        kind: "pseudo",
        word: spelling,
      });
      const result = completionsAt(text, offset, { analysis: state.analysis });
      expect(labels(result.items)).toEqual([
        ":-webkit-any(",
        ":-webkit-autofill",
        ":-webkit-full-screen",
        "::-webkit-calendar-picker-indicator",
        "::-webkit-file-upload-button",
        "::-webkit-input-placeholder",
        "::-webkit-scrollbar",
        "::-webkit-scrollbar-thumb",
        "::-webkit-scrollbar-track",
      ]);
      expect(accept(text, result, suggestion(result, "::-webkit-scrollbar"))).toBe(
        ".a {\n  &::-webkit-scrollbar\n}",
      );
    }

    const moz = ".a {\n  &::moz\n}";
    const mozOffset = moz.indexOf("&::moz") + "&::moz".length;
    const mozState = await analyze(moz);
    const mozResult = completionsAt(moz, mozOffset, { analysis: mozState.analysis });
    expect(labels(mozResult.items)).toEqual([
      ":-moz-any(",
      ":-moz-full-screen",
      "::-moz-focus-inner",
      "::-moz-placeholder",
      "::-moz-selection",
    ]);
    expect(accept(moz, mozResult, suggestion(mozResult, "::-moz-selection"))).toBe(
      ".a {\n  &::-moz-selection\n}",
    );
  });

  test("vendor pseudos never leak into other completion contexts", async () => {
    const vendorLabels = [":-moz-any(", "::-moz-selection", "::-webkit-scrollbar"];
    const cases: readonly { readonly text: string; readonly offset: number }[] = [
      { text: ".a {\n  ", offset: 7 },
      { text: ".a {\n  color: ", offset: 14 },
      { text: ".a {\n  &", offset: 8 },
      { text: "", offset: 0 },
    ];
    for (const { text, offset } of cases) {
      const state = await analyze(text);
      const items = completionsAt(text, offset, { analysis: state.analysis }).items;
      for (const label of vendorLabels) {
        expect(labels(items)).not.toContain(label);
      }
    }
    const directive = "@";
    const directiveState = await analyze(directive);
    const directItems = completionsAt(directive, 1, { analysis: directiveState.analysis }).items;
    expect(labels(directItems).some((label) => label.includes("-webkit-"))).toBe(false);
    expect(labels(directItems).some((label) => label.includes("-moz-"))).toBe(false);
  });
});
