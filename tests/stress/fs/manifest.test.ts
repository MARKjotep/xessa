/**
 * TT3 · Manifest robustness (weakest-10 #2c/#2d).
 *
 * `.cssx-manifest.json` is the only record of which outputs the compiler owns.
 * The plan's row: "deleted, truncated JSON, valid JSON with tampered
 * hashes/paths, manifest from a different project → typed diagnostic
 * classification, never a crash".
 *
 * Classification in `packages/cli/src/manifest.ts` is warn-and-ignore, so every
 * case here asserts both directions: the build keeps working, and the
 * dangerous record is dropped rather than acted on.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildReport,
  cleanupProjects,
  createProject,
  deleteManifest,
  listFiles,
  projectConfig,
  projectPathExists,
  readManifest,
  readProjectFile,
  runCli,
  simpleSource,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** SHA-256 in the manifest's `sha256:<hex>` form. */
function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Hash of a file inside a project, or `null` when it is absent. */
async function hashProjectFile(root: string, path: string): Promise<string | null> {
  const text = await readProjectFile(root, path);
  return text === null ? null : hashContent(text);
}

/** Source with a `@setup` destination so a rename is a single edit. */
function sourcedWith(name: string, selector = "a"): string {
  return `@setup {\n  css-dir: "../gen";\n  css-name: "${name}";\n}\n${simpleSource(selector)}`;
}

/** Run `xessa clean --json` and parse its report. */
function clean(
  root: string,
  args: readonly string[] = [],
): {
  readonly status: number;
  readonly removed: ReadonlyArray<{ path: string; reason: string }>;
  readonly skipped: ReadonlyArray<{ path: string; reason: string }>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
} {
  const result = runCli(["clean", "--json", ...args], root);
  return { status: result.status, ...(JSON.parse(result.stdout) as Record<string, never>) };
}

/** Create the standard one-entry manifest project. */
async function manifestProject(name = "a.css"): Promise<string> {
  const root = await createProject({
    "xessa.config.json": "",
    "src/a.cssx": sourcedWith(name),
  });
  await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
  return root;
}

