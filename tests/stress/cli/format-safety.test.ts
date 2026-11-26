/**
 * TT4 · `format` write safety.
 *
 * The contract under test: `format --check` on a parse-error file exits 1 and
 * leaves the bytes untouched; `format` normalizes pre-existing CRLF line
 * endings; `format` on an already-canonical file performs no write at all.
 *
 * "No write" is proven without timing: the case freezes the file's mtime with
 * `utimes`, runs the CLI, and asserts the frozen mtime survived. A rewrite via
 * `atomicWrite` (rename) always replaces the inode and therefore the mtime.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupProjects,
  createProject,
  exists,
  freezeMtime,
  mtimeMs,
  parseJson,
  readText,
  runCli,
  writeText,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

const FROZEN_MTIME_MS = 1_700_000_000_000;

/** CRLF-authored source and the canonical LF text it normalizes to. */
const CRLF = ".a {\r\n  color: red;\r\n}\r\n";
const LF = ".a {\n  color: red;\n}\n";

interface FormatJson {
  command: string;
  success: boolean;
  exitCode: number;
  check: boolean;
  dryRun: boolean;
  files: Array<{ file: string; changed: boolean; written: boolean; reason?: string }>;
  changed: string[];
  diagnostics: Array<{ code: string; severity: string; file: string; line: number }>;
  errors: string[];
}

/** Empty project with an include glob that matches `src/**`. */
async function emptyProject(): Promise<string> {
  const root = await createProject("");
  await writeText(
    join(root, "xessa.config.json"),
    `${JSON.stringify({ include: ["src/**/*.cssx"] })}\n`,
  );
  return root;
}

describe("format --check on a parse-error file", () => {
  test("exits 1, reports the parse error, and leaves the file bytes untouched", async () => {
    const root = await emptyProject();
    const source = ".broken {\n  color: red;\n";
    const path = join(root, "src/broken.cssx");
    await writeText(path, source);
    await freezeMtime(path, FROZEN_MTIME_MS);

    const result = runCli(["format", "--check", "--json"], root);
    expect(result.status).toBe(1);

    const report = parseJson<FormatJson>(result.stdout, "format --check parse-error");
    expect(report.command).toBe("format");
    expect(report.success).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.check).toBe(true);
    expect(report.changed).toEqual([]);
    expect(report.files).toEqual([
      { file: "src/broken.cssx", changed: false, written: false, reason: "parse-error" },
    ]);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1001"]);
    expect(report.diagnostics[0]?.severity).toBe("error");
    expect(report.errors).toEqual([
      "src/broken.cssx: not formatted because parsing reported errors.",
    ]);

    expect(await readText(path)).toBe(source);
    expect(Math.round(await mtimeMs(path))).toBe(FROZEN_MTIME_MS);
  });

  test("a --check run in a mixed project never rewrites the broken file", async () => {
    const root = await emptyProject();
    const broken = ".broken {\n  color: red;\n";
    const brokenPath = join(root, "src/broken.cssx");
    const okayPath = join(root, "src/okay.cssx");
    await writeText(brokenPath, broken);
    await writeText(okayPath, ".okay{color:blue}\n");
    await freezeMtime(brokenPath, FROZEN_MTIME_MS);
    await freezeMtime(okayPath, FROZEN_MTIME_MS);

    const result = runCli(["format", "--check", "--json"], root);
    expect(result.status).toBe(1);
    const report = parseJson<FormatJson>(result.stdout, "format --check mixed");
    const byFile = new Map(report.files.map((file) => [file.file, file]));
    expect(byFile.get("src/broken.cssx")?.reason).toBe("parse-error");
    expect(byFile.get("src/okay.cssx")?.changed).toBe(true);
    expect(byFile.get("src/okay.cssx")?.written).toBe(false);
    expect(report.changed).toEqual(["src/okay.cssx"]);

    expect(await readText(brokenPath)).toBe(broken);
    expect(Math.round(await mtimeMs(brokenPath))).toBe(FROZEN_MTIME_MS);
    expect(Math.round(await mtimeMs(okayPath))).toBe(FROZEN_MTIME_MS);
  });
});

