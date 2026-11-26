/**
 * Xessa completion provider.
 *
 * The context detection and item construction live in `intelligence.ts`; this
 * adapter only converts pure suggestions to `CompletionItem`s and computes the
 * replacement range. Trigger characters: `@`, `$`, `.`, `:`, `/`, `&`, `(`,
 * `#`, `!` and the digits `0`–`9`. The sigils and punctuation are not word
 * characters, so each needs an explicit trigger (nested-selector starters, the
 * call opener, a colour literal and `!important`; SPECIFICATION.md §8). A digit
 * triggers because units are only meaningful behind a typed number (`margin: 1`
 * → `1rem`), and nothing else reopens the list there.
 *
 * A property item carries `retriggerSuggest`: VS Code runs its
 * `editor.action.triggerSuggest` command after the insert or snippet, so the
 * value list opens at the cursor the accepted `property: ` (or `property: ;`)
 * leaves behind (board bug 29). No other suggestion family sets it.
 */

import * as vscode from "vscode";
import { listDirectorySync, sourceTextOf, toCompletionKind } from "../adapter.js";
import { completionsAt } from "../intelligence.js";
import type { AnalysisService } from "../service.js";

/** Provides context-aware completion for `.cssx` documents. */
export class XessaCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[]> {
    const source = sourceTextOf(document);
    const state = await this.service.analyzeNow(source);
    if (token.isCancellationRequested) return [];

    const offset = document.offsetAt(position);
    // Mirrors the built-in CSS support: accepting a property inserts
    // `property: ;` and leaves the cursor before the semicolon.
    const completePropertyWithSemicolon = vscode.workspace
      .getConfiguration("xessa", document.uri)
      .get<boolean>("editor.completePropertyWithSemicolon", true);
    const result = completionsAt(source.text, offset, {
      analysis: state.analysis,
      ...(state.compiled === undefined ? {} : { classMap: state.compiled.classes }),
      listDirectory: listDirectorySync,
      completePropertyWithSemicolon,
    });
    const start = document.positionAt(result.replaceStart);
    const end = document.positionAt(result.replaceEnd);
    return result.items.map((suggestion) => {
      const item = new vscode.CompletionItem(suggestion.label, toCompletionKind(suggestion.kind));
      // A snippet insert form wins over the plain text: `color: $0;` inserts
      // `color: ;` and parks the cursor between the colon and the semicolon.
      item.insertText =
        suggestion.snippet === undefined
          ? suggestion.insertText
          : new vscode.SnippetString(suggestion.snippet);
      // VS Code narrows against the text its replacement range covers, not the
      // typed word. Items whose range starts before the word (the `(` call
      // opener, a `#` colour prefix) therefore carry the wider filter text; every
      // other item filters on its label.
      item.filterText = suggestion.filterText ?? suggestion.label;
      if (suggestion.sortText !== undefined) item.sortText = suggestion.sortText;
      // Accepting a property parks the cursor in the value position, so run the
      // suggest command again after the insert/snippet to reopen the value list.
      if (suggestion.retriggerSuggest === true) {
        item.command = { title: "Trigger suggest", command: "editor.action.triggerSuggest" };
      }
      if (suggestion.detail !== undefined) item.detail = suggestion.detail;
      if (suggestion.documentation !== undefined) {
        item.documentation = new vscode.MarkdownString(suggestion.documentation);
      }
      // Units replace only the typed suffix, so they can carry their own start
      // while digit-leading keyword values keep the shared range.
      item.range =
        suggestion.replaceStart === undefined
          ? new vscode.Range(start, end)
          : new vscode.Range(document.positionAt(suggestion.replaceStart), end);
      return item;
    });
  }
}
