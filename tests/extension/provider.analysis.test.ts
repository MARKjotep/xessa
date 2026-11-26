/**
 * Pure analysis-layer tests for the Xessa VS Code extension.
 *
 * These run without the `vscode` module: the same functions the providers call
 * are exercised with plain text, so diagnostics positions, media alias merging,
 * token extraction, color spans and the debounce/version guard are all verified
 * deterministically (injectable timers, no fixed sleeps).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type SourceText,
  analyzeDocument,
  analyzeText,
  computeLineStarts,
  declarationSegments,
  positionAt,
  resolveMediaAliases,
  tokenReferencesInSegment,
} from "../../packages/vscode/src/analysis.ts";
import { AnalysisService } from "../../packages/vscode/src/service.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CANONICAL = "tests/fixtures/canonical/button/input.cssx";

function fixture(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

function source(text: string, path = "example.cssx", version = 1): SourceText {
  return { text, path: join(ROOT, path), version };
}

function readModule(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

describe("analysis diagnostics", () => {
  test("the canonical fixture has no diagnostics and compiles its class map", async () => {
    const text = fixture(CANONICAL);
    const state = await analyzeDocument(
      { text, path: join(ROOT, CANONICAL), file: CANONICAL, version: 7 },
      { workspaceRoot: ROOT, readModule },
    );
    expect(state.analysis.problems).toEqual([]);
    expect(state.analysis.version).toBe(7);
    expect(state.compiled?.classes.button).toBe("ui-button");
    expect(state.compiled?.classes.icon).toBe("ui-icon");
    expect(state.analysis.prefix).toBe("ui");
  });

  test("semantic diagnostics carry XESSA codes and exact editor positions", async () => {
    const relative = "tests/fixtures/errors/unknown-modifier/input.cssx";
    const text = fixture(relative);
    const state = await analyzeDocument(
      { text, path: join(ROOT, relative), file: relative, version: 1 },
      { workspaceRoot: ROOT },
    );
    const problem = state.analysis.problems.find((entry) => entry.code === "XESSA3001");
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe("error");

    const lineStarts = computeLineStarts(text);
    // The compiler reports the modifier span without the leading `@`.
    const aliasStart = text.indexOf("ultrawide");
    const expectedStart = positionAt(lineStarts, aliasStart);
    const expectedEnd = positionAt(lineStarts, aliasStart + "ultrawide".length);
    expect(problem?.range.start).toEqual(expectedStart);
    expect(problem?.range.end).toEqual(expectedEnd);
    expect(problem?.source).toBe("compile");
  });

  test("parse diagnostics are reported for duplicate setup settings", async () => {
    const relative = "tests/fixtures/errors/duplicate-setting/input.cssx";
    const text = fixture(relative);
    const state = await analyzeDocument(
      { text, path: join(ROOT, relative), file: relative, version: 1 },
      { workspaceRoot: ROOT },
    );
    const problem = state.analysis.problems.find((entry) => entry.code === "XESSA1001");
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe("error");
    expect(problem?.message.toLowerCase()).toContain("duplicate");
  });

  test("a duplicate @variables key is XESSA2001 in a single-file document (CSSX-U04)", async () => {
    const text = [
      "@variables {",
      "  gap: 4px;",
      "  gap: 8px;",
      "}",
      ".card { padding: $gap; }",
    ].join("\n");
    const direct = analyzeText(source(text));
    const duplicates = direct.problems.filter((problem) => problem.code === "XESSA2001");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.severity).toBe("error");
    expect(duplicates[0]?.message).toBe(
      `Duplicate local compile-time variable "$gap" in "${join(ROOT, "example.cssx")}".`,
    );
    // The later declaration is the reported span, matching the resolver.
    expect(duplicates[0]?.range.start).toEqual({ line: 2, character: 2 });

    const state = await analyzeDocument(source(text), { workspaceRoot: ROOT });
    expect(state.analysis.problems.filter((problem) => problem.code === "XESSA2001")).toHaveLength(
      1,
    );
    // The first value still wins in the tolerant compile.
    expect(state.compiled?.css).toContain("padding:4px;");
  });

  test("a module-graph duplicate is reported once by the compiler (CSSX-U04)", async () => {
    const text = [
      '@use "./theme.cssx" as theme;',
      "@variables {",
      "  gap: 4px;",
      "  gap: 8px;",
      "}",
      ".card { padding: $gap; }",
    ].join("\n");
    const state = await analyzeDocument(
      { text, path: join(ROOT, CANONICAL), file: CANONICAL, version: 1 },
      { workspaceRoot: ROOT, readModule },
    );
    const duplicates = state.analysis.problems.filter(
      (problem) =>
        problem.code === "XESSA2001" && /duplicate local compile-time/i.test(problem.message),
    );
    expect(duplicates).toHaveLength(1);
  });

  test("a compile-level failure is reported without throwing", async () => {
    const text = ".card { color: red; }";
    const state = await analyzeDocument(
      { text, path: join(ROOT, "recoverable.cssx"), version: 1 },
      { workspaceRoot: "/definitely/not/a/workspace", readModule },
    );
    // The compiler reports containment as XESSA5001; analysis stays usable.
    expect(state.compiled !== undefined).toBe(true);
    expect(state.analysis.problems.some((problem) => problem.code === "XESSA5001")).toBe(true);
    expect(state.analysis.ast.items.length).toBeGreaterThan(0);
  });
});

describe("media aliases", () => {
  test("built-ins, project config and document definitions merge by layer", () => {
    const text =
      "@media-types { compact: (max-width: 500px); md: (min-width: 900px); }\n.card { color: red; }";
    const analysis = analyzeText(source(text), {
      media: { md: "(min-width: 800px)", huge: "(min-width: 2000px)" },
    });
    const aliases = analysis.mediaAliases;
    expect(aliases.find((alias) => alias.name === "2xl")?.condition).toBe("(min-width: 1536px)");
    expect(aliases.find((alias) => alias.name === "huge")?.layer).toBe("project");
    // File-level `@media-types` wins over the project layer (ADR-0006).
    expect(aliases.find((alias) => alias.name === "md")).toMatchObject({
      condition: "(min-width: 900px)",
      layer: "document",
    });
    expect(aliases.find((alias) => alias.name === "compact")?.layer).toBe("document");
  });

  test("document aliases expose definition ranges from parser spans", () => {
    const text =
      "@media-types { compact: (max-width: 500px); }\n.card { padding: 1px @compact 2px; }";
    const analysis = analyzeText(source(text));
    const compact = analysis.mediaAliases.find((alias) => alias.name === "compact");
    expect(compact?.range?.start).toEqual({ line: 0, character: 15 });
    const expected = resolveMediaAliases(analysis.ast, analysis.lineStarts).find(
      (alias) => alias.name === "compact",
    );
    expect(expected?.condition).toBe("(max-width: 500px)");
  });
});

describe("token symbols and references", () => {
  test("compile-time and runtime tokens are collected with declaration ranges", async () => {
    const text = [
      '@setup { prefix: "ui"; }',
      "@variables { gap: 8px; }",
      "@runtime { primary: #2563eb @dark #60a5fa; }",
      ".card { padding: $gap; color: $primary; }",
    ].join("\n");
    const state = await analyzeDocument(source(text), { workspaceRoot: ROOT });
    const gap = state.analysis.tokens.find((token) => token.name === "gap");
    const primary = state.analysis.tokens.find((token) => token.name === "primary");
    expect(gap).toMatchObject({ kind: "compile", value: "8px" });
    expect(primary).toMatchObject({ kind: "runtime", value: "#2563eb" });
    expect(primary?.variants).toEqual([{ aliases: ["dark"], value: "#60a5fa" }]);
    expect(gap?.declaration.start).toEqual({ line: 1, character: 13 });
  });

  test("imported namespace members resolve through the module reader", async () => {
    const text = fixture(CANONICAL);
    const analysis = analyzeText(
      { text, path: join(ROOT, CANONICAL), file: CANONICAL, version: 1 },
      { readModule },
    );
    const imported = analysis.imports.find((entry) => entry.alias === "theme");
    expect(imported?.specifier).toBe("./theme.cssx");
    expect(imported?.tokens.map((token) => token.name)).toEqual(["primary"]);
    expect(imported?.tokens[0]?.value).toBe("#2563eb");
  });

  test("$ references skip strings, comments and url() contents", () => {
    const text = '$gap url("a$b.png") "\\$gap" /* $gap */ $gap';
    const lineStarts = computeLineStarts(text);
    expect(lineStarts.length).toBe(1);
    const references = tokenReferencesInSegment(text, 0);
    expect(references.map((reference) => reference.text)).toEqual(["$gap", "$gap"]);
    expect(references[0]?.start).toBe(0);
    expect(references[1]?.start).toBe(text.lastIndexOf("$gap"));
  });

  test("value segments recover exact offsets for base and variant values", () => {
    const text = ".card {\n  padding: $gap @md 20px $gap;\n  margin: 1px;\n}";
    const analysis = analyzeText(source(text));
    const rule = analysis.ast.items.find((item) => item.kind === "rule");
    if (rule?.kind !== "rule") throw new Error("expected a rule");
    const declaration = rule.body.find((item) => item.kind === "declaration");
    if (declaration?.kind !== "declaration") throw new Error("expected a declaration");
    const segments = declarationSegments(text, declaration);
    expect(segments.map((segment) => segment.text)).toEqual(["$gap", "20px $gap"]);
    expect(segments[0]?.start).toBe(text.indexOf("$gap"));
    expect(segments[1]?.start).toBe(text.indexOf("20px"));
  });
});

