import { nativeBlockIr, ruleIr, stylesheetIr } from "../ir/factories.js";
import type {
  DeclarationIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";
import { scanSelector, splitSelectorList } from "./scan.js";
import type { Specificity } from "./specificity.js";
import { addSpecificity, compareSpecificity, specificityOfItem } from "./specificity.js";

/**
 * Nested-selector flattening (ADR-0002, ADR-0012, SPECIFICATION.md §7.1).
 *
 * `flattenSelector` is pure: it takes the raw authored selector of one rule
 * and the raw authored selectors of its enclosing rules (outermost-first) and
 * returns a flat selector list. It never reads the AST, mutates its input or
 * throws.
 *
 * Policy summary:
 *
 * - A nested selector without `&` is a descendant: `parent + " " + child`
 *   (ADR-0002).
 * - `&` is substituted in any position, including trailing and repeated
 *   (ADR-0012). A backslash-escaped `\&` stays literal, and `&` inside strings,
 *   comments and attribute selectors is never rewritten.
 * - A parent that resolves to one selector substitutes directly. A complex
 *   parent (contains a top-level combinator) is wrapped in `:is(...)` when `&`
 *   is attached to a prefix such as `.x&` or `&&`, because plain concatenation
 *   would change meaning.
 * - A parent selector list with equal, known specificity expands as the CSS
 *   cross-product in authored order. A parent list with mixed or unknown
 *   specificity substitutes `:is(list)`, which is exactly native nesting
 *   specificity. Mixed-specificity lists containing pseudo-elements are
 *   rejected because `:is()` cannot accept them.
 * - A nested rule's own selector list expands as a cross-product: each child
 *   item is expanded against every parent alternative in authored order.
 * - Rejected cases return a reason: `&` outside a nested rule, empty selector
 *   list items, unbalanced structures, leading combinators (relative nested
 *   selectors need an explicit `&` per §7.1) and the pseudo-element case
 *   above. The emitter turns a rejection into XESSA1001.
 * - Expansion is bounded per rule by {@link FLATTEN_LIMITS}. A level that
 *   carries repeated `&` duplicates the selector product (and its character
 *   count) at every step, so a pathological but syntactically valid document
 *   would otherwise grow without bound; the bound rejects that rule with the
 *   same XESSA1001 diagnostic while legal nesting is unaffected.
 */

/**
 * Per-rule bounds on flattened-selector expansion.
 *
 * A nesting level carrying two `&`s squares the selector product, and a `&`
 * pair against a single parent doubles the selector length, so adversarial
 * input grows exponentially. These limits cap one rule's flattened selector
 * list; exceeding either aborts flattening with a XESSA1001 diagnostic instead
 * of hanging or exhausting memory.
 *
 * The defaults are deliberately generous: the committed scale case (a
 * 1 000-level `&.m<n>` chain ending in a 500-item selector list) flattens to
 * ~2.45 M characters in 500 alternatives, well inside the budget, while a
 * 1 000-level `& &` chain aborts after roughly two dozen levels.
 */
export const FLATTEN_LIMITS = Object.freeze({
  /** Maximum characters in one rule's flattened selector list (joined by `", "`). */
  maxSelectorChars: 8_388_608,
  /** Maximum number of flat alternatives in one rule's selector list. */
  maxSelectors: 100_000,
});

/** One flat alternative plus its estimated specificity. */
interface Alternative {
  readonly selector: string;
  readonly specificity: Specificity | null;
}

/** Successful flattening. */
export interface FlattenedSelector {
  readonly ok: true;
  /** Flat selector list, items joined with `", "`. */
  readonly selector: string;
}

/** Rejected flattening with a user-facing reason for the emitter diagnostic. */
export interface FlattenFailure {
  readonly ok: false;
  readonly reason: string;
}

/** Result of {@link flattenSelector}. */
export type FlattenResult = FlattenedSelector | FlattenFailure;

type ItemResult = { readonly ok: true; readonly items: readonly Alternative[] } | FlattenFailure;

function failure(reason: string): FlattenFailure {
  return { ok: false, reason };
}

function diagnosticFor(selector: string, reason: string, span: Span): Diagnostic {
  return error("XESSA1001", `Cannot flatten selector "${selector}": ${reason}`, span);
}

/** Human-readable bound used in the expansion-limit reason. */
function limitFailure(depth: number): FlattenFailure {
  return failure(
    `selector expansion exceeded the flattening limit of ${FLATTEN_LIMITS.maxSelectorChars} characters and ${FLATTEN_LIMITS.maxSelectors} selectors at nesting depth ${depth}; reduce repeated "&" or nested selector lists`,
  );
}

/** Exact joined-list size check (`items.join(", ")`). */
function exceedsLimits(selectors: readonly string[]): boolean {
  if (selectors.length > FLATTEN_LIMITS.maxSelectors) return true;
  let chars = selectors.length === 0 ? 0 : (selectors.length - 1) * 2;
  for (const selector of selectors) {
    chars += selector.length;
    if (chars > FLATTEN_LIMITS.maxSelectorChars) return true;
  }
  return false;
}

/** True when `parent` has no top-level combinator and is therefore one compound. */
function isCompound(parent: string): boolean {
  const scan = scanSelector(parent);
  return scan.ok && !scan.hasTopLevelCombinator;
}

/**
 * True when the `&` at `position` is attached to a preceding simple selector
 * (for example `.x&`, `:not(.y)&` or `&&`) rather than starting a compound.
 */
function isPrefixAttached(text: string, position: number): boolean {
  if (position === 0) return false;
  const previous = text.charAt(position - 1);
  return previous !== "" && !/[\s>+~|,(]/.test(previous);
}

function substitute(
  item: string,
  ampersands: readonly number[],
  parent: readonly Alternative[],
  depth: number,
): ItemResult {
  if (parent.length === 0) return failure('"&" has no enclosing rule to resolve against');

  const first = parent[0];
  if (first === undefined) return failure('"&" has no enclosing rule to resolve against');
  if (parent.length === 1) {
    const needsIs =
      !isCompound(first.selector) &&
      ampersands.some((position) => isPrefixAttached(item, position));
    const replacement = needsIs ? `:is(${first.selector})` : first.selector;
    const projected = item.length - ampersands.length + ampersands.length * replacement.length;
    if (projected > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
    let result = "";
    let cursor = 0;
    for (const position of ampersands) {
      result += item.slice(cursor, position) + replacement;
      cursor = position + 1;
      if (result.length > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
    }
    result += item.slice(cursor);
    if (result.length > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
    return {
      ok: true,
      items: [{ selector: result, specificity: specificityOfItem(result) }],
    };
  }

  let partial: string[] = [""];
  let cursor = 0;
  for (const position of ampersands) {
    const literal = item.slice(cursor, position);
    const choices: string[] = [];
    for (const alternative of parent) {
      const wrap = !isCompound(alternative.selector) && isPrefixAttached(item, position);
      choices.push(wrap ? `:is(${alternative.selector})` : alternative.selector);
    }
    if (partial.length * choices.length > FLATTEN_LIMITS.maxSelectors) return limitFailure(depth);
    const next: string[] = [];
    let nextChars = 0;
    for (const prefix of partial) {
      for (const choice of choices) {
        const projected = prefix.length + literal.length + choice.length;
        if (projected > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
        next.push(prefix + literal + choice);
        nextChars += projected;
        if (nextChars + (next.length - 1) * 2 > FLATTEN_LIMITS.maxSelectorChars) {
          return limitFailure(depth);
        }
      }
    }
    partial = next;
    cursor = position + 1;
  }

  const tail = item.slice(cursor);
  const items: Alternative[] = [];
  let chars = partial.length === 0 ? 0 : (partial.length - 1) * 2;
  for (const prefix of partial) {
    const selector = prefix + tail;
    chars += selector.length;
    if (chars > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
    items.push({ selector, specificity: specificityOfItem(selector) });
  }
  return { ok: true, items };
}

function descend(item: string, parent: readonly Alternative[], depth: number): ItemResult {
  const childSpecificity = specificityOfItem(item);
  const items: Alternative[] = [];
  let chars = parent.length === 0 ? 0 : (parent.length - 1) * 2;
  for (const alternative of parent) {
    const selector = `${alternative.selector} ${item}`;
    chars += selector.length;
    if (chars > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
    items.push({
      selector,
      specificity: addSpecificity(alternative.specificity, childSpecificity),
    });
  }
  return { ok: true, items };
}

function flattenAgainstParent(
  text: string,
  parent: readonly Alternative[] | null,
  depth: number,
): ItemResult {
  if (text.length > FLATTEN_LIMITS.maxSelectorChars) return limitFailure(depth);
  const list = splitSelectorList(text);
  if (!list.ok) return failure(list.reason);

  const results: Alternative[] = [];
  let chars = 0;
  const append = (items: readonly Alternative[]): FlattenFailure | null => {
    for (const item of items) {
      results.push(item);
      chars += item.selector.length + (results.length === 1 ? 0 : 2);
      if (results.length > FLATTEN_LIMITS.maxSelectors || chars > FLATTEN_LIMITS.maxSelectorChars) {
        return limitFailure(depth);
      }
    }
    return null;
  };
  for (const item of list.items) {
    const scan = scanSelector(item);
    if (!scan.ok) return failure(scan.reason);
    if (scan.leadingCombinator) {
      return failure(
        'a selector starting with a combinator requires an explicit "&" (SPECIFICATION.md §7.1)',
      );
    }

    if (parent === null) {
      if (scan.ampersands.length > 0) {
        return failure('"&" has no enclosing rule to resolve against');
      }
      const overflow = append([{ selector: item, specificity: specificityOfItem(item) }]);
      if (overflow !== null) return overflow;
      continue;
    }

    if (scan.ampersands.length > 0) {
      const substituted = substitute(item, scan.ampersands, parent, depth);
      if (!substituted.ok) return substituted;
      const overflow = append(substituted.items);
      if (overflow !== null) return overflow;
    } else {
      const descended = descend(item, parent, depth);
      if (!descended.ok) return descended;
      const overflow = append(descended.items);
      if (overflow !== null) return overflow;
    }
  }

  return { ok: true, items: results };
}

/**
 * Normalize a resolved ancestor list before it is used as a substitution
 * parent. Equal, known specificity may stay a list (cross-product); a mixed or
 * unknown list collapses to one `:is(...)` alternative.
 */
function normalizeParent(
  parent: readonly Alternative[],
): { readonly ok: true; readonly parent: readonly Alternative[] } | FlattenFailure {
  if (parent.length <= 1) return { ok: true, parent };

  const firstSpecificity = parent[0]?.specificity ?? null;
  const equal =
    firstSpecificity !== null &&
    parent.every(
      (alternative) =>
        alternative.specificity !== null &&
        compareSpecificity(alternative.specificity, firstSpecificity) === 0,
    );
  if (equal) return { ok: true, parent };

  for (const alternative of parent) {
    const scan = scanSelector(alternative.selector);
    if (scan.ok && scan.hasPseudoElement) {
      return failure(
        "mixed-specificity parent selector lists containing pseudo-elements cannot be represented with :is(...)",
      );
    }
  }

  let maximum: Specificity | null = null;
  let unknown = false;
  for (const alternative of parent) {
    if (alternative.specificity === null) {
      unknown = true;
      break;
    }
    if (maximum === null || compareSpecificity(alternative.specificity, maximum) > 0) {
      maximum = alternative.specificity;
    }
  }

  const joined = parent.map((alternative) => alternative.selector).join(", ");
  return {
    ok: true,
    parent: [{ selector: `:is(${joined})`, specificity: unknown ? null : maximum }],
  };
}

function resolveAncestors(
  ancestors: readonly string[],
): { readonly ok: true; readonly parent: readonly Alternative[] | null } | FlattenFailure {
  const depth = ancestors.length + 1;
  let resolved: readonly Alternative[] | null = null;
  for (const ancestor of ancestors) {
    const normalized = resolved === null ? null : normalizeParent(resolved);
    if (normalized !== null && !normalized.ok) return normalized;
    const folded = flattenAgainstParent(
      ancestor,
      normalized === null ? null : normalized.parent,
      depth,
    );
    if (!folded.ok) return folded;
    resolved = folded.items;
  }
  if (resolved === null) return { ok: true, parent: null };
  const normalized = normalizeParent(resolved);
  if (!normalized.ok) return normalized;
  if (exceedsLimits(normalized.parent.map((alternative) => alternative.selector))) {
    return limitFailure(depth);
  }
  return { ok: true, parent: normalized.parent };
}

/**
 * Flatten one authored selector against its authored ancestor selectors.
 *
 * Pure and deterministic: the returned selector list preserves authored item
 * order, cross-product order and all non-`&` tokens. A rejection carries a
 * reason suitable for a XESSA1001-family diagnostic. Expansion is bounded by
 * {@link FLATTEN_LIMITS}; a document that exceeds it fails with one rejection
 * instead of hanging or exhausting memory.
 */
export function flattenSelector(selector: string, ancestors: readonly string[]): FlattenResult {
  const depth = ancestors.length + 1;
  const resolved = resolveAncestors(ancestors);
  if (!resolved.ok) return resolved;
  const folded = flattenAgainstParent(selector, resolved.parent, depth);
  if (!folded.ok) return folded;
  const selectors = folded.items.map((item) => item.selector);
  if (exceedsLimits(selectors)) return limitFailure(depth);
  return {
    ok: true,
    selector: selectors.join(", "),
  };
}

function flattenRuleNode(rule: RuleIr, diagnostics: Diagnostic[]): RuleIr | null {
  const flattened = flattenSelector(rule.selector, rule.ancestors);
  if (!flattened.ok) {
    diagnostics.push(diagnosticFor(rule.selector, flattened.reason, rule.span));
    return null;
  }
  return ruleIr({
    selector: flattened.selector,
    ancestors: [],
    declarations: rule.declarations,
    condition: rule.condition,
    context: rule.context,
    span: rule.span,
  });
}

function flattenNativeNode(block: NativeBlockIr, diagnostics: Diagnostic[]): NativeBlockIr {
  return nativeBlockIr({
    name: block.name,
    prelude: block.prelude,
    ...(block.statement === true ? { statement: true } : {}),
    children: flattenChildren(block.children, diagnostics),
    span: block.span,
  });
}

function flattenChildren(
  children: readonly NativeBlockChild[],
  diagnostics: Diagnostic[],
): readonly NativeBlockChild[] {
  const flattened: NativeBlockChild[] = [];
  for (const child of children) {
    if ("children" in child) {
      flattened.push(flattenNativeNode(child, diagnostics));
      continue;
    }
    if ("declarations" in child) {
      const rule = flattenRuleNode(child, diagnostics);
      if (rule !== null) flattened.push(rule);
      continue;
    }
    flattened.push(child as DeclarationIr);
  }
  return flattened;
}

/**
 * Flatten every rule selector in a stylesheet IR and clear `ancestors`.
 *
 * This is the explicit pipeline step between `groupRuns` and `emitCss`. Rules
 * whose selector cannot be flattened are omitted with a XESSA1001 diagnostic;
 * callers that emit the original IR instead get the same rejection from
 * `emitCss` directly. Declaration, condition, context and span data are
 * preserved unchanged.
 */
export function flattenIr(ir: StylesheetIr): {
  readonly ir: StylesheetIr;
  readonly diagnostics: readonly Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const rules: (RuleIr | NativeBlockIr)[] = [];
  for (const node of ir.rules) {
    if ("children" in node) {
      rules.push(flattenNativeNode(node, diagnostics));
      continue;
    }
    const rule = flattenRuleNode(node, diagnostics);
    if (rule !== null) rules.push(rule);
  }
  return { ir: stylesheetIr(rules), diagnostics: Object.freeze(diagnostics) };
}
