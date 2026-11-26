/**
 * CDP driver for rendered-UI inspection (CSSX plan U3).
 *
 * Launches the **cached** VS Code build directly (not through
 * `tests/extension/host.test.ts`, which stays read-only), attaches to the
 * workbench renderer over the Chrome DevTools Protocol and drives it with
 * `Input`/`Runtime`/`DOM`/`Page`/`Accessibility` only. No dependency is added:
 * the WebSocket is the runtime's built-in one (Bun and Node ≥ 22 both expose
 * `WebSocket`), and the DevTools endpoint is plain HTTP + JSON.
 *
 * Design notes:
 * - The profile is its own `mkdtemp` tree, never the `@vscode/test-electron`
 *   `user-data`/`extensions` directories. `--extensions-dir` gets a symlink to
 *   the extension so the dev host loads exactly what the test host loads.
 * - `--remote-debugging-port=0` lets Chromium pick the port; the chosen one is
 *   read from `<user-data-dir>/DevToolsActivePort`, so two runs never collide.
 * - Every wait is a bounded poll on an observable (the port file, `.monaco-workbench`,
 *   `.suggest-widget.visible`), never a fixed sleep.
 * - `dispose()` kills the process tree and removes the profile; it is also
 *   wired to `SIGINT`/`SIGTERM`/`exit` so a crash cannot leak a VS Code window.
 *
 * Plain CommonJS, no `vscode` import — this module runs outside the host.
 */

const { spawn } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

/** `packages/vscode` — the extension under inspection. */
const EXTENSION_ROOT = path.resolve(__dirname, "..", "..");
/** Repository root (four levels up from `packages/vscode/test/ui`). */
const REPO_ROOT = path.resolve(EXTENSION_ROOT, "..", "..");
/** The cache `tests/extension/host.test.ts` resolves (kept under node_modules). */
const CACHE_PATH = path.join(REPO_ROOT, "node_modules", ".vscode-test-xessa");

const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 100;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Bounded polling; throws with the label when the deadline passes. */
async function waitFor(
  predicate,
  { timeoutMs = 60_000, intervalMs = POLL_INTERVAL_MS, label } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(
        `[xessa cdp] timed out after ${timeoutMs} ms waiting for ${label ?? "condition"}`,
      );
    }
    await delay(intervalMs);
  }
}

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

/**
 * The cached VS Code build, resolved the way the host orchestrator resolves it.
 *
 * Returns `undefined` when the cache is absent — the caller records "visual
 * inspection unavailable: no cached build", never a fake screenshot.
 */
function findCachedEditor() {
  if (!existsSync(CACHE_PATH)) return undefined;
  const pattern = /^vscode-(?<platform>[a-z0-9-]+)-(?<version>[0-9.]+)$/;
  for (const entry of readdirSync(CACHE_PATH)) {
    const match = pattern.exec(entry);
    if (match?.groups === undefined) continue;
    const directory = path.join(CACHE_PATH, entry);
    const executable = executableCandidates(directory).find((candidate) => existsSync(candidate));
    if (executable !== undefined) {
      return {
        executable,
        version: match.groups.version ?? "stable",
        directory: path.basename(directory),
      };
    }
  }
  return undefined;
}

/**
 * Isolated launch profile: user data, extensions dir (with the extension
 * symlinked in) and a workspace folder with a copy of the UI fixtures.
 */
