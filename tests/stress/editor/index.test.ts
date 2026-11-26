/**
 * TT6 · a 1 000-file project index.
 *
 * The editor's project surface is `discoverProjectEntries()` (entry discovery
 * for **Build Project**) plus one analysis per open/authored document, whose
 * token symbols and `@use` aliases are the alias index that completion, hover
 * and definition read. This case builds that index over a deterministic
 * 1 000-module project and records how long it takes.
 *
 * No filesystem is touched for the project itself: `discoverProjectEntries`
 * takes an injectable directory lister, so the whole tree lives in memory and
 * the case stays byte-identical on every machine (ground rule: temp dirs only,
 * fixtures read-only). The one exception is the compiler spot-check at the end,
 * which needs a real path for `analyzeDocument`'s in-memory compile; it writes
 * into a `mkdtemp` directory and removes it again.
 *
 * macOS note recorded in the TT6 report: the temp directory must be passed
 * through `realpathSync`, because `/var/folders/…` is a symlink to
 * `/private/var/…` and the compiler's workspace-containment check compares
 * literal paths (XESSA5001 "outside the workspace root" otherwise).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeDocument, analyzeText } from "../../../packages/vscode/src/analysis.ts";
import { type DirectoryEntry, discoverProjectEntries } from "../../../packages/vscode/src/glob.ts";
import {
  completionsAt,
  definitionsAt,
  hoverAt,
} from "../../../packages/vscode/src/intelligence.ts";
import { HARD_CEILING_MS, TimingTable, timeRepeated } from "./timing.ts";

const ROOT = "/virtual/tt6-project";
const FILE_COUNT = 1_000;
/** Total wall-clock ceiling for indexing the whole project (generous). */
const PROJECT_CEILING_MS = 60_000;

/** One generated module: its path and authored text. */
interface VirtualModule {
  readonly path: string;
  readonly text: string;
}

