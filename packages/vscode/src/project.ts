/**
 * Per-file project context for a multi-root workspace.
 *
 * The extension resolves the nearest `xessa.config.json` for each document and
 * uses that directory as the project root. No global configuration is read, so
 * a root folder without a config never shadows a nested project.
 */

import { existsSync, readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ExtensionConfig } from "./config.js";
import { findNearestConfigPath, parseExtensionConfig } from "./config.js";
import { dirnamePath, normalizePath, toPosix } from "./paths.js";

function isFile(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** Resolve and cache configs per detected file path. */
export class ProjectIndex {
  private readonly configs = new Map<string, ExtensionConfig | undefined>();
  private readonly warnings: string[] = [];

  /** Workspace folder root containing `uri`, when any. */
  folderRootFor(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder === undefined ? undefined : toPosix(folder.uri.fsPath);
  }

  /** Nearest config file for a document, bounded by its workspace folder. */
  configFileFor(uri: vscode.Uri): string | undefined {
    return findNearestConfigPath(toPosix(uri.fsPath), this.folderRootFor(uri), isFile);
  }

  /** Nearest config for a document, or `undefined` when none exists. */
  configFor(uri: vscode.Uri): ExtensionConfig | undefined {
    const file = this.configFileFor(uri);
    return file === undefined ? undefined : this.load(file);
  }

  /** Config exactly at a project root (used when a command has no active file). */
  configAtRoot(root: string): ExtensionConfig | undefined {
    const file = `${normalizePath(root).replace(/\/+$/, "")}/xessa.config.json`;
    return isFile(file) ? this.load(file) : undefined;
  }

  private load(file: string): ExtensionConfig | undefined {
    if (this.configs.has(file)) return this.configs.get(file);
    let config: ExtensionConfig | undefined;
    try {
      const outcome = parseExtensionConfig(readFileSync(file, "utf8"), file);
      if (outcome.ok) {
        config = outcome.config;
        this.warnings.push(...outcome.warnings);
      } else {
        this.warnings.push(outcome.message);
      }
    } catch (error) {
      this.warnings.push(`Could not read ${file}: ${String(error)}`);
    }
    this.configs.set(file, config);
    return config;
  }

  /** Project root for a document: nearest config directory, folder root, or the file's directory. */
  rootFor(uri: vscode.Uri): string {
    const config = this.configFor(uri);
    if (config !== undefined) return config.root;
    return this.folderRootFor(uri) ?? dirnamePath(normalizePath(toPosix(uri.fsPath)));
  }

  /** Drop cached configs after a config file changes. */
  invalidate(): void {
    this.configs.clear();
  }

  /** Drain warnings collected while reading configs (reported in the output channel). */
  takeWarnings(): readonly string[] {
    const drained = [...this.warnings];
    this.warnings.length = 0;
    return drained;
  }
}