async function createProfile({ prefix = "xessa-cdp-", fixtures, seed = {} } = {}) {
  const created = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const userDataDir = path.join(created, "user-data");
  const extensionsDir = path.join(created, "extensions");
  const workspaceDir = path.join(created, "workspace");
  await mkdir(userDataDir, { recursive: true });
  await mkdir(extensionsDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await symlink(EXTENSION_ROOT, path.join(extensionsDir, "xessa"), "dir");
  if (fixtures !== undefined && existsSync(fixtures)) {
    for (const name of readdirSync(fixtures)) {
      if (!name.endsWith(".cssx")) continue;
      await writeFile(
        path.join(workspaceDir, name),
        await readFile(path.join(fixtures, name), "utf8"),
        "utf8",
      );
    }
  }
  for (const [name, text] of Object.entries(seed)) {
    await writeFile(path.join(workspaceDir, name), text, "utf8");
  }
  return {
    root: created,
    userDataDir,
    extensionsDir,
    workspaceDir,
    resolve: (name) => path.join(workspaceDir, name),
    async dispose() {
      await rm(created, { recursive: true, force: true });
    },
  };
}

/** Read `<user-data-dir>/DevToolsActivePort` (port on line 1, browser path on line 2). */
async function readDevToolsPort(userDataDir, { timeoutMs = 60_000 } = {}) {
  const file = path.join(userDataDir, "DevToolsActivePort");
  return waitFor(
    async () => {
      try {
        const [port, browserPath] = (await readFile(file, "utf8")).split("\n");
        const parsed = Number.parseInt(port ?? "", 10);
        if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
        return { port: parsed, browserPath: (browserPath ?? "").trim() };
      } catch {
        return undefined;
      }
    },
    { timeoutMs, label: `DevToolsActivePort in ${file}` },
  );
}

/**
 * Launch the cached VS Code with a dev-host extension and a debugging port.
 *
 * `--disable-extensions` keeps other host extensions out (the test host uses
 * the same flag), `--disable-workspace-trust` keeps a trust prompt from
 * blocking the renderer, and `--remote-allow-origins=*` satisfies Chromium's
 * origin check for non-browser WebSocket clients.
 */
async function launchEditor({
  profile,
  executable,
  extraArgs = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const args = [
    profile.workspaceDir,
    `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
    `--user-data-dir=${profile.userDataDir}`,
    `--extensions-dir=${profile.extensionsDir}`,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-telemetry",
    "--disable-updates",
    "--new-window",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    ...extraArgs,
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  const record = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim() === "") continue;
      output.push(line);
      if (output.length > 400) output.shift();
    }
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  const { port, browserPath } = await readDevToolsPort(profile.userDataDir, { timeoutMs });
  const browserUrl = `ws://127.0.0.1:${port}${browserPath === "" ? "" : browserPath}`;
  return {
    child,
    port,
    browserUrl,
    args,
    output,
    exited,
    async dispose() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await Promise.race([exited, delay(5000)]);
      }
    },
  };
}

/** Minimal CDP client over the runtime's built-in WebSocket. */
class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const entry of this.pending.values()) {
        entry.reject(new Error("[xessa cdp] socket closed before the reply arrived"));
      }
      this.pending.clear();
    });
  }

  static async connect(url, { timeoutMs = 30_000 } = {}) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`[xessa cdp] timed out connecting to ${url}`)),
        timeoutMs,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`[xessa cdp] websocket error for ${url}: ${event?.message ?? "unknown"}`));
      });
    });
    return new CdpClient(socket);
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        reject(new Error(`[xessa cdp] ${message.error.message ?? JSON.stringify(message.error)}`));
      } else {
        resolve(message.result ?? {});
      }
      return;
    }
    if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    }
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  send(method, params = {}, { timeoutMs = 60_000 } = {}) {
    if (this.closed) return Promise.reject(new Error("[xessa cdp] socket is closed"));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[xessa cdp] timed out after ${timeoutMs} ms on ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the renderer and return its value. */
  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(
        `[xessa cdp] evaluate failed: ${
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        }`,
      );
    }
    return result.result?.value;
  }

  /** Poll an expression until it is truthy. */
  async waitForExpression(expression, options = {}) {
    return waitFor(async () => {
      try {
        const value = await this.evaluate(expression);
        return value ? value : undefined;
      } catch {
        return undefined;
      }
    }, options);
  }

  /** Type text into the focused widget (a user gesture, so suggest opens). */
  async insertText(text) {
    await this.send("Input.insertText", { text });
  }

  /**
   * Dispatch a key chord. `modifiers` uses the CDP bitmask (Alt 1, Ctrl 2,
   * Meta/Command 4, Shift 8); VS Code resolves its keybindings from the
   * resulting DOM keydown, so this is a real key press as far as the workbench
   * is concerned.
   */
  async pressKey({ key, code, windowsVirtualKeyCode, modifiers = 0 }) {
    const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: 0, modifiers };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    // A `char` event would type the character; a modified chord is a command,
    // not text, so only a plain one-character press gets the extra event.
    if (typeof key === "string" && key.length === 1 && modifiers === 0) {
      await this.send("Input.dispatchKeyEvent", { type: "char", ...base, text: key });
    }
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Mouse move + click at viewport coordinates. */
  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  /** `Page.captureScreenshot` → PNG buffer. */
  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  }

  /** Full accessibility tree (U6's input). */
  async accessibilityTree() {
    const tree = await this.send("Accessibility.getFullAXTree");
    return tree.nodes ?? [];
  }

  close() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // A socket that is already gone needs no cleanup.
    }
  }
}

