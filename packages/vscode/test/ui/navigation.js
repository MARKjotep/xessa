/**
 * Navigation scenarios — definition, references and rename for `$tokens`,
 * namespace members and cross-module groups, all through the public commands.
 *
 * The fixture set is copied into a temp workspace first so the rename cases can
 * apply real `WorkspaceEdit`s without ever dirtying a committed fixture.
 */

const vscode = require("vscode");
const host = require("./host.js");

function lastPositionOf(document, needle, delta) {
  const index = document.getText().lastIndexOf(needle);
  if (index < 0) throw new Error(`document does not contain ${JSON.stringify(needle)}`);
  return document.positionAt(index + delta);
}

function editEntries(edit) {
  return edit.entries().map(([uri, edits]) => ({ uri, edits }));
}

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-navigation-");
  try {
    await workspace.write(
      "navigation-theme.cssx",
      await host.readFixture("ui/navigation-theme.cssx"),
    );
    await workspace.write(
      "navigation-groups.cssx",
      await host.readFixture("ui/navigation-groups.cssx"),
    );
    const entryText = await host.readFixture("ui/navigation-entry.cssx");
    const { document } = await workspace.open("navigation-entry.cssx", entryText);

    // Definition: a local token resolves to its declaration.
    const accentUse = host.positionOf(document, "$accent;", 2);
    const definitions = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      document.uri,
      accentUse,
    );
    t.equal(definitions.length, 1, `expected one definition, got ${definitions.length}`);
    t.ok(definitions[0].uri.fsPath.endsWith("navigation-entry.cssx"), "definition is in this file");
    t.deepEqual(
      {
        line: definitions[0].range.start.line,
        start: definitions[0].range.start.character,
        end: definitions[0].range.end.character,
      },
      { line: 6, start: 2, end: 8 },
      "definition points at the `accent` declaration",
    );

    // Definition: an imported member resolves into the other module.
    const member = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      document.uri,
      host.positionOf(document, "$theme.primary", 8),
    );
    t.equal(member.length, 1, "imported member definition missing");
    t.ok(member[0].uri.fsPath.endsWith("navigation-theme.cssx"), "member resolves across modules");

    // References: declaration + two uses, and the declaration-less variant.
    const references = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      document.uri,
      accentUse,
      { includeDeclaration: true },
    );
    t.equal(references.length, 3, `expected 3 references, got ${references.length}`);
    t.deepEqual(
      references.map((reference) => reference.range.start.line).sort((a, b) => a - b),
      [6, 10, 18],
      "references cover the declaration and both uses",
    );
    // API limit, recorded: `vscode.executeReferenceProvider` takes only
    // (uri, position) — the declaration is always included — so the
    // declaration-less variant is not drivable from the host.
    const withContext = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      document.uri,
      accentUse,
      { includeDeclaration: false },
    );
    t.equal(
      withContext.length,
      3,
      "the reference command ignores a ReferenceContext and keeps the declaration",
    );

    // prepareRename probes the same range the editor shows as the rename target.
    const prepared = await vscode.commands.executeCommand(
      "vscode.prepareRename",
      document.uri,
      accentUse,
    );
    t.deepEqual(
      {
        placeholder: prepared.placeholder,
        line: prepared.range.start.line,
        start: prepared.range.start.character,
        end: prepared.range.end.character,
      },
      // PINNED BEHAVIOUR (CSSX-U1): the public command reports the caret's
      // reference range with the sigil included (`$accent`) rather than the
      // declaration range the provider returns, so the rename box is prefilled
      // with `$accent`. Recorded as a UX observation, not asserted as intent.
      { placeholder: "$accent", line: 10, start: 9, end: 16 },
      "pinned: prepareRename prefills the caret token including the sigil (CSSX-U1)",
    );

    // Refusal paths (both surface as a thrown provider error).
    await t.rejects(
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        document.uri,
        accentUse,
        "1bad",
      ),
      /Token names must start with a letter or underscore/,
      "an invalid token name is refused",
    );
    await t.rejects(
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        document.uri,
        host.positionOf(document, "$theme.primary", 8),
        "core",
      ),
      /Cross-module rename is not supported yet/,
      "a cross-module member rename is refused",
    );

    // A valid rename applies to every reference in the file.
    const renameEdit = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      document.uri,
      accentUse,
      "accent2",
    );
    const renameFiles = editEntries(renameEdit);
    t.equal(renameFiles.length, 1, "a local token rename touches one file");
    t.equal(renameFiles[0].edits.length, 3, "the rename edits the declaration and both uses");
    t.equal(await vscode.workspace.applyEdit(renameEdit), true, "the rename edit was rejected");
    t.match(document.getText(), /accent2: #2563eb;/, "the declaration was renamed");
    t.equal(
      document.getText().split("$accent2").length - 1,
      2,
      "both token references were renamed",
    );

    // Cross-module group rename: edits in two files, applied as one edit.
    const groups = await workspace.open(
      "navigation-groups.cssx",
      await host.readFixture("ui/navigation-groups.cssx"),
    );
    const groupRename = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      document.uri,
      lastPositionOf(document, "@group.card-base", 8),
      "card-common",
    );
    const groupFiles = editEntries(groupRename);
    t.equal(groupFiles.length, 2, `the group rename touched ${groupFiles.length} file(s)`);
    t.equal(
      groupFiles.reduce((total, file) => total + file.edits.length, 0),
      3,
      "the group rename covers the definition and both use sites",
    );
    t.equal(await vscode.workspace.applyEdit(groupRename), true, "the group rename was rejected");
    t.equal(
      document.getText().split("@group.card-common").length - 1,
      2,
      "both use sites were renamed",
    );
    t.match(groups.document.getText(), /@group\.card-common \{/, "the definition was renamed");

    // Renaming a token onto an existing name is refused before any edit
    // (CSSX-U04): the name `gap` is already declared, so no WorkspaceEdit is
    // returned and the document is left byte-identical.
    const beforeConflict = document.getText();
    await t.rejects(
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        document.uri,
        host.positionOf(document, "accent2: #2563eb", 3),
        "gap",
      ),
      /A token named "\$gap" already exists in scope/,
      "a rename onto an existing token name is refused (CSSX-U04)",
    );
    t.equal(
      document.getText(),
      beforeConflict,
      "the refused conflicting rename changed the document (CSSX-U04)",
    );
    t.equal(
      document.getText().split("gap:").length - 1,
      1,
      "the refused rename left one `gap` declaration (CSSX-U04)",
    );

    // Class rename is single-file: every non-global occurrence changes, the dot
    // survives, and the `:global(...)` occurrence and the longer `.card-link`
    // name stay byte-identical. prepareRename reports the name, not the dot.
    const classText = [
      '@setup { prefix: "ui"; }',
      ".card { color: red; }",
      ".badge {",
      "  &:hover { color: blue; }",
      "  .card { color: green; }",
      "  &:global(.card) { color: black; }",
      "}",
      ".card-link { color: white; }",
    ].join("\n");
    const classes = await workspace.open("navigation-classes.cssx", classText);
    const cardName = host.positionOf(classes.document, ".card {", 2);
    const preparedClass = await vscode.commands.executeCommand(
      "vscode.prepareRename",
      classes.document.uri,
      cardName,
    );
    t.deepEqual(
      {
        placeholder: preparedClass.placeholder,
        line: preparedClass.range.start.line,
        start: preparedClass.range.start.character,
        end: preparedClass.range.end.character,
      },
      { placeholder: "card", line: 1, start: 1, end: 5 },
      "prepareRename reports the class name after the dot",
    );

    // Selecting the `:global(...)` occurrence is refused with the class reason.
    await t.rejects(
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        classes.document.uri,
        host.positionOf(classes.document, ":global(.card)", ":global(.".length),
        "panel",
      ),
      /Global classes/,
      "renaming a :global(...) class is refused",
    );

    const classRename = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      classes.document.uri,
      cardName,
      "panel",
    );
    const classFiles = editEntries(classRename);
    t.equal(classFiles.length, 1, "a class rename touches the current file only");
    t.equal(classFiles[0].edits.length, 2, "both non-global .card occurrences are edited");
    t.equal(await vscode.workspace.applyEdit(classRename), true, "the class rename was rejected");
    t.equal(
      classes.document.getText(),
      [
        '@setup { prefix: "ui"; }',
        ".panel { color: red; }",
        ".badge {",
        "  &:hover { color: blue; }",
        "  .panel { color: green; }",
        "  &:global(.card) { color: black; }",
        "}",
        ".card-link { color: white; }",
      ].join("\n"),
      "the class rename changed exactly the non-global name bytes",
    );

    // Id rename is single-file too: every occurrence changes, the `#` survives,
    // `:global(#panel)` is included (ids have no local/global split), and the
    // same-named class and the id inside an attribute value stay untouched.
    const idText = [
      '@setup { prefix: "ui"; }',
      "#panel { color: red; }",
      "#panel .card { color: blue; }",
      ".card #panel:not(#panel-header) { color: green; }",
      ":global(#panel) .x { color: black; }",
      ".panel { color: white; }",
      '[data-id="#panel"] { color: grey; }',
    ].join("\n");
    const ids = await workspace.open("navigation-ids.cssx", idText);
    const panelName = host.positionOf(ids.document, "#panel {", 2);
    const preparedId = await vscode.commands.executeCommand(
      "vscode.prepareRename",
      ids.document.uri,
      panelName,
    );
    t.deepEqual(
      {
        placeholder: preparedId.placeholder,
        line: preparedId.range.start.line,
        start: preparedId.range.start.character,
        end: preparedId.range.end.character,
      },
      { placeholder: "panel", line: 1, start: 1, end: 6 },
      "prepareRename reports the id name after the hash",
    );

    // An id that already exists in the file is refused before any edit.
    const beforeIdConflict = ids.document.getText();
    await t.rejects(
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        ids.document.uri,
        panelName,
        "panel-header",
      ),
      /An id named "#panel-header" already exists/,
      "a rename onto an existing id name is refused",
    );
    t.equal(ids.document.getText(), beforeIdConflict, "the refused id rename changed the document");

    const idRename = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      ids.document.uri,
      panelName,
      "main",
    );
    const idFiles = editEntries(idRename);
    t.equal(idFiles.length, 1, "an id rename touches the current file only");
    t.equal(
      idFiles[0].edits.length,
      4,
      "all four #panel occurrences, including :global(#panel), are edited",
    );
    t.equal(await vscode.workspace.applyEdit(idRename), true, "the id rename was rejected");
    t.equal(
      ids.document.getText(),
      [
        '@setup { prefix: "ui"; }',
        "#main { color: red; }",
        "#main .card { color: blue; }",
        ".card #main:not(#panel-header) { color: green; }",
        ":global(#main) .x { color: black; }",
        ".panel { color: white; }",
        '[data-id="#panel"] { color: grey; }',
      ].join("\n"),
      "the id rename changed exactly the name bytes and kept every hash",
    );

    // Reverse references (board bug 27): from the exporting definition the
    // provider returns the definition plus every use that resolves to it in
    // direct importers; the same set comes back from either importer. Local
    // shadows and ambiguous unqualified imports (XESSA2001) are excluded.
    const reverseTokens = await workspace.open(
      "reverse-tokens.cssx",
      ["@variables {", "  brand: #2563eb;", "}", "@runtime {", "  surface: #ffffff;", "}"].join(
        "\n",
      ),
    );
    const reverseAlias = await workspace.open(
      "reverse-alias.cssx",
      [
        '@use "./reverse-tokens.cssx" as t;',
        ".alias {",
        "  color: $t.brand;",
        "  background: $t.surface;",
        "}",
      ].join("\n"),
    );
    const reversePlain = await workspace.open(
      "reverse-plain.cssx",
      [
        '@use "./reverse-tokens.cssx";',
        ".plain {",
        "  color: $brand;",
        "  background: $surface;",
        "}",
      ].join("\n"),
    );
    const reverseShadow = await workspace.open(
      "reverse-shadow.cssx",
      [
        '@use "./reverse-tokens.cssx";',
        "@variables {",
        "  brand: #111111;",
        "}",
        ".shadow {",
        "  color: $brand;",
        "}",
      ].join("\n"),
    );
    await workspace.write("reverse-other.cssx", "@variables { brand: #222222; }");
    const reverseAmbiguous = await workspace.open(
      "reverse-ambiguous.cssx",
      [
        '@use "./reverse-tokens.cssx";',
        '@use "./reverse-other.cssx";',
        ".clash {",
        "  color: $brand;",
        "}",
      ].join("\n"),
    );

    function reverseShape(document, needle, length) {
      const offset = host.offsetOf(document, needle);
      const start = document.positionAt(offset);
      const end = document.positionAt(offset + length);
      return {
        file: document.uri.fsPath,
        line: start.line,
        start: start.character,
        end: end.character,
      };
    }

    function reverseShapes(references) {
      return references
        .map((reference) => ({
          file: reference.uri.fsPath,
          line: reference.range.start.line,
          start: reference.range.start.character,
          end: reference.range.end.character,
        }))
        .sort(
          (left, right) =>
            left.file.localeCompare(right.file) ||
            left.line - right.line ||
            left.start - right.start,
        );
    }

    const expectedBrand = [
      reverseShape(reverseTokens.document, "brand:", "brand".length),
      reverseShape(reverseAlias.document, "$t.brand", "$t.brand".length),
      reverseShape(reversePlain.document, "$brand", "$brand".length),
    ].sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line || left.start - right.start,
    );

    const inverse = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      reverseTokens.document.uri,
      host.positionOf(reverseTokens.document, "brand:", 2),
      { includeDeclaration: true },
    );
    t.deepEqual(
      reverseShapes(inverse),
      expectedBrand,
      "the definition returns itself plus both importer references (exact URIs/ranges)",
    );
    t.equal(
      inverse.some(
        (reference) =>
          reference.uri.fsPath === reverseShadow.document.uri.fsPath ||
          reference.uri.fsPath === reverseAmbiguous.document.uri.fsPath,
      ),
      false,
      "shadowing and ambiguous unqualified uses are excluded",
    );

    const fromAlias = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      reverseAlias.document.uri,
      host.positionOf(reverseAlias.document, "$t.brand", 1),
      { includeDeclaration: true },
    );
    t.deepEqual(
      reverseShapes(fromAlias),
      expectedBrand,
      "a namespaced importer returns the same bidirectional set",
    );

    const fromPlain = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      reversePlain.document.uri,
      host.positionOf(reversePlain.document, "$brand", 1),
      { includeDeclaration: true },
    );
    t.deepEqual(
      reverseShapes(fromPlain),
      expectedBrand,
      "an unqualified importer returns the same bidirectional set",
    );

    const expectedSurface = [
      reverseShape(reverseTokens.document, "surface:", "surface".length),
      reverseShape(reverseAlias.document, "$t.surface", "$t.surface".length),
      reverseShape(reversePlain.document, "$surface", "$surface".length),
    ].sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line || left.start - right.start,
    );
    const fromRuntimeDefinition = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      reverseTokens.document.uri,
      host.positionOf(reverseTokens.document, "surface:", 2),
      { includeDeclaration: true },
    );
    t.deepEqual(
      reverseShapes(fromRuntimeDefinition),
      expectedSurface,
      "an @runtime token resolves across both direct importers too",
    );

    return "definition/references/rename incl. cross-module group, single-file class/id rename, bidirectional reverse references and 5 refusal paths";
  } finally {
    await workspace.dispose();
  }
}

module.exports = { run };
