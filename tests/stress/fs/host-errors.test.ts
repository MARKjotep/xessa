/**
 * TT3 · Real-filesystem error paths on `packages/compiler/src/host/node.ts`
 * (weakest-10 #3).
 *
 * Every compiler suite injects an in-memory fake host
 * (`groups.expansion.test.ts:31`, `modules.test.ts:29`), so `EACCES`,
 * `ENOENT`-mid-walk, `ELOOP` and "a directory where a file is expected" have
 * never reached the real Node/Bun host. These cases drive `createNodeHost`
 * directly and through the public `compileProject`, plus one end-to-end CLI run
 * for the `XESSACLI002` source-read path.
 *
 * Documented policy under test: `readFile` propagates the raw `fs` error and
 * the module graph converts it into a typed XESSA2001; `fileExists` and
 * `canonicalize` swallow errors (`host/node.ts:60-76,79-85`).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { compileProject, createNodeHost } from "../../../packages/compiler/src/index.ts";
import type { ModuleHost } from "../../../packages/compiler/src/types/options.ts";
import {
  buildReport,
  cleanupProjects,
  createProject,
  hasCode,
  listFiles,
  projectConfig,
  projectPathExists,
  runCli,
  simpleSource,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Root can read anything, so chmod-based permission cases cannot fail as designed. */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/** Capture the `code` of a rejected promise, or `null` when it resolved. */
async function rejectionCode(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "unclassified";
  }
}

