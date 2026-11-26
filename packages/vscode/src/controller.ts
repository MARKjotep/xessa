/**
 * Extension controller: wiring for providers, commands, status bar, output
 * channel and workspace-trust policy.
 *
 * Commands that write follow the compiler's `planOutputs` contract; Preview
 * compiles in memory only and opens a read-only `xessa-preview:` document.
 * Automatic builds are disabled outside a trusted workspace and compile-on-save
 * is off by default (SPECIFICATION.md §8).
 */

import { existsSync, readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { OutputOptions, PlanOutputsResult, ResolvedSetup } from "../../compiler/src/index.js";
import { listDirectoryEntriesSync, readModuleSync, sourceTextOf } from "./adapter.js";
import type { AnalyzeOptions, DocumentState, SourceText } from "./analysis.js";
import { analyzeDocument, analyzeText } from "./analysis.js";
import { discoverProjectEntries } from "./glob.js";
import type { ArtifactContents } from "./output.js";
import {
  artifactContents,
  fileSetup,
  formatProblem,
  planEntryOutputs,
  projectConfigOf,
  writePlannedOutputs,
} from "./output.js";
import { basenamePath, dirnamePath, normalizePath, relativeTo, toPosix } from "./paths.js";
import { ProjectIndex } from "./project.js";
import { XessaCodeActionProvider } from "./providers/code-actions.js";
import { XessaColorProvider } from "./providers/color.js";
import { XessaCompletionProvider } from "./providers/completion.js";
import { XessaDiagnostics } from "./providers/diagnostics.js";
import { XessaFormattingProvider, formattingEdits } from "./providers/formatting.js";
import { XessaHoverProvider } from "./providers/hover.js";
import {
  XessaDefinitionProvider,
  XessaReferenceProvider,
  XessaRenameProvider,
} from "./providers/navigation.js";
import { XessaSemanticTokensProvider } from "./providers/semantic-tokens.js";
import { XessaSymbolProvider } from "./providers/symbols.js";
import { AnalysisService } from "./service.js";

/** Command identifiers contributed in the manifest. */
export const COMMANDS = Object.freeze({
  compileFile: "xessa.compileFile",
  buildProject: "xessa.buildProject",
  preview: "xessa.previewCompiledCss",
  openCss: "xessa.openGeneratedCss",
  openMap: "xessa.openClassMap",
  checkProject: "xessa.checkProject",
});

const PREVIEW_SCHEME = "xessa-preview";

/** Read-only virtual document for **Preview Compiled CSS**. */
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  dispose(): void {
    this.emitter.dispose();
    this.contents.clear();
  }
}

type CompileTarget = "compile" | "preview" | "check";

interface CompileOutcome {
  readonly path: string;
  readonly state: DocumentState;
  readonly plan?: PlanOutputsResult;
  readonly written: readonly string[];
  readonly planProblems: readonly string[];
  readonly ok: boolean;
}

