/**
 * TT6 · repeated activation: registration → teardown → re-registration.
 *
 * `XessaController.activate()` registers every provider, command and workspace
 * listener; `dispose()` must release all of them. A leak here means a
 * re-activated extension keeps answering completions from dead providers and
 * re-renders diagnostics twice — the classic symptom the plan asks about.
 *
 * `packages/vscode/src/controller.ts` imports the real `vscode` module, which
 * does not exist under `bun test`, so this file registers the counting fake from
 * `./vscode-host.ts` and drives 50 full activation cycles. Every disposable the
 * fake hands out is tracked, so `live() === 0` after each `dispose()` is a direct
 * observation rather than a source-text assertion.
 *
 * The debounced `AnalysisService` is exercised separately with an injected timer
 * queue: `forget()` must cancel a pending analysis and drop the cache, otherwise
 * a closed document keeps re-publishing diagnostics.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import { analyzeText } from "../../../packages/vscode/src/analysis.ts";
import type { DocumentState, SourceText } from "../../../packages/vscode/src/analysis.ts";
import { AnalysisService } from "../../../packages/vscode/src/service.ts";
import { createFakeContext, createFakeVscodeHost } from "./vscode-host.ts";

/** Activation cycles performed by this file. */
const CYCLES = 50;

const host = createFakeVscodeHost();
mock.module("vscode", () => host.module);

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};
process.on("unhandledRejection", onRejection);

afterAll(() => {
  process.off("unhandledRejection", onRejection);
  mock.restore();
});

describe("controller activation loop", () => {
  test(`${CYCLES} activate/dispose cycles leave no live registration behind`, async () => {
    const { XessaController } = await import("../../../packages/vscode/src/controller.ts");
    const context = createFakeContext();
    const deltas: number[] = [];
    const subscriptionGrowth: number[] = [];

    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      const before = host.created();
      const controller = new XessaController(context as never);
      controller.activate();
      // Activation really registered something, and nothing was disposed yet.
      expect(host.live()).toBeGreaterThan(0);
      deltas.push(host.created() - before);
      subscriptionGrowth.push(context.subscriptions.length);
      controller.dispose();
      // Teardown releases every registration the cycle created.
      expect(host.live()).toBe(0);
    }

    // Every cycle registers exactly the same handlers: no accumulation, no
    // silent skip after the first one.
    expect(deltas.every((delta) => delta === deltas[0])).toBe(true);
    // 28 tracked disposables: output channel, status bar, diagnostic collection,
    // 10 language providers, 6 commands and 8 workspace listeners. (The preview
    // content provider is the 29th entry of `disposables` and owns no fake API.)
    expect(deltas[0]).toBe(28);
    // The ExtensionContext contract collects the disposables the host will
    // dispose on deactivate, so this array grows by `disposables.length` per
    // activation; recorded, not asserted as a leak (a real host activates once).
    expect(subscriptionGrowth[0]).toBe(29);
    expect(subscriptionGrowth[CYCLES - 1]).toBe(29 * CYCLES);
    expect(rejections).toEqual([]);
  });

  test("each cycle registers the same number of each kind of handler", async () => {
    const { XessaController } = await import("../../../packages/vscode/src/controller.ts");
    const context = createFakeContext();
    // Snapshot before the constructor so its own disposables (output channel,
    // status bar, diagnostic collection) are part of the measured cycle.
    const before = host.byKind();
    const controller = new XessaController(context as never);
    controller.activate();
    const after = host.byKind();
    controller.dispose();
    expect(host.live()).toBe(0);

    const delta = Object.fromEntries(
      Object.entries(after).map(([kind, count]) => [kind, count - (before[kind] ?? 0)]),
    );
    expect(delta).toEqual({
      "window.createOutputChannel": 1,
      "window.createStatusBarItem": 1,
      "languages.createDiagnosticCollection": 1,
      "workspace.registerTextDocumentContentProvider": 1,
      "languages.registerCompletionItemProvider": 1,
      "languages.registerHoverProvider": 1,
      "languages.registerDefinitionProvider": 1,
      "languages.registerReferenceProvider": 1,
      "languages.registerRenameProvider": 1,
      "languages.registerColorProvider": 1,
      "languages.registerDocumentSemanticTokensProvider": 1,
      "languages.registerDocumentSymbolProvider": 1,
      "languages.registerDocumentFormattingEditProvider": 1,
      "languages.registerCodeActionsProvider": 1,
      "commands.registerCommand": 6,
      "workspace.onDidOpenTextDocument": 1,
      "workspace.onDidChangeTextDocument": 1,
      "workspace.onDidSaveTextDocument": 1,
      "workspace.onWillSaveTextDocument": 1,
      "workspace.onDidCloseTextDocument": 1,
      "workspace.onDidChangeWorkspaceFolders": 1,
      "workspace.onDidGrantWorkspaceTrust": 1,
      "workspace.onDidChangeConfiguration": 1,
    });
  });

  test("re-activation after dispose answers from the new registration only", async () => {
    const { XessaController } = await import("../../../packages/vscode/src/controller.ts");
    const context = createFakeContext();
    const first = new XessaController(context as never);
    first.activate();
    first.dispose();
    const second = new XessaController(context as never);
    second.activate();
    // Disposing the retired controller twice must not disturb the live one.
    first.dispose();
    expect(host.live()).toBe(28);
    second.dispose();
    expect(host.live()).toBe(0);
  });
});

