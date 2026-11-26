/**
 * `$keyframes.<name>` visibility for the editor (ADR-0015).
 *
 * The compiler's `resolver/keyframes.ts` is not exported through the public
 * barrel, so this module mirrors its rule from the document AST and the same
 * synchronous `readModule` host the rest of the analysis layer uses:
 *
 * - only a top-level `@keyframes` block whose prelude is a single plain
 *   identifier registers a member (ASCII case-insensitive at-rule name,
 *   first definition of a name inside one module wins);
 * - a module sees its own names first, then the names of every module reached
 *   through `@use "…" styles;` transitively in authored order; token-only
 *   imports expose nothing (their CSS is never emitted);
 * - a local definition shadows imported definitions of the same name;
 * - two imported definitions with no local one are ambiguous for rename;
 * - duplicate names across merged modules are valid authored CSS and produce no
 *   diagnostic, so completion lists every visible definition.
 *
 * It also attributes every reachable `$keyframes.<name>` reference and every
 * exact `animation-name: <name>` declaration to the definition its own module
 * resolves to, so hover and rename work from actual scope resolution instead of
 * text patterns. Nothing here imports `vscode` or changes compiler behaviour.
 */

import { parse } from "../../compiler/src/index.js";
import type { Declaration, NativeAtRule, Stylesheet, Token } from "../../compiler/src/index.js";
import { dirnamePath, joinPath, normalizePath } from "./paths.js";
import { type Range, computeLineStarts, rangeAt } from "./positions.js";

/** Built-in namespace alias that exposes visible keyframe names (ADR-0015). */
export const KEYFRAMES_NAMESPACE = "keyframes";

/** Authored reference prefix of every keyframe member (`$keyframes.`). */
export const KEYFRAMES_KEYWORD = "$keyframes.";

/**
 * A prelude the compiler registers as a `$keyframes.<member>` target.
 *
 * Mirrors `resolver/keyframes.ts`: a single plain identifier. String-named,
 * escaped and multi-token preludes stay native CSS and are not addressable.
 */
const PLAIN_KEYFRAMES_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

/** One `$keyframes.<name>` use site attributed to a resolved definition. */
export interface KeyframeReference {
  /** Module that authored the reference (absolute path or root span label). */
  readonly file: string;
  /** Name only range (`spin` in `$keyframes.spin`). */
  readonly name: Range;
  /** Whole `$keyframes.spin` range. */
  readonly keyword: Range;
}

/** One exact `animation-name: <name>` declaration attributed to a definition. */
export interface AnimationNameReference {
  /** Module that authored the declaration. */
  readonly file: string;
  /** Range of the whole authored value (`spin`). */
  readonly value: Range;
}

/** One keyframe definition as the editor resolves it. */
export interface KeyframeSymbol {
  /** Keyframe name without the `$keyframes.` prefix, matched exactly. */
  readonly name: string;
  /** Defining module path. */
  readonly file: string;
  /** Name range in the defining module (the rename edit target). */
  readonly declaration: Range;
  /** Authored frame selectors (`from`, `to`, `50%`) in first-seen order. */
  readonly frames: readonly string[];
  /** `$keyframes.<name>` references whose own module resolves to this definition. */
  readonly references: readonly KeyframeReference[];
  /** Exact `animation-name: <name>` values whose own module resolves here. */
  readonly animationNames: readonly AnimationNameReference[];
}

/** How one keyframe name resolves from the analyzed document's point of view. */
export type KeyframeVisibility =
  | {
      readonly kind: "resolved";
      readonly name: string;
      readonly symbol: KeyframeSymbol;
      /**
       * Other visible definitions of the same name that `symbol` shadows
       * (a local definition shadows imports). Empty for a unique name.
       */
      readonly duplicates: readonly KeyframeSymbol[];
    }
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      /** Distinct visible definitions in traversal order. */
      readonly candidates: readonly KeyframeSymbol[];
    };

/** Parsed root inputs for {@link collectKeyframeVisibility}. */
export interface KeyframeRootInput {
  /** Module identity: the absolute document path when available. */
  readonly file: string;
  readonly ast: Stylesheet;
  readonly text: string;
  readonly lineStarts: readonly number[];
}

/** Mutable internal shape: references are filled after all scopes are known. */
interface MutableKeyframeSymbol {
  readonly name: string;
  readonly file: string;
  readonly declaration: Range;
  readonly frames: readonly string[];
  readonly references: KeyframeReference[];
  readonly animationNames: AnimationNameReference[];
}

interface ReferenceSite {
  readonly name: string;
  readonly nameRange: Range;
  readonly keywordRange: Range;
}

interface AnimationNameSite {
  readonly name: string;
  readonly value: Range;
}

/** Internal resolution shape used while references are still being collected. */
type MutableKeyframeVisibility =
  | {
      readonly kind: "resolved";
      readonly name: string;
      readonly symbol: MutableKeyframeSymbol;
      readonly duplicates: readonly MutableKeyframeSymbol[];
    }
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      readonly candidates: readonly MutableKeyframeSymbol[];
    };