describe("node host", () => {
  test("propagates ENOENT and EISDIR from readFile and answers fileExists false", async () => {
    const root = await createProject({
      "src/a.cssx": simpleSource("a"),
    });
    await mkdir(join(root, "src/dir.cssx"), { recursive: true });
    const host = createNodeHost(root);

    expect(await rejectionCode(host.readFile(join(root, "src/missing.cssx")))).toBe("ENOENT");
    expect(await rejectionCode(host.readFile(join(root, "src/dir.cssx")))).toBe("EISDIR");

    // A directory is not a file, so the graph sees "does not exist" instead of
    // attempting a read that would throw EISDIR.
    expect(await host.fileExists(join(root, "src/dir.cssx"))).toBe(false);
    expect(await host.fileExists(join(root, "src/missing.cssx"))).toBe(false);
    expect(await host.fileExists(join(root, "src/a.cssx"))).toBe(true);
  }, 60_000);

  test.skipIf(isRoot)(
    "propagates EACCES from readFile on an unreadable file",
    async () => {
      const root = await createProject({
        "src/locked.cssx": simpleSource("locked"),
      });
      const path = join(root, "src/locked.cssx");
      await chmod(path, 0o000);
      try {
        const host = createNodeHost(root);
        expect(await rejectionCode(host.readFile(path))).toBe("EACCES");
        // `stat` still succeeds, so the file *exists* but cannot be read: exactly
        // the "present but unreadable" case the graph must report as XESSA2001.
        expect(await host.fileExists(path)).toBe(true);
      } finally {
        await chmod(path, 0o644);
      }
    },
    60_000,
  );

  test("canonicalizes the workspace root and falls back to lexical on broken paths", async () => {
    const root = await createProject({
      "src/real.cssx": simpleSource("real"),
    });
    const { symlink } = await import("node:fs/promises");
    await symlink("real.cssx", join(root, "src/link.cssx"), "file");
    await symlink("cycle.cssx", join(root, "src/cycle.cssx"), "file");
    const host = createNodeHost(root);

    // The workspace root is already canonical, so it round-trips unchanged.
    expect(host.workspaceRoot()).toBe(root);
    expect(host.canonicalize(join(root, "src/link.cssx"))).toBe(join(root, "src/real.cssx"));
    // ELOOP and ENOENT both fall back to the lexical path instead of throwing.
    expect(host.canonicalize(join(root, "src/cycle.cssx"))).toBe(join(root, "src/cycle.cssx"));
    expect(host.canonicalize(join(root, "src/absent.cssx"))).toBe(join(root, "src/absent.cssx"));
    // A cyclic symlink is not a file: the existence probe swallows the ELOOP.
    expect(await host.fileExists(join(root, "src/cycle.cssx"))).toBe(false);
  }, 60_000);

  test("reports a missing entry and a directory import as XESSA2001, never a throw", async () => {
    const root = await createProject({
      "src/entry.cssx": `@use "./folder" as f;\n.entry {\n  color: red;\n}\n`,
      "src/folder/notes.txt": "not a module\n",
    });
    const host = createNodeHost(root);

    const results = await compileProject(["src/missing.cssx"], host, { projectRoot: root });
    const missing = results["src/missing.cssx"]?.diagnostics ?? [];
    expect(missing).toHaveLength(1);
    expect(missing[0]?.code).toBe("XESSA2001");
    expect(missing[0]?.message).toContain("file not found");

    const directory = await compileProject(["src/entry.cssx"], host, { projectRoot: root });
    const unresolved = directory["src/entry.cssx"]?.diagnostics ?? [];
    const importDiagnostic = unresolved.find((diagnostic) =>
      diagnostic.message.includes("cannot be resolved"),
    );
    expect(importDiagnostic?.code).toBe("XESSA2001");
    expect(importDiagnostic?.message).toContain("does not exist");
  }, 60_000);

  test("surfaces an ENOENT that appears mid-walk as XESSA2001 `Cannot read module`", async () => {
    const root = await createProject({
      "src/entry.cssx": '@use "./dep.cssx" as d;\n.entry {\n  padding: $d.gap;\n}\n',
      "src/dep.cssx": "@variables {\n  gap: 4px;\n}\n",
    });
    const base = createNodeHost(root);
    const dependency = join(root, "src/dep.cssx");

    // The dependency passes both existence checks (import resolution and the
    // load scan) and is deleted between the last check and the real read, so
    // the real host's readFile raises ENOENT during the walk.
    const racy: ModuleHost = {
      readFile: async (path) => {
        if (path === dependency) await rm(dependency, { force: true });
        return base.readFile(path);
      },
      fileExists: (path) => base.fileExists(path),
      canonicalize: (path) => base.canonicalize(path),
      resolvePath: (from, to) => base.resolvePath(from, to),
      workspaceRoot: () => base.workspaceRoot(),
    };

    const results = await compileProject(["src/entry.cssx", "src/dep.cssx"], racy, {
      projectRoot: root,
    });
    const diagnostics = results["src/dep.cssx"]?.diagnostics ?? [];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("XESSA2001");
    expect(diagnostics[0]?.message).toBe(`Cannot read module "${dependency}".`);
    expect(await stat(join(root, "src/entry.cssx"))).toBeDefined();
  }, 60_000);

  test.skipIf(isRoot)(
    "reports an unreadable source as XESSACLI002 and still builds its siblings",
    async () => {
      const root = await createProject({
        "xessa.config.json": "",
        "src/ok.cssx": simpleSource("ok"),
        "src/locked.cssx": simpleSource("locked"),
      });
      await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "out" }));
      const locked = join(root, "src/locked.cssx");
      await chmod(locked, 0o000);
      try {
        const report = buildReport([], root);
        expect(report.success).toBe(false);
        expect(report.exitCode).toBe(1);
        // Two layers see the same EACCES: the compiler host and the CLI's own
        // source read (build.ts:119).
        expect(hasCode(report, "XESSA2001")).toBe(true);
        expect(hasCode(report, "XESSACLI002")).toBe(true);
        expect(await projectPathExists(root, "out/src/ok.css")).toBe(true);
        expect(await projectPathExists(root, "out/src/locked.css")).toBe(false);
      } finally {
        await chmod(locked, 0o644);
      }
    },
    60_000,
  );

  test("ignores a directory whose name ends in `.cssx` during discovery", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/ok.cssx": simpleSource("ok"),
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "out" }));
    await mkdir(join(root, "src/dir.cssx"), { recursive: true });

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.entries.map((entry) => entry.file)).toEqual(["src/ok.cssx"]);

    // The suite never treats it as a source, and a direct CLI single-entry run
    // reports it as missing (exit 2) rather than trying to read a directory.
    const single = runCli(["build", "src/dir.cssx"], root);
    expect(single.status).toBe(2);
    expect(single.stderr).toContain("Source file not found: src/dir.cssx");
    expect(listFiles(`${root}/out`)).toEqual(["src/ok.css"]);
  }, 60_000);
});
