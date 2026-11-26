#!/usr/bin/env bun
/**
 * Rendered-UI capture driver (CSSX plan U3).
 *
 * Launches the cached VS Code build with the Xessa dev extension, attaches over
 * CDP (`./cdp.js`) and photographs the surfaces no `vscode` API exposes: the
 * suggest widget per trigger context, a hover card, a diagnostic squiggle, the
 * status bar item, the output channel and the grammar's token colours — plus a
 * full accessibility-tree snapshot for U6.
 *
 * Usage:
 *   bun packages/vscode/test/ui/capture.js --all
 *   bun packages/vscode/test/ui/capture.js --screen suggest-hash --screen hover
 *   bun packages/vscode/test/ui/capture.js --all --out .ai/reports/logs/ui-screens
 *
 * Every screen waits on a DOM condition (bounded poll) before
 * `Page.captureScreenshot`; there is no sleep standing in for evidence. The
 * PNGs and the JSON evidence go to `--out` (default
 * `.ai/reports/logs/ui-screens/`), which is a report-log area. If the launch or
 * the attach fails, the driver prints the exact stage and exits non-zero — it
 * never writes a placeholder image.
 */

const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const cdp = require("./cdp.js");

const DEFAULT_OUT = path.join(cdp.REPO_ROOT, ".ai", "reports", "logs", "ui-screens");

const META = 4; // Cmd
const CTRL = 2;
const SHIFT = 8;

const KEYS = {
  a: { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
  p: { key: "p", code: "KeyP", windowsVirtualKeyCode: 80 },
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
};

/* ------------------------------------------------------------------ *
 * Workbench driving helpers
 * ------------------------------------------------------------------ */

/** The quick input (palette / quick open / quick pick) is rendered. */
async function waitForQuickInputOpen(client, { timeoutMs = 20000 } = {}) {
  return client.waitForExpression(
    `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || widget.offsetParent === null) return null;
      return widget.getBoundingClientRect().height > 0 ? true : null;
    })()`,
    { timeoutMs, label: "the quick input to open" },
  );
}

/** The quick input lists at least one row. */
async function waitForQuickInputRows(client, { timeoutMs = 20000 } = {}) {
  return client.waitForExpression(
    `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || widget.offsetParent === null) return null;
      const rows = [...widget.querySelectorAll('.monaco-list-row')];
      return rows.length > 0 ? rows.length : null;
    })()`,
    { timeoutMs, label: "the quick input to list rows" },
  );
}

/** The quick input is gone (hidden or removed). */
async function waitForQuickInputClosed(client, { timeoutMs = 20000 } = {}) {
  return client.waitForExpression(
    `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || widget.offsetParent === null) return true;
      return widget.getBoundingClientRect().height === 0 ? true : null;
    })()`,
    { timeoutMs, label: "the quick input to close" },
  );
}

/**
 * Type into the quick input's own text field.
 *
 * Two traps measured here:
 * 1. `Input.insertText` goes to whatever holds DOM focus, and the quick input
 *    takes focus asynchronously after it opens — typing too early lands in the
 *    editor and leaves the picker unfiltered (the first capture attempt failed
 *    exactly that way).
 * 2. The command palette's field carries a `>` mode prefix, so select-all +
 *    replace destroys the prefix and the palette answers "No matching results"
 *    for a title that exists. Text is therefore *appended* and the result is
 *    verified as a suffix.
 */
async function typeIntoQuickInput(client, text) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = await client.evaluate(`(() => {
      const input = document.querySelector('.quick-input-widget input');
      if (!input) return null;
      input.focus();
      return input.value;
    })()`);
    if (value === null) {
      await cdp.delay(150);
      continue;
    }
    if (value.endsWith(text)) return;
    await client.insertText(text);
    const received = await client
      .waitForExpression(
        `(() => {
          const input = document.querySelector('.quick-input-widget input');
          if (input === null || !input.value.endsWith(${JSON.stringify(text)})) return null;
          return input.value;
        })()`,
        { timeoutMs: 3000, label: "the quick input to hold the typed text" },
      )
      .catch(() => undefined);
    if (received !== undefined) return;
    await cdp.delay(150);
  }
  const value = await client.evaluate(
    "document.querySelector('.quick-input-widget input')?.value ?? null",
  );
  throw new Error(
    `[xessa cdp] the quick input never received ${JSON.stringify(text)} (field value: ${JSON.stringify(value)})`,
  );
}

