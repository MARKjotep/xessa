/**
 * Suggest-widget scenarios — one case per trigger context of the plan's
 * 12-context table, driven through `vscode.executeCompletionItemProvider`.
 *
 * Assertions are on the returned item bodies (label, kind, detail,
 * documentation, filterText, replacement range, insert text) and on the text a
 * user gets after accepting the item, which is emulated by applying the item's
 * own range + insert text. No assertion reads the extension's source text.
 */

const vscode = require("vscode");
const host = require("./host.js");

const KIND = vscode.CompletionItemKind;

/**
 * Items whose filterText is set and disagrees with their label.
 *
 * VS Code drops `filterText` from the returned DTO when it equals the label
 * (the item is then filtered on its label, which is the same behaviour), so the
 * "default" contexts assert "no override", while the `(`/`#` contexts below
 * assert the exact override the A50/A51 repairs rely on.
 */
function filterMismatches(items) {
  return items
    .filter(
      (item) =>
        item.filterText !== undefined &&
        item.filterText !== null &&
        item.filterText !== host.labelOf(item),
    )
    .map((item) => ({ label: host.labelOf(item), filterText: item.filterText }));
}

function countKind(items, kind) {
  return items.filter((item) => item.kind === kind).length;
}

function labelsWithDetail(items, detail) {
  return items.filter((item) => item.detail === detail).map(host.labelOf);
}

