/**
 * Compile-time variables and runtime tokens (P3, SPECIFICATION.md §6).
 *
 * Two pure passes complete the variables story of the pipeline:
 *
 * 1. {@link substitute} — resolves every `$name` / `$name.member` reference in
 *    declaration values against A07's module scopes, splices compile-time values
 *    textually (recursively, in each value's defining module) and rewrites
 *    runtime references to `var(--...)`. Undefined symbols, unknown namespaces
 *    or members and reference cycles are XESSA2001 at the reference span and the
 *    affected declaration segment is omitted, so a literal `$` never reaches
 *    CSS. The built-in `keyframes` namespace (ADR-0015) expands
 *    `$keyframes.<name>` to the authored keyframe name text.
 * 2. {@link emitRuntimeTokens} — emits `:root` custom-property rules for
 *    `@runtime` tokens (prefix-aware) with conditional `:root` overrides for
 *    inline variants, resolves duplicate property names in merge order with the
 *    entry last (ADR-0016), and rewrites runtime references in declaration values.
 *
 * Canonical pipeline position for consumers:
 *
 * ```text
 * parse → buildModuleGraph → lower → substitute → emitRuntimeTokens
 *       → (P4: class rewrite → groupRuns) → emitCss
 * ```
 *
 * Both passes are deterministic, frozen-output and filesystem-free; they never
 * read the AST for source text, mutate their inputs or throw on malformed IR.
 * Barrel wiring is lead-directed; import this facade until integration.
 */

export { emitRuntimeTokens } from "./runtime.js";
export type { RuntimeEmitOptions, RuntimeEmitResult } from "./runtime.js";

export { substitute } from "./substitute.js";
export type { SubstituteResult } from "./substitute.js";

export { effectivePrefix, runtimePropertyName } from "./naming.js";
export type { VariableNamingOptions } from "./naming.js";
