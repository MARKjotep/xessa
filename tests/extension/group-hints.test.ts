/**
 * Pure group override ghost-hint tests: which declarations get a hint, the
 * verbatim shadowed value, zero-width placement, the first-declaration rule and
 * the `always` / `inside` / `off` filter. No `vscode` module is imported.
 */

import { describe, expect, test } from "bun:test";
import { type AnalyzeResult, analyzeText, positionAt } from "../../packages/vscode/src/analysis.ts";
import {
  GROUP_HINT_ATTACHMENT,
  type GroupHint,
  filterGroupHints,
  groupHintMode,
  groupHints,
  planGroupHintDecorations,
} from "../../packages/vscode/src/group-hints.ts";
import type { Position } from "../../packages/vscode/src/positions.ts";

const PATH = "/virtual/entry.cssx";

function analyze(
  text: string,
  modules: Readonly<Record<string, string>> = {},
): AnalyzeResult & { readonly text: string } {
  return {
    ...analyzeText({ text, path: PATH, version: 1 }, { readModule: (path) => modules[path] }),
    text,
  };
}

/** Offset of the `occurrence`-th (0-based) match of `needle`. */
function offsetOf(text: string, needle: string, occurrence = 0): number {
  let from = 0;
  let found = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    found = text.indexOf(needle, from);
    if (found < 0) throw new Error(`missing occurrence ${occurrence} of "${needle}"`);
    from = found + needle.length;
  }
  return found;
}

function hintsOf(text: string, modules?: Readonly<Record<string, string>>): readonly GroupHint[] {
  return groupHints(analyze(text, modules));
}

function rangeIsEmpty(range: { readonly start: Position; readonly end: Position }): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character;
}

function properties(hints: readonly GroupHint[]): string[] {
  return hints.map((hint) => hint.property);
}

function values(hints: readonly GroupHint[]): string[] {
  return hints.map((hint) => hint.value);
}

describe("group override hints: what gets a hint", () => {
  test("hints only declarations that shadow a resolved default, in authored order", () => {
    const text = [
      "@group.card {",
      "  padding: 12px;",
      "  color: black;",
      "}",
      "",
      ".panel {",
      "  color: red;",
      "  @group.card {",
      "    padding: 0.5rem;",
      "    margin: 2px;",
      "    color: blue;",
      "  }",
      "}",
    ].join("\n");
    const analysis = analyze(text);
    const hints = groupHints(analysis);

    // `margin` exists only at the use site: no hint for it.
    expect(properties(hints)).toEqual(["padding", "color"]);
    expect(values(hints)).toEqual(["12px", "black"]);
    for (const hint of hints) expect(rangeIsEmpty(hint.range)).toBe(false);
  });

  test("places a non-empty declaration range and spans the use site", () => {
    const text = [
      "@group.card { padding: 12px; }",
      ".panel {",
      "  @group.card {",
      "    padding: 0.5rem;",
      "  }",
      "}",
    ].join("\n");
    const analysis = analyze(text);
    const [hint] = groupHints(analysis);
    expect(hint).toBeDefined();
    if (hint === undefined) return;

    const start = offsetOf(text, "padding: 0.5rem;");
    expect(hint.range).toEqual({
      start: positionAt(analysis.lineStarts, start),
      end: positionAt(analysis.lineStarts, start + "padding: 0.5rem;".length),
    });
    expect(rangeIsEmpty(hint.range)).toBe(false);

    const siteStart = offsetOf(text, "@group.card {", 1);
    expect(hint.site.start).toEqual(positionAt(analysis.lineStarts, siteStart));
    const block = text.slice(siteStart);
    expect(hint.site.end).toEqual(
      positionAt(analysis.lineStarts, siteStart + block.indexOf("}") + 1),
    );
  });

  test("repeated default property shows the last value on the first use-site declaration only", () => {
    const text = [
      "@group.card {",
      "  padding: 1rem;",
      "  padding: 2rem @md 3rem;",
      "}",
      ".panel { @group.card { padding: 9px; padding: 10px; } }",
    ].join("\n");
    const analysis = analyze(text);
    const hints = groupHints(analysis);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.value).toBe("2rem @md 3rem");
    const start = offsetOf(text, "padding: 9px;");
    expect(hints[0]?.range).toEqual({
      start: positionAt(analysis.lineStarts, start),
      end: positionAt(analysis.lineStarts, start + "padding: 9px;".length),
    });
  });

  test("a semicolonless final declaration keeps the value end", () => {
    const text = [
      "@group.card { padding: 1rem; }",
      ".panel { @group.card { padding: 0.5rem } }",
    ].join("\n");
    const analysis = analyze(text);
    const [hint] = groupHints(analysis);
    expect(hint).toBeDefined();
    if (hint === undefined) return;

    const start = offsetOf(text, "padding: 0.5rem }");
    expect(hint.range).toEqual({
      start: positionAt(analysis.lineStarts, start),
      end: positionAt(analysis.lineStarts, start + "padding: 0.5rem".length),
    });
    expect(rangeIsEmpty(hint.range)).toBe(false);
  });

  test("keeps inline variants, !important and unresolved $tokens verbatim", () => {
    const text = [
      "@group.card {",
      "  margin: 1rem @md 2rem;",
      "  color: red !important;",
      "  --gap: $space;",
      "}",
      ".panel {",
      "  @group.card {",
      "    margin: 0;",
      "    color: blue;",
      "    --gap: 4px;",
      "  }",
      "}",
    ].join("\n");
    const hints = hintsOf(text);

    expect(properties(hints)).toEqual(["margin", "color", "--gap"]);
    expect(values(hints)).toEqual(["1rem @md 2rem", "red !important", "$space"]);
  });

  test("unknown and ambiguous groups get no hints", () => {
    const unknown = hintsOf(".panel { @group.missing { padding: 1px; } }");
    expect(unknown).toEqual([]);

    const ambiguousText = [
      '@use "./a.cssx" styles;',
      '@use "./b.cssx" styles;',
      ".panel { @group.card { padding: 1px; } }",
    ].join("\n");
    const ambiguous = hintsOf(ambiguousText, {
      "/virtual/a.cssx": "@group.card { padding: 8px; }",
      "/virtual/b.cssx": "@group.card { padding: 12px; }",
    });
    expect(ambiguous).toEqual([]);
  });

  test("resolves a styles-imported group and keeps its raw default", () => {
    const text = ['@use "./card.cssx" styles;', ".panel { @group.card { padding: 1px; } }"].join(
      "\n",
    );
    const hints = hintsOf(text, {
      "/virtual/card.cssx": "@group.card { padding: $space; }",
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]?.property).toBe("padding");
    expect(hints[0]?.value).toBe("$space");
  });

  test("a local definition shadows an imported one", () => {
    const text = [
      '@use "./card.cssx" styles;',
      "@group.card { padding: 24px; }",
      ".panel { @group.card { padding: 1px; } }",
    ].join("\n");
    const hints = hintsOf(text, {
      "/virtual/card.cssx": "@group.card { padding: 8px; }",
    });

    expect(values(hints)).toEqual(["24px"]);
  });
});

