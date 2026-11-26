/**
 * U6 accessibility — the six properties the plan asks for, each measured:
 *
 *   1. keyboard / palette reachability (the extension contributes no chord, so
 *      the Command Palette is the only discovery surface — and every entry in
 *      it must resolve);
 *   2. keybinding conflicts (zero declarations ⇒ zero collisions, by
 *      construction, because no public API exposes the whole keymap);
 *   3. roles and labels in the captured accessibility tree (`.ai/reports/logs/
 *      ui-screens/ax-tree.json` from U3) plus the output channel's rendered
 *      record from the same capture run;
 *   4. screen-reader readability of the hover Markdown (the U1 fixture set);
 *   5. diagnostic severity appropriateness (enumerated over every committed
 *      fixture, never a single sample);
 *   6. file-icon visibility (both theme variants declared and present).
 *
 * Colour contrast is **not** asserted here: it needs an image, and the vision
 * pass had no image input in this environment. That is recorded in the summary
 * line and in `.ai/reports/CSSX-U6.md`, not turned into a fake pass.
 *
 * Cross-references (no duplication): the palette titles/categories are pinned
 * exactly in `commands-matrix.js`, the diagnostic code/span/severity of the
 * five curated broken fixtures in `diagnostics.js`, the hover Markdown shapes
 * in `hovers.js`. This module asserts the *accessibility property* of each.
 */

const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const host = require("./host.js");

/** Repo root from `packages/vscode/test/ui` (four levels up). */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CAPTURE_DIR = path.join(REPO_ROOT, ".ai", "reports", "logs", "ui-screens");
const AX_TREE = path.join(CAPTURE_DIR, "ax-tree.json");
const CAPTURE_MANIFEST = path.join(CAPTURE_DIR, "manifest.json");

/** The six contributed commands, ids only (titles are `commands-matrix.js`'s job). */
const COMMAND_IDS = [
  "xessa.compileFile",
  "xessa.buildProject",
  "xessa.previewCompiledCss",
  "xessa.openGeneratedCss",
  "xessa.openClassMap",
  "xessa.checkProject",
];

/**
 * Manifest sections this extension is allowed to contribute (U0 §"Contributed surface").
 *
 * `semanticTokenColors` is deliberately absent: it is not an extension
 * contribution point in current VS Code (themes own semantic colours; the
 * README palette in `editor.semanticTokenColorCustomizations` is an optional
 * override). `semanticTokenScopes` is real and provides the zero-config
 * theme-scope fallback. `configurationDefaults` carries the contributed magenta
 * default for `keyword.control.media.xessa`; it is a default only, so a user
 * `editor.tokenColorCustomizations` rule still wins.
 */
const EXPECTED_CONTRIBUTIONS = [
  "commands",
  "configuration",
  "configurationDefaults",
  "grammars",
  "languages",
  "semanticTokenScopes",
];

/** Roles a screen reader treats as interactive (must never be anonymous). */
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiobutton",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

/** Every committed fixture (the severity sweep enumerates all of them). */
const FIXTURES = [
  "broken.cssx",
  "complete.cssx",
  "ui/broken-alias.cssx",
  "ui/broken-semicolon.cssx",
  "ui/broken-setup.cssx",
  "ui/broken-syntax.cssx",
  "ui/broken-token.cssx",
  "ui/clean.cssx",
  "ui/colors.cssx",
  "ui/navigation-entry.cssx",
  "ui/navigation-groups.cssx",
  "ui/navigation-theme.cssx",
  "ui/theme.cssx",
];

/** Fixtures the diagnostics module already pins as rejecting (cross-reference, don't repeat). */
const CURATED_ERROR_FIXTURES = [
  "ui/broken-alias.cssx",
  "ui/broken-semicolon.cssx",
  "ui/broken-setup.cssx",
  "ui/broken-syntax.cssx",
  "ui/broken-token.cssx",
];

