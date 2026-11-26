/**
 * TT3 · Symlink matrix (`.ai/plans/CSSX-TT3` "Links", weakest-10 #3c).
 *
 * The plan's row: "symlinked source dir, symlinked import target, cyclic
 * symlink (must yield a diagnostic, not a hang)". Resolution order inside
 * `resolveImport` is lexical escape → canonicalize (host symlink policy) →
 * canonical escape → existence, and `createNodeHost.canonicalize` falls back to
 * the lexical path when `realpathSync` fails, so a symlink cycle surfaces as a
 * typed XESSA2001 instead of an exception or an endless walk.
 *
 * The existing suite already covers a symlink *escape* at resolver and planner
 * level (`resolver.test.ts:594`, `output.test.ts:280`); these cases cover the
 * in-workspace target, the non-entry symlink shapes and the cycle, which are
 * not covered anywhere.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  buildReport,
  cleanupProjects,
  createProject,
  diagnosticMessages,
  hasCode,
  projectConfig,
  projectPathExists,
  readProjectFile,
  runCli,
  simpleSource,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

describe("symlinks", () => {
  test("skips a symlinked source directory during discovery but builds the real one", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/real.cssx": simpleSource("real"),
      "elsewhere/linked.cssx": simpleSource("linked"),
    });
    await writeConfig(root);
    await symlink("../elsewhere", join(root, "src/linked"), "dir");

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    // `discoverSources` skips symbolic links (docs/configuration.md:135), so the
    // source behind the link is invisible with no warning at all.
    expect(report.entries.map((entry) => entry.file)).toEqual(["src/real.cssx"]);
    expect(report.warnings).toEqual([]);
    expect(await projectPathExists(root, "out/src/real.css")).toBe(true);
    expect(await projectPathExists(root, "out/src/linked/linked.css")).toBe(false);
  }, 60_000);

  test("resolves a symlinked import target that stays inside the workspace", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/shared/tokens.cssx": "@variables {\n  gap: 4px;\n}\n",
      "src/a.cssx": '@use "./tokens.cssx" as theme;\n.a {\n  padding: $theme.gap;\n}\n',
    });
    await writeConfig(root);
    await symlink("shared/tokens.cssx", join(root, "src/tokens.cssx"), "file");

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.entries[0]?.dependencies).toHaveLength(1);

    const css = await readProjectFile(root, "out/src/a.css");
    expect(css).toContain("padding:4px");
  }, 60_000);

  test("rejects a symlinked import target that resolves outside the workspace", async () => {
    const sandbox = await createProject({
      "ws/xessa.config.json": "",
      "outside/ext.cssx": "@variables {\n  gap: 9px;\n}\n",
      "ws/src/b.cssx": '@use "./ext.cssx" as theme;\n.b {\n  padding: $theme.gap;\n}\n',
    });
    const root = `${sandbox}/ws`;
    await writeConfig(root);
    await symlink("../../outside/ext.cssx", join(root, "src/ext.cssx"), "file");

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    const escapeDiagnostic = report.diagnostics.find((diagnostic) =>
      diagnostic.message.includes("escapes the workspace root through"),
    );
    expect(escapeDiagnostic?.code).toBe("XESSA2001");
    expect(escapeDiagnostic?.message).toContain("ext.cssx");
    expect(await projectPathExists(root, "out/src/b.css")).toBe(false);
  }, 60_000);

  test("turns a self-referential and a two-link symlink cycle into typed diagnostics", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/c.cssx": '@use "./loop.cssx";\n@use "./ping.cssx";\n.c {\n  color: red;\n}\n',
      "src/ok.cssx": simpleSource("ok"),
    });
    await writeConfig(root);
    // loop -> itself; ping <-> pong form a two-link cycle.
    await symlink("loop.cssx", join(root, "src/loop.cssx"), "file");
    await symlink("pong.cssx", join(root, "src/ping.cssx"), "file");
    await symlink("ping.cssx", join(root, "src/pong.cssx"), "file");

    const started = Date.now();
    const report = buildReport([], root);
    const elapsed = Date.now() - started;

    expect(report.success).toBe(false);
    const unresolved = report.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("cannot be resolved"),
    );
    expect(unresolved).toHaveLength(2);
    for (const diagnostic of unresolved) {
      expect(diagnostic.code).toBe("XESSA2001");
      expect(diagnostic.message).toContain("does not exist");
    }
    // ELOOP is swallowed by the host's canonicalize fallback and by the
    // existence check, so the affected entry is skipped and the healthy entry
    // still builds.
    expect(await projectPathExists(root, "out/src/ok.css")).toBe(true);
    expect(await projectPathExists(root, "out/src/c.css")).toBe(false);
    // Anti-hang bound: a stack overflow or a resolver loop would blow past it.
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);

  test("reports a dangling symlink import as unresolved, not as a crash", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/d.cssx": '@use "./dangling.cssx";\n.d {\n  color: red;\n}\n',
    });
    await writeConfig(root);
    await symlink("missing-target.cssx", join(root, "src/dangling.cssx"), "file");

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(diagnosticMessages(report).join("\n")).toContain(
      'Import "./dangling.cssx" cannot be resolved',
    );
    expect(hasCode(report, "XESSA2001")).toBe(true);
  }, 60_000);

  test("rejects a cyclic symlink passed as the explicit file argument (exit 2)", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/ok.cssx": simpleSource("ok"),
    });
    await writeConfig(root);
    await symlink("loop.cssx", join(root, "src/loop.cssx"), "file");

    const result = runCli(["build", "src/loop.cssx", "--json"], root);
    expect(result.status).toBe(2);
    // With `--json` the invocation failure is a machine-readable object on
    // stdout (report.ts:223), never a stack trace from the ELOOP stat.
    expect(JSON.parse(result.stdout)).toEqual({
      command: "build",
      success: false,
      exitCode: 2,
      error: "Source file not found: src/loop.cssx",
    });
  }, 60_000);
});

/** Write the suite's standard config into a project. */
async function writeConfig(root: string): Promise<void> {
  await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "out" }));
}