describe("colors and classes", () => {
  test("hex colors are collected only from declaration values", () => {
    const text = '.card { color: #1e40af; content: "#fff"; }';
    const analysis = analyzeText(source(text));
    expect(analysis.colors.map((color) => color.value)).toEqual(["#1e40af"]);
    expect(analysis.colors[0]?.range.start).toEqual({ line: 0, character: 15 });
  });

  test("selector classes expose generated names and :global exclusion", () => {
    const text =
      '@setup { prefix: "ui"; }\n.card { & > .icon { width: 1px; } &:global(.external) { color: red; } }';
    const analysis = analyzeText(source(text));
    const occurrences = analysis.classes;
    expect(occurrences.find((entry) => entry.name === "card")).toMatchObject({
      generated: "ui-card",
      global: false,
    });
    expect(occurrences.find((entry) => entry.name === "icon")).toMatchObject({
      generated: "ui-icon",
      global: false,
    });
    expect(occurrences.find((entry) => entry.name === "external")).toMatchObject({
      generated: "external",
      global: true,
    });
  });
});

describe("group analysis surface", () => {
  test("exposes the absolute document path and resolved group visibility", () => {
    const relative = "tests/fixtures/groups/style-import/entry.cssx";
    const text = fixture(relative);
    const analysis = analyzeText({ text, path: join(ROOT, relative), version: 1 }, { readModule });
    expect(analysis.path).toBe(join(ROOT, relative));
    expect(analysis.groups).toHaveLength(1);
    const entry = analysis.groups[0];
    expect(entry?.kind).toBe("resolved");
    if (entry?.kind !== "resolved") return;
    expect(entry.symbol.name).toBe("card");
    expect(entry.symbol.file.endsWith("chrome.cssx")).toBe(true);
    expect(entry.symbol.defaults.map((value) => value.property)).toEqual(["padding", "border"]);
    expect(entry.symbol.references).toHaveLength(1);
  });

  test("local definitions shadow styles imports and token-only imports expose no groups", () => {
    const localRelative = "tests/fixtures/groups/local-shadows-import/entry.cssx";
    const local = analyzeText(
      { text: fixture(localRelative), path: join(ROOT, localRelative), version: 1 },
      { readModule },
    );
    const resolved = local.groups.find((entry) => entry.name === "card");
    expect(resolved?.kind).toBe("resolved");
    if (resolved?.kind === "resolved") {
      expect(resolved.symbol.file).toBe(join(ROOT, localRelative));
      expect(resolved.symbol.defaults.map((value) => value.property)).toEqual(["padding"]);
    }

    const tokenOnlyRelative = "tests/fixtures/groups/token-only/entry.cssx";
    const tokenOnly = analyzeText(
      { text: fixture(tokenOnlyRelative), path: join(ROOT, tokenOnlyRelative), version: 1 },
      { readModule },
    );
    expect(tokenOnly.groups).toEqual([]);
  });
});

