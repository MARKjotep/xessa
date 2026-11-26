/**
 * Dependency invalidation: an open importer re-analyzes when the module it
 * imports changes, without the importer itself being edited.
 *
 * Owner report 2026-11-26: after renaming a `$token` / `@runtime` in a defining
 * module, an open importing document kept its old diagnostics until it was
 * retyped. The module graph is read from disk, so the save is the invalidation
 * trigger; every assertion waits on observable diagnostics, never on a sleep.
 *
 * The final block re-asserts the pre-existing behaviour: the module's own
 * diagnostics still refresh on the module's own edit.
 */

const vscode = require("vscode");
const host = require("./host.js");

const MODULE = ["@setup { module: true; }", "@variables {", "  space: 8px;", "}"].join("\n");

const IMPORTER = ['@use "./tokens.cssx" as t;', ".x {", "  padding: $t.space;", "}"].join("\n");

/**
 * Replace the first `needle` in `document` with `replacement`.
 *
 * A `WorkspaceEdit` is used instead of `TextEditor#edit` so a document whose
 * visible editor was replaced by another tab is still editable.
 */
async function replaceIn(document, needle, replacement) {
  const index = document.getText().indexOf(needle);
  if (index < 0) throw new Error(`document does not contain ${JSON.stringify(needle)}`);
  const start = document.positionAt(index);
  const end = document.positionAt(index + needle.length);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(start, end), replacement);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) throw new Error(`workspace rejected replacing ${JSON.stringify(needle)}`);
}

async function waitForCode(uri, code) {
  return host.waitFor(
    () => host.diagnosticsOf(uri).some((diagnostic) => diagnostic.code === code),
    { label: `${code} for ${uri.fsPath}` },
  );
}

async function waitForClean(uri, label) {
  return host.waitFor(() => host.diagnosticsOf(uri).length === 0, { label });
}

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-module-refresh-");
  try {
    const module = await workspace.open("tokens.cssx", MODULE);
    const importer = await workspace.open("main.cssx", IMPORTER);

    // Both start clean: the initial analysis has settled.
    const initial = await host.settleDiagnostics(importer.document.uri);
    t.equal(initial.length, 0, `clean importer published ${initial.length} diagnostic(s)`);
    const initialModule = await host.settleDiagnostics(module.document.uri);
    t.equal(
      initialModule.length,
      0,
      `clean module published ${initialModule.length} diagnostic(s)`,
    );

    // Rename the compile-time token in the module and save it. The importer is
    // not touched, so only dependency invalidation can surface the error.
    await replaceIn(module.document, "space: 8px;", "gap: 8px;");
    await module.document.save();
    const compileDiagnostics = await waitForCode(importer.document.uri, "XESSA2001");
    t.ok(compileDiagnostics, "renaming $t.space did not report XESSA2001 in the importer");
    const missingCompile = host
      .diagnosticsOf(importer.document.uri)
      .find((diagnostic) => diagnostic.code === "XESSA2001");
    t.match(
      missingCompile.message,
      /\$t\.space/,
      "the importer diagnostic names the stale $t.space reference",
    );

    // Fixing the importer clears the error.
    await replaceIn(importer.document, "$t.space", "$t.gap");
    await importer.document.save();
    await waitForClean(importer.document.uri, "importer diagnostics to clear after the fix");
    t.equal(
      host.diagnosticsOf(importer.document.uri).length,
      0,
      "the importer kept diagnostics after referencing $t.gap",
    );

    // Runtime tokens follow the same path. The module gains `@runtime { colors }`
    // and the importer switches to it while both are clean.
    await replaceIn(
      module.document,
      "@variables {\n  gap: 8px;\n}",
      "@variables {\n  gap: 8px;\n}\n@runtime {\n  colors: #ffffff;\n}",
    );
    await module.document.save();
    await replaceIn(importer.document, "$t.gap", "$t.colors");
    await importer.document.save();
    await waitForClean(importer.document.uri, "importer to accept the new @runtime token");
    t.equal(
      host.diagnosticsOf(importer.document.uri).length,
      0,
      "referencing $t.colors reported a diagnostic",
    );

    await replaceIn(module.document, "colors: #ffffff;", "palette: #ffffff;");
    await module.document.save();
    const runtimeDiagnostics = await waitForCode(importer.document.uri, "XESSA2001");
    t.ok(runtimeDiagnostics, "renaming $t.colors did not report XESSA2001 in the importer");
    const missingRuntime = host
      .diagnosticsOf(importer.document.uri)
      .find((diagnostic) => diagnostic.code === "XESSA2001");
    t.match(
      missingRuntime.message,
      /\$t\.colors/,
      "the importer diagnostic names the stale $t.colors reference",
    );

    await replaceIn(importer.document, "$t.colors", "$t.palette");
    await importer.document.save();
    await waitForClean(
      importer.document.uri,
      "importer diagnostics to clear after the runtime fix",
    );
    t.equal(
      host.diagnosticsOf(importer.document.uri).length,
      0,
      "the importer kept diagnostics after referencing $t.palette",
    );

    // Existing behaviour: the module's own diagnostics refresh on its own edit,
    // even before the file is saved (the module's text is the analysis input).
    await replaceIn(
      module.document,
      "@variables {",
      ".broken {\n  padding: $missing;\n}\n@variables {",
    );
    await waitForCode(module.document.uri, "XESSA2001");
    t.ok(
      host.diagnosticsOf(module.document.uri).some((diagnostic) => diagnostic.code === "XESSA2001"),
      "the module did not report its own undefined token",
    );
    await replaceIn(module.document, ".broken {\n  padding: $missing;\n}\n", "");
    await module.document.save();
    await waitForClean(module.document.uri, "module diagnostics to clear after reverting the edit");
    t.equal(
      host.diagnosticsOf(module.document.uri).length,
      0,
      "the module kept diagnostics after reverting the broken rule",
    );

    return "importer re-analyzed on $token and @runtime module saves; module self-refresh kept";
  } finally {
    await workspace.dispose();
  }
}

module.exports = { run };
