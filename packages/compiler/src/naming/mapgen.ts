import type { Diagnostic } from "../types/diagnostics.js";
import { warning } from "../types/diagnostics.js";
import type { ClassEntry, ClassMapResult, ClassTable } from "./types.js";

/**
 * JavaScript class-map and TypeScript declaration generation
 * (SPECIFICATION.md §8, ADR-0010, CSSX-A52).
 *
 * Output contract, fixed here and covered by goldens:
 *
 * - **Named exports only.** The map is one `export const <identifier> = "<emitted>";`
 *   line per local class, in the class table's first-appearance order. There is
 *   no default export and no object literal: the map's single purpose is to
 *   provide the DOM `class` value as an importable JavaScript binding, so
 *   consumers write `import { contactPanel } from "./x.map.js"` and
 *   `class={contactPanel}`. Export order is deterministic.
 * - **Identifier shape.** Each class name is split on `-` and `_` and camelCased
 *   (`card-header` → `cardHeader`, `panel_head` → `panelHead`); leading and
 *   trailing `_` runs are kept (`__proto__` → `__proto__`). Three adjustments
 *   keep every class reachable, because there is no object fallback:
 *   - characters outside the JavaScript identifier set become `_`
 *     (`foo.bar` → `foo_bar`);
 *   - an alias that would start with a digit, or that sanitizes to nothing, is
 *     prefixed with `_` (`2col` → `_2col`, `-` → `_`);
 *   - a reserved word is prefixed with `_` (`default` → `_default`).
 * - **Collisions are resolved, not dropped.** If two classes resolve to the same
 *   identifier, the first-authored class keeps it and later ones get `_2`, `_3`
 *   (… first free suffix) in first-appearance order. Suffixes are allocated
 *   against the identifiers already emitted, so if an earlier export already
 *   uses `fooBar_2`, the next collision becomes `fooBar_3`.
 * - **Diagnostics.** Each adjusted identifier (shape or collision) reports one
 *   XESSA4001 **warning** naming the authored class and the exported binding.
 *   Warnings never fail a build; the output is already complete and unambiguous.
 * - **Declarations mirror the JS exactly** when enabled: one
 *   `export declare const <identifier>: "<emitted>";` line per class in the same
 *   order, with literal string types and no `any`. The declarations are opt-in
 *   (`map-types` / `emit-types`, default off) and never contain a `map` object or
 *   a default export.
 * - `__proto__` needs no special handling: as a `const` binding it is an ordinary
 *   identifier and there is no object literal to poison.
 * - Global classes never reach either file (§8).
 *
 * Formatting is fixed so generated files are stable: one line per binding and
 * one trailing newline. By default the map has no CSS side-effect import;
 * loading the stylesheet is the consumer's responsibility (`<link>` or an
 * explicit `import "./x.css"`). A consumer that wants the map to carry the
 * stylesheet through its bundler opts in with `import-css: true` /
 * `output.importCss` (ADR-0021): exactly one `import "<specifier>";` line is
 * prepended and `.d.ts` declarations stay pure. An empty table yields an empty
 * file unless that import was requested.
 */

/** Options for {@link generateClassMap}. */
export interface ClassMapOptions {
  /**
   * Relative specifier of the emitted stylesheet (ADR-0021). Present only when
   * `import-css` is enabled and the build emits CSS; the caller computes it
   * from the planned artifacts with {@link stylesheetImportSpecifier}.
   */
  readonly cssImport?: string;
}

/** `true` when `name` can be declared as a bare JavaScript binding. */
function isValidJsIdentifier(name: string): boolean {
  return /^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u.test(name);
}

/**
 * Naive camelCase alias before identifier adjustments.
 *
 * Leading and trailing `_` runs are preserved (they carry meaning for names such
 * as `__proto__`), while interior `-`/`_` runs are separators and the following
 * letter is capitalized. A name made only of separators keeps its underscores.
 */
