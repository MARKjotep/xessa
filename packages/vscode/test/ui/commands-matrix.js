/**
 * U4 command matrix — every contributed command × every workspace state the
 * main host suite can reach, asserted on observable side effects.
 *
 * The matrix (see `.ai/reports/CSSX-U4.md`):
 *   palette presence · trusted run with a Xessa document active · no editor open
 *   · error surfacing on a broken document · artifact-absent paths.
 *
 * Two cells are **not** executed here and are covered by the standalone
 * workspace probe (`packages/vscode/test/ui/workspace-probe.js`), with the
 * reason recorded in the report:
 *   - Restricted Mode: `@vscode/test-electron` always passes
 *     `--disable-workspace-trust`, which disables the trust feature itself, so
 *     the guest host is trusted by construction (verified: the probe without
 *     that flag reports `isTrusted === false`).
 *   - Folder-based Build/Check with no editor: the guest workspace folder is
 *     the committed `test/fixtures` tree, and the folder-based path writes
 *     `*.css`/`*.map.js` next to the sources, which this campaign must never do
 *     inside a committed fixture.
 *
 * Status-bar text, output-channel lines and toast texts are write-only in the
 * public API; U3 captured them over CDP and this module asserts the side
 * effects (artifacts, opened editors, diagnostics) instead.
 */

const { mkdir } = require("node:fs/promises");
const vscode = require("vscode");
const host = require("./host.js");

/** The six contributed commands, title and category as the palette renders them. */
const PALETTE = [
  { id: "xessa.compileFile", title: "Compile File" },
  { id: "xessa.buildProject", title: "Build Project" },
  { id: "xessa.previewCompiledCss", title: "Preview Compiled CSS" },
  { id: "xessa.openGeneratedCss", title: "Open Generated CSS" },
  { id: "xessa.openClassMap", title: "Open Class Map" },
  { id: "xessa.checkProject", title: "Check Project" },
];

const ENTRY = '@setup { prefix: "app"; map-types: true; }\n.button { color: red; }\n';
const SECOND = '@setup { prefix: "app"; }\n.card { padding: 4px; }\n';
const NO_CSS = '@setup { prefix: "app"; emit-css: false; }\n.map-only { color: red; }\n';
const BROKEN = '@setup { prefix: "app"; }\n.button {\n  color: red\n  padding: 4px;\n}\n';

async function findExtension() {
  return vscode.extensions.all.find((candidate) => candidate.packageJSON?.name === "xessa");
}

/** `true` when `relative` exists within `timeoutMs`; `false` at the deadline. */
async function appears(workspace, relative, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await workspace.exists(relative)) return true;
    if (Date.now() >= deadline) return false;
    await host.delay(50);
  }
}

