import type { Modifier } from "../types/ast.js";
import type { Token } from "../types/token.js";

/**
 * Recognized condition modifiers (`@md`, `@xl+dark`, `@2xl`).
 *
 * The lexer emits `at-keyword` for every `@` name because alias tables are
 * configuration-dependent; the parser promotes an `at-keyword` to a modifier
 * only at top-level value depth or in block-condition position (ADR-0005,
 * token contract). A `modifier` token already present in a hand-built stream is
 * accepted as-is.
 */
export interface ModifierRead {
  readonly modifier: Modifier;
  /** Raw index of the first token after the modifier text. */
  readonly nextIndex: number;
}

/**
 * Read a modifier starting at a raw index, absorbing `+ alias` joins that are
 * directly adjacent in the source. Surrounding trivia is not consumed.
 *
 * Aliases keep authored order and preserve duplicates until lowering
 * normalizes them (AST `Modifier` JSDoc).
 */
export function readModifier(
  tokens: readonly Token[],
  index: number,
  limit: number,
  file: string,
): ModifierRead | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;
  if (token.kind !== "at-keyword" && token.kind !== "modifier") return undefined;

  let endToken = token;
  let text = token.value.startsWith("@") ? token.value.slice(1) : token.value;
  let nextIndex = index + 1;

  while (nextIndex + 1 < limit) {
    const plus = tokens[nextIndex];
    const alias = tokens[nextIndex + 1];
    if (plus === undefined || alias === undefined) break;
    if (plus.kind !== "delim" || plus.value !== "+" || plus.start !== endToken.end) break;
    if (alias.kind !== "ident" && alias.kind !== "number") break;
    if (alias.start !== plus.end) break;
    text += `+${alias.value}`;
    endToken = alias;
    nextIndex += 2;
  }

  const aliases = text.split("+").filter((alias) => alias.length > 0);
  if (aliases.length === 0) return undefined;

  const modifier: Modifier = Object.freeze({
    aliases: Object.freeze(aliases),
    span: { start: token.start, end: endToken.end, file },
  });
  return { modifier, nextIndex };
}
