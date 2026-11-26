/**
 * Workspace-state probe driver (U4).
 *
 * Two workspace states cannot be reached through `tests/extension/host.test.ts`:
 *
 *  1. **Restricted Mode.** `@vscode/test-electron@2.5.2` appends
 *     `--disable-workspace-trust` to every launch (measured in
 *     `node_modules/.bun/@vscode+test-electron@2.5.2/…/out/runTest.js:53`).
 *     That flag *disables the trust feature*, i.e. it makes every workspace
 *     trusted — the opposite of Restricted Mode. A window launched by this
 *     driver without the flag, on a fresh `mkdtemp` folder and a fresh profile,
 *     reports `workspace.isTrusted === false` (asserted in `restricted.js`).
 *  2. **Multi-root.** `workspace.updateWorkspaceFolders()` on a single-folder
 *     window converts it to multi-root but reloads the window; measured in this
 *     host, it re-runs the extension test suite. Launching the cached binary on
 *     a generated `.code-workspace` file is deterministic and reload-free.
 *
 * The driver spawns the **same cached VS Code build** with the same
 * `--extensionDevelopmentPath` / `--extensionTestsPath` mechanism the harness
 * uses, with its own temporary profile, and keys success on the
 * `[xessa probe] PASS <case>` marker printed by `probe-entry.js`. Nothing is
 * stubbed: if the window does not reach the state, the probe fails.
 *
 * Usage:
 *   bun packages/vscode/test/ui/workspace-probe.js --case restricted
 *   bun packages/vscode/test/ui/workspace-probe.js --case multi-root
 *   bun packages/vscode/test/ui/workspace-probe.js --all
 */

const { spawn } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { mkdir, mkdtemp, realpath, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MULTI_ROOT, RESTRICTED_FILES } = require("./workspace-fixtures.js");

const EXTENSION_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(EXTENSION_ROOT, "..", "..");
const CACHE_PATH = path.join(REPO_ROOT, "node_modules", ".vscode-test-xessa");
const PROBE_ENTRY = path.join(__dirname, "probe-entry.js");
const PROBE_TIMEOUT_MS = 180_000;

/** Launcher paths for a downloaded VS Code directory (1.147 renamed Electron → Code). */
function executableCandidates(directory) {
  return [
    path.join(directory, "Visual Studio Code.app", "Contents", "MacOS", "Electron"),
    path.join(directory, "Visual Studio Code.app", "Contents", "MacOS", "Code"),
    path.join(directory, "code"),
    path.join(directory, "Code.exe"),
    path.join(directory, "bin", "code-server"),
  ];
}

/** The cached build, resolved the way `tests/extension/host.test.ts` resolves it. */
function findCachedEditor() {
  if (!existsSync(CACHE_PATH)) return undefined;
  for (const entry of readdirSync(CACHE_PATH)) {
    const match = /^vscode-(?<platform>[a-z0-9-]+)-(?<version>[0-9.]+)$/.exec(entry);
    if (match?.groups === undefined) continue;
    const directory = path.join(CACHE_PATH, entry);
    const executable = executableCandidates(directory).find((candidate) => existsSync(candidate));
    if (executable !== undefined) {
      return { executable, version: match.groups.version ?? "stable" };
    }
  }
  return undefined;
}

async function writeTree(root, files) {
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
  }
}

/**
 * Prepare the workspace for a case; returns the launch argument and the temp
 * directory the driver removes afterwards.
 */