/** Wait until the quick input lists a row whose title starts with `prefix`. */
async function waitForQuickInputRow(client, prefix, { timeoutMs = 20000 } = {}) {
  return client.waitForExpression(
    `(() => {
      const rows = [...document.querySelectorAll('.quick-input-widget .monaco-list-row')];
      const row = rows.find((candidate) => candidate.textContent.trim().startsWith(${JSON.stringify(prefix)}));
      return row === undefined ? null : row.textContent.trim().slice(0, 160);
    })()`,
    { timeoutMs, label: `a quick-input row starting with ${JSON.stringify(prefix)}` },
  );
}

/** Visible row titles of the quick input. */
async function quickInputRows(client) {
  return client.evaluate(`(() => {
    const widget = document.querySelector('.quick-input-widget');
    if (!widget) return [];
    return [...widget.querySelectorAll('.monaco-list-row')].map((row) => row.textContent.trim().slice(0, 160));
  })()`);
}

/**
 * Accept the quick-input row whose title starts with `title`.
 *
 * Clicking the exact row is deliberate: the palette's fuzzy ranking is not
 * deterministic enough to rely on Enter (`toggle primary` ranked
 * "…Side Bar Position" above "…Side Bar Visibility" in a probe), and a wrong
 * command would silently photograph the wrong surface.
 */
async function acceptQuickInputRow(client, title) {
  const target = await client.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.quick-input-widget .monaco-list-row')];
    const row = rows.find((candidate) => candidate.textContent.trim().startsWith(${JSON.stringify(title)}));
    if (!row) return null;
    const box = row.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: row.textContent.trim().slice(0, 160) };
  })()`);
  if (target === null) return undefined;
  await client.clickAt(target.x, target.y);
  return target.text;
}

/** Run a command palette entry by its exact title. */
async function runCommand(client, title) {
  await client.pressKey({ ...KEYS.p, modifiers: META | SHIFT });
  await waitForQuickInputRows(client);
  await typeIntoQuickInput(client, title);
  await waitForQuickInputRow(client, title).catch(async () => {
    const visible = await quickInputRows(client);
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] command palette has no entry titled ${JSON.stringify(title)}; visible: ${JSON.stringify(visible)}`,
    );
  });
  const accepted = await acceptQuickInputRow(client, title);
  if (accepted === undefined) {
    const visible = await quickInputRows(client);
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] command palette has no row to click for ${JSON.stringify(title)}; visible: ${JSON.stringify(visible)}`,
    );
  }
  await waitForQuickInputClosed(client);
  await cdp.delay(120);
  return accepted;
}

/**
 * Run a command that itself opens a quick pick (e.g. "Output: Show Output
 * Channels"). Such a command hands the *same* `.quick-input-widget` element to
 * the follow-up list, so `runCommand`'s "the widget closed" wait would never be
 * satisfied — the proof that the command ran is the new row set instead.
 */
async function runCommandOpeningPicker(client, title) {
  await client.pressKey({ ...KEYS.p, modifiers: META | SHIFT });
  await waitForQuickInputRows(client);
  await typeIntoQuickInput(client, title);
  await waitForQuickInputRow(client, title);
  const accepted = await acceptQuickInputRow(client, title);
  if (accepted === undefined) {
    const visible = await quickInputRows(client);
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] command palette has no entry titled ${JSON.stringify(title)}; visible: ${JSON.stringify(visible)}`,
    );
  }
  await cdp.delay(200);
  return waitForQuickInputRows(client);
}

