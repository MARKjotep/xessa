/**
 * Baseline host assertions — the original `test/suite.js` cases, unchanged.
 *
 * These are the no-weakening floor of the U1 harness: activation, the manifest
 * surface, the six commands, the `@2xl` completion, the broken fixture's
 * diagnostics, Compile File's artifacts, Preview Compiled CSS, and the
 * format / format-on-save behaviour (default off, on, parse error untouched).
 * Every assertion and every assertion's meaning is preserved verbatim; the only
 * change is the `t` recorder so the runner can report the total.
 */

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const host = require("./host.js");

async function findExtension() {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON?.name === "xessa",
  );
  return extension;
}

async function run(t) {
  const extension = await findExtension();
  t.ok(extension, "Xessa extension is not registered in the development host");
  await extension.activate();
  t.equal(extension.isActive, true, "extension did not activate");

  const manifest = extension.packageJSON;
  t.equal(manifest.contributes.grammars[0].scopeName, "source.xessa");
  t.equal(manifest.contributes.grammars[0].language, "xessa");
  t.ok(
    manifest.contributes.languages.some((language) => language.id === "xessa"),
    "xessa language contribution missing",
  );
  const formatSetting = manifest.contributes.configuration.properties["xessa.editor.formatOnSave"];
  t.ok(formatSetting, "xessa.editor.formatOnSave setting is not contributed");
  t.equal(formatSetting.type, "boolean");
  t.equal(formatSetting.default, false, "formatOnSave must default to off");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "xessa.compileFile",
    "xessa.buildProject",
    "xessa.previewCompiledCss",
    "xessa.openGeneratedCss",
    "xessa.openClassMap",
    "xessa.checkProject",
  ]) {
    t.ok(commands.includes(command), `missing command ${command}`);
  }

  const fixture = host.fixtureUri("broken.cssx");
  const document = await vscode.workspace.openTextDocument(fixture);
  t.equal(document.languageId, "xessa");
  await vscode.window.showTextDocument(document);

  const diagnostics = await host.waitForDiagnostics(fixture);
  t.ok(diagnostics.length > 0, "no diagnostics were published for the broken document");
  t.ok(
    diagnostics.some((diagnostic) => String(diagnostic.code).startsWith("XESSA")),
    `diagnostics did not carry a XESSA code: ${JSON.stringify(
      diagnostics.map((diagnostic) => diagnostic.code),
    )}`,
  );
  t.ok(
    diagnostics.some((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error),
    "expected at least one error diagnostic",
  );

  // Completion smoke check (aliases include @2xl).
  const completionFixture = host.fixtureUri("complete.cssx");
  const completionDocument = await vscode.workspace.openTextDocument(completionFixture);
  await vscode.window.showTextDocument(completionDocument);
  const items = await host.completionItems(completionDocument, new vscode.Position(2, 15), "@");
  const labels = items.map(host.labelOf);
  t.ok(labels.includes("@2xl"), `completion list missing @2xl: ${labels.length} items`);

  // Command smoke: Compile File writes planned artifacts and Preview stays in memory.
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "xessa-host-"));
  // Resolve /var → /private/var so the planner's symlink containment check
  // sees the source inside its workspace root.
  const temporary = await fs.realpath(created);
  try {
    const sample = path.join(temporary, "sample.cssx");
    await fs.writeFile(sample, '@setup { prefix: "ui"; }\n.button { color: red; }\n', "utf8");
    const sampleDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(sample));
    await vscode.window.showTextDocument(sampleDocument);
    t.equal(vscode.workspace.isTrusted, true, "test workspace is not trusted");
    await vscode.commands.executeCommand("xessa.compileFile");
    const css = await fs.readFile(path.join(temporary, "sample.css"), "utf8");
    const map = await fs.readFile(path.join(temporary, "sample.map.js"), "utf8");
    t.ok(css.includes(".ui-button"), "compileFile did not write the prefixed CSS");
    t.ok(map.includes("ui-button"), "compileFile did not write the class map");

    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    const preview = vscode.window.activeTextEditor;
    t.ok(preview, "preview command did not open an editor");
    t.equal(preview.document.uri.scheme, "xessa-preview");
    t.ok(
      preview.document.getText().includes(".ui-button"),
      "preview document does not contain the compiled CSS",
    );
    t.equal(
      await fs
        .readFile(path.join(temporary, "sample.css"), "utf8")
        .then((value) => value.includes(".ui-button")),
      true,
    );

    // Formatting: Format Document reaches the registered provider.
    const formatPath = path.join(temporary, "format-manual.cssx");
    await fs.writeFile(formatPath, ".card{color:red}", "utf8");
    const formatDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(formatPath));
    await vscode.window.showTextDocument(formatDocument);
    const formatEdits = await vscode.commands.executeCommand(
      "vscode.executeFormatDocumentProvider",
      formatDocument.uri,
      { tabSize: 2, insertSpaces: true },
    );
    t.ok(Array.isArray(formatEdits), "Format Document provider returned no edit list");
    t.ok(formatEdits.length > 0, "Format Document provider returned no edits");
    const applyFormat = new vscode.WorkspaceEdit();
    for (const edit of formatEdits) {
      applyFormat.replace(formatDocument.uri, edit.range, edit.newText);
    }
    t.equal(await vscode.workspace.applyEdit(applyFormat), true);
    t.equal(formatDocument.getText(), ".card {\n  color: red;\n}\n");

    // Save path: default off saves untouched, then on formats; parse errors stay put.
    const savePath = path.join(temporary, "format-save.cssx");
    await fs.writeFile(savePath, ".card{color:red}", "utf8");
    const saveDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(savePath));
    const saveEditor = await vscode.window.showTextDocument(saveDocument);
    const xessaConfig = vscode.workspace.getConfiguration("xessa", saveDocument.uri);
    await xessaConfig.update("editor.formatOnSave", false, vscode.ConfigurationTarget.Global);

    await saveEditor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
    await saveDocument.save();
    t.equal(saveDocument.getText(), " .card{color:red}");
    t.equal(await fs.readFile(savePath, "utf8"), " .card{color:red}");

    await xessaConfig.update("editor.formatOnSave", true, vscode.ConfigurationTarget.Global);
    await saveEditor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
    await saveDocument.save();
    t.equal(saveDocument.getText(), ".card {\n  color: red;\n}\n");
    t.equal(await fs.readFile(savePath, "utf8"), ".card {\n  color: red;\n}\n");

    const errorPath = path.join(temporary, "format-error.cssx");
    const brokenSource = "@md {\n  .card { padding: 20px; }\n}\n";
    await fs.writeFile(errorPath, brokenSource, "utf8");
    const errorDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(errorPath));
    const errorEditor = await vscode.window.showTextDocument(errorDocument);
    await errorEditor.edit((builder) => builder.insert(new vscode.Position(0, 0), "/* keep */\n"));
    await errorDocument.save();
    const expectedBroken = `/* keep */\n${brokenSource}`;
    t.equal(errorDocument.getText(), expectedBroken);
    t.equal(await fs.readFile(errorPath, "utf8"), expectedBroken);
  } finally {
    await vscode.workspace
      .getConfiguration("xessa")
      .update("editor.formatOnSave", false, vscode.ConfigurationTarget.Global);
    await fs.rm(temporary, { recursive: true, force: true });
  }

  return `activation, grammar, 6 commands, ${diagnostics.length} diagnostic(s), completion ${labels.length} item(s), compile+preview, format/format-on-save`;
}

module.exports = { run };
