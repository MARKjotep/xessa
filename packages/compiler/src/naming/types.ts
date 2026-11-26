import type { StylesheetIr } from "../ir/types.js";
import type { Diagnostic } from "../types/diagnostics.js";
import type { NamingStrategy } from "../types/options.js";
import type { Span } from "../types/span.js";

/**
 * Public shapes of the class-naming stage (SPECIFICATION.md §7.2, §8).
 *
 * The stage is two pure passes: {@link renameClasses} rewrites selectors and
 * builds a {@link ClassTable}; `generateClassMap` turns that table into an ESM
 * module of camelCase `export const` bindings plus opt-in `.d.ts` declarations.
 * The table is the single source of truth for both, so the CSS class text, the
 * exported bindings and the declaration file can never disagree (ADR-0010).
 */

/**
 * Class-naming configuration accepted by {@link renameClasses}.
 *
 * Structurally compatible with the frozen `NamingOptions` but with an optional
 * strategy, so callers may pass either resolved options or a projection.
 */
export interface ClassNamingOptions {
  /** `none` keeps authored names; `prefix` prepends the effective prefix. */
  readonly strategy?: NamingStrategy;
  /** Prefix for the `prefix` strategy; empty leaves names unchanged. */
  readonly prefix?: string;
}

/** Options for {@link renameClasses}. */
export interface RenameOptions {
  /**
   * Effective file prefix. Overridden by {@link RenameOptions.naming}. Omitted
   * or empty means names are unchanged (`SPECIFICATION.md` §7.2).
   */
  readonly prefix?: string;
  /** Strategy and prefix; `naming.prefix` wins over {@link RenameOptions.prefix}. */
  readonly naming?: ClassNamingOptions;
}

/**
 * One class name discovered in the lowered stylesheet.
 *
 * `name` is the decoded CSS class name: `.\31 23` yields `"123"` and
 * `.status\:active` yields `"status:active"`, because a class identity is its
 * decoded text, not its source spelling. `emitted` is the decoded name after
 * the naming table is applied. A renamed entry has no CSS escapes (the result
 * is validated as a bare CSS identifier); an unprefixed entry keeps its
 * authored selector bytes even when they contain escapes.
 */
export interface ClassEntry {
  /** Decoded authored class name; the source of the map's camelCase binding. */
  readonly name: string;
  /** Decoded emitted class name; what `className` must use in applications. */
  readonly emitted: string;
  /** `true` when this name came only from a `:global(...)` escape. */
  readonly global: boolean;
  /** `true` when `emitted` differs from `name` because the prefix applied. */
  readonly renamed: boolean;
  /** First occurrence of the name, used for diagnostics. */
  readonly span: Span;
}

/**
 * First-appearance-ordered class table for one stylesheet.
 *
 * Entries include global classes so diagnostics and the rewrite can reason about
 * them, but globals are excluded from map generation by `generateClassMap`
 * (§3.6 "Global classes are not exported"). Names are unique; the first
 * occurrence fixes the position, and a later local occurrence upgrades a
 * previously global-only entry in place.
 */
export interface ClassTable {
  /** Unique entries in first-appearance order across the IR walk. */
  readonly entries: readonly ClassEntry[];
}

/** Result of {@link renameClasses}. */
export interface RenameResult {
  /** Rewritten, re-frozen IR (the input instance when nothing changed). */
  readonly ir: StylesheetIr;
  /** Naming table covering every local and global class token. */
  readonly classes: ClassTable;
  /** XESSA4001 diagnostics for invalid prefixes or invalid prefixed results. */
  readonly diagnostics: Diagnostic[];
}

/**
 * Result of `generateClassMap`.
 *
 * The generated map has no CSS side-effect import: style loading belongs to the
 * page (`<link>`) or the bundler (`import "./x.css"`).
 */
export interface ClassMapResult {
  /** ESM JavaScript class map: one `export const` binding per class. */
  readonly js: string;
  /** Opt-in TypeScript declarations mirroring {@link ClassMapResult.js} exactly. */
  readonly types: string;
  /** XESSA4001 warnings for adjusted export identifiers. */
  readonly diagnostics: Diagnostic[];
}
