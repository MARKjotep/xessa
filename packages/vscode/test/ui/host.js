/**
 * Shared helpers for the in-extension-host UI scenarios (CSSX plan U1).
 *
 * Every helper is intentionally small and observable-only: assertions run on
 * provider results (completion items, hovers, colours, diagnostics, edits) and
 * on filesystem side effects, never on source text. Waiting is always bounded
 * polling against an observable host state — there is no fixed sleep used as
 * evidence.
 *
 * Plain CommonJS: this module is loaded by the extension host, not by Bun.
 */

const assert = require("node:assert");
const { mkdtemp, readdir, readFile, realpath, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

/** The launch folder handed to the host by `tests/extension/host.test.ts`. */
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures");
const DEFAULT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 50;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Assertion recorder.
 *
 * Every scenario gets the same instance so the runner can print one total. The
 * methods mirror `node:assert` but count, which keeps "how many assertions does
 * the host suite actually make" a measured number instead of an estimate.
 */
function createAsserter() {
  let count = 0;
  return {
    get count() {
      return count;
    },
    ok(value, message) {
      count += 1;
      assert.ok(value, message);
      return value;
    },
    equal(actual, expected, message) {
      count += 1;
      assert.strictEqual(actual, expected, message);
      return actual;
    },
    deepEqual(actual, expected, message) {
      count += 1;
      assert.deepStrictEqual(actual, expected, message);
      return actual;
    },
    match(value, pattern, message) {
      count += 1;
      assert.match(value, pattern, message);
      return value;
    },
    async rejects(promise, pattern, message) {
      count += 1;
      let error;
      try {
        await promise;
      } catch (caught) {
        error = caught;
      }
      assert.ok(error !== undefined, `${message}: expected the call to reject`);
      const text = String(error === undefined ? "" : error.message);
      if (pattern !== undefined) assert.match(text, pattern, message);
      return error;
    },
  };
}

/** URI of a fixture committed under `packages/vscode/test/fixtures/`. */
function fixtureUri(relative) {
  return vscode.Uri.file(path.join(FIXTURE_ROOT, relative));
}

/** Text of a fixture committed under `packages/vscode/test/fixtures/`. */
async function readFixture(relative) {
  return readFile(path.join(FIXTURE_ROOT, relative), "utf8");
}

/** Open (and reveal) a document; returns the document and its editor. */
async function openDocument(uri) {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  return { document, editor };
}

/** Open a committed fixture. */
async function openFixture(relative) {
  return openDocument(fixtureUri(relative));
}

/** Offset of the first `needle` in the document text, plus `delta`. */
function offsetOf(document, needle, delta = 0) {
  const index = document.getText().indexOf(needle);
  assert.ok(index >= 0, `document does not contain ${JSON.stringify(needle)}`);
  return index + delta;
}

/** Position of the first `needle` in the document text, plus `delta` characters. */
function positionOf(document, needle, delta = 0) {
  return document.positionAt(offsetOf(document, needle, delta));
}

/**
 * Bounded polling.
 *
 * Resolves with the first truthy predicate result. A falsy result (including
 * `undefined`, `false`, `0` and `""`) means "not yet"; arrays must be tested by
 * the predicate. Throws with the label when the deadline passes.
 */
async function waitFor(predicate, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    label = "condition",
  } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`[xessa host] timed out after ${timeoutMs} ms waiting for ${label}`);
    }
    await delay(intervalMs);
  }
}

/** Current diagnostics for a URI. */
function diagnosticsOf(uri) {
  return vscode.languages.getDiagnostics(uri);
}

/** Poll until the document publishes diagnostics, optionally with a given code. */
async function waitForDiagnostics(uri, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, code } = options;
  return waitFor(
    () => {
      const diagnostics = diagnosticsOf(uri);
      if (diagnostics.length === 0) return undefined;
      if (code !== undefined && !diagnostics.some((entry) => entry.code === code)) return undefined;
      return diagnostics;
    },
    { timeoutMs, label: `diagnostics for ${path.basename(uri.fsPath)}` },
  );
}

/**
 * Watch a document for `settleMs` and return whatever diagnostics appeared.
 *
 * The extension publishes on a 150 ms debounce (`service.ts`), so a clean
 * document is asserted by watching the whole window and confirming the set
 * stayed empty; there is no sleep standing in for an observation.
 */
async function settleDiagnostics(uri, settleMs = 1200) {
  const deadline = Date.now() + settleMs;
  let seen = [];
  while (Date.now() < deadline) {
    seen = diagnosticsOf(uri);
    if (seen.length > 0) return seen;
    await delay(POLL_INTERVAL_MS);
  }
  return seen;
}

