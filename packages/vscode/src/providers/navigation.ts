/**
 * Xessa navigation providers: definition, references and rename for `$tokens`,
 * `@group.<name>` declarations/use sites, `@keyframes <name>` /
 * `$keyframes.<name>` constructs, selector classes and selector ids. Token,
 * class, id and keyframe-name ranges come from parser AST spans, so strings,
 * comments, import paths and attribute values are untouched. Class rename edits
 * every non-global occurrence of the same name in the current document; id
 * rename edits every occurrence (ids have no local/global split); group and
 * keyframe renames return edits for every visible module.
 */

import * as vscode from "vscode";
import { sourceTextOf, toEditorRange, toLocation } from "../adapter.js";
import type { DocumentState, Range } from "../analysis.js";
import { tokenNameConflict } from "../analysis.js";
import {
  type RenamePlan,
  classAt,
  definitionsAt,
  groupAt,
  groupDefinitionAt,
  idAt,
  keyframeAt,
  keyframeDefinitionAt,
  referencesToGroup,
  referencesToKeyframe,
  referencesToToken,
  renameAt,
  tokenAt,
  tokenDefinitionAt,
} from "../intelligence.js";
import { dirnamePath, normalizePath, toPosix } from "../paths.js";
import type { AnalysisService } from "../service.js";

async function stateOf(
  service: AnalysisService,
  document: vscode.TextDocument,
): Promise<DocumentState> {
  return service.analyzeNow(sourceTextOf(document));
}

/** Go-to-definition for `$tokens`, including imported module members. */
export class XessaDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    const source = sourceTextOf(document);
    const state = await stateOf(this.service, document);
    if (token.isCancellationRequested) return [];
    const targets = definitionsAt(source.text, document.offsetAt(position), {
      analysis: state.analysis,
    });
    return targets.map((target) => toLocation(target, document, state.analysis.file));
  }
}

/**
 * Maximum `.cssx` candidates one references request analyzes.
 *
 * The scan is on demand and cache-free outside the analysis service, so a
 * pathological workspace can otherwise turn Find All References into a project
 * build. Two hundred covers a normal package while keeping the extension host
 * suite fast; the target module is always admitted first.
 */
const REFERENCE_SCAN_LIMIT = 200;

/** Directories never scanned for references (generated or dependency trees). */
const REFERENCE_SCAN_EXCLUDE = "**/{node_modules,dist,generated}/**";

/** Whether `path` is `root` or inside it (both normalized POSIX paths). */
function isInside(path: string, root: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, "");
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