/** Open a workspace file through Quick Open. */
async function openFile(client, name) {
  await client.pressKey({ ...KEYS.p, modifiers: META });
  await waitForQuickInputOpen(client);
  await typeIntoQuickInput(client, name);
  // Quick Open first lists "recently opened"; the searched row arrives when the
  // file-name search resolves, so wait for the row itself, not merely a list.
  await waitForQuickInputRow(client, name).catch(async (error) => {
    const visible = await quickInputRows(client);
    const value = await client.evaluate(
      "document.querySelector('.quick-input-widget input')?.value ?? null",
    );
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] quick open has no entry ${JSON.stringify(name)} (${
        error instanceof Error ? error.message : String(error)
      }); field value: ${JSON.stringify(value)}; visible: ${JSON.stringify(visible)}`,
    );
  });
  const accepted = await acceptQuickInputRow(client, name);
  if (accepted === undefined) {
    const visible = await quickInputRows(client);
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] quick open row for ${JSON.stringify(name)} is not clickable; visible: ${JSON.stringify(visible)}`,
    );
  }
  await waitForQuickInputClosed(client);
  await client.waitForExpression(
    `[...document.querySelectorAll('.tabs-container .tab')].some((tab) =>
       tab.textContent.includes(${JSON.stringify(name)}))`,
    { timeoutMs: 20000, label: `${name} to become the active editor` },
  );
  await client.waitForExpression("Boolean(document.querySelector('.monaco-editor .view-lines'))", {
    timeoutMs: 20000,
    label: "the editor view lines",
  });
}

/** Put the keyboard focus inside the editor text area. */
async function focusEditor(client) {
  const rect = await client.evaluate(`(() => {
    const editor = document.querySelector('.editor-instance .monaco-editor, .monaco-editor');
    if (!editor) return null;
    const box = editor.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return { x: box.left + Math.min(240, box.width / 2), y: box.top + Math.min(120, box.height / 2) };
  })()`);
  if (rect === null) throw new Error("[xessa cdp] no editor is rendered, cannot focus it");
  await client.clickAt(rect.x, rect.y);
  await cdp.delay(100);
}

/**
 * Replace the editor content and leave the caret at the end.
 *
 * `Input.insertText` is used for the content (one input event, so the editor
 * does not run auto-indent per line), after a real Cmd+A selection.
 */
async function typeDocument(client, text) {
  await focusEditor(client);
  await client.pressKey({ ...KEYS.a, modifiers: META });
  await client.insertText(text);
  await cdp.delay(150);
}

/** Open the suggest widget with Ctrl+Space and wait for its rows. */
async function triggerSuggest(client) {
  await client.pressKey({ ...KEYS.space, modifiers: CTRL });
  const evidence = await client.waitForExpression(
    `(() => {
      const widget = document.querySelector('.suggest-widget.visible');
      if (!widget) return null;
      const rows = [...widget.querySelectorAll('.monaco-list-row')];
      if (rows.length === 0) return null;
      const details = widget.querySelector('.suggest-details');
      const kindOf = (row) => (row.querySelector('.codicon')?.className ?? '').replace('codicon codicon-', '');
      return {
        rows: rows.length,
        labels: rows.slice(0, 8).map((row) => (row.querySelector('.label-name')?.textContent ?? row.textContent).trim()),
        details: rows.slice(0, 8).map((row) => kindOf(row)),
        detailsPanel: details === null ? null : details.textContent.trim().slice(0, 120),
        documentationsReadable:
          details !== null && (details.getBoundingClientRect().height > 0 && details.textContent.trim().length > 0),
      };
    })()`,
    { timeoutMs: 15000, label: "the suggest widget to list rows" },
  );
  return evidence;
}

/** Close any open suggest widget / hover so the next screen starts clean. */
async function dismissPopups(client) {
  await client.pressKey(KEYS.escape);
  await cdp.delay(120);
}

/** CSS-pixel rect of the first element matching `selector` (optionally with text). */
async function rectOf(client, selector, contains) {
  return client.evaluate(`(() => {
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const element = ${contains === undefined ? "elements[0]" : `elements.find((candidate) => candidate.textContent.includes(${JSON.stringify(contains)}))`};
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height, text: element.textContent.trim().slice(0, 200) };
  })()`);
}

/**
 * Close every visible notification toast.
 *
 * `--disable-extensions` raises an "extensions are temporarily disabled" toast
 * and a signed-out profile can raise an authentication one; both float over the
 * status bar / output shots. Clicking each toast's own close icon is the same
 * gesture a user makes, and it keeps the pixel evidence uncluttered.
 */
