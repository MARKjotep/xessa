import type { NamingOptions } from "../types/options.js";

/**
 * Runtime custom-property naming (SPECIFICATION.md §6.2, §7.2).
 *
 * Runtime tokens are emitted as native custom properties whose name is the
 * effective file prefix plus the authored token name:
 *
 * - prefix `ui`, token `primary` → `--ui-primary`;
 * - empty prefix, token `primary` → `--primary`.
 *
 * The prefix is authored configuration, exactly like the class prefix of §7.2,
 * and is copied verbatim. Validating it as a CSS identifier is class-naming
 * work (P4/A09); this pass never rewrites the prefix, so an invalid prefix
 * produces an authoring error rather than a silently renamed property.
 */

/** Options that determine the effective runtime custom-property prefix. */
export interface VariableNamingOptions {
  /**
   * Effective file-level prefix, normally `CompileOptions.prefix` after `@setup`
   * resolution. Empty or omitted means custom properties are unprefixed.
   */
  readonly prefix?: string;
  /**
   * Class-naming options; when `naming.prefix` is present it wins over
   * {@link prefix}, matching the precedence documented on `CompileOptions`
   * (SPECIFICATION.md §7.2).
   */
  readonly naming?: Pick<NamingOptions, "prefix">;
}

/** Resolve the effective prefix for runtime custom-property names. */
export function effectivePrefix(options: VariableNamingOptions = {}): string {
  return options.naming?.prefix ?? options.prefix ?? "";
}

/**
 * Custom-property name for one runtime token.
 *
 * Pure string composition: an empty prefix yields `--<name>`, otherwise
 * `--<prefix>-<name>` (SPECIFICATION.md §6.2 example emits `--ui-primary`).
 */
export function runtimePropertyName(name: string, prefix: string): string {
  return prefix === "" ? `--${name}` : `--${prefix}-${name}`;
}
