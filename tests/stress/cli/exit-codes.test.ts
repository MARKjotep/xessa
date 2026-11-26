/**
 * TT4 · Exit-code matrix — the cells the integration suite does not already own.
 *
 * The existing suites already pin: unknown flag, missing command, unknown
 * command, `clean` with a file argument, missing source, missing explicit
 * config, invalid JSON config, wrong-typed config key, strict unknown key, no
 * config at all, `--check` on `build`, and the `--json` shape of a *config*
 * failure (`tests/integration/cli-config.test.ts:35-190`). Those rows are not
 * repeated here; see `.ai/reports/CSSX-TT4.md` for the full matrix including
 * them.
 *
 * Every case asserts the CLI's actual behavior (0 = success, 1 = build/check/
 * format failure, 2 = invocation or configuration error) and the stream that
 * carries the report.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupProjects, createProject, parseJson, runCli, writeText } from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Machine-readable invocation failure shape (`invocationFailure` in report.ts). */
interface InvocationErrorReport {
  command: string;
  success: boolean;
  exitCode: number;
  error: string;
}

describe("exit 2 · invocation and configuration errors (remaining cells)", () => {
  test("a value flag at the end of argv reports a missing path", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--config"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: --config requires a path.\n");
    expect(result.stdout).toBe("");
  });

  test("a value flag followed by another flag reports a missing path", async () => {
    // CSSX-T11: `--json` is an option, not a config path. The usage error is the
    // honest diagnosis, and it is emitted before `--json` is parsed here, so it
    // stays on stderr (text only).
    const root = await createProject("basic");
    const result = runCli(["build", "--config", "--json"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: --config requires a path.\n");
    expect(result.stdout).toBe("");
  });

  test("a --json before the failing value flag makes the usage error JSON", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--json", "--config"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    const report = parseJson<InvocationErrorReport>(result.stdout, "json missing flag value");
    expect(report).toEqual({
      command: "build",
      success: false,
      exitCode: 2,
      error: "--config requires a path.",
    });
  });

  test("an inline empty --config value is a missing path", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--config="], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: --config requires a path.\n");
    expect(result.stdout).toBe("");
  });

  test("a duplicated --config is rejected", async () => {
    const root = await createProject("basic");
    const result = runCli(
      ["build", "--config", "xessa.config.json", "--config", "xessa.config.json"],
      root,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: --config may be given only once.\n");
  });

  test("a duplicated --config is rejected even when the second one carries a value", async () => {
    const root = await createProject("basic");
    const result = runCli(["check", "--config=xessa.config.json", "--config=nope.json"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--config may be given only once.");
  });

  test("two file positionals are rejected", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "src/button.cssx", "src/card.cssx"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: xessa build accepts at most one file argument.\n");
  });

  test("a positional after the `--` terminator is still a file positional", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--", "--minify"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("xessa: Source file not found: --minify\n");
  });

  test("a duplicated --json is not an error but the trailing one is cumulative", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--json", "--json"], root);
    expect(result.status).toBe(0);
    // Exactly one report document: the flag is idempotent, not concatenated.
    const report = parseJson<{ command: string; success: boolean }>(
      result.stdout,
      "duplicate json",
    );
    expect(report.command).toBe("build");
    expect(report.success).toBe(true);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
  });

  for (const flag of ["--json", "--minify", "--no-minify", "--dry-run", "--check"]) {
    test(`${flag}=value is rejected for a boolean flag`, async () => {
      const root = await createProject("basic");
      const result = runCli(["format", `${flag}=true`], root);
      expect(result.status).toBe(2);
      expect(result.stderr).toBe(`xessa: ${flag} does not take a value.\n`);
    });
  }

  test("an unknown command wins over a later --help", async () => {
    const root = await createProject("basic");
    const result = runCli(["compile", "--help"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('xessa: Unknown command "compile".\n');
  });

  test("a valid command with --help short-circuits to usage and exit 0", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--help"], root);
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith("xessa — compile Xessa stylesheets")).toBe(true);
    expect(result.stdout).toContain("Exit codes:");
    expect(result.stderr).toBe("");
  });

  test("--help does not suppress a later unknown option", async () => {
    const root = await createProject("basic");
    const result = runCli(["--help", "--wat"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('xessa: Unknown option "--wat".\n');
    expect(result.stdout).toBe("");
  });
});

