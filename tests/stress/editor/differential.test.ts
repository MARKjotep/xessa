/**
 * TT6 · differential: editor group/keyframe visibility vs the compiler resolver.
 *
 * `packages/vscode/src/groups.ts` and `keyframes.ts` re-implement the compiler's
 * `resolver/{groups,keyframes}.ts` rules without importing resolver internals
 * (the public barrel does not export them). Nothing compared the two until this
 * file: a compiler rule change could silently diverge from what completion,
 * hover, definition and rename tell the user.
 *
 * What is asserted (weakest-10 row #9a):
 *
 * - **Fixture corpus** — every directory under `tests/fixtures/{groups,keyframes}`
 *   that has an `entry.cssx`/`input.cssx`: the visible name set, the resolution
 *   kind and the defining module must be identical on both sides, including
 *   ambiguity candidate sets.
 * - **Generated corpus** — seeded module projects built by
 *   `generateModuleProject()` (styles and token-only `@use` edges, duplicate
 *   definitions, repeated keyframe names, diamonds). Groups are compared
 *   strictly; keyframes follow the documented ADR-0015 rule (see
 *   `keyframeDivergence`).
 * - **Cyclic corpus** — a module cycle is already XESSA2001. Both sides cut a
 *   back edge the same way (sources in sorted canonical-path order with one
 *   shared memo), so the recovered visibility is compared for set equality
 *   too, using the compiler graph built for the analysed document itself
 *   (CSSX-T13). Termination, determinism and "every candidate is a loaded
 *   module" stay pinned as invariants of the error state.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { createNodeHost } from "../../../packages/compiler/src/index.ts";
import { buildModuleGraph } from "../../../packages/compiler/src/resolver/index.ts";
import type { ModuleGraph, ModuleRecord } from "../../../packages/compiler/src/resolver/index.ts";
import type { ModuleHost } from "../../../packages/compiler/src/types/options.ts";
import type { AnalyzeResult } from "../../../packages/vscode/src/analysis.ts";
import { analyzeText } from "../../../packages/vscode/src/analysis.ts";
import {
  GENERATED_WORKSPACE,
  type GeneratedModuleProject,
  generateModuleProject,
} from "./documents.ts";

const REPO_ROOT = realpathSync(new URL("../../../", import.meta.url).pathname);

/** Sync module reader, exactly the shape `analyzeText` receives from the editor. */
function readModule(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

/** Compiler host over generated (in-memory) modules. */
function memoryHost(files: ReadonlyMap<string, string>): ModuleHost {
  return {
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return files.has(path);
    },
    canonicalize(path: string): string {
      return path;
    },
    resolvePath(from: string, to: string): string {
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      return GENERATED_WORKSPACE;
    },
  };
}

/** One side's answer for a single visible name. */
type Resolution =
  | { readonly kind: "resolved"; readonly module: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

/** Stable, order-insensitive rendering used in expectations and messages. */
function render(map: ReadonlyMap<string, Resolution>): string {
  const entries = [...map.entries()]
    .map(([name, resolution]) => [name, resolution] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, resolution]) =>
      resolution.kind === "resolved"
        ? `${name}=resolved:${resolution.module}`
        : `${name}=ambiguous:${[...resolution.candidates].sort().join("|")}`,
    );
  return entries.join(", ");
}

/** Compiler view of the groups visible from `record`. */
function compilerGroups(record: ModuleRecord): Map<string, Resolution> {
  const map = new Map<string, Resolution>();
  for (const [name, resolution] of record.groups) {
    map.set(
      name,
      resolution.kind === "resolved"
        ? { kind: "resolved", module: resolution.group.module }
        : {
            kind: "ambiguous",
            candidates: resolution.candidates.map((candidate) => candidate.module),
          },
    );
  }
  return map;
}

/** Editor view of the groups visible in one analysed document. */
function editorGroups(analysis: AnalyzeResult): Map<string, Resolution> {
  const map = new Map<string, Resolution>();
  for (const visibility of analysis.groups) {
    map.set(
      visibility.name,
      visibility.kind === "resolved"
        ? { kind: "resolved", module: visibility.symbol.file }
        : {
            kind: "ambiguous",
            candidates: visibility.candidates.map((candidate) => candidate.file),
          },
    );
  }
  return map;
}