/** Find-all-references for `$tokens`, `@group.<name>` and keyframes, resolution-based in both directions. */
export class XessaReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly service: AnalysisService) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    const source = sourceTextOf(document);
    const state = await stateOf(this.service, document);
    if (token.isCancellationRequested) return [];
    const offset = document.offsetAt(position);
    const tokenTarget = tokenDefinitionAt(source.text, offset, state.analysis);
    const groupTarget =
      tokenTarget === undefined ? groupDefinitionAt(state.analysis, offset) : undefined;
    const keyframeTarget =
      tokenTarget === undefined && groupTarget === undefined
        ? keyframeDefinitionAt(source.text, offset, state.analysis)
        : undefined;
    const resolved =
      tokenTarget !== undefined
        ? ({ kind: "token", target: tokenTarget } as const)
        : groupTarget !== undefined
          ? ({ kind: "group", target: groupTarget } as const)
          : keyframeTarget !== undefined
            ? ({ kind: "keyframe", target: keyframeTarget } as const)
            : undefined;
    if (resolved === undefined) return [];

    const currentPath = normalizePath(state.analysis.path);
    const locations: vscode.Location[] = [];
    const seen = new Set<string>();
    const add = (file: string, range: Range): void => {
      const absolute = normalizePath(file);
      const uri = absolute === currentPath ? document.uri : vscode.Uri.file(absolute);
      const editorRange = toEditorRange(range);
      const key = [
        uri.toString(),
        editorRange.start.line,
        editorRange.start.character,
        editorRange.end.line,
        editorRange.end.character,
      ].join(":");
      if (seen.has(key)) return;
      seen.add(key);
      locations.push(new vscode.Location(uri, editorRange));
    };
    // Token, group and keyframe references share the same resolution-based
    // occurrence shape; only the resolver differs (token alias/shadow rules vs
    // group/keyframe visibility). `includeDeclaration` is preserved in all
    // three.
    const occurrencesIn = (text: string, analysis: DocumentState["analysis"]) =>
      resolved.kind === "token"
        ? referencesToToken(text, analysis, resolved.target, {
            includeDeclaration: context.includeDeclaration,
          })
        : resolved.kind === "group"
          ? referencesToGroup(analysis, resolved.target, {
              includeDeclaration: context.includeDeclaration,
            })
          : referencesToKeyframe(analysis, resolved.target, {
              includeDeclaration: context.includeDeclaration,
            });

    // The open document is already analyzed, so its own occurrences (including
    // the declaration when the cursor is on the definition) need no rescan.
    for (const occurrence of occurrencesIn(source.text, state.analysis)) {
      add(occurrence.file, occurrence.range);
    }

    const candidates = await this.referenceCandidates(currentPath, resolved.target.file, token);
    for (const candidate of candidates) {
      if (token.isCancellationRequested) break;
      const open = this.openCandidate(candidate);
      const text = await this.readCandidateText(candidate, open);
      if (text === undefined || !text.includes(resolved.target.name)) continue;
      const candidateState = await this.service.analyzeNow({
        text,
        path: candidate,
        version: open?.version ?? 0,
      });
      if (token.isCancellationRequested) break;
      for (const occurrence of occurrencesIn(text, candidateState.analysis)) {
        add(occurrence.file, occurrence.range);
      }
    }

    locations.sort((left, right) => {
      const byFile = left.uri.toString().localeCompare(right.uri.toString());
      if (byFile !== 0) return byFile;
      const byLine = left.range.start.line - right.range.start.line;
      return byLine !== 0 ? byLine : left.range.start.character - right.range.start.character;
    });
    return locations;
  }

  /**
   * Candidate module paths for one references request.
   *
   * Every workspace folder is searched for `**\/*.cssx` with the dependency and
   * generated-output exclude; the target module is always admitted. A document
   * outside every folder (a standalone file in the host suite, for example)
   * additionally scans its own directory non-recursively. The result is bounded
   * by {@link REFERENCE_SCAN_LIMIT} and always excludes the open document.
   */
  private async referenceCandidates(
    currentPath: string,
    targetFile: string,
    token: vscode.CancellationToken,
  ): Promise<readonly string[]> {
    const selected = new Set<string>();
    const targetPath = normalizePath(targetFile);
    if (targetPath !== currentPath) selected.add(targetPath);

    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots = folders.map((folder) => normalizePath(toPosix(folder.uri.fsPath)));
    const admit = (uri: vscode.Uri): void => {
      if (selected.size >= REFERENCE_SCAN_LIMIT) return;
      const path = normalizePath(toPosix(uri.fsPath));
      if (path !== currentPath) selected.add(path);
    };

    for (const folder of folders) {
      if (token.isCancellationRequested || selected.size >= REFERENCE_SCAN_LIMIT) break;
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.cssx"),
        REFERENCE_SCAN_EXCLUDE,
        REFERENCE_SCAN_LIMIT,
      );
      for (const uri of found) admit(uri);
    }

    if (
      !token.isCancellationRequested &&
      selected.size < REFERENCE_SCAN_LIMIT &&
      !roots.some((root) => isInside(currentPath, root))
    ) {
      const directory = vscode.Uri.file(dirnamePath(currentPath));
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(directory, "*.cssx"),
        REFERENCE_SCAN_EXCLUDE,
        REFERENCE_SCAN_LIMIT,
      );
      for (const uri of found) admit(uri);
    }

    return [...selected];
  }

  /** Open `.cssx` document backing `path`, so unsaved text wins over disk. */
  private openCandidate(path: string): vscode.TextDocument | undefined {
    const normalized = normalizePath(path);
    return vscode.workspace.textDocuments.find(
      (open) =>
        open.languageId === "xessa" && normalizePath(toPosix(open.uri.fsPath)) === normalized,
    );
  }

  private async readCandidateText(
    path: string,
    open: vscode.TextDocument | undefined,
  ): Promise<string | undefined> {
    if (open !== undefined) return open.getText();
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path)));
    } catch {
      return undefined;
    }
  }
}