describe("analysis service", () => {
  test("debounces and only reports the newest document version", async () => {
    const callbacks: (() => void)[] = [];
    const service = new AnalysisService(async (input) => ({ analysis: analyzeText(input) }), {
      delayMs: 10,
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length - 1;
      },
      clearTimer: (handle) => {
        callbacks[handle as number] = () => undefined;
      },
    });
    const seen: number[] = [];
    const first = source(".a { color: red; }", "debounce.cssx", 1);
    const second = source(".a { color: blue; }", "debounce.cssx", 2);
    service.schedule(first, (state) => seen.push(state.analysis.version));
    service.schedule(second, (state) => seen.push(state.analysis.version));
    for (const callback of callbacks) callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([2]);
    expect(service.cached(second)?.analysis.version).toBe(2);
  });

  test("a late stale analysis cannot overwrite a newer cached result", async () => {
    const gates = new Map<number, (state: Awaited<ReturnType<typeof analyzeDocument>>) => void>();
    const service = new AnalysisService(
      (input) =>
        new Promise((resolve) => {
          gates.set(input.version, resolve);
        }),
    );
    const versionOne = source(".a { color: red; }", "stale.cssx", 1);
    const versionTwo = source(".a { color: blue; }", "stale.cssx", 2);
    const first = service.analyzeNow(versionOne);
    const second = service.analyzeNow(versionTwo);
    gates.get(2)?.({ analysis: analyzeText(versionTwo) });
    await second;
    gates.get(1)?.({ analysis: analyzeText(versionOne) });
    await first;
    expect(service.cached(versionTwo)?.analysis.version).toBe(2);
  });

  test("invalidateAll drops every cached state so importers re-analyze", async () => {
    let analyses = 0;
    const service = new AnalysisService(async (input) => {
      analyses += 1;
      return { analysis: analyzeText(input) };
    });
    const importer = source(".a { padding: $t.space; }", "importer.cssx", 3);

    await service.analyzeNow(importer);
    expect(service.cached(importer)?.analysis.version).toBe(3);
    expect(analyses).toBe(1);

    // A dependency changed: the cached entry for an unchanged importer
    // version must not survive and must be recomputed on the next request.
    service.invalidateAll();
    expect(service.cached(importer)).toBeUndefined();
    await service.analyzeNow(importer);
    expect(analyses).toBe(2);
    expect(service.cached(importer)?.analysis.version).toBe(3);
  });

  test("an analysis spanning invalidateAll is neither cached nor notified", async () => {
    const callbacks: (() => void)[] = [];
    let release: (() => void) | undefined;
    const service = new AnalysisService(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve({ analysis: analyzeText(input) });
        }),
      {
        setTimer: (callback) => {
          callbacks.push(callback);
          return callbacks.length - 1;
        },
        clearTimer: () => undefined,
      },
    );
    const importer = source(".a { padding: $t.space; }", "inflight.cssx", 1);
    const seen: number[] = [];
    service.schedule(importer, (state) => seen.push(state.analysis.version));
    callbacks[0]?.();
    service.invalidateAll();
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([]);
    expect(service.cached(importer)).toBeUndefined();
  });
});