async function dismissToasts(client) {
  const closerPoints = () => `(() => {
    const closers = [];
    for (const toast of document.querySelectorAll('.notification-toast')) {
      // The dismiss control is a codicon button whose class differs per
      // notification kind, and VS Code only renders it while the toast is
      // hovered — so a mouse move over the toast precedes this query.
      const button = toast.querySelector(
        '[class*="codicon-close"], .codicon-notifications-clear, [aria-label*="Close"]',
      );
      if (button === null) continue;
      const box = button.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      closers.push({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    }
    return closers;
  })()`;
  const clickAll = async () => {
    const points = await client.evaluate(closerPoints());
    for (const point of points) await client.clickAt(point.x, point.y);
    if (points.length > 0) await cdp.delay(160);
    return points.length;
  };

  let dismissed = await clickAll();
  const boxes =
    await client.evaluate(`[...document.querySelectorAll('.notification-toast')].map((toast) => {
    const box = toast.getBoundingClientRect();
    return { right: box.right, top: box.top, width: box.width, height: box.height };
  })`);
  if (boxes.length > 0) {
    // Hover each toast so its close control exists, then click it.
    for (const box of boxes) {
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.max(0, box.right - 14),
        y: Math.max(0, box.top + 14),
        button: "none",
      });
    }
    await cdp.delay(200);
    dismissed += await clickAll();
  }
  const remaining = await client.evaluate(
    "document.querySelectorAll('.notification-toast').length",
  );
  return { dismissed, remaining };
}

/** Screenshot the whole window. */
async function capture(client, outDir, name) {
  const toasts = await dismissToasts(client);
  const png = await client.screenshot();
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, png);
  return { file, ...cdp.pngSize(png), toasts };
}

/** Screenshot one region (CSS pixels + padding), clipped to the viewport. */
async function captureRegion(client, outDir, name, rect) {
  await dismissToasts(client);
  const viewport = await client.evaluate(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  const pad = 12;
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.min(viewport.width, Math.ceil(rect.width + pad * 2)),
    height: Math.min(viewport.height, Math.ceil(rect.height + pad * 2)),
    scale: 1,
  };
  clip.width = Math.min(clip.width, viewport.width - clip.x);
  clip.height = Math.min(clip.height, viewport.height - clip.y);
  const { data } = await client.send("Page.captureScreenshot", { format: "png", clip });
  const png = Buffer.from(data, "base64");
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, png);
  return { file, ...cdp.pngSize(png), clip };
}

/* ------------------------------------------------------------------ *
 * Screens
 * ------------------------------------------------------------------ */

const SETUP = '@setup { prefix: "ui"; }\n@variables {\n  brand: #2563eb;\n  gap: 4px;\n}\n';

/** Suggest widget states. Each entry: { name, text, note }. */
const SUGGEST_SCREENS = [
  {
    name: "suggest-at",
    text: "@",
    note: "`@` at the top level: directives + media aliases",
  },
  {
    name: "suggest-token",
    text: `${SETUP}.card {\n  color: $`,
    note: "`$` in a value: compile/runtime tokens",
  },
  {
    name: "suggest-paren",
    text: ".card {\n  width: (",
    note: "`(` call opener: the 25 curated CSS functions only",
  },
  {
    name: "suggest-hash",
    text: ".card {\n  color: #f0",
    note: "`#` colour literal: narrowed palette",
  },
  {
    name: "suggest-color-values",
    text: ".card {\n  color: ",
    note: "`color: ` value list: 148 named + 35 hex colours as kind Color",
  },
  {
    name: "suggest-amp-colon",
    text: `${SETUP}.badge {\n  &:`,
    note: "`&:` pseudo-class starters",
  },
  {
    name: "suggest-amp-dot",
    text: `${SETUP}.badge {\n  &.`,
    note: "`&.` nested class starters",
  },
];

async function screenSuggest(ctx, screen) {
  const { client, outDir } = ctx;
  await openFile(client, "scratch.cssx");
  await typeDocument(client, screen.text);
  const evidence = await triggerSuggest(client);
  const shot = await capture(client, outDir, screen.name);
  await dismissPopups(client);
  return { ...shot, note: screen.note, dom: evidence };
}

/** Token rect inside the rendered view lines — the anchor for a hover. */
async function tokenRect(client, token) {
  return client.evaluate(`(() => {
    const needle = ${JSON.stringify(token)};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || !node.parentElement.closest('.view-lines')) continue;
      const index = node.textContent.indexOf(needle);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const box = range.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
    }
    return null;
  })()`);
}

