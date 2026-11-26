/**
 * `@group.<name>` visibility for the editor (ADR-0017 item 4/5).
 *
 * This module mirrors the compiler's `resolver/groups.ts` rule exactly without
 * importing resolver internals (the public barrel does not export them):
 *
 * - a module sees its own top-level definitions first, then the definitions of
 *   every module reached through `@use "…" styles;` transitively in authored
 *   order; token-only imports expose no groups;
 * - a local definition shadows imported definitions of the same name;
 * - two imported definitions with no local one are ambiguous;
 * - the first definition of a name inside one module wins.
 *
 * It also collects every use site of the reachable modules and attributes it to
 * the definition its own module's view resolves to, so hover and rename work
 * from actual scope resolution instead of text patterns. Nothing here imports
 * `vscode` or changes compiler behaviour.
 */

import { parse } from "../../compiler/src/index.js";
import type { GroupDefinition, Stylesheet } from "../../compiler/src/index.js";
import { dirnamePath, joinPath, normalizePath } from "./paths.js";
import { type Range, computeLineStarts, rangeAt } from "./positions.js";

/** Authored prefix of every group construct (`@group.card`). */
export const GROUP_KEYWORD = "@group.";

/** One default declaration of a `@group.<name>` definition. */
export interface GroupDefault {
  /** Property name exactly as authored. */
  readonly property: string;
  /** Raw base value exactly as authored (`$pad` is not resolved here). */
  readonly value: string;
  /** Property name range in the defining module. */
  readonly range: Range;
}

/** One `@group.<name>` use site attributed to a resolved definition. */
export interface GroupReference {
  /** Module that authored the use site (absolute path or root span label). */
  readonly file: string;
  /** Name only range (`card` in `@group.card`). */
  readonly name: Range;
  /** Whole `@group.card` keyword range. */
  readonly keyword: Range;
}

/** One group definition as the editor resolves it. */
export interface GroupSymbol {
  /** Group name without the `@group.` prefix, matched exactly and case-sensitively. */
  readonly name: string;
  /** Defining module path. */
  readonly file: string;
  /** Name range in the defining module (the rename edit target). */
  readonly declaration: Range;
  /** Whole `@group.<name>` keyword range in the defining module. */
  readonly keyword: Range;
  /** Default declarations in authored order. */
  readonly defaults: readonly GroupDefault[];
  /** Use sites whose own module resolves this name to this definition. */
  readonly references: readonly GroupReference[];
}

/** How one group name resolves from the analyzed document's point of view. */
export type GroupVisibility =
  | { readonly kind: "resolved"; readonly name: string; readonly symbol: GroupSymbol }
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      /** Distinct visible definitions in traversal order. */
      readonly candidates: readonly GroupSymbol[];
    };

/** Parsed root inputs for {@link collectGroupVisibility}. */
export interface GroupRootInput {
  /** Module identity: the absolute document path when available. */
  readonly file: string;
  readonly ast: Stylesheet;
  readonly lineStarts: readonly number[];
}

/** Mutable internal shape: references are filled after all scopes are known. */
interface MutableGroupSymbol {
  readonly name: string;
  readonly file: string;
  readonly declaration: Range;
  readonly keyword: Range;
  readonly defaults: readonly GroupDefault[];
  readonly references: GroupReference[];
}

interface UseSiteRef {
  readonly name: string;
  readonly nameRange: Range;
  readonly keywordRange: Range;
}

/** Internal resolution shape used while use-site references are still collected. */
type MutableGroupVisibility =
  | { readonly kind: "resolved"; readonly name: string; readonly symbol: MutableGroupSymbol }
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      readonly candidates: readonly MutableGroupSymbol[];
    };

interface ModuleSource {
  readonly file: string;
  readonly own: ReadonlyMap<string, MutableGroupSymbol>;
  readonly styleDependencies: readonly string[];
  readonly useSites: readonly UseSiteRef[];
}

/** Minimal structural view of AST nodes the resolver walks. */
interface GroupNode {
  readonly kind?: string;
  readonly name?: string;
  readonly path?: string;
  readonly styles?: boolean;
  readonly span?: { readonly start: number; readonly end: number };
  readonly body?: readonly GroupNode[];
  readonly block?: readonly GroupNode[];
}

/**
 * Resolve the document's visible groups and every reachable use site.
 *
 * `readModule` is the same sync reader the analysis layer uses for imported
 * tokens; a missing or unreadable module contributes no groups (the compiler
 * already reports the broken import). Results are independent of call order and
 * safe under `styles` cycles: a back edge contributes nothing.
 */
