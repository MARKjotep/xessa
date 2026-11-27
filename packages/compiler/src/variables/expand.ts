import { tokenize } from "../lexer/index.js";
import { KEYFRAMES_NAMESPACE } from "../resolver/index.js";
import type { ModuleGraph, ScopedToken } from "../resolver/index.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { Span } from "../types/span.js";

/**
 * `$`-reference resolution and textual expansion (SPECIFICATION.md §6.1).
 *
 * Both passes share this core: substitution renders compile-time tokens
 * textually and runtime tokens as `var(--...)`, while runtime emission reuses
 * the same walk for `@runtime` values. Resolution always uses the token scope
 * of the module whose text is being expanded, so imported values resolve in
 * their defining module and a local override never mutates an imported module
 * (§6.1).
 *
 * One position is special (SPECIFICATION.md §6.2): when a `$` reference is the
 * entire first argument of an authored `var(` call, a runtime token renders as
 * the bare custom-property name (`var($primary, #333)` → `var(--ui-primary,
 * #333)`) and a build-time reference is rejected as XESSA2001. Every other
 * position keeps the normal `var(--...)` or inline rendering.
 *
 * Expansion is textual, not evaluative: the authored slice is spliced, so
 * whitespace, `calc()` spacing, comments and every non-reference token stay
 * byte-identical. The built-in `keyframes` namespace (ADR-0015) is the one
 * reference family with no declaring value: `$keyframes.<name>` resolves to the
 * authored keyframe name text and is spliced as a literal.
 */

/** Maximum nested compile-time expansions before a chain is rejected. */
export const MAX_EXPANSION_DEPTH = 64;

/**
 * Where one value text came from.
 *
 * `module` selects the scope used to resolve references in the text. `start`
 * is the absolute source offset of `text[0]` when it is known (the AST keeps
 * parsed value tokens for values containing `$`, ADR-0005), which lets
 * diagnostics point at the exact reference; otherwise `fallback` (the owning
 * declaration or segment) is used.
 */
export interface ValueOrigin {
  /** Canonical path of the module that authored the text. */
  readonly module: string;
  /** Absolute offset of the first character of the text, or `null` when unknown. */
  readonly start: number | null;
  /** Span reported when the exact reference offset cannot be derived. */
  readonly fallback: Span;
}

/**
 * How a runtime reference is rendered.
 *
 * - `value` is the normal position: `var(--<prefix>-<name>)`.
 * - `name` is the first argument of an authored `var()` call, where the
 *   custom-property name itself is expected, not another `var()`.
 */
export type RuntimeReferenceUsage = "value" | "name";

/** Hooks that make expansion policy explicit for each caller. */
export interface ExpansionHooks {
  /**
   * Renders a reference to a runtime token. Substitution and runtime emission
   * both emit `var(--...)` for `value` and the bare custom-property name for
   * `name`; the authored text is passed for diagnostics.
   */
  readonly runtimeRef: (
    token: ScopedToken,
    authored: string,
    usage: RuntimeReferenceUsage,
  ) => string;
  /** Receives one diagnostic per rejected reference. */
  readonly report: (diagnostic: Diagnostic) => void;
}

/** One authored `$name` or `$name.member` reference. */
export interface TokenReference {
  /** Symbol name without the `$` sigil or namespace. */
  readonly name: string;
  /** Namespace alias without the `$` sigil, when the reference is `$ns.member`. */
  readonly namespace?: string;
}

/**
 * Resolution outcome for one reference.
 *
 * `text` is a built-in compile-time reference whose expansion is literal CSS
 * text rather than another value: `$keyframes.<name>` becomes the authored
 * keyframe name (ADR-0015). It is spliced as-is and never recursed into.
 */
export type ReferenceResolution =
  | { readonly kind: "compile"; readonly token: ScopedToken }
  | { readonly kind: "runtime"; readonly token: ScopedToken }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "error"; readonly diagnostic: Diagnostic };

