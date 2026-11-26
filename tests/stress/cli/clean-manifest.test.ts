/**
 * TT4 · `clean` against manifests the compiler did not just write.
 *
 * `tests/integration/cli-build.test.ts` already pins the happy path and the
 * "artifact modified since generation" rule. This suite extends `clean` to a
 * hand-edited manifest, a manifest with foreign/escaping paths, a manifest whose
 * files are all gone, and the follow-up run that must be a no-op.
 *
 * Ownership is hash-based *and* shape-based: a record is deletable only when its
 * current bytes match the recorded hash and its path/source have the shape of a
 * compiler artifact (CSSX-T10). The forged-record case below asserts that a
 * non-artifact file is released instead of deleted.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupProjects,
  createProject,
  exists,
  hashOfFile,
  parseJson,
  readText,
  runCli,
  writeText,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

interface CleanJson {
  command: string;
  success: boolean;
  exitCode: number;
  dryRun: boolean;
  removed: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
  errors: string[];
}

interface Manifest {
  version: number;
  files: Array<{ kind: string; path: string; source: string; hash: string }>;
}

/** Empty project: `xessa clean` needs only a config to locate the workspace root. */
async function emptyProject(): Promise<string> {
  const root = await createProject("");
  await writeText(
    join(root, "xessa.config.json"),
    `${JSON.stringify({ include: ["src/**/*.cssx"] })}\n`,
  );
  await writeText(join(root, "src/placeholder.cssx"), ".placeholder { color: red; }\n");
  return root;
}

