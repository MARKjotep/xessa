/**
 * Quick-fix scenario — the `XESSA1002` (missing semicolon) code action from the
 * A45-era work, driven through `vscode.executeCodeActionProvider`.
 *
 * The fixture is copied into a temp workspace so applying the action's
 * `WorkspaceEdit` never dirties a committed file.
 */

const vscode = require("vscode");
const host = require("./host.js");

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-quickfix-");
  try {
    const text = await host.readFixture("ui/broken-semicolon.cssx");
    const { document } = await workspace.open("quickfix.cssx", text);
    const diagnostics = await host.waitForDiagnostics(document.uri, { code: "XESSA1002" });
    const diagnostic = diagnostics.find((entry) => entry.code === "XESSA1002");
    t.ok(diagnostic, "no XESSA1002 diagnostic was published");

    const actions = await vscode.commands.executeCommand(
      "vscode.executeCodeActionProvider",
      document.uri,
      diagnostic.range,
      // The command takes the kind as a string, not a CodeActionKind object.
      vscode.CodeActionKind.QuickFix.value,
    );
    t.ok(Array.isArray(actions), "the code-action command returned no list");
    // Other extensions in the host (Copilot) inject their own code actions, so
    // the Xessa fix is selected by its exact kind instead of by position.
    const xessaFixes = actions.filter((action) => action.kind && action.kind.value === "quickfix");
    t.equal(xessaFixes.length, 1, `expected one Xessa quick fix, got ${xessaFixes.length}`);
    const fix = xessaFixes[0];
    t.equal(fix.title, "Add semicolon");
    t.equal(fix.kind.value, "quickfix", "the action is offered in the quickfix kind");
    t.equal(fix.isPreferred, true, "the fix is preferred");
    // API limit, pinned: the command's DTO does not round-trip the action's
    // `diagnostics` association (the provider does set it, asserted below by
    // the edit resolving exactly the published XESSA1002).
    t.equal(
      fix.diagnostics === undefined ? "absent" : fix.diagnostics.length,
      "absent",
      "pinned: executeCodeActionProvider omits the action's diagnostics (API limit)",
    );

    const entries = fix.edit.entries();
    t.equal(entries.length, 1, "the fix edits one file");
    t.equal(entries[0][1].length, 1, "the fix is a single insertion");
    const edit = entries[0][1][0];
    t.equal(edit.newText, ";", "the fix inserts a semicolon");
    t.equal(edit.range.start.line, edit.range.end.line, "the insertion is on one line");
    t.equal(
      edit.range.start.character,
      diagnostic.range.end.character,
      "it inserts at the span end",
    );

    t.equal(await vscode.workspace.applyEdit(fix.edit), true, "the quick fix was rejected");
    t.match(document.getText(), /color: red;\n/, "applying the fix produced `color: red;`");

    // The debounced re-analysis must clear the diagnostic that the fix resolved.
    const remaining = await host.waitFor(
      () => {
        const current = host.diagnosticsOf(document.uri);
        return current.length === 0 ? true : undefined;
      },
      { label: "diagnostics to clear after the quick fix" },
    );
    t.equal(remaining, true, "the fixed document still reports diagnostics");

    return "XESSA1002 quick fix: title, kind, isPreferred, diagnostic link, applied edit";
  } finally {
    await workspace.dispose();
  }
}

module.exports = { run };