interface ModuleSource {
  readonly file: string;
  readonly own: ReadonlyMap<string, MutableKeyframeSymbol>;
  readonly styleDependencies: readonly string[];
  readonly references: readonly ReferenceSite[];
  readonly animationNames: readonly AnimationNameSite[];
}

/** Minimal structural view of AST nodes the resolver walks. */
interface NodeLike {
  readonly kind?: string;
  readonly name?: string;
  readonly path?: string;
  readonly styles?: boolean;
  readonly span?: { readonly start: number; readonly end: number };
  readonly body?: readonly unknown[];
  readonly block?: readonly unknown[];
  readonly declarations?: readonly unknown[];
}

/**
 * Resolve the document's visible keyframe names and every reachable reference.
 *
 * `readModule` is the same sync reader the analysis layer uses for imported
 * tokens; a missing or unreadable module contributes no keyframes (the compiler
 * already reports the broken import). Results are independent of call order and
 * safe under `styles` cycles: a back edge contributes nothing.
 */
export function collectKeyframeVisibility(
  root: KeyframeRootInput,
  readModule?: (absolutePath: string) => string | undefined,
): readonly KeyframeVisibility[] {
  const modules = new Map<string, ModuleSource>();
  const rootFile = normalizePath(root.file);

  const load = (
    file: string,
    ast: Stylesheet,
    text: string,
    lineStarts: readonly number[],
  ): ModuleSource => {
    const source = moduleSourceOf(file, ast, text, lineStarts);
    modules.set(file, source);
    for (const dependency of source.styleDependencies) {
      if (modules.has(dependency)) continue;
      let dependencyText: string | undefined;
      try {
        dependencyText = readModule?.(dependency);
      } catch {
        dependencyText = undefined;
      }
      if (dependencyText === undefined) continue;
      const parsed = parse(dependencyText, { file: dependency });
      load(dependency, parsed.ast, dependencyText, computeLineStarts(dependencyText));
    }
    return source;
  };

  load(rootFile, root.ast, root.text, root.lineStarts);

  const closureMemo = new Map<string, Map<string, MutableKeyframeSymbol[]>>();
  const closure = (file: string, visiting: Set<string>): Map<string, MutableKeyframeSymbol[]> => {
    const cached = closureMemo.get(file);
    if (cached !== undefined) return cached;
    const source = modules.get(file);
    if (source === undefined) return new Map();
    // A back edge in a cycle contributes nothing, mirroring the compiler.
    if (visiting.has(file)) return new Map();
    visiting.add(file);

    const visible = new Map<string, MutableKeyframeSymbol[]>();
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
  // any scope is read. The compiler's `visibleKeyframes` visits its sources in
  // sorted order with one shared memo, so inside a cycle the *first* file that
  // hits the back edge decides which partial closure is memoized. Computing
  // lazily in document-load order would memoize a different partial result and
  // show names the compiler will not emit (CSSX-T13).
  for (const file of [...modules.keys()].sort(comparePaths)) closure(file, new Set());

  const scopeMemo = new Map<string, Map<string, MutableKeyframeVisibility>>();
  const scopeOf = (file: string): Map<string, MutableKeyframeVisibility> => {
    const cached = scopeMemo.get(file);
    if (cached !== undefined) return cached;
    const scope = new Map<string, MutableKeyframeVisibility>();
    for (const [name, symbols] of closure(file, new Set())) {
      const first = symbols[0];
      if (first === undefined) continue;
      // Own definitions come first, so `first.file === file` means a local
      // definition shadows every imported definition of that name.
      if (symbols.length === 1 || first.file === file) {
        scope.set(name, {
          kind: "resolved",
          name,
          symbol: first,
          duplicates: symbols.filter((symbol) => symbol !== first),
        });
        continue;
      }
      scope.set(name, { kind: "ambiguous", name, candidates: symbols });
    }
    scopeMemo.set(file, scope);
    return scope;
  };

  // Attribute every reachable reference and exact animation-name value to the
  // definition its own module resolves.
  for (const file of modules.keys()) {
    const scope = scopeOf(file);
    const source = modules.get(file);
    if (source === undefined) continue;
    for (const site of source.references) {
      const resolution = scope.get(site.name);
      if (resolution === undefined || resolution.kind !== "resolved") continue;
      resolution.symbol.references.push({
        file,
        name: site.nameRange,
        keyword: site.keywordRange,
      });
    }
    for (const site of source.animationNames) {
      const resolution = scope.get(site.name);
      if (resolution === undefined || resolution.kind !== "resolved") continue;
      resolution.symbol.animationNames.push({ file, value: site.value });
    }
  }

  return [...scopeOf(rootFile).values()];
}

/**
 * Plain-identifier keyframe definition name and its exact authored range.
 *
 * Returns `undefined` for other native at-rules and for preludes the compiler
 * does not register (strings, escapes, multiple tokens, empty).
 */
export function keyframeDefinitionAt(
  atRule: NativeAtRule,
  text: string,
  lineStarts: readonly number[],
):
  | { readonly name: string; readonly range: Range; readonly frames: readonly string[] }
  | undefined {
  if (atRule.name.toLowerCase() !== KEYFRAMES_NAMESPACE) return undefined;
  const name = atRule.prelude.trim();
  if (!PLAIN_KEYFRAMES_NAME.test(name)) return undefined;
  const from = atRule.span.start + 1 + atRule.name.length;
  const located = text.indexOf(name, from);
  const start = located >= 0 && located < atRule.span.end ? located : from;
  return {
    name,
    range: rangeAt(lineStarts, start, start + name.length),
    frames: framesOf(atRule),
  };
}

/** Build one module's definitions, styles edges, references and exact values. */
function moduleSourceOf(
  file: string,
  ast: Stylesheet,
  text: string,
  lineStarts: readonly number[],
): ModuleSource {
  const own = new Map<string, MutableKeyframeSymbol>();
  const styleDependencies: string[] = [];
  const references: ReferenceSite[] = [];
  const animationNames: AnimationNameSite[] = [];

  for (const raw of ast.items) {
    const item = raw as unknown as NodeLike;
    if (item.kind === "native-at-rule") {
      const atRule = raw as NativeAtRule;
      const definition = keyframeDefinitionAt(atRule, text, lineStarts);
      if (definition !== undefined) {
        // Duplicate names keep the first definition (the compiler registers
        // once); the editor never invents a second target.
        if (!own.has(definition.name)) {
          own.set(definition.name, {
            name: definition.name,
            file,
            declaration: definition.range,
            frames: definition.frames,
            references: [],
            animationNames: [],
          });
        }
        continue;
      }
    }
    if (item.kind === "use" && item.styles === true && item.path !== undefined) {
      styleDependencies.push(joinPath(dirnamePath(file), item.path));
    }
  }

  walkDeclarations(ast.items, (declaration) => {
    collectReferenceTokens(declaration.tokens, lineStarts, references);
    for (const variant of declaration.variants) {
      collectReferenceTokens(variant.tokens, lineStarts, references);
    }
    if (declaration.property !== "animation-name") return;
    const name = declaration.value.trim();
    if (!PLAIN_KEYFRAMES_NAME.test(name)) return;
    const value = valueRangeOf(text, declaration, lineStarts);
    if (value !== undefined) animationNames.push({ name, value });
  });

  for (const item of ast.items) {
    if (item.kind !== "variables") continue;
    for (const declaration of item.tokens) {
      collectReferenceTokens(declaration.tokens, lineStarts, references);
    }
  }

  return { file, own, styleDependencies, references, animationNames };
}

/** Locale-independent path comparison, matching the compiler's comparison. */
function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Collect `$keyframes.<name>` `dollar-ref` tokens into name/keyword ranges. */
function collectReferenceTokens(
  tokens: readonly Token[] | undefined,
  lineStarts: readonly number[],
  out: ReferenceSite[],
): void {
  if (tokens === undefined) return;
  for (const token of tokens) {
    if (token.kind !== "dollar-ref" || !token.value.startsWith(KEYFRAMES_KEYWORD)) continue;
    const name = token.value.slice(KEYFRAMES_KEYWORD.length);
    if (!PLAIN_KEYFRAMES_NAME.test(name)) continue;
    out.push({
      name,
      nameRange: rangeAt(lineStarts, token.start + KEYFRAMES_KEYWORD.length, token.end),
      keywordRange: rangeAt(lineStarts, token.start, token.end),
    });
  }
}

/** Exact authored range of one declaration's value slice. */
function valueRangeOf(
  text: string,
  declaration: Declaration,
  lineStarts: readonly number[],
): Range | undefined {
  if (declaration.value === "") return undefined;
  const from = declaration.span.start + declaration.property.length;
  const start = text.indexOf(declaration.value, from);
  if (start < 0 || start + declaration.value.length > declaration.span.end) return undefined;
  return rangeAt(lineStarts, start, start + declaration.value.length);
}

/** Frame selectors authored directly in one keyframe block, first occurrence wins. */
function framesOf(atRule: NativeAtRule): readonly string[] {
  const frames: string[] = [];
  for (const item of atRule.block ?? []) {
    if (item.kind !== "rule") continue;
    const selector = item.selector.trim();
    if (selector === "" || frames.includes(selector)) continue;
    frames.push(selector);
  }
  return frames;
}

/** Walk every declaration in rules, conditionals, native blocks and @group blocks. */
function walkDeclarations(
  items: readonly unknown[],
  visit: (declaration: Declaration) => void,
): void {
  for (const raw of items) {
    const node = raw as NodeLike;
    switch (node.kind) {
      case "declaration":
        visit(raw as Declaration);
        break;
      case "rule":
      case "conditional-block":
        walkDeclarations(node.body ?? [], visit);
        break;
      case "native-at-rule":
        walkDeclarations(node.block ?? [], visit);
        break;
      case "runtime":
      case "group-definition":
      case "group-use-site":
        walkDeclarations(node.declarations ?? [], visit);
        break;
      default:
        break;
    }
  }
}