describe("format on pre-existing CRLF", () => {
  test("normalizes CRLF to LF and then reports the file as canonical", async () => {
    const root = await emptyProject();
    const path = join(root, "src/crlf.cssx");
    await writeText(path, CRLF);

    const first = runCli(["format", "--json"], root);
    expect(first.status).toBe(0);
    const firstReport = parseJson<FormatJson>(first.stdout, "format crlf");
    expect(firstReport.changed).toEqual(["src/crlf.cssx"]);
    expect(firstReport.files).toEqual([{ file: "src/crlf.cssx", changed: true, written: true }]);

    // Actual behavior: CRLF is normalized, not preserved.
    expect(await readText(path)).toBe(LF);

    // Idempotent: a second run writes nothing (frozen mtime proves it).
    await freezeMtime(path, FROZEN_MTIME_MS);
    const second = runCli(["format", "--json"], root);
    expect(second.status).toBe(0);
    const secondReport = parseJson<FormatJson>(second.stdout, "format crlf idempotent");
    expect(secondReport.files).toEqual([{ file: "src/crlf.cssx", changed: false, written: false }]);
    expect(await readText(path)).toBe(LF);
    expect(Math.round(await mtimeMs(path))).toBe(FROZEN_MTIME_MS);
  });

  test("--check flags the CRLF file without rewriting it", async () => {
    const root = await emptyProject();
    const path = join(root, "src/crlf.cssx");
    await writeText(path, CRLF);
    await freezeMtime(path, FROZEN_MTIME_MS);

    const result = runCli(["format", "--check", "--json"], root);
    expect(result.status).toBe(1);
    const report = parseJson<FormatJson>(result.stdout, "format --check crlf");
    expect(report.changed).toEqual(["src/crlf.cssx"]);
    expect(report.files[0]?.written).toBe(false);
    expect(report.files[0]?.reason).toBe("not-written");

    expect(await readText(path)).toBe(CRLF);
    expect(Math.round(await mtimeMs(path))).toBe(FROZEN_MTIME_MS);
  });

  test("--dry-run leaves the CRLF bytes in place too", async () => {
    const root = await emptyProject();
    const path = join(root, "src/crlf.cssx");
    await writeText(path, CRLF);
    await freezeMtime(path, FROZEN_MTIME_MS);

    const result = runCli(["format", "--dry-run"], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 file(s) would be reformatted.");
    expect(await readText(path)).toBe(CRLF);
    expect(Math.round(await mtimeMs(path))).toBe(FROZEN_MTIME_MS);
  });
});

describe("format on an already-canonical file", () => {
  test("performs no write at all", async () => {
    const root = await emptyProject();
    const path = join(root, "src/canonical.cssx");
    await writeText(path, CRLF);

    // Canonicalize once, then freeze and prove the next run is read-only.
    expect(runCli(["format"], root).status).toBe(0);
    const canonical = await readText(path);
    expect(canonical).toBe(LF);
    await freezeMtime(path, FROZEN_MTIME_MS);

    const result = runCli(["format", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<FormatJson>(result.stdout, "format canonical");
    expect(report.changed).toEqual([]);
    expect(report.files).toEqual([{ file: "src/canonical.cssx", changed: false, written: false }]);
    expect(report.diagnostics).toEqual([]);

    expect(await readText(path)).toBe(canonical ?? "");
    expect(Math.round(await mtimeMs(path))).toBe(FROZEN_MTIME_MS);
  });

  test("format --check on canonical sources writes nothing and exits 0", async () => {
    const root = await createProject("basic");
    expect(runCli(["format"], root).status).toBe(0);
    const before = await readText(join(root, "src/button.cssx"));
    await freezeMtime(join(root, "src/button.cssx"), FROZEN_MTIME_MS);

    const result = runCli(["format", "--check", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<FormatJson>(result.stdout, "format --check canonical");
    expect(report.changed).toEqual([]);
    expect(report.files.every((file) => file.written === false)).toBe(true);

    expect(await readText(join(root, "src/button.cssx"))).toBe(before ?? "");
    expect(Math.round(await mtimeMs(join(root, "src/button.cssx")))).toBe(FROZEN_MTIME_MS);
    expect(await exists(join(root, "generated"))).toBe(false);
  });
});
