/**
 * Pure semantic-token tests (`CSSX-COLOR-TOKENS`).
 *
 * The classifier is the source of truth for what the editor colours and which
 * legend type it uses; the extension-host scenario (`test/ui/semantic-tokens.js`)
 * re-checks the same positions through the running provider. Everything here
 * runs without `vscode`, so a failure names a range instead of a window.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeResult } from "../../packages/vscode/src/analysis.ts";
import { analyzeText } from "../../packages/vscode/src/analysis.ts";
import {
  SEMANTIC_TOKEN_TYPES,
  type SemanticTokenSpan,
  encodeSemanticTokens,
  semanticTokensFor,
} from "../../packages/vscode/src/semantic-tokens.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const EXTENSION_MANIFEST = join(ROOT, "packages", "vscode", "package.json");

interface ManifestContribution {
  contributes?: {
    semanticTokenColors?: Record<string, string>;
    semanticTokenScopes?: Array<{
      language?: string;
      scopes?: Record<string, string | string[]>;
    }>;
  };
}

/** In-memory module graph: a `@use` target resolves by file-name suffix. */
function moduleReader(files: Record<string, string>): (absolute: string) => string | undefined {
  return (absolute) => {
    for (const [name, text] of Object.entries(files)) {
      if (absolute.endsWith(name)) return text;
    }
    return undefined;
  };
}

const MODULES = {
  "theme.cssx": "@variables {\n  primary: #2563eb;\n}\n@runtime {\n  tone: navy;\n}\n",
  "layout.cssx": "@variables {\n  margin: 4px;\n}\n",
};

function analyze(text: string, path = "semantic.cssx"): AnalyzeResult {
  return analyzeText(
    { text, path: join(ROOT, "packages", "vscode", "test", "fixtures", "ui", path), version: 1 },
    { readModule: moduleReader(MODULES) },
  );
}

const DOCUMENT = [
  '@use "./theme.cssx" as ui;',
  "/* $commented: var(--ghost) */",
  "@variables {",
  "  spacing: 4px;",
  "  alias: var(--brand);",
  "}",
  "@runtime {",
  "  accent: #2563eb;",
  "}",
  "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
  ".card {",
  "  padding: $spacing;",
  "  color: $accent;",
  "  background: $ui.primary;",
  "  border-color: $ui.tone;",
  "  outline-color: var(--brand);",
  "  animation: $keyframes.spin 1s;",
  "  display: $keyframes.nope 1s;",
  "  margin: $ui.missing;",
  "  inset: $ghost;",
  '  content: "--not-a-reference";',
  "  width: 100%;",
  "}",
].join("\n");

const ANALYSIS = analyze(DOCUMENT);

function offsetOf(needle: string, delta = 0): number {
  const index = DOCUMENT.indexOf(needle);
  if (index < 0) throw new Error(`document does not contain ${JSON.stringify(needle)}`);
  return index + delta;
}

/** Span text for a readable failure message. */
function textOf(span: SemanticTokenSpan, text: string = DOCUMENT): string {
  return text.slice(span.start, span.start + span.length);
}

/** Every classified span rendered as `text:type` in document order. */
function described(spans: readonly SemanticTokenSpan[], text: string = DOCUMENT): string[] {
  return spans.map((span) => `${textOf(span, text)}:${span.type}`);
}

/** The span covering `offset`, if any. */
function spanAt(
  spans: readonly SemanticTokenSpan[],
  offset: number,
): SemanticTokenSpan | undefined {
  return spans.find((span) => offset >= span.start && offset < span.start + span.length);
}

/** Legend type covering a reference's `delta` character. */
function typeAt(
  spans: readonly SemanticTokenSpan[],
  needle: string,
  delta = 0,
): string | undefined {
  const span = spanAt(spans, offsetOf(needle, delta));
  return span?.type;
}

const SPANS = semanticTokensFor(DOCUMENT, ANALYSIS);