/**
 * Split authored `$ref` token text into name and optional namespace.
 *
 * Escapes are preserved: an escaped dot (`$a\.b`) stays part of the name
 * because CSS escapes never introduce a member separator. Returns `null` for a
 * bare `$`, which the lexer never emits as `dollar-ref` anyway.
 */
export function splitReference(authored: string): TokenReference | null {
  if (!authored.startsWith("$") || authored.length < 2) return null;
  const body = authored.slice(1);
  for (let index = 0; index < body.length; index++) {
    const character = body[index] as string;
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "." && index > 0 && index < body.length - 1) {
      return { name: body.slice(index + 1), namespace: body.slice(0, index) };
    }
  }
  return { name: body };
}

function fail(message: string, span: Span): ReferenceResolution {
  return { kind: "error", diagnostic: error("XESSA2001", message, span) };
}

/** One open `(` while scanning for `var()` first arguments. */
interface ArgumentFrame {
  /** Whether this call is a case-insensitive `var(`. */
  readonly isVar: boolean;
  /** Offset just after `(` or after the previous top-level comma. */
  argumentStart: number;
  /** Zero-based index of the current argument. */
  argumentIndex: number;
}

/** CSS whitespace, the only characters trimmed around a `var()` argument. */
const ARGUMENT_WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

/**
 * `"<start>:<end>"` keys of `$` ranges that are the entire first argument of a
 * `var()` call.
 *
 * The scan is structural rather than tokenizing: it tracks parentheses, quotes
 * and comments so `VAR(`, nested calls and quoted `var(` text behave, and each
 * `var()` first argument is trimmed of CSS whitespace. A range only counts when
 * it exactly equals one lexer `dollar-ref` token (checked by the caller), so
 * `var($a + 1px)` or `var(--x, $a)` never matches. Calls nested in a first
 * argument are independent: the inner call contributes its own range.
 */
function varFirstArgumentKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const stack: ArgumentFrame[] = [];
  let quote: string | null = null;

  const closeArgument = (frame: ArgumentFrame, end: number): void => {
    if (!frame.isVar || frame.argumentIndex !== 0) return;
    let start = frame.argumentStart;
    while (start < end && ARGUMENT_WHITESPACE.has(text[start] as string)) start++;
    let trimmedEnd = end;
    while (trimmedEnd > start && ARGUMENT_WHITESPACE.has(text[trimmedEnd - 1] as string)) {
      trimmedEnd--;
    }
    if (start < trimmedEnd) keys.add(`${start}:${trimmedEnd}`);
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (character === "\\") {
      index++;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close === -1 ? text.length : close + 1;
      continue;
    }
    if (character === "(") {
      let nameStart = index;
      while (nameStart > 0 && /[A-Za-z0-9_-]/.test(text[nameStart - 1] as string)) nameStart--;
      stack.push({
        isVar: text.slice(nameStart, index).toLowerCase() === "var",
        argumentStart: index + 1,
        argumentIndex: 0,
      });
      continue;
    }
    if (character === ",") {
      const frame = stack[stack.length - 1];
      if (frame === undefined) continue;
      closeArgument(frame, index);
      frame.argumentIndex += 1;
      frame.argumentStart = index + 1;
      continue;
    }
    if (character === ")") {
      const frame = stack.pop();
      if (frame !== undefined) closeArgument(frame, index);
    }
  }
  for (const frame of stack) closeArgument(frame, text.length);
  return keys;
}

/** Rejection for a build-time reference in the custom-property-name position. */
function varNameError(authored: string, span: Span): Diagnostic {
  return error(
    "XESSA2001",
    `"${authored}" cannot be the first argument of var(): it is resolved at build time, so the custom-property name would be a literal value. Use a @runtime token instead, or write the property name directly (for example var(--name)).`,
    span,
  );
}

/**
 * Resolve one reference against a module's scopes.
 *
 * A bare `$name` consults the compile-time scope first, then the runtime scope
 * (A07 handoff: the resolver already merged unqualified imports so a local
 * definition shadows them). `$ns.member` consults only the namespace member
 * maps, never the merged `$name` table, so namespaced imports stay independent
 * (§6.1). Every failure is a XESSA2001 with the reference span.
 */