async function screenHover(ctx) {
  const { client, outDir } = ctx;
  await openFile(client, "scratch.cssx");
  await typeDocument(client, `${SETUP}.card {\n  color: $brand;\n  width: calc(100% - 2rem);\n}\n`);
  const anchor = await tokenRect(client, "calc");
  if (anchor === null) throw new Error("[xessa cdp] could not locate the `calc` token in the DOM");
  // A real mouse move is the user gesture that opens the hover card.
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: anchor.x,
    y: anchor.y,
    button: "none",
  });
  const dom = await client.waitForExpression(
    `(() => {
      const hovers = [...document.querySelectorAll('.monaco-hover')];
      const hover = hovers.find((candidate) => candidate.getBoundingClientRect().height > 0);
      if (!hover) return null;
      const content = hover.querySelector('.monaco-hover-content');
      const text = (content ?? hover).textContent.trim();
      return { text: text.slice(0, 240), length: text.length, hasCodeSpan: hover.querySelector('code') !== null };
    })()`,
    { timeoutMs: 15000, label: "the hover card to render" },
  );
  const shot = await capture(client, outDir, "hover-calc");
  await dismissPopups(client);
  return { ...shot, note: "hover card on `calc` (Markdown + code span)", dom };
}

async function screenHoverToken(ctx) {
  const { client, outDir } = ctx;
  await openFile(client, "scratch.cssx");
  await typeDocument(client, `${SETUP}.card {\n  color: $brand;\n}\n`);
  const anchor = await tokenRect(client, "$brand");
  if (anchor === null)
    throw new Error("[xessa cdp] could not locate the `$brand` token in the DOM");
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: anchor.x,
    y: anchor.y,
    button: "none",
  });
  const dom = await client.waitForExpression(
    `(() => {
      const hovers = [...document.querySelectorAll('.monaco-hover')];
      const hover = hovers.find((candidate) => candidate.getBoundingClientRect().height > 0);
      if (!hover) return null;
      const content = hover.querySelector('.monaco-hover-content');
      const text = (content ?? hover).textContent.trim();
      return { text: text.slice(0, 240), length: text.length, hasCodeSpan: hover.querySelector('code') !== null };
    })()`,
    { timeoutMs: 15000, label: "the token hover card to render" },
  );
  const shot = await capture(client, outDir, "hover-token");
  await dismissPopups(client);
  return { ...shot, note: "hover card on the `$brand` token", dom };
}

async function screenDiagnostics(ctx) {
  const { client, outDir } = ctx;
  await openFile(client, "broken-semicolon.cssx");
  const dom = await client.waitForExpression(
    `(() => {
      const squiggles = [...document.querySelectorAll('.squiggly-error, .squiggly-warning, .squiggly-info')];
      if (squiggles.length === 0) return null;
      return {
        squiggles: squiggles.length,
        classes: [...new Set(squiggles.map((element) => element.className))],
        text: (squiggles[0].closest('.view-overlays')?.parentElement?.textContent ?? '').slice(0, 120),
      };
    })()`,
    { timeoutMs: 25000, label: "the diagnostic squiggle to render" },
  );
  const shot = await capture(client, outDir, "diagnostics-squiggle");

  await runCommand(client, "View: Toggle Problems");
  const panel = await client.waitForExpression(
    `(() => {
      const rows = [...document.querySelectorAll('.markers-panel .monaco-list-row')];
      if (rows.length === 0) return null;
      return {
        rows: rows.length,
        texts: rows.slice(0, 6).map((row) => row.textContent.trim().slice(0, 160)),
      };
    })()`,
    { timeoutMs: 20000, label: "the Problems panel rows" },
  );
  const panelShot = await capture(client, outDir, "problems-panel");
  await runCommand(client, "View: Toggle Problems");
  return {
    ...shot,
    note: "XESSA1002 squiggle in the editor + the Problems panel entry",
    dom: { editor: dom, problems: panel },
    extra: [panelShot],
  };
}