async function run(t) {
  const workspace = await host.createWorkspace("xessa-ui-completions-");
  const settings = vscode.workspace.getConfiguration("xessa");
  let contexts = 0;
  try {
    await workspace.write("theme.cssx", "@variables {\n  primary: #2563eb;\n}\n");

    // 1. `@` — directives + aliases at the top level, replacing the typed `@`.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "directive.cssx",
        "@\n.card { color: red; }\n",
      );
      const items = await host.completionItems(document, document.positionAt(1), "@");
      const by = host.byLabel(items);
      t.ok(items.length > 0, "`@` produced no completions");
      t.equal(by.get("@setup").kind, KIND.Keyword, "directive item must map to Keyword");
      t.equal(by.get("@setup").detail, "Xessa directive");
      t.ok(by.get("@setup").documentation !== undefined, "directive items carry documentation");
      t.equal(by.get("@md").kind, KIND.EnumMember, "media alias item must map to EnumMember");
      t.match(by.get("@md").detail, /min-width: 768px/);
      t.deepEqual(filterMismatches(items), [], "every `@` item filters on its label");
      const range = host.rangeOf(by.get("@setup"));
      t.equal(range.start.character, 0, "`@` range starts on the typed sigil");
      t.equal(range.end.character, 1, "`@` range ends after the typed sigil");
      const applied = await host.applyCompletion(editor, by.get("@md"));
      t.ok(applied.startsWith("@md"), `accepting @md produced ${JSON.stringify(applied)}`);
      t.equal(applied.split("@").length - 1, 1, "accepting an alias replaces the typed sigil");
    }

    // 2. `$` — compile/runtime tokens, replacing the typed `$`.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "token.cssx",
        [
          "@variables {",
          "  brand: #2563eb;",
          "}",
          "@runtime {",
          "  theme: light;",
          "}",
          ".card { color: $",
          "}",
          "",
        ].join("\n"),
      );
      const position = host.positionOf(document, "color: $", "color: $".length);
      const items = await host.completionItems(document, position, "$");
      const by = host.byLabel(items);
      t.equal(by.get("$brand").kind, KIND.Variable, "compile token must map to Variable");
      t.equal(by.get("$theme").kind, KIND.Constant, "runtime token must map to Constant");
      t.equal(by.get("$theme").detail, "runtime token (custom property)");
      t.ok(by.has("$keyframes."), "the built-in keyframes namespace is offered");
      t.deepEqual(filterMismatches(items), [], "every `$` item filters on its label");
      const range = host.rangeOf(by.get("$brand"));
      t.equal(range.end.character, position.character, "`$` range ends at the caret");
      t.equal(range.start.character, position.character - 1, "`$` range covers the typed sigil");
      const applied = await host.applyCompletion(editor, by.get("$brand"));
      t.equal(applied.split("$").length - 1, 1, "accepting a token keeps exactly one sigil");
      t.match(applied, /color: \$brand\n/);
    }

    // 2b. `$` namespace — the imported alias keeps the sigil the range replaces.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "namespace.cssx",
        ['@use "./theme.cssx" as theme;', ".card { color: $", "}", ""].join("\n"),
      );
      const position = host.positionOf(document, "color: $", "color: $".length);
      const items = await host.completionItems(document, position, "$");
      const by = host.byLabel(items);
      const namespace = by.get("$theme.");
      t.ok(namespace, `no $theme. namespace in [${[...by.keys()].join(", ")}]`);
      t.ok(by.has("$keyframes."), "the built-in namespace sits beside the imported alias");
      t.equal(by.get("theme."), undefined, "the namespace is never offered without its `$`");
      const range = host.rangeOf(namespace);
      t.equal(
        range.start.character,
        position.character - 1,
        "namespace range covers the typed `$`",
      );
      t.equal(range.end.character, position.character, "namespace range ends at the caret");
      const applied = await host.applyCompletion(editor, namespace);
      t.match(applied, /color: \$theme\.\n/, "accepting the namespace keeps the `$`");
      t.equal(applied.split("$").length - 1, 1, "accepting the namespace never doubles the `$`");
    }

    // 3/6. `.` and `&` — selector contexts over generated classes.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "selector-dot.cssx",
        ['@setup { prefix: "ui"; }', ".card { color: red; }", ".badge {", "  &.", "}", ""].join(
          "\n",
        ),
      );
      const position = host.positionOf(document, "&.", 2);
      const items = await host.completionItems(document, position, ".");
      const by = host.byLabel(items);
      t.ok(by.has(".card"), `no .card class item in [${[...by.keys()].join(", ")}]`);
      t.equal(by.get(".card").kind, KIND.Class, "class items must map to Class");
      t.equal(by.get(".card").detail, "generated class .ui-card");
      t.deepEqual(filterMismatches(items), [], "every selector item filters on its label");
      const range = host.rangeOf(by.get(".card"));
      t.equal(range.start.character, position.character, "class range starts after the typed dot");
      t.equal(range.end.character, position.character, "the class range is empty at the caret");
      const applied = await host.applyCompletion(editor, by.get(".card"));
      t.match(applied, /\n {2}&\.card\n/, "accepting a class keeps the typed dot, un-duplicated");
      // CSSX-U03: a class context lists classes only. The `&` starters already
      // begin with `&`, so accepting one after the typed dot wrote `&.&:hover`.
      t.deepEqual(
        [...by.keys()].filter((label) => label.startsWith("&")),
        [],
        `a &. context offers no nested-selector starter (got [${[...by.keys()].join(", ")}])`,
      );
      t.ok(by.has(".badge"), "the class context still lists the document classes");
    }
    {
      // A lone `&` starter replaces the typed ampersand instead of appending to
      // it, so accepting `&:hover` yields `&:hover` and never `&&:hover`.
      contexts += 1;
      const { document, editor } = await workspace.open(
        "selector-ampersand.cssx",
        ['@setup { prefix: "ui"; }', ".card { color: red; }", ".badge {", "  &", "}", ""].join(
          "\n",
        ),
      );
      const position = host.positionOf(document, "  &\n", 3);
      const items = await host.completionItems(document, position, "&");
      const by = host.byLabel(items);
      t.ok(by.has("&:hover"), `no &:hover starter in [${[...by.keys()].join(", ")}]`);
      t.equal(by.get("&:hover").kind, KIND.Class, "nested-selector starters map to Class");
      for (const label of ["&", "&:hover", "&:focus-visible", "&:disabled", "& >", "& +"]) {
        const starter = by.get(label);
        t.ok(starter, `no ${label} starter in [${[...by.keys()].join(", ")}]`);
        const range = host.rangeOf(starter);
        t.deepEqual(
          { start: range.start.character, end: range.end.character },
          { start: position.character - 1, end: position.character },
          `${label} replaces the typed ampersand`,
        );
        t.ok(host.insertTextOf(starter).startsWith("&"), `${label} inserts its own ampersand`);
      }
      const applied = await host.applyCompletion(editor, by.get("&:hover"));
      t.match(applied, /\n {2}&:hover\n/, "accepting &:hover yields exactly one `&:hover`");
      t.equal(applied.includes("&&"), false, "accepting &:hover never doubles the ampersand");
    }

    // 4. `:` — pseudo selectors; the range covers the typed colons.
    {
      contexts += 1;
      const { document, editor } = await workspace.open("pseudo.cssx", ".card {\n  &:\n}\n");
      const position = host.positionOf(document, "&:", 2);
      const items = await host.completionItems(document, position, ":");
      t.equal(
        items.length,
        33,
        `expected the 19 standard + 14 vendor PSEUDOS entries, got ${items.length}`,
      );
      t.ok(
        items.every((item) => item.kind === KIND.Method),
        "pseudo items must all map to Method",
      );
      const vendor = items.filter((item) => (item.detail ?? "").startsWith("vendor-prefixed "));
      t.equal(vendor.length, 14, `expected 14 vendor pseudos, got ${vendor.length}`);
      t.ok(
        vendor.every((item) => (item.sortText ?? "").startsWith("z-")),
        "vendor pseudos sort after the colon-prefixed standard labels",
      );
      const lastStandard = items.findIndex((item) => host.labelOf(item) === "::selection");
      const firstVendor = items.findIndex((item) => host.labelOf(item) === ":-moz-any(");
      t.ok(
        lastStandard >= 0 && firstVendor > lastStandard,
        "vendor pseudos follow the standard set",
      );
      const hover = host.byLabel(items).get(":hover");
      t.equal(
        host.rangeOf(hover).start.character,
        position.character - 1,
        ": range covers the colon",
      );
      const applied = await host.applyCompletion(editor, hover);
      t.match(applied, /&:hover\n/, "accepting :hover yields exactly `&:hover`");
      t.equal(applied.includes("&::hover"), false, "accepting :hover never doubles the colon");
    }

    // 5. `/` — import paths from the real directory listing.
    {
      contexts += 1;
      const { document } = await workspace.open(
        "import.cssx",
        ['@use "./theme.cssx" as theme;', ".card { color: $theme.primary; }", ""].join("\n"),
      );
      const position = host.positionOf(document, '@use "./', '@use "./'.length);
      const items = await host.completionItems(document, position, "/");
      const by = host.byLabel(items);
      t.equal(by.get("./theme.cssx").kind, KIND.File, "import-path items must map to File");
      t.equal(by.get("./theme.cssx").detail, "Xessa module");
    }

    // 7. `(` — the 25 curated functions only, replacing the typed paren.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "call-opener.cssx",
        ".card {\n  width: (\n}\n",
      );
      const position = host.positionOf(document, "width: (", "width: (".length);
      const items = await host.completionItems(document, position, "(");
      t.equal(items.length, 25, `expected the 25 functions, got ${items.length}`);
      t.ok(
        items.every((item) => item.kind === KIND.Value && item.detail === "CSS function"),
        "every `(` item is a Value-kind CSS function",
      );
      t.ok(
        items.every((item) => host.labelOf(item).endsWith("(")),
        "every `(` item label ends with the call opener",
      );
      t.ok(
        items.every((item) => item.filterText === `(${host.labelOf(item).slice(0, -1)}`),
        "every `(` item filters on the paren + name",
      );
      const clamp = host.byLabel(items).get("clamp(");
      t.equal(
        host.rangeOf(clamp).start.character,
        position.character - 1,
        "`(` range covers the typed paren",
      );
      const applied = await host.applyCompletion(editor, clamp);
      t.equal(applied.split("(").length - 1, 1, "accepting clamp( keeps exactly one paren");
      t.match(applied, /width: clamp\(\n/);
    }

    // 8. `#` — the colour literal state; the range covers the typed `#…`.
    {
      contexts += 1;
      const { document, editor } = await workspace.open("hash.cssx", ".card {\n  color: #f0\n}\n");
      const position = host.positionOf(document, "#f0", 3);
      const items = await host.completionItems(document, position, "#");
      t.equal(items.length, 5, `expected the 5 matching palette entries, got ${items.length}`);
      t.ok(
        items.every((item) => item.kind === KIND.Color),
        "every `#` item must map to Color",
      );
      t.ok(
        items.every((item) => item.detail === "CSS color"),
        "the matched named colours carry the `CSS color` detail",
      );
      t.ok(
        items.every((item) => String(item.filterText).startsWith("#f0")),
        "every `#` item filters on the typed hex prefix",
      );
      const first = items[0];
      t.equal(
        host.rangeOf(first).start.character,
        position.character - 3,
        "`#` range covers `#f0`",
      );
      const applied = await host.applyCompletion(editor, first);
      t.equal(applied.split("#").length - 1, 0, "accepting a colour replaces the whole `#f0`");
      t.match(applied, /color: [a-z]+\n/, "accepting a named colour writes exactly one value");
    }
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "hash-empty.cssx",
        ".card {\n  color: #\n}\n",
      );
      const position = host.positionOf(document, "color: #", "color: #".length);
      const items = await host.completionItems(document, position, "#");
      t.equal(items.length, 183, `expected the 183 palette entries, got ${items.length}`);
      const named = items.filter((item) => item.detail === "CSS color");
      const hex = items.filter((item) => /^CSS color #[0-9a-f]{6}$/.test(String(item.detail)));
      t.equal(named.length, 148, "148 named colours in the `#` palette");
      t.equal(hex.length, 35, "35 hex colours in the `#` palette");
      t.ok(
        items.every((item) => item.kind === KIND.Color),
        "the whole `#` palette maps to Color",
      );
      const blue = host.byLabel(items).get("#2563eb");
      t.ok(blue, "the curated hex palette is addressable by label");
      t.equal(
        host.rangeOf(blue).start.character,
        position.character - 1,
        "hex range covers the `#`",
      );
      const applied = await host.applyCompletion(editor, blue);
      t.match(applied, /color: #2563eb\n/, "accepting a hex item writes exactly one hex value");
      t.equal(applied.split("#").length - 1, 1, "accepting a hex item never doubles the `#`");
    }

    // 8b. `#` — selector position lists the document ids (feature 26). The
    // value state below stays colour-only; ids never leak into it.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "selector-hash.cssx",
        [
          "#panel { color: red; }",
          "#panel-header { color: blue; }",
          "#sidebar { color: green; }",
          ".card {",
          "  #",
          "}",
          "",
        ].join("\n"),
      );
      const position = host.positionOf(document, "  #\n", 3);
      const items = await host.completionItems(document, position, "#");
      const by = host.byLabel(items);
      for (const id of ["#panel", "#panel-header", "#sidebar"]) {
        t.ok(by.has(id), `selector # must list ${id} (got [${[...by.keys()].join(", ")}])`);
        t.equal(by.get(id).kind, KIND.Class, `${id} maps to Class like a class item`);
        t.equal(by.get(id).detail, "id selector", `${id} carries the id-selector detail`);
      }
      t.equal(by.get(".card"), undefined, "a selector # offers no class items");
      t.equal(by.get("&:hover"), undefined, "a selector # offers no nested-selector starters");
      t.equal(
        items.some((item) => item.kind === KIND.Color),
        false,
        "a selector # offers no colours",
      );
      const panel = by.get("#panel");
      const range = host.rangeOf(panel);
      t.equal(range.start.character, position.character - 1, "id range starts on the typed #");
      t.equal(range.end.character, position.character, "id range ends at the caret");
      const applied = await host.applyCompletion(editor, panel);
      t.match(applied, /\n {2}#panel\n/, "accepting an id writes exactly one `#panel`");
      t.equal(applied.includes("##"), false, "accepting an id never doubles the `#`");
    }
    {
      contexts += 1;
      const { document } = await workspace.open("selector-hash-color.cssx", ".card { color: # }\n");
      const position = host.positionOf(document, "color: #", "color: #".length);
      const items = await host.completionItems(document, position, "#");
      t.ok(items.length > 0, "`color: #` still lists colours");
      t.equal(
        items.every((item) => item.kind === KIND.Color),
        true,
        "`color: #` lists colours only",
      );
      t.equal(
        items.some((item) => item.detail === "id selector"),
        false,
        "`color: #` offers no selector ids",
      );
    }

    // 9. value word with no trigger — colours, keywords and units.
    {
      contexts += 1;
      const { document } = await workspace.open("value-color.cssx", ".card {\n  color: \n}\n");
      const position = host.positionOf(document, "color: ", "color: ".length);
      const items = await host.completionItems(document, position);
      const colorItems = items.filter((item) => item.kind === KIND.Color);
      t.equal(colorItems.length, 183, `expected 183 colour items, got ${colorItems.length}`);
      t.equal(
        labelsWithDetail(items, "CSS color").length,
        148,
        "148 named colours carry the `CSS color` detail",
      );
      t.equal(
        items.filter((item) => /^CSS color #[0-9a-f]{6}$/.test(String(item.detail))).length,
        35,
        "35 hex colours carry their own `CSS color #rrggbb` detail",
      );
      t.equal(
        items.filter((item) => item.kind === KIND.Value).length,
        53,
        "the remaining 53 items are keywords + curated functions",
      );
      t.equal(items.length, 236, `expected 236 value items (A51), got ${items.length}`);
    }
    {
      contexts += 1;
      const { document } = await workspace.open("value-width.cssx", ".card {\n  width: \n}\n");
      const position = host.positionOf(document, "width: ", "width: ".length);
      const items = await host.completionItems(document, position);
      t.equal(items.length, 53, `expected 53 plain value items, got ${items.length}`);
      t.equal(
        items.filter((item) => item.kind === KIND.Color).length,
        0,
        "`width: ` offers no colour items",
      );
      t.equal(
        items.filter((item) => host.labelOf(item).startsWith("#")).length,
        0,
        "`width: ` offers no hex labels",
      );
    }
    {
      contexts += 1;
      const { document, editor } = await workspace.open("unit.cssx", ".card {\n  margin: 1\n}\n");
      const position = host.positionOf(document, "margin: 1", "margin: 1".length);
      const items = await host.completionItems(document, position);
      t.equal(items.length, 27, `expected the 27 units, got ${items.length}`);
      t.ok(
        items.every((item) => item.detail === "CSS unit"),
        "every unit item carries the `CSS unit` detail",
      );
      // The digit is a registered trigger (board bug 28), so the same request
      // with a digit trigger must return the unit list too.
      const triggered = await host.completionItems(document, position, "1");
      t.equal(triggered.length, 27, `a digit trigger expected 27 units, got ${triggered.length}`);
      t.deepEqual(
        triggered.map(host.labelOf),
        items.map(host.labelOf),
        "the digit trigger returns the same unit labels",
      );
      t.ok(
        items.every((item) => item.command === undefined),
        "unit items never carry the property retrigger command",
      );
      const rem = host.byLabel(items).get("rem");
      t.equal(
        host.rangeOf(rem).start.character,
        position.character,
        "unit range starts after the authored digits",
      );
      const applied = await host.applyCompletion(editor, rem);
      t.match(applied, /margin: 1rem\n/, "accepting rem appends to the digits");
    }
    {
      // Pinned behaviour, not a plan claim: `1r` narrows to both `rem` and
      // `rad` (the plan's U2 row 5 says `rem` only). The prefix filter is
      // correct; the plan sentence is over-precise. CSSX-U1 note.
      contexts += 1;
      const { document } = await workspace.open("unit-prefix.cssx", ".card {\n  margin: 1r\n}\n");
      const position = host.positionOf(document, "margin: 1r", "margin: 1r".length);
      const items = await host.completionItems(document, position);
      t.deepEqual(
        items.map(host.labelOf).sort(),
        ["rad", "rem"],
        "`1r` narrows to the two r-units (plan §U2 row 5 says rem only)",
      );
      t.equal(
        host.rangeOf(items[0]).start.character,
        position.character - 1,
        "unit prefix range starts after the digits",
      );
    }
    {
      contexts += 1;
      const { document } = await workspace.open("unit-percent.cssx", ".card {\n  margin: 1%\n}\n");
      const position = host.positionOf(document, "margin: 1%", "margin: 1%".length);
      const items = await host.completionItems(document, position);
      t.equal(
        items.filter((item) => item.detail === "CSS unit").length,
        0,
        "an authored `%` leaves no unit list",
      );
    }

    // 10. property context, including the semicolon setting toggle.
    {
      contexts += 1;
      const { document } = await workspace.open("property.cssx", ".card {\n  colo\n}\n");
      const position = host.positionOf(document, "colo", 4);
      const items = await host.completionItems(document, position);
      t.equal(items.length, 2, `expected two properties for "colo", got ${items.length}`);
      const color = host.byLabel(items).get("color");
      t.equal(color.kind, KIND.Property, "property items must map to Property");
      t.equal(color.detail, "CSS property");
      t.equal(
        host.insertTextOf(color),
        "color: ;",
        "property acceptance inserts `color: ;` with the caret before the semicolon",
      );
      t.equal(color.insertText.value, "color: $0;", "the snippet body parks the caret at $0");
      // Accepting a property reopens the value list at the cursor (board bug 29).
      t.equal(
        color.command?.command,
        "editor.action.triggerSuggest",
        "the property item carries the post-accept suggest command",
      );
      const range = host.rangeOf(color);
      t.equal(
        range.start.character,
        position.character - 4,
        "property range covers the typed word",
      );

      // Curated vendor spellings are surfaced only by a typed engine prefix;
      // accepting one keeps the property snippet and suggest retrigger.
      const vendor = await workspace.open("property-vendor.cssx", ".card {\n  web\n}\n");
      const vendorPosition = host.positionOf(vendor.document, "web", "web".length);
      const vendorItems = await host.completionItems(vendor.document, vendorPosition);
      const webkit = host.byLabel(vendorItems).get("-webkit-appearance");
      t.ok(webkit, "the `web` prefix offers `-webkit-appearance`");
      t.equal(webkit.kind, KIND.Property, "vendor properties map to Property");
      t.equal(webkit.detail, "vendor-prefixed property");
      t.equal(
        host.insertTextOf(webkit),
        "-webkit-appearance: ;",
        "vendor acceptance inserts the property snippet",
      );
      t.equal(
        webkit.command?.command,
        "editor.action.triggerSuggest",
        "the vendor property reopens the value list",
      );
      t.equal(
        await host.applyCompletion(vendor.editor, webkit),
        ".card {\n  -webkit-appearance: ;\n}\n",
        "accepting a vendor property replaces the typed `web`",
      );
    }
    contexts += 1;
    await settings.update(
      "editor.completePropertyWithSemicolon",
      false,
      vscode.ConfigurationTarget.Global,
    );
    try {
      const { document } = await workspace.open("property-off.cssx", ".card {\n  colo\n}\n");
      const position = host.positionOf(document, "colo", 4);
      const items = await host.completionItems(document, position);
      t.equal(
        host.insertTextOf(items[0]),
        "color: ",
        "with the setting off only `color: ` is inserted",
      );
      t.equal(items[0].insertText instanceof vscode.SnippetString, false, "no snippet when off");
      t.equal(
        items[0].command?.command,
        "editor.action.triggerSuggest",
        "the plain property insert still reopens the value list",
      );
    } finally {
      await settings.update(
        "editor.completePropertyWithSemicolon",
        true,
        vscode.ConfigurationTarget.Global,
      );
    }

    // 10b. group definition body — the real host must offer properties there
    // too (board bug 25: a group body was classified as no context).
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "group-body-property.cssx",
        ['@setup { prefix: "ui"; }', "@group.card {", "  ", "}", ""].join("\n"),
      );
      const position = host.positionOf(document, "@group.card {\n  ", "@group.card {\n  ".length);
      const items = await host.completionItems(document, position);
      t.ok(items.length > 0, "a group definition body must offer property items");
      const padding = host.byLabel(items).get("padding");
      t.ok(padding, "the group definition body offers `padding`");
      t.equal(padding.kind, KIND.Property, "group body properties map to Property");
      t.equal(padding.detail, "CSS property");
      t.equal(host.insertTextOf(padding), "padding: ;", "property acceptance inserts `padding: ;`");
      const applied = await host.applyCompletion(editor, padding);
      t.match(
        applied,
        /@group\.card \{\n {2}padding: ;\n\}/,
        "accepting a group-body property writes `padding: ;` at the declaration line",
      );
    }

    // 11. `@setup` keys and boolean values.
    {
      contexts += 1;
      const { document } = await workspace.open("setup-key.cssx", "@setup {\n  \n}\n");
      const position = host.positionOf(document, "@setup {\n  ", "@setup {\n  ".length);
      const items = await host.completionItems(document, position);
      t.equal(items.length, 15, `expected the 15 setup keys, got ${items.length}`);
      t.ok(
        items.some((item) => host.labelOf(item) === "map-inherit"),
        "the map-inherit key (ADR-0020) is offered",
      );
      t.ok(
        items.some((item) => host.labelOf(item) === "import-css"),
        "the import-css key (ADR-0021) is offered",
      );
      t.ok(
        items.some((item) => host.labelOf(item) === "media-grouping"),
        "the media-grouping key (ADR-0024) is offered",
      );
      t.ok(
        items.every((item) => item.kind === KIND.Property && item.detail === "Xessa @setup key"),
        "setup keys map to Property with their own detail",
      );
    }
    {
      contexts += 1;
      const { document } = await workspace.open("setup-value.cssx", "@setup {\n  emit-css: \n}\n");
      const position = host.positionOf(document, "emit-css: ", "emit-css: ".length);
      const items = await host.completionItems(document, position);
      t.deepEqual(
        items.map(host.labelOf).sort(),
        ["false", "true"],
        "boolean setup values complete",
      );
      t.ok(
        items.every((item) => item.kind === KIND.Value),
        "setup values map to Value",
      );
      const trueItem = items.find((item) => host.labelOf(item) === "true");
      t.ok(trueItem !== undefined, "the `true` setup value is offered");
      t.equal(
        host.insertTextOf(trueItem),
        "true;",
        "accepting a setup value appends the terminating semicolon",
      );
    }

    // 12. `@group.` names and `$keyframes.` members.
    {
      contexts += 1;
      const source = [
        "@group.card-base { padding: 4px; }",
        "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
        ".card {",
        "  @group.",
        "}",
        "",
      ].join("\n");
      const { document } = await workspace.open("group-member.cssx", source);
      const position = host.positionOf(document, "@group.", "@group.".length);
      const items = await host.completionItems(document, position);
      t.equal(items.length, 1, `expected the single defined group, got ${items.length}`);
      t.equal(items[0].kind, KIND.Module, "group items must map to Module");
      t.equal(items[0].detail, "group — defined in this file");
    }
    {
      contexts += 1;
      const source = [
        "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
        ".card { animation: $keyframes.",
        "}",
        "",
      ].join("\n");
      const { document } = await workspace.open("keyframe-member.cssx", source);
      const position = host.positionOf(document, "$keyframes.", "$keyframes.".length);
      const items = await host.completionItems(document, position, ".");
      t.equal(items.length, 1, `expected the single keyframe, got ${items.length}`);
      t.equal(host.labelOf(items[0]), "spin");
      t.equal(items[0].kind, KIND.Field, "keyframe members must map to Field");
    }

    // 13. `!` — `!important` after a declaration value word.
    {
      contexts += 1;
      const { document, editor } = await workspace.open(
        "important.cssx",
        ".card { color: red! }\n",
      );
      const position = host.positionOf(document, "red!", "red!".length);
      const items = await host.completionItems(document, position, "!");
      t.equal(items.length, 1, `expected only !important after \`red!\`, got ${items.length}`);
      const item = items[0];
      t.equal(host.labelOf(item), "!important", "the item is `!important`");
      t.equal(item.kind, KIND.Value, "`!important` maps to Value");
      t.equal(host.insertTextOf(item), "!important", "the insert never carries a second bang");
      const range = host.rangeOf(item);
      t.equal(range.start.character, ".card { color: red".length, "range starts at the typed `!`");
      t.equal(range.end.character, ".card { color: red!".length, "range ends at the caret");
      const applied = await host.applyCompletion(editor, item);
      t.equal(applied, ".card { color: red!important }\n", "accepting repairs exactly one bang");

      // `!im` filters to the same item and replaces the typed suffix.
      const filtered = await workspace.open("important-filter.cssx", ".card { color: red!im }\n");
      const filterPosition = host.positionOf(filtered.document, "red!im", "red!im".length);
      const filteredItems = await host.completionItems(filtered.document, filterPosition, "!");
      t.deepEqual(filteredItems.map(host.labelOf), ["!important"], "`!im` filters to `!important`");
      const filteredApplied = await host.applyCompletion(filtered.editor, filteredItems[0]);
      t.equal(filteredApplied, ".card { color: red!important }\n", "the typed suffix is replaced");
    }

    t.equal(contexts, 25, "every suggest-widget context of the U0 table was driven");
    return `${contexts} completion states driven (suggest widget)`;
  } finally {
    await settings.update(
      "editor.completePropertyWithSemicolon",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await workspace.dispose();
  }
}

module.exports = { run };
