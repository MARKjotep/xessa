import { nativeBlockIr, ruleIr, stylesheetIr } from "../ir/factories.js";
import type { NativeBlockChild, NativeBlockIr, RuleIr, StylesheetIr } from "../ir/types.js";
import { flattenSelector } from "../selectors/index.js";
import { scanSelector } from "../selectors/scan.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";
import { applySelectorEdits, scanSelectorClasses } from "./scan.js";
import type { SelectorEdit } from "./scan.js";
import { isValidCssIdentifier, renameClassName } from "./table.js";
import type { ClassEntry, ClassTable, RenameOptions, RenameResult } from "./types.js";

/**
 * Class rewrite: flattened selectors in, prefixed selectors and a class table
 * out (SPECIFICATION.md §7.2, ADR-0010).
 *
 * The pass runs after variable substitution and runtime emission and before
 * `groupRuns`. It is pure, filesystem-free and deterministic, and it never
 * mutates its input: rules are rebuilt with the frozen IR factories.
 *
 * Policy:
 *
 * - Every local class token in a flattened selector is looked up in one table,
 *   so a class used at top level and as a nested reference is renamed once:
 *   `.button { & > .icon { } }` with prefix `ui` emits `.ui-button > .ui-icon`.
 * - `.` + identifier is the only rewritten construct. Ids, type selectors,
 *   attribute selectors, attribute values, strings, comments, pseudo names and
 *   pseudo-element names are copied byte for byte. Class tokens inside
 *   functional pseudos (`:is(.a)`, `:not(.a)`) are real class selectors and are
 *   renamed; the conservative boundary is "every class token except inside
 *   `:global(...)`, strings, comments and attribute values".
 * - `:global(.external-icon)` escapes renaming and the `:global(...)` wrapper is
 *   **removed** from the emitted selector (§7.2); the inner class keeps its
 *   authored text. A global class is recorded in the table with `global: true`
 *   and is never exported by `generateClassMap` (§8). MVP unwraps only a simple
 *   single-class argument; a complex argument (comma list, combinator, several
 *   classes) stays wrapped and unrenamed so the selector's meaning cannot change.
 * - Escaped class identifiers are decoded for their identity (`.\31 23` is
 *   class `123`) and, when a prefix applies, re-emitted as the valid bare
 *   identifier `ui-123`. When no prefix applies the authored bytes are kept,
 *   so escape style is never normalized by accident.
 * - Naming table (MVP strategies): `prefix` with a non-empty, valid prefix
 *   produces `"<prefix>-<name>"`; `none` and an empty prefix leave names
 *   unchanged. An invalid prefix or an invalid prefixed result is XESSA4001 and
 *   the class stays unprefixed (documented fallback). Only the prefix failure is
 *   reported once; a per-class result failure is reported once for that class.
 *
 * Selector flattening is idempotent, so running it here is equivalent to
 * running A06's `flattenIr` afterwards; a selector that cannot flatten is left
 * in its authored nested form (classes are still rewritten) and the emitter
 * reports the same XESSA1001 it would have reported anyway. Class diagnostics
 * use the rule span because `RuleIr` records declaration-origin spans, not
 * selector offsets.
 */

interface Collector {
  readonly entries: ClassEntry[];
  readonly indexes: Map<string, number>;
}

function computeEmitted(
  name: string,
  prefix: string,
  strategy: "none" | "prefix",
  span: Span,
  diagnostics: Diagnostic[],
  reported: Set<string>,
): { readonly emitted: string; readonly renamed: boolean } {
  const result = renameClassName(name, prefix, strategy);
  if (!result.renamed) {
    const applies = strategy === "prefix" && prefix !== "" && isValidCssIdentifier(prefix);
    if (applies && !reported.has(name)) {
      reported.add(name);
      diagnostics.push(
        error(
          "XESSA4001",
          `Class "${name}" cannot be prefixed with "${prefix}": the result "${prefix}-${name}" is not a valid CSS identifier (SPECIFICATION.md §7.2). The class stays unprefixed.`,
          span,
        ),
      );
    }
  }
  return result;
}

