/**
 * TT5 row 1 — "Node 20/22/24 + Bun on `packages/*\/dist`".
 *
 * | Assertion | How |
 * |---|---|
 * | `import` of the built compiler works | every installed runtime imports the **built** `@xessa/compiler` through its `package.json` `exports` in a throwaway consumer install and compiles one stylesheet, resolving to `dist/index.js` (never `src/`) |
 * | CLI `--version` per runtime | every installed runtime executes the built `packages/cli/dist/index.js` both from the consumer install and from the repository root |
 * | Only installed runtimes are claimed | {@link runtimeMatrix} rows are `verified` only when a binary actually answered `--version`; Node 20/22 (absent here) are recorded `unverified` with the reason |
 *
 * The matrix is machine-dependent by design (that is the deliverable); everything the
 * cases assert about the artifacts is fixed. The `dist` build runs once per machine
 * state through the standard workspace build command.
 *
 * Failure output: every case compares one observed record (command, status, stdout,
 * stderr) so a red run prints the exact command that broke on the exact runtime.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../corpus.ts";
import { cleanupTempProjects } from "../scale/generate.ts";
import {
  CLI_DIST_ENTRY,
  CLI_PACKAGE_DIR,
  COMPILER_DIST_ENTRY,
  COMPILER_PACKAGE_DIR,
  type ConsumerInstall,
  type DistBuildResult,
  type MatrixRow,
  REQUIRED_NODE_MAJORS,
  type Runtime,
  createConsumerInstall,
  describeCommand,
  ensureDistBuild,
  expectStatus,
  formatMatrix,
  packageVersion,
  runProcess,
  runtimeMatrix,
} from "./helpers.ts";

/** Authored probe plus the default (minified) CSS the built compiler must produce. */
const PROBE_SOURCE = ".probe {\n  display: flex;\n}\n";
const PROBE_CSS = ".probe{display:flex;}";

/** Consumer-root import probe: resolve, import, compile, report. */
const IMPORT_PROBE = `
const resolved = import.meta.resolve("@xessa/compiler");
const { compile } = await import("@xessa/compiler");
const result = await compile(${JSON.stringify(PROBE_SOURCE)}, { file: "src/probe.cssx" });
const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
process.stdout.write(JSON.stringify({ resolved, css: result.css, classes: result.classes, errors }));
`;

const matrix = runtimeMatrix();
const install: ConsumerInstall = createConsumerInstall();
let build: DistBuildResult;

beforeAll(async () => {
  build = await ensureDistBuild();
});

afterAll(() => {
  cleanupTempProjects();
});

/** Every `.js` file under a directory, recursively and deterministically. */
function javascriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...javascriptFiles(absolute));
      continue;
    }
    if (entry.endsWith(".js")) found.push(absolute);
  }
  return found;
}

/** Import/export specifiers of one ESM file. */
function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:^|[\s;}])(?:import|export)\s[^;]*?from\s+"([^"]+)"/gu)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  for (const match of source.matchAll(/import\("([^"]+)"\)/gu)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

/** Runtimes a case can actually execute. */
function verifiedRows(): readonly (MatrixRow & { readonly runtime: Runtime })[] {
  return matrix.rows.filter(
    (row): row is MatrixRow & { readonly runtime: Runtime } =>
      row.status === "verified" && row.runtime !== undefined,
  );
}

describe("runtime availability matrix", () => {
  test("every required runtime is verified or unverified with a recorded reason", () => {
    expect(build.built.length + build.fresh.length).toBe(2);

    const required = matrix.rows.filter((row) => row.required);
    // Node 20/22/24 plus Bun.
    expect(required.length).toBe(REQUIRED_NODE_MAJORS.length + 1);
    for (const major of REQUIRED_NODE_MAJORS) {
      expect(required.filter((row) => row.engine === "node" && row.major === major).length).toBe(1);
    }

    for (const row of matrix.rows) {
      if (row.status === "verified") {
        expect(row.runtime).toBeDefined();
        expect(row.reason).toBeUndefined();
        expect(row.runtime?.version).toMatch(/^\d+\.\d+\.\d+$/u);
        expect(row.runtime?.binary.startsWith("/")).toBe(true);
        continue;
      }
      // A missing runtime is never reported as passed.
      expect(row.runtime).toBeUndefined();
      expect(row.reason ?? "").toMatch(/not installed|no bun binary/u);
    }

    // The suite itself runs under Bun, so that row is always verified here.
    expect(matrix.rows.filter((row) => row.engine === "bun").map((row) => row.status)).toEqual([
      "verified",
    ]);
    // Every row is exactly one of the two recorded states.
    const summary = formatMatrix(matrix);
    expect(summary.length).toBe(matrix.rows.length);
    for (const line of summary) {
      expect(line.includes(": verified (") || line.includes(": UNVERIFIED — ")).toBe(true);
    }
    // Node majors below the engine floor are reported, not silently dropped.
    for (const excluded of matrix.discovery.excluded) {
      expect(excluded.reason).toContain("engines.node");
    }
  });

  test("the built compiler dist imports nothing but relative and node: specifiers", () => {
    const files = javascriptFiles(join(COMPILER_PACKAGE_DIR, "dist"));
    expect(files.length).toBeGreaterThan(50);
    const specifiers: string[] = [];
    for (const file of files) specifiers.push(...moduleSpecifiers(readFileSync(file, "utf8")));
    expect(specifiers.length).toBeGreaterThan(100);
    const offenders = specifiers.filter(
      (specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"),
    );
    expect(offenders).toEqual([]);
  });
});

for (const row of verifiedRows()) {
  const runtime = row.runtime;
  describe(`${row.label} (${runtime.version}) runtime matrix`, () => {
    test("imports the built compiler from dist and compiles a stylesheet", () => {
      const args = ["--input-type=module", "-e", IMPORT_PROBE];
      const outcome = runProcess(runtime.binary, args, { cwd: install.root });
      expectStatus(
        `${row.label} ${describeCommand(runtime.binary, ["--input-type=module", "-e", "<probe>"])}`,
        outcome,
        0,
      );
      expect(outcome.stderr).toBe("");
      const report = JSON.parse(outcome.stdout) as {
        resolved: string;
        css: string;
        classes: Record<string, string>;
        errors: number;
      };
      // The export map resolves to the built artifact, not TypeScript source.
      expect(report.resolved).toBe(`file://${COMPILER_DIST_ENTRY}`);
      expect(report.css).toBe(PROBE_CSS);
      expect(report.classes).toEqual({ probe: "probe" });
      expect(report.errors).toBe(0);
    });

    test("runs the built CLI --version from a consumer install", () => {
      const entry = join(install.cliDir, "dist", "index.js");
      const outcome = runProcess(runtime.binary, [entry, "--version"], { cwd: install.root });
      expectStatus(
        `${row.label} ${describeCommand(runtime.binary, [entry, "--version"])}`,
        outcome,
        0,
      );
      expect(outcome.stdout.trim()).toBe(packageVersion(CLI_PACKAGE_DIR));
      expect(outcome.stderr).toBe("");
    });

    test("runs the built CLI --version from the repository root", () => {
      // The plan's own validation command: `node packages/cli/dist/index.js --version`.
      const command = describeCommand(runtime.binary, [CLI_DIST_ENTRY, "--version"]);
      const outcome = runProcess(runtime.binary, [CLI_DIST_ENTRY, "--version"], { cwd: REPO_ROOT });
      expectStatus(`${row.label} ${command}`, outcome, 0);
      expect(outcome.stdout.trim()).toBe(packageVersion(CLI_PACKAGE_DIR));
    });
  });
}
