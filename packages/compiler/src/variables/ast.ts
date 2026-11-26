import type { BlockItem, Declaration, Stylesheet, TokenDeclaration } from "../types/ast.js";
import type { Span } from "../types/span.js";
import type { Token } from "../types/token.js";
import { splitReference } from "./expand.js";
import type { TokenReference } from "./expand.js";

/**
 * AST lookups used by substitution and runtime emission.
 *
 * The AST keeps absolute token offsets for values that contain `$` references
 * (ADR-0005), which is exactly the provenance needed to report a reference at
 * its authored position after lowering has replaced the AST with the IR.
 */

/** One authored `$` reference found in the AST, with its absolute span. */
export interface AstReference {
  /** Parsed name and optional namespace. */
  readonly reference: TokenReference;
  /** Exact authored span of the reference token. */
  readonly span: Span;
}

/**
 * Map each declaration segment start to its parsed value tokens.
 *
 * Lowering tiles a declaration span into one segment per value (A05), and the
 * IR keeps that segment origin in `DeclarationIr.span`, so an IR declaration
 * can recover the authored tokens by its `span.start`. The value is `undefined`
 * when the authored segment contains no `$` reference (`tokens` is optional by
 * contract), which is also the case where substitution has nothing to do.
 */
export function segmentValueTokens(ast: Stylesheet | undefined): Map<number, readonly Token[]> {
  const segments = new Map<number, readonly Token[]>();
  if (ast === undefined) return segments;

  const addDeclaration = (declaration: Declaration): void => {
    if (declaration.tokens !== undefined) segments.set(declaration.span.start, declaration.tokens);
    for (const variant of declaration.variants) {
      if (variant.tokens !== undefined) segments.set(variant.span.start, variant.tokens);
    }
  };

  const visitBody = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "declaration":
          addDeclaration(item);
          break;
        case "rule":
          visitBody(item.body);
          break;
        case "conditional-block":
          visitBody(item.body);
          break;
        case "native-at-rule":
          if (item.block !== undefined) visitBody(item.block);
          break;
        case "group-use-site":
          // Use-site overrides are ordinary declarations of the consuming
          // module even before expansion replaces the node (ADR-0017).
          for (const declaration of item.declarations) addDeclaration(declaration);
          break;
      }
    }
  };

  for (const item of ast.items) {
    if (item.kind === "rule") visitBody(item.body);
    else if (item.kind === "native-at-rule" && item.block !== undefined) visitBody(item.block);
  }

  return segments;
}

/**
 * Collect the segment starts authored inside top-level `@group.<name>`
 * definitions (ADR-0017).
 *
 * Definitions emit no IR, so a {@link DeclarationIr} whose origin segment is in
 * this set can only have reached the IR through use-site expansion. Substitution
 * uses that to enforce owner decision (b): group defaults are compile-time only,
 * so a `@runtime` reference there is XESSA2001 and the segment is omitted
 * instead of rewritten to `var(--...)` with the consuming build's prefix.
 *
 * Both the base segment and every inline-variant segment are included, matching
 * the IR's per-segment spans.
 */
export function groupDefaultSegments(ast: Stylesheet | undefined): Set<number> {
  const starts = new Set<number>();
  if (ast === undefined) return starts;
  for (const item of ast.items) {
    if (item.kind !== "group-definition") continue;
    for (const declaration of item.declarations) {
      starts.add(declaration.span.start);
      for (const variant of declaration.variants) starts.add(variant.span.start);
    }
  }
  return starts;
}

/**
 * Collect authored `$` references from one module's AST.
 *
 * `includeRules` adds references from stylesheet rule values (used for the entry
 * module, whose declarations are compiled); without it only `@variables` and
 * `@runtime` values are visited, which is what imported token-only modules can
 * contribute to the entry's artifact (SPECIFICATION.md §6.1: imports bring in
 * tokens only, not rules). Rule values include the declarations of `@group.`
 * use-site blocks, because this module's build emits them (ADR-0017).
 */
export function astReferences(
  ast: Stylesheet,
  options: { readonly includeRules: boolean },
): AstReference[] {
  const references: AstReference[] = [];

  const collect = (tokens: readonly Token[] | undefined, file: string): void => {
    if (tokens === undefined) return;
    for (const token of tokens) {
      if (token.kind !== "dollar-ref") continue;
      const reference = splitReference(token.value);
      if (reference === null) continue;
      references.push({ reference, span: { start: token.start, end: token.end, file } });
    }
  };

  const collectDeclaration = (declaration: Declaration, file: string): void => {
    collect(declaration.tokens, file);
    for (const variant of declaration.variants) collect(variant.tokens, file);
  };

  const collectTokenDeclaration = (token: TokenDeclaration, file: string): void => {
    collect(token.tokens, file);
  };

  const visitBody = (items: readonly BlockItem[], file: string): void => {
    for (const item of items) {
      switch (item.kind) {
        case "declaration":
          collectDeclaration(item, file);
          break;
        case "rule":
          visitBody(item.body, file);
          break;
        case "conditional-block":
          visitBody(item.body, file);
          break;
        case "native-at-rule":
          if (item.block !== undefined) visitBody(item.block, file);
          break;
        case "group-use-site":
          // Use-site overrides are emitted in this module's build, so a
          // `@runtime` reference authored there must register its custom
          // property exactly like a plain declaration (ADR-0017 item 6).
          for (const declaration of item.declarations) collectDeclaration(declaration, file);
          break;
      }
    }
  };

  const file = ast.file;
  for (const item of ast.items) {
    switch (item.kind) {
      case "variables":
        for (const token of item.tokens) collectTokenDeclaration(token, file);
        break;
      case "runtime":
        for (const declaration of item.declarations) collectDeclaration(declaration, file);
        break;
      case "rule":
        if (options.includeRules) visitBody(item.body, file);
        break;
      case "native-at-rule":
        if (options.includeRules && item.block !== undefined) visitBody(item.block, file);
        break;
      default:
        break;
    }
  }

  return references;
}
