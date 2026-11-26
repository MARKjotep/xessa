/**
 * Selector flattening: nested authored selectors to flat CSS selector lists.
 *
 * The module is pure and zero-dependency. `flattenSelector` implements the
 * nesting contract of ADR-0002 (bare nested selector = descendant) and
 * ADR-0012 (`&` substitution in any position, escaped ampersands and strings
 * untouched). `flattenIr` applies the same logic to a lowered stylesheet IR as
 * the explicit pipeline step before `emitCss`.
 *
 * Class naming, prefixing and `:global(...)` removal are not performed here;
 * they belong to P4/A09 and run after flattening.
 */
export { FLATTEN_LIMITS, flattenIr, flattenSelector } from "./flatten.js";
export type { FlattenFailure, FlattenResult, FlattenedSelector } from "./flatten.js";
