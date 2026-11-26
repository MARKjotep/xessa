/**
 * Restricted Mode (untrusted workspace) — the U4 trust column, measured for
 * real instead of stubbed.
 *
 * Runs inside a directly launched dev host whose workspace folder is a fresh
 * `mkdtemp` directory and whose profile is fresh, launched **without**
 * `--disable-workspace-trust`. That is the only way to observe
 * `workspace.isTrusted === false`: `@vscode/test-electron` always passes the
 * flag, and the flag disables the trust feature itself (so the guest host is
 * trusted, not restricted). Both facts were measured, not assumed — see
 * `.ai/reports/CSSX-U4.md`.
 *
 * What is assertable here is the *observable* half of the trust policy:
 *   - `workspace.isTrusted` is false for the whole window;
 *   - the read-only features still work (diagnostics, preview);
 *   - every write path refuses: Compile File, Build Project and compile-on-save
 *     leave the tree unchanged, and the plan-only commands report instead of
 *     opening a file that does not exist.
 * What is *not* assertable through the API: the warning-toast wording, the
 * status-bar text and the output-channel line (`controller.ts:249-252`,
 * `347-350`, `387-390`, `455-458`). Those are pinned in the report by source
 * line plus the U3 CDP screenshots of the status bar and output channel; no
 * fake assertion is written for them.
 */

const { readdir } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const host = require("./host.js");
const { RESTRICTED_FILES } = require("./workspace-fixtures.js");

const ENTRY = RESTRICTED_FILES["entry.cssx"];
const BROKEN = RESTRICTED_FILES["broken.cssx"];

async function findExtension() {
  return vscode.extensions.all.find((candidate) => candidate.packageJSON?.name === "xessa");
}

async function namesOf(directory) {
  return [...(await readdir(directory))].sort();
}

async function appears(directory, relative, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(directory, relative)));
      return true;
    } catch {
      // not there (yet)
    }
    if (Date.now() >= deadline) return false;
    await host.delay(50);
  }
}

async function run(t) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  t.ok(folder, "the probe host has no workspace folder");
  const root = folder.uri.fsPath;
  const extension = await findExtension();
  t.ok(extension, "Xessa is not registered in the probe host");

  // ---- The state itself, measured. ----
  t.equal(vscode.workspace.isTrusted, false, "the probe window is not in Restricted Mode");
  t.equal(
    vscode.workspace.workspaceFolders.length,
    1,
    "the restricted probe expects exactly one workspace folder",
  );

  // The driver wrote the sources from `workspace-fixtures.js`; the suite only
  // asserts against the same strings.
  const sources = await namesOf(root);
  t.deepEqual(sources, ["broken.cssx", "entry.cssx", "second.cssx"], "the probe sources");

  const entry = await host.openDocument(vscode.Uri.file(path.join(root, "entry.cssx")));
  t.equal(entry.document.languageId, "xessa", "the entry did not open as Xessa");
  // `onLanguage:xessa` activation is asynchronous; poll instead of assuming.
  await host.waitFor(() => extension.isActive, { label: "Xessa activation in Restricted Mode" });
  t.equal(extension.isActive, true, "the extension is not active in Restricted Mode");

  // Read-only surface: analysis and diagnostics are not trust-gated.
  const broken = await host.openDocument(vscode.Uri.file(path.join(root, "broken.cssx")));
  const diagnostics = await host.waitForDiagnostics(broken.document.uri, { code: "XESSA1002" });
  t.ok(
    diagnostics.some((entry) => entry.code === "XESSA1002"),
    "Restricted Mode disabled diagnostics, which are read-only",
  );

  // ---- Compile File: warns and writes nothing. ----
  await vscode.window.showTextDocument(entry.document);
  await vscode.commands.executeCommand("xessa.compileFile");
  t.equal(await appears(root, "entry.css", 0), false, "Compile File wrote CSS in Restricted Mode");
  t.equal(
    (await namesOf(root)).filter((name) => name.endsWith(".css") || name.endsWith(".map.js"))
      .length,
    0,
    `Compile File wrote artifacts in Restricted Mode: ${(await namesOf(root)).join()}`,
  );

  // ---- Build Project: warns and writes nothing for every entry. ----
  await vscode.commands.executeCommand("xessa.buildProject");
  const afterBuild = await namesOf(root);
  t.deepEqual(afterBuild, sources, `Build Project wrote in Restricted Mode: ${afterBuild.join()}`);

  // ---- Check Project: allowed, reports, still writes nothing. ----
  await vscode.commands.executeCommand("xessa.checkProject");
  t.deepEqual(await namesOf(root), afterBuild, "Check Project wrote files in Restricted Mode");
  t.ok(
    (await host.waitForDiagnostics(broken.document.uri)).length > 0,
    "Check Project did not report the broken entry in Restricted Mode",
  );

  // ---- Preview: in-memory, allowed, nothing written. ----
  await vscode.window.showTextDocument(entry.document);
  await vscode.commands.executeCommand("xessa.previewCompiledCss");
  const preview = vscode.window.activeTextEditor;
  t.ok(preview, "Preview Compiled CSS opened no editor in Restricted Mode");
  t.equal(preview.document.uri.scheme, "xessa-preview", "the preview is not a virtual document");
  t.match(
    preview.document.getText(),
    /\.restricted-button\{/,
    "the Restricted Mode preview lacks the compiled CSS",
  );
  t.deepEqual(await namesOf(root), afterBuild, "Preview wrote a file in Restricted Mode");

  // ---- Open Generated CSS / Class Map: nothing exists, so they report. ----
  await vscode.window.showTextDocument(entry.document);
  await vscode.commands.executeCommand("xessa.openGeneratedCss");
  t.equal(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    entry.document.uri.fsPath,
    "Open Generated CSS opened an editor for a file that was never generated",
  );
  await vscode.commands.executeCommand("xessa.openClassMap");
  t.equal(
    vscode.window.activeTextEditor?.document.uri.fsPath,
    entry.document.uri.fsPath,
    "Open Class Map opened an editor for a file that was never generated",
  );

  // ---- Compile-on-save: gated by trust even when the setting is on. ----
  const settings = vscode.workspace.getConfiguration("xessa", entry.document.uri);
  await settings.update("compileOnSave", true, vscode.ConfigurationTarget.Global);
  try {
    t.equal(
      // Re-read through a fresh configuration object: the one that was updated
      // does not refresh its own resource-scoped cache.
      vscode.workspace
        .getConfiguration("xessa", entry.document.uri)
        .get("compileOnSave", false),
      true,
      "the compileOnSave setting did not apply inside the probe window",
    );
    const editor = await vscode.window.showTextDocument(entry.document);
    await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
    await entry.document.save();
    t.equal(
      await appears(root, "entry.css", 1500),
      false,
      "compile-on-save wrote an artifact in Restricted Mode",
    );
  } finally {
    await settings.update("compileOnSave", false, vscode.ConfigurationTarget.Global);
  }

  // ---- The trust refusal did not leave the tree dirty either way. ----
  t.deepEqual(
    await namesOf(root),
    afterBuild,
    "Restricted Mode commands changed the workspace tree",
  );
  t.equal(
    vscode.workspace.isTrusted,
    false,
    "the window unexpectedly became trusted during the probe",
  );

  return `untrusted=${!vscode.workspace.isTrusted}: compile/build/compile-on-save wrote nothing, check/preview allowed`;
}

module.exports = { run };
