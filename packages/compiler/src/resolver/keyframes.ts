/**
 * Built-in `keyframes` namespace collection (ADR-0015).
 *
 * Authored `@keyframes <name>` blocks are native CSS and keep their meaning.
 * This module only records their names so `$keyframes.<name>` in a declaration
 * value can expand to the plain name text at compile time. It never rewrites,
 * reorders or validates the at-rule itself.
 *
 * Visibility follows emit safety, not import syntax: a name is referenceable
 * when the consuming build actually emits its `@keyframes` block. That is the
 * module's own top-level blocks plus every module reached through a `styles`
 * `@use` edge (ADR-0014), transitively. Token-only imports contribute no CSS,
 * so referencing one of their names would emit `animation-name: spin` with no
 * `@keyframes spin` block — a broken runtime stylesheet — and is therefore not
 * visible.
 */

import type { NativeAtRule, Stylesheet } from "../types/ast.js";
import type { KeyframeName } from "./types.js";

/** Built-in namespace alias that exposes visible keyframe names (ADR-0015). */
export const KEYFRAMES_NAMESPACE = "keyframes";

/**
 * A prelude that can be addressed as `$keyframes.<member>`.
 *
 * Only a single plain identifier qualifies. CSS also allows string-named
 * keyframes (`@keyframes "fade"`) and escaped identifiers; those stay native CSS
 * and are not addressable in v0.1 (documented in `docs/known-limitations.md`),
 * because the `$keyframes.<member>` member text must match the emitted name
 * byte for byte.
 */
const PLAIN_KEYFRAMES_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

/**
 * Collect one module's top-level `@keyframes` names in authored order.
 *
 * The first declaration of a name wins so the result is deterministic. A
 * repeated name needs no diagnostic: both blocks are emitted (native CSS keeps
 * the later definition) and every reference expands to the same name text
 * (ADR-0015).
 */
export function collectKeyframes(ast: Stylesheet): KeyframeName[] {
  const names: KeyframeName[] = [];
  const seen = new Set<string>();

  for (const item of ast.items) {
    if (item.kind !== "native-at-rule" || !isKeyframesAtRule(item)) continue;
    const name = item.prelude.trim();
    if (!PLAIN_KEYFRAMES_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    names.push({ name, module: ast.file, span: item.span });
  }

  return names;
}

/**
 * Per-module inputs for {@link visibleKeyframes}.
 *
 * Split from {@link ModuleRecord} because the record stores the *computed*
 * visibility, so building the closure must not depend on it.
 */
export interface KeyframeSource {
  /** Top-level `@keyframes` names authored in this module, first definition wins. */
  readonly own: readonly KeyframeName[];
  /** Canonical paths of `styles` `@use` targets, in authored order (ADR-0014). */
  readonly styleDependencies: readonly string[];
}

/**
 * Resolve every module's visible keyframe names.
 *
 * Order is own names first, then each `styles` dependency depth-first in authored
 * order, then that dependency's own merge closure. The module's own definition
 * (and the first visited dependency) wins for a repeated name; the value only
 * carries provenance — every reference expands to the same authored name text,
 * so a repeated name across merged modules is *not* an error (ADR-0015).
 *
 * Modules are visited in sorted canonical-path order with a shared memo, so the
 * result is deterministic even when a cycle is present (cycles are already
 * XESSA2001 at the closing edge; a back edge contributes nothing).
 */
export function visibleKeyframes(
  sources: ReadonlyMap<string, KeyframeSource>,
): ReadonlyMap<string, ReadonlyMap<string, KeyframeName>> {
  const memo = new Map<string, Map<string, KeyframeName>>();
  const files = [...sources.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  for (const file of files) resolve(file, sources, memo, new Set());

  return memo;
}

function resolve(
  file: string,
  sources: ReadonlyMap<string, KeyframeSource>,
  memo: Map<string, Map<string, KeyframeName>>,
  visiting: Set<string>,
): Map<string, KeyframeName> {
  const cached = memo.get(file);
  if (cached !== undefined) return cached;
  const source = sources.get(file);
  if (source === undefined) return new Map();

  // Post-error recovery: a back edge in a cycle contributes nothing, keeping the
  // walk terminating and deterministic (the cycle itself is already reported).
  if (visiting.has(file)) return new Map();
  visiting.add(file);

  const visible = new Map<string, KeyframeName>();
  for (const keyframe of source.own) {
    if (!visible.has(keyframe.name)) visible.set(keyframe.name, keyframe);
  }
  for (const dependency of source.styleDependencies) {
    for (const [name, keyframe] of resolve(dependency, sources, memo, visiting)) {
      if (!visible.has(name)) visible.set(name, keyframe);
    }
  }

  visiting.delete(file);
  memo.set(file, visible);
  return visible;
}

/** At-rule names are ASCII case-insensitive, matching the parser's native set. */
function isKeyframesAtRule(item: NativeAtRule): boolean {
  return item.name.toLowerCase() === KEYFRAMES_NAMESPACE;
}
