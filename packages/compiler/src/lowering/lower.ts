import {
  atRuleContextIr,
  declarationIr,
  nativeBlockIr,
  ruleIr,
  stylesheetIr,
} from "../ir/factories.js";
import type {
  AtRuleContextIr,
  DeclarationIr,
  MediaConditionIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";
import type {
  BlockItem,
  ConditionalBlock,
  Declaration,
  NativeAtRule,
  Stylesheet,
} from "../types/ast.js";
import type { Diagnostic, DiagnosticCode } from "../types/diagnostics.js";
import { error } from "../types/diagnostics.js";
import type { CompileOptions } from "../types/options.js";
import type { Span } from "../types/span.js";
import { buildMediaAliasTable, resolveMediaCondition } from "./media.js";
import type { ConditionAlias, MediaAliasTable } from "./media.js";
import { declarationSegmentSpans, modifierAliasSpans, sameCondition } from "./spans.js";

/**
 * AST to immutable CSS IR lowering (SPECIFICATION.md §5).
 *
 * The pass is pure and deterministic: it never reads the filesystem, never
 * mutates the AST and never reorders, merges or deduplicates declarations. Each
 * authored value segment becomes one {@link DeclarationIr}; consecutive segments
 * with the same condition form one {@link RuleIr}. A run is flushed at a nested
 * rule, a conditional block or a native at-rule (§5.1), so later base
 * declarations stay later and keep native cascade precedence (§5.2).
 */

/** At-rules whose contents cannot carry Xessa conditions (SPECIFICATION.md §3.5). */
const RESTRICTED_NATIVE_AT_RULES: ReadonlySet<string> = new Set([
  "keyframes",
  "font-face",
  "property",
]);

/**
 * Descriptor at-rules whose block holds selector-less declarations by design:
 * `@font-face` descriptors, `@property` registrations (SPECIFICATION.md §3.5) and
 * classic `@page` boxes, which take declarations natively. Any other native
 * block that reaches a lowerer without an enclosing rule has invalid structure
 * and is diagnosed instead of silently dropped.
 */
const DESCRIPTOR_NATIVE_AT_RULES: ReadonlySet<string> = new Set(["font-face", "property", "page"]);

type NodeSink = (node: RuleIr | NativeBlockIr) => void;

/** The selector and ancestor chain a declaration run belongs to. */
interface Owner {
  readonly selector: string;
  readonly ancestors: readonly string[];
}

/** Inherited lowering state at one point in the walk. */
interface Scope {
  /** Resolved Xessa condition inherited from enclosing conditional blocks. */
  readonly condition: MediaConditionIr | null;
  /** Alias references that produced {@link Scope.condition}, for later combination. */
  readonly aliases: readonly ConditionAlias[];
  /** Native at-rule stack, outermost-first. */
  readonly context: readonly AtRuleContextIr[];
  /** Name of the enclosing restricted at-rule, or `null` when conditions are allowed. */
  readonly restricted: string | null;
}

interface OpenRun {
  readonly condition: MediaConditionIr | null;
  readonly declarations: DeclarationIr[];
  readonly span: Span;
}

const ROOT_SCOPE: Scope = Object.freeze({
  condition: null,
  aliases: Object.freeze([]),
  context: Object.freeze([]),
  restricted: null,
});

class Lowerer {
  readonly #table: MediaAliasTable;
  readonly #diagnostics: Diagnostic[] = [];

  constructor(table: MediaAliasTable) {
    this.#table = table;
  }

  get diagnostics(): Diagnostic[] {
    return this.#diagnostics;
  }

  run(ast: Stylesheet): StylesheetIr {
    const rules: (RuleIr | NativeBlockIr)[] = [];
    for (const item of ast.items) {
      switch (item.kind) {
        case "rule":
          this.#lowerBody(
            item.body,
            { selector: item.selector, ancestors: [] },
            ROOT_SCOPE,
            (node) => rules.push(node),
          );
          break;
        case "native-at-rule":
          this.#lowerNative(item, null, ROOT_SCOPE, (node) => rules.push(node));
          break;
        default:
          // @setup, @use, @variables and @media-types emit no CSS; @runtime is
          // out of scope for A05 (P3/A08 owns custom-property emission).
          break;
      }
    }
    return stylesheetIr(rules);
  }

  #report(code: DiagnosticCode, message: string, span: Span): void {
    this.#diagnostics.push(error(code, message, span));
  }

  #lowerBody(items: readonly BlockItem[], owner: Owner, scope: Scope, sink: NodeSink): void {
    let open: OpenRun | null = null;

    const flush = (): void => {
      if (open === null) return;
      if (open.declarations.length > 0) {
        sink(
          ruleIr({
            selector: owner.selector,
            ancestors: owner.ancestors,
            declarations: open.declarations,
            condition: open.condition,
            context: scope.context,
            span: open.span,
          }),
        );
      }
      open = null;
    };

    const add = (declaration: DeclarationIr, condition: MediaConditionIr | null): void => {
      if (open !== null && !sameCondition(open.condition, condition)) flush();
      if (open === null) {
        open = { condition, declarations: [declaration], span: declaration.span };
      } else {
        open.declarations.push(declaration);
      }
    };

    for (const item of items) {
      switch (item.kind) {
        case "declaration": {
          if (scope.restricted !== null) {
            this.#lowerRestrictedDeclaration(item, scope, add);
            break;
          }
          const spans = declarationSegmentSpans(item);
          add(
            declarationIr(item.property, item.value, spans.base, item.important),
            scope.condition,
          );
          for (let index = 0; index < item.variants.length; index++) {
            const variant = item.variants[index];
            if (variant === undefined) continue;
            const span = spans.variants[index] ?? item.span;
            if (variant.aliases.length === 0) {
              add(
                declarationIr(item.property, variant.value, span, variant.important),
                scope.condition,
              );
              continue;
            }
            const entries = [...scope.aliases, ...modifierAliasSpans(variant)];
            const resolution = resolveMediaCondition(entries, this.#table, variant.span);
            if (!resolution.ok) {
              this.#diagnostics.push(resolution.diagnostic);
              continue;
            }
            add(
              declarationIr(item.property, variant.value, span, variant.important),
              resolution.condition,
            );
          }
          break;
        }
        case "conditional-block": {
          flush();
          this.#lowerConditional(item, owner, scope, sink);
          break;
        }
        case "rule": {
          flush();
          const child: Owner = {
            selector: item.selector,
            ancestors: [...owner.ancestors, owner.selector],
          };
          this.#lowerBody(item.body, child, scope, sink);
          break;
        }
        case "native-at-rule": {
          flush();
          this.#lowerNative(item, owner, scope, sink);
          break;
        }
      }
    }

    flush();
  }

  /**
   * Emit a declaration inside `@keyframes`, `@font-face` or `@property`.
   *
   * Plain declarations pass through; inline modifiers are a Xessa transformation
   * the context cannot express, so XESSA3001 is reported and the declaration is
   * omitted (§3.5, §4.3).
   */
  #lowerRestrictedDeclaration(
    declaration: Declaration,
    scope: Scope,
    add: (declaration: DeclarationIr, condition: MediaConditionIr | null) => void,
  ): void {
    if (declaration.variants.length > 0 || scope.aliases.length > 0) {
      this.#report(
        "XESSA3001",
        `Unsupported Xessa transformation in this context: inline modifiers are not allowed inside @${scope.restricted as string}.`,
        declaration.span,
      );
      return;
    }
    add(
      declarationIr(
        declaration.property,
        declaration.value,
        declaration.span,
        declaration.important,
      ),
      null,
    );
  }

  #lowerConditional(block: ConditionalBlock, owner: Owner, scope: Scope, sink: NodeSink): void {
    if (scope.restricted !== null) {
      this.#report(
        "XESSA3001",
        `Unsupported Xessa transformation in this context: conditional blocks are not allowed inside @${scope.restricted}.`,
        block.span,
      );
      return;
    }
    const entries = [...scope.aliases, ...modifierAliasSpans(block.variant)];
    const resolution = resolveMediaCondition(entries, this.#table, block.span);
    if (!resolution.ok) {
      this.#diagnostics.push(resolution.diagnostic);
      return;
    }
    this.#lowerBody(
      block.body,
      owner,
      {
        condition: resolution.condition,
        aliases: resolution.aliases,
        context: scope.context,
        restricted: null,
      },
      sink,
    );
  }

  #lowerNative(atRule: NativeAtRule, owner: Owner | null, scope: Scope, sink: NodeSink): void {
    if (atRule.block === undefined) {
      sink(
        nativeBlockIr({
          name: atRule.name,
          prelude: atRule.prelude,
          statement: true,
          children: [],
          span: atRule.span,
        }),
      );
      return;
    }

    const context = atRuleContextIr(atRule.name, atRule.prelude, atRule.span);
    const nextScope: Scope = { ...scope, context: [...scope.context, context] };
    const lowerName = atRule.name.toLowerCase();
    const ownRestriction = RESTRICTED_NATIVE_AT_RULES.has(lowerName);
    const descriptorBlock = DESCRIPTOR_NATIVE_AT_RULES.has(lowerName);
    if (ownRestriction || descriptorBlock || scope.restricted !== null) {
      const restricted = ownRestriction ? atRule.name : (scope.restricted ?? atRule.name);
      this.#lowerRestrictedBlock(atRule, nextScope, restricted, sink);
      return;
    }

    const children: NativeBlockChild[] = [];
    const childSink: NodeSink = (node) => children.push(node);

    if (owner !== null) {
      // A native at-rule inside a rule: direct declarations still belong to the
      // enclosing selector, nested rules are its descendants.
      this.#lowerBody(atRule.block, owner, nextScope, childSink);
    } else {
      // A top-level native at-rule has no enclosing selector. Nested rules and
      // nested native blocks can still form CSS; a bare declaration or a bare
      // conditional block cannot, so both are diagnosed rather than dropped
      // silently (SPECIFICATION.md §3.4, ADR-0004).
      for (const item of atRule.block) {
        switch (item.kind) {
          case "rule":
            this.#lowerBody(
              item.body,
              { selector: item.selector, ancestors: [] },
              nextScope,
              childSink,
            );
            break;
          case "native-at-rule":
            this.#lowerNative(item, null, nextScope, childSink);
            break;
          case "declaration":
            this.#report("XESSA1001", "declaration outside a rule", item.span);
            break;
          case "conditional-block":
            this.#report("XESSA1001", "conditional block outside a rule", item.span);
            break;
        }
      }
    }

    sink(
      nativeBlockIr({
        name: atRule.name,
        prelude: atRule.prelude,
        children,
        span: atRule.span,
      }),
    );
  }

  /**
   * Lower a native at-rule that cannot carry Xessa conditions.
   *
   * Descriptor declarations are emitted as {@link DeclarationIr} children
   * because they are not selector-bound; keyframe steps stay {@link RuleIr}
   * nodes with their authored keyframe selector text. A direct declaration in a
   * non-descriptor block (`@keyframes`, nested `@media`, ...) has no rule to
   * belong to, so it is diagnosed as XESSA1001 instead of silently dropped.
   */
  #lowerRestrictedBlock(
    atRule: NativeAtRule,
    scope: Scope,
    restricted: string,
    sink: NodeSink,
  ): void {
    const restrictedScope: Scope = { ...scope, restricted };
    const children: NativeBlockChild[] = [];
    const descriptorBlock =
      scope.restricted === null && DESCRIPTOR_NATIVE_AT_RULES.has(atRule.name.toLowerCase());

    for (const item of atRule.block ?? []) {
      switch (item.kind) {
        case "declaration": {
          if (!descriptorBlock) {
            this.#report("XESSA1001", "declaration outside a rule", item.span);
            break;
          }
          if (item.variants.length > 0 || scope.condition !== null) {
            this.#report(
              "XESSA3001",
              `Unsupported Xessa transformation in this context: inline modifiers are not allowed inside @${restricted}.`,
              item.span,
            );
            break;
          }
          children.push(declarationIr(item.property, item.value, item.span, item.important));
          break;
        }
        case "conditional-block":
          this.#report(
            "XESSA3001",
            `Unsupported Xessa transformation in this context: conditional blocks are not allowed inside @${restricted}.`,
            item.span,
          );
          break;
        case "rule":
          this.#lowerBody(
            item.body,
            { selector: item.selector, ancestors: [] },
            restrictedScope,
            (node) => children.push(node),
          );
          break;
        case "native-at-rule":
          this.#lowerNative(item, null, restrictedScope, (node) => children.push(node));
          break;
      }
    }

    sink(
      nativeBlockIr({
        name: atRule.name,
        prelude: atRule.prelude,
        children,
        span: atRule.span,
      }),
    );
  }
}

/**
 * Lower a parsed stylesheet into the immutable CSS IR.
 *
 * Pure and deterministic: the AST is treated as read-only and the result is
 * frozen. `options.media` supplies project-level alias overrides; a file's
 * `@media-types` still wins (ADR-0006). Diagnostics are XESSA3001 errors in
 * source order, and a rejected declaration or block contributes no IR.
 *
 * Out of scope by design: `@runtime` blocks emit no IR (P3/A08), `$variable`
 * values stay raw (A08), selectors stay nested and unprefixed (A06/A09) and no
 * CSS text is produced (A06).
 */
export function lower(
  ast: Stylesheet,
  options: CompileOptions,
): { ir: StylesheetIr; diagnostics: Diagnostic[] } {
  const table = buildMediaAliasTable(ast, options.media);
  const lowerer = new Lowerer(table);
  const ir = lowerer.run(ast);
  return { ir, diagnostics: [...lowerer.diagnostics] };
}
