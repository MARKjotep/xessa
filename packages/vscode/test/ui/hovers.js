/**
 * Hover-card scenarios — `vscode.executeHoverProvider` on the tokens, aliases,
 * properties, functions, groups, keyframes and classes of the clean fixture.
 *
 * The assertions pin the Markdown shape (a `MarkdownString` whose text carries
 * the value/section the popup shows) and the covered range, plus the negative
 * positions that must produce no hover at all.
 */

const vscode = require("vscode");
const host = require("./host.js");

function lastPositionOf(document, needle, delta) {
  const index = document.getText().lastIndexOf(needle);
  if (index < 0) throw new Error(`document does not contain ${JSON.stringify(needle)}`);
  return document.positionAt(index + delta);
}

async function run(t) {
  const { document } = await host.openFixture("ui/clean.cssx");

  async function hoverAt(position) {
    const hovers = await host.hoversAt(document, position);
    return hovers.length === 0 ? undefined : hovers[0];
  }

  t.equal(
    (await host.diagnosticsOf(document.uri)).length,
    0,
    "the hover fixture is the clean one (no diagnostics)",
  );

  // Compile-time token: value section in Markdown, range over the reference.
  const brand = await hoverAt(host.positionOf(document, "$brand;", 2));
  t.ok(brand, "no hover for `$brand`");
  t.ok(brand.contents[0] instanceof vscode.MarkdownString, "hover content is a MarkdownString");
  t.match(host.hoverMarkdown(brand), /\*\*\$brand\*\* — compile-time token/);
  t.match(host.hoverMarkdown(brand), /Value: `#2563eb`/);
  t.equal(brand.range.start.character, 9, "`$brand` hover starts on the sigil");
  t.equal(brand.range.end.character, 15, "`$brand` hover covers the whole reference");

  // Runtime token: the custom property name is the useful part.
  const theme = await hoverAt(host.positionOf(document, "$theme;", 2));
  t.ok(theme, "no hover for `$theme`");
  t.match(host.hoverMarkdown(theme), /\*\*\$theme\*\* — runtime token/);
  t.match(host.hoverMarkdown(theme), /Custom property: `--ui-theme`/);
  t.match(host.hoverMarkdown(theme), /Base value: `light`/);

  // Property, with the built-in one-sentence documentation.
  const padding = await hoverAt(host.positionOf(document, "padding: $gap", 2));
  t.ok(padding, "no hover for the `padding` property");
  t.match(host.hoverMarkdown(padding), /\*\*padding\*\* — CSS property/);
  t.equal(padding.range.start.character, 2, "property hover starts on the property word");
  t.equal(padding.range.end.character, 9, "property hover covers the property word only");

  // Curated CSS function: only the name word, never the arguments.
  const calc = await hoverAt(host.positionOf(document, "calc(", 1));
  t.ok(calc, "no hover for `calc`");
  t.match(host.hoverMarkdown(calc), /\*\*calc\(\)\*\* — CSS function/);
  t.match(host.hoverMarkdown(calc), /Example: `calc\(100% - 20px\)`/);
  t.equal(calc.range.end.character - calc.range.start.character, 4, "function hover covers `calc`");

  // Media alias: the resolved condition.
  const alias = await hoverAt(host.positionOf(document, "@md {", 1));
  t.ok(alias, "no hover for `@md`");
  t.match(host.hoverMarkdown(alias), /`@md` → `\(min-width: 768px\)` \(builtin\)/);
  t.equal(alias.range.start.character, 2, "alias hover starts on the sigil");

  // Generated class on a rule and on a nested selector.
  const ruleClass = await hoverAt(host.positionOf(document, ".card {", 1));
  t.ok(ruleClass, "no hover for `.card`");
  t.match(host.hoverMarkdown(ruleClass), /\*\*`\.card`\*\* — generated class: `ui-card`/);
  const nestedClass = await hoverAt(host.positionOf(document, ".title {", 2));
  t.ok(nestedClass, "no hover for `.title`");
  t.match(host.hoverMarkdown(nestedClass), /generated class: `ui-title`/);

  // Keyframe definition and group definition/use site.
  const keyframe = await hoverAt(host.positionOf(document, "spin {", 1));
  t.ok(keyframe, "no hover for the `spin` keyframe");
  t.match(host.hoverMarkdown(keyframe), /\*\*@keyframes spin\*\* — keyframe definition/);
  t.match(host.hoverMarkdown(keyframe), /Frames: `from`, `to`/);
  const groupDefinition = await hoverAt(host.positionOf(document, "@group.card-base {", 8));
  t.ok(groupDefinition, "no hover for the group definition");
  t.match(host.hoverMarkdown(groupDefinition), /— group definition/);
  const groupUse = await hoverAt(lastPositionOf(document, "@group.card-base", 8));
  t.ok(groupUse, "no hover for the group use site");
  t.match(host.hoverMarkdown(groupUse), /— group use site/);

  // F23: defaults render as a real bullet list (not soft-collapsed inline code).
  // The committed clean fixture has one default, so a scratch workspace pins the
  // multi-declaration contract with authored spacing preserved.
  const groupWorkspace = await host.createWorkspace("xessa-ui-group-hover-");
  try {
    const groupText = [
      "@group.card-base {",
      "  padding: 12px;",
      "  border-radius: 8px;",
      "  border: 1px solid #ddd;",
      "}",
      "",
      ".card {",
      "  @group.card-base {",
      "    padding: 4px;",
      "    border-radius: 0;",
      "  }",
      "}",
    ].join("\n");
    const { document: groupDocument } = await groupWorkspace.open("group-hover.cssx", groupText);
    const definitionHovers = await host.hoversAt(
      groupDocument,
      host.positionOf(groupDocument, "@group.card-base", 8),
    );
    t.ok(definitionHovers.length > 0, "no hover for the multi-default group definition");
    const definitionMarkdown = host.hoverMarkdown(definitionHovers[0]);
    t.match(definitionMarkdown, /\*\*Defaults\*\*/, "definition hover has a Defaults heading");
    t.match(
      definitionMarkdown,
      /\n- `padding: 12px`\n- `border-radius: 8px`\n- `border: 1px solid #ddd`/,
      "definition defaults are separate bullet lines in definition order",
    );
    t.ok(
      definitionMarkdown.split("\n- ").length - 1 >= 2,
      "definition hover has at least two bullet lines",
    );

    const useHovers = await host.hoversAt(
      groupDocument,
      lastPositionOf(groupDocument, "@group.card-base", 8),
    );
    t.ok(useHovers.length > 0, "no hover for the multi-default group use site");
    const useMarkdown = host.hoverMarkdown(useHovers[0]);
    t.match(useMarkdown, /\*\*Defaults\*\*/, "use-site hover has a Defaults heading");
    t.match(
      useMarkdown,
      /\*\*Overrides at this use site\*\*\n- `padding`\n- `border-radius`/,
      "use-site overrides are a separate bulleted section",
    );
    t.ok(useMarkdown.split("\n- ").length - 1 >= 2, "use-site hover has at least two bullet lines");
  } finally {
    await groupWorkspace.dispose();
  }

  // ADR-0024: the `media-grouping` key carries the optimization card.
  const setupWorkspace = await host.createWorkspace("xessa-ui-setup-hover-");
  try {
    const setupText = ["@setup {", "  media-grouping: merge;", "}"].join("\n");
    const { document: setupDocument } = await setupWorkspace.open("setup-hover.cssx", setupText);
    const groupingHovers = await host.hoversAt(
      setupDocument,
      host.positionOf(setupDocument, "media-grouping", 4),
    );
    t.ok(groupingHovers.length > 0, "no hover for the `media-grouping` key");
    const groupingMarkdown = host.hoverMarkdown(groupingHovers[0]);
    t.match(
      groupingMarkdown,
      /\*\*`media-grouping`\*\* — Xessa `@setup` key/,
      "media-grouping hover names the key",
    );
    t.match(
      groupingMarkdown,
      /- `merge` — additionally merges same-selector\/same-condition media runs/,
      "media-grouping hover explains merge",
    );
    t.match(groupingMarkdown, /Default: `safe`/, "media-grouping hover states the default");
    t.match(groupingMarkdown, /See ADR-0024\./, "media-grouping hover points at ADR-0024");
    t.equal(groupingHovers[0].range.start.character, 2, "media-grouping hover starts on the key");
    t.equal(
      groupingHovers[0].range.end.character,
      2 + "media-grouping".length,
      "media-grouping hover covers the key only",
    );
  } finally {
    await setupWorkspace.dispose();
  }

  // Negative positions: a plain value and the end of the document.
  const value = await host.hoversAt(document, host.positionOf(document, "red;", 1));
  t.equal(value.length, 0, "a plain colour value has no hover");
  const blank = await host.hoversAt(document, document.positionAt(document.getText().length));
  t.equal(blank.length, 0, "a position with no token has no hover");

  // Screen-reader hygiene: Markdown only, no links/images/raw HTML (U6 input).
  for (const hover of [brand, theme, padding, calc, alias, ruleClass, groupUse]) {
    const markdown = host.hoverMarkdown(hover);
    t.equal(/<a\s|!\[|\]\(http/.test(markdown), false, "hover markdown carries no links or images");
  }

  return "10 hover shapes + 2 negative positions (tokens, alias, property, function, class, group, keyframes, setup key)";
}

module.exports = { run };