export function resolveReference(
  reference: TokenReference,
  module: string,
  graph: ModuleGraph,
  span: Span,
): ReferenceResolution {
  const record = graph.modules.get(module);
  const display =
    reference.namespace === undefined
      ? `$${reference.name}`
      : `$${reference.namespace}.${reference.name}`;

  if (record === undefined) {
    return fail(
      `Module "${module}" is missing from the module graph, so "${display}" cannot be resolved.`,
      span,
    );
  }

  if (reference.namespace === undefined) {
    const compile = record.compileScope.tokens.get(reference.name);
    if (compile !== undefined) return { kind: "compile", token: compile };
    const runtime = record.runtimeScope.tokens.get(reference.name);
    if (runtime !== undefined) return { kind: "runtime", token: runtime };
    if (reference.name === KEYFRAMES_NAMESPACE) {
      return fail(
        `"$${reference.name}" is a built-in namespace, not a token; reference a member such as "$${reference.name}.<name>".`,
        span,
      );
    }
    if (
      record.compileScope.namespaces.has(reference.name) ||
      record.runtimeScope.namespaces.has(reference.name)
    ) {
      return fail(
        `"$${reference.name}" is a namespace, not a token; reference a member such as "$${reference.name}.<name>".`,
        span,
      );
    }
    return fail(`Undefined token "${display}" in "${module}".`, span);
  }

  // Built-in `keyframes` namespace (ADR-0015): a compile-time reference that
  // expands to the authored keyframe name. Visibility is resolved by the module
  // graph (own blocks plus `styles` imports), so an unknown member and an
  // out-of-scope name both stay XESSA2001 with the segment omitted.
  if (reference.namespace === KEYFRAMES_NAMESPACE) {
    const keyframe = record.keyframes.get(reference.name);
    if (keyframe === undefined) {
      return fail(
        `Unknown keyframe "${display}" in "${module}"; "$keyframes" exposes this file's own @keyframes names and those of modules imported with @use "..." styles (ADR-0015).`,
        span,
      );
    }
    return { kind: "text", text: keyframe.name };
  }

  const compileNamespace = record.compileScope.namespaces.get(reference.namespace);
  const runtimeNamespace = record.runtimeScope.namespaces.get(reference.namespace);
  const namespace = compileNamespace ?? runtimeNamespace;
  if (namespace === undefined) {
    return fail(
      `Unknown token namespace "$${reference.namespace}" in "${module}"; import it with @use "..." as ${reference.namespace}.`,
      span,
    );
  }

  const compileMember = compileNamespace?.members.get(reference.name);
  if (compileMember !== undefined) return { kind: "compile", token: compileMember };
  const runtimeMember = runtimeNamespace?.members.get(reference.name);
  if (runtimeMember !== undefined) return { kind: "runtime", token: runtimeMember };
  return fail(
    `Module "${namespace.module}" does not export "${display}" through namespace "$${reference.namespace}".`,
    span,
  );
}

/**
 * Absolute span of one `dollar-ref` token, or `null` when it is not authored.
 *
 * `text` is normally the authored slice starting at `origin.start`, but a
 * rewritten value can contain generated `$` characters: an invalid `@setup
 * prefix` such as `"$"` renders a runtime reference as `var(--$-p)`, and
 * re-lexing that text would invent `$-p` at offsets taken from the *authored*
 * base, ending past the end of the file. Offsets are only trusted while they
 * still fall inside the fallback span of the text they were derived from; any
 * other `$` is output from an earlier pass, not a reference the author wrote.
 */
function referenceSpan(origin: ValueOrigin, start: number, end: number): Span | null {
  if (origin.start === null) return origin.fallback;
  const absoluteStart = origin.start + start;
  const absoluteEnd = origin.start + end;
  const authored = origin.fallback;
  if (absoluteStart < authored.start || absoluteEnd > authored.end || absoluteStart > absoluteEnd) {
    return null;
  }
  return { start: absoluteStart, end: absoluteEnd, file: origin.module };
}