/** Severity number → name, so a failure message says "Information" not "2". */
const SEVERITY_NAMES = new Map([
  [vscode.DiagnosticSeverity.Error, "Error"],
  [vscode.DiagnosticSeverity.Warning, "Warning"],
  [vscode.DiagnosticSeverity.Information, "Information"],
  [vscode.DiagnosticSeverity.Hint, "Hint"],
]);

function severityName(severity) {
  return SEVERITY_NAMES.get(severity) ?? `severity:${severity}`;
}

/** Count of Markdown links (`[text](target)`) in a string. */
function linkCount(markdown) {
  return Array.from(markdown.matchAll(/\[[^\]]*\]\([^)]*\)/g)).length;
}

async function findExtension() {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON?.name === "xessa",
  );
  if (extension === undefined) throw new Error("Xessa extension is not registered in the host");
  await extension.activate();
  return extension;
}

/**
 * Item 1 + 2 — keyboard/palette reachability and the keybinding-conflict check.
 *
 * The accessibility property is not "the palette lists six entries" (that is
 * `commands-matrix.js`); it is "a keyboard-only user can reach every feature
 * and nothing this extension declares can shadow a core chord".
 */
async function keyboardReachability(t, manifest) {
  await findExtension();
  const commands = manifest.contributes.commands;
  t.equal(commands.length, COMMAND_IDS.length, "the palette surface changed size");

  const registered = new Set(await vscode.commands.getCommands(false));
  const titles = new Set();
  for (const id of COMMAND_IDS) {
    t.ok(registered.has(id), `${id} is not resolvable through the Command Palette`);
    const entry = commands.find((candidate) => candidate.command === id);
    t.ok(entry, `${id} has no manifest entry, so it has no palette label`);
    // The palette renders "<category>: <title>"; that string is what a screen
    // reader announces, so both halves must be non-empty and unique per entry.
    t.ok(
      typeof entry.title === "string" && entry.title.trim() !== "",
      `${id} has an empty palette title`,
    );
    t.equal(entry.category, "Xessa", `${id} would be announced without the "Xessa" grouping`);
    t.equal(titles.has(entry.title), false, `two palette entries share the title ${entry.title}`);
    titles.add(entry.title);
    // An enablement condition would make a palette entry silently dead in some
    // workspace states, which is a keyboard dead-end. None is declared.
    t.equal(entry.enablement, undefined, `${id} carries an enablement condition`);
  }
  t.equal(titles.size, COMMAND_IDS.length, "palette titles are not unique");

  // No keybindings, therefore no conflict is possible: a chord this extension
  // never declares cannot shadow a core binding. `vscode` exposes no API to
  // enumerate the platform keymap, so "zero declarations" is the strongest
  // honest form of the check (recorded in CSSX-U6.md).
  t.equal(
    manifest.contributes.keybindings,
    undefined,
    "a keybinding contribution appeared — re-check collisions against the core chords",
  );
  const contributed = Object.keys(manifest.contributes).sort();
  t.deepEqual(
    contributed,
    EXPECTED_CONTRIBUTIONS,
    `unexpected contribution section(s): ${contributed.join(", ")}`,
  );
  // No menus either: nothing is mouse-only, the palette is the single surface.
  t.equal(manifest.contributes.menus, undefined, "a menu contribution appeared (mouse-first path)");

  // Status bar entry: the click target is a palette command, so the same entry
  // is reachable from the keyboard (the item itself is write-only through the API).
  const statusTarget = "xessa.buildProject";
  t.ok(registered.has(statusTarget), "the status bar item's command is not registered");
}

/**
 * Item 3 — roles and labels in the captured accessibility tree.
 *
 * The tree is U3's `Accessibility.getFullAXTree` snapshot (444 nodes). If the
 * capture is absent the AX half is recorded unavailable — never assumed good.
 */