describe("exit 2 · configuration schema cells", () => {
  test('"include" of the wrong type exits 2', async () => {
    const root = await createProject("");
    await writeText(join(root, "xessa.config.json"), JSON.stringify({ include: "src/*.cssx" }));
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('xessa: "include" must be an array of glob strings.\n');
  });

  test("an empty include entry exits 2", async () => {
    const root = await createProject("");
    await writeText(join(root, "xessa.config.json"), JSON.stringify({ include: ["  "] }));

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('xessa: "include" entries must be non-empty strings.\n');
  });

  test("an empty include list exits 2 before discovery", async () => {
    const root = await createProject("");
    await writeText(join(root, "xessa.config.json"), JSON.stringify({ include: [] }));

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"include" in');
    expect(result.stderr).toContain("must list at least one glob.");
  });

  test("an invalid media alias exits 2", async () => {
    const root = await createProject("");
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["src/*.cssx"], media: { md: "" } }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('xessa: "media.md" must be a non-empty media query string.\n');
  });

  test("an invalid compiler.mediaGrouping exits 2", async () => {
    const root = await createProject("");
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["src/*.cssx"], compiler: { mediaGrouping: "unsafe" } }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const result = runCli(["check"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      'xessa: "compiler.mediaGrouping" must be "safe", "none" or "merge".\n',
    );
  });
});

describe("exit 2 · include globs that match nothing (CSSX-T09)", () => {
  // Owner decision: an empty discovery result is a configuration error (exit 2),
  // not a successful empty build, so a moved source tree cannot turn CI green.
  test("a project build with no matching sources exits 2", async () => {
    const root = await createProject("");
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["nope/**/*.cssx"] }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    const build = runCli(["build"], root);
    expect(build.status).toBe(2);
    expect(build.stdout).toBe("");
    expect(build.stderr).toBe("xessa: No .cssx sources matched the project include globs.\n");

    const check = runCli(["check"], root);
    expect(check.status).toBe(2);
    expect(check.stdout).toBe("");
    expect(check.stderr).toBe("xessa: No .cssx sources matched the project include globs.\n");
  });

  test("the JSON report is a configuration failure for build and check", async () => {
    const root = await createProject("");
    await writeText(
      join(root, "xessa.config.json"),
      JSON.stringify({ include: ["nope/**/*.cssx"] }),
    );
    await writeText(join(root, "src/ok.cssx"), ".ok { color: red; }\n");

    for (const command of ["build", "check"] as const) {
      const result = runCli([command, "--json"], root);
      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      const report = parseJson<InvocationErrorReport>(result.stdout, `empty include ${command}`);
      expect(report).toEqual({
        command,
        success: false,
        exitCode: 2,
        error: "No .cssx sources matched the project include globs.",
      });
    }
  });
});

describe("exit 2 · invocation errors around --json", () => {
  test("a parse error after --json produces a JSON error report", async () => {
    const root = await createProject("basic");
    const result = runCli(["build", "--json", "--wat"], root);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    const report = parseJson<InvocationErrorReport>(result.stdout, "json invocation error");
    expect(report).toEqual({
      command: "build",
      success: false,
      exitCode: 2,
      error: 'Unknown option "--wat".',
    });
  });

  test("a parse error before --json stays on stderr", async () => {
    const root = await createProject("basic");
    const result = runCli(["--wat", "build", "--json"], root);
    expect(result.status).toBe(2);
    // The failure aborts parsing before `--json` is seen, so the report is text.
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe('xessa: Unknown option "--wat".\n');
  });

  test("an unknown command names the offending token in the JSON report", async () => {
    const root = await createProject("basic");
    const result = runCli(["--json", "compile"], root);
    expect(result.status).toBe(2);
    const report = parseJson<InvocationErrorReport>(result.stdout, "unknown command json");
    expect(report.command).toBe("compile");
    expect(report.error).toBe('Unknown command "compile".');
  });

  test("the command label for a flag-only failure is xessa", async () => {
    const root = await createProject("basic");
    const result = runCli(["--json", "--wat"], root);
    expect(result.status).toBe(2);
    const report = parseJson<InvocationErrorReport>(result.stdout, "flag-only json");
    expect(report.command).toBe("xessa");
    expect(report.error).toBe('Unknown option "--wat".');
  });
});
