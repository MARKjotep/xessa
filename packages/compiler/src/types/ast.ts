import type { Span } from "./span.js";
import type { Token } from "./token.js";

/**
 * Abstract syntax tree produced by `parse`.
 *
 * Node shapes mirror SPECIFICATION.md §3.2, refined by
 * ADR-0003 (per-segment `!important`), ADR-0004 (rule-scoped conditional
 * blocks), ADR-0005 (raw value slices plus optional token sequences) and
 * ADR-0017 (inert `@group.<name>` definitions and use sites).
 *
 * Every node is immutable and carries a {@link Span} into the original source,
 * so diagnostics, lowering and source maps keep exact origins. Value-bearing
 * strings are raw source slices exactly as authored: no whitespace trimming,
 * escape decoding or normalization happens here. Lowering produces new IR
 * nodes instead of editing the AST in place.
 *
 * Two structural notes:
 *
 * - A top-level conditional block is invalid (ADR-0004). It is never
 *   represented as a node: the parser reports a XESSA1001-family diagnostic and
 *   resumes at the next statement boundary, so {@link Stylesheet.items} only
 *   holds valid top-level constructs.
 * - Multiple `@setup` blocks are allowed at the top level and are parsed into
 *   multiple {@link SetupBlock} nodes so recovery and diagnostics stay local;
 *   the resolver merges them in document order. A duplicate setting key within
 *   or across blocks is a XESSA1001-family diagnostic.
 */
export interface Stylesheet {
  readonly kind: "stylesheet";
  /** Workspace-relative POSIX path of the parsed source, equal to `span.file`. */
  readonly file: string;
  /** Top-level constructs in authored order. */
  readonly items: readonly StylesheetItem[];
  /** Covers the whole source file, from offset 0 through the final character. */
  readonly span: Span;
}

/** Any construct that may appear at the top level of a file. */
export type StylesheetItem =
  | SetupBlock
  | UseImport
  | VariablesBlock
  | RuntimeBlock
  | MediaTypesBlock
  | GroupDefinition
  | Rule
  | NativeAtRule;

/** A `@setup { ... }` block; one node per authored block. */
export interface SetupBlock {
  readonly kind: "setup";
  /** Settings in authored order, duplicates preserved for diagnostics. */
  readonly settings: readonly Setting[];
  /** Covers `@setup` through the closing `}`. */
  readonly span: Span;
}

/**
 * One `key: value;` line inside `@setup`.
 *
 * Keys are the kebab-case setup keys of SPECIFICATION.md §9 (`css-dir`,
 * `emit-css`, ...). Values stay raw so the configuration layer owns decoding
 * and validation.
 */
export interface Setting {
  readonly kind: "setting";
  /** Kebab-case setup key exactly as authored (for example `css-dir`). */
  readonly key: string;
  /**
   * Raw scalar slice exactly as authored, including quotes for strings
   * (`"ui"`, `true`, `12`). Decoders remove quotes and resolve escapes.
   */
  readonly value: string;
  /**
   * Covers the raw {@link value} slice only, excluding the key, colon and
   * terminator. List decoders use it to report per-item spans; it is zero-width
   * when the authored value is empty.
   */
  readonly valueSpan: Span;
  /** Covers the key through the terminating `;`. */
  readonly span: Span;
}

/**
 * A top-level `@use "..." [as alias] [styles];` import.
 *
 * Without the `styles` clause the import brings in tokens only
 * (SPECIFICATION.md §6.1). With it, the target's stylesheet rules are merged
 * into the importing build as well (ADR-0014); merged rules keep the imported
 * module's own `@setup` prefix and are emitted before the importing file's own
 * rules.
 */
export interface UseImport {
  readonly kind: "use";
  /**
   * Raw text between the quotes of the specifier, exactly as authored. CSS
   * string escapes are not decoded here; the resolver decodes them and resolves
   * relative to the importing file.
   */
  readonly path: string;
  /** Explicit namespace from an `as` clause, exactly as authored; `undefined` when absent. */
  readonly alias?: string;
  /**
   * `true` when the authored statement carries the `styles` clause, merging the
   * target's rules into this build (ADR-0014). Absent means a token-only import,
   * which emits no rules of its own (SPECIFICATION.md §6.1).
   */
  readonly styles?: boolean;
  /** Covers `@use` through the terminating `;`. */
  readonly span: Span;
}

