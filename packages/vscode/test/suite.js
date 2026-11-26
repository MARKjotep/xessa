/**
 * Extension-host suite runner (executed inside VS Code by @vscode/test-electron).
 *
 * Plain CommonJS so the extension host can load it without a build step, and
 * still the single `extensionTestsPath` entry `tests/extension/host.test.ts`
 * points at. The scenarios live in `test/ui/*.js`; each one exports `run(t)`
 * and returns a one-line summary. A scenario failure fails the host run with the
 * scenario name attached, so a red run always names its module.
 *
 * The orchestrating Bun test decides whether the host can run at all; this file
 * never fakes a pass when VS Code is unavailable.
 */

const { createAsserter } = require("./ui/host.js");

/** Scenarios, in execution order (baseline first: it owns the original cases). */
const SCENARIOS = [
  "baseline",
  "completions",
  "hovers",
  "diagnostics",
  "module-refresh",
  "colors",
  "semantic-tokens",
  "commands",
  "navigation",
  "quickfix",
  "checklist",
  "commands-matrix",
  "config",
  "accessibility",
  "performance",
];

exports.run = async function run() {
  const t = createAsserter();
  const summaries = [];
  for (const name of SCENARIOS) {
    // Loaded lazily so a syntax error names its module instead of failing import.
    const scenario = require(`./ui/${name}.js`);
    const before = t.count;
    const started = Date.now();
    let summary;
    try {
      summary = await scenario.run(t);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Assertion errors carry the compared values; print them so a red host
      // run names the offending item instead of only the assertion message.
      const compared =
        error !== undefined && error.actual !== undefined
          ? ` [actual: ${JSON.stringify(error.actual)} expected: ${JSON.stringify(error.expected)}]`
          : "";
      throw new Error(`[xessa host] scenario "${name}" failed: ${detail}${compared}`);
    }
    const elapsed = Date.now() - started;
    const assertions = t.count - before;
    summaries.push(`${name}=${assertions}`);
    console.log(`[xessa host] ${name}: ${summary} (${assertions} assertions, ${elapsed} ms)`);
  }
  console.log(
    `[xessa host] passed: ${SCENARIOS.length} scenarios, ${t.count} assertions [${summaries.join(", ")}]`,
  );
};
