/**
 * Xessa VS Code extension entry point.
 *
 * Activation registers language features, commands, the status bar and the
 * `Xessa` output channel. Everything runs against the compiler's public API
 * (`parse`, `compile`, `planOutputs`, `createNodeHost`); no compiler internals
 * are imported and no Bun API is used, so the extension host only needs Node.
 */

import type * as vscode from "vscode";
import { XessaController } from "./controller.js";

let controller: XessaController | undefined;

/** Activate Xessa language support. */
export function activate(context: vscode.ExtensionContext): void {
  controller = new XessaController(context);
  controller.activate();
}

/** Release every registered provider, command and listener. */
export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