async function prepareWorkspace(testCase) {
  const created = await mkdtemp(path.join(os.tmpdir(), "xessa-ws-"));
  const root = await realpath(created);
  if (testCase === "restricted") {
    await writeTree(root, RESTRICTED_FILES);
    return { argument: root, root, created };
  }
  await writeTree(root, MULTI_ROOT.files);
  const workspaceFile = path.join(root, MULTI_ROOT.workspaceFile);
  await writeFile(workspaceFile, MULTI_ROOT.workspaceText, "utf8");
  return { argument: workspaceFile, root, created };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Launch the cached build for one case and return its output plus the verdict.
 *
 * The child is killed as soon as the suite prints its verdict (the test host
 * does not always exit by itself), and the profile/worktree are removed by the
 * caller. A missing verdict is a failure with the captured output attached.
 */
async function runCase(testCase, executable) {
  const workspace = await prepareWorkspace(testCase);
  // Keep the profile path short: VS Code puts its single-instance socket in
  // `<user-data-dir>/<version>-main.sock`, and a path over 103 characters fails
  // with `EINVAL` before any window opens (observed on macOS with a
  // descriptive prefix). `mkdtemp` only needs to be unique, not readable.
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), "xessa-p-")));
  const launchArgs = [
    workspace.argument,
    `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
    `--extensionTestsPath=${PROBE_ENTRY}`,
    `--user-data-dir=${path.join(profile, "u")}`,
    `--extensions-dir=${path.join(profile, "e")}`,
    "--disable-extensions",
    // Same sandbox/GPU flags `@vscode/test-electron` uses; without them the
    // dev window can stall on a GPU-sandbox prompt on some machines.
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-telemetry",
    "--disable-updates",
  ];
  // Restricted Mode is the state under test: the trust feature stays enabled
  // and the fresh profile/folder means nobody has trusted it. The multi-root
  // case is about scoping, so trust is explicitly disabled (which trusts the
  // window) to keep the two concerns apart.
  if (testCase !== "restricted") launchArgs.push("--disable-workspace-trust");

  console.log(
    `[xessa probe] launching ${testCase}: ${executable} ${launchArgs[0]} (profile ${profile})`,
  );
  const child = spawn(executable, launchArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XESSA_PROBE_CASE: testCase },
  });
  let output = "";
  let verdict;
  const debug = process.env.XESSA_PROBE_DEBUG === "1";
  if (debug) console.log(`[xessa probe] args ${JSON.stringify(launchArgs)}`);
  const finished = new Promise((resolve) => {
    const onData = (chunk) => {
      output += String(chunk);
      const pass = /\[xessa probe\] PASS (\S+) (\d+)/.exec(output);
      const fail = /\[xessa probe\] FAIL (\S+) (.*)/.exec(output);
      if (pass !== null && verdict === undefined) {
        verdict = { status: "PASS", assertions: Number(pass[2]) };
        setTimeout(resolve, 400);
      } else if (fail !== null && verdict === undefined) {
        verdict = { status: "FAIL", detail: fail[2] };
        setTimeout(resolve, 400);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      if (debug) console.log(`[xessa probe] spawn error ${error.message}`);
    });
    child.on("exit", (code) => {
      if (verdict === undefined) {
        verdict = { status: "FAIL", detail: `the probe host exited with code ${String(code)}` };
      }
      resolve();
    });
    setTimeout(() => {
      if (verdict === undefined) {
        verdict = { status: "FAIL", detail: `no verdict within ${PROBE_TIMEOUT_MS} ms` };
      }
      resolve();
    }, PROBE_TIMEOUT_MS);
  });

  try {
    await finished;
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child had already exited.
    }
    await delay(200);
    await rm(profile, { recursive: true, force: true });
    await rm(workspace.created, { recursive: true, force: true });
  }

  const all = output.split("\n");
  const lines = all.filter((line) => /\[xessa (probe|host|perf)\]/.test(line));
  console.log(lines.join("\n"));
  if (verdict.status !== "PASS") {
    // The verdict is missing, so the relevant evidence is whatever the host
    // printed before it died: show the tail verbatim (minus the agent-host
    // noise every dev window emits) instead of only matching lines.
    const tail = all
      .map((line) => line.trim())
      .filter(
        (line) => line !== "" && !/AgentHost|Extensions host|DevTools listening|Gtk/.test(line),
      )
      .slice(-40);
    console.log(`[xessa probe] ${testCase}: raw host output tail`);
    console.log(tail.join("\n"));
  }
  return { ...verdict, workspace: workspace.root };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const requested = arguments_.includes("--all")
    ? ["restricted", "multi-root"]
    : [arguments_[arguments_.indexOf("--case") + 1]].filter(Boolean);
  if (requested.length === 0) {
    console.error(
      "usage: bun packages/vscode/test/ui/workspace-probe.js --case <restricted|multi-root> | --all",
    );
    process.exit(2);
  }
  const cached = findCachedEditor();
  if (cached === undefined) {
    console.error(
      `[xessa probe] no cached VS Code build in ${CACHE_PATH}; run "XESSA_EXTENSION_HOST_DOWNLOAD=1 bun test tests/extension/host.test.ts" once`,
    );
    process.exit(2);
  }
  let failures = 0;
  for (const testCase of requested) {
    const result = await runCase(testCase, cached.executable);
    if (result.status === "PASS") {
      console.log(`[xessa probe] ${testCase}: PASS (${result.assertions} assertions)`);
    } else {
      failures += 1;
      console.log(`[xessa probe] ${testCase}: FAIL — ${result.detail}`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
