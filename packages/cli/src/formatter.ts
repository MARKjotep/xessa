/**
 * Compiler formatter boundary for the CLI.
 *
 * `format` is a pure compiler module exported from the public barrel. The CLI
 * reaches it through the shared {@link loadCompiler} boundary (bare package →
 * built `dist` → TypeScript source under Bun), so there is no separate module
 * resolution path. The export is validated before use so a stale compiler build
 * fails with an actionable message instead of a call-site `TypeError`.
 */

import type { Diagnostic } from "@xessa/compiler";
import { loadCompiler } from "./compiler.js";

/** Formatter module surface the CLI consumes. */
export interface FormatterApi {
  /** Canonical formatting; errors return the original source unchanged. */
  format(
    source: string,
    file: string,
  ): { readonly formatted: string; readonly diagnostics: readonly Diagnostic[] };
}

let cached: Promise<FormatterApi> | undefined;

/** Load (and cache) the compiler formatter through the public API boundary. */
export function loadFormatter(): Promise<FormatterApi> {
  cached ??= resolveFormatter();
  return cached;
}

async function resolveFormatter(): Promise<FormatterApi> {
  const compiler = await loadCompiler();
  const format = (compiler as unknown as { format?: unknown }).format;
  if (typeof format === "function") {
    return { format: format as FormatterApi["format"] };
  }

  // Development fallback: a stale checked-out `dist` may predate the barrel
  // export. Under Bun the TypeScript formatter source is always loadable.
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    try {
      const loaded = (await import(
        new URL("../../compiler/src/formatter/index.ts", import.meta.url).href
      )) as { format?: unknown };
      if (typeof loaded.format === "function") {
        return { format: loaded.format as FormatterApi["format"] };
      }
    } catch {
      // Fall through to the actionable error below.
    }
  }

  throw new Error(
    'Unable to load the Xessa formatter: the compiler build does not export "format". Rebuild it with "bun run build" in packages/compiler.',
  );
}
