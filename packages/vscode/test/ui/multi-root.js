/**
 * Multi-root workspace — the U4 scoping column, measured in a real two-root
 * window.
 *
 * The window is launched by `workspace-probe.js` on a generated
 * `<tmp>/xessa-two-roots.code-workspace` with two folders (see
 * `workspace-fixtures.js`):
 *   - `root-a`: a `xessa.config.json` whose class prefix is `alpha`, two clean
 *     entries and one broken entry;
 *   - `root-b`: plain (no config) — a Markdown file plus one document with
 *     `@setup { prefix: "beta" }`.
 *
 * Asserted here:
 *   - per-file config resolution (`alpha` in root A, `beta` from the file's own
 *     `@setup` in root B) with no cross-root bleeding of either config;
 *   - diagnostics are published against each document's own URI and never
 *     against the other root's documents;
 *   - Compile/Open Generated CSS target the active document's own root;
 *   - the folder-based Build/Check path (no editor open) uses the **first**
 *     workspace folder only — the cell the main suite cannot run without
 *     writing into the committed fixture tree;
 *   - contributions stay language-scoped: a Markdown document in a Xessa
 *     workspace gets no Xessa diagnostics and no Xessa completion items.
 *
 * Trusted by construction: the driver passes `--disable-workspace-trust`
 * (which disables the trust feature), because this case is about scoping;
 * Restricted Mode is its own probe.
 */

const { readdir, rm } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const host = require("./host.js");

/** Details the Xessa completion provider is known to emit (U1/U2 modules). */
const XESSA_DETAILS = new Set([
  "CSS property",
  "CSS value",
  "CSS unit",
  "CSS function",
  "CSS color",
  "Xessa directive",
]);

async function findExtension() {
  return vscode.extensions.all.find((candidate) => candidate.packageJSON?.name === "xessa");
}

async function namesOf(directory) {
  return [...(await readdir(directory))].sort();
}

async function readText(uri) {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
}

async function waitForFile(file, timeoutMs = 20000) {
  return host.waitFor(
    async () => {
      try {
        return await vscode.workspace.fs.stat(vscode.Uri.file(file));
      } catch {
        return undefined;
      }
    },
    { timeoutMs, label: path.basename(file) },
  );
}

