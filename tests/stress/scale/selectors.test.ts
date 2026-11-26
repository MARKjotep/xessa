/**
 * TT2 selectors and lowering at scale — plan §TT2 rows 1, 2 and 5.
 *
 * | Case | Assertion |
 * |---|---|
 * | 10k-selector project, 5k-token file | zero error diagnostics; every emitted CSS re-parses |
 * | one rule with 100 media variants | emitted CSS valid; grouped output keeps declaration order |
 * | 1k-deep `&` chain, 500-item selector list | emitted selectors remain valid CSS |
 *
 * Inputs are seeded (`createLabelledRng(readStressSeed(), …)`); sizes are fixed
 * by the plan. Emitted validity uses the compiler's tolerant `parse()` on the
 * emitted text plus a `xessa check` subprocess on the real 1000-file project
 * (see `project.test.ts`); a third-party CSS parser is an owner dependency
 * decision and is deliberately not introduced.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { compile, compileProject, createNodeHost } from "../../../packages/compiler/src/index.ts";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  SCALE,
  ampChainCase,
  cleanupTempProjects,
  createTempProject,
  cssClassTokens,
  cssErrorMessages,
  declarationValues,
  mediaQueries,
  mediaVariantCase,
  projectOutputOptions,
  selectorScaleProject,
  tokenCount,
} from "./generate.ts";

afterAll(cleanupTempProjects);

describe("TT2 10k-selector project, 5k-token file", () => {
  test("builds with zero error diagnostics and every emitted stylesheet re-parses", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/selectors");
    const project = selectorScaleProject(rng);

    // The token-heavy file is a stated 5k-token input, not an estimate.
    const tokenSource = project.files["src/tokens.cssx"];
    expect(tokenSource).toBeDefined();
    expect(tokenCount(tokenSource ?? "")).toBeGreaterThanOrEqual(5_000);

    const root = createTempProject(project.files);
    const results = await compileProject(project.entries, createNodeHost(root), {
      projectRoot: root,
      output: projectOutputOptions(),
      mediaGrouping: "safe",
    });
    expect(Object.keys(results)).toHaveLength(project.entries.length);

    const errors: string[] = [];
    const reparseErrors: string[] = [];
    const classNames = new Set<string>();
    const cardClasses = new Set<string>();
    for (const [entry, result] of Object.entries(results)) {
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity === "error") errors.push(`${entry}: ${diagnostic.code}`);
      }
      expect(result.css).toBeDefined();
      const css = result.css ?? "";
      reparseErrors.push(...cssErrorMessages(css).map((message) => `${entry}: ${message}`));
      for (const match of css.matchAll(/\.(card-\d{3}-\d{3})/gu)) {
        if (match[1] !== undefined) cardClasses.add(match[1]);
      }
      for (const className of Object.keys(result.classes)) classNames.add(className);
    }

    expect(errors).toEqual([]);
    expect(reparseErrors).toEqual([]);
    expect(project.entries.filter((entry) => entry.includes("file-"))).toHaveLength(
      SCALE.selectorFiles,
    );
    expect(cardClasses.size).toBe(SCALE.selectorFiles * SCALE.rulesPerFile);
    expect(classNames.size).toBe(SCALE.selectorFiles * SCALE.rulesPerFile + 1);
  }, 120_000);
});

describe("TT2 one rule with 100 media variants", () => {
  test("grouped output is valid CSS and keeps the authored declaration/media order", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/media");
    const media = mediaVariantCase(rng);
    expect(media.values).toHaveLength(SCALE.mediaVariants + 1);
    expect(media.aliases).toHaveLength(SCALE.mediaVariants);

    const result = await compile(media.source, {
      file: "src/media.cssx",
      workspaceRoot: "/tmp/xessa-scale-media",
      mediaGrouping: "safe",
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const css = result.css ?? "";
    expect(css.length).toBeGreaterThan(0);

    expect(cssErrorMessages(css)).toEqual([]);
    expect(declarationValues(css, "width")).toEqual([...media.values]);
    expect(mediaQueries(css)).toEqual(media.aliases.map((alias) => alias.query));
    expect(mediaQueries(css)).toHaveLength(SCALE.mediaVariants);
  }, 120_000);
});

describe("TT2 1k-deep `&` chain, 500-item selector list", () => {
  test("emitted selectors stay valid CSS at full depth and list width", async () => {
    const rng = createLabelledRng(readStressSeed(), "scale/amp");
    const chain = ampChainCase(rng);
    expect(chain.depth).toBe(SCALE.ampDepth);
    expect(chain.selectorCount).toBe(SCALE.selectorListItems);

    const result = await compile(chain.source, {
      file: "src/chain.cssx",
      workspaceRoot: "/tmp/xessa-scale-amp",
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const css = result.css ?? "";
    expect(css.length).toBeGreaterThan(0);
    expect(cssErrorMessages(css)).toEqual([]);

    // The first `{` closes the selector list of the deepest rule.
    const selectorList = (css.split("{")[0] ?? "").trim();
    expect(selectorList.split(",")).toHaveLength(SCALE.selectorListItems);

    // Each nested `&.m<n>` compounds into the emitted selector, in nesting order.
    const firstSelector = (selectorList.split(",")[0] ?? "").trim();
    expect(firstSelector.startsWith(".chain.m0.m1.")).toBe(true);
    let cursor = 0;
    for (const suffix of chain.chainSuffixes) {
      const found = firstSelector.indexOf(`.${suffix}`, cursor);
      expect(found).toBeGreaterThanOrEqual(cursor);
      cursor = found + suffix.length + 1;
    }
    expect(firstSelector).toContain(".s0");
    expect(firstSelector.length).toBeGreaterThan(SCALE.ampDepth * 3);
    const lastSelector = (selectorList.split(",").at(-1) ?? "").trim();
    expect(lastSelector).toContain(`.s${SCALE.selectorListItems - 1}`);
    expect(lastSelector.slice(0, SCALE.ampDepth)).toBe(firstSelector.slice(0, SCALE.ampDepth));

    const emittedClasses = cssClassTokens(css);
    expect(emittedClasses).toHaveLength(SCALE.ampDepth + SCALE.selectorListItems + 1);
  }, 120_000);
});
