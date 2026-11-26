/**
 * Semantic-token scenario (`CSSX-COLOR-TOKENS`).
 *
 * Drives the registered provider through VS Code's own semantic-token commands
 * (`vscode.provideDocumentSemanticTokensLegend` / `…SemanticTokens`, the
 * internal provider entry points the editor uses) and asserts the legend, the
 * manifest scope fallback and the type of every coloured range on
 * `fixtures/ui/semantic.cssx`. Colours are painted by the active theme through
 * the `semanticTokenScopes` fallback (the README's literal palette is an
 * optional override), so the scenario also pins that the inert
 * `semanticTokenColors` block stays gone. No assertion reads the extension's
 * source text: the evidence is the token stream the editor would render.
 */

const vscode = require("vscode");
const host = require("./host.js");

const LEGEND = ["variable", "namespace", "runtimeVariable", "customProperty", "keyframe"];

/** Decode the five-number `SemanticTokens.data` layout into absolute offsets. */
function decode(document, data) {
  const offsets = [];
  const lineStarts = [0];
  for (let index = 0; index < document.getText().length; index += 1) {
    if (document.getText().charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  let line = 0;
  let character = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index];
    const deltaStart = data[index + 1];
    const length = data[index + 2];
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;
    const start = (lineStarts[line] ?? 0) + character;
    offsets.push({ start, end: start + length, type: data[index + 3] });
  }
  return offsets;
}

/** Legend type covering `offset`, if any. */
function typeAt(tokens, legend, offset) {
  const token = tokens.find((candidate) => offset >= candidate.start && offset < candidate.end);
  return token === undefined ? undefined : legend.tokenTypes[token.type];
}

function xessaExtension() {
  return vscode.extensions.all.find((extension) => extension.packageJSON.name === "xessa");
}

async function run(t) {
  const { document } = await host.openFixture("ui/semantic.cssx");
  const legend = await vscode.commands.executeCommand(
    "vscode.provideDocumentSemanticTokensLegend",
    document.uri,
  );
  t.ok(legend !== undefined, "no semantic-token legend for the xessa document");
  t.deepEqual(legend.tokenTypes, LEGEND, "legend types are the five documented types");
  t.deepEqual(legend.tokenModifiers, [], "v1 registers no modifiers");

  const manifest = xessaExtension()?.packageJSON?.contributes ?? {};
  t.equal(
    manifest.semanticTokenColors,
    undefined,
    "manifest carries no inert semanticTokenColors block",
  );
  const scopes = (manifest.semanticTokenScopes ?? []).find((entry) => entry.language === "xessa");
  t.ok(scopes !== undefined, "manifest semanticTokenScopes has a xessa entry");
  t.deepEqual(
    scopes.scopes,
    {
      variable: ["variable.language"],
      namespace: ["entity.name.type"],
      runtimeVariable: ["keyword.control"],
      customProperty: ["keyword.control"],
      keyframe: ["entity.name.function"],
    },
    "scope fallback maps each kind to a theme scope",
  );

  const tokens = await vscode.commands.executeCommand(
    "vscode.provideDocumentSemanticTokens",
    document.uri,
  );
  t.ok(tokens !== undefined, "the provider returned no semantic tokens");
  const decoded = decode(document, tokens.data);
  t.equal(decoded.length, 9, `expected the 9 fixture references, got ${decoded.length}`);

  const offsetOf = (needle, delta = 0) => {
    const index = document.getText().indexOf(needle);
    if (index < 0) throw new Error(`fixture does not contain ${JSON.stringify(needle)}`);
    return index + delta;
  };

  // Compile-time and runtime references.
  t.equal(typeAt(decoded, legend, offsetOf("$spacing", 1)), "variable", "$spacing is variable");
  t.equal(
    typeAt(decoded, legend, offsetOf("$accent", 1)),
    "runtimeVariable",
    "$accent is runtimeVariable",
  );

  // Namespace prefixes and members follow the resolved kind.
  t.equal(
    typeAt(decoded, legend, offsetOf("$ui.primary", 1)),
    "namespace",
    "$ui prefix is namespace",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("$ui.primary", "$ui.".length + 1)),
    "variable",
    "a compile member is variable",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("$ui.missing", 1)),
    "namespace",
    "an unresolvable member keeps the prefix token",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("$ui.missing", "$ui.".length + 1)),
    undefined,
    "an unresolvable member has no semantic token",
  );

  // `--x` references, including inside var().
  t.equal(
    typeAt(decoded, legend, offsetOf("var(--accent)", "var(".length + 2)),
    "customProperty",
    "a var() argument is customProperty",
  );

  // `$keyframes.<name>`: prefix namespace, resolved member keyframe.
  t.equal(
    typeAt(decoded, legend, offsetOf("$keyframes.spin", 1)),
    "namespace",
    "$keyframes prefix is namespace",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("$keyframes.spin", "$keyframes.".length + 1)),
    "keyframe",
    "a resolved keyframe member is keyframe",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("$keyframes.nope", "$keyframes.".length + 1)),
    undefined,
    "an unresolvable keyframe member has no semantic token",
  );

  // Grammar fallback stays for unknown bare tokens and declaration sites.
  t.equal(typeAt(decoded, legend, offsetOf("$ghost", 1)), undefined, "$ghost stays grammar-only");
  t.equal(
    typeAt(decoded, legend, offsetOf("accent: #2563eb", 1)),
    undefined,
    "@runtime declaration sites keep property-name styling",
  );
  t.equal(
    typeAt(decoded, legend, offsetOf("spacing: 4px", 1)),
    undefined,
    "@variables declaration sites keep property-name styling",
  );

  return `${decoded.length} semantic tokens (legend + scope fallback + kinds)`;
}

module.exports = { run };
