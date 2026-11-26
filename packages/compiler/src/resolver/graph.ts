/**
 * Module graph loading, cycle detection and topological ordering.
 *
 * Entry paths are loaded breadth-first so every file is read and parsed exactly
 * once per canonical path. All I/O goes through the injected
 * {@link ModuleHost}; the graph stage is otherwise pure and deterministic.
 */

import { tokenize } from "../lexer/index.js";
import { parseTokens } from "../parser/index.js";
import type { Stylesheet } from "../types/ast.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { CompileOptions, ModuleHost } from "../types/options.js";
import type { Span } from "../types/span.js";
import { collectGroups, visibleGroups } from "./groups.js";
import type { GroupSource } from "./groups.js";
import { collectKeyframes, visibleKeyframes } from "./keyframes.js";
import type { KeyframeSource } from "./keyframes.js";
import { decodeCssString, isWithinWorkspace, normalizePosixPath } from "./paths.js";
import { buildScopes, collectLocalSymbols } from "./scopes.js";
import type { LocalSymbols } from "./scopes.js";
import type { ModuleGraph, ModuleRecord, ResolvedImport, TokenScope } from "./types.js";

/** One successfully parsed module plus its resolved imports. */
interface LoadedModule {
  readonly file: string;
  readonly ast: Stylesheet;
  readonly imports: readonly ResolvedImport[];
}

/**
 * Resolve entries into a validated module graph. Internal counterpart of
 * {@link buildModuleGraph}; kept separate so the facade stays a thin, documented
 * entry point.
 *
 * `options` is accepted for pipeline symmetry and future policy; workspace
 * containment always comes from `host.workspaceRoot()` (ADR-0007), and entries
 * are absolute POSIX paths supplied by the host.
 */