function camelCaseAlias(name: string): string {
  const leading = /^_+/u.exec(name)?.[0] ?? "";
  const rest = name.slice(leading.length);
  const trailing = /_+$/u.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  const parts = core.split(/[-_]+/u).filter((part) => part.length > 0);
  const first = parts[0] ?? "";
  let alias = first;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    alias += part.charAt(0).toUpperCase() + part.slice(1);
  }
  return `${leading}${alias}${trailing}`;
}

/**
 * Words that cannot be a named export binding (or are unsafe as one under ESM
 * strict mode). Kept explicit so the policy is auditable rather than depending
 * on engine behavior.
 */
const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** One exportable class plus its final, unique binding identifier. */
interface PreparedEntry {
  readonly entry: ClassEntry;
  readonly identifier: string;
}

/** Quote a string as a JS/TS double-quoted literal. */
function quote(text: string): string {
  return JSON.stringify(text);
}

/** Base identifier for one class, before uniqueness suffixing. */
function baseIdentifier(name: string): {
  readonly alias: string;
  readonly base: string;
  readonly adjusted: boolean;
} {
  const alias = camelCaseAlias(name);
  let base = alias.replace(/[^\p{ID_Continue}$]/gu, "_");
  let adjusted = base !== alias;
  if (base === "") {
    return { alias, base: "_", adjusted: true };
  }
  if (!isValidJsIdentifier(base) || RESERVED_IDENTIFIERS.has(base)) {
    base = `_${base}`;
    adjusted = true;
  }
  return { alias, base, adjusted };
}

/** Prepare export identifiers and collect XESSA4001 warnings. */
function prepare(table: ClassTable, diagnostics: Diagnostic[]): readonly PreparedEntry[] {
  const exportable = table.entries.filter((entry) => !entry.global);
  const owners = new Map<string, string>();
  const prepared: PreparedEntry[] = [];

  for (const entry of exportable) {
    const { alias, base, adjusted } = baseIdentifier(entry.name);
    let identifier = base;
    let suffix = 1;
    while (owners.has(identifier)) {
      suffix += 1;
      identifier = `${base}_${suffix}`;
    }
    const owner = owners.get(base);
    owners.set(identifier, entry.name);

    if (owner === undefined && adjusted) {
      diagnostics.push(
        warning(
          "XESSA4001",
          `Class "${entry.name}" maps to "${alias}", which is not a usable JavaScript export binding (reserved word or invalid identifier); it is exported as "${identifier}" (SPECIFICATION.md §8).`,
          entry.span,
        ),
      );
    } else if (owner !== undefined) {
      diagnostics.push(
        warning(
          "XESSA4001",
          `Class "${entry.name}" maps to the camelCase identifier "${alias}", which class "${owner}" already exports; it is exported as "${identifier}" (SPECIFICATION.md §8).`,
          entry.span,
        ),
      );
    }

    prepared.push({ entry, identifier });
  }

  return prepared;
}

/**
 * Generate the ESM class map and matching `.d.ts` text for one class table.
 *
 * Pure and deterministic: the same table and options always produce
 * byte-identical text. Global classes are excluded; reserved identifiers and
 * digit-leading names are prefixed with `_` and identifier collisions get a
 * numeric suffix, each with one XESSA4001 warning.
 *
 * @param classes Class table produced by `renameClasses`.
 * @param options Optional stylesheet import (ADR-0021).
 */
export function generateClassMap(
  classes: ClassTable,
  options: ClassMapOptions = {},
): ClassMapResult {
  const diagnostics: Diagnostic[] = [];
  const prepared = prepare(classes, diagnostics);

  const jsLines: string[] = [];
  if (options.cssImport !== undefined && options.cssImport !== "") {
    jsLines.push(`import ${quote(options.cssImport)};`);
  }
  for (const entry of prepared) {
    jsLines.push(`export const ${entry.identifier} = ${quote(entry.entry.emitted)};`);
  }

  const typeLines = prepared.map(
    (entry) => `export declare const ${entry.identifier}: ${quote(entry.entry.emitted)};`,
  );

  return {
    js: jsLines.length === 0 ? "" : `${jsLines.join("\n")}\n`,
    types: typeLines.length === 0 ? "" : `${typeLines.join("\n")}\n`,
    diagnostics,
  };
}
