/**
 * TT3 · Path stress: the path shapes users actually have on disk.
 *
 * Cases (`.ai/plans/CSSX-PLAN-TESTING.md` §TT3 "Paths", weakest-10 #4a):
 * spaces, NFC/NFD unicode pairs, emoji, 200-character segments, deep nesting,
 * and `..` escape attempts in `include`, `output.cssDir`, `@setup css-dir` and
 * `@use`.
 *
 * Every case drives the real CLI in a fresh `mkdtemp` project. Assertions pin
 * the observed behaviour of the lexical path model: the compiler and CLI never
 * normalize Unicode (`packages/compiler/src/output/paths.ts`), so paths are
 * compared exactly as the filesystem reports them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildReport,
  cleanupProjects,
  createProject,
  diagnosticCodes,
  diagnosticMessages,
  hasCode,
  listFiles,
  projectConfig,
  projectPathExists,
  readManifest,
  readProjectFile,
  simpleSource,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** One directory name with a 200-character segment. */
const LONG_SEGMENT = "z".repeat(200);

/** Thirty nested directory levels, each two characters wide plus an index. */
const DEEP_SEGMENT = Array.from({ length: 30 }, (_, index) => `d${index}`).join("/");

/** Composed (NFC) and decomposed (NFD) spellings of the same text. */
const NFC = "caf\u00e9";
const NFD = "cafe\u0301";