export async function resolveModuleGraph(
  entries: readonly string[],
  host: ModuleHost,
  _options: CompileOptions,
): Promise<ModuleGraph> {
  const diagnostics: Diagnostic[] = [];
  const report = (diagnostic: Diagnostic): void => {
    diagnostics.push(diagnostic);
  };

  const loaded = await loadModules(entries, host, report);
  const cycleMembers = findImportCycles(loaded, report);
  const locals = new Map<string, LocalSymbols>();

  for (const [file, module] of loaded) {
    locals.set(file, collectLocalSymbols(file, module.ast, report));
  }

  const scopes = new Map<
    string,
    { readonly compileScope: TokenScope; readonly runtimeScope: TokenScope }
  >();
  for (const [file, module] of loaded) {
    scopes.set(
      file,
      buildScopes(
        file,
        localsForFile(file, locals),
        module.imports,
        (target) => locals.get(target),
        report,
      ),
    );
  }

  const importers = new Map<string, string[]>();
  for (const [file, module] of loaded) {
    for (const target of dependencyTargets(module.imports)) {
      if (!loaded.has(target)) continue;
      const list = importers.get(target);
      if (list === undefined) importers.set(target, [file]);
      else list.push(file);
    }
  }

  const modules = new Map<string, ModuleRecord>();
  const keyframeSources = new Map<string, KeyframeSource>();
  const groupSources = new Map<string, GroupSource>();
  for (const [file, module] of loaded) {
    const styleDependencies = dependencyTargets(module.imports, "styles").filter((target) =>
      loaded.has(target),
    );
    keyframeSources.set(file, { own: collectKeyframes(module.ast), styleDependencies });
    groupSources.set(file, {
      own: collectGroups(file, module.ast, report),
      styleDependencies,
    });
  }
  const keyframes = visibleKeyframes(keyframeSources);
  const groups = visibleGroups(groupSources);

  for (const [file, module] of loaded) {
    const scope = scopes.get(file);
    if (scope === undefined) continue;
    const importedBy = importers.get(file) ?? [];
    importedBy.sort(comparePaths);
    modules.set(file, {
      file,
      ast: module.ast,
      dependencies: dependencyTargets(module.imports).filter((target) => loaded.has(target)),
      styleDependencies: keyframeSources.get(file)?.styleDependencies ?? [],
      importedBy,
      compileScope: scope.compileScope,
      runtimeScope: scope.runtimeScope,
      keyframes: keyframes.get(file) ?? new Map(),
      groups: groups.get(file) ?? new Map(),
      hasRules: hasTopLevelRules(module.ast),
    });
  }

  return {
    modules,
    order: topologicalOrder(loaded, cycleMembers),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

/**
 * Load entries and their transitive imports breadth-first.
 *
 * `scheduled` prevents duplicate reads; `loaded` is the canonical-path cache
 * required by SPECIFICATION.md §6.1, so each file is tokenized and parsed once
 * even when several modules import it.
 */
async function loadModules(
  entries: readonly string[],
  host: ModuleHost,
  report: (diagnostic: Diagnostic) => void,
): Promise<Map<string, LoadedModule>> {
  const loaded = new Map<string, LoadedModule>();
  const scheduled = new Set<string>();
  const queue: string[] = [];
  const workspaceRoot = normalizePosixPath(host.workspaceRoot());
  const canonicalRoot = normalizePosixPath(host.canonicalize(workspaceRoot));

  const schedule = (file: string): void => {
    if (scheduled.has(file)) return;
    scheduled.add(file);
    queue.push(file);
  };

  for (const entry of entries) {
    schedule(normalizePosixPath(host.canonicalize(normalizePosixPath(entry))));
  }

  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (file === undefined || loaded.has(file)) continue;

    const exists = await host.fileExists(file);
    if (!exists) {
      report(
        error("XESSA2001", `Cannot load module "${file}": file not found.`, {
          start: 0,
          end: 0,
          file,
        }),
      );
      continue;
    }

    let source: string;
    try {
      source = await host.readFile(file);
    } catch {
      report(
        error("XESSA2001", `Cannot read module "${file}".`, {
          start: 0,
          end: 0,
          file,
        }),
      );
      continue;
    }

    const lexed = tokenize(source, file);
    const parsed = parseTokens(lexed.tokens, file);
    for (const diagnostic of lexed.diagnostics) report(diagnostic);
    for (const diagnostic of parsed.diagnostics) report(diagnostic);

    const imports: ResolvedImport[] = [];
    for (const item of parsed.ast.items) {
      if (item.kind !== "use") continue;
      imports.push(await resolveImport(item, file, host, workspaceRoot, canonicalRoot, report));
    }

    loaded.set(file, { file, ast: parsed.ast, imports });
    for (const imported of imports) {
      if (imported.target !== undefined) schedule(imported.target);
    }
  }

  return loaded;
}

/**
 * Resolve one `@use` statement relative to its importer.
 *
 * Order matters for clear diagnostics: decode the CSS string, reject lexical
 * workspace escapes before touching existence, canonicalize (host symlink
 * policy), reject canonical escapes, then test existence. Failures yield
 * XESSA2001 at the `@use` statement and no edge, so downstream passes never see
 * a half-resolved dependency.
 */
async function resolveImport(
  item: ResolvedImport["item"],
  importer: string,
  host: ModuleHost,
  workspaceRoot: string,
  canonicalRoot: string,
  report: (diagnostic: Diagnostic) => void,
): Promise<ResolvedImport> {
  const specifier = decodeCssString(item.path);
  const styles = item.styles === true;

  if (specifier.trim() === "") {
    report(error("XESSA2001", `@use specifier is empty in "${importer}".`, item.span));
    return { item, specifier, styles };
  }

  const lexical = normalizePosixPath(host.resolvePath(importer, specifier));
  if (!isWithinWorkspace(workspaceRoot, lexical)) {
    report(
      error(
        "XESSA2001",
        `Import "${specifier}" resolves outside the workspace root "${workspaceRoot}": "${lexical}".`,
        item.span,
      ),
    );
    return { item, specifier, styles };
  }

  const canonical = normalizePosixPath(host.canonicalize(lexical));
  if (!isWithinWorkspace(canonicalRoot, canonical)) {
    report(
      error(
        "XESSA2001",
        `Import "${specifier}" escapes the workspace root through "${lexical}" -> "${canonical}".`,
        item.span,
      ),
    );
    return { item, specifier, styles };
  }

  const exists = await host.fileExists(canonical);
  if (!exists) {
    report(
      error(
        "XESSA2001",
        `Import "${specifier}" cannot be resolved: "${canonical}" does not exist.`,
        item.span,
      ),
    );
    return { item, specifier, styles };
  }

  return { item, specifier, target: canonical, styles };
}

/**
 * Detect import cycles (including self-imports) with a depth-first search over
 * the canonical dependency edges.
 *
 * Returns every module that participates in at least one cycle. One XESSA2001
 * is reported per distinct cycle at the `@use` statement that closes it, with
 * the rotation-stabilized path in the message. Modules stay in the graph so
 * tooling can recover; the topological order excludes them separately.
 */
function findImportCycles(
  loaded: Map<string, LoadedModule>,
  report: (diagnostic: Diagnostic) => void,
): Set<string> {
  const colours = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const members = new Set<string>();

  const recordCycle = (from: string, target: string): void => {
    const start = stack.indexOf(target);
    if (start < 0) return;
    const path = stack.slice(start);
    const rotated = rotateToSmallest(path);
    const key = rotated.join("\u0000");
    if (seenCycles.has(key)) return;
    seenCycles.add(key);
    for (const member of rotated) members.add(member);

    const display = [...rotated, rotated[0] ?? target].join(" -> ");
    report(
      error("XESSA2001", `Import cycle detected: ${display}.`, cycleEdgeSpan(loaded, from, target)),
    );
  };

  const visit = (node: string): void => {
    colours.set(node, 1);
    stack.push(node);

    const module = loaded.get(node);
    const dependencies =
      module === undefined ? [] : dependencyTargets(module.imports).sort(comparePaths);
    for (const dependency of dependencies) {
      if (!loaded.has(dependency)) continue;
      const colour = colours.get(dependency);
      if (colour === undefined) visit(dependency);
      else if (colour === 1) recordCycle(node, dependency);
    }

    stack.pop();
    colours.set(node, 2);
  };

  for (const file of [...loaded.keys()].sort(comparePaths)) {
    if (!colours.has(file)) visit(file);
  }

  return members;
}

/**
 * Deterministic topological order using Kahn's algorithm.
 *
 * Dependencies are emitted before importers; among ready modules the smallest
 * canonical path wins, so ties are stable across runs and platforms. Edges into
 * cycle members are ignored because those modules are excluded from the order.
 */
function topologicalOrder(loaded: Map<string, LoadedModule>, excluded: Set<string>): string[] {
  const nodes = [...loaded.keys()].filter((file) => !excluded.has(file)).sort(comparePaths);
  const indegree = new Map<string, number>();
  const importers = new Map<string, string[]>();

  for (const node of nodes) {
    const module = loaded.get(node);
    const dependencies =
      module === undefined
        ? []
        : dependencyTargets(module.imports).filter(
            (target) => !excluded.has(target) && loaded.has(target),
          );
    indegree.set(node, dependencies.length);
    for (const dependency of dependencies) {
      const list = importers.get(dependency);
      if (list === undefined) importers.set(dependency, [node]);
      else list.push(node);
    }
  }

  const ready = nodes.filter((node) => (indegree.get(node) ?? 0) === 0);
  const order: string[] = [];

  while (ready.length > 0) {
    const node = ready.shift();
    if (node === undefined) break;
    order.push(node);

    const list = importers.get(node);
    if (list === undefined) continue;
    for (const importer of list) {
      const remaining = (indegree.get(importer) ?? 0) - 1;
      indegree.set(importer, remaining);
      if (remaining === 0) insertSorted(ready, importer);
    }
  }

  if (order.length < nodes.length) {
    for (const node of nodes) {
      if (!order.includes(node)) order.push(node);
    }
  }

  return order;
}

/** Distinct canonical targets in authored `@use` order, optionally only style edges. */
function dependencyTargets(imports: readonly ResolvedImport[], mode?: "styles"): string[] {
  const targets = new Set<string>();
  for (const imported of imports) {
    if (mode === "styles" && !imported.styles) continue;
    if (imported.target !== undefined) targets.add(imported.target);
  }
  return [...targets];
}

/** Span of the first `@use` in `from` that targets `target`. */
function cycleEdgeSpan(loaded: Map<string, LoadedModule>, from: string, target: string): Span {
  const module = loaded.get(from);
  if (module !== undefined) {
    for (const imported of module.imports) {
      if (imported.target === target) return imported.item.span;
    }
  }
  return { start: 0, end: 0, file: from };
}

/** Rotate a cycle path so the smallest canonical path comes first. */
function rotateToSmallest(path: readonly string[]): string[] {
  let best = 0;
  for (let index = 1; index < path.length; index += 1) {
    const candidate = path[index];
    const current = path[best];
    if (candidate !== undefined && current !== undefined && comparePaths(candidate, current) < 0) {
      best = index;
    }
  }
  return [...path.slice(best), ...path.slice(0, best)];
}

/** Whether the module contributes any stylesheet output of its own. */
function hasTopLevelRules(ast: Stylesheet): boolean {
  return ast.items.some((item) => item.kind === "rule" || item.kind === "native-at-rule");
}

/** First-defined local symbols for a loaded module. */
function localsForFile(file: string, locals: ReadonlyMap<string, LocalSymbols>): LocalSymbols {
  const symbols = locals.get(file);
  if (symbols !== undefined) return symbols;
  return { compile: new Map(), runtime: new Map() };
}

/** Insert into a sorted string array without changing deterministic order. */
function insertSorted(list: string[], value: string): void {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = list[middle];
    if (current !== undefined && comparePaths(current, value) < 0) low = middle + 1;
    else high = middle;
  }
  list.splice(low, 0, value);
}

/** Stable diagnostic order: file, offset, code, message, then input order. */
function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((left, right) => {
      const byFile = comparePaths(left.diagnostic.span.file, right.diagnostic.span.file);
      if (byFile !== 0) return byFile;
      const byStart = left.diagnostic.span.start - right.diagnostic.span.start;
      if (byStart !== 0) return byStart;
      const byEnd = left.diagnostic.span.end - right.diagnostic.span.end;
      if (byEnd !== 0) return byEnd;
      const byCode = comparePaths(left.diagnostic.code, right.diagnostic.code);
      if (byCode !== 0) return byCode;
      const byMessage = comparePaths(left.diagnostic.message, right.diagnostic.message);
      if (byMessage !== 0) return byMessage;
      return left.index - right.index;
    })
    .map((entry) => entry.diagnostic);
}

/** Locale-independent string comparison. */
function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
