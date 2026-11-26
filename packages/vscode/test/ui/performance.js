/**
 * U5 — latency and memory measured through the real extension-host pipeline.
 *
 * Everything here goes through the public `vscode` API in the development host:
 * `executeCompletionItemProvider` and friends cross the host ↔ renderer boundary
 * like a real editor request, and the typing case drives the workbench `type`
 * command, which is the real keystroke path (a `TextEditor.edit` insertion is
 * measured next to it as the API-level comparison TT6 used).
 *
 * Numbers are the deliverable; assertions are deliberately generous ceilings
 * (~50–100× the measured p95) so a slower machine records a larger number instead
 * of failing. The recorded table and its comparison against the TT6 pure-layer
 * figures live in `.ai/reports/CSSX-U5.md`.
 *
 * The 10 000-line document comes from `perf-documents.js`, a local
 * reimplementation of TT6's TypeScript generator (the host suite is plain
 * CommonJS and cannot load `.ts`); see that file's header and the report.
 */

const os = require("node:os");
const vscode = require("vscode");
const host = require("./host.js");
const { EDITABLE_TEXT, STORM_TEXT, generateLargeDocument } = require("./perf-documents.js");

const ITERATIONS = 20;
const DIAGNOSTIC_ITERATIONS = 20;
const MEMORY_CYCLES = 20;
const STORM_CHARACTERS = 200;

/** Generous absolute ceilings: a slow machine records a number, it does not fail. */
const PROVIDER_CEILING_MS = 2000;
const DIAGNOSTIC_CEILING_MS = 5000;
const STORM_CEILING_MS = 60000;
const MEMORY_CEILING_MB = 400;

