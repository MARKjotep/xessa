/**
 * Command scenarios — each of the six contributed commands through
 * `vscode.commands.executeCommand`, asserted on filesystem side effects and on
 * the editors they open.
 *
 * Everything runs in a `mkdtemp` + `realpath` workspace so no fixture and no
 * `examples/` directory is ever written. The status bar text, the output
 * channel lines and the toast texts are **not** readable through the public
 * API; they are recorded for U3/U4 instead of being faked here.
 */

const { rm } = require("node:fs/promises");
const vscode = require("vscode");
const host = require("./host.js");

const ENTRY = '@setup { prefix: "app"; map-types: true; }\n.button { color: red; }\n';
const SECOND = '@setup { prefix: "app"; }\n.card { padding: 4px; }\n';
const BROKEN = '@setup {\n  prefix: "app";\n}\n.card {\n  color: red\n  padding: 4px;\n}\n';

async function clean(directory, names) {
  for (const name of names) await rm(directory.resolve(name), { force: true });
}

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-commands-");
  try {
    await workspace.write("entry.cssx", ENTRY);
    await workspace.write("second.cssx", SECOND);
    const { editor } = await host.openDocument(workspace.uri("entry.cssx"));
    t.ok(editor, "entry document did not open");

    // Compile File: writes the planned artifacts for this document only.
    await vscode.commands.executeCommand("xessa.compileFile");
    const afterCompile = await workspace.entries();
    t.ok(afterCompile.includes("entry.css"), `compileFile wrote no CSS: ${afterCompile.join()}`);
    t.ok(afterCompile.includes("entry.map.js"), "compileFile wrote no class map");
    t.ok(afterCompile.includes("entry.map.d.ts"), "compileFile wrote no types");
    t.equal(afterCompile.includes("second.css"), false, "compileFile built an unrelated entry");
    const compiledCss = await workspace.read("entry.css");
    t.match(compiledCss, /\.app-button\{/, "the compiled CSS carries the @setup prefix");
    t.match(await workspace.read("entry.map.js"), /app-button/, "the class map carries the prefix");

    // Build Project: every discovered entry in the active document's project.
    await vscode.commands.executeCommand("xessa.buildProject");
    const afterBuild = await workspace.entries();
    t.ok(
      afterBuild.includes("second.css"),
      `buildProject skipped second.css: ${afterBuild.join()}`,
    );
    t.ok(afterBuild.includes("second.map.js"), "buildProject wrote no map for the second entry");
    t.equal(
      afterBuild.filter((name) => name.endsWith(".cssx")).length,
      2,
      "buildProject built exactly the two Xessa entries",
    );

    // Check Project: reports, writes nothing.
    await clean(workspace, ["entry.css", "entry.map.js", "entry.map.d.ts", "second.css"]);
    await vscode.commands.executeCommand("xessa.checkProject");
    const afterCheck = await workspace.entries();
    t.equal(afterCheck.includes("entry.css"), false, "checkProject wrote CSS");
    t.equal(afterCheck.includes("second.css"), false, "checkProject wrote a second artifact set");
    t.equal(
      afterCheck.filter((name) => name.endsWith(".cssx")).length,
      2,
      "checkProject touched the source set",
    );

    // Preview Compiled CSS: in-memory document, nothing on disk.
    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    const preview = vscode.window.activeTextEditor;
    t.ok(preview, "preview command did not open an editor");
    t.equal(preview.document.uri.scheme, "xessa-preview", "preview is not a virtual document");
    t.match(preview.document.getText(), /\.app-button\{/, "preview lacks the compiled CSS");
    t.equal(
      (await workspace.entries()).includes("entry.css"),
      false,
      "preview wrote a file to disk",
    );

    // Open Generated CSS / Open Class Map: open the planned artifact.
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.compileFile");
    await vscode.commands.executeCommand("xessa.openGeneratedCss");
    const generated = vscode.window.activeTextEditor;
    t.ok(generated, "openGeneratedCss opened no editor");
    t.ok(
      generated.document.uri.fsPath.endsWith("entry.css"),
      `openGeneratedCss opened ${generated.document.uri.fsPath}`,
    );
    t.equal(generated.document.languageId, "css", "the generated CSS opens as CSS");
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.openClassMap");
    const classMap = vscode.window.activeTextEditor;
    t.ok(classMap, "openClassMap opened no editor");
    t.ok(
      classMap.document.uri.fsPath.endsWith("entry.map.js"),
      `openClassMap opened ${classMap.document.uri.fsPath}`,
    );

    // A document with errors writes nothing and leaves the previous outputs alone.
    await workspace.write("broken.cssx", BROKEN);
    const before = await workspace.read("entry.css");
    await host.openDocument(workspace.uri("broken.cssx"));
    await vscode.commands.executeCommand("xessa.compileFile");
    const afterBroken = await workspace.entries();
    t.equal(
      afterBroken.includes("broken.css"),
      false,
      "compileFile wrote CSS for a broken document",
    );
    t.equal(
      await workspace.read("entry.css"),
      before,
      "a failed compile changed the previous output",
    );

    // No active Xessa editor: the command returns with an information message
    // (not readable through the API) and must write nothing.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    t.equal(vscode.window.visibleTextEditors.length, 0, "editors are still open");
    await workspace.write("idle.cssx", SECOND);
    await vscode.commands.executeCommand("xessa.compileFile");
    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    const afterIdle = await workspace.entries();
    t.equal(afterIdle.includes("idle.css"), false, "compileFile without an editor wrote a file");

    return "6 commands: compile/build/check/preview/open-css/open-map side effects";
  } finally {
    await workspace.dispose();
  }
}

module.exports = { run };
