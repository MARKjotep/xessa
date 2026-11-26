/**
 * Minify-parity normalizer for the TT5 "minified vs pretty" case.
 *
 * Both artifacts are re-parsed with the compiler's own parser (imported from the built
 * `dist`, i.e. the artifact under test) and reduced to a structural form in which only
 * whitespace that `minify` is documented to compact can differ:
 *
 * - rule selectors, declaration property/value pairs and at-rule preludes keep their
 *   authored tokens, with runs of whitespace collapsed to one space and trimmed;
 * - the order of rules, declarations and at-rules is **preserved**, because
 *   `docs/configuration.md` documents minify as "compact generated structural
 *   whitespace; authored tokens and declaration order are preserved" and
 *   `docs/cascade.md` documents authored declaration order as part of the contract.
 *   The comparison therefore stays order-sensitive on purpose.
 *
 * Nothing here sorts or deduplicates: a reordering bug is a parity failure, not
 * something the normalizer hides.
 */

import { parse } from "../../../packages/compiler/dist/index.js";

/** A rule after normalization: collapsed selector plus its declaration run. */
export interface NormalizedRule {
  readonly kind: "rule";
  readonly selector: string;
  /** `property: value` strings in emitted order, including `!important`. */
  readonly declarations: readonly string[];
  /** Nested rules / at-rules in emitted order. */
  readonly children: readonly NormalizedNode[];
}

/** An at-rule after normalization. */
export interface NormalizedAtRule {
  readonly kind: "at-rule";
  readonly name: string;
  readonly prelude: string;
  /** Declarations authored directly in the at-rule block (`@font-face` and friends). */
  readonly declarations: readonly string[];
  readonly children: readonly NormalizedNode[];
}

/** Any other top-level construct a parser may surface for emitted CSS. */
export interface NormalizedOther {
  readonly kind: string;
}

/** One normalized emitted-CSS node. */
export type NormalizedNode = NormalizedRule | NormalizedAtRule | NormalizedOther;

/** Normalized stylesheet plus the parser diagnostics that produced it. */
export interface NormalizedStylesheet {
  readonly nodes: readonly NormalizedNode[];
  /** Error-severity diagnostics formatted as `CODE message`. */
  readonly errors: readonly string[];
}

/** Collapse whitespace runs to one space and trim — the only tolerated difference. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Minimal shape of a parsed declaration node. */
interface DeclarationLike {
  readonly property: string;
  readonly value: string;
  readonly important?: boolean;
}

/** Serialize one declaration exactly as authored, minus structural whitespace. */
function declarationText(item: DeclarationLike): string {
  const suffix = item.important === true ? " !important" : "";
  return `${item.property}: ${collapseWhitespace(item.value)}${suffix}`;
}

/** A block's direct declarations and its nested constructs, in emitted order. */
interface NormalizedBlock {
  readonly declarations: readonly string[];
  readonly children: readonly NormalizedNode[];
}

/** Split block items into declarations and nested constructs, keeping order. */
function normalizeBlock(items: readonly unknown[]): NormalizedBlock {
  const declarations: string[] = [];
  const children: NormalizedNode[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown> & { kind?: string };
    if (item.kind === "declaration") {
      declarations.push(declarationText(item as unknown as DeclarationLike));
      continue;
    }
    children.push(normalizeNode(item));
  }
  return { declarations, children };
}

/** Normalize one block item. */
function normalizeNode(item: Record<string, unknown> & { kind?: string }): NormalizedNode {
  if (item.kind === "rule") {
    const block = normalizeBlock((item.body ?? []) as readonly unknown[]);
    return {
      kind: "rule",
      selector: collapseWhitespace(String(item.selector ?? "")),
      declarations: block.declarations,
      children: block.children,
    };
  }
  if (item.kind === "native-at-rule") {
    const raw = item.block as readonly unknown[] | undefined;
    const block = raw === undefined ? { declarations: [], children: [] } : normalizeBlock(raw);
    return {
      kind: "at-rule",
      name: String(item.name ?? ""),
      prelude: collapseWhitespace(String(item.prelude ?? "")),
      declarations: block.declarations,
      children: block.children,
    };
  }
  return { kind: String(item.kind ?? "unknown") };
}

/**
 * Re-parse emitted CSS and reduce it to the order-sensitive structural form above.
 *
 * Error diagnostics are returned instead of thrown so a case can assert "the parser
 * rejected nothing" and report the actual messages when it did not.
 */
export function normalizeEmittedCss(css: string, file: string): NormalizedStylesheet {
  const parsed = parse(css, { file });
  const errors = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`);
  const nodes = (parsed.ast.items as readonly unknown[]).map((raw) =>
    normalizeNode(raw as Record<string, unknown> & { kind?: string }),
  );
  return { nodes, errors };
}

/** Counts used in report evidence and in the "the comparison is not vacuous" cases. */
export interface StructureCounts {
  readonly rules: number;
  readonly declarations: number;
  readonly atRules: number;
}

/** Tally rules, declarations and at-rules in a normalized stylesheet. */
export function countStructure(nodes: readonly NormalizedNode[]): StructureCounts {
  let rules = 0;
  let declarations = 0;
  let atRules = 0;
  const walk = (items: readonly NormalizedNode[]): void => {
    for (const node of items) {
      if (node.kind === "rule") {
        rules += 1;
        declarations += node.declarations.length;
        walk(node.children);
        continue;
      }
      if (node.kind === "at-rule") {
        atRules += 1;
        declarations += node.declarations.length;
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return { rules, declarations, atRules };
}

/** `@name prelude` keys in emitted order, for at-rule parity evidence. */
export function atRuleKeys(nodes: readonly NormalizedNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: readonly NormalizedNode[]): void => {
    for (const node of items) {
      if (node.kind !== "at-rule") continue;
      keys.push(`@${node.name} ${node.prelude}`.trim());
      walk(node.children);
    }
  };
  walk(nodes);
  return keys;
}