async function closeEditors() {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

async function run(t) {
  const extension = await findExtension();
  t.ok(extension, "Xessa extension is not registered in the development host");
  await extension.activate();
  const manifest = extension.packageJSON;

  // ---- Palette presence: the manifest is the palette's source of truth. ----
  const contributed = manifest.contributes.commands;
  t.equal(contributed.length, 6, "the manifest must contribute exactly six commands");
  for (const expected of PALETTE) {
    const entry = contributed.find((candidate) => candidate.command === expected.id);
    t.ok(entry, `palette entry missing for ${expected.id}`);
    t.equal(entry.title, expected.title, `${expected.id} palette title`);
    t.equal(entry.category, "Xessa", `${expected.id} palette category (renders "Xessa: …")`);
    t.ok(entry.title !== "", `${expected.id} would show without a label in the Command Palette`);
  }
  // The design contributes no keybindings and no menus: palette-only discovery.
  t.equal(manifest.contributes.keybindings, undefined, "unexpected keybinding contribution");
  t.equal(manifest.contributes.menus, undefined, "unexpected menu contribution");
  const activation = manifest.activationEvents ?? [];
  t.ok(activation.includes("onLanguage:xessa"), "activation is not scoped to the xessa language");
  for (const expected of PALETTE) {
    t.ok(
      activation.includes(`onCommand:${expected.id}`),
      `${expected.id} cannot be invoked from the palette before activation`,
    );
  }
  const registered = await vscode.commands.getCommands(true);
  for (const expected of PALETTE) {
    t.ok(registered.includes(expected.id), `${expected.id} is missing from getCommands`);
  }

  const workspace = await host.createWorkspace("xessa-ui-matrix-");
  try {
    await workspace.write("entry.cssx", ENTRY);
    await workspace.write("second.cssx", SECOND);
    await workspace.write("no-css.cssx", NO_CSS);
    await closeEditors();

    // ---- Trusted run, `.cssx` active: Compile File. ----
    const { editor, document } = await host.openDocument(workspace.uri("entry.cssx"));
    t.ok(editor, "entry document did not open");
    await vscode.commands.executeCommand("xessa.compileFile");
    t.ok(await appears(workspace, "entry.css"), "Compile File wrote no CSS");
    t.ok(await appears(workspace, "entry.map.js"), "Compile File wrote no class map");
    t.ok(await appears(workspace, "entry.map.d.ts"), "Compile File wrote no types");
    t.match(await workspace.read("entry.css"), /\.app-button\{/, "compiled CSS lacks the prefix");
    t.equal(await workspace.exists("second.css"), false, "Compile File built another entry");

    // ---- Compile File on a broken document: no write, previous output intact. ----
    const beforeBroken = await workspace.read("entry.css");
    await editor.edit((builder) =>
      builder.replace(new vscode.Range(0, 0, document.lineCount, 0), BROKEN),
    );
    t.equal(document.getText(), BROKEN, "the document was not made broken");
    await vscode.commands.executeCommand("xessa.compileFile");
    t.equal(await workspace.read("entry.css"), beforeBroken, "a failed compile rewrote the CSS");
    t.equal(
      await workspace.exists("entry.css.tmp"),
      false,
      "a failed compile left a temporary file behind",
    );
    const brokenDiagnostics = await host.waitForDiagnostics(document.uri, { code: "XESSA1002" });
    t.ok(
      brokenDiagnostics.some((entry) => entry.code === "XESSA1002"),
      "the missing semicolon was not surfaced as XESSA1002",
    );
    await editor.edit((builder) =>
      builder.replace(new vscode.Range(0, 0, document.lineCount, 0), ENTRY),
    );
    t.equal(document.getText(), ENTRY, "the document was not restored");

    // ---- Build Project: every discovered entry, failure counted, broken skipped. ----
    await workspace.write("broken.cssx", BROKEN);
    await vscode.commands.executeCommand("xessa.buildProject");
    t.ok(await appears(workspace, "second.css"), "Build Project skipped second.css");
    t.ok(await appears(workspace, "second.map.js"), "Build Project wrote no map for second.css");
    t.equal(
      await workspace.exists("broken.css"),
      false,
      "Build Project wrote CSS for a broken entry",
    );
    const brokenUri = workspace.uri("broken.cssx");
    const brokenProjectDiagnostics = await host.waitForDiagnostics(brokenUri);
    t.ok(brokenProjectDiagnostics.length > 0, "a failing project entry published no diagnostics");

    // ---- Compile File honours `emit-css: false`: map only, no CSS. ----
    await host.openDocument(workspace.uri("no-css.cssx"));
    await vscode.commands.executeCommand("xessa.compileFile");
    t.equal(await workspace.exists("no-css.css"), false, "Compile File ignored emit-css: false");
    t.ok(await appears(workspace, "no-css.map.js"), "Compile File wrote no map for emit-css:false");

    // ---- Check Project: reports, writes nothing. ----
    const generated = [
      "entry.css",
      "entry.map.js",
      "entry.map.d.ts",
      "second.css",
      "second.map.js",
    ];
    for (const name of generated) await workspace.write(name, "stale");
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.checkProject");
    for (const name of generated) {
      t.equal(await workspace.read(name), "stale", `Check Project rewrote ${name}`);
    }
    t.ok(
      (await host.waitForDiagnostics(workspace.uri("broken.cssx"))).length > 0,
      "Check Project reported no diagnostics for the broken entry",
    );

    // ---- Preview Compiled CSS: in-memory document, nothing written. ----
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    const preview = vscode.window.activeTextEditor;
    t.ok(preview, "Preview Compiled CSS opened no editor");
    t.equal(preview.document.uri.scheme, "xessa-preview", "preview is not a virtual document");
    t.equal(
      preview.document.uri.toString().includes("entry.cssx"),
      true,
      "the preview URI does not name the source document",
    );
    t.match(preview.document.getText(), /\.app-button\{/, "preview lacks the compiled CSS");
    t.equal(preview.document.languageId, "css", "the preview document is not rendered as CSS");
    for (const name of generated) {
      t.equal(await workspace.read(name), "stale", `Preview wrote ${name}`);
    }

    // ---- Preview on a broken document: tolerant CSS, nothing written. ----
    // A missing semicolon still compiles (the malformed declaration is dropped),
    // so the preview opens with the surviving rule and the XESSA1002 diagnostic
    // stays. The dead-document case below shows the warning instead (CSSX-U06).
    await host.openDocument(workspace.uri("broken.cssx"));
    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    const brokenPreview = vscode.window.activeTextEditor;
    t.equal(
      brokenPreview?.document.uri.scheme,
      "xessa-preview",
      "preview of a broken document opened no virtual document",
    );
    t.match(
      brokenPreview.document.getText(),
      /\.app-button\{/,
      "the tolerant preview lost the valid rule",
    );
    t.equal(
      brokenPreview.document.getText().includes("color: red"),
      false,
      "the malformed declaration reached the preview CSS",
    );
    t.ok(
      (await host.waitForDiagnostics(workspace.uri("broken.cssx"))).length > 0,
      "previewing a broken document lost its diagnostics",
    );
    t.equal(await workspace.exists("broken.css"), false, "Preview wrote CSS for a broken document");

    await workspace.write("dead.cssx", "!!! not a stylesheet !!!\n");
    const dead = await host.openDocument(workspace.uri("dead.cssx"));
    await vscode.commands.executeCommand("xessa.previewCompiledCss");
    // No CSS is producible, so the command shows its warning and opens no
    // preview document; the previously active editor stays active (CSSX-U06).
    const deadPreview = vscode.window.activeTextEditor;
    t.equal(
      deadPreview?.document.uri.toString(),
      dead.document.uri.toString(),
      "previewing a dead document changed the active editor instead of warning (CSSX-U06)",
    );
    t.equal(
      vscode.window.visibleTextEditors.some(
        (editor) =>
          editor.document.uri.scheme === "xessa-preview" &&
          editor.document.uri.toString().includes("dead.cssx"),
      ),
      false,
      "a dead document opened a preview document instead of the warning (CSSX-U06)",
    );

    // ---- Open Generated CSS / Class Map: the planned artifacts. ----
    await workspace.write("entry.css", ".app-button { color: red; }\n");
    await workspace.write("entry.map.js", "export const classes = {};\n");
    const beforeOpen = await workspace.entries();
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.openGeneratedCss");
    const openedCss = vscode.window.activeTextEditor;
    t.ok(openedCss, "Open Generated CSS opened no editor");
    t.ok(
      openedCss.document.uri.fsPath.endsWith("entry.css"),
      `Open Generated CSS opened ${openedCss.document.uri.fsPath}`,
    );
    t.equal(openedCss.document.languageId, "css", "the generated CSS did not open as CSS");
    await host.openDocument(workspace.uri("entry.cssx"));
    await vscode.commands.executeCommand("xessa.openClassMap");
    const openedMap = vscode.window.activeTextEditor;
    t.ok(openedMap, "Open Class Map opened no editor");
    t.ok(
      openedMap.document.uri.fsPath.endsWith("entry.map.js"),
      `Open Class Map opened ${openedMap.document.uri.fsPath}`,
    );
    t.equal(
      openedMap.document.languageId,
      "javascript",
      "the class map did not open as JavaScript",
    );
    t.deepEqual(await workspace.entries(), beforeOpen, "opening generated artifacts wrote to disk");

    // ---- Artifact-absent paths: message, no editor, no write. ----
    await workspace.write("unbuilt.cssx", ENTRY);
    const unbuilt = await host.openDocument(workspace.uri("unbuilt.cssx"));
    await vscode.commands.executeCommand("xessa.openGeneratedCss");
    t.equal(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      unbuilt.document.uri.fsPath,
      "Open Generated CSS changed the editor even though nothing was generated",
    );
    t.equal(await workspace.exists("unbuilt.css"), false, "a read-only command generated a file");

    // `emit-css: false` plans no CSS output: the command must report, not open.
    const noCss = await host.openDocument(workspace.uri("no-css.cssx"));
    await vscode.commands.executeCommand("xessa.openGeneratedCss");
    t.equal(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      noCss.document.uri.fsPath,
      "Open Generated CSS opened something for a document with no CSS output",
    );
    await vscode.commands.executeCommand("xessa.openClassMap");
    t.equal(
      vscode.window.activeTextEditor?.document.uri.toString().endsWith("no-css.map.js"),
      true,
      "Open Class Map did not open the planned map of an emit-css:false document",
    );

    // ---- No editor open: the editor-scoped commands are safe no-ops. ----
    await closeEditors();
    t.equal(vscode.window.visibleTextEditors.length, 0, "editors are still open");
    const beforeIdle = await workspace.entries();
    for (const command of [
      "xessa.compileFile",
      "xessa.previewCompiledCss",
      "xessa.openGeneratedCss",
      "xessa.openClassMap",
    ]) {
      await vscode.commands.executeCommand(command);
      t.equal(
        vscode.window.visibleTextEditors.length,
        0,
        `${command} opened an editor with no active document`,
      );
    }
    t.deepEqual(
      await workspace.entries(),
      beforeIdle,
      "an editor-scoped command wrote to disk with no active document",
    );

    // ---- No `.cssx` discoverable under the active document's root. ----
    // The active document's directory is the project root here; deleting the
    // only entry from disk leaves the buffer open but the discovery empty, so
    // the "nothing to build" path runs without touching the guest workspace.
    await mkdir(workspace.resolve("empty"), { recursive: true });
    const lone = await workspace.open(
      "empty/lone.cssx",
      '@setup { prefix: "app"; }\n.only { color: red; }\n',
    );
    await vscode.workspace.fs.delete(vscode.Uri.file(workspace.resolve("empty/lone.cssx")));
    await vscode.commands.executeCommand("xessa.buildProject");
    await vscode.commands.executeCommand("xessa.checkProject");
    const emptyEntries = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(workspace.resolve("empty")),
    );
    t.deepEqual(
      emptyEntries.map(([name]) => name),
      [],
      `Build/Check wrote something for a directory with no .cssx entry: ${emptyEntries
        .map(([name]) => name)
        .join()}`,
    );
    t.equal(lone.document.isDirty, false, "the read-only commands modified the open buffer");

    // The folder-based commands are covered by the standalone workspace probe:
    // running them here would write artifacts into the committed fixture tree.
    const fixtureCssx = await vscode.workspace.findFiles("**/*.cssx", "**/node_modules/**", 5);
    t.ok(
      fixtureCssx.length > 0,
      "no .cssx files under the guest workspace folder; the folder-based probe reason is stale",
    );

    return "palette + trusted/no-editor/error/artifact-absent cells for 6 commands";
  } finally {
    await closeEditors();
    await workspace.dispose();
  }
}

module.exports = { run };
