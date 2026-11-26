import { nativeBlockIr, ruleIr, stylesheetIr } from "../ir/factories.js";
import type {
  DeclarationIr,
  NativeBlockChild,
  NativeBlockIr,
  RuleIr,
  StylesheetIr,
} from "../ir/types.js";

/**
 * Shared IR rewriting for the variable passes.
 *
 * The IR is immutable and source-ordered, so both substitution and runtime
 * emission rebuild it with frozen factories instead of editing nodes. Rewriting
 * is structural: node identity is preserved when nothing changed, a rule or
 * block at-rule is dropped only when **this pass** rejected its last
 * declaration/child (an authored empty block such as `@layer a {}` is kept
 * because it carries meaning), and statement at-rules (`@import`, `@charset`,
 * `@layer a, b;`) are always kept because they carry no declarations (A05
 * additive field).
 */

/** Result of {@link mapIrDeclarations}. */
export interface MappedIr {
  /** Rebuilt IR, or the input instance when nothing changed. */
  readonly ir: StylesheetIr;
  /** Whether at least one node or declaration was replaced or dropped. */
  readonly changed: boolean;
}

/**
 * Rewrite every {@link DeclarationIr} of a stylesheet.
 *
 * `transform` returns the declaration to keep or `null` to omit it. A rule or
 * block at-rule is dropped when the last of its declarations/children was
 * omitted by this pass, so a rejected reference cannot leave an empty selector
 * behind; containers that were already empty on input are preserved untouched.
 */
export function mapIrDeclarations(
  ir: StylesheetIr,
  transform: (declaration: DeclarationIr) => DeclarationIr | null,
): MappedIr {
  let changed = false;

  const rewriteRule = (rule: RuleIr): RuleIr | null => {
    // An already-empty rule is authored input, not a rejection: preserve it so
    // the pass never changes nodes it did not have to rewrite.
    if (rule.declarations.length === 0) return rule;
    const declarations: DeclarationIr[] = [];
    for (const declaration of rule.declarations) {
      const rewritten = transform(declaration);
      if (rewritten !== null) declarations.push(rewritten);
    }
    if (declarations.length === 0) {
      changed = true;
      return null;
    }
    if (
      declarations.length === rule.declarations.length &&
      declarations.every((entry, index) => entry === rule.declarations[index])
    ) {
      return rule;
    }
    changed = true;
    return ruleIr({
      selector: rule.selector,
      ancestors: rule.ancestors,
      declarations,
      condition: rule.condition,
      context: rule.context,
      span: rule.span,
    });
  };

  const rewriteBlock = (block: NativeBlockIr): NativeBlockIr | null => {
    if (block.statement === true) return block;
    // An authored empty block is preserved: `@layer a {}` still declares layer
    // order and an empty `@media` is the author's structure, not our rejection.
    if (block.children.length === 0) return block;
    const children: NativeBlockChild[] = [];
    for (const child of block.children) {
      if ("declarations" in child) {
        const rewritten = rewriteRule(child);
        if (rewritten !== null) children.push(rewritten);
        continue;
      }
      if ("children" in child) {
        const rewritten = rewriteBlock(child);
        if (rewritten !== null) children.push(rewritten);
        continue;
      }
      const rewritten = transform(child);
      if (rewritten !== null) children.push(rewritten);
    }
    if (children.length === 0) {
      changed = true;
      return null;
    }
    if (
      children.length === block.children.length &&
      children.every((entry, index) => entry === block.children[index])
    ) {
      return block;
    }
    changed = true;
    return nativeBlockIr({
      name: block.name,
      prelude: block.prelude,
      children,
      span: block.span,
    });
  };

  const rules: (RuleIr | NativeBlockIr)[] = [];
  for (const node of ir.rules) {
    if ("declarations" in node) {
      const rewritten = rewriteRule(node);
      if (rewritten !== null) rules.push(rewritten);
      continue;
    }
    const rewritten = rewriteBlock(node);
    if (rewritten !== null) rules.push(rewritten);
  }

  return { ir: changed ? stylesheetIr(rules) : ir, changed };
}

/**
 * Create the `:root` rule that carries runtime custom properties.
 *
 * The rule span is the first declaration's span, matching the lowering contract
 * for runs; an empty list is defensive only and yields a zero-width span.
 */
export function rootRule(
  declarations: readonly DeclarationIr[],
  condition: RuleIr["condition"],
): RuleIr {
  const first = declarations[0];
  return ruleIr({
    selector: ":root",
    ancestors: [],
    declarations,
    condition,
    context: [],
    span: first?.span ?? { start: 0, end: 0, file: "" },
  });
}