/** A `@variables { ... }` block holding compile-time token definitions. */
export interface VariablesBlock {
  readonly kind: "variables";
  /** Token declarations in authored order; duplicates are preserved for diagnostics. */
  readonly tokens: readonly TokenDeclaration[];
  /** Covers `@variables` through the closing `}`. */
  readonly span: Span;
}

/** One compile-time variable definition inside `@variables`. */
export interface TokenDeclaration {
  readonly kind: "token-declaration";
  /** Local variable name without the `$` sigil, exactly as authored. */
  readonly name: string;
  /**
   * Raw value slice exactly as authored; compile-time variables substitute
   * token sequences, not expressions.
   */
  readonly value: string;
  /**
   * Parsed value tokens, present only when {@link value} contains a `$`
   * reference (ADR-0005). Literal content stays in `value` as well.
   */
  readonly tokens?: readonly Token[];
  /** Covers the name through the terminating `;`. */
  readonly span: Span;
}

/** A `@runtime { ... }` block whose declarations emit native custom properties. */
export interface RuntimeBlock {
  readonly kind: "runtime";
  /** Declarations in authored order, including inline variant segments. */
  readonly declarations: readonly Declaration[];
  /** Covers `@runtime` through the closing `}`. */
  readonly span: Span;
}

/** A `@media-types { ... }` block of file-local media alias definitions. */
export interface MediaTypesBlock {
  readonly kind: "media-types";
  /** Alias definitions in authored order; later keys win at merge time. */
  readonly aliases: readonly AliasDeclaration[];
  /** Covers `@media-types` through the closing `}`. */
  readonly span: Span;
}

/** One `alias: condition;` definition inside `@media-types`. */
export interface AliasDeclaration {
  readonly kind: "alias-declaration";
  /** Alias name without the `@` sigil; may begin with a digit (`2xl`). */
  readonly name: string;
  /** Raw media condition text as authored, trimmed of surrounding whitespace. */
  readonly media: string;
  /** Covers the name through the terminating `;`. */
  readonly span: Span;
}

/**
 * A top-level `@group.<name> { ... }` reusable declaration group (ADR-0017).
 *
 * A definition is inert: it emits no CSS and only a matching
 * {@link GroupUseSite} splices its declarations into a rule. The block accepts
 * declarations and nothing else; a nested rule, conditional block, native
 * at-rule or further `@group.` statement inside it is a XESSA1001-family
 * diagnostic and that statement is omitted while the rest of the definition
 * survives. Names are plain CSS identifiers matched exactly and
 * case-sensitively, and the dotted form is contiguous only.
 *
 * An empty or unused definition is legal and produces no diagnostic. Duplicate
 * definitions in one module stay in the AST as separate nodes; the resolver
 * reports the later one as XESSA2001 (plan G2).
 */
export interface GroupDefinition {
  readonly kind: "group-definition";
  /** Group name without the `@group.` prefix, exactly as authored (`card`, `keyframes`). */
  readonly name: string;
  /** Declarations in authored order, including inline variant segments. */
  readonly declarations: readonly Declaration[];
  /** Covers `@group` through the closing `}`. */
  readonly span: Span;
}

/** A selector block: the only place declarations, nested rules and conditional blocks live. */
export interface Rule {
  readonly kind: "rule";
  /** Raw selector list exactly as authored, including functional pseudos and escapes. */
  readonly selector: string;
  /** Covers only the selector text, so diagnostics can point at selectors precisely. */
  readonly selectorSpan: Span;
  /** Declarations, nested rules, conditional blocks and native at-rules in authored order. */
  readonly body: readonly BlockItem[];
  /** Covers the selector through the closing `}`, including the block. */
  readonly span: Span;
}

/** Any construct that may appear inside a rule block or a native at-rule block. */
export type BlockItem = Declaration | Rule | ConditionalBlock | NativeAtRule | GroupUseSite;

