/**
 * TT3 · Rebuild sequences (§TT3 "Rebuilds").
 *
 * Cases: two sequential builds after changing `@setup` destinations (stale
 * artifact removal), a hand-edited artifact that must be released rather than
 * deleted, `clean` against hand-edited outputs, and repeat-build byte identity.
 *
 * The ownership rule under test (docs/known-limitations.md:41): `build`
 * overwrites configured destinations, while deletion — during a prune or a
 * `clean` — only happens when the on-disk bytes still match the recorded hash.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  buildReport,
  cleanupProjects,
  createProject,
  listFiles,
  projectConfig,
  projectPathExists,
  readManifest,
  readProjectFile,
  removeProjectPath,
  runCli,
  simpleSource,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Source with a `@setup` destination so a rename is a single edit. */
function sourcedWith(name: string, color = "red"): string {
  return `@setup {\n  css-dir: "../gen";\n  css-name: "${name}";\n}\n${simpleSource("a", color)}`;
}

/** Run `xessa clean --json` and parse its report. */
function clean(root: string): {
  readonly status: number;
  readonly removed: ReadonlyArray<{ path: string; reason: string }>;
  readonly skipped: ReadonlyArray<{ path: string; reason: string }>;
  readonly warnings: readonly string[];
} {
  const result = runCli(["clean", "--json"], root);
  return { status: result.status, ...(JSON.parse(result.stdout) as Record<string, never>) };
}

/** One-entry project with the standard config. */
async function project(name = "a.css"): Promise<string> {
  const root = await createProject({
    "xessa.config.json": "",
    "src/a.cssx": sourcedWith(name),
  });
  await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
  return root;
}

describe("rebuilds", () => {
  test("prunes the stale artifact after a @setup destination change", async () => {
    const root = await project("a.css");
    const first = buildReport([], root);
    expect(first.success).toBe(true);
    expect(listFiles(`${root}/gen`)).toEqual(["a.css"]);
    const firstCss = await readProjectFile(root, "gen/a.css");

    await writeProjectFile(root, "src/a.cssx", sourcedWith("b.css"));
    const second = buildReport([], root);
    expect(second.success).toBe(true);
    expect(second.warnings).toEqual([]);

    // The old artifact still matched its recorded hash, so the prune removed it.
    expect(listFiles(`${root}/gen`)).toEqual(["b.css"]);
    expect(await readProjectFile(root, "gen/b.css")).toBe(firstCss);
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/b.css"]);
  }, 60_000);

  test("keeps and releases a hand-edited artifact instead of deleting it", async () => {
    const root = await project("a.css");
    expect(buildReport([], root).success).toBe(true);
    await writeProjectFile(
      root,
      "gen/a.css",
      `${await readProjectFile(root, "gen/a.css")}\n/* hand */\n`,
    );

    await writeProjectFile(root, "src/a.cssx", sourcedWith("b.css"));
    const second = buildReport([], root);
    expect(second.success).toBe(true);
    expect(second.warnings.join("\n")).toContain(
      "Not removing gen/a.css: modified since generation; ownership released.",
    );
    // The edited file survives untouched, and the manifest no longer claims it.
    expect(listFiles(`${root}/gen`)).toEqual(["a.css", "b.css"]);
    expect(await readProjectFile(root, "gen/a.css")).toContain("/* hand */");
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/b.css"]);

    // A second rebuild does not resurrect ownership, so the file is stable.
    const third = buildReport([], root);
    expect(third.success).toBe(true);
    expect(third.warnings).toEqual([]);
    expect(listFiles(`${root}/gen`)).toEqual(["a.css", "b.css"]);
  }, 60_000);

  test("clean deletes owned artifacts and skips the hand-edited one", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": sourcedWith("a.css"),
      "src/b.cssx": sourcedWith("b.css"),
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
    expect(buildReport([], root).success).toBe(true);
    expect(listFiles(`${root}/gen`)).toEqual(["a.css", "b.css"]);
    await writeProjectFile(root, "gen/b.css", "/* hand edited */\n");

    const result = clean(root);
    expect(result.status).toBe(0);
    expect(result.removed).toEqual([{ path: "gen/a.css", reason: "deleted" }]);
    expect(result.skipped).toEqual([{ path: "gen/b.css", reason: "modified" }]);
    expect(listFiles(`${root}/gen`)).toEqual(["b.css"]);
    expect(await readProjectFile(root, "gen/b.css")).toBe("/* hand edited */\n");
    expect((await readManifest(root))?.files).toEqual([]);

    // The manifest is not empty, it is written as an empty document.
    expect(await projectPathExists(root, ".cssx-manifest.json")).toBe(true);
  }, 60_000);

  test("clean drops records for files that are already gone and stays exit 0", async () => {
    const root = await project();
    expect(buildReport([], root).success).toBe(true);
    await removeProjectPath(root, "gen/a.css");

    const result = clean(root);
    expect(result.status).toBe(0);
    expect(result.skipped).toEqual([{ path: "gen/a.css", reason: "missing" }]);
    expect(result.removed).toEqual([]);
    expect((await readManifest(root))?.files).toEqual([]);
  }, 60_000);

  test("two sequential identical builds are byte-identical", async () => {
    const root = await project();
    expect(buildReport([], root).success).toBe(true);
    const firstCss = await readProjectFile(root, "gen/a.css");
    const firstManifest = await readProjectFile(root, ".cssx-manifest.json");
    expect(firstCss).not.toBeNull();

    const second = buildReport([], root);
    expect(second.success).toBe(true);
    expect(await readProjectFile(root, "gen/a.css")).toBe(firstCss);
    expect(await readProjectFile(root, ".cssx-manifest.json")).toBe(firstManifest);
  }, 60_000);
});