/** The extension's own status bar item: text, accessible label, icon and box. */
async function xessaStatusItem(client) {
  return client.evaluate(`(() => {
    const items = [...document.querySelectorAll('.statusbar-item')];
    const item = items.find((candidate) => /Xessa/.test(candidate.textContent) ||
      /Xessa/.test(candidate.getAttribute('aria-label') ?? ''));
    if (!item) return null;
    const box = item.getBoundingClientRect();
    if (box.width === 0) return null;
    const icon = item.querySelector('.codicon');
    return {
      text: item.textContent.trim(),
      ariaLabel: item.getAttribute('aria-label'),
      tooltip: item.getAttribute('title'),
      icon: icon === null ? null : icon.className,
      box: { x: box.left, y: box.top, width: box.width, height: box.height },
    };
  })()`);
}

/**
 * Poll the status bar item until its accessible label matches.
 *
 * The label history is kept so a timeout reports what the item actually said —
 * `$(check)`/`$(warning)`/`$(error)` are icon classes, not text, so the
 * accessible label is the only readable state (U0 note 2).
 */
async function waitForStatusLabel(client, pattern, label) {
  const seen = [];
  try {
    return await cdp.waitFor(
      async () => {
        const info = await xessaStatusItem(client);
        if (!info) return undefined;
        seen.push(info.ariaLabel ?? info.text);
        return pattern.test(info.ariaLabel ?? "") ? info : undefined;
      },
      { timeoutMs: 30000, intervalMs: 250, label },
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; observed labels: ${JSON.stringify(
        [...new Set(seen)],
      )}`,
    );
  }
}

async function screenStatusBar(ctx) {
  const { client, outDir } = ctx;
  // A successful build flips the item to `$(check) Xessa` and fills the channel.
  await openFile(client, "clean.cssx");
  await runCommand(client, "Xessa: Build Project");
  const dom = await client.waitForExpression(
    `(() => {
      const items = [...document.querySelectorAll('.statusbar-item')];
      const item = items.find((candidate) => /Xessa/.test(candidate.textContent) ||
        /Xessa/.test(candidate.getAttribute('aria-label') ?? ''));
      if (!item) return null;
      const box = item.getBoundingClientRect();
      if (box.width === 0) return null;
      return {
        text: item.textContent.trim(),
        ariaLabel: item.getAttribute('aria-label'),
        title: item.getAttribute('title'),
        icon: item.querySelector('.codicon')?.className ?? null,
        box: { x: box.left, y: box.top, width: box.width, height: box.height },
      };
    })()`,
    { timeoutMs: 30000, label: "the Xessa status bar item" },
  );
  const shot = await captureRegion(client, outDir, "status-bar", dom.box);
  const full = await capture(client, outDir, "status-bar-full");

  // A single document compiles cleanly, which flips the item to `$(check)` and
  // sets the tooltip to `Compiled <path> → N artifact(s).` (controller.ts:513).
  await openFile(client, "clean.cssx");
  await runCommand(client, "Xessa: Compile File");
  const success = await waitForStatusLabel(
    client,
    /Compiled|succeeded/i,
    "the status bar item to report a compiled state",
  );
  const successShot = await captureRegion(client, outDir, "status-bar-success", success.box);
  return {
    ...shot,
    note: "status bar item after Build Project (stale/warning) and after a clean Compile File (success)",
    dom: { afterBuild: dom, afterCompile: success },
    extra: [full, successShot],
  };
}

/** Debug helper: prints DOM state when XESSA_CDP_DEBUG=1. */
async function debug(client, label) {
  if (process.env.XESSA_CDP_DEBUG !== "1") return;
  const state = await client.evaluate(`(() => {
    const widget = document.querySelector('.quick-input-widget');
    const output = document.querySelector('.output');
    return {
      quick: widget ? document.querySelector('.quick-input-widget').getBoundingClientRect().height : null,
      rows: widget ? [...widget.querySelectorAll('.monaco-list-row')].map((row) => row.textContent.trim().slice(0, 60)) : [],
      outputText: output ? [...output.querySelectorAll('.view-line')].slice(0, 6).map((line) => line.textContent) : null,
    };
  })()`);
  console.log(`[xessa cdp] debug ${label}: ${JSON.stringify(state)}`);
}

async function screenOutputChannel(ctx) {
  const { client, outDir } = ctx;
  // The channel only exists once the extension has activated, and it only has
  // content once a command has logged into it.
  await openFile(client, "clean.cssx");
  await runCommand(client, "Xessa: Compile File");
  await runCommandOpeningPicker(client, "Output: Show Output Channels");
  await typeIntoQuickInput(client, "Xessa");
  await waitForQuickInputRow(client, "Xessa");
  const rows = await client.waitForExpression(
    `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget) return null;
      const labels = [...widget.querySelectorAll('.monaco-list-row')].map((row) => row.textContent.trim());
      return labels.length > 0 ? labels : null;
    })()`,
    { timeoutMs: 20000, label: "the filtered output-channel list" },
  );
  if (!rows[0].startsWith("Xessa")) {
    await client.pressKey(KEYS.escape);
    throw new Error(
      `[xessa cdp] the output-channel picker does not list "Xessa" first; visible: ${JSON.stringify(rows)}`,
    );
  }
  // The single filtered row is selected, so Enter is the deterministic accept
  // (no arrow navigation). Some builds keep the picker mounted after the
  // accept; Escape closes it, and the output content below is the real proof
  // that the channel was selected.
  await client.pressKey(KEYS.enter);
  try {
    await waitForQuickInputClosed(client, { timeoutMs: 5000 });
  } catch {
    await debug(client, "output:still-open");
    await client.pressKey(KEYS.escape);
    await waitForQuickInputClosed(client);
  }
  // Selecting a channel re-opens the panel; focusing the view guarantees the
  // panel is laid out (a collapsed panel renders no view lines at all).
  await runCommand(client, "Output: Focus on Output View");
  // The output panel renders its editor inside `.pane-body.output-view`; the
  // bare `.output` element in the same DOM is an empty duplicate. The evaluated
  // snippet avoids escapes that a template literal would eat (newlines are
  // joined with `String.fromCharCode(10)`, digit classes are spelled out).
  const dom = await client.waitForExpression(
    `(() => {
      const view = document.querySelector('.output-view') ?? document.querySelector('.output');
      if (!view) return null;
      const lines = [...view.querySelectorAll('.view-line')].map((line) => line.textContent);
      const text = lines.join(String.fromCharCode(10)).trim();
      if (text.length === 0) return null;
      const select = view.querySelector('select');
      return {
        channel: select === null ? null : select.value,
        lines: lines.length,
        text: text.slice(0, 400),
        hasWroteLine: /wrote/i.test(text),
        hasTimestamp: /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(text),
      };
    })()`,
    { timeoutMs: 20000, label: "the Xessa output channel content" },
  );
  const shot = await capture(client, outDir, "output-channel");
  return { ...shot, note: "the Xessa output channel after Compile File", dom };
}

async function screenGrammar(ctx) {
  const { client, outDir } = ctx;
  // The panel is still open from the output-channel screen; a grammar shot wants
  // the whole window for the document.
  const panelOpen = await client.evaluate(
    "(() => { const panel = document.querySelector('.part.panel'); return panel !== null && panel.getBoundingClientRect().height > 0; })()",
  );
  if (panelOpen) await runCommand(client, "View: Toggle Panel Visibility");
  await openFile(client, "clean.cssx");
  const dom = await client.waitForExpression(
    `(() => {
      const spans = [...document.querySelectorAll('.view-lines span[class*="mtk"]')];
      if (spans.length === 0) return null;
      const styles = new Map();
      for (const span of spans) {
        const key = span.className;
        if (styles.has(key)) continue;
        styles.set(key, getComputedStyle(span).color);
      }
      return { tokenSpans: spans.length, classes: [...styles.keys()].slice(0, 16), colours: [...styles.values()].slice(0, 16) };
    })()`,
    { timeoutMs: 20000, label: "the grammar token spans" },
  );
  const shot = await capture(client, outDir, "grammar-clean");
  return { ...shot, note: "representative document with grammar token colours", dom };
}

const SCREENS = [
  ...SUGGEST_SCREENS.map((screen) => [screen.name, (ctx) => screenSuggest(ctx, screen)]),
  ["hover", screenHover],
  ["hover-token", screenHoverToken],
  ["diagnostics", screenDiagnostics],
  ["status-bar", screenStatusBar],
  ["output-channel", screenOutputChannel],
  ["grammar", screenGrammar],
];

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { out: DEFAULT_OUT, screens: [], all: false, keepOpen: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") out.all = true;
    else if (arg === "--keep-open") out.keepOpen = true;
    else if (arg === "--out") {
      index += 1;
      out.out = path.resolve(argv[index]);
    } else if (arg === "--screen") {
      index += 1;
      out.screens.push(argv[index]);
    } else if (arg === "--list") out.list = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "usage: bun packages/vscode/test/ui/capture.js [--all | --screen <name>] [--out <dir>] [--keep-open] [--list]",
    );
    return 0;
  }
  if (options.list) {
    for (const [name] of SCREENS) console.log(name);
    return 0;
  }
  const selected = options.all
    ? SCREENS
    : SCREENS.filter(([name]) => options.screens.includes(name));
  if (selected.length === 0) {
    console.error(
      `[xessa cdp] no screens selected; known: ${SCREENS.map(([name]) => name).join(", ")}`,
    );
    return 2;
  }
  await mkdir(options.out, { recursive: true });

  console.log("[xessa cdp] launching the cached VS Code build…");
  const handle = await cdp.openWorkbench({ timeoutMs: 180000 });
  const cleanup = cdp.installCleanup(handle);
  const { client } = handle;
  const results = [];
  let status = 0;
  try {
    console.log(`[xessa cdp] attached: version=${handle.version} port=${handle.editor.port}`);
    await client.waitForExpression(
      "Boolean(document.querySelector('.monaco-workbench')) && Boolean(document.querySelector('.monaco-editor'))",
      { timeoutMs: 120000, label: "the workbench + editor DOM" },
    );
    // Deterministic starting surface: no chat sidebar, no explorer, one editor.
    // Close the two panels the dev host opens on a fresh profile: the chat
    // auxiliary bar and the explorer (a full-window editor is the cleanest
    // backdrop for a widget shot; the explorer is captured by U6's icon work).
    await runCommand(client, "View: Toggle Secondary Side Bar Visibility");
    await runCommand(client, "View: Toggle Primary Side Bar Visibility");
    // `--disable-extensions` makes VS Code raise a "temporarily disabled" toast
    // that would sit over the status bar shots.
    await runCommand(client, "Notifications: Clear All Notifications").catch(() => undefined);

    for (const [name, screen] of selected) {
      const started = Date.now();
      try {
        const result = await screen({ client, outDir: options.out, handle });
        const elapsed = Date.now() - started;
        results.push({ name, ok: true, elapsedMs: elapsed, ...result });
        console.log(
          `[xessa cdp] ${name}: ${path.basename(result.file)} ${result.width}x${result.height} (${elapsed} ms)`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ name, ok: false, error: message });
        console.error(`[xessa cdp] ${name}: FAILED — ${message}`);
        status = 1;
        // Keep going: a missing screen must not hide the ones that work.
        await dismissPopups(client).catch(() => undefined);
      }
    }

    const axNodes = await client.accessibilityTree();
    const axFile = path.join(options.out, "ax-tree.json");
    await writeFile(axFile, JSON.stringify({ version: handle.version, nodes: axNodes }, null, 2));
    results.push({ name: "ax-tree", ok: true, file: axFile, nodes: axNodes.length });
    console.log(`[xessa cdp] ax-tree: ${axNodes.length} nodes`);

    const manifest = {
      capturedAt: new Date().toISOString(),
      vscode: handle.version,
      executable: handle.executable,
      launchArgs: handle.editor.args,
      screens: results,
    };
    const manifestFile = path.join(options.out, "manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`[xessa cdp] manifest: ${manifestFile}`);
    const failures = results.filter((entry) => entry.ok !== true);
    if (failures.length > 0) status = 1;
    console.log(
      `[xessa cdp] done: ${results.filter((entry) => entry.ok === true).length}/${results.length} screens captured`,
    );
  } catch (error) {
    status = 1;
    console.error(`[xessa cdp] aborted: ${error instanceof Error ? error.message : String(error)}`);
    for (const line of handle.editor.output.slice(-20)) console.error(`  vscode> ${line}`);
  } finally {
    if (options.keepOpen) console.log("[xessa cdp] --keep-open: leaving VS Code running");
    else await cleanup();
  }
  return status;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[xessa cdp] fatal: ${error instanceof Error ? error.stack : String(error)}`);
      process.exit(1);
    });
}

module.exports = { SCREENS, main, parseArgs };
