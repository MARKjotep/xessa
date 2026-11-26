/**
 * TT3 · Interrupted writes (§TT3 "Interruption", weakest-10 #2b).
 *
 * The plan's row: "kill mid-write (child process + `SIGKILL` at a marker), then a
 * clean build: no half-written artifact survives".
 *
 * Interruption is made deterministic rather than timed: a 120-entry project is
 * compiled and written sequentially, the child is `SIGKILL`ed the moment the
 * first artifact's bytes change, and every surviving artifact must then equal
 * either its pre-edit bytes or its final rebuilt bytes — never anything in
 * between. `atomicWrite` (writer.ts:38-57) writes a sibling temporary file and
 * renames into place, so per-file atomicity is the property under test; the
 * rebuild afterwards must converge on exactly the reference output.
 *
 * Reliability measured while writing this case: 5/5 runs killed the child with
 * 2-3 of 200 artifacts written (`.ai/reports/CSSX-TT3.md`).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildReport,
  cleanupProjects,
  cliEntry,
  createProject,
  listFiles,
  projectConfig,
  readManifest,
  readProjectFile,
  runCli,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Number of entries: large enough that the write phase cannot finish first. */
const ENTRY_COUNT = 120;

/** Source text for entry `index`, tagged with a generation marker. */
function sourceFor(index: number, generation: number): string {
  const name = `f${String(index).padStart(3, "0")}`;
  return [
    `.${name} {`,
    `  color: rgb(${index % 256}, 0, 0);`,
    `  padding: ${generation}px;`,
    "}",
    "",
  ].join("\n");
}

/** Content of every artifact in `out/src`, keyed by project-relative path. */
function artifactContents(root: string): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const path of listFiles(`${root}/out`)) {
    if (!path.endsWith(".css")) continue;
    contents[`out/${path}`] = readFileSync(join(root, "out", path), "utf8");
  }
  return contents;
}

/** Every non-artifact entry inside `out`, as project-relative paths. */
function residue(root: string): string[] {
  return listFiles(`${root}/out`)
    .filter((path) => !path.endsWith(".css"))
    .map((path) => `out/${path}`);
}