function accessibilityTree(t) {
  if (!existsSync(AX_TREE)) {
    console.log(`[xessa a11y] AX tree unavailable: ${AX_TREE} (recorded, not asserted)`);
    return { available: false, nodes: 0 };
  }
  const tree = JSON.parse(readFileSync(AX_TREE, "utf8"));
  const nodes = tree.nodes;
  t.ok(Array.isArray(nodes) && nodes.length > 300, "the AX snapshot is missing or truncated");
  t.equal(tree.version, "1.147.0", "the AX snapshot was taken in a different VS Code build");

  const nameOf = (node) => node.name?.value ?? "";
  const roleOf = (node) => node.role?.value ?? "";

  // The status bar item: a focusable button whose accessible *name* carries the
  // outcome, and whose name comes from an explicit `aria-label` (the extension
  // sets `StatusBarItem.name`/`tooltip`), not from the codicon glyph.
  const statusNodes = nodes.filter(
    (node) => roleOf(node) === "button" && /^[a-z]+ +Xessa/.test(nameOf(node)),
  );
  t.equal(statusNodes.length, 1, "the status bar item is not exactly one accessible button");
  const status = statusNodes[0];
  t.match(nameOf(status), /^(check|warning|error) +Xessa\b/, "the button has no state word");
  t.match(
    nameOf(status),
    /Compiled .*→ 3 artifact\(s\)\./,
    "the accessible name drops the tooltip text (build result)",
  );
  const sources = (status.name.sources ?? []).map((source) => source.attribute ?? source.type);
  t.ok(sources.includes("aria-label"), `the status name has no aria-label source (${sources})`);
  t.ok(
    !nameOf(status).includes("\ueab2"),
    "the accessible name exposes the raw codicon glyph instead of text",
  );
  const focusable = (status.properties ?? []).find((property) => property.name === "focusable");
  t.equal(focusable?.value?.value, true, "the status bar button is not focusable");

  // The transient status-bar message (`setStatusBarMessage`) keeps its full text.
  const message = nodes.find(
    (node) =>
      roleOf(node) === "button" &&
      /^Xessa: wrote \d+ artifact\(s\) for .+\.cssx$/.test(nameOf(node)),
  );
  t.ok(message, "the status-bar message text is not exposed");

  // Toasts: the error toast is a live region (`alert`) and names the output
  // channel the user has to open, so the failure is announceable and actionable.
  const alerts = nodes.filter((node) => roleOf(node) === "alert");
  t.ok(alerts.length >= 1, "no ARIA live region exists for notifications");
  const errorToast = nodes.find((node) =>
    /^Error: Xessa: \d+ entr(y|ies) failed\. See the Xessa output channel\.$/.test(nameOf(node)),
  );
  t.ok(errorToast, "the failure toast is not exposed as text");

  // Nothing Xessa-rendered is silently dropped from the tree.
  const xessaNodes = nodes.filter((node) => nameOf(node).includes("Xessa"));
  t.ok(xessaNodes.length >= 5, "the Xessa-rendered surfaces barely appear in the AX tree");
  for (const node of xessaNodes) {
    t.equal(node.ignored, false, `an AX node naming Xessa is ignored (${nameOf(node)})`);
  }

  // No anonymous interactive element anywhere in the captured tree.
  const interactive = nodes.filter(
    (node) => INTERACTIVE_ROLES.has(roleOf(node)) && node.ignored !== true,
  );
  t.ok(interactive.length > 0, "the AX tree contains no interactive nodes at all");
  const anonymous = interactive.filter((node) => nameOf(node).trim() === "");
  t.equal(
    anonymous.length,
    0,
    `${anonymous.length} interactive AX node(s) have no accessible name`,
  );

  return { available: true, nodes: nodes.length };
}

/**
 * Output-channel readability from the same capture run.
 *
 * `ax-tree.json` was taken in the grammar state (panel closed), so the channel
 * lines live in U3's per-screen DOM record: `lines`, `hasWroteLine`,
 * `hasTimestamp` and a text sample. Asserted here so the claim is checked.
 */
