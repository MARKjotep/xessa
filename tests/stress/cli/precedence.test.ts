/**
 * TT4 · Flag precedence and cross-command flag combinations.
 *
 * `tests/integration/cli-build.test.ts:150` already pins `--minify --no-minify`
 * one way. This suite extends it to the reverse order, repeated flags,
 * `--check` on every non-`format` command, `--dry-run` combined with `--json`,
 * and the `--json` + `watch` NDJSON question.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CliResult,
  cleanupProjects,
  createProject,
  exists,
  parseJson,
  readText,
  runCli,
  startWatchJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** `generated/styles/button.css` of the copied `basic` fixture. */
const BUTTON_CSS = "generated/styles/button.css";

interface BuildJson {
  command: string;
  success: boolean;
  exitCode: number;
  dryRun: boolean;
  entries: Array<{
    file: string;
    outputs: Array<{ kind: string; path: string; written: boolean; reason?: string }>;
  }>;
  warnings: string[];
  errors: string[];
}

interface CleanJson {
  command: string;
  success: boolean;
  dryRun: boolean;
  removed: Array<{ path: string; reason: string }>;
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
}

interface FormatJson {
  command: string;
  success: boolean;
  exitCode: number;
  check: boolean;
  dryRun: boolean;
  files: Array<{ file: string; changed: boolean; written: boolean; reason?: string }>;
  changed: string[];
  errors: string[];
}

async function buildCss(root: string, args: readonly string[]): Promise<string> {
  const result = runCli(["build", ...args], root);
  expect(result.status).toBe(0);
  const css = await readText(join(root, BUTTON_CSS));
  expect(css).not.toBeNull();
  return css ?? "";
}

describe("minify flag precedence", () => {
  test("the last minify flag wins in both orders", async () => {
    const root = await createProject("basic");

    const prettyLast = await buildCss(root, ["--minify", "--no-minify"]);
    const prettyOnly = await buildCss(root, ["--no-minify"]);
    expect(prettyLast).toBe(prettyOnly);
    expect(prettyLast).toContain("\n.ui-button {");

    const minifiedLast = await buildCss(root, ["--no-minify", "--minify"]);
    const minifiedOnly = await buildCss(root, ["--minify"]);
    expect(minifiedLast).toBe(minifiedOnly);
    expect(minifiedLast).not.toContain("\n.ui-button {");
    expect(minifiedLast).toContain(".ui-button{display:flex;padding:12px;}");

    // The two outcomes are genuinely different, so the assertions above cannot
    // both pass on a single flag being ignored.
    expect(minifiedOnly).not.toBe(prettyOnly);
  });

  test("repeating the same minify flag is idempotent", async () => {
    const root = await createProject("basic");
    const minified = await buildCss(root, ["--minify"]);
    expect(await buildCss(root, ["--minify", "--minify"])).toBe(minified);

    const pretty = await buildCss(root, ["--no-minify"]);
    expect(await buildCss(root, ["--no-minify", "--no-minify"])).toBe(pretty);
    expect(pretty).not.toBe(minified);
  });

  test("minify order also decides a --dry-run report", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--minify", "--no-minify", "--dry-run", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<BuildJson>(result.stdout, "dry-run minify order");
    expect(report.dryRun).toBe(true);
    for (const entry of report.entries) {
      for (const output of entry.outputs) {
        expect(output.written).toBe(false);
        expect(output.reason).toBe("dry-run");
      }
    }
    expect(await exists(join(root, "generated"))).toBe(false);
  });
});