async function writeManifest(root: string, files: Manifest["files"]): Promise<void> {
  await writeText(
    join(root, ".cssx-manifest.json"),
    `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
  );
}

describe("clean against a hand-edited manifest", () => {
  test("a tampered hash releases ownership and keeps the file", async () => {
    const root = await createProject("basic");
    expect(runCli(["build"], root).status).toBe(0);

    const manifestPath = join(root, ".cssx-manifest.json");
    const manifest = JSON.parse((await readText(manifestPath)) ?? "{}") as Manifest;
    const target = "generated/styles/card.css";
    const tampered: Manifest = {
      version: 1,
      files: manifest.files.map((record) =>
        record.path === target ? { ...record, hash: `sha256:${"0".repeat(64)}` } : record,
      ),
    };
    await writeFile(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const result = runCli(["clean", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<CleanJson>(result.stdout, "clean tampered hash");
    expect(report.success).toBe(true);
    expect(report.skipped).toEqual([{ path: target, reason: "modified" }]);
    expect(report.removed).toHaveLength(5);
    expect(report.removed.map((item) => item.path)).not.toContain(target);
    expect(report.warnings).toEqual([
      `Kept ${target}: modified since generation; ownership released.`,
    ]);

    expect(await exists(join(root, target))).toBe(true);
    expect(await exists(join(root, "generated/styles/button.css"))).toBe(false);
    const after = parseJson<Manifest>(await readText(manifestPath), "manifest after clean");
    expect(after.files).toEqual([]);
  });

  test("a second clean is a no-op once ownership was released", async () => {
    const root = await createProject("basic");
    expect(runCli(["build"], root).status).toBe(0);
    const target = "generated/styles/card.css";
    await writeFile(join(root, target), "/* hand edit */\n", "utf8");

    expect(runCli(["clean"], root).status).toBe(0);
    const kept = await readText(join(root, target));
    const manifest = await readText(join(root, ".cssx-manifest.json"));

    const again = runCli(["clean", "--json"], root);
    expect(again.status).toBe(0);
    const report = parseJson<CleanJson>(again.stdout, "second clean");
    expect(report.removed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(await readText(join(root, target))).toBe(kept);
    expect(await readText(join(root, ".cssx-manifest.json"))).toBe(manifest);
  });
});

describe("clean against a foreign manifest", () => {
  test("records outside the workspace are ignored and never deleted", async () => {
    const root = await emptyProject();
    const outside = `${root}-outside.txt`;
    await writeFile(outside, "outside the workspace\n", "utf8");

    await writeManifest(root, [
      { kind: "css", path: "../outside.txt", source: "src/placeholder.cssx", hash: "sha256:abc" },
      { kind: "css", path: "/etc/hosts", source: "src/placeholder.cssx", hash: "sha256:def" },
      {
        kind: "css",
        path: "out/../../escape.css",
        source: "src/placeholder.cssx",
        hash: "sha256:ghi",
      },
    ]);

    try {
      const result = runCli(["clean", "--json"], root);
      expect(result.status).toBe(0);
      const report = parseJson<CleanJson>(result.stdout, "clean foreign manifest");
      expect(report.removed).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.warnings).toEqual([
        "Ignoring unsafe .cssx-manifest.json path: ../outside.txt",
        "Ignoring unsafe .cssx-manifest.json path: /etc/hosts",
        "Ignoring manifest path outside the workspace: out/../../escape.css",
      ]);
      // The escaping paths are dropped from the rewritten manifest.
      const manifest = parseJson<Manifest>(
        await readText(join(root, ".cssx-manifest.json")),
        "manifest after foreign clean",
      );
      expect(manifest.files).toEqual([]);
      expect(await readFile(outside, "utf8")).toBe("outside the workspace\n");
    } finally {
      await rm(outside, { force: true });
    }
  });

  test("a hand-written record for a non-artifact file is released, not deleted (CSSX-T10)", async () => {
    // A matching hash alone is not proof of ownership. `clean` also requires an
    // artifact-shaped path for the record's kind and an in-workspace `.cssx`
    // source, so a tampered manifest cannot delete a user file.
    const root = await emptyProject();
    const foreign = join(root, "notes.txt");
    const content = "hand-written file the compiler never produced\n";
    await writeFile(foreign, content, "utf8");
    await writeManifest(root, [
      {
        kind: "css",
        path: "notes.txt",
        source: "src/placeholder.cssx",
        hash: await hashOfFile(foreign),
      },
    ]);

    const dryRun = runCli(["clean", "--dry-run", "--json"], root);
    expect(dryRun.status).toBe(0);
    const dryReport = parseJson<CleanJson>(dryRun.stdout, "clean foreign matching hash dry-run");
    expect(dryReport.removed).toEqual([]);
    expect(dryReport.skipped).toEqual([{ path: "notes.txt", reason: "untrusted" }]);
    expect(dryReport.warnings).toEqual([
      "Refusing to delete notes.txt: the record does not describe a compiler artifact; ownership released.",
    ]);
    expect(await exists(foreign)).toBe(true);

    const result = runCli(["clean", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<CleanJson>(result.stdout, "clean foreign matching hash");
    expect(report.removed).toEqual([]);
    expect(report.skipped).toEqual([{ path: "notes.txt", reason: "untrusted" }]);
    expect(report.warnings).toEqual([
      "Refusing to delete notes.txt: the record does not describe a compiler artifact; ownership released.",
    ]);
    expect(await exists(foreign)).toBe(true);
    // The forged record is dropped from the manifest (ownership released).
    const after = parseJson<Manifest>(
      await readText(join(root, ".cssx-manifest.json")),
      "manifest after forged clean",
    );
    expect(after.files).toEqual([]);
  });

  test("a missing owned file is reported missing and dropped from the manifest", async () => {
    const root = await emptyProject();
    await writeManifest(root, [
      { kind: "css", path: "out/gone.css", source: "src/placeholder.cssx", hash: "sha256:a" },
      { kind: "js", path: "out/gone.map.js", source: "src/placeholder.cssx", hash: "sha256:b" },
      {
        kind: "types",
        path: "out/gone.map.d.ts",
        source: "src/placeholder.cssx",
        hash: "sha256:c",
      },
    ]);

    const result = runCli(["clean", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<CleanJson>(result.stdout, "clean missing files");
    expect(report.removed).toEqual([]);
    expect(report.skipped).toEqual([
      { path: "out/gone.css", reason: "missing" },
      { path: "out/gone.map.d.ts", reason: "missing" },
      { path: "out/gone.map.js", reason: "missing" },
    ]);
    expect(report.warnings).toEqual([]);

    const manifest = parseJson<Manifest>(
      await readText(join(root, ".cssx-manifest.json")),
      "manifest after missing clean",
    );
    expect(manifest.files).toEqual([]);
    expect(await exists(join(root, "out"))).toBe(false);
  });

  test("clean on an empty output directory succeeds without creating it", async () => {
    const root = await emptyProject();
    expect(await exists(join(root, "out"))).toBe(false);

    const result = runCli(["clean"], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("xessa clean: 0 files removed, 0 skipped\n");
    expect(result.stderr).toBe("");
    expect(await exists(join(root, "out"))).toBe(false);
  });
});