describe("path shapes", () => {
  test("builds sources under spaces, emoji, NFC, 200-char segments and deep nesting", async () => {
    const root = await createProject({
      "xessa.config.json": `${JSON.stringify(projectConfig({ cssDir: "out" }), null, 2)}\n`,
      "src/with space/a.cssx": simpleSource("space"),
      "src/a\u{1F3A8}b/b.cssx": simpleSource("emoji"),
      [`src/${NFC}/c.cssx`]: simpleSource("nfc"),
      [`src/${LONG_SEGMENT}/d.cssx`]: simpleSource("long"),
      [`src/${DEEP_SEGMENT}/e.cssx`]: simpleSource("deep"),
    });

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(diagnosticCodes(report)).toHaveLength(0);
    // Discovery sorts with a plain string comparison, so the emoji (a surrogate
    // pair inside the first segment) and the composed `café` keep code-unit order.
    expect(report.entries.map((entry) => entry.file)).toEqual([
      "src/a\u{1F3A8}b/b.cssx",
      `src/${NFC}/c.cssx`,
      `src/${DEEP_SEGMENT}/e.cssx`,
      "src/with space/a.cssx",
      `src/${LONG_SEGMENT}/d.cssx`,
    ]);

    const expected = [
      `out/src/${DEEP_SEGMENT}/e.css`,
      "out/src/a\u{1F3A8}b/b.css",
      "out/src/with space/a.css",
      `out/src/${LONG_SEGMENT}/d.css`,
      `out/src/${NFC}/c.css`,
    ];
    // `listFiles` is relative to its argument, so re-prefix to compare with the
    // workspace-relative artifact paths the manifest records.
    expect(listFiles(`${root}/out`).map((path) => `out/${path}`)).toEqual([...expected].sort());
    expect((await readManifest(root))?.files.map((record) => record.path)).toEqual(
      [...expected].sort(),
    );
    for (const path of expected) {
      expect(await readProjectFile(root, path)).toContain("color:red");
    }

    // A second build is byte-identical: exotic names do not destabilize output.
    const before = await snapshot(root, "out");
    const again = buildReport([], root);
    expect(again.success).toBe(true);
    expect(await snapshot(root, "out")).toEqual(before);
  }, 60_000);

  test("mirrors a decomposed (NFD) directory name exactly as the filesystem reports it", async () => {
    const root = await createProject({
      "xessa.config.json": `${JSON.stringify(projectConfig({ cssDir: "out" }), null, 2)}\n`,
      [`src/${NFD}/nfd.cssx`]: simpleSource("nfd"),
    });

    // Which byte form the volume actually stores is platform policy (APFS folds
    // composed/decomposed); what must hold is that the build mirrors whatever
    // `readdir` reported, byte for byte, into the artifact path and manifest.
    const stored = readdirSync(join(root, "src"));
    expect(stored).toHaveLength(1);
    const storedName = stored[0] ?? "";
    expect([NFC, NFD]).toContain(storedName);

    const report = buildReport([], root);
    expect(report.success).toBe(true);
    expect(report.entries.map((entry) => entry.file)).toEqual([`src/${storedName}/nfd.cssx`]);

    const manifest = await readManifest(root);
    expect(manifest?.files.map((record) => record.path)).toEqual([`out/src/${storedName}/nfd.css`]);
    expect(await projectPathExists(root, `out/src/${storedName}/nfd.css`)).toBe(true);
  }, 60_000);

  test("there is no NFC/NFD folding: an authored composed name is not the stored decomposed one", async () => {
    const root = await createProject({
      "xessa.config.json": `${JSON.stringify(
        projectConfig({ cssDir: "out", exclude: [`src/${NFC}`] }),
        null,
        2,
      )}\n`,
      [`src/${NFD}/nfd.cssx`]: simpleSource("nfd"),
      "src/kept.cssx": simpleSource("kept"),
    });

    const stored = readdirSync(join(root, "src")).sort();
    const storedDir = stored.find((name) => name !== "kept.cssx") ?? "";

    const report = buildReport([], root);
    expect(report.success).toBe(true);

    if (storedDir === NFC) {
      // A folding volume reports the composed form, so the authored exclude
      // matches and only `kept.cssx` builds.
      expect(report.entries.map((entry) => entry.file)).toEqual(["src/kept.cssx"]);
    } else {
      // A preserving volume stores the decomposed form; exclusion is lexical,
      // so the composed `exclude` misses it and the source still builds.
      expect(report.entries.map((entry) => entry.file)).toEqual([
        `src/${storedDir}/nfd.cssx`,
        "src/kept.cssx",
      ]);
    }
  }, 60_000);

  test("rejects an include glob that traverses out of the workspace with XESSA5001", async () => {
    const sandbox = await createProject({
      "ws/xessa.config.json": `${JSON.stringify(
        projectConfig({ include: ["src/**/*.cssx", "../outside/*.cssx"], cssDir: "out" }),
        null,
        2,
      )}\n`,
      "ws/src/inside.cssx": simpleSource("inside"),
      "outside/escaped.cssx": simpleSource("escaped"),
    });
    const root = `${sandbox}/ws`;

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);

    // Discovery walks the parent directory, so the escaping file is planned and
    // then rejected by the planner's workspace containment check.
    expect(report.entries.map((entry) => entry.file)).toEqual([
      "../outside/escaped.cssx",
      "src/inside.cssx",
    ]);
    const escaped = report.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("outside the workspace root"),
    );
    expect(escaped).toHaveLength(1);
    expect(escaped[0]?.code).toBe("XESSA5001");
    expect(escaped[0]?.file).toBe(`${sandbox}/outside/escaped.cssx`);

    // The in-workspace entry is unaffected, and nothing outside was written.
    expect(await projectPathExists(root, "out/src/inside.css")).toBe(true);
    expect(listFiles(`${sandbox}/outside`)).toEqual(["escaped.cssx"]);
  }, 60_000);

  test("rejects `..` and absolute output directories that leave the workspace", async () => {
    const sandbox = await createProject({
      "ws/src/a.cssx": simpleSource("escape"),
      "ws/xessa.config.json": `${JSON.stringify(projectConfig({ cssDir: "out" }), null, 2)}\n`,
    });
    const root = `${sandbox}/ws`;

    // Baseline: the same project builds cleanly with an in-workspace directory,
    // so every failure below is attributable to the escaping destination.
    const baseline = buildReport([], root);
    expect(baseline.success).toBe(true);
    expect(await projectPathExists(root, "out/src/a.css")).toBe(true);

    await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "../escaped-dist" }));
    const parentEscape = buildReport([], root);
    expect(parentEscape.success).toBe(false);
    expect(hasCode(parentEscape, "XESSA5001")).toBe(true);
    expect(diagnosticMessages(parentEscape).join("\n")).toContain("escapes the workspace root");
    // Nothing was created outside the workspace by any of the escape attempts.
    expect(listFiles(sandbox).filter((path) => !path.startsWith("ws/"))).toEqual([]);

    await writeProjectJson(
      root,
      "xessa.config.json",
      projectConfig({ cssDir: `${sandbox}/absolute-dist` }),
    );
    const absoluteEscape = buildReport([], root);
    expect(absoluteEscape.success).toBe(false);
    expect(hasCode(absoluteEscape, "XESSA5001")).toBe(true);
    expect(await projectPathExists(sandbox, "absolute-dist")).toBe(false);

    // A file-level `@setup` directory is exact and traverses the same guard.
    await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "out" }));
    await writeProjectFile(
      root,
      "src/a.cssx",
      ["@setup {", '  css-dir: "../../../escaped-file-level";', "}", simpleSource("escape")].join(
        "\n",
      ),
    );
    const setupEscape = buildReport([], root);
    expect(setupEscape.success).toBe(false);
    expect(hasCode(setupEscape, "XESSA5001")).toBe(true);
    expect(diagnosticMessages(setupEscape).join("\n")).toContain("escapes the workspace root");
  }, 60_000);

  test("rejects a `@use` that traverses out of the workspace with XESSA2001", async () => {
    const sandbox = await createProject({
      "ws/xessa.config.json": `${JSON.stringify(projectConfig({ cssDir: "out" }), null, 2)}\n`,
      "ws/src/a.cssx":
        '@use "../../outside/tokens.cssx" as theme;\n.a {\n  padding: $theme.gap;\n}\n',
      "outside/tokens.cssx": "@variables {\n  gap: 4px;\n}\n",
    });
    const root = `${sandbox}/ws`;

    const report = buildReport([], root);
    expect(report.success).toBe(false);
    const escapeDiagnostic = report.diagnostics.find((diagnostic) =>
      diagnostic.message.includes("resolves outside the workspace root"),
    );
    expect(escapeDiagnostic?.code).toBe("XESSA2001");
    expect(escapeDiagnostic?.message).toContain("outside/tokens.cssx");
    expect(await projectPathExists(root, "out/src/a.css")).toBe(false);
  }, 60_000);
});

/** Map of every file below `directory` (relative to the project root) to its bytes. */
async function snapshot(root: string, directory: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const path of listFiles(`${root}/${directory}`)) {
    snapshot[path] = (await readProjectFile(root, path)) ?? "";
  }
  return snapshot;
}
