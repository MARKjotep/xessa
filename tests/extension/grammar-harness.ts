import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, i.e. the directory containing `packages/` and `tests/`. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** VS Code extension package root. It also declares the optional renderer devDependencies. */
export const EXTENSION_ROOT = join(REPO_ROOT, "packages", "vscode");

export interface GrammarRule {
  include?: string;
  match?: string;
  name?: string;
  contentName?: string;
  begin?: string;
  end?: string;
  beginCaptures?: Record<string, { name?: string }>;
  endCaptures?: Record<string, { name?: string }>;
  captures?: Record<string, { name?: string }>;
  patterns?: GrammarRule[];
}

export interface Grammar {
  name?: string;
  scopeName?: string;
  fileTypes?: string[];
  patterns: GrammarRule[];
  repository: Record<string, GrammarRule>;
}

export interface LanguageConfiguration {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  brackets?: Array<[string, string]>;
  autoClosingPairs?: Array<{ open: string; close: string; notIn?: string[] }>;
  surroundingPairs?: Array<{ open: string; close: string }>;
  indentationRules?: { increaseIndentPattern?: string; decreaseIndentPattern?: string };
  wordPattern?: string;
}

export interface ExtensionManifest {
  name?: string;
  displayName?: string;
  publisher?: string;
  engines?: { vscode?: string };
  categories?: string[];
  main?: string;
  activationEvents?: string[];
  contributes?: {
    configurationDefaults?: {
      "editor.tokenColorCustomizations"?: {
        textMateRules?: Array<{ scope?: string[]; settings?: { foreground?: string } }>;
      };
    };
    languages?: Array<{
      id?: string;
      aliases?: string[];
      extensions?: string[];
      configuration?: string;
    }>;
    grammars?: Array<{ language?: string; scopeName?: string; path?: string }>;
  };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadGrammar(): Grammar {
  return readJson<Grammar>(join(EXTENSION_ROOT, "syntaxes", "xessa.tmLanguage.json"));
}

/** Every rule reachable from the grammar root, including nested `patterns` and `repository`. */
export function allRules(grammar: Grammar): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const visit = (rule: GrammarRule): void => {
    rules.push(rule);
    for (const pattern of rule.patterns ?? []) visit(pattern);
  };
  for (const rule of Object.values(grammar.repository)) visit(rule);
  for (const rule of grammar.patterns) visit(rule);
  return rules;
}

/** Includes (`#name`) referenced anywhere in the grammar. */
export function referencedContexts(grammar: Grammar): string[] {
  const names = new Set<string>();
  for (const rule of allRules(grammar)) {
    if (rule.include?.startsWith("#")) names.add(rule.include.slice(1));
  }
  return [...names].sort();
}

/** Every `name`/`contentName`/capture scope used by the grammar. */
export function referencedScopes(grammar: Grammar): string[] {
  const scopes = new Set<string>();
  const add = (name?: string): void => {
    for (const scope of name?.split(/\s+/) ?? []) if (scope) scopes.add(scope);
  };
  for (const rule of allRules(grammar)) {
    add(rule.name);
    add(rule.contentName);
    for (const capture of Object.values(rule.captures ?? {})) add(capture.name);
    for (const capture of Object.values(rule.beginCaptures ?? {})) add(capture.name);
    for (const capture of Object.values(rule.endCaptures ?? {})) add(capture.name);
  }
  return [...scopes].sort();
}

/** All regex sources in the grammar (`match`, `begin`, `end`). */
export function regexSources(grammar: Grammar): Array<{ scope: string; source: string }> {
  const sources: Array<{ scope: string; source: string }> = [];
  for (const [id, rule] of Object.entries(grammar.repository)) {
    for (const key of ["match", "begin", "end"] as const) {
      const source = rule[key];
      if (source !== undefined) sources.push({ scope: `#${id}.${key}`, source });
    }
  }
  return sources;
}

export interface ScopedToken {
  line: number;
  text: string;
  scopes: string[];
}

export interface Renderer {
  tokenize(source: string): ScopedToken[];
}

interface RawToken {
  startIndex: number;
  endIndex: number;
  scopes: string[];
}

interface RawGrammar {
  tokenizeLine(line: string, previous: unknown): { tokens: RawToken[]; ruleStack: unknown };
}

interface RawRegistry {
  loadGrammar(scopeName: string): Promise<RawGrammar | null>;
}

interface RegistryConstructor {
  new (options: {
    onigLib: Promise<{
      createOnigScanner(patterns: string[]): unknown;
      createOnigString(text: string): unknown;
    }>;
    loadGrammar(scopeName: string): Promise<unknown>;
  }): RawRegistry;
}

interface OnigurumaModule {
  loadWASM(data: ArrayBuffer): Promise<unknown>;
  OnigScanner: new (patterns: string[]) => unknown;
  OnigString: new (text: string) => unknown;
}

interface TextmateModule {
  Registry: RegistryConstructor;
  INITIAL: unknown;
}

/**
 * Loads the vendored TextMate engine from the extension's devDependencies.
 * Returns `null` when the WASM toolchain is unavailable so callers can skip scope
 * rendering instead of asserting fake results.
 */
export async function createRenderer(): Promise<Renderer | null> {
  try {
    const requireFromExtension = createRequire(join(EXTENSION_ROOT, "package.json"));
    const textmate = requireFromExtension("vscode-textmate") as TextmateModule;
    const oniguruma = requireFromExtension("vscode-oniguruma") as OnigurumaModule;
    const wasmPath = requireFromExtension.resolve("vscode-oniguruma/release/onig.wasm");
    const wasm = readFileSync(wasmPath);
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

    const grammar = loadGrammar();
    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
        createOnigString: (text: string) => new oniguruma.OnigString(text),
      }),
      loadGrammar: async (scopeName: string) => (scopeName === grammar.scopeName ? grammar : null),
    });
    const loaded = await registry.loadGrammar(grammar.scopeName ?? "source.xessa");
    if (!loaded) return null;

    return {
      tokenize(source: string): ScopedToken[] {
        const tokens: ScopedToken[] = [];
        let ruleStack = textmate.INITIAL;
        const lines = source.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          const result = loaded.tokenizeLine(line, ruleStack);
          ruleStack = result.ruleStack;
          for (const token of result.tokens) {
            const text = line.slice(token.startIndex, token.endIndex);
            if (text.trim().length > 0) {
              tokens.push({ line: index + 1, text, scopes: token.scopes });
            }
          }
        }
        return tokens;
      },
    };
  } catch (error) {
    console.warn(
      `Xessa grammar renderer unavailable; skipping scope rendering: ${(error as Error).message}`,
    );
    return null;
  }
}
