/**
 * TT3 · Glob and `exclude` matrix for `packages/cli/src/glob.ts` (weakest-10 #4b/#4c).
 *
 * The existing coverage (`cli-config.test.ts:218`) asserts single-segment `*`,
 * `**`, `?` and one brace pair. These cases add multi-segment `**`, nested
 * braces, unicode (composed/decomposed/emoji) and whitespace in both the
 * include and the exclude direction, plus one end-to-end build proving the
 * matcher is the one discovery really uses.
 *
 * Pattern matching is lexical: no Unicode normalization happens anywhere in the
 * path model, so a composed `exclude` does not match a decomposed path. That is
 * asserted as current behaviour, not corrected here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  discoverSources,
  expandBraces,
  isExcluded,
  matchesGlob,
  normalizeGlobPath,
  staticDirectoryPrefix,
} from "../../../packages/cli/src/glob.ts";
import {
  buildReport,
  cleanupProjects,
  createProject,
  listFiles,
  projectConfig,
  projectPathExists,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

const NFC = "caf\u00e9";
const NFD = "cafe\u0301";

describe("glob matrix", () => {
  test("matches multi-segment `**` at every depth, including zero segments", () => {
    const pattern = "**/**/**/*.cssx";
    expect(matchesGlob("a.cssx", pattern)).toBe(true);
    expect(matchesGlob("src/a.cssx", pattern)).toBe(true);
    expect(matchesGlob("src/deep/er/a.cssx", pattern)).toBe(true);
    expect(matchesGlob("src/deep/er/a.css", pattern)).toBe(false);
    expect(matchesGlob("src/deep/er/a.cssx.bak", pattern)).toBe(false);
    // `**/` as a segment also matches zero segments, so the triple form
    // collapses to "any depth" instead of demanding three levels.
    expect(expandBraces(pattern)).toEqual([pattern]);
    expect(staticDirectoryPrefix(pattern)).toBe("");
  });

  test("expands nested braces and anchors them to the pattern prefix", () => {
    expect(expandBraces("src/{a,{b,{c,d}}}.cssx")).toEqual([
      "src/a.cssx",
      "src/b.cssx",
      "src/c.cssx",
      "src/d.cssx",
    ]);
    expect(matchesGlob("src/c.cssx", "src/{a,{b,{c,d}}}.cssx")).toBe(true);
    expect(matchesGlob("src/d.cssx", "src/{a,{b,{c,d}}}.cssx")).toBe(true);
    expect(matchesGlob("src/e.cssx", "src/{a,{b,{c,d}}}.cssx")).toBe(false);
    // Without the `src/` prefix the brace list is anchored at the root.
    expect(matchesGlob("src/c.cssx", "{a,{b,{c,d}}}.cssx")).toBe(false);
    expect(staticDirectoryPrefix("src/{a,b}.cssx")).toBe("src");
  });

  test("matches unicode, whitespace and single-character segments exactly", () => {
    expect(matchesGlob(`src/${NFC}/a.cssx`, "src/**/*.cssx")).toBe(true);
    expect(matchesGlob("src/a\u{1F3A8}b/a.cssx", "src/**/*.cssx")).toBe(true);
    expect(matchesGlob("src/my dir/a.cssx", "src/**/*.cssx")).toBe(true);
    expect(matchesGlob(`src/${NFC}/a.cssx`, `src/${NFC}/*.cssx`)).toBe(true);
    // `?` is one code unit, so it matches the composed `é` but not the pair.
    expect(matchesGlob(`src/${NFC}/a.cssx`, "src/caf?/*.cssx")).toBe(true);
    expect(matchesGlob(`src/${NFD}/a.cssx`, "src/caf?/*.cssx")).toBe(false);
  });

  test("matches unicode paths lexically with no NFC/NFD folding", () => {
    expect(isExcluded(`src/${NFC}/a.cssx`, [`src/${NFC}`])).toBe(true);
    expect(isExcluded(`src/${NFD}/a.cssx`, [`src/${NFC}`])).toBe(false);
    expect(isExcluded(`src/${NFC}/a.cssx`, ["caf\u00e9"])).toBe(true);
    expect(isExcluded("src/a\u{1F3A8}b/x/a.cssx", ["a\u{1F3A8}b"])).toBe(true);
    expect(isExcluded("src/my dir/a.cssx", ["src/my dir"])).toBe(true);
    expect(isExcluded("src/my dir/a.cssx", ["my dir"])).toBe(true);
    // A bare directory name matches any segment, but not an unrelated prefix.
    expect(isExcluded("node_modules/pkg/a.cssx", ["node_modules"])).toBe(true);
    expect(isExcluded("src/node_modules_x/a.cssx", ["node_modules"])).toBe(false);
  });

  test("normalizes separators and leading `./` for matching", () => {
    expect(normalizeGlobPath("./src/")).toBe("src");
    expect(normalizeGlobPath("src\\nested\\a.cssx")).toBe("src/nested/a.cssx");
    expect(matchesGlob("src/a.cssx", "./src/*.cssx")).toBe(true);
    expect(matchesGlob("src/nested/a.cssx", "src/**/*.cssx")).toBe(true);
  });

  test("discovers exactly the files a nested-brace include selects", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": ".a { color: red; }\n",
      "src/b.cssx": ".b { color: red; }\n",
      "src/c.cssx": ".c { color: red; }\n",
      "src/d.cssx": ".d { color: red; }\n",
      "src/e.cssx": ".e { color: red; }\n",
      "src/skip/f.cssx": ".f { color: red; }\n",
    });

    const included = await discoverSources({
      root,
      include: ["src/{a,{b,{c,d}}}.cssx"],
      exclude: [],
    });
    expect(included).toEqual(["src/a.cssx", "src/b.cssx", "src/c.cssx", "src/d.cssx"]);

    const multi = await discoverSources({
      root,
      include: ["**/**/**/*.cssx"],
      exclude: [`src/${"skip"}`],
    });
    expect(multi).toEqual(["src/a.cssx", "src/b.cssx", "src/c.cssx", "src/d.cssx", "src/e.cssx"]);
  });

  test("applies a unicode exclude end to end and builds only the survivors", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      [`src/${NFC}/kept.cssx`]: ".kept { color: red; }\n",
      [`src/${NFC}/skipped.cssx`]: ".skipped { color: blue; }\n",
      "src/plain.cssx": ".plain { color: green; }\n",
    });
    const stored = readdirSync(join(root, "src")).find((name) => name !== "plain.cssx") ?? "";
    expect([NFC, NFD]).toContain(stored);

    // Excluding the *file* keeps the composed/decomposed question out of scope
    // for the assertion while still exercising a unicode path.
    await writeProjectJson(
      root,
      "xessa.config.json",
      projectConfig({ cssDir: "out", exclude: [`src/${stored}/skipped.cssx`] }),
    );

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.entries.map((entry) => entry.file).sort()).toEqual([
      `src/${stored}/kept.cssx`,
      "src/plain.cssx",
    ]);
    expect(await projectPathExists(root, `out/src/${stored}/kept.css`)).toBe(true);
    expect(listFiles(`${root}/out`).filter((path) => path.includes("skipped"))).toEqual([]);
  }, 60_000);
});
