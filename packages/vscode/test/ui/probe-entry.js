/**
 * Probe entry point (extensionTestsPath) for the workspace-state probes.
 *
 * `@vscode/test-electron` always passes `--disable-workspace-trust`, which
 * *disables* the workspace-trust feature, so the guest host is trusted by
 * construction and Restricted Mode is unreachable through
 * `tests/extension/host.test.ts`. `workspace-probe.js` therefore launches the
 * same cached VS Code binary directly (like the U3 CDP driver) with the same
 * `--extensionTestsPath` mechanism and its own profile, and this module is the
 * suite that runs inside that window.
 *
 * The case to run is chosen with `XESSA_PROBE_CASE`; a final
 * `[xessa probe] PASS|FAIL` marker is what the driver keys on, so a probe run
 * can never be recorded as a pass without that line.
 */

const { createAsserter } = require("./host.js");

exports.run = async function run() {
  const name = process.env.XESSA_PROBE_CASE;
  if (name === undefined || name === "") {
    throw new Error("[xessa probe] XESSA_PROBE_CASE is not set");
  }
  const t = createAsserter();
  const started = Date.now();
  console.log(
    `[xessa probe] start case=${name} trusted=${require("vscode").workspace.isTrusted} vscode=${
      require("vscode").version
    }`,
  );
  try {
    const summary = await require(`./${name}.js`).run(t);
    console.log(
      `[xessa probe] ${name}: ${summary} (${t.count} assertions, ${Date.now() - started} ms)`,
    );
    console.log(`[xessa probe] PASS ${name} ${t.count}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`[xessa probe] FAIL ${name} ${detail}`);
    throw error;
  }
};