/** Dimensions of a PNG buffer (width/height live at bytes 16..24). */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** The workbench page target from the DevTools HTTP endpoint. */
async function findPageTarget(port, { timeoutMs = 60_000 } = {}) {
  return waitFor(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && String(target.url).includes("workbench"),
        );
        if (page?.webSocketDebuggerUrl !== undefined) return page;
        const anyPage = targets.find((target) => target.type === "page");
        return anyPage?.webSocketDebuggerUrl === undefined ? undefined : anyPage;
      } catch {
        return undefined;
      }
    },
    { timeoutMs, label: `a workbench page target on port ${port}` },
  );
}

/**
 * Launch + attach in one call.
 *
 * Returns `{ editor, client, profile, screenshots, dispose }`; callers must
 * `dispose()` in a `finally`. Installing the process/signal handlers is the
 * caller's choice (`installCleanup` below) so a library user can decide.
 */
async function openWorkbench({ extraArgs = [], timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cached = findCachedEditor();
  if (cached === undefined) {
    throw new Error(
      `[xessa cdp] no cached VS Code build in ${CACHE_PATH}; run "XESSA_EXTENSION_HOST_DOWNLOAD=1 bun test tests/extension/host.test.ts" once`,
    );
  }
  const profile = await createProfile({
    fixtures: path.join(__dirname, "..", "fixtures", "ui"),
    // A scratch document the capture driver types into; real fixture files are
    // only opened, never edited, so the shots stay reproducible.
    seed: { "scratch.cssx": ".card {\n  color: red;\n}\n" },
  });
  let editor;
  let client;
  try {
    editor = await launchEditor({
      profile,
      executable: cached.executable,
      extraArgs,
      timeoutMs,
    });
    const target = await findPageTarget(editor.port, { timeoutMs });
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("DOM.enable");
    await client.send("Accessibility.enable");
    return {
      version: cached.version,
      executable: cached.executable,
      profile,
      editor,
      client,
      async dispose() {
        try {
          client?.close();
        } finally {
          await editor?.dispose();
          // A profile directory the killed child was still writing to can be
          // briefly busy (observed once); retry, then report instead of
          // throwing out of a cleanup path.
          try {
            await profile.dispose();
          } catch (error) {
            await delay(300);
            await profile.dispose().catch((retryError) => {
              console.error(
                `[xessa cdp] could not remove the profile ${profile.root}: ${
                  retryError instanceof Error ? retryError.message : String(retryError)
                }`,
              );
              return undefined;
            });
            if (error instanceof Error) {
              // The retry already decided the outcome; nothing to rethrow.
            }
          }
        }
      },
    };
  } catch (error) {
    client?.close();
    await editor?.dispose();
    await profile.dispose();
    throw error;
  }
}

/** Kill the launched editor if the process dies or the user interrupts the run. */
function installCleanup(handle) {
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      handle.client?.close();
      handle.editor?.child?.kill("SIGKILL");
      await handle.profile?.dispose();
    } catch {
      // Cleanup runs on crash paths; a failure here must not mask the cause.
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      void cleanup().then(() => process.exit(130));
    });
  }
  process.once("exit", () => {
    if (cleaned) return;
    try {
      handle.editor?.child?.kill("SIGKILL");
    } catch {
      // Best effort only: `exit` cannot await anything.
    }
  });
  return cleanup;
}

module.exports = {
  CACHE_PATH,
  CdpClient,
  EXTENSION_ROOT,
  REPO_ROOT,
  delay,
  findCachedEditor,
  findPageTarget,
  installCleanup,
  launchEditor,
  openWorkbench,
  pngSize,
  readDevToolsPort,
  waitFor,
};
