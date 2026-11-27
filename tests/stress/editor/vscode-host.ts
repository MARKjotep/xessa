/**
 * Minimal fake `vscode` module for the TT6 repeated-activation case.
 *
 * `packages/vscode/src/controller.ts` imports the real `vscode` module, which
 * does not exist under `bun test`. The editor stress harness registers the fake
 * below with `mock.module("vscode", …)` so `XessaController.activate()` /
 * `.dispose()` can be driven many times in one process and every registration
 * is observable.
 *
 * The fake is deliberately tiny and explicit: it implements only the members
 * `controller.ts` and its providers touch during activation/teardown, and it
 * counts every disposable it hands out. Anything the fake does not model would
 * throw, which keeps the harness honest about the API surface it pins.
 */

/** One disposable handed out by the fake, with the call that created it. */
export interface DisposableRecord {
  /** Call that produced the disposable (`languages.registerHoverProvider`, …). */
  readonly kind: string;
  /** `true` once `dispose()` has run. */
  readonly disposed: boolean;
}

/** Observable state of one fake host. */
export interface FakeVscodeHost {
  /** The module object registered under the `vscode` specifier. */
  readonly module: Record<string, unknown>;
  /** Every disposable created so far, in creation order. */
  readonly disposables: { kind: string; disposed: boolean }[];
  /** Disposables created and not yet disposed. */
  live(): number;
  /** Disposables created so far. */
  created(): number;
  /** Disposables disposed so far. */
  disposed(): number;
  /** Registrations by call kind, e.g. `{ "languages.registerHoverProvider": 3 }`. */
  byKind(): Record<string, number>;
}

function noop(): void {}

