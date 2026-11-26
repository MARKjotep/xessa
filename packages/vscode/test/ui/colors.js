/**
 * Colour scenarios — `vscode.executeDocumentColorProvider` (the swatches the
 * editor renders) and `vscode.executeColorPresentationProvider` (the hex the
 * native picker writes back).
 *
 * The fixture is the A51 surface: named and hex values, the `#rrggbbaa` alpha
 * form, a custom property, a hex inside a non-colour property, plus the
 * recorded negatives (a named colour in a shorthand, a colour word in a string,
 * a token reference and a `url(...)` argument).
 */

const vscode = require("vscode");
const host = require("./host.js");

const TOLERANCE = 0.002;

function closeTo(actual, expected) {
  return Math.abs(actual - expected) <= TOLERANCE;
}

function swatchAt(colors, document, needle, delta, length) {
  const start = document.positionAt(document.getText().indexOf(needle) + delta);
  const end = document.positionAt(document.getText().indexOf(needle) + delta + length);
  return {
    start,
    end,
    color: colors.find(
      (candidate) =>
        candidate.range.start.line === start.line &&
        candidate.range.start.character === start.character &&
        candidate.range.end.line === end.line &&
        candidate.range.end.character === end.character,
    ),
  };
}

async function run(t) {
  const { document } = await host.openFixture("ui/colors.cssx");
  const colors = await host.documentColors(document);

  t.equal(colors.length, 6, `expected the 6 A51 swatches, got ${colors.length}`);

  const expected = [
    { needle: "color: Red", token: "Red", rgba: { red: 1, green: 0, blue: 0, alpha: 1 } },
    { needle: "#fff", token: "#fff", rgba: { red: 1, green: 1, blue: 1, alpha: 1 } },
    { needle: "navy", token: "navy", rgba: { red: 0, green: 0, blue: 0.502, alpha: 1 } },
    {
      needle: "#2563eb80",
      token: "#2563eb80",
      rgba: { red: 0.1451, green: 0.3882, blue: 0.9216, alpha: 0.502 },
    },
    {
      needle: "--brand: #2563eb",
      token: "#2563eb",
      rgba: { red: 0.1451, green: 0.3882, blue: 0.9216, alpha: 1 },
    },
    { needle: "#000", token: "#000", rgba: { red: 0, green: 0, blue: 0, alpha: 1 } },
  ];

  for (const entry of expected) {
    const needleOffset = entry.needle.indexOf(entry.token);
    const swatch = swatchAt(colors, document, entry.needle, needleOffset, entry.token.length);
    t.ok(swatch.color, `no swatch covering ${entry.token}`);
    t.ok(closeTo(swatch.color.color.red, entry.rgba.red), `${entry.token}: red channel`);
    t.ok(closeTo(swatch.color.color.green, entry.rgba.green), `${entry.token}: green channel`);
    t.ok(closeTo(swatch.color.color.blue, entry.rgba.blue), `${entry.token}: blue channel`);
    t.ok(closeTo(swatch.color.color.alpha, entry.rgba.alpha), `${entry.token}: alpha channel`);
  }

  // Negatives recorded in the A51 report: no swatch on any of these offsets.
  const negatives = [
    { needle: "solid teal", delta: "solid ".length, label: "named colour in a border shorthand" },
    { needle: '"black"', delta: 1, label: "colour word in a string" },
    { needle: "$red;", delta: 1, label: "token reference" },
    { needle: "url(red.svg)", delta: "url(".length, label: "url() argument" },
    { needle: "100%", delta: 1, label: "percentage value" },
  ];
  for (const negative of negatives) {
    const position = host.positionOf(document, negative.needle, negative.delta);
    const hit = colors.find(
      (color) =>
        color.range.start.line === position.line &&
        position.character >= color.range.start.character &&
        position.character <= color.range.end.character,
    );
    t.equal(hit, undefined, `${negative.label} must not produce a swatch`);
  }

  // The picker's API half: a presentation rewrites exactly the authored range.
  const alpha = swatchAt(colors, document, "#2563eb80", 0, "#2563eb80".length);
  const alphaRange = new vscode.Range(alpha.start, alpha.end);
  const alphaPresentations = await host.colorPresentations(document, alpha.color.color, alphaRange);
  t.equal(alphaPresentations.length, 1, "one presentation per colour");
  t.equal(alphaPresentations[0].label, "#2563eb80", "alpha is preserved in the hex presentation");
  t.equal(
    alphaPresentations[0].label,
    alphaPresentations[0].label.toLowerCase(),
    "the presentation is lowercase",
  );
  t.deepEqual(
    {
      start: alphaPresentations[0].textEdit.range.start.character,
      end: alphaPresentations[0].textEdit.range.end.character,
    },
    { start: alphaRange.start.character, end: alphaRange.end.character },
    "the presentation replaces exactly the authored range",
  );

  const red = swatchAt(colors, document, "color: Red", "color: ".length, 3);
  const redRange = new vscode.Range(red.start, red.end);
  const redPresentations = await host.colorPresentations(document, red.color.color, redRange);
  t.equal(redPresentations[0].label, "#ff0000", "a named colour presents as lowercase hex");
  t.equal(
    redPresentations[0].textEdit.range.end.character -
      redPresentations[0].textEdit.range.start.character,
    3,
    "the named-colour presentation covers the whole authored word",
  );

  return `${colors.length} swatches (named + hex + alpha) + 5 negatives + 2 presentations`;
}

module.exports = { run };