/**
 * Compare one analysed document against the compiler graph.
 *
 * Groups must match exactly. Keyframes use `keyframeDivergence` because the
 * editor deliberately reports two imported definitions with no local one as
 * `ambiguous` (hover says the compiler reports no conflict, definition returns
 * nothing, rename refuses) while the compiler resolves the first definition.
 * That difference is a designed editor state, not drift: the compiler's chosen
 * module must be one of the editor's candidates, there must be at least two
 * candidates, and the compiler must not have diagnosed anything.
 */
interface Comparison {
  readonly groupMismatch?: string;
  readonly keyframeMismatch?: string;
}

function compareModule(
  file: string,
  text: string,
  record: ModuleRecord,
  graph: ModuleGraph,
  reader: (absolutePath: string) => string | undefined,
): Comparison {
  const analysis = analyzeText({ text, path: file, version: 1 }, { readModule: reader });
  const compiler = compilerGroups(record);
  const editor = editorGroups(analysis);
  const groupMismatch =
    render(compiler) === render(editor)
      ? undefined
      : `${file}\n  compiler: ${render(compiler)}\n  editor:   ${render(editor)}\n  source:\n${text}`;

  const keyframeMismatch = keyframeDivergence(file, record, analysis, graph);
  return {
    ...(groupMismatch === undefined ? {} : { groupMismatch }),
    ...(keyframeMismatch === undefined ? {} : { keyframeMismatch }),
  };
}

/** Keyframe comparison with the documented ADR-0015 duplicate-name rule. */
function keyframeDivergence(
  file: string,
  record: ModuleRecord,
  analysis: AnalyzeResult,
  graph: ModuleGraph,
): string | undefined {
  const compilerNames = [...record.keyframes.keys()].sort();
  const editorNames = analysis.keyframes.map((entry) => entry.name).sort();
  if (compilerNames.join("|") !== editorNames.join("|")) {
    return `${file} keyframe name set\n  compiler: ${compilerNames.join(", ")}\n  editor:   ${editorNames.join(", ")}`;
  }
  for (const visibility of analysis.keyframes) {
    const compilerModule = record.keyframes.get(visibility.name)?.module;
    if (visibility.kind === "resolved") {
      if (compilerModule !== visibility.symbol.file) {
        return `${file} keyframe "${visibility.name}"\n  compiler: ${compilerModule}\n  editor:   ${visibility.symbol.file}`;
      }
      continue;
    }
    const candidates = visibility.candidates.map((candidate) => candidate.file);
    const diagnosed = graph.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "XESSA2001" && diagnostic.message.includes(visibility.name),
    );
    if (compilerModule === undefined || !candidates.includes(compilerModule)) {
      return `${file} keyframe "${visibility.name}" ambiguous in the editor but ${compilerModule ?? "absent"} in the compiler`;
    }
    if (candidates.length < 2) {
      return `${file} keyframe "${visibility.name}" ambiguous with ${candidates.length} candidate(s)`;
    }
    if (diagnosed) {
      return `${file} keyframe "${visibility.name}" ambiguous in the editor but diagnosed by the compiler`;
    }
  }
  return undefined;
}

/** Entry file of one fixture directory, if it has one. */
function fixtureEntry(directory: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return undefined;
  }
  if (names.includes("entry.cssx")) return join(directory, "entry.cssx");
  if (names.includes("input.cssx")) return join(directory, "input.cssx");
  return undefined;
}

/** Every `tests/fixtures/{groups,keyframes}/<case>` fixture with an entry. */
function fixtureCorpus(): readonly { readonly name: string; readonly entry: string }[] {
  const corpus: { name: string; entry: string }[] = [];
  for (const family of ["groups", "keyframes"]) {
    const base = join(REPO_ROOT, "tests/fixtures", family);
    for (const caseName of readdirSync(base).sort()) {
      const directory = join(base, caseName);
      if (!statSync(directory).isDirectory()) continue;
      const entry = fixtureEntry(directory);
      if (entry === undefined) continue;
      corpus.push({ name: `${family}/${caseName}`, entry });
    }
  }
  return corpus;
}

