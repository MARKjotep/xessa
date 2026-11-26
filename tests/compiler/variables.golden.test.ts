import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { buildModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import type { ModuleGraph } from "../../packages/compiler/src/resolver/index.ts";
import { flattenIr } from "../../packages/compiler/src/selectors/index.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";
import type { CompileOptions, ModuleHost } from "../../packages/compiler/src/types/options.ts";
import { emitRuntimeTokens, substitute } from "../../packages/compiler/src/variables/index.ts";

/**
 * Golden CSS for the deferred `$`-reference fixtures (A08) plus the A09 class
 * rewrite.
 *
 * Chain, exactly as consumed by the compiler host:
 *
 * ```text
 * parse (inside buildModuleGraph) → lower → substitute → emitRuntimeTokens
 *   → renameClasses → groupRuns("safe") → flattenIr → emitCss(pretty)
 * ```
 *
 * A06 owns flattening and emission; this test only consumes
 * `flattenIr`/`emitCss` read-only. Class selectors use the file `prefix`
 * (A09, SPECIFICATION.md §7.2), while `--<prefix>-<name>` runtime properties use
 * the same prefix because that naming rule is A08's (§6.2). Setup resolution is
 * P4/P5, so the prefix is read here with a tiny test-only helper.
 *
 * Fixtures whose only correct output is empty CSS (`variables/undefined-ref`,
 * `variables/cycle`) have an empty `expected/css`: unlike A06's plain fixtures
 * they are not error-sentinel cases, they genuinely emit nothing because the
 * only declaration was rejected and the empty rule was pruned.
 */

const WORKSPACE = "/workspace";
const FIXTURES = join(import.meta.dir, "..", "fixtures");

function createHost(files: Readonly<Record<string, string>>): ModuleHost {
  const map = new Map(Object.entries(files));
  return {
    async readFile(path: string): Promise<string> {
      const content = map.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return map.has(path);
    },
    canonicalize(path: string): string {
      return path;
    },
    resolvePath(from: string, to: string): string {
      return posix.resolve(posix.dirname(from), to);
    },
    workspaceRoot(): string {
      return WORKSPACE;
    },
  };
}

function fixtureFiles(group: string, name: string): Record<string, string> {
  const directory = join(FIXTURES, group, name);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".cssx")) continue;
    files[`${WORKSPACE}/${group}/${name}/${entry}`] = readFileSync(join(directory, entry), "utf8");
  }
  return files;
}

/** Test-only `@setup { prefix: ... }` reader (setup resolution is P4/P5). */
function setupPrefix(ast: Stylesheet): string {
  let prefix = "";
  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      if (setting.key !== "prefix") continue;
      const raw = setting.value.trim();
      prefix = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }
  return prefix;
}

interface Chain {
  readonly css: string;
  readonly diagnostics: readonly string[];
  readonly emitterDiagnostics: readonly string[];
}

async function runChain(group: string, name: string): Promise<Chain> {
  const entry = `${WORKSPACE}/${group}/${name}/input.cssx`;
  const graph: ModuleGraph = await buildModuleGraph(
    [entry],
    createHost(fixtureFiles(group, name)),
    {
      file: entry,
    } as CompileOptions,
  );
  const record = graph.modules.get(entry);
  if (record === undefined) throw new Error(`fixture entry not loaded: ${entry}`);
  const prefix = setupPrefix(record.ast);
  const lowered = lower(record.ast, { file: entry } as CompileOptions);
  const substituted = substitute(lowered.ir, graph, entry, { prefix });
  const runtime = emitRuntimeTokens(substituted.ir, graph, entry, { prefix });
  const renamed = renameClasses(runtime.ir, { prefix });
  const grouped = groupRuns(renamed.ir, "safe");
  const flattened = flattenIr(grouped);
  const emitted = emitCss(flattened.ir, { minify: false });
  return {
    css: emitted.css,
    diagnostics: [
      ...graph.diagnostics,
      ...lowered.diagnostics,
      ...substituted.diagnostics,
      ...runtime.diagnostics,
      ...renamed.diagnostics,
    ].map((diagnostic) => diagnostic.code),
    emitterDiagnostics: [...flattened.diagnostics, ...emitted.diagnostics].map(
      (diagnostic) => diagnostic.code,
    ),
  };
}

interface GoldenCase {
  readonly group: string;
  readonly name: string;
  /** Expected diagnostic codes from graph + lowering + substitution + runtime. */
  readonly diagnostics: readonly string[];
}

const CASES: readonly GoldenCase[] = [
  { group: "variables", name: "basic", diagnostics: [] },
  { group: "variables", name: "local-overrides-imported", diagnostics: [] },
  { group: "variables", name: "namespaced-members", diagnostics: [] },
  { group: "variables", name: "undefined-ref", diagnostics: ["XESSA2001"] },
  { group: "variables", name: "cycle", diagnostics: ["XESSA2001", "XESSA2001"] },
  { group: "variables", name: "ambiguous-import", diagnostics: ["XESSA2001"] },
  { group: "variables", name: "duplicate-local", diagnostics: ["XESSA2001"] },
  { group: "variables", name: "local-overrides-ambiguous-import", diagnostics: [] },
  { group: "keyframes", name: "same-file", diagnostics: [] },
  { group: "keyframes", name: "unknown-member", diagnostics: ["XESSA2001"] },
  { group: "keyframes", name: "bare-namespace", diagnostics: ["XESSA2001"] },
  { group: "canonical", name: "button", diagnostics: [] },
  { group: "runtime", name: "basic", diagnostics: [] },
  { group: "runtime", name: "with-variant", diagnostics: [] },
  { group: "runtime", name: "collision-with-compile-time", diagnostics: ["XESSA2001"] },
];

describe("variables: deferred $ reference goldens", () => {
  for (const golden of CASES) {
    test(`${golden.group}/${golden.name} matches expected/css`, async () => {
      const chain = await runChain(golden.group, golden.name);
      const expected = readFileSync(
        join(FIXTURES, golden.group, golden.name, "expected", "css"),
        "utf8",
      );
      expect(chain.css).toBe(expected);
      expect(chain.diagnostics).toEqual(golden.diagnostics);
      expect(chain.emitterDiagnostics).toEqual([]);
    });
  }

  test("goldens are byte-identical across repeated runs", async () => {
    for (const golden of CASES) {
      const first = await runChain(golden.group, golden.name);
      const second = await runChain(golden.group, golden.name);
      expect(second.css).toBe(first.css);
      expect(second.diagnostics).toEqual(first.diagnostics);
    }
  });

  test("canonical/button prefixes class selectors and keeps the media cascade order", async () => {
    const chain = await runChain("canonical", "button");

    expect(chain.css).toContain(".ui-button {");
    expect(chain.css).toContain(".ui-button > .ui-icon {");
    // Adjacent runs with the same selector must not be reordered: the md/xl
    // padding runs stay between the first and second `.ui-button` blocks (§5.1).
    const firstBlock = chain.css.indexOf(".ui-button {");
    const mdBlock = chain.css.indexOf("@media (min-width: 768px)");
    const secondBlock = chain.css.indexOf(".ui-button {", firstBlock + 1);
    expect(firstBlock).toBeLessThan(mdBlock);
    expect(mdBlock).toBeLessThan(secondBlock);
  });
});