/**
 * A `@group.<name> { ... }` use site inside a rule body (ADR-0017).
 *
 * The block is required in v0.1 and holds per-use-site overrides only;
 * expansion splices the group's defaults before these declarations at the
 * authored position (plan G3). A definition is the same syntax at the top level
 * of a file. Inside this block declarations are the only valid statement: a
 * nested rule, conditional block or native at-rule is a XESSA1001-family
 * diagnostic and only that statement is omitted. Conditional use sites such as
 * `@group.x @md { ... }` are out of v1.
 */
export interface GroupUseSite {
  readonly kind: "group-use-site";
  /** Group name without the `@group.` prefix, exactly as authored and case-sensitive. */
  readonly name: string;
  /** Override declarations in authored order, including inline variant segments. */
  readonly declarations: readonly Declaration[];
  /** Covers `@group` through the closing `}`. */
  readonly span: Span;
}

/**
 * A rule-scoped `@md { ... }` conditional block (ADR-0004).
 *
 * A native at-rule inside a conditional block is invalid per the §3.2 grammar
 * and is reported as a XESSA1001-family diagnostic with statement-boundary
 * recovery.
 */
export interface ConditionalBlock {
  readonly kind: "conditional-block";
  /** Parsed modifier combination applied to every member of the block. */
  readonly variant: Modifier;
  /** Conditional blocks contain declarations, nested rules and further conditional blocks only. */
  readonly body: readonly ConditionalBlockItem[];
  /** Covers the modifier through the closing `}`. */
  readonly span: Span;
}

/** Members allowed inside a conditional block by the §3.2 grammar. */
export type ConditionalBlockItem = Declaration | Rule | ConditionalBlock;

/**
 * A property declaration with an optional inline-variant chain.
 *
 * `!important` binds per value segment (ADR-0003): it stays ordinary CSS token
 * content of the segment it terminates and is never propagated to other
 * segments.
 */
export interface Declaration {
  readonly kind: "declaration";
  /** Property name exactly as authored, including custom properties (`--brand`). */
  readonly property: string;
  /** Raw base-value slice, including a trailing `!important` when present. */
  readonly value: string;
  /**
   * Parsed base-value tokens, present only when {@link value} contains a `$`
   * reference (ADR-0005).
   */
  readonly tokens?: readonly Token[];
  /** Inline variants in authored order; empty when the declaration has none. */
  readonly variants: readonly Variant[];
  /**
   * Whether the base value segment carries `!important`. Never implies that any
   * variant is important.
   */
  readonly important?: boolean;
  /** Covers the property through the last value character; the terminating `;` is excluded. */
  readonly span: Span;
}

/** A parsed Xessa condition: one or more aliases joined by `+` (logical AND). */
export interface Modifier {
  /** Alias names in authored order, without `@`; duplicates are preserved until lowering normalizes them. */
  readonly aliases: readonly string[];
  /** Covers the modifier text including `@` and `+` joins. */
  readonly span: Span;
}

/** One inline variant segment: its condition, value and per-segment importance. */
export interface Variant extends Modifier {
  /** Raw value slice for this segment, including a trailing `!important` when present. */
  readonly value: string;
  /**
   * Parsed value tokens, present only when {@link value} contains a `$`
   * reference (ADR-0005).
   */
  readonly tokens?: readonly Token[];
  /** Whether this segment alone carries `!important` (ADR-0003). */
  readonly important?: boolean;
}

/** A native CSS at-rule preserved with its authored meaning. */
export interface NativeAtRule {
  readonly kind: "native-at-rule";
  /** At-rule name without the `@` sigil (for example `media`, `keyframes`, `font-face`). */
  readonly name: string;
  /** Raw prelude text as authored, trimmed of surrounding whitespace; empty when absent. */
  readonly prelude: string;
  /**
   * Parsed block members for block at-rules, or `undefined` for statement
   * at-rules such as `@import` and `@charset`. Contexts that cannot accept
   * Xessa transformations are rejected semantically rather than rewritten.
   */
  readonly block?: readonly BlockItem[];
  /** Covers the `@` name through the block or terminating `;`. */
  readonly span: Span;
}