describe("semantic token legend and manifest", () => {
  test("legend is the five documented types in a stable order", () => {
    expect([...SEMANTIC_TOKEN_TYPES]).toEqual([
      "variable",
      "namespace",
      "runtimeVariable",
      "customProperty",
      "keyframe",
    ]);
  });

  test("manifest carries no inert semanticTokenColors block", () => {
    // `semanticTokenColors` is not an extension contribution point in current
    // VS Code: themes own semantic colours and users opt in through
    // `editor.semanticTokenColorCustomizations` (README "Token colors").
    const manifest = JSON.parse(readFileSync(EXTENSION_MANIFEST, "utf8")) as ManifestContribution;
    expect(manifest.contributes?.semanticTokenColors).toBeUndefined();
  });

  test("the manifest maps every type to a distinct theme scope for xessa", () => {
    const manifest = JSON.parse(readFileSync(EXTENSION_MANIFEST, "utf8")) as ManifestContribution;
    const entry = manifest.contributes?.semanticTokenScopes?.find(
      (candidate) => candidate.language === "xessa",
    );
    expect(entry?.scopes).toEqual({
      variable: ["variable.language"],
      namespace: ["entity.name.type"],
      runtimeVariable: ["keyword.control"],
      customProperty: ["keyword.control"],
      keyframe: ["entity.name.function"],
    });
  });
});

describe("semantic tokens — variable kinds", () => {
  test("a compile-time reference is `variable`", () => {
    expect(typeAt(SPANS, "$spacing")).toBe("variable");
    expect(spanAt(SPANS, offsetOf("$spacing"))?.length).toBe("$spacing".length);
  });

  test("a local runtime reference is `runtimeVariable`", () => {
    expect(typeAt(SPANS, "$accent")).toBe("runtimeVariable");
    expect(spanAt(SPANS, offsetOf("$accent"))?.length).toBe("$accent".length);
  });

  test("a declaration site is never classified (references only)", () => {
    // `spacing` and `accent` are declared names, not references.
    expect(spanAt(SPANS, offsetOf("spacing: 4px"))).toBeUndefined();
    expect(spanAt(SPANS, offsetOf("accent: #2563eb"))).toBeUndefined();
    expect(spanAt(SPANS, offsetOf('"--not-a-reference"', 1))).toBeUndefined();
  });
});

describe("semantic tokens — namespaced members follow the resolved kind", () => {
  test("the `$ns` prefix is `namespace` and a compile member is `variable`", () => {
    const start = offsetOf("$ui.primary");
    expect(spanAt(SPANS, start)).toEqual({ start, length: "$ui".length, type: "namespace" });
    expect(spanAt(SPANS, start + "$ui.".length)).toEqual({
      start: start + "$ui.".length,
      length: "primary".length,
      type: "variable",
    });
    expect(typeAt(SPANS, "$ui.primary", "$ui.".length)).toBe("variable");
  });

  test("a runtime member is `runtimeVariable` under the same namespace", () => {
    expect(typeAt(SPANS, "$ui.tone")).toBe("namespace");
    expect(typeAt(SPANS, "$ui.tone", "$ui.".length)).toBe("runtimeVariable");
  });

  test("a local `@use` file resolves through its default alias", () => {
    const text = '@use "./layout.cssx";\n.a { margin: $layout.margin; }';
    const analysis = analyze(text, "alias.cssx");
    const spans = semanticTokensFor(text, analysis);
    const start = text.indexOf("$layout.margin");
    expect(described(spans, text)).toEqual(["$layout:namespace", "margin:variable"]);
    expect(spans[1]).toEqual({ start: start + "$layout.".length, length: 6, type: "variable" });
  });

  test("an unresolvable namespace or member keeps grammar styling for the member", () => {
    const missingStart = offsetOf("$ui.missing");
    const covering = SPANS.filter(
      (span) => span.start >= missingStart && span.start < missingStart + "$ui.missing".length,
    );
    expect(covering).toEqual([{ start: missingStart, length: "$ui".length, type: "namespace" }]);

    // A namespace that is not an alias at all still yields the prefix token.
    const ghostText = ".a { gap: $ghost.member; }";
    const ghostSpans = semanticTokensFor(ghostText, analyze(ghostText, "ghost.cssx"));
    expect(described(ghostSpans, ghostText)).toEqual(["$ghost:namespace"]);
  });
});