function record(
  collector: Collector,
  token: { readonly name: string; readonly global: boolean },
  span: Span,
  prefix: string,
  strategy: "none" | "prefix",
  diagnostics: Diagnostic[],
  reported: Set<string>,
): ClassEntry {
  const existingIndex = collector.indexes.get(token.name);
  if (existingIndex !== undefined) {
    const existing = collector.entries[existingIndex];
    if (existing === undefined) {
      throw new Error("class table index out of range");
    }
    if (existing.global && !token.global) {
      const computed = computeEmitted(token.name, prefix, strategy, span, diagnostics, reported);
      const upgraded: ClassEntry = Object.freeze({
        name: token.name,
        emitted: computed.emitted,
        global: false,
        renamed: computed.renamed,
        span: existing.span,
      });
      collector.entries[existingIndex] = upgraded;
      return upgraded;
    }
    return existing;
  }

  const computed = token.global
    ? { emitted: token.name, renamed: false }
    : computeEmitted(token.name, prefix, strategy, span, diagnostics, reported);
  const entry: ClassEntry = Object.freeze({
    name: token.name,
    emitted: computed.emitted,
    global: token.global,
    renamed: computed.renamed,
    span: Object.freeze(span),
  });
  collector.indexes.set(token.name, collector.entries.length);
  collector.entries.push(entry);
  return entry;
}

/** Rewrite one flat selector text and record its classes. */
function rewriteFlatSelector(
  text: string,
  span: Span,
  collector: Collector,
  prefix: string,
  strategy: "none" | "prefix",
  diagnostics: Diagnostic[],
  reported: Set<string>,
): string {
  if (!scanSelector(text).ok) return text;
  const scan = scanSelectorClasses(text);
  if (!scan.ok) return text;

  const edits: SelectorEdit[] = [];
  for (const global of scan.globals) {
    const inner = text.slice(global.openEnd, global.closeStart).trim();
    const contained = scan.classes.filter(
      (token) => token.start >= global.openEnd && token.end <= global.closeStart,
    );
    // MVP supports a simple global class escape only (SPECIFICATION.md §7.2).
    // A complex argument (comma list, combinator, several classes) is left
    // wrapped and unrenamed rather than expanded into a selector whose meaning
    // would change; its classes are still recorded as global.
    const simple = contained.length === 1 && contained[0]?.raw === inner;
    if (!simple) continue;
    edits.push({ start: global.start, end: global.openEnd, text: "" });
    edits.push({ start: global.closeStart, end: global.end, text: "" });
  }

  for (const token of scan.classes) {
    const entry = record(collector, token, span, prefix, strategy, diagnostics, reported);
    if (!token.global && entry.renamed) {
      edits.push({ start: token.start, end: token.end, text: `.${entry.emitted}` });
    }
  }

  return applySelectorEdits(text, edits);
}

function rewriteRule(
  rule: RuleIr,
  collector: Collector,
  prefix: string,
  strategy: "none" | "prefix",
  diagnostics: Diagnostic[],
  reported: Set<string>,
): RuleIr {
  const flattened = flattenSelector(rule.selector, rule.ancestors);

  let selector: string;
  let ancestors: readonly string[];
  if (flattened.ok) {
    selector = rewriteFlatSelector(
      flattened.selector,
      rule.span,
      collector,
      prefix,
      strategy,
      diagnostics,
      reported,
    );
    ancestors = [];
  } else {
    selector = rewriteFlatSelector(
      rule.selector,
      rule.span,
      collector,
      prefix,
      strategy,
      diagnostics,
      reported,
    );
    ancestors = rule.ancestors.map((ancestor) =>
      rewriteFlatSelector(ancestor, rule.span, collector, prefix, strategy, diagnostics, reported),
    );
  }

  const ancestorsUnchanged =
    ancestors.length === rule.ancestors.length &&
    ancestors.every((ancestor, index) => ancestor === rule.ancestors[index]);
  if (selector === rule.selector && ancestorsUnchanged) return rule;

  return ruleIr({
    selector,
    ancestors,
    declarations: rule.declarations,
    condition: rule.condition,
    context: rule.context,
    span: rule.span,
  });
}