/** Resolve once the child has exited. */
function exitOf(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

/** Start a build and SIGKILL it as soon as `changed()` reports progress. */
async function killOnFirstWrite(
  root: string,
  changed: () => boolean,
): Promise<{
  readonly signal: string | null;
  readonly changed: boolean;
  readonly atKill: Record<string, string>;
  readonly residueAtKill: string[];
}> {
  const child = spawn(process.execPath, [cliEntry, "build"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  const exited = exitOf(child);

  let killed = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (changed()) {
      killed = true;
      child.kill("SIGKILL");
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const outcome = await exited;
  if (!killed) child.kill("SIGKILL");

  return {
    signal: outcome.signal,
    changed: killed,
    atKill: artifactContents(root),
    residueAtKill: residue(root),
  };
}

describe("interrupted writes", () => {
  test("a SIGKILL mid-write never leaves a torn artifact and the next build converges", async () => {
    const files: Record<string, string> = {
      "xessa.config.json": `${JSON.stringify(
        projectConfig({ include: ["src/*.cssx"], cssDir: "out" }),
        null,
        2,
      )}\n`,
    };
    for (let index = 0; index < ENTRY_COUNT; index += 1) {
      files[`src/${String(index).padStart(3, "0")}.cssx`] = sourceFor(index, 1);
    }
    const root = await createProject(files);

    // Generation 1 is the complete reference every surviving artifact may hold.
    const initial = buildReport([], root);
    expect(initial.success).toBe(true);
    const before = artifactContents(root);
    expect(Object.keys(before)).toHaveLength(ENTRY_COUNT);
    expect(residue(root)).toEqual([]);

    for (let index = 0; index < ENTRY_COUNT; index += 1) {
      await writeProjectFile(
        root,
        `src/${String(index).padStart(3, "0")}.cssx`,
        sourceFor(index, 2),
      );
    }

    // Writes run in sorted entry order, so the first entry is the earliest
    // reliable signal that the write phase has started.
    const firstPath = `out/src/${"000"}.css`;
    const killed = await killOnFirstWrite(root, () => {
      try {
        return readFileSync(join(root, firstPath), "utf8") !== before[firstPath];
      } catch {
        return false;
      }
    });

    expect(killed.changed).toBe(true);
    expect(killed.signal).toBe("SIGKILL");
    // Interruption actually happened: some entries had not been rewritten yet.
    const rewritten = Object.entries(killed.atKill).filter(
      ([path, content]) => content !== before[path],
    );
    expect(rewritten.length).toBeGreaterThan(0);
    expect(rewritten.length).toBeLessThan(ENTRY_COUNT);
    // Nothing but dot-prefixed writer temporaries may appear in the output tree.
    expect(killed.residueAtKill.filter((path) => !path.endsWith(".cssx-tmp"))).toEqual([]);
    expect(killed.residueAtKill.every((path) => path.startsWith("out/src/."))).toBe(true);

    // A clean rebuild converges on the generation-2 reference output.
    const rebuilt = buildReport([], root);
    expect(rebuilt.success).toBe(true);
    const after = artifactContents(root);
    expect(Object.keys(after)).toHaveLength(ENTRY_COUNT);
    for (const [path, content] of Object.entries(after)) {
      expect(content).toContain("padding:2px");
      // Every surviving artifact is either the old or the new complete file —
      // never a prefix or a mixture.
      expect([before[path], content]).toContain(content);
      expect(killed.atKill[path] === before[path] || killed.atKill[path] === content).toBe(true);
    }
    const manifest = await readManifest(root);
    expect(manifest?.files).toHaveLength(ENTRY_COUNT);
    expect(manifest?.files.every((record) => record.path.endsWith(".css"))).toBe(true);

    // A `.cssx-tmp` file left by the killed process is swept by the next build
    // (CSSX-T07), so nothing but artifacts remains in the output tree.
    expect(residue(root)).toEqual([]);
  }, 120_000);

  test("a killed first build writes only complete artifacts", async () => {
    const files: Record<string, string> = {
      "xessa.config.json": `${JSON.stringify(
        projectConfig({ include: ["src/*.cssx"], cssDir: "out" }),
        null,
        2,
      )}\n`,
    };
    for (let index = 0; index < ENTRY_COUNT; index += 1) {
      files[`src/${String(index).padStart(3, "0")}.cssx`] = sourceFor(index, 1);
    }
    const root = await createProject(files);

    // No previous artifacts exist, so any `.css` is the write phase starting.
    const killed = await killOnFirstWrite(
      root,
      () => Object.keys(artifactContents(root)).length > 0,
    );
    expect(killed.changed).toBe(true);
    expect(killed.signal).toBe("SIGKILL");

    const written = Object.keys(killed.atKill);
    expect(written.length).toBeGreaterThan(0);
    expect(written.length).toBeLessThan(ENTRY_COUNT);

    const rebuilt = buildReport([], root);
    expect(rebuilt.success).toBe(true);
    const reference = artifactContents(root);
    expect(Object.keys(reference)).toHaveLength(ENTRY_COUNT);

    // Every artifact that existed at kill time is byte-identical to the file a
    // clean build produces: per-file atomicity held under SIGKILL.
    for (const path of written) {
      expect(killed.atKill[path]).toBe(reference[path]);
    }
    expect((await readManifest(root))?.files).toHaveLength(ENTRY_COUNT);
  }, 120_000);

  test("an orphaned writer temporary is swept by a build and by clean (CSSX-T07)", async () => {
    const root = await createProject({
      "xessa.config.json": "",
      "src/a.cssx": ".a {\n  color: red;\n}\n",
    });
    await writeProjectJson(root, "xessa.config.json", projectConfig({ cssDir: "out" }));
    expect(buildReport([], root).success).toBe(true);

    // Exactly what `atomicWrite` leaves behind when the process dies between
    // `writeFile(temporary)` and `rename(temporary, path)` (writer.ts): a
    // dot-prefixed sibling carrying the killed pid and counter.
    const orphan = "out/src/.a.css.999999.1.cssx-tmp";
    await writeProjectFile(root, orphan, ".a {\n  color: re");

    const rebuilt = buildReport([], root);
    expect(rebuilt.success).toBe(true);
    expect(rebuilt.warnings).toEqual([]);
    // The sweep removes it before the run writes, silently (writer temporaries
    // were never artifacts).
    expect(await readProjectFile(root, orphan)).toBeNull();
    expect(await readProjectFile(root, "out/src/a.css")).toContain(".a");

    // Plant it again so `clean` itself is exercised, then clean must leave no
    // `*.cssx-tmp` under the output directory either.
    await writeProjectFile(root, orphan, ".a {\n  color: re");
    const cleaned = runCli(["clean", "--json"], root);
    expect(cleaned.status).toBe(0);
    expect(await readProjectFile(root, orphan)).toBeNull();
    expect(await readProjectFile(root, "out/src/a.css")).toBeNull();
    expect(listFiles(`${root}/out`).filter((path) => path.endsWith(".cssx-tmp"))).toEqual([]);
    expect(listFiles(`${root}/out`)).toEqual([]);
  }, 60_000);
});