describe("semantic tokens — custom property references", () => {
  test("`var(--x)` and a bare custom-property value are `customProperty`", () => {
    expect(typeAt(SPANS, "var(--brand)", "var(".length)).toBe("customProperty");
    expect(spanAt(SPANS, offsetOf("var(--brand)", "var(".length))?.length).toBe("--brand".length);
    // A compile-time token value that holds a var() reference is classified too.
    expect(typeAt(SPANS, "alias: var(--brand)", "alias: var(".length)).toBe("customProperty");
  });

  test("strings and comments never produce a custom-property reference", () => {
    const text = [
      "/* --inside: var(--ghost) */",
      "@runtime { tone: navy; }",
      '.a { content: "--brand"; background: var(--tone); }',
    ].join("\n");
    const spans = semanticTokensFor(text, analyze(text, "strings.cssx"));
    expect(described(spans, text)).toEqual(["--tone:customProperty"]);
  });

  test("declaration left-hand sides are not references", () => {
    const text = ".a { --brand: red; color: var(--brand); }";
    const spans = semanticTokensFor(text, analyze(text, "lhs.cssx"));
    const first = text.indexOf("--brand");
    expect(spans.filter((span) => span.start === first)).toEqual([]);
    expect(spans).toEqual([
      { start: text.lastIndexOf("--brand"), length: "--brand".length, type: "customProperty" },
    ]);
  });
});

describe("semantic tokens — $keyframes members", () => {
  test("a resolved keyframe member is `keyframe`, the prefix stays `namespace`", () => {
    const start = offsetOf("$keyframes.spin");
    expect(spanAt(SPANS, start)).toEqual({
      start,
      length: "$keyframes".length,
      type: "namespace",
    });
    expect(spanAt(SPANS, start + "$keyframes.".length)).toEqual({
      start: start + "$keyframes.".length,
      length: "spin".length,
      type: "keyframe",
    });
  });

  test("an unresolvable keyframe member emits the prefix only", () => {
    const start = offsetOf("$keyframes.nope");
    const covering = SPANS.filter(
      (span) => span.start >= start && span.start < start + "$keyframes.nope".length,
    );
    expect(covering).toEqual([{ start, length: "$keyframes".length, type: "namespace" }]);
  });

  test("a keyframe name that is not visible does not resolve", () => {
    const text = "@keyframes spin { from { opacity: 0; } }\n.a { animation: $keyframes.spin 1s; }";
    const analysis = analyze(text, "known.cssx");
    const spans = semanticTokensFor(text, analysis);
    expect(described(spans, text)).toEqual(["$keyframes:namespace", "spin:keyframe"]);
  });
});

describe("semantic tokens — degradation and encoding", () => {
  test("a bare unknown `$name` emits nothing", () => {
    expect(spanAt(SPANS, offsetOf("$ghost"))).toBeUndefined();
  });

  test("parse-error documents classify without throwing", () => {
    const broken = ".a { color: $spacing; .b { padding: 1px";
    const analysis = analyze(broken, "broken.cssx");
    expect(() => semanticTokensFor(broken, analysis)).not.toThrow();
    const spans = semanticTokensFor(broken, analysis);
    expect(
      spans.every((span) => span.start >= 0 && span.start + span.length <= broken.length),
    ).toBe(true);
  });

  test("spans are sorted, non-overlapping and encode as 5-number deltas", () => {
    for (let index = 1; index < SPANS.length; index += 1) {
      const previous = SPANS[index - 1] as SemanticTokenSpan;
      const current = SPANS[index] as SemanticTokenSpan;
      expect(current.start).toBeGreaterThanOrEqual(previous.start + previous.length);
    }

    const text = ".a {\n  color: $one;\n  gap: $two;\n}";
    const analysis = analyze(text, "encode.cssx");
    // Two unknown tokens: craft two known ones instead.
    const known = "@runtime { one: red; two: blue; }\n.a {\n  color: $one;\n  gap: $two;\n}";
    const knownAnalysis = analyze(known, "encode.cssx");
    const knownSpans = semanticTokensFor(known, knownAnalysis);
    expect(described(knownSpans, known)).toEqual(["$one:runtimeVariable", "$two:runtimeVariable"]);
    const encoded = encodeSemanticTokens(knownSpans, knownAnalysis.lineStarts);
    expect(encoded).toEqual([2, 9, 4, 2, 0, 1, 7, 4, 2, 0]);

    // The unknown document still classifies to nothing (grammar fallback).
    expect(semanticTokensFor(text, analysis)).toEqual([]);
  });
});