/** Nearest-rank percentile over a copy of `values` (milliseconds, 3 decimals). */
function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile) => {
    const rank = Math.ceil((percentile / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return Number((sorted[index] ?? 0).toFixed(3));
  };
  return {
    n: sorted.length,
    min: Number((sorted[0] ?? 0).toFixed(3)),
    p50: at(50),
    p95: at(95),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

function report(label, measured) {
  console.log(
    `[xessa perf] ${label}: n=${measured.n} p50=${measured.p50}ms p95=${measured.p95}ms max=${measured.max}ms`,
  );
}

/**
 * Time `operation` `ITERATIONS` times after one un-timed warm-up call.
 *
 * The warm-up exists because the first provider call for a document also builds
 * the analysis cache; that cold cost is reported separately as `cold`.
 */
async function measure(label, operation, iterations = ITERATIONS) {
  await operation();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  const measured = stats(samples);
  report(label, measured);
  return measured;
}

/** Bounded poll returning elapsed milliseconds, or `Number.NaN` at the deadline. */
async function timeUntil(predicate, timeoutMs = 5000) {
  const started = performance.now();
  for (;;) {
    if (predicate()) return performance.now() - started;
    if (performance.now() - started >= timeoutMs) return Number.NaN;
    await host.delay(10);
  }
}

function megabytes(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

async function run(t) {
  const machine = {
    vscode: vscode.version,
    electron: process.versions.electron,
    node: process.versions.node,
    chromium: process.versions.chrome,
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    iterations: ITERATIONS,
  };
  console.log(`[xessa perf] machine ${JSON.stringify(machine)}`);
  t.ok(machine.vscode.length > 0, "the host did not report its version");

  const workspace = await host.createWorkspace("xessa-ui-perf-");
  const rejections = [];
  const onRejection = (reason) => rejections.push(String(reason));
  process.on("unhandledRejection", onRejection);
  try {
    // ---- The 10 000-line document. ----
    const largeText = generateLargeDocument({ lines: 10000 });
    const largeUri = await workspace.write("large.cssx", largeText);
    const opened = performance.now();
    const large = await vscode.workspace.openTextDocument(largeUri);
    const largeEditor = await vscode.window.showTextDocument(large);
    console.log(
      `[xessa perf] document: ${large.lineCount} lines, ${largeText.length} chars, open ${Math.round(
        performance.now() - opened,
      )}ms`,
    );
    t.equal(large.languageId, "xessa", "the generated document did not open as Xessa");

    // The clean document publishes an empty set either way, so "analysis is
    // warm" is observed through a provider that must return real work instead.
    const coldStart = performance.now();
    const coldSymbols = await host.waitFor(
      async () => {
        const symbols = await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",
          large.uri,
        );
        return symbols !== undefined && symbols.length > 0 ? symbols : undefined;
      },
      { timeoutMs: 60000, label: "the first outline for the 10k-line document" },
    );
    const cold = Number((performance.now() - coldStart).toFixed(3));
    console.log(`[xessa perf] cold analyze+compile (first provider): ${cold}ms`);
    t.ok(coldSymbols.length > 0, "the 10k-line document produced no outline");
    t.ok(cold < PROVIDER_CEILING_MS * 10, `cold analysis took ${cold} ms`);
    const cleanDiagnostics = await host.settleDiagnostics(large.uri);
    t.equal(
      cleanDiagnostics.length,
      0,
      `the generated performance document is not clean: ${JSON.stringify(
        cleanDiagnostics.map((entry) => [entry.code, entry.message]),
      )}`,
    );

    // Same probe shape as TT6's pure-layer case: a `$gap` reference inside
    // `.rule-500`, well past the document's declaration block. Tokens inside
    // `@group.` bodies resolve in analysis but have no hover/definition (pinned
    // as an observation in the U5 report), so they are not probe positions.
    const ruleOffset = largeText.indexOf(".rule-500 {");
    const tokenOffset = largeText.indexOf("$gap", ruleOffset);
    const tokenPosition = large.positionAt(tokenOffset + 2);
    // `@group.stress-card` first use site: a definition target that exists.
    const groupUse = largeText.indexOf("@group.stress-card {", largeText.indexOf(".rule-0 {"));
    const groupPosition = large.positionAt(groupUse + 8);

    const completion = await measure("completion ($)", () =>
      vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        large.uri,
        tokenPosition,
        "$",
      ),
    );
    const completionItems = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      large.uri,
      tokenPosition,
      "$",
    );
    t.ok(completionItems.items.length > 0, "the token completion returned no items");
    t.ok(completion.p95 < PROVIDER_CEILING_MS, `completion p95 ${completion.p95} ms`);

    const hover = await measure("hover ($gap)", () =>
      vscode.commands.executeCommand("vscode.executeHoverProvider", large.uri, tokenPosition),
    );
    const hoverResult = await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      large.uri,
      tokenPosition,
    );
    t.ok(hoverResult.length > 0, "the token hover returned no card");
    t.match(host.hoverMarkdown(hoverResult[0]), /compile-time token/, "the hover did no real work");
    t.ok(hover.p95 < PROVIDER_CEILING_MS, `hover p95 ${hover.p95} ms`);

    const definition = await measure("definition ($gap)", () =>
      vscode.commands.executeCommand("vscode.executeDefinitionProvider", large.uri, tokenPosition),
    );
    const definitionResult = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      large.uri,
      tokenPosition,
    );
    t.ok(definitionResult.length > 0, "the token definition returned no target");
    t.ok(definition.p95 < PROVIDER_CEILING_MS, `definition p95 ${definition.p95} ms`);

    const colors = await measure("document colours", () =>
      vscode.commands.executeCommand("vscode.executeDocumentColorProvider", large.uri),
    );
    const swatches = await host.documentColors(large);
    t.ok(swatches.length > 100, `the document colour provider found ${swatches.length} swatches`);
    t.ok(colors.p95 < PROVIDER_CEILING_MS, `document colours p95 ${colors.p95} ms`);

    const symbols = await measure("document symbols", () =>
      vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", large.uri),
    );
    t.ok(symbols.p95 < PROVIDER_CEILING_MS, `document symbols p95 ${symbols.p95} ms`);

    const references = await measure("references ($gap)", () =>
      vscode.commands.executeCommand("vscode.executeReferenceProvider", large.uri, tokenPosition),
    );
    const referenceResult = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      large.uri,
      tokenPosition,
    );
    t.ok(
      referenceResult.length > 50,
      `references returned only ${referenceResult.length} locations`,
    );
    t.ok(references.p95 < PROVIDER_CEILING_MS, `references p95 ${references.p95} ms`);

    // `@group.` definition crosses into the group owner; the provider path is
    // the same dispatch as `$gap`, so the timing row documents a second shape.
    const groupDefinition = await measure("definition (@group.)", () =>
      vscode.commands.executeCommand("vscode.executeDefinitionProvider", large.uri, groupPosition),
    );
    t.ok(
      groupDefinition.p95 < PROVIDER_CEILING_MS,
      `group definition p95 ${groupDefinition.p95} ms`,
    );

    // ---- Diagnostics publication lag and full re-analysis on edit. ----
    // Break the document the way the fixtures do: drop the semicolon of a
    // declaration that is followed by another one. That is a XESSA1002, the
    // same diagnostic `ui/quickfix.js` drives, so the wait has a real target.
    const breakLine = largeText.slice(0, largeText.indexOf(".rule-500 {")).split("\n").length + 1;
    const declaration = large.lineAt(breakLine).text;
    t.equal(
      declaration.endsWith(";"),
      true,
      `the probe declaration does not end with a semicolon: ${JSON.stringify(declaration)}`,
    );
    const semicolon = new vscode.Position(breakLine, declaration.length - 1);
    const breakLag = [];
    const clearLag = [];
    for (let index = 0; index < DIAGNOSTIC_ITERATIONS; index += 1) {
      await largeEditor.edit((builder) =>
        builder.delete(new vscode.Range(semicolon, semicolon.translate(0, 1))),
      );
      const appeared = await timeUntil(() => host.diagnosticsOf(large.uri).length > 0);
      breakLag.push(Number.isFinite(appeared) ? appeared : DIAGNOSTIC_CEILING_MS);
      if (index === 0) {
        const published = host.diagnosticsOf(large.uri);
        t.equal(published.length, 1, "the broken declaration published an unexpected count");
        t.equal(published[0]?.code, "XESSA1002", "the missing semicolon was not surfaced");
        t.equal(
          published[0]?.range.start.line,
          breakLine,
          "the diagnostic points at the broke declaration",
        );
      }
      await largeEditor.edit((builder) => builder.insert(semicolon, ";"));
      const cleared = await timeUntil(() => host.diagnosticsOf(large.uri).length === 0);
      clearLag.push(Number.isFinite(cleared) ? cleared : DIAGNOSTIC_CEILING_MS);
    }
    report("diagnostics appear after edit", stats(breakLag));
    report("diagnostics clear after fix", stats(clearLag));
    const breakStats = stats(breakLag);
    const clearStats = stats(clearLag);
    t.ok(
      breakStats.p95 < DIAGNOSTIC_CEILING_MS,
      `diagnostic publication p95 ${breakStats.p95} ms (debounce is 150 ms)`,
    );
    t.ok(clearStats.p95 < DIAGNOSTIC_CEILING_MS, `diagnostic clearing p95 ${clearStats.p95} ms`);
    t.equal(
      large.getText(),
      largeText,
      "the diagnostics loop did not restore the document it edited",
    );
    t.equal(
      host.diagnosticsOf(large.uri).length,
      0,
      "a stale diagnostic set survived the last clean analysis",
    );

    // ---- Keystroke storm through the real typing pipeline. ----
    const smallText = generateLargeDocument({ lines: 200 });
    const stormDocument = (await workspace.open("storm.cssx", smallText)).document;
    const stormEditor = await vscode.window.showTextDocument(stormDocument);
    stormEditor.selection = new vscode.Selection(0, 0, 0, 0);
    const corpus = STORM_TEXT.slice(0, STORM_CHARACTERS);
    let changeEvents = 0;
    const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === stormDocument.uri.toString()) changeEvents += 1;
    });
    const stormStarted = performance.now();
    let typed = 0;
    for (const character of corpus) {
      await vscode.commands.executeCommand("type", { text: character });
      typed += 1;
    }
    const stormMs = performance.now() - stormStarted;
    changeSub.dispose();
    console.log(
      `[xessa perf] typing storm: ${typed}/${corpus.length} keystrokes via workbench "type" in ${Math.round(
        stormMs,
      )}ms (${(stormMs / typed).toFixed(2)} ms/keystroke), ${changeEvents} change event(s)`,
    );
    t.equal(typed, corpus.length, "a keystroke did not complete");
    t.ok(
      changeEvents >= corpus.length,
      `only ${changeEvents} change events for ${typed} keystrokes`,
    );
    t.ok(
      stormDocument.getText().length > smallText.length,
      "the typed characters never reached the document",
    );
    t.ok(stormMs < STORM_CEILING_MS, `typing storm took ${stormMs} ms`);

    // The same count of insertions through `TextEditor.edit`: the API-level
    // comparison for TT6's keystroke replay, which has no typing pipeline.
    const editStarted = performance.now();
    for (let index = 0; index < corpus.length; index += 1) {
      await stormEditor.edit((builder) => builder.insert(new vscode.Position(0, index), "x"));
    }
    const editMs = performance.now() - editStarted;
    console.log(
      `[xessa perf] edit storm: ${corpus.length} TextEditor.edit insertions in ${Math.round(
        editMs,
      )}ms (${(editMs / corpus.length).toFixed(2)} ms/edit)`,
    );
    t.ok(editMs < STORM_CEILING_MS, `edit storm took ${editMs} ms`);

    // ---- Memory across open/close cycles. ----
    // Revert (not save) the storm buffer first: a dirty editor would make the
    // close request wait on a save dialog.
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await large.save();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const heapSeries = [];
    const heapBefore = megabytes(process.memoryUsage().heapUsed);
    for (let cycle = 0; cycle < MEMORY_CYCLES; cycle += 1) {
      const document = await vscode.workspace.openTextDocument(largeUri);
      await vscode.window.showTextDocument(document, { preview: true });
      await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri);
      heapSeries.push(megabytes(process.memoryUsage().heapUsed));
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
    const heapAfter = megabytes(process.memoryUsage().heapUsed);
    console.log(
      `[xessa perf] heap across ${MEMORY_CYCLES} open/close cycles: before=${heapBefore}MB series=${JSON.stringify(
        heapSeries,
      )} after=${heapAfter}MB`,
    );
    t.equal(heapSeries.length, MEMORY_CYCLES, "a memory cycle did not complete");
    t.ok(
      heapAfter - heapBefore < MEMORY_CEILING_MB,
      `extension-host heap grew ${heapAfter - heapBefore} MB across ${MEMORY_CYCLES} cycles`,
    );
    t.equal(
      host.diagnosticsOf(largeUri).length,
      0,
      "closing the document left its diagnostics behind",
    );
    t.deepEqual(rejections, [], "an unhandled rejection escaped the performance run");

    return `10k lines: cold ${cold}ms, completion p95 ${completion.p95}ms, hover p95 ${hover.p95}ms, definition p95 ${definition.p95}ms, colours p95 ${colors.p95}ms, symbols p95 ${symbols.p95}ms, references p95 ${references.p95}ms, diagnostics p95 ${breakStats.p95}ms, storm ${typed} keys ${Math.round(stormMs)}ms`;
  } finally {
    process.off("unhandledRejection", onRejection);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await workspace.dispose();
  }
}

module.exports = { run, stats };