/** Deterministic 1 000-module project: one token per module plus a shared one. */
function buildProject(): { modules: VirtualModule[]; tree: Map<string, DirectoryEntry[]> } {
  const modules: VirtualModule[] = [];
  const srcEntries: DirectoryEntry[] = [];

  const shared = "@variables {\n  base: 4px;\n  accent: #2563eb;\n}\n";
  modules.push({ path: `${ROOT}/src/shared.cssx`, text: shared });
  srcEntries.push({ name: "shared.cssx", directory: false });

  for (let index = 0; index < FILE_COUNT; index += 1) {
    const name = `mod-${index}.cssx`;
    const importLine = index === 0 ? '@use "./shared.cssx" as shared;\n' : "";
    const sharedUse = index === 0 ? "  margin: $shared.base;\n" : "";
    modules.push({
      path: `${ROOT}/src/${name}`,
      text: [
        importLine,
        "@variables {",
        `  tok-${index}: ${index}px;`,
        "}",
        `.mod-${index} {`,
        `  padding: $tok-${index};`,
        sharedUse,
        "}",
        "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    });
    srcEntries.push({ name, directory: false });
  }

  const tree = new Map<string, DirectoryEntry[]>([
    [ROOT, [{ name: "src", directory: true }]],
    [`${ROOT}/src`, srcEntries.sort((left, right) => (left.name < right.name ? -1 : 1))],
  ]);
  return { modules, tree };
}

const PROJECT = buildProject();
const MODULE_BY_PATH = new Map(PROJECT.modules.map((module) => [module.path, module.text]));

/** Injected directory lister over the virtual tree. */
function listDirectory(directory: string): readonly DirectoryEntry[] {
  return PROJECT.tree.get(directory) ?? [];
}

/** One token symbol in the alias index. */
interface AliasEntry {
  readonly name: string;
  /** Module that declares the token. */
  readonly module: string;
}

const table = new TimingTable();
afterAll(() => table.print("1 000-module project index (p50/p95/max, milliseconds)"));

describe("1 000-file project — discovery", () => {
  test("every module is discovered once, sorted, with excludes honoured", () => {
    const entries = discoverProjectEntries(ROOT, ["**/*.cssx"], [], listDirectory);
    expect(entries.length).toBe(FILE_COUNT + 1);
    expect(entries[0]?.endsWith("mod-0.cssx")).toBe(true);
    expect([...entries].sort()).toEqual([...entries]);
    // A glob that excludes everything but one subtree must still be exact.
    const narrowed = discoverProjectEntries(ROOT, ["src/mod-1?.cssx"], [], listDirectory);
    expect(narrowed.length).toBe(10);
  });
});

describe("1 000-file project — alias/symbol index build", () => {
  test("indexing the whole project is recorded and stays under a generous ceiling", () => {
    const entries = discoverProjectEntries(ROOT, ["**/*.cssx"], [], listDirectory);

    const analysisStats = timeRepeated(
      () => {
        const aliases: AliasEntry[] = [];
        for (const entry of entries) {
          const text = MODULE_BY_PATH.get(entry);
          if (text === undefined) throw new Error(`missing source for ${entry}`);
          const analysis = analyzeText(
            { text, path: entry, version: 1 },
            {
              readModule: (path) => MODULE_BY_PATH.get(path),
            },
          );
          for (const token of analysis.tokens) {
            if (token.namespace === undefined) aliases.push({ name: token.name, module: entry });
          }
        }
        return aliases;
      },
      { warmup: 0, samples: 3 },
    );
    table.add(`alias index (${entries.length} modules)`, analysisStats);
    expect(analysisStats.total).toBeLessThan(PROJECT_CEILING_MS);
    expect(analysisStats.p95).toBeLessThan(PROJECT_CEILING_MS);
  });

  test("the index resolves known tokens and reports unknown ones", () => {
    const entries = discoverProjectEntries(ROOT, ["**/*.cssx"], [], listDirectory);
    const index = new Map<string, string>();
    for (const entry of entries) {
      const text = MODULE_BY_PATH.get(entry);
      if (text === undefined) continue;
      const analysis = analyzeText(
        { text, path: entry, version: 1 },
        {
          readModule: (path) => MODULE_BY_PATH.get(path),
        },
      );
      for (const token of analysis.tokens) {
        if (token.namespace === undefined && !index.has(token.name)) index.set(token.name, entry);
      }
    }
    // 1 000 module tokens plus the shared module's two.
    expect(index.size).toBe(FILE_COUNT + 2);
    expect(index.get("tok-500")).toBe(`${ROOT}/src/mod-500.cssx`);
    expect(index.get("base")).toBe(`${ROOT}/src/shared.cssx`);

    // Spot-check a sample module end to end: hover value, definition target and
    // a filtered completion, all against the project-local token.
    const samplePath = `${ROOT}/src/mod-500.cssx`;
    const sampleText = MODULE_BY_PATH.get(samplePath) ?? "";
    const sample = analyzeText(
      { text: sampleText, path: samplePath, version: 1 },
      {
        readModule: (path) => MODULE_BY_PATH.get(path),
      },
    );
    const reference = sampleText.indexOf("$tok-500");
    expect(reference).toBeGreaterThan(0);
    const hover = hoverAt(sampleText, reference + "$tok-500".length, { analysis: sample });
    expect(hover?.markdown).toContain("500px");
    const targets = definitionsAt(sampleText, reference + 1, { analysis: sample });
    expect(targets.map((target) => target.name)).toEqual(["tok-500"]);
    const completions = completionsAt(sampleText, reference + "$tok-50".length, {
      analysis: sample,
    });
    expect(completions.items.map((item) => item.label)).toEqual(["$tok-500"]);

    // The cross-module alias: `$shared.base` resolves in mod-0 and jumps out.
    const entryText = MODULE_BY_PATH.get(`${ROOT}/src/mod-0.cssx`) ?? "";
    const aliasUse = entryText.indexOf("$shared.base");
    expect(aliasUse).toBeGreaterThan(0);
    const entryAnalysis = analyzeText(
      { text: entryText, path: `${ROOT}/src/mod-0.cssx`, version: 1 },
      {
        readModule: (path) => MODULE_BY_PATH.get(path),
      },
    );
    const aliasHover = hoverAt(entryText, aliasUse + "$shared.base".length, {
      analysis: entryAnalysis,
    });
    expect(aliasHover?.markdown).toContain("4px");
    const aliasTargets = definitionsAt(entryText, aliasUse + 1, { analysis: entryAnalysis });
    expect(aliasTargets.map((target) => target.file)).toEqual([`${ROOT}/src/shared.cssx`]);
  });
});

describe("1 000-file project — compiler agreement on a sample", () => {
  // The compile path reads real files, so the two spot-check documents live in
  // a temp directory that is removed again in `afterAll`.
  const tempRoot = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "xessa-tt6-index-")));
  afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

  test("a known token compiles clean and an unknown token is XESSA2001", async () => {
    const knownPath = join(tempRoot, "known.cssx");
    const knownText = "@variables {\n  gap: 8px;\n}\n.a { padding: $gap; }\n";
    writeFileSync(knownPath, knownText, "utf8");
    const known = await analyzeDocument(
      { text: readFileSync(knownPath, "utf8"), path: knownPath, version: 1 },
      { workspaceRoot: tempRoot, compile: true },
    );
    expect(known.analysis.problems).toEqual([]);

    const unknownPath = join(tempRoot, "unknown.cssx");
    const unknownText = ".a { padding: $missing-token; }\n";
    writeFileSync(unknownPath, unknownText, "utf8");
    const unknown = await analyzeDocument(
      { text: readFileSync(unknownPath, "utf8"), path: unknownPath, version: 1 },
      { workspaceRoot: tempRoot, compile: true },
    );
    const problem = unknown.analysis.problems.find((entry) => entry.code === "XESSA2001");
    expect(problem?.message).toContain("$missing-token");

    // The editor degrades the same way: no hover, no completion, no target.
    const unknownAnalysis = analyzeText(
      { text: unknownText, path: unknownPath, version: 1 },
      { workspaceRoot: tempRoot },
    );
    const offset = unknownText.indexOf("$missing-token") + "$missing-token".length;
    expect(hoverAt(unknownText, offset, { analysis: unknownAnalysis })).toBeUndefined();
    expect(completionsAt(unknownText, offset, { analysis: unknownAnalysis }).items).toEqual([]);
    expect(definitionsAt(unknownText, offset - 1, { analysis: unknownAnalysis })).toEqual([]);
  });

  test("the recorded per-file analysis stays under the hard ceiling", () => {
    // Per-document cost is what the editor pays on every keystroke; measured
    // over a 50-module sample so the number is above timer noise.
    const sample = PROJECT.modules.slice(0, 50);
    const stats = timeRepeated(
      () => {
        for (const module of sample) {
          analyzeText(
            { text: module.text, path: module.path, version: 1 },
            {
              readModule: (path) => MODULE_BY_PATH.get(path),
            },
          );
        }
      },
      { warmup: 5, samples: 50 },
    );
    table.add("analyzeText (50 project modules)", stats);
    expect(stats.p95).toBeLessThan(HARD_CEILING_MS);
  });
});