/** Rename for local `$tokens`, selector classes/ids and groups; group and keyframe edits span modules. */
export class XessaRenameProvider implements vscode.RenameProvider {
  constructor(private readonly service: AnalysisService) {}

  async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<{ range: vscode.Range; placeholder: string } | undefined> {
    const source = sourceTextOf(document);
    const state = await stateOf(this.service, document);
    if (token.isCancellationRequested) return undefined;
    const offset = document.offsetAt(position);
    const found = tokenAt(source.text, offset, state.analysis);
    if (found !== undefined && found.symbol.namespace === undefined) {
      return {
        range: toEditorRange(found.symbol.declaration),
        placeholder: found.symbol.name,
      };
    }
    const group = groupAt(state.analysis, offset);
    if (group !== undefined) {
      return {
        range: toEditorRange(group.nameRange),
        placeholder: group.name,
      };
    }
    const keyframe = keyframeAt(source.text, offset, state.analysis);
    if (keyframe !== undefined) {
      return {
        range: toEditorRange(keyframe.nameRange),
        placeholder: keyframe.name,
      };
    }
    // A class token prepares on the name bytes after the dot, so the rename box
    // is prefilled with `card` rather than `.card` and the dot always survives.
    const occurrence = classAt(state.analysis, offset);
    if (occurrence !== undefined) {
      return {
        range: toEditorRange(occurrence.range),
        placeholder: occurrence.name,
      };
    }
    // An id token prepares on the name bytes after the `#` for the same reason:
    // the rename box is prefilled with `panel`, never `#panel`.
    const id = idAt(state.analysis, offset);
    if (id === undefined) return undefined;
    return {
      range: toEditorRange(id.range),
      placeholder: id.name,
    };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.WorkspaceEdit> {
    const source = sourceTextOf(document);
    const state = await stateOf(this.service, document);
    if (token.isCancellationRequested) return new vscode.WorkspaceEdit();
    const offset = document.offsetAt(position);
    const plan: RenamePlan = renameAt(source.text, offset, newName, {
      analysis: state.analysis,
    });
    if (!plan.ok) throw new Error(plan.reason);
    // Refuse a token name that already exists before any edit is built
    // (CSSX-U04): an applied duplicate would only surface as XESSA2001 after
    // the original name is already lost. Group, keyframe and class renames
    // enforce the same rule inside `renameAt`; `tokenAt` finds nothing for their
    // headers/selectors.
    const tokenAtCursor = tokenAt(source.text, offset, state.analysis);
    if (tokenAtCursor !== undefined && tokenAtCursor.symbol.namespace === undefined) {
      const conflict = tokenNameConflict(state.analysis, newName, tokenAtCursor.symbol);
      if (conflict !== undefined) {
        throw new Error(`A token named "$${newName}" already exists in scope.`);
      }
    }
    const edit = new vscode.WorkspaceEdit();
    const currentPath = normalizePath(state.analysis.path);
    for (const change of plan.edits) {
      const target =
        change.file === undefined || normalizePath(change.file) === currentPath
          ? document.uri
          : vscode.Uri.file(change.file);
      edit.replace(target, toEditorRange(change.range), change.newText);
    }
    return edit;
  }
}
