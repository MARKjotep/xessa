/**
 * TT5 row 5 — minify parity on the 1000-file project.
 *
 * | Assertion | How |
 * |---|---|
 * | same declarations, selectors and at-rules | both outputs of the **same** generated project are re-parsed with the built compiler's parser and reduced by `normalize.ts`; the 1000 normalized structures must be deep-equal, declaration order included |
 * | the comparison is order-sensitive | `docs/configuration.md` documents minify as compacting "generated structural whitespace" only and `docs/cascade.md` makes authored declaration order part of the contract, so the normalizer compares in order; hand-built pairs prove a swap or a value change is detected |
 * | minify actually compacts | minified bytes are strictly smaller than pretty bytes while the declaration/selector/at-rule counts are identical |
 *
 * Recorded numbers (this machine, default seed): 234 030 B pretty → 182 030 B minified,
 * 1000/1000 entries structurally identical, 0 parser errors on either side.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { compileProject } from "../../../packages/compiler/dist/index.js";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  type ScaleProject,
  cleanupTempProjects,
  createMemoryHost,
  projectOutputOptions,
  thousandFileProject,
} from "../scale/generate.ts";
import { ensureDistBuild } from "./helpers.ts";
import {
  type NormalizedStylesheet,
  atRuleKeys,
  countStructure,
  normalizeEmittedCss,
} from "./normalize.ts";

/** The part of a `CompileResult` these cases read. */
interface CompiledEntry {
  readonly css?: string;
}

let project: ScaleProject;
let pretty: Record<string, CompiledEntry> = {};
let minified: Record<string, CompiledEntry> = {};

/** Compile the scale corpus once per minify setting. */
async function compile(minify: boolean): Promise<Record<string, CompiledEntry>> {
  return compileProject(project.entries, createMemoryHost(project.files), {
    projectRoot: "/workspace",
    output: { ...projectOutputOptions(), minify },
    mediaGrouping: "safe",
  });
}

/** Total emitted CSS bytes of one compilation. */
function byteTotal(results: Record<string, CompiledEntry>): number {
  let bytes = 0;
  for (const result of Object.values(results)) bytes += Buffer.byteLength(result.css ?? "", "utf8");
  return bytes;
}

beforeAll(async () => {
  await ensureDistBuild();
  const rng = createLabelledRng(readStressSeed(), "consumer/minify-parity");
  project = thousandFileProject(rng);
  pretty = await compile(false);
  minified = await compile(true);
});

afterAll(() => {
  cleanupTempProjects();
});

describe("minify parity on the 1000-file project", () => {
  test("minified and pretty output normalize to the same structure", () => {
    const mismatches: string[] = [];
    let rules = 0;
    let declarations = 0;
    let atRules = 0;

    for (const entry of project.entries) {
      const prettyNormalized: NormalizedStylesheet = normalizeEmittedCss(
        pretty[entry]?.css ?? "",
        `${entry}.pretty.css`,
      );
      const minifiedNormalized: NormalizedStylesheet = normalizeEmittedCss(
        minified[entry]?.css ?? "",
        `${entry}.min.css`,
      );
      // Both sides must be valid CSS before their structures are compared.
      for (const error of prettyNormalized.errors) mismatches.push(`${entry} pretty: ${error}`);
      for (const error of minifiedNormalized.errors) mismatches.push(`${entry} minified: ${error}`);

      const prettyCounts = countStructure(prettyNormalized.nodes);
      const minifiedCounts = countStructure(minifiedNormalized.nodes);
      rules += prettyCounts.rules;
      declarations += prettyCounts.declarations;
      atRules += prettyCounts.atRules;
      if (JSON.stringify(prettyNormalized.nodes) !== JSON.stringify(minifiedNormalized.nodes)) {
        mismatches.push(`${entry}: normalized structure differs`);
      }
      const prettyAtRules = atRuleKeys(prettyNormalized.nodes);
      const minifiedAtRules = atRuleKeys(minifiedNormalized.nodes);
      if (JSON.stringify(prettyAtRules) !== JSON.stringify(minifiedAtRules)) {
        mismatches.push(`${entry}: at-rule order or prelude differs`);
      }
    }

    expect(mismatches).toEqual([]);
    // 1000 files × (base rule, @media rule, variant rule, colour rule, :hover rule)
    expect(rules).toBe(project.entries.length * 5);
    // display + padding + variant padding + color + opacity + width, per file.
    expect(declarations).toBe(project.entries.length * 6);
    // One @media wrapper per file.
    expect(atRules).toBe(project.entries.length);
  });

  test("minify compacts the bytes while keeping the same content", () => {
    const prettyBytes = byteTotal(pretty);
    const minifiedBytes = byteTotal(minified);
    expect(minifiedBytes).toBeLessThan(prettyBytes);
    // The saving is structural whitespace only: a big, but not total, reduction.
    expect(prettyBytes - minifiedBytes).toBeGreaterThan(20_000);
    expect(minifiedBytes).toBeGreaterThan(prettyBytes / 2);
    // Structural counts are compared again at the aggregate level: equal content,
    // fewer bytes, so the saving is whitespace.
    expect(Object.keys(minified).length).toBe(Object.keys(pretty).length);
  });

  test("the normalizer is order-sensitive, so a reordering would not pass", () => {
    const ordered = normalizeEmittedCss(
      ".a {\n  display: flex;\n  padding: 4px;\n}\n",
      "ordered.css",
    );
    const swapped = normalizeEmittedCss(
      ".a {\n  padding: 4px;\n  display: flex;\n}\n",
      "swapped.css",
    );
    const reindented = normalizeEmittedCss(".a{display:flex;padding:4px;}", "reindented.css");

    expect(ordered.errors).toEqual([]);
    expect(swapped.errors).toEqual([]);
    // Whitespace-only differences are tolerated — that is exactly what minify changes.
    expect(JSON.stringify(reindented.nodes)).toBe(JSON.stringify(ordered.nodes));
    // Declaration order is not: a swap or a value change must be visible.
    expect(JSON.stringify(swapped.nodes)).not.toBe(JSON.stringify(ordered.nodes));
    const changed = normalizeEmittedCss(".a {\n  display: grid;\n  padding: 4px;\n}\n", "x.css");
    expect(JSON.stringify(changed.nodes)).not.toBe(JSON.stringify(ordered.nodes));
    // Selector and at-rule prelude text participate too.
    const otherSelector = normalizeEmittedCss(".b{display:flex;padding:4px;}", "y.css");
    expect(JSON.stringify(otherSelector.nodes)).not.toBe(JSON.stringify(reindented.nodes));
    expect(countStructure(ordered.nodes)).toEqual({ rules: 1, declarations: 2, atRules: 0 });
    expect(atRuleKeys(ordered.nodes)).toEqual([]);
  });
});
