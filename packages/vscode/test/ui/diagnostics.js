/**
 * Diagnostic scenarios — `vscode.languages.getDiagnostics` for the curated
 * broken fixtures: code family, `source`, severity and the exact span.
 *
 * The five fixtures cover XESSA1001/1002/1003/2001/3001; every code is asserted
 * with its own span so a shifted range is a failure, not a silent pass.
 */

const vscode = require("vscode");
const host = require("./host.js");

const CASES = [
  {
    fixture: "ui/broken-setup.cssx",
    code: "XESSA1001",
    span: { start: { line: 2, character: 2 }, end: { line: 2, character: 14 } },
    message: /Unknown @setup setting "nonsense"/,
  },
  {
    fixture: "ui/broken-semicolon.cssx",
    code: "XESSA1002",
    span: { start: { line: 4, character: 2 }, end: { line: 4, character: 12 } },
    message: /missing semicolon after a declaration/,
  },
  {
    fixture: "ui/broken-token.cssx",
    code: "XESSA2001",
    span: { start: { line: 4, character: 9 }, end: { line: 4, character: 17 } },
    message: /Undefined token "\$missing"/,
  },
  {
    fixture: "ui/broken-alias.cssx",
    code: "XESSA3001",
    span: { start: { line: 4, character: 14 }, end: { line: 4, character: 18 } },
    message: /Unknown media alias "@nope"/,
  },
  {
    fixture: "ui/broken-syntax.cssx",
    code: "XESSA1003",
    span: { start: { line: 4, character: 2 }, end: { line: 4, character: 26 } },
    message: /malformed value: unbalanced parentheses/,
  },
];

async function run(t) {
  for (const testCase of CASES) {
    const { document } = await host.openFixture(testCase.fixture);
    const diagnostics = await host.waitForDiagnostics(document.uri, { code: testCase.code });
    const match = diagnostics.find((diagnostic) => diagnostic.code === testCase.code);
    t.ok(match, `${testCase.fixture}: no ${testCase.code} diagnostic`);
    t.equal(match.source, "xessa", `${testCase.code}: source is the extension id`);
    t.equal(match.severity, vscode.DiagnosticSeverity.Error, `${testCase.code}: severity is Error`);
    t.deepEqual(
      {
        start: { line: match.range.start.line, character: match.range.start.character },
        end: { line: match.range.end.line, character: match.range.end.character },
      },
      testCase.span,
      `${testCase.code}: span`,
    );
    t.match(match.message, testCase.message, `${testCase.code}: message`);
    t.ok(
      diagnostics.every((diagnostic) => /^XESSA\d{4}$/.test(String(diagnostic.code))),
      `${testCase.fixture}: every diagnostic carries a XESSA#### code`,
    );
    t.equal(
      diagnostics.every((diagnostic) => diagnostic.source === "xessa"),
      true,
      `${testCase.fixture}: every diagnostic is attributed to the extension`,
    );
  }

  // A clean document must stay clean for the whole debounce window.
  const clean = await host.openFixture("ui/clean.cssx");
  const settled = await host.settleDiagnostics(clean.document.uri);
  t.equal(settled.length, 0, `clean.cssx published ${settled.length} diagnostic(s)`);

  return `${CASES.length} code families with exact spans + 1 clean document`;
}

module.exports = { run };
