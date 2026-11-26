/**
 * Compiler boundary for the CLI.
 *
 * The CLI consumes only the compiler's public barrel. Because the monorepo does
 * not link workspace packages into `node_modules`, the loader tries, in order:
 *
 * 1. the bare `@xessa/compiler` specifier (published installs, or a linked
 *    workspace with a built `dist`);
 * 2. `packages/compiler/dist/index.js` relative to this module (Bun and Node
 *    runs from the repository);
 * 3. `packages/compiler/src/index.ts` under Bun only (development and tests
 *    without a build step).
 *
 * The module is cached after the first successful load.
 */

/** Public compiler module surface used by the CLI. */
export type CompilerApi = typeof import("@xessa/compiler");

let cached: Promise<CompilerApi> | undefined;

/** Load (and cache) the compiler public API. */
export function loadCompiler(): Promise<CompilerApi> {
  cached ??= resolveCompiler();
  return cached;
}

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function candidates(): readonly (() => Promise<unknown>)[] {
  const list: (() => Promise<unknown>)[] = [
    () => import("@xessa/compiler"),
    () => import(new URL("../../compiler/dist/index.js", import.meta.url).href),
  ];
  if (isBun()) {
    list.push(() => import(new URL("../../compiler/src/index.ts", import.meta.url).href));
  }
  return list;
}

async function resolveCompiler(): Promise<CompilerApi> {
  const errors: string[] = [];
  for (const candidate of candidates()) {
    try {
      const loaded = (await candidate()) as CompilerApi;
      if (typeof loaded.compileProject !== "function" || typeof loaded.planOutputs !== "function") {
        errors.push("module loaded without compileProject/planOutputs exports");
        continue;
      }
      return loaded;
    } catch (error) {
      errors.push(describeError(error));
    }
  }
  throw new Error(
    `Unable to load @xessa/compiler. Build it first with "bun run build" in packages/compiler. Tried: ${errors.join(" | ")}`,
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