describe("analysis service teardown", () => {
  /** Deterministic timer queue: no wall-clock sleeps. */
  function scheduler() {
    let handle = 0;
    const pending = new Map<number, () => void>();
    return {
      setTimer: (callback: () => void, _milliseconds: number): number => {
        handle += 1;
        pending.set(handle, callback);
        return handle;
      },
      clearTimer: (value: unknown): void => {
        pending.delete(value as number);
      },
      pending: () => pending.size,
      runAll: (): void => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback();
      },
    };
  }

  function analyze(source: SourceText): Promise<DocumentState> {
    return Promise.resolve({
      analysis: analyzeText(source),
    });
  }

  test(`${CYCLES} schedule/forget cycles leave no pending analysis and no cache entry`, () => {
    const timers = scheduler();
    const service = new AnalysisService(analyze, {
      delayMs: 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const path = "/virtual/activation.cssx";
    const text = ".card { color: red; }\n";

    for (let version = 1; version <= CYCLES; version += 1) {
      service.schedule({ text, path, version }, () => undefined);
      expect(timers.pending()).toBe(1);
      service.forget(path);
      expect(timers.pending()).toBe(0);
      expect(service.cached({ text, path, version })).toBeUndefined();
    }
  });

  test("a newer version cancels the previous debounce instead of stacking it", () => {
    const timers = scheduler();
    const service = new AnalysisService(analyze, {
      delayMs: 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const path = "/virtual/activation.cssx";
    const text = ".card { color: red; }\n";
    for (let version = 1; version <= CYCLES; version += 1) {
      service.schedule({ text, path, version }, () => undefined);
    }
    expect(timers.pending()).toBe(1);
    timers.runAll();
    service.forget(path);
    expect(timers.pending()).toBe(0);
  });

  test("analyzeNow caches one entry per document and discards stale versions", async () => {
    const timers = scheduler();
    const service = new AnalysisService(analyze, {
      delayMs: 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const path = "/virtual/activation.cssx";
    const text = ".card { color: red; }\n";
    const fresh = await service.analyzeNow({ text, path, version: 5 });
    expect(fresh.analysis.version).toBe(5);
    // A cached version is served again without re-analysing.
    const again = await service.analyzeNow({ text, path, version: 5 });
    expect(again).toBe(fresh);
    // A stale version never replaces the newer cached state.
    const stale = await service.analyzeNow({ text, path, version: 3 });
    expect(stale.analysis.version).toBe(5);
    service.forget(path);
    expect(service.cached({ text, path, version: 5 })).toBeUndefined();
    expect(timers.pending()).toBe(0);
    expect(rejections).toEqual([]);
  });
});
