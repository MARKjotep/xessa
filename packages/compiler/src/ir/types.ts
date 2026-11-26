import type { Span } from "../types/span.js";

/**
 * One lowered CSS declaration: a single property/value pair plus its origin.
 *
 * Lowering emits one node per authored value segment (base and every inline
 * variant), in exactly the authored order. It never deduplicates, reorders or
 * merges declarations: a later shorthand, a later base or an early conditional
 * segment keeps its position so the native CSS cascade stays authoritative
 * (SPECIFICATION.md §5).
 *
 * `value` is the raw authored slice. Variable substitution (`$token`), class
 * naming and selector prefixing deliberately do not run here: A08 and A09 own
 * them, so this node can be compared byte-for-byte against the AST.
 */
export interface DeclarationIr {
  /** Property exactly as authored, including custom properties (`--brand`). */
  readonly property: string;
  /**
   * Raw value slice exactly as authored, including a trailing `!important`
   * when the segment carried one (ADR-0003).
   */
  readonly value: string;
  /** Whether this segment alone carried `!important`; never propagated (D2). */
  readonly important?: boolean;
  /**
   * Origin of the segment. The base segment covers the declaration from the
   * property through the first modifier; a variant segment covers its modifier
   * through the next modifier or the end of the declaration. Segments partition
   * the authored declaration span with no gaps or overlaps.
   */
  readonly span: Span;
}

/**
 * The resolved Xessa condition governing one contiguous declaration run.
 *
 * `query` is a single normalized media-query text ready for `@media` emission:
 * combined aliases are joined with `and` and comma lists are rejected, so the
 * value is never a media query list (SPECIFICATION.md §4.3). `keys` are the
 * merged alias names in authored order, after duplicate normalization, which
 * lets later stages and the editor map a query back to its aliases.
 *
 * Native at-rule wrappers are not folded in here: they stay on
 * {@link RuleIr.context} and are ANDed at emission time by A06.
 */
export interface MediaConditionIr {
  /** Normalized single media query, for example `(min-width: 768px) and (orientation: landscape)`. */
  readonly query: string;
  /** Alias names in authored order with per-modifier duplicates removed. */
  readonly keys: readonly string[];
}

/**
 * One native at-rule wrapper enclosing a rule, for example an outer
 * `@media (min-width: 900px)`, `@supports` or `@layer`.
 *
 * Lowering copies the authored name and prelude verbatim and never rewrites
 * native media lists, so authored meaning is preserved. The stack on
 * {@link RuleIr.context} is ordered outermost-first.
 */
export interface AtRuleContextIr {
  /** At-rule name without the sigil, exactly as authored. */
  readonly name: string;
  /** Raw prelude text exactly as authored; empty when absent. */
  readonly prelude: string;
  /** Covers the at-rule from `@` through its block or terminating `;`. */
  readonly span: Span;
}

/**
 * A contiguous run of declarations for one selector in one condition and one
 * native at-rule context.
 *
 * Lowering guarantees authored order: rules appear in source order, and each
 * rule's declarations appear in the order the segments were written, with no
 * deduplication. A run is flushed when a nested rule, a conditional block or a
 * native at-rule is encountered (SPECIFICATION.md §5.1), so a later run is a
 * different node rather than a reordering of an earlier one.
 *
 * `selector` stays the raw, still-nested selector text from the AST. Nesting
 * flattening happens in A06 and class prefixing in P4/A09; `ancestors` carries
 * the raw enclosing selectors, outermost-first, so A06 can flatten without
 * re-reading the AST.
 */
export interface RuleIr {
  /** Raw selector text exactly as authored, with `&` and descendant nesting untouched. */
  readonly selector: string;
  /**
   * Raw selector texts of the enclosing rules, outermost-first, excluding this
   * rule's own selector. Empty for top-level rules. Additive IR field required
   * for A06 nesting flattening; see the A05 report.
   */
  readonly ancestors: readonly string[];
  /** Declarations of this run in authored order; never empty, never deduplicated. */
  readonly declarations: readonly DeclarationIr[];
  /** Xessa condition for this run, or `null` for an unconditional run. */
  readonly condition: MediaConditionIr | null;
  /** Native at-rule stack outermost-first; empty outside native at-rules. */
  readonly context: readonly AtRuleContextIr[];
  /** Origin of the run's first declaration segment. */
  readonly span: Span;
}

/** Any child a native at-rule block may hold, in authored order. */
export type NativeBlockChild = RuleIr | NativeBlockIr | DeclarationIr;

/**
 * A native CSS at-rule preserved with its authored meaning.
 *
 * Lowering never reorders or rewrites children and never merges a native block
 * with its neighbours. Descriptor at-rules (`@font-face`, `@property`) hold
 * {@link DeclarationIr} children directly because their declarations are not
 * selector-bound; keyframe steps stay {@link RuleIr} nodes with their authored
 * keyframe selector text.
 */
export interface NativeBlockIr {
  /** At-rule name without the sigil, exactly as authored. */
  readonly name: string;
  /** Raw prelude text exactly as authored; empty when absent. */
  readonly prelude: string;
  /**
   * `true` for a statement at-rule (`@import`, `@charset`, `@layer a, b;`) that
   * has no block. Absent for block at-rules. Additive IR field: without it the
   * emitter cannot distinguish `@import "a.css";` from `@layer a {}`.
   */
  readonly statement?: boolean;
  /** Ordered children: nested rules, nested native blocks and descriptor declarations. */
  readonly children: readonly NativeBlockChild[];
  /** Covers the at-rule from `@` through its block or terminating `;`. */
  readonly span: Span;
}

/**
 * The lowered stylesheet: top-level rules and native blocks in authored order.
 *
 * Lowering is a pure, deterministic projection of the AST. Every node is frozen
 * and every span points back at the authored source, so downstream stages
 * (class rewrite, safe grouping, emission, source maps) can trust order and
 * origin without re-reading the AST.
 */
export interface StylesheetIr {
  /** Top-level rules and native blocks in authored order. */
  readonly rules: readonly (RuleIr | NativeBlockIr)[];
}