/** Create one independently counted fake `vscode` host. */
export function createFakeVscodeHost(): FakeVscodeHost {
  const disposables: { kind: string; disposed: boolean }[] = [];
  const kinds: Record<string, number> = {};

  const track = (kind: string): { dispose: () => void } => {
    const record = { kind, disposed: false };
    disposables.push(record);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    return {
      dispose: () => {
        record.disposed = true;
      },
    };
  };

  /** A registration helper: counts the call and returns a tracked disposable. */
  const register =
    (kind: string) =>
    (..._args: unknown[]) =>
      track(kind);

  class FakeEventEmitter<T> {
    private readonly listeners: ((event: T) => void)[] = [];

    readonly event = (listener: (event: T) => void): { dispose: () => void } => {
      this.listeners.push(listener);
      const index = this.listeners.length - 1;
      return {
        dispose: () => {
          this.listeners[index] = noop as (event: T) => void;
        },
      };
    };

    fire(event?: T): void {
      for (const listener of this.listeners) listener(event as T);
    }

    dispose(): void {
      this.listeners.length = 0;
    }
  }

  class FakePosition {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }

  class FakeRange {
    constructor(
      readonly start: FakePosition,
      readonly end: FakePosition,
    ) {}
  }

  class FakeSemanticTokens {
    constructor(readonly data: Uint32Array) {}
  }

  class FakeSemanticTokensLegend {
    constructor(
      readonly tokenTypes: string[],
      readonly tokenModifiers: string[],
    ) {}
  }

  class FakeThemeColor {
    constructor(readonly id: string) {}
  }

  const createDiagnosticCollection = (name: string) => ({
    name,
    set: noop,
    delete: noop,
    clear: noop,
    get: () => undefined,
    has: () => false,
    forEach: noop,
    dispose: track("languages.createDiagnosticCollection").dispose,
  });

  const configuration = {
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
    has: () => false,
    inspect: () => undefined,
    update: async () => undefined,
  };

  const workspace = {
    textDocuments: [] as unknown[],
    workspaceFolders: undefined,
    isTrusted: true,
    name: "xessa-stress",
    getConfiguration: () => configuration,
    getWorkspaceFolder: () => undefined,
    openTextDocument: async () => undefined,
    registerTextDocumentContentProvider: register("workspace.registerTextDocumentContentProvider"),
    onDidOpenTextDocument: register("workspace.onDidOpenTextDocument"),
    onDidChangeTextDocument: register("workspace.onDidChangeTextDocument"),
    onDidSaveTextDocument: register("workspace.onDidSaveTextDocument"),
    onWillSaveTextDocument: register("workspace.onWillSaveTextDocument"),
    onDidCloseTextDocument: register("workspace.onDidCloseTextDocument"),
    onDidChangeWorkspaceFolders: register("workspace.onDidChangeWorkspaceFolders"),
    onDidGrantWorkspaceTrust: register("workspace.onDidGrantWorkspaceTrust"),
    onDidChangeConfiguration: register("workspace.onDidChangeConfiguration"),
  };

  const languages = {
    createDiagnosticCollection,
    setTextDocumentLanguage: async () => undefined,
    registerCompletionItemProvider: register("languages.registerCompletionItemProvider"),
    registerHoverProvider: register("languages.registerHoverProvider"),
    registerDefinitionProvider: register("languages.registerDefinitionProvider"),
    registerReferenceProvider: register("languages.registerReferenceProvider"),
    registerRenameProvider: register("languages.registerRenameProvider"),
    registerColorProvider: register("languages.registerColorProvider"),
    registerDocumentSemanticTokensProvider: register(
      "languages.registerDocumentSemanticTokensProvider",
    ),
    registerDocumentSymbolProvider: register("languages.registerDocumentSymbolProvider"),
    registerDocumentFormattingEditProvider: register(
      "languages.registerDocumentFormattingEditProvider",
    ),
    registerCodeActionsProvider: register("languages.registerCodeActionsProvider"),
  };

  const window = {
    activeTextEditor: undefined,
    visibleTextEditors: [] as unknown[],
    createOutputChannel: (name: string) => ({
      name,
      append: noop,
      appendLine: noop,
      replace: noop,
      clear: noop,
      show: noop,
      hide: noop,
      dispose: track("window.createOutputChannel").dispose,
    }),
    createStatusBarItem: () => ({
      text: "",
      tooltip: "",
      name: "",
      command: undefined,
      show: noop,
      hide: noop,
      dispose: track("window.createStatusBarItem").dispose,
    }),
    setStatusBarMessage: () => track("window.setStatusBarMessage"),
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showTextDocument: async () => undefined,
    createTextEditorDecorationType: () => track("window.createTextEditorDecorationType"),
    onDidChangeActiveTextEditor: register("window.onDidChangeActiveTextEditor"),
    onDidChangeVisibleTextEditors: register("window.onDidChangeVisibleTextEditors"),
    onDidChangeTextEditorSelection: register("window.onDidChangeTextEditorSelection"),
  };

  const commands = {
    registerCommand: register("commands.registerCommand"),
    executeCommand: async () => undefined,
    getCommands: async () => [],
  };

  const module: Record<string, unknown> = {
    EventEmitter: FakeEventEmitter,
    Position: FakePosition,
    Range: FakeRange,
    SemanticTokens: FakeSemanticTokens,
    SemanticTokensLegend: FakeSemanticTokensLegend,
    ThemeColor: FakeThemeColor,
    Uri: {
      file: (path: string) => ({
        scheme: "file",
        path,
        fsPath: path,
        authority: "",
        query: "",
        fragment: "",
        toString: () => `file://${path}`,
      }),
      parse: (value: string) => ({
        scheme: "file",
        path: value,
        fsPath: value,
        authority: "",
        query: "",
        fragment: "",
        toString: () => value,
      }),
      joinPath: () => undefined,
    },
    workspace,
    languages,
    window,
    commands,
    StatusBarAlignment: { Left: 1, Right: 2 },
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Constructor: 3,
      Field: 4,
      Variable: 5,
      Class: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Unit: 10,
      Value: 11,
      Enum: 12,
      Keyword: 13,
      Snippet: 14,
      Color: 15,
      File: 16,
      Reference: 17,
      Folder: 18,
      EnumMember: 19,
      Constant: 20,
      Struct: 21,
      Event: 22,
      Operator: 23,
      TypeParameter: 24,
    },
    SymbolKind: {
      File: 0,
      Module: 1,
      Namespace: 2,
      Package: 3,
      Class: 4,
      Method: 5,
      Property: 6,
      Field: 7,
      Constructor: 8,
      Enum: 9,
      Interface: 10,
      Function: 11,
      Variable: 12,
      Constant: 13,
      String: 14,
      Number: 15,
      Boolean: 16,
      Array: 17,
      Object: 18,
      Key: 19,
      Null: 20,
      EnumMember: 21,
      Struct: 22,
      Event: 23,
      Operator: 24,
      TypeParameter: 25,
    },
    CodeActionKind: {
      Empty: { value: "" },
      QuickFix: { value: "quickfix" },
      Refactor: { value: "refactor" },
      Source: { value: "source" },
    },
    CompletionItem: class {},
    Diagnostic: class {},
    CodeAction: class {},
    Hover: class {},
    Location: class {},
    MarkdownString: class {},
    SnippetString: class {},
    TextEdit: class {},
    WorkspaceEdit: class {},
    DocumentSymbol: class {},
    Color: class {},
    ColorInformation: class {},
    ColorPresentation: class {},
    Disposable: class {},
  };

  return {
    module,
    disposables,
    live: () => disposables.filter((entry) => !entry.disposed).length,
    created: () => disposables.length,
    disposed: () => disposables.filter((entry) => entry.disposed).length,
    byKind: () => ({ ...kinds }),
  };
}

/** Extension context shape `XessaController` writes to. */
export interface FakeExtensionContext {
  readonly subscriptions: { dispose: () => void }[];
  readonly extensionPath: string;
  readonly extensionUri: unknown;
  readonly globalState: unknown;
  readonly workspaceState: unknown;
}

/** Create the `ExtensionContext` the controller's constructor expects. */
export function createFakeContext(): FakeExtensionContext {
  return {
    subscriptions: [],
    extensionPath: "/virtual/extension",
    extensionUri: undefined,
    globalState: { get: () => undefined, update: async () => undefined },
    workspaceState: { get: () => undefined, update: async () => undefined },
  };
}