describe("fixture corpus — editor matches the compiler resolver", () => {
  const corpus = fixtureCorpus();

  test("the corpus is the full groups + keyframes fixture set", () => {
    // Guards against a silently shrinking differential (e.g. a renamed entry).
    expect(corpus.length).toBe(26);
    expect(corpus.filter((entry) => entry.name.startsWith("groups/")).length).toBe(20);
    expect(corpus.filter((entry) => entry.name.startsWith("keyframes/")).length).toBe(6);
  });

  test("every fixture resolves to the same symbol set on both sides", async () => {
    const failures: string[] = [];
    for (const { name, entry } of corpus) {
      const graph = await buildModuleGraph([entry], createNodeHost(REPO_ROOT), { file: entry });
      const record = graph.modules.get(entry);
      const text = readModule(entry);
      if (record === undefined || text === undefined) {
        failures.push(`${name}: module not loaded by the compiler`);
        continue;
      }
      const comparison = compareModule(entry, text, record, graph, readModule);
      if (comparison.groupMismatch !== undefined)
        failures.push(`GROUPS ${name}: ${comparison.groupMismatch}`);
      if (comparison.keyframeMismatch !== undefined) {
        failures.push(`KEYFRAMES ${name}: ${comparison.keyframeMismatch}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("the fixture corpus actually exercises resolution (not an empty match)", () => {
    const names = new Set<string>();
    let ambiguous = 0;
    for (const { entry } of corpus) {
      const text = readModule(entry);
      if (text === undefined) continue;
      const analysis = analyzeText({ text, path: entry, version: 1 }, { readModule });
      for (const visibility of analysis.groups) {
        names.add(`group:${visibility.name}`);
        if (visibility.kind === "ambiguous") ambiguous += 1;
      }
      for (const visibility of analysis.keyframes) names.add(`keyframe:${visibility.name}`);
    }
    expect(names.size).toBeGreaterThan(3);
    // `groups/ambiguous-import` is the one fixture whose definition is contested.
    expect(ambiguous).toBeGreaterThan(0);
  });
});

describe("generated corpus — seeded module projects agree", () => {
  const SEEDS = 60;

  async function compareProject(project: GeneratedModuleProject): Promise<string[]> {
    const { files, modules, entry } = project;
    // Every module is an entry so the graph loads all of them: a module the
    // entry never imports is still a document the editor analyses.
    const graph = await buildModuleGraph([...modules], memoryHost(files), { file: entry });
    const failures: string[] = [];
    for (const file of modules) {
      const record = graph.modules.get(file);
      const text = files.get(file);
      if (record === undefined || text === undefined) {
        failures.push(`${file}: module not loaded by the compiler`);
        continue;
      }
      const comparison = compareModule(file, text, record, graph, (path) => files.get(path));
      if (comparison.groupMismatch !== undefined)
        failures.push(`GROUPS ${comparison.groupMismatch}`);
      if (comparison.keyframeMismatch !== undefined) {
        failures.push(`KEYFRAMES ${comparison.keyframeMismatch}`);
      }
    }
    return failures;
  }

  test(`${SEEDS} acyclic (legal) projects: identical group and keyframe symbols`, async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      failures.push(...(await compareProject(generateModuleProject(seed))));
    }
    expect(failures).toEqual([]);
  });

  test("the generated corpus covers styles edges, shadowing and duplicates", async () => {
    let stylesEdges = 0;
    let tokenEdges = 0;
    let repeatedKeyframes = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const project = generateModuleProject(seed);
      for (const text of project.files.values()) {
        for (const line of text.split("\n")) {
          if (!line.startsWith("@use")) continue;
          if (line.includes("styles")) stylesEdges += 1;
          else tokenEdges += 1;
        }
        const names = [...text.matchAll(/@keyframes (spin|fade)/g)].map((match) => match[1]);
        repeatedKeyframes += names.length - new Set(names).size;
      }
    }
    expect(stylesEdges).toBeGreaterThan(10);
    expect(tokenEdges).toBeGreaterThan(10);
    // A repeated name in one module is the first-definition-wins rule.
    expect(repeatedKeyframes).toBeGreaterThan(0);
  });
});

describe("cyclic corpus — recovered visibility matches the compiler", () => {
  // CSSX-T13: a module cycle is already XESSA2001, so recovery only has to be
  // terminating, deterministic and *identical* on both sides. The compiler's
  // answer depends on the module set it is handed, so each analysed document is
  // compared with a graph built from that document as the entry — the same
  // styles closure the editor loads. Measured before the fix: 9 of 100 seeds
  // diverged (TT6 "O1"; seed 15 showed a group the compiler never emits).
  const SEEDS = 100;

  test("every cyclic seed matches the compiler's groups and keyframes", async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const project = generateModuleProject(seed, { cyclic: true });
      for (const file of project.modules) {
        const text = project.files.get(file);
        if (text === undefined) continue;
        const graph = await buildModuleGraph([file], memoryHost(project.files), { file });
        const record = graph.modules.get(file);
        if (record === undefined) {
          failures.push(`seed ${seed} ${file}: module not loaded by the compiler`);
          continue;
        }
        const analysis = analyzeText(
          { text, path: file, version: 1 },
          { readModule: (path) => project.files.get(path) },
        );
        const compiler = render(compilerGroups(record));
        const editor = render(editorGroups(analysis));
        if (compiler !== editor) {
          failures.push(
            `GROUPS seed ${seed} ${file}\n  compiler: ${compiler}\n  editor:   ${editor}`,
          );
        }
        const keyframe = keyframeDivergence(file, record, analysis, graph);
        if (keyframe !== undefined) failures.push(`KEYFRAMES seed ${seed} ${keyframe}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("seed 15 regression: b.cssx reports only the group the compiler emits", async () => {
    // TT6 "O1": the editor listed `panel` from c.cssx, which the compiler never
    // put in b.cssx's view because `a.cssx` (sorted first) cuts the back edge.
    const project = generateModuleProject(15, { cyclic: true });
    const file = "/virtual/b.cssx";
    const text = project.files.get(file);
    expect(text).toBeDefined();
    const graph = await buildModuleGraph([file], memoryHost(project.files), { file });
    const record = graph.modules.get(file);
    expect(record).toBeDefined();
    const analysis = analyzeText(
      { text: text ?? "", path: file, version: 1 },
      { readModule: (path) => project.files.get(path) },
    );
    expect(render(compilerGroups(record as ModuleRecord))).toBe("card=resolved:/virtual/b.cssx");
    expect(render(editorGroups(analysis))).toBe("card=resolved:/virtual/b.cssx");
  });

  async function recovered(seed: number): Promise<string[]> {
    const project = generateModuleProject(seed, { cyclic: true });
    const graph = await buildModuleGraph([...project.modules], memoryHost(project.files), {
      file: project.entry,
    });
    const answers: string[] = [];
    for (const file of project.modules) {
      const text = project.files.get(file);
      if (text === undefined) continue;
      const analysis = analyzeText(
        { text, path: file, version: 1 },
        { readModule: (path) => project.files.get(path) },
      );
      answers.push(`${file} ${render(editorGroups(analysis))}`);
    }
    return answers;
  }

  test("every cyclic project terminates and recovers deterministically", async () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const first = await recovered(seed);
      const second = await recovered(seed);
      expect(second).toEqual(first);
    }
  });

  test("every recovered candidate is a module the compiler loaded", async () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const project = generateModuleProject(seed, { cyclic: true });
      const graph = await buildModuleGraph([...project.modules], memoryHost(project.files), {
        file: project.entry,
      });
      for (const file of project.modules) {
        const text = project.files.get(file);
        if (text === undefined || !graph.modules.has(file)) continue;
        const analysis = analyzeText(
          { text, path: file, version: 1 },
          {
            readModule: (path) => project.files.get(path),
          },
        );
        for (const visibility of analysis.groups) {
          const modules =
            visibility.kind === "resolved"
              ? [visibility.symbol.file]
              : visibility.candidates.map((candidate) => candidate.file);
          for (const module of modules) expect(graph.modules.has(module)).toBe(true);
        }
      }
    }
  });

  test("a diagnosed cycle is reported by the compiler and survives in the editor", async () => {
    // Every module is loaded by the compiler and the cycle is XESSA2001 at the
    // closing `@use`; the editor still resolves a usable document for each one.
    let diagnosed = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const project = generateModuleProject(seed, { cyclic: true });
      const graph = await buildModuleGraph([...project.modules], memoryHost(project.files), {
        file: project.entry,
      });
      diagnosed += graph.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "XESSA2001" && diagnostic.message.startsWith("Import cycle detected"),
      ).length;
    }
    // A back edge only exists when a module reaches one that imports it back, so
    // not every seeded project is cyclic; the point is that the corpus contains
    // many, and that each one is a reported XESSA2001 rather than a hang.
    console.log(
      `[TT6 differential] cyclic corpus: ${diagnosed} cycle diagnostics over ${SEEDS} seeds`,
    );
    expect(diagnosed).toBeGreaterThanOrEqual(10);
    const project = generateModuleProject(1, { cyclic: true });
    for (const file of project.modules) {
      const text = project.files.get(file) ?? "";
      const analysis = analyzeText(
        { text, path: file, version: 1 },
        {
          readModule: (path) => project.files.get(path),
        },
      );
      expect(analysis.lineStarts.length).toBeGreaterThan(0);
    }
  });
});
