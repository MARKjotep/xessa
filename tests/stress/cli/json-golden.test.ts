/**
 * TT4 · `--json` / NDJSON golden snapshots.
 *
 * Every machine-readable envelope the CLI can emit is pinned byte-for-byte:
 * `build`, `check`, `clean`, `clean --dry-run`, `format --check`, a `check`
 * failure with diagnostics, an invocation error after `--json`, and the
 * `watch --json` NDJSON stream (`build` event then the `watch` ready event).
 *
 * Byte stability:
 * - the temp project root is replaced with the documented `<ROOT>` placeholder
 *   (`helpers.normalizeOutput`), and each case asserts no absolute temp path
 *   survived;
 * - every case is executed twice on two freshly copied projects and both
 *   snapshots must be identical, so a nondeterministic field fails here rather
 *   than in a later `bun test` run.
 *
 * Regenerating the goldens (intentional, review the diff afterwards):
 * `XESSA_STRESS_UPDATE_GOLDEN=1 bun test tests/stress/cli/`
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CliResult,
  cleanupProjects,
  createProject,
  normalizeOutput,
  readGolden,
  readText,
  runCli,
  startWatchJson,
  tempRootPrefixes,
  writeGolden,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

const UPDATE_GOLDENS = process.env.XESSA_STRESS_UPDATE_GOLDEN === "1";

/** Assert `actual` matches the committed golden (or rewrite it in update mode). */
async function expectGolden(name: string, actual: string): Promise<void> {
  if (UPDATE_GOLDENS) {
    await writeGolden(name, actual);
    return;
  }
  const expected = await readGolden(name);
  expect(actual).toBe(expected);
}

/** Prove no machine-specific absolute temp path leaked into a snapshot. */
function expectNoTempLeak(normalized: string, label: string): void {
  for (const prefix of tempRootPrefixes()) {
    expect(`${label}: ${normalized.includes(prefix) ? `leaked ${prefix}` : "clean"}`).toBe(
      `${label}: clean`,
    );
  }
}

interface GoldenCase {
  /** Golden file name under `tests/stress/cli/golden/`. */
  readonly name: string;
  readonly args: readonly string[];
  /** Fixture to copy; defaults to `basic`. */
  readonly fixture?: string;
  /** Exit code the invocation must produce. */
  readonly exitCode: number;
  /** Optional project mutation before the invocation. */
  readonly prepare?: (root: string) => Promise<void>;
}

async function snapshot(item: GoldenCase): Promise<string> {
  const root = await createProject(item.fixture ?? "basic");
  if (item.prepare !== undefined) await item.prepare(root);
  const result: CliResult = runCli(item.args, root);
  expect(result.status).toBe(item.exitCode);
  const normalized = normalizeOutput(result.stdout, root);
  expectNoTempLeak(normalized, item.name);
  return normalized;
}

/** Build first, then hand-edit one artifact so `clean` has a modified file. */
async function buildThenModify(root: string): Promise<void> {
  expect(runCli(["build"], root).status).toBe(0);
  const path = join(root, "generated/styles/card.css");
  const original = (await readText(path)) ?? "";
  await writeFile(path, `${original}/* hand edit */\n`, "utf8");
}

const JSON_CASES: readonly GoldenCase[] = [
  { name: "build-json.txt", args: ["build", "--json"], exitCode: 0 },
  { name: "build-dry-run-json.txt", args: ["build", "--dry-run", "--json"], exitCode: 0 },
  { name: "check-json.txt", args: ["check", "--json"], exitCode: 0 },
  { name: "check-error-json.txt", args: ["check", "--json"], fixture: "broken", exitCode: 1 },
  { name: "format-check-json.txt", args: ["format", "--check", "--json"], exitCode: 1 },
  {
    name: "clean-json.txt",
    args: ["clean", "--json"],
    exitCode: 0,
    prepare: buildThenModify,
  },
  {
    name: "clean-dry-run-json.txt",
    args: ["clean", "--dry-run", "--json"],
    exitCode: 0,
    prepare: async (root) => {
      expect(runCli(["build"], root).status).toBe(0);
    },
  },
  { name: "invocation-error-json.txt", args: ["build", "--json", "--wat"], exitCode: 2 },
];

describe("JSON report goldens", () => {
  for (const item of JSON_CASES) {
    test(`${item.name} is byte-stable and matches the golden`, async () => {
      const first = await snapshot(item);
      const second = await snapshot(item);
      expect(first).toBe(second);
      await expectGolden(item.name, first);
    }, 60_000);
  }

  test("every JSON golden parses as one document with stable key order", async () => {
    for (const item of JSON_CASES) {
      if (UPDATE_GOLDENS) continue;
      const text = await readGolden(item.name);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(Array.isArray(parsed)).toBe(false);
      // Top-level key order is the stable contract; the golden pins the rest.
      const keys = Object.keys(parsed);
      expect(keys[0]).toBe("command");
      expect(keys).toContain("success");
      expect(keys).toContain("exitCode");
      expect(text.endsWith("}\n")).toBe(true);
    }
  });
});

describe("watch NDJSON golden", () => {
  test("watch-ndjson.txt pins the build and ready events", async () => {
    const root = await createProject("basic");
    const harness = startWatchJson(root);
    let payload = "";
    let second = "";
    try {
      const build = await harness.nextEvent("build", "initial build event");
      const ready = await harness.nextEvent("watch", "ready event");
      payload = `${normalizeOutput(build.raw, root)}\n${normalizeOutput(ready.raw, root)}\n`;
      expectNoTempLeak(payload, "watch-ndjson.txt");
    } finally {
      expect(await harness.stop()).toBe(0);
    }

    // A second, freshly copied project must produce the identical stream.
    const again = await createProject("basic");
    const secondHarness = startWatchJson(again);
    try {
      const build = await secondHarness.nextEvent("build", "second initial build event");
      const ready = await secondHarness.nextEvent("watch", "second ready event");
      second = `${normalizeOutput(build.raw, again)}\n${normalizeOutput(ready.raw, again)}\n`;
    } finally {
      expect(await secondHarness.stop()).toBe(0);
    }

    expect(payload).toBe(second);
    await expectGolden("watch-ndjson.txt", payload);

    if (!UPDATE_GOLDENS) {
      const lines = payload.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      const build = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      const ready = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(build.type).toBe("build");
      expect(build.command).toBe("build");
      expect(ready).toEqual({ type: "watch", ready: true, sources: 3, debounceMs: 40 });
    }
  }, 60_000);
});

describe("diagnostic shape", () => {
  test("a check failure carries the same positioned diagnostic fields as the golden", async () => {
    const root = await createProject("broken");
    const result = runCli(["check", "--json"], root);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      diagnostics: Array<Record<string, unknown>>;
      entries: Array<{ file: string; diagnostics: unknown[] }>;
    };
    expect(report.diagnostics).toHaveLength(1);
    const diagnostic = report.diagnostics[0] ?? {};
    // Exact key set and order: the shape machine consumers may rely on.
    expect(Object.keys(diagnostic)).toEqual([
      "code",
      "severity",
      "message",
      "file",
      "line",
      "column",
    ]);
    expect(diagnostic.code).toBe("XESSA2001");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.file).toBe("src/broken.cssx");
    expect(diagnostic.line).toBe(2);
    expect(diagnostic.column).toBe(10);
    expect(report.entries[0]?.diagnostics).toEqual(report.diagnostics);
  });
});