describe("manifest classification", () => {
  test("a deleted manifest is rebuilt silently and the build still succeeds", async () => {
    const root = await manifestProject();
    expect(buildReport([], root).success).toBe(true);
    await deleteManifest(root);

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.warnings).toEqual([]);
    const manifest = await readManifest(root);
    expect(manifest?.version).toBe(1);
    expect(manifest?.files.map((record) => record.path)).toEqual(["gen/a.css"]);
    expect(manifest?.files[0]?.hash).toBe(await hashProjectFile(root, "gen/a.css"));
  }, 60_000);

  test("truncated JSON is warned about, ignored, and rewritten — ownership is lost", async () => {
    const root = await manifestProject("a.css");
    expect(buildReport([], root).success).toBe(true);

    const text = (await readProjectFile(root, ".cssx-manifest.json")) ?? "";
    await writeProjectFile(root, ".cssx-manifest.json", text.slice(0, 40));
    // A destination change in the same run: with a readable manifest the stale
    // `a.css` would be pruned; with a truncated one the CLI cannot know it owns
    // it, so the file is kept as an orphan.
    await writeProjectFile(root, "src/a.cssx", sourcedWith("b.css"));

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.warnings.join("\n")).toContain("Ignoring .cssx-manifest.json: invalid JSON.");
    expect(listFiles(`${root}/gen`)).toEqual(["a.css", "b.css"]);
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/b.css"]);
  }, 60_000);

  test("a tampered hash makes clean keep the file and release ownership", async () => {
    const root = await manifestProject();
    expect(buildReport([], root).success).toBe(true);
    const manifestText = (await readProjectFile(root, ".cssx-manifest.json")) ?? "";
    const tampered = manifestText.replace(/sha256:[0-9a-f]{64}/, `sha256:${"0".repeat(64)}`);
    await writeProjectFile(root, ".cssx-manifest.json", tampered);

    const result = clean(root);
    expect(result.status).toBe(0);
    expect(result.skipped).toEqual([{ path: "gen/a.css", reason: "modified" }]);
    expect(result.removed).toEqual([]);
    expect(result.warnings.join("\n")).toContain("modified since generation");
    expect(await projectPathExists(root, "gen/a.css")).toBe(true);
    expect((await readManifest(root))?.files).toEqual([]);
  }, 60_000);

  test("a tampered hash on an obsolete record keeps the file during a prune", async () => {
    const root = await manifestProject("a.css");
    expect(buildReport([], root).success).toBe(true);
    const manifestText = (await readProjectFile(root, ".cssx-manifest.json")) ?? "";
    await writeProjectFile(
      root,
      ".cssx-manifest.json",
      manifestText.replace(/sha256:[0-9a-f]{64}/, `sha256:${"0".repeat(64)}`),
    );
    await writeProjectFile(root, "src/a.cssx", sourcedWith("b.css"));

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.warnings.join("\n")).toContain(
      "Not removing gen/a.css: modified since generation; ownership released.",
    );
    expect(listFiles(`${root}/gen`)).toEqual(["a.css", "b.css"]);
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/b.css"]);
  }, 60_000);

  test("tampered paths that leave the workspace are ignored and never deleted", async () => {
    const sandbox = await createProject({
      "ws/xessa.config.json": "",
      "ws/src/a.cssx": sourcedWith("a.css"),
      "outside/valuable.txt": "keep me\n",
    });
    const root = `${sandbox}/ws`;
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
    expect(buildReport([], root).success).toBe(true);

    const outsideHash = hashContent("keep me\n");
    const manifest = await readManifest(root);
    const records = [
      ...(manifest?.files ?? []),
      { kind: "css", path: "../../outside/valuable.txt", source: "src/a.cssx", hash: outsideHash },
      { kind: "css", path: "/etc/hosts", source: "src/a.cssx", hash: outsideHash },
    ];
    await writeProjectJson(root, ".cssx-manifest.json", { version: 1, files: records });

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    const unsafe = report.warnings.filter((warning) => warning.includes("Ignoring unsafe"));
    expect(unsafe).toHaveLength(2);
    expect(unsafe.join("\n")).toContain("../../outside/valuable.txt");
    expect(unsafe.join("\n")).toContain("/etc/hosts");

    const cleaned = clean(root);
    expect(cleaned.status).toBe(0);
    expect(await readProjectFile(sandbox, "outside/valuable.txt")).toBe("keep me\n");
    expect(await projectPathExists(root, "gen/a.css")).toBe(false);
  }, 60_000);

  test("malformed entries and an unknown version are classified, not crashed on", async () => {
    const root = await manifestProject();
    expect(buildReport([], root).success).toBe(true);

    await writeProjectJson(root, ".cssx-manifest.json", {
      version: 1,
      files: [
        { kind: "bogus", path: "gen/x.css", source: "src/a.cssx", hash: hashContent("x") },
        { kind: "css", path: "gen/y.css", source: "src/a.cssx", hash: "not-a-hash" },
        { kind: "css", path: "", source: "src/a.cssx", hash: hashContent("y") },
      ],
    });
    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.warnings.filter((warning) => warning.includes("malformed"))).toHaveLength(3);
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/a.css"]);

    await writeProjectJson(root, ".cssx-manifest.json", { version: 99, files: [] });
    const versioned = buildReport([], root);
    expect(versioned.success).toBe(true);
    expect(versioned.warnings.join("\n")).toContain("unsupported manifest version");
    expect((await readManifest(root))?.version).toBe(1);
  }, 60_000);

  test("a manifest copied from another project is reconciled without a crash", async () => {
    const foreign = await manifestProject("foreign.css");
    expect(buildReport([], foreign).success).toBe(true);
    const foreignManifest = (await readFile(join(foreign, ".cssx-manifest.json"), "utf8")) ?? "";

    const root = await createProject({
      "xessa.config.json": "",
      "src/own.cssx": sourcedWith("own.css", "own"),
      "notes.txt": "user notes\n",
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ include: ["src/*.cssx"] }));
    const parsed = JSON.parse(foreignManifest) as { files: Record<string, unknown>[] };
    const notesHash = await hashProjectFile(root, "notes.txt");
    // Keep the foreign records and add one pointing at a real file in this
    // project with a hash that does not match its content.
    await writeProjectJson(root, ".cssx-manifest.json", {
      version: 1,
      files: [
        ...parsed.files,
        { kind: "css", path: "notes.txt", source: "src/own.cssx", hash: notesHash },
      ],
    });

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.errors).toEqual([]);
    // The foreign path does not exist here and is dropped silently; the local
    // record whose hash matched is *not* artifact-shaped, so it is released and
    // the user file survives (CSSX-T10). The manifest ends up holding exactly
    // this project's artifacts.
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(["gen/own.css"]);
    expect(await projectPathExists(root, "gen/own.css")).toBe(true);
    expect(await readProjectFile(root, "notes.txt")).toBe("user notes\n");
  }, 60_000);

  test("a manifest path replaced by a directory fails the run without losing artifacts", async () => {
    const root = await manifestProject();
    await mkdir(join(root, ".cssx-manifest.json"), { recursive: true });
    await writeProjectFile(root, ".cssx-manifest.json/keep.txt", "occupied\n");

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.errors.join("\n")).toContain("Could not update .cssx-manifest.json");
    // Artifacts are written before the manifest, so the CSS survives; the
    // writer's temporary file is removed and no stray file is left behind.
    expect(await projectPathExists(root, "gen/a.css")).toBe(true);
    expect(listFiles(root).filter((path) => path.includes(".cssx-tmp"))).toEqual([]);
  }, 60_000);

  test("an in-workspace tampered record with a matching hash is released, not deleted (CSSX-T10)", async () => {
    const root = await manifestProject();
    expect(buildReport([], root).success).toBe(true);
    await writeFile(join(root, "notes.txt"), "user notes\n", "utf8");
    const manifest = await readManifest(root);
    await writeProjectJson(root, ".cssx-manifest.json", {
      version: 1,
      files: [
        ...(manifest?.files ?? []),
        {
          kind: "css",
          path: "notes.txt",
          source: "src/a.cssx",
          hash: hashContent("user notes\n"),
        },
      ],
    });

    const result = clean(root);
    expect(result.status).toBe(0);
    // The record is in the workspace and its hash matches, but `notes.txt` is not
    // an artifact-shaped path for kind `css`. `clean` refuses to delete it and
    // reports the record as skipped (ownership released).
    expect(result.removed.map((item) => item.path)).toEqual(["gen/a.css"]);
    expect(result.skipped).toEqual([{ path: "notes.txt", reason: "untrusted" }]);
    expect(result.warnings).toContain(
      "Refusing to delete notes.txt: the record does not describe a compiler artifact; ownership released.",
    );
    expect(await readProjectFile(root, "notes.txt")).toBe("user notes\n");
  }, 60_000);
});