export function collectGroupVisibility(
  root: GroupRootInput,
  readModule?: (absolutePath: string) => string | undefined,
): readonly GroupVisibility[] {
  const modules = new Map<string, ModuleSource>();
  const rootFile = normalizePath(root.file);

  const load = (file: string, ast: Stylesheet, lineStarts: readonly number[]): ModuleSource => {
    const source = moduleSourceOf(file, ast, lineStarts);
    modules.set(file, source);
    for (const dependency of source.styleDependencies) {
      if (modules.has(dependency)) continue;
      let text: string | undefined;
      try {
        text = readModule?.(dependency);
      } catch {
        text = undefined;
      }
      if (text === undefined) continue;
      const parsed = parse(text, { file: dependency });
      load(dependency, parsed.ast, computeLineStarts(text));
    }
    return source;
  };

  load(rootFile, root.ast, root.lineStarts);

  const closureMemo = new Map<string, Map<string, MutableGroupSymbol[]>>();
  const closure = (file: string, visiting: Set<string>): Map<string, MutableGroupSymbol[]> => {
    const cached = closureMemo.get(file);
    if (cached !== undefined) return cached;
    const source = modules.get(file);
    if (source === undefined) return new Map();
    // A back edge in a cycle contributes nothing, mirroring the compiler.
    if (visiting.has(file)) return new Map();
    visiting.add(file);

    const visible = new Map<string, MutableGroupSymbol[]>();
    for (const [name, symbol] of source.own) visible.set(name, [symbol]);
    for (const dependency of source.styleDependencies) {
      for (const [name, symbols] of closure(dependency, visiting)) {
        const merged = visible.get(name) ?? [];
        for (const symbol of symbols) {
          if (merged.some((existing) => existing.file === symbol.file)) continue;
          merged.push(symbol);
        }
        if (merged.length > 0) visible.set(name, merged);
      }
    }

    visiting.delete(file);
    closureMemo.set(file, visible);
    return visible;
  };

  // Resolve every loaded module's closure in sorted canonical-path order before
  // any scope is read. The compiler's `visibleGroups` visits its sources in
  // sorted order with one shared memo, so inside a cycle the *first* file that
  // hits the back edge decides which partial closure is memoized. Computing
  // lazily in document-load order would memoize a different partial result and
  // show groups the compiler will not emit (CSSX-T13).
  for (const file of [...modules.keys()].sort(comparePaths)) closure(file, new Set());

  const scopeMemo = new Map<string, Map<string, MutableGroupVisibility>>();
  const scopeOf = (file: string): Map<string, MutableGroupVisibility> => {
    const cached = scopeMemo.get(file);
    if (cached !== undefined) return cached;
    const scope = new Map<string, MutableGroupVisibility>();
    for (const [name, symbols] of closure(file, new Set())) {
      const first = symbols[0];
      if (first === undefined) continue;
      // Own definitions come first, so `first.file === file` means a local
      // definition shadows every imported definition of that name.
      if (symbols.length === 1 || first.file === file) {
        scope.set(name, { kind: "resolved", name, symbol: first });
        continue;
      }
      scope.set(name, { kind: "ambiguous", name, candidates: symbols });
    }
    scopeMemo.set(file, scope);
    return scope;
  };

  // Attribute every reachable use site to the definition its module resolves.
  for (const file of modules.keys()) {
    const scope = scopeOf(file);
    const source = modules.get(file);
    if (source === undefined) continue;
    for (const site of source.useSites) {
      const resolution = scope.get(site.name);
      if (resolution === undefined || resolution.kind !== "resolved") continue;
      resolution.symbol.references.push({
        file,
        name: site.nameRange,
        keyword: site.keywordRange,
      });
    }
  }

  return [...scopeOf(rootFile).values()];
}

/** Build one module's authored definitions, styles edges and use sites. */
function moduleSourceOf(
  file: string,
  ast: Stylesheet,
  lineStarts: readonly number[],
): ModuleSource {
  const own = new Map<string, MutableGroupSymbol>();
  const styleDependencies: string[] = [];
  const useSites: UseSiteRef[] = [];

  for (const raw of ast.items) {
    const item = raw as unknown as GroupNode;
    if (item.kind === "group-definition" && isDefinition(raw)) {
      // Duplicate names keep the first definition (the compiler reports the
      // later one); the editor never invents a second target.
      if (!own.has(raw.name)) own.set(raw.name, symbolOf(raw, lineStarts, file));
      continue;
    }
    if (item.kind === "use" && item.styles === true && item.path !== undefined) {
      styleDependencies.push(joinPath(dirnamePath(file), item.path));
    }
  }

  walkUseSites(ast.items, (node) => {
    const start = (node.span?.start ?? 0) + GROUP_KEYWORD.length;
    const nameEnd = start + (node.name?.length ?? 0);
    useSites.push({
      name: node.name ?? "",
      nameRange: rangeAt(lineStarts, start, nameEnd),
      keywordRange: rangeAt(lineStarts, node.span?.start ?? 0, nameEnd),
    });
  });

  return { file, own, styleDependencies, useSites };
}

function isDefinition(raw: unknown): raw is GroupDefinition {
  const candidate = raw as Partial<GroupDefinition>;
  return (
    candidate.kind === "group-definition" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.declarations)
  );
}

/** One definition node → editor symbol, with name/keyword and default ranges. */
function symbolOf(
  definition: GroupDefinition,
  lineStarts: readonly number[],
  file: string,
): MutableGroupSymbol {
  const nameStart = definition.span.start + GROUP_KEYWORD.length;
  const nameEnd = nameStart + definition.name.length;
  return {
    name: definition.name,
    file,
    declaration: rangeAt(lineStarts, nameStart, nameEnd),
    keyword: rangeAt(lineStarts, definition.span.start, nameEnd),
    defaults: definition.declarations.map((declaration) => ({
      property: declaration.property,
      value: declaration.value,
      range: rangeAt(
        lineStarts,
        declaration.span.start,
        declaration.span.start + declaration.property.length,
      ),
    })),
    references: [],
  };
}

/** Locale-independent path comparison, matching the compiler's `comparePaths`. */
function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Visit every `@group.<name>` use site inside rule, conditional and native blocks. */
function walkUseSites(
  items: readonly unknown[],
  visit: (node: {
    readonly name: string;
    readonly span: { readonly start: number; readonly end: number };
  }) => void,
): void {
  for (const raw of items) {
    const node = raw as GroupNode;
    if (node.kind === "group-use-site" && node.name !== undefined && node.span !== undefined) {
      visit({ name: node.name, span: node.span });
      continue;
    }
    if (node.kind === "rule" || node.kind === "conditional-block") {
      if (node.body !== undefined) walkUseSites(node.body, visit);
      continue;
    }
    if (node.kind === "native-at-rule" && node.block !== undefined) {
      walkUseSites(node.block, visit);
    }
  }
}
