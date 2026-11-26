/**
 * Authored `$name` reference scan for the module resolver.
 *
 * Runtime properties merge by order without a diagnostic when the importing
 * module never reads the name (ADR-0016 item 4), so `resolveUnqualified` needs
 * to know whether a bare `$name` was actually authored. The walk stays local to
 * the resolver to keep it independent of the substitution pass: it visits every
 * authored value in one AST and records only unqualified references, ignoring
 * `$namespace.member` and escaped dots.
 */

import type { BlockItem, Declaration, Stylesheet, TokenDeclaration } from "../types/ast.js";
import type { Token } from "../types/token.js";

/** Every bare `$name` referenced anywhere in the module's authored values. */
export function unqualifiedReferenceNames(ast: Stylesheet): Set<string> {
  const names = new Set<string>();

  const collect = (tokens: readonly Token[] | undefined): void => {
    if (tokens === undefined) return;
    for (const token of tokens) {
      if (token.kind !== "dollar-ref") continue;
      const name = bareName(token.value);
      if (name !== undefined) names.add(name);
    }
  };

  const collectDeclaration = (declaration: Declaration): void => {
    collect(declaration.tokens);
    for (const variant of declaration.variants) collect(variant.tokens);
  };

  const collectTokenDeclaration = (token: TokenDeclaration): void => {
    collect(token.tokens);
  };

  const visitBody = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "declaration":
          collectDeclaration(item);
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
          for (const declaration of item.declarations) collectDeclaration(declaration);
          break;
      }
    }
  };

  for (const item of ast.items) {
    switch (item.kind) {
      case "variables":
        for (const token of item.tokens) collectTokenDeclaration(token);
        break;
      case "runtime":
        for (const declaration of item.declarations) collectDeclaration(declaration);
        break;
      case "group-definition":
        for (const declaration of item.declarations) collectDeclaration(declaration);
        break;
      case "rule":
        visitBody(item.body);
        break;
      case "native-at-rule":
        if (item.block !== undefined) visitBody(item.block);
        break;
      default:
        break;
    }
  }

  return names;
}

/** `$name` as authored, or `undefined` for a namespaced reference. */
function bareName(authored: string): string | undefined {
  if (!authored.startsWith("$") || authored.length < 2) return undefined;
  const body = authored.slice(1);
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "." && index > 0 && index < body.length - 1) return undefined;
  }
  return body;
}