describe("--check is format-only", () => {
  for (const command of ["build", "check", "watch", "clean"]) {
    test(`xessa ${command} --check exits 2`, async () => {
      const root = await createProject("basic");
      const result = runCli([command, "--check"], root);
      expect(result.status).toBe(2);
      expect(result.stderr).toBe("xessa: --check is only valid for xessa format.\n");
      expect(result.stdout).toBe("");
    });
  }

  test("format --check stays valid", async () => {
    const root = await createProject("basic");
    const result = runCli(["format", "--check"], root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("would be reformatted");
  });
});

describe("--dry-run combined with --json", () => {
  test("build --dry-run --json plans every artifact without touching disk", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--dry-run", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<BuildJson>(result.stdout, "build dry-run json");
    expect(report.command).toBe("build");
    expect(report.dryRun).toBe(true);
    const outputs = report.entries.flatMap((entry) => entry.outputs);
    expect(outputs).toHaveLength(6);
    expect(outputs.every((output) => output.written === false)).toBe(true);
    expect(outputs.every((output) => output.reason === "dry-run")).toBe(true);
    expect(await exists(join(root, "generated"))).toBe(false);
    expect(await exists(join(root, ".cssx-manifest.json"))).toBe(false);
  });

  test("clean --dry-run --json reports would-delete and keeps files and manifest", async () => {
    const root = await createProject("basic");
    expect(runCli(["build"], root).status).toBe(0);
    const manifestBefore = await readText(join(root, ".cssx-manifest.json"));

    const result = runCli(["clean", "--dry-run", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<CleanJson>(result.stdout, "clean dry-run json");
    expect(report.command).toBe("clean");
    expect(report.dryRun).toBe(true);
    expect(report.removed).toHaveLength(6);
    expect(report.removed.every((item) => item.reason === "would-delete")).toBe(true);
    expect(report.skipped).toEqual([]);
    expect(await exists(join(root, BUTTON_CSS))).toBe(true);
    expect(await readText(join(root, ".cssx-manifest.json"))).toBe(manifestBefore);
  });

  test("format --dry-run writes nothing and reports not-written", async () => {
    const root = await createProject("basic");
    const result = runCli(["format", "--dry-run", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<FormatJson>(result.stdout, "format dry-run json");
    expect(report.dryRun).toBe(true);
    expect(report.check).toBe(false);
    expect(report.changed).toEqual(["src/button.cssx", "src/card.cssx"]);
    expect(report.files.every((file) => file.written === false)).toBe(true);
    expect(report.files.every((file) => file.reason === "not-written")).toBe(true);
  });

  test("check rejects --dry-run as a conflicting flag (CSSX-T12)", async () => {
    // `check` never writes, so `--dry-run` cannot change its behaviour. Silently
    // accepting it made the JSON report contradict the invocation; the args layer
    // now rejects the combination before the workspace is touched.
    const root = await createProject("basic");
    const text = runCli(["check", "--dry-run"], root);
    expect(text.status).toBe(2);
    expect(text.stderr).toBe("xessa: --dry-run is not valid for xessa check.\n");
    expect(text.stdout).toBe("");

    const json = runCli(["check", "--dry-run", "--json"], root);
    expect(json.status).toBe(2);
    expect(json.stderr).toBe("");
    const report = parseJson<{
      command: string;
      success: boolean;
      exitCode: number;
      error: string;
    }>(json.stdout, "check dry-run json");
    expect(report).toEqual({
      command: "check",
      success: false,
      exitCode: 2,
      error: "--dry-run is not valid for xessa check.",
    });
    expect(await exists(join(root, "generated"))).toBe(false);
  });

  test("check without --dry-run is unchanged", async () => {
    const root = await createProject("basic");
    const result = runCli(["check", "--json"], root);
    expect(result.status).toBe(0);
    const report = parseJson<BuildJson>(result.stdout, "check json");
    expect(report.command).toBe("check");
    expect(report.dryRun).toBe(false);
    const outputs = report.entries.flatMap((entry) => entry.outputs);
    expect(outputs.every((output) => output.reason === "check")).toBe(true);
  });
});

describe("--json with watch", () => {
  test("watch emits compact NDJSON while build emits indented JSON", async () => {
    const root = await createProject("basic");

    const build = runCli(["build", "--json"], root);
    expect(build.status).toBe(0);
    expect(build.stdout).toContain('\n  "command": "build",');
    expect(build.stdout.trimEnd().split("\n").length).toBeGreaterThan(5);

    // `watch --json` switches the envelope, not the channel: one compact JSON
    // object per line (asserted in full by the watch NDJSON golden).
    const harness = startWatchJson(root);
    let exitCode = -1;
    try {
      const buildEvent = await harness.nextEvent("build", "watch initial build");
      expect(buildEvent.raw).not.toContain("\n");
      expect(buildEvent.raw.startsWith('{"type":"build"')).toBe(true);
      const ready = await harness.nextEvent("watch", "watch ready");
      expect(ready.value.ready).toBe(true);
      for (const line of harness.lines) {
        expect(() => JSON.parse(line)).not.toThrow();
        expect(line.trim()).toBe(line);
      }
    } finally {
      exitCode = await harness.stop();
    }
    expect(exitCode).toBe(0);
  }, 30_000);
});

describe("success exit codes stay 0 with the optional flags", () => {
  test("check, format and clean succeed on the frozen fixture", async () => {
    const root = await createProject("basic");
    const check: CliResult = runCli(["check"], root);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("0 errors");

    const format = runCli(["format"], root);
    expect(format.status).toBe(0);

    const clean = runCli(["clean"], root);
    expect(clean.status).toBe(0);
  });
});
