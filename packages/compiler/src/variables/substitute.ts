import { declarationIr } from "../ir/factories.js";
import type { DeclarationIr, StylesheetIr } from "../ir/types.js";
import type { ModuleGraph } from "../resolver/index.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Token } from "../types/token.js";
import { groupDefaultSegments, segmentValueTokens } from "./ast.js";
import { expandValue } from "./expand.js";
import type { ExpansionHooks, ValueOrigin } from "./expand.js";
import { effectivePrefix, runtimePropertyName } from "./naming.js";
import type { VariableNamingOptions } from "./naming.js";
import { mapIrDeclarations } from "./walk.js";

/**
 * Compile-time variable substitution (SPECIFICATION.md §6.1).
 *
 * Pure post-lowering pass: for every {@link DeclarationIr} value that contains a
 * `$`, the authored slice is re-scanned with the A03 lexer, each `$name` /
 * `$name.member` reference is resolved against the scope of the module that
 * **authored** the declaration, and compile-time values are spliced in
 * textually. (Values without `$` are passed through untouched: a `dollar-ref`
 * token always contains `$`.) Runtime references become
 * `var(--<prefix>-<name>)` so `@runtime` tokens keep their native cascade
 * (`emitRuntimeTokens` emits the custom-property rules).
 *
 * The authoring module is `declaration.span.file`, not the module being
 * substituted: `@group.<name>` expansion splices another module's declarations
 * at the use site with their own authored spans, so a group default's `$refs`
 * resolve in the defining module while use-site declarations resolve in the
 * consumer (ADR-0017 item 6). For ordinary, non-expanded declarations the two
 * modules are the same.
 *
 * Policies, all deterministic:
 *
 * - An unresolvable reference (undefined token, unknown namespace or member, a
 *   bare namespace, a reference cycle or an over-deep chain) is XESSA2001 at
 *   the reference span, and the **declaration segment** is omitted. A `$` never
 *   leaks into CSS.
 * - A `@runtime` reference inside a group default is XESSA2001 and the segment
 *   is omitted: owner decision (b) keeps defaults compile-time only, so they are
 *   never rewritten with the consuming build's prefix (ADR-0017 item 6).
 * - The built-in `keyframes` namespace (ADR-0015) is not a variable:
 *   `$keyframes.<name>` expands to the authored name text of a visible
 *   `@keyframes` block.
 * - A rule whose declarations are all omitted is dropped, and a native block
 *   whose children are all dropped is dropped too, so no empty shells that
 *   could change cascade or at-rule validity are emitted. Statement at-rules
 *   (`@import`, ...) are always kept.
 * - Spans are unchanged. The IR carries no value-offset field, so the exact
 *   reference offset is recovered from the AST's parsed value tokens (ADR-0005,
 *   keyed by segment start); when an IR node has no authored counterpart the
 *   segment span is reported instead.
 * - Only the value text changes; `property`, `important`, conditions, native
 *   contexts, selectors and node order are preserved byte for byte.
 */

/** Result of {@link substitute}. */
export interface SubstituteResult {
  /** Rewritten, re-frozen stylesheet IR (the input instance when nothing changed). */
  readonly ir: StylesheetIr;
  /** XESSA2001 diagnostics in IR order, one per rejected reference. */
  readonly diagnostics: Diagnostic[];
}

/** Authored value index of one module: segment tokens plus group-default origins. */
interface ModuleOrigins {
  /** Parsed value tokens keyed by segment start offset. */
  readonly segments: Map<number, readonly Token[]>;
  /** Segment starts authored inside a top-level `@group.<name>` definition. */
  readonly groupDefaults: ReadonlySet<number>;
}

/**
 * Substitute every compile-time variable reference in `ir`.
 *
 * @param ir Lowered IR of `entryFile` (parse → `buildModuleGraph` → `lower`).
 * @param graph Module graph produced by A07; supplies scopes and token values.
 * @param entryFile Canonical path of the module that owns `ir`, used for
 *   references whose authored module cannot be read from their span.
 * @param options Runtime custom-property prefix used to render `var(...)`
 *   references. It must match the prefix passed to `emitRuntimeTokens`.
 */
export function substitute(
  ir: StylesheetIr,
  graph: ModuleGraph,
  entryFile: string,
  options: VariableNamingOptions = {},
): SubstituteResult {
  const prefix = effectivePrefix(options);
  const diagnostics: Diagnostic[] = [];

  // Earlier group expansion can splice declarations authored in another module,
  // so the token scope is selected per declaration from its authored span
  // (ADR-0017 item 6). Indexes are built once per module and cached.
  const origins = new Map<string, ModuleOrigins>();
  const originsFor = (file: string): ModuleOrigins => {
    const cached = origins.get(file);
    if (cached !== undefined) return cached;
    const ast = graph.modules.get(file)?.ast;
    const built: ModuleOrigins = {
      segments: segmentValueTokens(ast),
      groupDefaults: groupDefaultSegments(ast),
    };
    origins.set(file, built);
    return built;
  };

  const mapped = mapIrDeclarations(ir, (declaration) => {
    const authored = declaration.span.file === "" ? entryFile : declaration.span.file;
    const module = graph.modules.has(authored) ? authored : entryFile;
    const index = originsFor(module);
    // Expanded group defaults are the only IR declarations whose segment lives
    // inside a `@group` definition; definitions never emit on their own.
    const groupDefault = index.groupDefaults.has(declaration.span.start);
    if (!declaration.value.includes("$")) return declaration;

    let rejectedRuntime = false;
    const hooks: ExpansionHooks = {
      runtimeRef: (token, authoredText) => {
        if (!groupDefault) return `var(${runtimePropertyName(token.name, prefix)})`;
        if (!rejectedRuntime) {
          diagnostics.push(
            error(
              "XESSA2001",
              `A @runtime token is not allowed in a group default: "${authoredText}" (ADR-0017); reference runtime tokens at the use site.`,
              declaration.span,
            ),
          );
        }
        rejectedRuntime = true;
        return "";
      },
      report: (diagnostic) => diagnostics.push(diagnostic),
    };
    const tokens = index.segments.get(declaration.span.start);
    const origin: ValueOrigin = {
      module,
      start: tokens?.[0]?.start ?? null,
      fallback: declaration.span,
    };
    const expanded = expandValue(declaration.value, origin, graph, hooks);
    if (rejectedRuntime || expanded === null) return null;
    if (expanded === declaration.value) return declaration;
    return declarationIr(declaration.property, expanded, declaration.span, declaration.important);
  });

  return { ir: mapped.ir, diagnostics };
}