/**
 * Temporary workspace root.
 *
 * `mkdtemp` under the OS temp directory, then `realpath`-resolved: on macOS
 * `/var` → `/private/var`, and the planner's symlink containment check needs
 * the canonical root (TT6 observation O2). Callers must `dispose()` in a
 * `finally`.
 */
async function createWorkspace(prefix = "xessa-ui-") {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const root = await realpath(created);
  const resolve = (relative) => path.join(root, relative);
  return {
    root,
    resolve,
    uri(relative) {
      return vscode.Uri.file(resolve(relative));
    },
    async write(relative, text) {
      await writeFile(resolve(relative), text, "utf8");
      return vscode.Uri.file(resolve(relative));
    },
    async read(relative) {
      return readFile(resolve(relative), "utf8");
    },
    async exists(relative) {
      try {
        await readFile(resolve(relative));
        return true;
      } catch {
        return false;
      }
    },
    /** Written and opened; returns the document and its editor. */
    async open(relative, text) {
      const uri = await this.write(relative, text);
      return openDocument(uri);
    },
    /** Sorted file names in the workspace root. */
    async entries() {
      const names = await readdir(root);
      return [...names].sort();
    },
    async dispose() {
      await rm(created, { recursive: true, force: true });
    },
  };
}

/** Completion items for one position, through the public command. */
async function completionItems(document, position, trigger) {
  const list = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    position,
    trigger,
  );
  if (list === undefined || list === null) return [];
  return list.items;
}

/** Bare label text of a completion item. */
function labelOf(item) {
  return typeof item.label === "string" ? item.label : item.label.label;
}

/** Label → item map for one completion list. */
function byLabel(items) {
  const map = new Map();
  for (const item of items) map.set(labelOf(item), item);
  return map;
}

/** `CompletionItemKind` histogram. */
function kindHistogram(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return counts;
}

/**
 * Plain text an item inserts.
 *
 * `executeCompletionItemProvider` returns the unresolved item, so a snippet
 * body is still a `SnippetString`; the acceptance emulation needs the text a
 * user would end up with, hence the placeholder strip.
 */
function insertTextOf(item) {
  const insert = item.insertText;
  if (insert === undefined || insert === null) return labelOf(item);
  if (typeof insert === "string") return insert;
  return String(insert.value)
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}

/** Replacement range of an item (an item may also carry an insert/replace pair). */
function rangeOf(item) {
  const range = item.range;
  if (range === undefined || range === null) return undefined;
  return range.start === undefined ? range.replacing : range;
}

/**
 * Apply a completion item's own range + text to the editor and return the new
 * document text. This is the API-level stand-in for accepting the item.
 */
async function applyCompletion(editor, item) {
  const range = rangeOf(item) ?? new vscode.Range(item.position ?? 0, 0, 0, 0);
  const text = insertTextOf(item);
  const applied = await editor.edit((builder) => builder.replace(range, text));
  assert.ok(applied, "editor rejected the completion edit");
  return editor.document.getText();
}

/** Hovers for one position, through the public command. */
async function hoversAt(document, position) {
  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    document.uri,
    position,
  );
  return hovers === undefined || hovers === null ? [] : hovers;
}

/** Markdown text of a hover (all `MarkdownString` contents joined). */
function hoverMarkdown(hover) {
  return hover.contents
    .map((content) => (typeof content === "string" ? content : String(content.value)))
    .join("\n");
}

/** Colour information for a document, through the public command. */
async function documentColors(document) {
  const colors = await vscode.commands.executeCommand(
    "vscode.executeDocumentColorProvider",
    document.uri,
  );
  return colors === undefined || colors === null ? [] : colors;
}

/** Colour presentations for a colour + range (the picker's API half). */
async function colorPresentations(document, color, range) {
  const presentations = await vscode.commands.executeCommand(
    "vscode.executeColorPresentationProvider",
    color,
    { uri: document.uri, range },
  );
  return presentations === undefined || presentations === null ? [] : presentations;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  FIXTURE_ROOT,
  applyCompletion,
  byLabel,
  colorPresentations,
  completionItems,
  createAsserter,
  createWorkspace,
  delay,
  diagnosticsOf,
  documentColors,
  fixtureUri,
  hoverMarkdown,
  hoversAt,
  insertTextOf,
  kindHistogram,
  labelOf,
  offsetOf,
  openDocument,
  openFixture,
  positionOf,
  rangeOf,
  readFixture,
  settleDiagnostics,
  waitFor,
  waitForDiagnostics,
};