describe("group override hints: mode filter", () => {
  const text = [
    "@group.card {",
    "  padding: 12px;",
    "  color: black;",
    "}",
    "",
    ".panel {",
    "  @group.card {",
    "    padding: 0.5rem;",
    "    color: blue;",
    "  }",
    "}",
    ".other { color: red; }",
  ].join("\n");
  const analysis = analyze(text);
  const hints = groupHints(analysis);

  test("always keeps every hint regardless of the cursor", () => {
    expect(filterGroupHints(hints, "always", { line: 0, character: 0 })).toHaveLength(2);
    expect(filterGroupHints(hints, "always")).toHaveLength(2);
  });

  test("inside keeps only hints whose own use-site block contains the cursor", () => {
    const insidePadding = { line: 7, character: 4 };
    expect(filterGroupHints(hints, "inside", insidePadding)).toHaveLength(2);

    const outside = { line: 12, character: 5 };
    expect(filterGroupHints(hints, "inside", outside)).toEqual([]);

    const definition = { line: 0, character: 2 };
    expect(filterGroupHints(hints, "inside", definition)).toEqual([]);
  });

  test("inside treats the closing brace and block end as inside", () => {
    const [hint] = hints;
    expect(hint).toBeDefined();
    if (hint === undefined) return;
    expect(filterGroupHints(hints, "inside", hint.site.start)).toHaveLength(2);
    expect(filterGroupHints(hints, "inside", hint.site.end)).toHaveLength(2);
  });

  test("off keeps nothing and a missing cursor is outside every block", () => {
    expect(filterGroupHints(hints, "off", { line: 7, character: 4 })).toEqual([]);
    expect(filterGroupHints(hints, "inside")).toEqual([]);
  });

  test("normalizes the raw setting value with always as the fallback", () => {
    expect(groupHintMode("always")).toBe("always");
    expect(groupHintMode("inside")).toBe("inside");
    expect(groupHintMode("off")).toBe("off");
    expect(groupHintMode(undefined)).toBe("always");
    expect(groupHintMode("bogus")).toBe("always");
  });
});

describe("group override hints: decoration plan", () => {
  const text = [
    "@group.card {",
    "  padding: 12px;",
    "  color: black;",
    "}",
    "",
    ".panel {",
    "  @group.card {",
    "    padding: 0.5rem;",
    "    color: blue;",
    "  }",
    "}",
  ].join("\n");
  const analysis = analyze(text);
  const hints = groupHints(analysis);
  const themeColor = (id: string) => ({ themeColor: id });

  test("emits non-empty options carrying contentText, colour, italics and gap", () => {
    const planned = planGroupHintDecorations(
      hints,
      "always",
      { line: 0, character: 0 },
      themeColor,
    );

    expect(planned).toHaveLength(2);
    expect(planned.map((option) => option.renderOptions.after.contentText)).toEqual([
      "// 12px",
      "// black",
    ]);
    for (const [index, option] of planned.entries()) {
      expect(option.renderOptions.after).toEqual({
        contentText: index === 0 ? "// 12px" : "// black",
        color: { themeColor: "editorGhostText.foreground" },
        fontStyle: "italic",
        fontWeight: "300",
        margin: "0 0 0 2em",
      });
      expect(option.range).toEqual(hints[index]?.range);
    }
    expect(GROUP_HINT_ATTACHMENT.color).toBe("editorGhostText.foreground");
    expect(GROUP_HINT_ATTACHMENT.fontStyle).toBe("italic");
    expect(GROUP_HINT_ATTACHMENT.fontWeight).toBe("300");
    expect(GROUP_HINT_ATTACHMENT.margin).toBe("0 0 0 2em");
  });

  test("off emits no options and inside keeps only the cursor's block", () => {
    expect(planGroupHintDecorations(hints, "off", { line: 7, character: 4 }, themeColor)).toEqual(
      [],
    );
    expect(
      planGroupHintDecorations(hints, "inside", { line: 7, character: 4 }, themeColor),
    ).toHaveLength(2);
    expect(
      planGroupHintDecorations(hints, "inside", { line: 0, character: 0 }, themeColor),
    ).toEqual([]);
  });
});
