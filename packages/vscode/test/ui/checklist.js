/**
 * The release smoke checklist, automated (CSSX plan U2).
 *
 * `.ai/HANDOVER.md` carries a 7-item manual checklist ("worth doing in the
 * editor once"). This module drives those seven rows end-to-end through the
 * public `vscode` API so a release does not depend on somebody remembering to
 * type `color: ` by hand. It repeats a few states `completions.js` and
 * `colors.js` already assert on purpose: the checklist is a contract of its
 * own, and a row that only cross-references another module is not a checklist.
 *
 * Dispositions (see `.ai/reports/CSSX-U2.md`):
 *   1 automated · 2 automated · 3 automated · 4 automated (snippet probe)
 *   5 automated (HANDOVER says `1r` → `rem`; measured `rad` + `rem`)
 *   6 automated + the pinned `CSSX-U1` defect kept visible
 *   7 automated except the native picker *click*, which no API can open
 */

const vscode = require("vscode");
const host = require("./host.js");

const KIND = vscode.CompletionItemKind;

function colorItems(items) {
  return items.filter((item) => item.kind === KIND.Color);
}

function detailCount(items, detail) {
  return items.filter((item) => item.detail === detail).length;
}

function hexDetailCount(items) {
  return items.filter((item) => /^CSS color #[0-9a-f]{6}$/.test(String(item.detail))).length;
}

/**
 * Row 1 — `color: ` offers 148 named + 35 hex colours as kind Color;
 * `width: ` offers neither.
 */
async function row1(t, workspace) {
  const { document } = await workspace.open("checklist-values.cssx", ".a {\n  color: \n}\n");
  const position = host.positionOf(document, "color: ", "color: ".length);
  const items = await host.completionItems(document, position);
  const colors = colorItems(items);
  t.equal(colors.length, 183, `expected 183 colour items after \`color: \`, got ${colors.length}`);
  t.equal(detailCount(items, "CSS color"), 148, "148 named colours carry the `CSS color` detail");
  t.equal(hexDetailCount(items), 35, "35 hex palette entries carry a `CSS color #rrggbb` detail");
  t.equal(items.length, 236, `expected 236 value items after \`color: \`, got ${items.length}`);
  t.ok(
    colors.every((item) => item.kind === KIND.Color),
    "every colour suggestion maps to CompletionItemKind.Color",
  );
  const named = host.byLabel(colors).get("red");
  t.ok(named, "the named colour `red` is offered");
  const hex = host.byLabel(colors).get("#2563eb");
  t.ok(hex, "the curated hex colour `#2563eb` is offered");

  const plain = await workspace.open("checklist-width.cssx", ".b {\n  width: \n}\n");
  const widthPosition = host.positionOf(plain.document, "width: ", "width: ".length);
  const widthItems = await host.completionItems(plain.document, widthPosition);
  t.equal(
    widthItems.length,
    53,
    `expected 53 plain values after \`width: \`, got ${widthItems.length}`,
  );
  t.equal(colorItems(widthItems).length, 0, "`width: ` offers no kind-Color items");
  t.equal(
    widthItems.filter((item) => host.labelOf(item).startsWith("#")).length,
    0,
    "`width: ` offers no hex labels",
  );
}

/**
 * Row 2 — `color: #f0` narrows; accepting replaces the typed `#…` without
 * duplication; `width: #` offers nothing.
 */
async function row2(t, workspace) {
  const { document, editor } = await workspace.open(
    "checklist-hash.cssx",
    ".a {\n  color: #f0\n}\n",
  );
  const position = host.positionOf(document, "#f0", "#f0".length);
  const items = await host.completionItems(document, position, "#");
  t.ok(items.length > 0, "`color: #f0` produced no suggestions");
  t.ok(
    items.every((item) => item.kind === KIND.Color),
    "every narrowed `#` item maps to Color",
  );
  t.ok(
    items.every((item) => String(item.filterText).startsWith("#f0")),
    "every narrowed item filters on the typed `#f0` prefix",
  );
  t.equal(items.length, 5, `expected the 5 palette entries matching #f0, got ${items.length}`);
  t.ok(
    items.every((item) => {
      const label = host.labelOf(item);
      // Named entries label with their name (`aliceblue`, hex `#f0f8ff`) and
      // filter on their hex, so only literal hex labels must continue `#f0`.
      return !label.startsWith("#") || label.startsWith("#f0");
    }),
    "every literal hex label continues the typed `#f0` prefix",
  );
  t.ok(
    items.every((item) => {
      const label = host.labelOf(item);
      return label.startsWith("#") || item.detail === "CSS color";
    }),
    "the narrowed named entries are the named-colour family",
  );
  t.equal(
    detailCount(items, "CSS color"),
    5,
    "measured: all 5 entries matching `#f0` are named colours whose hex starts `f0`",
  );
  const first = items[0];
  t.equal(
    host.rangeOf(first).start.character,
    position.character - 3,
    "the item range starts on the typed `#`, so accepting replaces `#f0`",
  );
  const applied = await host.applyCompletion(editor, first);
  t.equal(applied.split("#").length - 1, 0, "accepting replaces the whole typed `#f0`");
  t.match(applied, /\n {2}color: [a-z]+\n/, "accepting writes exactly one colour value");
  t.equal(applied.includes("#f0"), false, "accepting never leaves the typed `#f0` behind");
  t.equal(applied.includes("#"), false, "accepting never duplicates the `#`");

  const width = await workspace.open("checklist-width-hash.cssx", ".b {\n  width: #\n}\n");
  const widthPosition = host.positionOf(width.document, "width: #", "width: #".length);
  const widthItems = await host.completionItems(width.document, widthPosition, "#");
  // `width: #` must contribute nothing. The list is not empty in the host:
  // when the provider returns no items VS Code fills the result with its own
  // word-based suggestions (kind Text, no `detail`), which are not Xessa
  // contributions — so the assertion is on the contributions, not the length.
  t.deepEqual(
    widthItems
      .map((item) => [host.labelOf(item), item.kind, item.detail])
      .filter((entry) => entry[2] !== undefined && entry[2] !== null),
    [],
    `expected no Xessa suggestions for \`width: #\`, got ${JSON.stringify(
      widthItems.map((item) => [host.labelOf(item), item.detail]).slice(0, 12),
    )}`,
  );
  t.equal(colorItems(widthItems).length, 0, "`width: #` offers no kind-Color items");
  t.equal(
    widthItems.filter((item) => host.labelOf(item).startsWith("#")).length,
    0,
    "`width: #` offers no hex labels",
  );
}

/**
 * Row 3 — `width: (` lists the 25 curated functions; accepting `clamp(`
 * rewrites the typed `(`; a partially typed `calc(` argument keeps the
 * ordinary value list.
 */
async function row3(t, workspace) {
  const { document, editor } = await workspace.open(
    "checklist-paren.cssx",
    ".a {\n  width: (\n}\n",
  );
  const position = host.positionOf(document, "width: (", "width: (".length);
  const items = await host.completionItems(document, position, "(");
  t.equal(items.length, 25, `expected the 25 curated functions, got ${items.length}`);
  t.ok(
    items.every((item) => item.kind === KIND.Value && item.detail === "CSS function"),
    "every `(` item is a Value-kind CSS function",
  );
  t.ok(
    items.every((item) => host.labelOf(item).endsWith("(")),
    "every function label ends with its call opener",
  );
  t.ok(
    items.every((item) => item.filterText === `(${host.labelOf(item).slice(0, -1)}`),
    "every function item filters on `(` + name",
  );
  const clamp = host.byLabel(items).get("clamp(");
  t.ok(clamp, "`clamp(` is offered");
  t.equal(
    host.rangeOf(clamp).start.character,
    position.character - 1,
    "the function range starts on the typed `(`",
  );
  const applied = await host.applyCompletion(editor, clamp);
  t.equal(applied.split("(").length - 1, 1, "accepting clamp( leaves exactly one `(`");
  t.match(applied, /\n {2}width: clamp\(\n/, "accepting clamp( yields `width: clamp(`");

  const calc = await workspace.open("checklist-calc.cssx", ".b {\n  width: calc(100% - 2\n}\n");
  const calcPosition = host.positionOf(calc.document, "calc(100% - 2", "calc(100% - 2".length);
  const calcItems = await host.completionItems(calc.document, calcPosition);
  t.ok(calcItems.length > 0, "the partially typed calc() argument produced no suggestions");
  t.equal(
    calcItems.filter((item) => item.detail === "CSS function").length,
    0,
    "inside a started calc() the list is not the function-only state",
  );
  t.equal(
    calcItems.filter((item) => item.detail === "CSS unit").length,
    27,
    "the typed `2` inside calc() still offers the 27 units (ordinary value list)",
  );
  t.ok(
    calcItems.every((item) => host.rangeOf(item)?.start.character === calcPosition.character),
    "calc() argument items append at the caret instead of replacing the call",
  );
}

/**
 * Row 4 — accepting a property rewrites the prefix and parks the caret before
 * the semicolon; the setting toggles the snippet form.
 *
 * The acceptance itself is reproduced with `editor.action.insertSnippet` over
 * the item's own range, which runs the *real* snippet machinery inside the
 * editor, so the resulting cursor position is observed, not inferred. There is
 * no API that accepts an item out of a suggest widget: `executeCompletionItemProvider`
 * returns the item, and no `vscode` command feeds it back — recorded as an API
 * limit, not a manual row.
 */
async function row4(t, workspace) {
  const settings = vscode.workspace.getConfiguration("xessa");
  const { document, editor } = await workspace.open("checklist-property.cssx", ".a {\n  colo\n}\n");
  const position = host.positionOf(document, "colo", "colo".length);
  const items = await host.completionItems(document, position);
  const color = host.byLabel(items).get("color");
  t.ok(color, "the property completion for `colo` is missing");
  t.equal(color.kind, KIND.Property, "property items map to CompletionItemKind.Property");
  t.ok(color.insertText instanceof vscode.SnippetString, "the default item inserts a snippet");
  t.equal(color.insertText.value, "color: $0;", "the snippet body parks the caret at `$0`");

  const range = host.rangeOf(color);
  // `TextEditor.insertSnippet` is the public, drivable half of accepting a
  // snippet item: it runs the real snippet machinery over the item's own
  // replacement range, so the resulting caret position is observed rather than
  // inferred. (`editor.action.insertSnippet` is a workbench command and is a
  // no-op in this API-driven host — recorded as an API limit.)
  const inserted = await editor.insertSnippet(
    new vscode.SnippetString(color.insertText.value),
    range,
  );
  t.equal(inserted, true, "the editor accepted the property snippet");
  const accepted = editor;
  t.equal(
    accepted.document.lineAt(0).text,
    ".a {",
    "the snippet replaced the typed property prefix only",
  );
  t.equal(
    accepted.document.lineAt(1).text,
    "  color: ;",
    `accepting the property must yield \`  color: ;\`, got ${JSON.stringify(
      accepted.document.lineAt(1).text,
    )}`,
  );
  const cursor = accepted.selection.active;
  t.equal(cursor.line, 1, "the caret stays on the property line");
  t.equal(
    accepted.document.lineAt(1).text[cursor.character],
    ";",
    `the caret sits before the semicolon, got column ${cursor.character}`,
  );
  t.equal(cursor.character, "  color: ".length, "the caret sits right after `color: `");

  await settings.update(
    "editor.completePropertyWithSemicolon",
    false,
    vscode.ConfigurationTarget.Global,
  );
  try {
    const off = await workspace.open("checklist-property-off.cssx", ".a {\n  colo\n}\n");
    const offPosition = host.positionOf(off.document, "colo", "colo".length);
    const offItems = await host.completionItems(off.document, offPosition);
    const offColor = host.byLabel(offItems).get("color");
    t.ok(offColor, "the property completion disappears when the setting is off");
    t.equal(
      offColor.insertText instanceof vscode.SnippetString,
      false,
      "with the setting off the item is plain text, not a snippet",
    );
    t.equal(
      host.insertTextOf(offColor),
      "color: ",
      "with the setting off only `color: ` is inserted",
    );
    const offRange = host.rangeOf(offColor);
    await off.editor.insertSnippet(new vscode.SnippetString("color: "), offRange);
    const offLine = off.document.lineAt(1).text;
    t.equal(
      offLine,
      "  color: ",
      `setting off must not add a semicolon, got ${JSON.stringify(offLine)}`,
    );
  } finally {
    await settings.update(
      "editor.completePropertyWithSemicolon",
      true,
      vscode.ConfigurationTarget.Global,
    );
  }
}

/**
 * Row 5 — `margin: 1` offers units, `1r` narrows to the r-units, and accepting
 * a unit never deletes a digit.
 *
 * HANDOVER says `1r` → `rem`; the measured list is `rad` + `rem` (prefix filter
 * over all 27 units). The measured pair is asserted and the discrepancy is
 * recorded in `.ai/reports/CSSX-U2.md`.
 */
async function row5(t, workspace) {
  const { document, editor } = await workspace.open(
    "checklist-units.cssx",
    ".a {\n  margin: 1\n}\n",
  );
  const position = host.positionOf(document, "margin: 1", "margin: 1".length);
  const items = await host.completionItems(document, position);
  t.equal(items.length, 27, `expected the 27 units after \`margin: 1\`, got ${items.length}`);
  t.ok(
    items.every((item) => item.detail === "CSS unit"),
    "every item after a typed number carries the `CSS unit` detail",
  );
  t.ok(
    items.every((item) => host.rangeOf(item).start.character === position.character),
    "every unit range starts after the authored digit, so no digit can be replaced",
  );
  const rem = host.byLabel(items).get("rem");
  t.ok(rem, "`rem` is offered after `margin: 1`");
  const applied = await host.applyCompletion(editor, rem);
  t.match(applied, /\n {2}margin: 1rem\n/, "accepting `rem` yields `margin: 1rem` (digit intact)");
  t.equal(applied.includes("remrem"), false, "accepting `rem` never doubles the unit");

  const prefix = await workspace.open("checklist-units-prefix.cssx", ".b {\n  margin: 1r\n}\n");
  const prefixPosition = host.positionOf(prefix.document, "margin: 1r", "margin: 1r".length);
  const prefixItems = await host.completionItems(prefix.document, prefixPosition);
  t.deepEqual(
    prefixItems.map(host.labelOf).sort(),
    ["rad", "rem"],
    "measured: `1r` narrows to `rad` + `rem` (HANDOVER says `rem` only)",
  );
  t.ok(
    prefixItems.every(
      (item) => host.rangeOf(item).start.character === prefixPosition.character - 1,
    ),
    "the narrowed unit range replaces only the typed `r`",
  );
  const appliedPrefix = await host.applyCompletion(
    prefix.editor,
    host.byLabel(prefixItems).get("rem"),
  );
  t.match(appliedPrefix, /\n {2}margin: 1rem\n/, "accepting `rem` over `1r` keeps the digit");
  t.equal(appliedPrefix.includes("1rrem"), false, "the typed `r` is replaced, not appended to");
}

/**
 * Row 6 — `&:` + accept yields `&:hover`, a lone `&` + accept keeps one
 * ampersand, `&.` keeps the dot and lists classes only, and property completion
 * still works on the line above an `&` rule.
 */
async function row6(t, workspace) {
  const setup = ['@setup { prefix: "ui"; }', ".card { color: red; }"].join("\n");

  const pseudo = await workspace.open("checklist-amp-colon.cssx", `${setup}\n.badge {\n  &:\n}\n`);
  const pseudoPosition = host.positionOf(pseudo.document, "&:", 2);
  const pseudoItems = await host.completionItems(pseudo.document, pseudoPosition, ":");
  t.equal(
    pseudoItems.length,
    33,
    `expected the 19 standard + 14 vendor pseudo entries, got ${pseudoItems.length}`,
  );
  const hover = host.byLabel(pseudoItems).get(":hover");
  t.ok(hover, "`:hover` is offered after `&:`");
  t.equal(
    host.rangeOf(hover).start.character,
    pseudoPosition.character - 1,
    "the pseudo range covers the typed colon",
  );
  const appliedPseudo = await host.applyCompletion(pseudo.editor, hover);
  t.match(appliedPseudo, /\n {2}&:hover\n/, "accepting `:hover` after `&:` yields `&:hover`");
  t.equal(appliedPseudo.includes("&::hover"), false, "the colon is never doubled");

  const dot = await workspace.open("checklist-amp-dot.cssx", `${setup}\n.badge {\n  &.\n}\n`);
  const dotPosition = host.positionOf(dot.document, "&.", 2);
  const dotItems = await host.completionItems(dot.document, dotPosition, ".");
  const card = host.byLabel(dotItems).get(".card");
  t.ok(
    card,
    `no .card class item after \`&.\` (got ${JSON.stringify(dotItems.map(host.labelOf))})`,
  );
  t.equal(
    host.rangeOf(card).start.character,
    dotPosition.character,
    "the class range starts after the typed dot",
  );
  const appliedDot = await host.applyCompletion(dot.editor, card);
  t.match(appliedDot, /\n {2}&\.card\n/, "accepting the class keeps the typed dot");
  t.deepEqual(
    dotItems.map(host.labelOf).filter((label) => label.startsWith("&")),
    [],
    `a &. context offers no nested-selector starter (got ${JSON.stringify(dotItems.map(host.labelOf))})`,
  );

  // Property completion on a line whose next line starts with `&` (A46).
  const above = await workspace.open(
    "checklist-property-above.cssx",
    `${setup}\n.badge {\n  colo\n  &:hover { color: red; }\n}\n`,
  );
  // The needle includes the line break so it cannot match the `color` of the
  // rule above (the first `colo` occurrence in the document).
  const abovePosition = host.positionOf(above.document, "\n  colo", "\n  colo".length);
  const aboveItems = await host.completionItems(above.document, abovePosition);
  const aboveColor = host.byLabel(aboveItems).get("color");
  t.ok(aboveColor, `no property completion above an \`&\` line (got ${aboveItems.length} items)`);
  t.equal(aboveColor.kind, KIND.Property, "the item above `&` is a Property");
  const appliedAbove = await host.applyCompletion(above.editor, aboveColor);
  t.match(
    appliedAbove,
    /\n {2}color: ;\n {2}&:hover \{ color: red; \}\n/,
    "accepting the property edits the property line and leaves the `&` rule intact",
  );

  // A lone `&` starter replaces the typed ampersand, so accepting `&:hover`
  // yields exactly one `&:hover`.
  const bare = await workspace.open("checklist-amp-bare.cssx", `${setup}\n.badge {\n  &\n}\n`);
  const barePosition = host.positionOf(bare.document, "  &\n", 3);
  const bareItems = await host.completionItems(bare.document, barePosition, "&");
  const bareHover = host.byLabel(bareItems).get("&:hover");
  t.ok(bareHover, "the nested-selector starters are offered after a lone `&`");
  t.deepEqual(
    {
      start: host.rangeOf(bareHover).start.character,
      end: host.rangeOf(bareHover).end.character,
    },
    { start: barePosition.character - 1, end: barePosition.character },
    "`&` starters replace the typed ampersand",
  );
  const appliedBare = await host.applyCompletion(bare.editor, bareHover);
  t.match(appliedBare, /\n {2}&:hover\n/, "accepting `&:hover` after a lone `&` keeps one `&`");
  t.equal(appliedBare.includes("&&"), false, "the ampersand is never doubled");
}

/**
 * Row 7 — named/hex values render swatches, and the picker's write path writes
 * lowercase hex over exactly the authored range.
 *
 * The swatch *click* is the one manual residue: no `vscode` API opens the
 * native colour picker, so the interaction stays a human step (recorded in the
 * report). Everything the picker would then do is drivable.
 */
async function row7(t) {
  const { document } = await host.openFixture("ui/colors.cssx");
  const colors = await host.documentColors(document);
  t.equal(colors.length, 6, `expected the 6 A51 swatches, got ${colors.length}`);

  const swatchOf = (needle, delta, length) => {
    const start = document.positionAt(host.offsetOf(document, needle, delta));
    const end = document.positionAt(host.offsetOf(document, needle, delta) + length);
    const found = colors.find(
      (candidate) =>
        candidate.range.start.line === start.line &&
        candidate.range.start.character === start.character &&
        candidate.range.end.line === end.line &&
        candidate.range.end.character === end.character,
    );
    t.ok(found, `no swatch covering ${JSON.stringify(needle.slice(delta, delta + length))}`);
    return found;
  };

  const red = swatchOf("color: Red", "color: ".length, 3);
  t.equal(red.color.red, 1, "the named colour `Red` swatches as red");
  const hex = swatchOf("background: #fff", "background: ".length, 4);
  t.equal(Math.round(hex.color.blue * 255), 255, "`#fff` swatches as white");
  const alpha = swatchOf("outline-color: #2563eb80", "outline-color: ".length, 9);
  t.ok(Math.abs(alpha.color.alpha - 0.502) < 0.002, "`#2563eb80` carries its 50 % alpha");

  const redRange = new vscode.Range(red.range.start, red.range.end);
  const redPresentations = await host.colorPresentations(document, red.color, redRange);
  t.equal(redPresentations.length, 1, "one presentation per swatch");
  t.equal(redPresentations[0].label, "#ff0000", "a named colour presents as lowercase hex");
  t.equal(
    redPresentations[0].label,
    redPresentations[0].label.toLowerCase(),
    "the presentation label is lowercase",
  );
  t.deepEqual(
    {
      start: redPresentations[0].textEdit.range.start.character,
      end: redPresentations[0].textEdit.range.end.character,
    },
    { start: redRange.start.character, end: redRange.end.character },
    "the picker write replaces exactly the authored range",
  );
  t.equal(redPresentations[0].textEdit.newText, "#ff0000", "the write path text is lowercase hex");

  const alphaPresentations = await host.colorPresentations(
    document,
    alpha.color,
    new vscode.Range(alpha.range.start, alpha.range.end),
  );
  t.equal(alphaPresentations[0].label, "#2563eb80", "alpha survives the write path as `#rrggbbaa`");
}

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-checklist-");
  const rows = [];
  try {
    await workspace.write("theme.cssx", "@variables {\n  primary: #2563eb;\n}\n");
    const checklist = [
      [1, "`color: ` 148 names + 35 hex (Color), `width: ` neither", row1],
      [2, "`color: #f0` narrows and replaces `#…`, `width: #` empty", row2],
      [3, "`width: (` 25 functions, `clamp(` accept, `calc(` keeps values", row3],
      [4, "property accept parks the caret before `;` (setting toggle)", row4],
      [5, "`margin: 1` units, `1r` narrows, digits never deleted", row5],
      [6, "`&:` accept, `&.` keeps the dot, property above `&` (+ pin)", row6],
      [7, "named/hex swatches and the lowercase-hex picker write", row7],
    ];
    for (const [number, label, scenario] of checklist) {
      const before = t.count;
      await scenario(t, workspace);
      t.ok(t.count > before, `checklist row ${number} made no assertions (${label})`);
      rows.push(`${number}:${t.count - before}`);
      console.log(`[xessa host]   checklist ${number}: ${label} — ${t.count - before} assertions`);
    }
    t.equal(rows.length, 7, "all 7 HANDOVER checklist rows were driven");
    return `7/7 HANDOVER rows automated (${rows.join(", ")})`;
  } finally {
    await vscode.workspace
      .getConfiguration("xessa")
      .update("editor.completePropertyWithSemicolon", true, vscode.ConfigurationTarget.Global);
    await workspace.dispose();
  }
}

module.exports = { run };
