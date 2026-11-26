/**
 * TT5 row 4 — emitted-CSS validity at scale.
 *
 * | Assertion | How |
 * |---|---|
 * | emitted CSS re-parses with the compiler's own parser | the 1000-file scale corpus is compiled in memory with the **built** `dist` compiler and every emitted stylesheet is fed back through `parse()` with zero error diagnostics |
 * | `xessa check` agrees | every emitted stylesheet is written as a source file of a throwaway project and the built CLI (`xessa check --json`) reports exit 0, 1000 entries, 0 errors, 0 warnings |
 * | the independent-parser gap is recorded, not hidden | the repository declares no third-party CSS parser (`postcss`, `css-tree`, `csstree`, `lightningcss`), so the "independent third-party parser" half of the plan row stays an owner decision; the test pins the absence instead of installing one |
 *
 * Both oracles share the compiler's parser, which is the limitation the plan accepts
 * for this phase; it is repeated verbatim in `.ai/reports/CSSX-TT5.md` and cross-linked
 * from the TT2 report's note.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileProject, parse } from "../../../packages/compiler/dist/index.js";
import { REPO_ROOT } from "../corpus.ts";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  type ScaleProject,
  cleanupTempProjects,
  createMemoryHost,
  createTempProject,
  projectOutputOptions,
  thousandFileProject,
} from "../scale/generate.ts";
import {
  CLI_PACKAGE_DIR,
  type Runtime,
  ensureDistBuild,
  expectStatus,
  runProcess,
  runtimeMatrix,
} from "./helpers.ts";

/** Third-party CSS parsers that would satisfy the independent-parser half of the row. */
const THIRD_PARTY_PARSERS = ["postcss", "css-tree", "csstree", "lightningcss", "stylelint"];

/** The part of a `CompileResult` these cases read. */
interface CompiledEntry {
  readonly css?: string;
  readonly diagnostics: readonly { readonly severity: string }[];
}

/** Compiled artifacts of the scale corpus, keyed by workspace-relative entry path. */
let emitted: Record<string, CompiledEntry> = {};
/** Generated project, kept for the authored paths. */
let project: ScaleProject;
/** Runtime that executes the built CLI for the `xessa check` half. */
let cliRuntime: Runtime | undefined;
/** Root of the emitted-CSS-as-source project. */
let checkRoot = "";
/** Recorded JSON report of `xessa check --json`. */
let checkReport: unknown;

interface CheckReport {
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly entries: readonly {
    readonly file: string;
    readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
  }[];
}

/** Error-severity diagnostics of one tolerant parse. */
function errorMessages(source: string, file: string): string[] {
  return parse(source, { file })
    .diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`);
}

beforeAll(async () => {
  await ensureDistBuild();
  const matrix = runtimeMatrix();
  cliRuntime = matrix.rows.find(
    (row) => row.engine === "node" && row.status === "verified",
  )?.runtime;
  cliRuntime ??= matrix.rows.find(
    (row) => row.engine === "bun" && row.status === "verified",
  )?.runtime;

  const rng = createLabelledRng(readStressSeed(), "consumer/css-validity");
  project = thousandFileProject(rng);
  emitted = await compileProject(project.entries, createMemoryHost(project.files), {
    projectRoot: "/workspace",
    output: projectOutputOptions(),
    mediaGrouping: "safe",
  });

  // Re-author every emitted stylesheet as a project source so the built CLI can check it.
  const files: Record<string, string> = {
    "xessa.config.json": `${JSON.stringify(
      {
        include: ["src/**/*.cssx"],
        exclude: ["dist"],
        output: { emitCss: true, emitMap: false, emitTypes: false },
        classes: { strategy: "none" },
      },
      null,
      2,
    )}\n`,
  };
  for (const entry of project.entries) {
    const name = entry.replace(/^src\//u, "").replace(/\.cssx$/u, "");
    files[`src/${name}.cssx`] = emitted[entry]?.css ?? "";
  }
  checkRoot = createTempProject(files);

  const entry = join(CLI_PACKAGE_DIR, "dist", "index.js");
  const outcome = runProcess(cliRuntime?.binary ?? "bun", [entry, "check", "--json"], {
    cwd: checkRoot,
    timeoutMs: 240_000,
  });
  expectStatus(`${cliRuntime?.version ?? "bun"} xessa check --json`, outcome, 0);
  checkReport = JSON.parse(outcome.stdout) as CheckReport;
});

afterAll(() => {
  cleanupTempProjects();
});

describe("emitted CSS validity at scale", () => {
  test("the 1000-file corpus compiles to emitted stylesheets without errors", () => {
    expect(Object.keys(emitted).length).toBe(project.entries.length);
    let bytes = 0;
    let errors = 0;
    for (const entry of project.entries) {
      const result = emitted[entry];
      expect(result).toBeDefined();
      bytes += Buffer.byteLength(result?.css ?? "", "utf8");
      for (const diagnostic of result?.diagnostics ?? []) {
        if (diagnostic.severity === "error") errors += 1;
      }
    }
    expect(errors).toBe(0);
    expect(bytes).toBeGreaterThan(200_000);
  });

  test("every emitted stylesheet re-parses with the built parser", () => {
    const failures: string[] = [];
    for (const entry of project.entries) {
      const css = emitted[entry]?.css ?? "";
      const messages = errorMessages(css, entry.replace(/\.cssx$/u, ".css"));
      if (css.length === 0) failures.push(`${entry}: emitted nothing`);
      for (const message of messages) failures.push(`${entry}: ${message}`);
    }
    expect(failures).toEqual([]);
  });

  test("the emitted stylesheets keep their authored class tokens", () => {
    // A validity check that silently emitted nothing would also "parse cleanly".
    for (const index of [0, 500, 999]) {
      const entry = project.entries[index] ?? "";
      const css = emitted[entry]?.css ?? "";
      const name = String(index).padStart(4, "0");
      expect({ entry, hasCard: css.includes(`.card-${name}`) }).toEqual({
        entry,
        hasCard: true,
      });
      expect({ entry, hasMedia: css.includes("@media") }).toEqual({ entry, hasMedia: true });
    }
  });

  test("xessa check reports zero errors over the emitted corpus", () => {
    const report = checkReport as CheckReport;
    expect(report.command).toBe("check");
    expect(report.success).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.entries.length).toBe(project.entries.length);
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const entry of report.entries) {
      for (const diagnostic of entry.diagnostics) {
        if (diagnostic.severity === "error") errors.push(`${entry.file}: ${diagnostic.code}`);
        if (diagnostic.severity === "warning") warnings.push(`${entry.file}: ${diagnostic.code}`);
      }
    }
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("no third-party CSS parser is available, so that half of the row is recorded unverified", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
    const present = THIRD_PARTY_PARSERS.filter((name) => Object.hasOwn(declared, name));
    // Recorded limitation of the plan (owner decision, no new dependency): the oracle is
    // the compiler's own parser plus `xessa check`, never an independent implementation.
    expect({
      limitation: "no independent third-party CSS parser",
      present,
      reason:
        "owner decision — adding one needs approval (.ai/plans/CSSX-PLAN-TESTING.md ground rules)",
    }).toEqual({
      limitation: "no independent third-party CSS parser",
      present: [],
      reason:
        "owner decision — adding one needs approval (.ai/plans/CSSX-PLAN-TESTING.md ground rules)",
    });
  });
});