/** `$name` display form used in cycle chains. */
function displayName(key: string): string {
  return `$${key.slice(key.lastIndexOf("\u0000") + 1)}`;
}

function tokenKey(token: ScopedToken): string {
  return `compile\u0000${token.module}\u0000${token.name}`;
}

/**
 * Expand every `$` reference in `text`, or return `null` when a reference is
 * rejected.
 *
 * Each resolved compile-time token inserts its defining module's raw value,
 * recursively expanded in that module's scope. A repeated token on the current
 * expansion stack, or a chain longer than {@link MAX_EXPANSION_DEPTH}, is a
 * XESSA2001 cycle/depth error and aborts the value so the caller can omit the
 * affected construct instead of leaking a literal `$`.
 *
 * Purity: the input text and graph are never mutated, and the result is a new
 * string. Lexer diagnostics from re-scanning a value slice are intentionally
 * ignored; the parser already owns lexical reporting.
 */
export function expandValue(
  text: string,
  origin: ValueOrigin,
  graph: ModuleGraph,
  hooks: ExpansionHooks,
  stack: readonly string[] = [],
): string | null {
  if (!text.includes("$")) return text;

  const { tokens } = tokenize(text, origin.module);
  // Only `$` references that *are* the first argument of `var(` are shorthand
  // for the custom-property name; any other position keeps the existing rules.
  const varNameKeys = /var\(/i.test(text) ? varFirstArgumentKeys(text) : null;
  let output = "";
  let cursor = 0;
  let changed = false;

  for (const token of tokens) {
    if (token.kind !== "dollar-ref") continue;
    const reference = splitReference(token.value);
    if (reference === null) continue;
    const span = referenceSpan(origin, token.start, token.end);
    if (span === null) continue;
    const resolution = resolveReference(reference, origin.module, graph, span);
    if (resolution.kind === "error") {
      hooks.report(resolution.diagnostic);
      return null;
    }
    const asVarName = varNameKeys?.has(`${token.start}:${token.end}`) === true;

    if (resolution.kind === "runtime") {
      output += text.slice(cursor, token.start);
      output += hooks.runtimeRef(resolution.token, token.value, asVarName ? "name" : "value");
      cursor = token.end;
      changed = true;
      continue;
    }

    if (resolution.kind === "text") {
      if (asVarName) {
        hooks.report(varNameError(token.value, span));
        return null;
      }
      // Built-in compile-time text (`$keyframes.<name>`, ADR-0015): spliced
      // verbatim, never expanded recursively, so no `$` can survive here.
      output += text.slice(cursor, token.start);
      output += resolution.text;
      cursor = token.end;
      changed = true;
      continue;
    }

    // A compile-time token in the name position would make `var()` receive a
    // literal value; reject instead of emitting invalid CSS.
    if (asVarName) {
      hooks.report(varNameError(token.value, span));
      return null;
    }

    const definition = resolution.token;
    const key = tokenKey(definition);
    if (stack.includes(key)) {
      const chain = [...stack.map(displayName), displayName(key)].join(" -> ");
      hooks.report(error("XESSA2001", `Detected a variable reference cycle: ${chain}.`, span));
      return null;
    }
    if (stack.length >= MAX_EXPANSION_DEPTH) {
      hooks.report(
        error(
          "XESSA2001",
          `Variable expansion exceeded ${MAX_EXPANSION_DEPTH} nested references at "$${definition.name}".`,
          span,
        ),
      );
      return null;
    }

    const nested = expandValue(
      definition.declaration.value,
      {
        module: definition.module,
        start: definition.declaration.tokens?.[0]?.start ?? null,
        fallback: definition.span,
      },
      graph,
      hooks,
      [...stack, key],
    );
    if (nested === null) return null;

    output += text.slice(cursor, token.start);
    output += nested;
    cursor = token.end;
    changed = true;
  }

  if (!changed) return text;
  return output + text.slice(cursor);
}