async function run(t) {
  const extension = await findExtension();
  t.ok(extension, "Xessa is not registered in the probe host");
  await extension.activate();

  const folders = vscode.workspace.workspaceFolders ?? [];
  t.equal(folders.length, 2, "the probe window is not a two-root workspace");
  t.deepEqual(
    folders.map((folder) => folder.name),
    ["root-a", "root-b"],
    "workspace folder names",
  );
  t.equal(vscode.workspace.isTrusted, true, "the multi-root probe must run trusted");
  const rootA = folders[0].uri.fsPath;
  const rootB = folders[1].uri.fsPath;

  // ---- Per-file config resolution. ----
  const entryA = await host.openDocument(vscode.Uri.file(path.join(rootA, "entry.cssx")));
  t.equal(
    vscode.workspace.getWorkspaceFolder(entryA.document.uri)?.name,
    "root-a",
    "entry.cssx does not belong to root-a",
  );
  await vscode.commands.executeCommand("xessa.compileFile");
  await waitForFile(path.join(rootA, "entry.css"));
  const cssA = await readText(vscode.Uri.file(path.join(rootA, "entry.css")));
  t.match(cssA, /\.alpha-button\{/, "root-a's xessa.config.json prefix was not applied");

  const entryB = await host.openDocument(vscode.Uri.file(path.join(rootB, "beta.cssx")));
  t.equal(
    vscode.workspace.getWorkspaceFolder(entryB.document.uri)?.name,
    "root-b",
    "beta.cssx does not belong to root-b",
  );
  await vscode.commands.executeCommand("xessa.compileFile");
  await waitForFile(path.join(rootB, "beta.css"));
  const cssB = await readText(vscode.Uri.file(path.join(rootB, "beta.css")));
  t.match(cssB, /\.beta-tile \{/, "root-b did not use its own @setup prefix");
  t.equal(cssB.includes("alpha"), false, "root-a's config prefix bled into root-b");
  t.equal((await namesOf(rootA)).includes("beta.css"), false, "root-b's compile wrote into root-a");
  t.equal(
    (await namesOf(rootB)).includes("entry.css"),
    false,
    "root-a's compile wrote into root-b",
  );

  // ---- Open Generated CSS is per root. ----
  await vscode.window.showTextDocument(entryB.document);
  await vscode.commands.executeCommand("xessa.openGeneratedCss");
  t.equal(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    path.join(rootB, "beta.css"),
    "Open Generated CSS did not open root-b's own artifact",
  );
  await vscode.window.showTextDocument(entryA.document);
  await vscode.commands.executeCommand("xessa.openGeneratedCss");
  t.equal(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    path.join(rootA, "entry.css"),
    "Open Generated CSS did not open root-a's own artifact",
  );

  // ---- Diagnostics: per document URI, no cross-root bleed. ----
  const brokenA = await host.openDocument(vscode.Uri.file(path.join(rootA, "broken.cssx")));
  const diagnosticsA = await host.waitForDiagnostics(brokenA.document.uri, { code: "XESSA1002" });
  t.ok(
    diagnosticsA.some((entry) => entry.code === "XESSA1002"),
    "root-a's broken entry published no XESSA1002",
  );
  t.equal(
    host.diagnosticsOf(entryB.document.uri).length,
    0,
    "root-a's problem was reported against root-b's document",
  );
  t.equal(
    host.diagnosticsOf(entryA.document.uri).length,
    0,
    "root-a's clean entry has a diagnostic",
  );
  const foreign = vscode.languages
    .getDiagnostics()
    .filter(
      ([uri]) =>
        uri.scheme === "file" && !uri.fsPath.startsWith(rootA) && !uri.fsPath.startsWith(rootB),
    );
  t.deepEqual(
    foreign.map(([uri]) => uri.fsPath),
    [],
    "diagnostics were published outside both workspace roots",
  );

  // ---- Language scoping: the Markdown document gets nothing from Xessa. ----
  const markdown = await host.openDocument(vscode.Uri.file(path.join(rootB, "notes.md")));
  t.equal(markdown.document.languageId, "markdown", "notes.md did not open as Markdown");
  const markdownItems = await host.completionItems(markdown.document, new vscode.Position(0, 2));
  t.equal(
    markdownItems.filter((item) => XESSA_DETAILS.has(String(item.detail))).length,
    0,
    "Xessa completion items were served for a Markdown document",
  );
  t.equal(
    host.diagnosticsOf(markdown.document.uri).length,
    0,
    "a Markdown document received Xessa diagnostics",
  );

  // ---- Folder-based Build/Check with no editor: the first folder only. ----
  await rm(path.join(rootB, "beta.css"), { force: true });
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  t.equal(vscode.window.visibleTextEditors.length, 0, "editors are still open");
  const beforeA = await namesOf(rootA);
  const beforeB = await namesOf(rootB);
  await vscode.commands.executeCommand("xessa.buildProject");
  await waitForFile(path.join(rootA, "second.css"));
  const afterA = await namesOf(rootA);
  const afterB = await namesOf(rootB);
  t.ok(afterA.includes("second.css"), "the folder-based build skipped root-a's second entry");
  t.equal(
    afterA.includes("broken.css"),
    false,
    "the folder-based build wrote CSS for a broken entry",
  );
  t.deepEqual(afterB, beforeB, "the folder-based build wrote into the second root");
  t.ok(afterA.length > beforeA.length, "the folder-based build wrote nothing at all");
  t.equal(
    afterB.includes("beta.css"),
    false,
    "the folder-based build of the first root re-created root-b's artifact",
  );

  // ---- Check Project with no editor: reports, writes nothing in either root. ----
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(path.join(rootA, "entry.css")),
    Buffer.from("stale", "utf8"),
  );
  const beforeCheckA = await namesOf(rootA);
  const beforeCheckB = await namesOf(rootB);
  await vscode.commands.executeCommand("xessa.checkProject");
  t.deepEqual(await namesOf(rootA), beforeCheckA, "Check Project wrote in root-a");
  t.deepEqual(await namesOf(rootB), beforeCheckB, "Check Project wrote in root-b");
  t.equal(
    await readText(vscode.Uri.file(path.join(rootA, "entry.css"))),
    "stale",
    "Check Project rewrote root-a's artifact",
  );

  return `2 roots: alpha/beta prefixes, per-root diagnostics, folder-based build limited to ${path.basename(
    rootA,
  )}`;
}

module.exports = { run };