function rewriteChild(
  child: NativeBlockChild,
  collector: Collector,
  prefix: string,
  strategy: "none" | "prefix",
  diagnostics: Diagnostic[],
  reported: Set<string>,
): NativeBlockChild {
  if ("children" in child) {
    return rewriteBlock(child, collector, prefix, strategy, diagnostics, reported);
  }
  if ("declarations" in child) {
    return rewriteRule(child, collector, prefix, strategy, diagnostics, reported);
  }
  return child;
}

function rewriteBlock(
  block: NativeBlockIr,
  collector: Collector,
  prefix: string,
  strategy: "none" | "prefix",
  diagnostics: Diagnostic[],
  reported: Set<string>,
): NativeBlockIr {
  if (block.statement === true) return block;
  const children = block.children.map((child) =>
    rewriteChild(child, collector, prefix, strategy, diagnostics, reported),
  );
  if (children.every((child, index) => child === block.children[index])) return block;
  return nativeBlockIr({
    name: block.name,
    prelude: block.prelude,
    children,
    span: block.span,
  });
}

function tableOf(collector: Collector): ClassTable {
  return Object.freeze({ entries: Object.freeze([...collector.entries]) });
}

/**
 * Rename every local class token and unwrap `:global(...)` wrappers.
 *
 * @param ir Lowered (and normally substituted) stylesheet IR.
 * @param options Effective prefix and strategy; `options.naming.prefix` wins
 *   over `options.prefix`, and the strategy defaults to `prefix`.
 * @returns The rebuilt IR (the input instance when nothing changed), the
 *   first-appearance {@link ClassTable} and XESSA4001 diagnostics for invalid
 *   prefix/result configurations.
 */
export function renameClasses(ir: StylesheetIr, options: RenameOptions = {}): RenameResult {
  const strategy: "none" | "prefix" = options.naming?.strategy ?? "prefix";
  const prefix = options.naming?.prefix ?? options.prefix ?? "";
  const collector: Collector = { entries: [], indexes: new Map() };
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();

  if (strategy === "prefix" && prefix !== "" && !isValidCssIdentifier(prefix)) {
    // Report once, at the first class we can point at; if the stylesheet has no
    // classes the invalid prefix is inert and reporting would have no location.
    const firstRule = findFirstRuleSpan(ir);
    if (firstRule !== null) {
      diagnostics.push(
        error(
          "XESSA4001",
          `Invalid class prefix "${prefix}": it is not a valid CSS identifier, so classes stay unprefixed (SPECIFICATION.md §7.2).`,
          firstRule,
        ),
      );
    }
  }

  const rules = ir.rules.map((node) =>
    "declarations" in node
      ? rewriteRule(node, collector, prefix, strategy, diagnostics, reported)
      : rewriteBlock(node, collector, prefix, strategy, diagnostics, reported),
  );

  const changed = rules.every((node, index) => node === ir.rules[index]) === false;
  return {
    ir: changed ? stylesheetIr(rules) : ir,
    classes: tableOf(collector),
    diagnostics,
  };
}

/** Span of the first rule node, or `null` for an empty stylesheet. */
function findFirstRuleSpan(ir: StylesheetIr): Span | null {
  for (const node of ir.rules) {
    if ("declarations" in node) return node.span;
    if (node.statement !== true) {
      const found = findFirstRuleInChildren(node.children);
      if (found !== null) return found;
    }
  }
  return null;
}

function findFirstRuleInChildren(children: readonly NativeBlockChild[]): Span | null {
  for (const child of children) {
    if ("declarations" in child) return child.span;
    if ("children" in child) {
      const found = findFirstRuleInChildren(child.children);
      if (found !== null) return found;
    }
  }
  return null;
}