function outputChannelRecord(t) {
  if (!existsSync(CAPTURE_MANIFEST)) {
    console.log(`[xessa a11y] output-channel record unavailable: ${CAPTURE_MANIFEST}`);
    return false;
  }
  const manifest = JSON.parse(readFileSync(CAPTURE_MANIFEST, "utf8"));
  const screen = (manifest.screens ?? []).find((entry) => entry.name === "output-channel");
  t.ok(screen, "the U3 capture has no output-channel screen");
  t.ok(screen.dom.lines >= 10, `only ${screen.dom.lines} output line(s) rendered`);
  t.equal(screen.dom.hasWroteLine, true, "no `wrote …` line reached the rendered channel");
  t.equal(screen.dom.hasTimestamp, true, "the rendered channel lines lost their timestamps");
  t.match(screen.dom.text, /\[20\d\d-\d\d-\d\dT/, "the rendered channel text has no timestamp");
  return true;
}

/**
 * Item 4 — screen-reader readability of hover content.
 *
 * Reuses the `ui/clean.cssx` document set from `hovers.js`. The property: plain
 * Markdown (bold + code spans), at most one link, no bare URLs, no images and
 * no raw HTML — everything a hover popup would otherwise render as noise or
 * drop entirely.
 */
async function hoverReadability(t) {
  const { document } = await host.openFixture("ui/clean.cssx");
  // `codeSpan: false` is the one prose-only shape (a property's one-sentence
  // documentation); every hover that names a value, symbol or class must wrap
  // it in a code span so a screen reader reads it as literal text.
  const positions = [
    { position: host.positionOf(document, "$brand;", 2), codeSpan: true },
    { position: host.positionOf(document, "$theme;", 2), codeSpan: true },
    { position: host.positionOf(document, "padding: $gap", 2), codeSpan: false },
    { position: host.positionOf(document, "calc(", 1), codeSpan: true },
    { position: host.positionOf(document, "@md {", 1), codeSpan: true },
    { position: host.positionOf(document, ".card {", 1), codeSpan: true },
    { position: host.positionOf(document, "spin {", 1), codeSpan: true },
    { position: host.positionOf(document, "@group.card-base {", 8), codeSpan: true },
  ];

  let checked = 0;
  for (const { position, codeSpan } of positions) {
    const hovers = await host.hoversAt(document, position);
    if (hovers.length === 0) continue;
    const markdown = host.hoverMarkdown(hovers[0]);
    checked += 1;
    t.ok(hovers[0].contents[0] instanceof vscode.MarkdownString, "hover content is not Markdown");
    t.ok(linkCount(markdown) <= 1, `hover has ${linkCount(markdown)} links (max 1): ${markdown}`);
    t.equal(markdown.includes("!["), false, `hover carries an image: ${markdown}`);
    t.equal(/https?:\/\//.test(markdown), false, `hover carries a bare URL: ${markdown}`);
    t.equal(
      /<\/?[a-z][a-z0-9]*[\s/>]/i.test(markdown),
      false,
      `hover carries raw HTML: ${markdown}`,
    );
    // Plain-text property: no headings, tables or blockquotes — a hover popup
    // renders those as broken fragments and screen readers announce them out of
    // context. (Bold titles are used where a shape has a title; the `@md` alias
    // hover is a plain expression, so bold is not required.)
    t.equal(/^#+\s/m.test(markdown), false, `hover carries a Markdown heading: ${markdown}`);
    t.equal(/^\s*>\s/m.test(markdown), false, `hover carries a blockquote: ${markdown}`);
    t.equal(/^\s*\|.*\|\s*$/m.test(markdown), false, `hover carries a Markdown table: ${markdown}`);
    if (codeSpan) {
      t.match(markdown, /`[^`]+`/, `hover carries no code span for its value: ${markdown}`);
    }
    // A trusted MarkdownString can render command links; hovers never need it.
    t.equal(
      hovers[0].contents.every((content) => content.isTrusted !== true),
      true,
      "a hover content is marked trusted (arbitrary command links)",
    );
  }
  t.ok(checked >= 7, `only ${checked} hover shape(s) were readable`);
  return checked;
}

/**
 * Item 5 — diagnostic severity appropriateness.
 *
 * Enumerates every committed fixture (not one sample) and asserts no Xessa
 * diagnostic is `Information`/`Hint`. Errors are rejections (XESSA1001/1002/
 * 1003/2001/3001, all curated in `diagnostics.js`); the only warning-severity
 * code path in the product is XESSA4001/XESSA5001 in the output planner.
 */
async function severitySweep(t) {
  const documents = new Map();
  const open = async (relative) => {
    const document = await vscode.workspace.openTextDocument(host.fixtureUri(relative));
    documents.set(relative, document);
    return document;
  };
  for (const relative of FIXTURES) await open(relative);

  // Bounded poll on a real observable: the curated rejecting fixtures publish.
  // A document can be closed again by a leftover editor restore from an earlier
  // scenario, which clears its diagnostics and stops further publication, so the
  // predicate re-opens a closed fixture instead of waiting for a timer.
  await host.waitFor(
    async () => {
      let pending = 0;
      for (const relative of CURATED_ERROR_FIXTURES) {
        const uri = host.fixtureUri(relative);
        if (host.diagnosticsOf(uri).some((diagnostic) => diagnostic.source === "xessa")) continue;
        const document = documents.get(relative);
        if (document === undefined || document.isClosed) await open(relative);
        pending += 1;
      }
      return pending === 0;
    },
    { label: "the curated broken fixtures to publish diagnostics" },
  );

  const histogram = new Map();
  const byCode = new Map();
  const perFixture = new Map();
  for (const relative of FIXTURES) {
    const diagnostics = host
      .diagnosticsOf(host.fixtureUri(relative))
      .filter((diagnostic) => diagnostic.source === "xessa");
    perFixture.set(
      relative,
      diagnostics.map((diagnostic) => severityName(diagnostic.severity)),
    );
    for (const diagnostic of diagnostics) {
      const severity = severityName(diagnostic.severity);
      histogram.set(severity, (histogram.get(severity) ?? 0) + 1);
      byCode.set(diagnostic.code, severity);
    }
  }

  t.ok(histogram.size > 0, "no fixture published a diagnostic, so severity is unmeasured");
  for (const [severity, count] of histogram) {
    t.ok(
      severity === "Error" || severity === "Warning",
      `${count} diagnostic(s) use the ${severity} level without a documented cause`,
    );
  }
  t.equal(
    histogram.get("Information"),
    undefined,
    "an Information diagnostic exists (no such code)",
  );
  t.equal(histogram.get("Hint"), undefined, "a Hint diagnostic exists (no such code)");

  // Every curated rejecting fixture stays an Error: a rejection is not advisory.
  for (const relative of CURATED_ERROR_FIXTURES) {
    const severities = perFixture.get(relative) ?? [];
    t.ok(severities.length >= 1, `${relative} published no diagnostic`);
    t.deepEqual(
      [...new Set(severities)],
      ["Error"],
      `${relative} is not reported as an Error (${severities.join(",")})`,
    );
  }
  const errorCodes = new Set(
    [...byCode.entries()].filter(([, severity]) => severity === "Error").map(([code]) => code),
  );
  for (const code of ["XESSA1001", "XESSA1002", "XESSA1003", "XESSA2001", "XESSA3001"]) {
    t.ok(errorCodes.has(code), `${code} is not measured as an Error`);
  }
  const published = [...perFixture]
    .filter(([, severities]) => severities.length > 0)
    .map(([name, count]) => `${name}:${count.length}`)
    .join(" ");
  console.log(
    `[xessa a11y] severity sweep: ${[...histogram].map(([name, count]) => `${name}=${count}`).join(",")} across ${published}`,
  );
  return {
    histogram: [...histogram].map(([severity, count]) => `${severity}=${count}`).join(","),
    published,
  };
}

/**
 * Item 6 — file-icon visibility.
 *
 * Both theme variants must exist, be declared in the language contribution and
 * be real SVGs carrying the brand X/S palette (dark mark on a pale tile for
 * light themes, light mark on a dark tile for dark themes). Rendered contrast
 * is a pixel question the vision pass could not answer here; that is recorded,
 * not claimed.
 */
async function fileIcons(t, extension, manifest) {
  const language = manifest.contributes.languages.find((entry) => entry.id === "xessa");
  t.ok(language, "no xessa language contribution");
  t.ok(language.icon, "the language contributes no file icon");
  t.equal(language.icon.light, "./media/file-icon.svg", "light icon path changed");
  t.equal(language.icon.dark, "./media/file-icon-dark.svg", "dark icon path changed");
  t.equal(manifest.contributes.iconThemes, undefined, "the icons moved into an icon theme?");

  for (const key of ["light", "dark"]) {
    const absolute = path.resolve(extension.extensionPath, language.icon[key]);
    t.ok(existsSync(absolute), `${key} file icon is missing at ${absolute}`);
    const svg = readFileSync(absolute, "utf8");
    t.match(svg, /^<svg[\s>]/, `${key} file icon is not an SVG document`);
    t.match(svg, /viewBox="0 0 32 32"/, `${key} file icon has no 32×32 viewBox`);
    t.ok(svg.length > 400, `${key} file icon is empty`);
    t.match(svg, /role="img"/, `${key} file icon carries no role`);
    t.match(svg, /aria-label="Xessa source file"/, `${key} file icon carries no accessible label`);
  }
  const light = readFileSync(path.resolve(extension.extensionPath, language.icon.light), "utf8");
  const dark = readFileSync(path.resolve(extension.extensionPath, language.icon.dark), "utf8");
  // The monogram pairs a dark X/S with a pale tile for light themes and a light
  // X/S with a dark tile for dark themes, so one file stays legible on both.
  t.match(light, /fill="#E6F7F1"/, "the light-theme icon has no pale tile");
  t.match(light, /stroke="#0B6B5F"/, "the light-theme icon has no dark X mark");
  t.match(light, /stroke="#16A34A"/, "the light-theme icon has no green S mark");
  t.equal(/#ffffff/.test(light), false, "the light-theme icon carries a white fill");
  t.match(dark, /fill="#071A16"/, "the dark-theme icon has no dark tile");
  t.match(dark, /stroke="#5EEAD4"/, "the dark-theme icon has no light X mark");
  t.match(dark, /stroke="#A7F3D0"/, "the dark-theme icon has no mint S mark");
  t.equal(/#000000/.test(dark), false, "the dark-theme icon carries a black fill");
  t.ok(light !== dark, "both theme variants are the same bytes");
  return true;
}

async function run(t) {
  const extension = await findExtension();
  const manifest = extension.packageJSON;

  // ---- 1 + 2: keyboard reachability, palette labels, zero keybinding conflicts.
  await keyboardReachability(t, manifest);

  // ---- 3: roles/labels of contributed UI (captured AX tree) + output channel.
  const tree = accessibilityTree(t);
  const channel = outputChannelRecord(t);

  // ---- 4: screen-reader-readable hover Markdown.
  const hoverShapes = await hoverReadability(t);

  // ---- 5: severity appropriateness across every fixture.
  const severity = await severitySweep(t);

  // ---- 6: file icons declared, present and theme-paired.
  await fileIcons(t, extension, manifest);

  // Recorded, never asserted: contrast needs an image; the vision pass had none.
  console.log(
    "[xessa a11y] colour contrast: unavailable (no image input in the vision pass; U3 PNGs on disk)",
  );

  const treeNote = tree.available ? `${tree.nodes} AX nodes` : "AX tree unavailable";
  const channelNote = channel ? "output channel readable" : "output channel record unavailable";
  return (
    `6 a11y properties: palette (6 commands, 0 chords), ${treeNote}, hover (${hoverShapes} shapes), ` +
    `severity (${severity.histogram}), icons light+dark, ${channelNote}`
  );
}

module.exports = { run };