/** Registers every Xessa editor integration for one extension host session. */
export class XessaController {
  private readonly output: vscode.OutputChannel;
  private readonly status: vscode.StatusBarItem;
  private readonly index = new ProjectIndex();
  private readonly service: AnalysisService;
  private readonly diagnostics: XessaDiagnostics;
  private readonly preview = new PreviewContentProvider();
  private readonly disposables: vscode.Disposable[] = [];
  private hasSuccessfulBuild = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Xessa");
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.status.name = "Xessa";
    this.status.command = COMMANDS.buildProject;
    this.service = new AnalysisService((source) => this.analyzeSource(source));
    this.diagnostics = new XessaDiagnostics(this.service, (message) => this.log(message));
  }

  /** Wire providers, commands and events. */
  activate(): void {
    this.setStatus("idle", "Xessa language support is active. Click to build the project.");
    this.status.show();

    this.disposables.push(
      this.output,
      this.status,
      this.diagnostics,
      this.preview,
      vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this.preview),
      vscode.languages.registerCompletionItemProvider(
        { language: "xessa" },
        new XessaCompletionProvider(this.service),
        "@",
        "$",
        ".",
        ":",
        "/",
        "&",
        "(",
        "#",
        "!",
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
      ),
      vscode.languages.registerHoverProvider(
        { language: "xessa" },
        new XessaHoverProvider(this.service),
      ),
      this.registerSemanticTokens(),
      vscode.languages.registerDefinitionProvider(
        { language: "xessa" },
        new XessaDefinitionProvider(this.service),
      ),
      vscode.languages.registerReferenceProvider(
        { language: "xessa" },
        new XessaReferenceProvider(this.service),
      ),
      vscode.languages.registerRenameProvider(
        { language: "xessa" },
        new XessaRenameProvider(this.service),
      ),
      vscode.languages.registerColorProvider(
        { language: "xessa" },
        new XessaColorProvider(this.service),
      ),
      vscode.languages.registerDocumentSymbolProvider(
        { language: "xessa" },
        new XessaSymbolProvider(this.service),
      ),
      vscode.languages.registerDocumentFormattingEditProvider(
        { language: "xessa" },
        new XessaFormattingProvider(),
      ),
      vscode.languages.registerCodeActionsProvider(
        { language: "xessa" },
        new XessaCodeActionProvider(this.service),
        XessaCodeActionProvider.metadata,
      ),
      vscode.commands.registerCommand(COMMANDS.compileFile, () =>
        this.withActiveDocument((doc) => this.compileFile(doc)),
      ),
      vscode.commands.registerCommand(COMMANDS.buildProject, () => this.buildProject(false)),
      vscode.commands.registerCommand(COMMANDS.preview, () =>
        this.withActiveDocument((doc) => this.previewCss(doc)),
      ),
      vscode.commands.registerCommand(COMMANDS.openCss, () =>
        this.withActiveDocument((doc) => this.openGenerated(doc, "css")),
      ),
      vscode.commands.registerCommand(COMMANDS.openMap, () =>
        this.withActiveDocument((doc) => this.openGenerated(doc, "js")),
      ),
      vscode.commands.registerCommand(COMMANDS.checkProject, () => this.buildProject(true)),
      vscode.workspace.onDidOpenTextDocument((document) => this.onDocumentOpened(document)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.isCssxDocument(event.document)) return;
        // Any open document may import the edited one: drop every cached
        // analysis (there is no reverse-import index in 0.1.0) and re-run the
        // open document set on the shared debounce.
        this.service.invalidateAll();
        this.scheduleOpenCssxDocuments();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => void this.onDocumentSaved(document)),
      vscode.workspace.onWillSaveTextDocument((event) => this.onWillSaveTextDocument(event)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!this.isCssxDocument(document)) return;
        this.diagnostics.clear(document.uri);
        // Closing a dirty module falls back to its on-disk text, so importers
        // must re-analyze even though no file event fires.
        this.service.invalidateAll();
        this.scheduleOpenCssxDocuments();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.index.invalidate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.log("Workspace trust granted; automatic builds are available.");
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("xessa")) {
          this.log("Xessa settings changed.");
        }
      }),
    );
    this.context.subscriptions.push(...this.disposables);

    for (const document of vscode.workspace.textDocuments) this.onDocumentOpened(document);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  /**
   * Semantic-token registration (`CSSX-COLOR-TOKENS`).
   *
   * The legend comes from the provider itself so the registered legend and the
   * pure classifier cannot drift apart. Colours come from the user's
   * `editor.semanticTokenColorCustomizations` (documented in
   * `packages/vscode/README.md`); the manifest's `contributes.semanticTokenScopes`
   * is the grammar fallback. The provider is parse-only and never throws; any
   * document it cannot classify keeps its grammar scopes.
   */
  private registerSemanticTokens(): vscode.Disposable {
    const provider = new XessaSemanticTokensProvider();
    return vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "xessa" },
      provider,
      provider.legend,
    );
  }

  private onDocumentOpened(document: vscode.TextDocument): void {
    if (!this.isCssxDocument(document)) return;
    this.diagnostics.schedule(document);
  }

  /** A real `.cssx` file document (not the read-only preview virtual document). */
  private isCssxDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "xessa" && document.uri.scheme === "file";
  }

  /**
   * Re-schedule the debounced analysis for every open `.cssx` document.
   *
   * `except` skips a document the caller has just analyzed immediately (the
   * save path), avoiding a duplicate compile of the same version. Closed
   * documents are skipped: their diagnostics are gone.
   */
  private scheduleOpenCssxDocuments(except?: vscode.TextDocument): void {
    for (const open of vscode.workspace.textDocuments) {
      if (open === except || open.isClosed || !this.isCssxDocument(open)) continue;
      this.diagnostics.schedule(open);
    }
  }

  /**
   * Optional Xessa format-on-save (`xessa.editor.formatOnSave`, default off).
   *
   * Returns the same whole-document edit the formatting provider offers, so
   * manual formatting, `editor.formatOnSave` and this listener agree. The edit
   * is requested only for manual and after-delay saves; focus-out saves are
   * left alone. Parse errors produce no edit, and formatting is idempotent, so
   * enabling both this setting and global `editor.formatOnSave` cannot insert a
   * missing semicolon twice (a `XESSA1002` declaration is not rewritten at all).
   */
  private onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent): void {
    const document = event.document;
    if (document.languageId !== "xessa" || document.uri.scheme !== "file") return;
    const enabled = vscode.workspace
      .getConfiguration("xessa", document.uri)
      .get<boolean>("editor.formatOnSave", false);
    if (!enabled) return;
    if (event.reason === vscode.TextDocumentSaveReason.FocusOut) return;
    event.waitUntil(Promise.resolve(formattingEdits(document)));
  }

  private async onDocumentSaved(document: vscode.TextDocument): Promise<void> {
    if (!this.isCssxDocument(document)) return;
    // The compiler and the synchronous module reader both see the saved file,
    // so every open importer may now have different diagnostics. Invalidate
    // the whole cache, refresh the saved document immediately, and debounce
    // the other open documents (no reverse-import index in 0.1.0).
    this.service.invalidateAll();
    await this.diagnostics.refresh(document);
    this.scheduleOpenCssxDocuments(document);
    if (basenamePath(toPosix(document.uri.fsPath)) === "xessa.config.json") {
      this.index.invalidate();
      this.scheduleOpenCssxDocuments();
      return;
    }
    const configuration = vscode.workspace.getConfiguration("xessa", document.uri);
    const compileOnSave = configuration.get<boolean>("compileOnSave", false);
    if (!compileOnSave) return;
    if (!vscode.workspace.isTrusted) {
      this.log("Restricted Mode: skipping compile-on-save.");
      return;
    }
    const outcome = await this.compilePath(document.uri.fsPath, "compile");
    this.reportOutcome(outcome, true);
  }

  private async withActiveDocument(
    action: (document: vscode.TextDocument) => Promise<void>,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (document === undefined || document.languageId !== "xessa") {
      void vscode.window.showInformationMessage("Open a Xessa (.cssx) document first.");
      return;
    }
    try {
      await action(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Command failed: ${message}`);
      void vscode.window.showErrorMessage(`Xessa: ${message}`);
      this.setStatus("error", message);
    }
  }

  private analyzeOptionsFor(uri: vscode.Uri): AnalyzeOptions {
    const config = this.index.configFor(uri);
    return {
      ...(config?.media === undefined ? {} : { media: config.media }),
      ...(config?.classes?.prefix === undefined ? {} : { prefix: config.classes.prefix }),
      ...(config?.classes?.strategy === undefined
        ? {}
        : { namingStrategy: config.classes.strategy }),
      ...(config?.compiler?.mediaGrouping === undefined
        ? {}
        : { mediaGrouping: config.compiler.mediaGrouping }),
      workspaceRoot: this.index.rootFor(uri),
      readModule: readModuleSync,
      compile: true,
    };
  }

  private async analyzeSource(source: SourceText): Promise<DocumentState> {
    const options = this.analyzeOptionsFor(vscode.Uri.file(source.path));
    const state = await analyzeDocument(source, options);
    this.flushConfigWarnings();
    return state;
  }

  private sourceFor(path: string): SourceText {
    const normalized = normalizePath(path);
    const open = vscode.workspace.textDocuments.find(
      (document) => normalizePath(toPosix(document.uri.fsPath)) === normalized,
    );
    if (open !== undefined && open.languageId === "xessa") return sourceTextOf(open);
    return { text: readFileSync(normalized, "utf8"), path: normalized, version: 0 };
  }

  /**
   * Compile one document in memory, plan its outputs, and optionally write them.
   * The exact planned destinations are handed back to the compiler as API-level
   * output overrides so the generated CSS import specifier matches the files
   * actually written.
   */
  private async compilePath(path: string, target: CompileTarget): Promise<CompileOutcome> {
    const normalized = normalizePath(path);
    const uri = vscode.Uri.file(normalized);
    const source = this.sourceFor(normalized);
    const options = this.analyzeOptionsFor(uri);
    const workspaceRoot = options.workspaceRoot ?? dirnamePath(normalized);
    const parsed = analyzeText(source, options);
    const setup = fileSetup(parsed.file, parsed.settings, parsed.prefix);
    const config = this.index.configFor(uri);
    const projectConfig = config === undefined ? undefined : projectConfigOf(config);
    const plan = planEntryOutputs({
      sourceFile: parsed.file,
      workspaceRoot,
      setup,
      ...(projectConfig === undefined ? {} : { projectConfig }),
    });
    const planHasErrors = plan.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    const apiOutput: OutputOptions = planHasErrors
      ? {}
      : this.apiOutputFromPlan(plan, workspaceRoot, setup);
    const output: OutputOptions =
      target === "preview" ? { ...apiOutput, emitCss: true } : apiOutput;
    const state = await analyzeDocument(source, { ...options, output });

    const planProblems = plan.diagnostics.map(
      (diagnostic) =>
        `${parsed.file}:${diagnostic.span.start} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    );
    const problems = state.analysis.problems;
    const ok =
      !planHasErrors &&
      !problems.some((problem) => problem.severity === "error" && problem.file === parsed.file);
    const written: string[] = [];

    if (target === "compile" && ok && state.compiled !== undefined) {
      if (!vscode.workspace.isTrusted) {
        throw new Error(
          "Restricted Mode: writing generated files is disabled. Trust this workspace to compile.",
        );
      }
      const contents: ArtifactContents = artifactContents(state.compiled);
      written.push(...(await writePlannedOutputs(plan, contents)));
    }

    return { path: parsed.file, state, plan, written, planProblems, ok };
  }

  private apiOutputFromPlan(
    plan: PlanOutputsResult,
    workspaceRoot: string,
    setup: ResolvedSetup,
  ): OutputOptions {
    const output: { -readonly [Key in keyof OutputOptions]: OutputOptions[Key] } = {
      emitCss: setup.emitCss,
      emitMap: setup.emitMap,
      emitTypes: setup.emitTypes,
      sourceMap: setup.sourceMap,
      minify: setup.minify,
    };
    for (const artifact of plan.plan.outputs) {
      if (artifact.kind === "css") {
        output.cssDir = relativeTo(workspaceRoot, dirnamePath(artifact.absolutePath));
        output.cssName = basenamePath(artifact.absolutePath);
      }
      if (artifact.kind === "js") {
        output.mapDir = relativeTo(workspaceRoot, dirnamePath(artifact.absolutePath));
        output.mapName = basenamePath(artifact.absolutePath);
      }
    }
    return output;
  }

  private async compileFile(document: vscode.TextDocument): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Xessa: this workspace is in Restricted Mode, so writing generated files is disabled. Trust the workspace to compile.",
      );
      return;
    }
    const outcome = await this.compilePath(document.uri.fsPath, "compile");
    this.publishOutcome(outcome);
    this.reportOutcome(outcome, false);
  }

  private async previewCss(document: vscode.TextDocument): Promise<void> {
    const outcome = await this.compilePath(document.uri.fsPath, "preview");
    this.publishOutcome(outcome);
    const css = outcome.state.compiled?.css;
    // The tolerant compiler returns `""` (not `undefined`) for a dead document,
    // so an empty/whitespace-only result means "no CSS" too (CSSX-U06). A
    // broken-but-tolerant document still carries non-empty surviving CSS.
    if (css === undefined || css.trim() === "") {
      void vscode.window.showWarningMessage(
        "Xessa: no CSS was produced for this document; check the diagnostics.",
      );
      return;
    }
    const name = `${basenamePath(toPosix(document.uri.fsPath))}`;
    const uri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${encodeURIComponent(name)}`);
    this.preview.set(uri, css);
    const previewDocument = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(previewDocument, "css");
    const split = vscode.workspace
      .getConfiguration("xessa", document.uri)
      .get<boolean>("previewSplitEditor", true);
    await vscode.window.showTextDocument(previewDocument, {
      preview: true,
      preserveFocus: false,
      ...(split ? { viewColumn: vscode.ViewColumn.Beside } : {}),
    });
    this.log(`Previewed compiled CSS for ${document.uri.fsPath} (in memory, nothing written).`);
    this.reportProblems(outcome);
  }

  private async openGenerated(document: vscode.TextDocument, kind: "css" | "js"): Promise<void> {
    const outcome = await this.compilePath(document.uri.fsPath, "check");
    const artifact = outcome.plan?.plan.outputs.find((output) => output.kind === kind);
    if (artifact === undefined) {
      void vscode.window.showInformationMessage(
        `Xessa: this document has no planned ${kind === "css" ? "CSS" : "class map"} output (@setup disables it).`,
      );
      return;
    }
    if (!existsSync(artifact.absolutePath)) {
      void vscode.window.showInformationMessage(
        `Xessa: ${artifact.workspacePath} has not been generated yet. Run "Xessa: Compile File" first.`,
      );
      return;
    }
    const generated = await vscode.workspace.openTextDocument(
      vscode.Uri.file(artifact.absolutePath),
    );
    await vscode.window.showTextDocument(generated, { preview: true });
  }

  private async buildProject(checkOnly: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (editor === undefined && folder === undefined) {
      void vscode.window.showInformationMessage(
        "Xessa: open a workspace folder to build a project.",
      );
      return;
    }
    if (!checkOnly && !vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Xessa: this workspace is in Restricted Mode, so builds that write files are disabled. Trust the workspace to build.",
      );
      return;
    }
    try {
      const config =
        editor !== undefined
          ? this.index.configFor(editor.document.uri)
          : this.index.configAtRoot(folder?.uri.fsPath ?? "");
      const root =
        config?.root ??
        (editor !== undefined
          ? this.index.rootFor(editor.document.uri)
          : toPosix(folder?.uri.fsPath ?? ""));
      const entries = discoverProjectEntries(
        root,
        config?.include ?? [],
        config?.exclude ?? [],
        listDirectoryEntriesSync,
      );
      this.flushConfigWarnings();
      if (entries.length === 0) {
        this.log(`No .cssx entries discovered under ${root}.`);
        void vscode.window.showInformationMessage("Xessa: no .cssx files found in this project.");
        return;
      }
      this.log(
        `${checkOnly ? "Checking" : "Building"} ${entries.length} entr${entries.length === 1 ? "y" : "ies"} under ${root}.`,
      );
      let failures = 0;
      for (const entry of entries) {
        const outcome = await this.compilePath(entry, checkOnly ? "check" : "compile");
        this.publishOutcome(outcome);
        this.reportOutcome(outcome, true);
        if (!outcome.ok) failures += 1;
      }
      const summary = `${entries.length - failures}/${entries.length} ${
        entries.length - failures === 1 ? "entry" : "entries"
      } clean`;
      this.log(`${checkOnly ? "Check" : "Build"} complete: ${summary}.`);
      if (failures === 0) {
        this.hasSuccessfulBuild = true;
        this.setStatus("success", `${checkOnly ? "Check" : "Build"} succeeded: ${summary}.`);
        void vscode.window.setStatusBarMessage(`Xessa: ${summary}`, 4000);
      } else {
        this.setStatus(
          this.hasSuccessfulBuild ? "stale" : "error",
          `${failures} entr${failures === 1 ? "y" : "ies"} failed.`,
        );
        void vscode.window.showErrorMessage(
          `Xessa: ${failures} entr${failures === 1 ? "y" : "ies"} failed. See the Xessa output channel.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Project ${checkOnly ? "check" : "build"} failed: ${message}`);
      this.setStatus("error", message);
      void vscode.window.showErrorMessage(`Xessa: ${message}`);
    }
  }

  private publishOutcome(outcome: CompileOutcome): void {
    this.diagnostics.publish(vscode.Uri.file(outcome.path), outcome.state);
  }

  private reportOutcome(outcome: CompileOutcome, quiet: boolean): void {
    this.reportProblems(outcome);
    for (const path of outcome.written) this.log(`wrote ${path}`);
    if (outcome.written.length > 0) {
      this.hasSuccessfulBuild = true;
      this.setStatus(
        "success",
        `Compiled ${outcome.path} → ${outcome.written.length} artifact(s).`,
      );
      if (!quiet) {
        void vscode.window.setStatusBarMessage(
          `Xessa: wrote ${outcome.written.length} artifact(s) for ${basenamePath(outcome.path)}`,
          4000,
        );
      }
      return;
    }
    if (!outcome.ok) {
      this.setStatus(
        this.hasSuccessfulBuild ? "stale" : "error",
        `Compilation failed for ${outcome.path}; previous outputs (if any) are unchanged.`,
      );
      if (!quiet) {
        void vscode.window.showErrorMessage(
          `Xessa: ${outcome.path} has errors. See the Problems panel and the Xessa output channel.`,
        );
      }
    }
  }

  private reportProblems(outcome: CompileOutcome): void {
    for (const problem of outcome.state.analysis.problems) {
      this.log(formatProblem(problem.file, problem));
    }
    for (const problem of outcome.planProblems) this.log(problem);
    if (outcome.state.compiled?.error !== undefined) {
      this.log(`${outcome.path}: compile failed: ${outcome.state.compiled.error}`);
    }
  }

  private flushConfigWarnings(): void {
    for (const warning of this.index.takeWarnings()) this.log(warning);
  }

  private setStatus(kind: "idle" | "success" | "error" | "stale", tooltip: string): void {
    switch (kind) {
      case "success":
        this.status.text = "$(check) Xessa";
        break;
      case "error":
        this.status.text = "$(error) Xessa";
        break;
      case "stale":
        this.status.text = "$(warning) Xessa (stale)";
        break;
      default:
        this.status.text = "$(symbol-color) Xessa";
        break;
    }
    this.status.tooltip = tooltip;
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
