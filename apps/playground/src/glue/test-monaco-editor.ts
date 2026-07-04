interface TestUri {
  toString(): string;
}

export class Uri {
  static isUri(thing: unknown): thing is Uri {
    return thing instanceof Uri;
  }

  static parse(value: string): Uri {
    return new Uri(value);
  }

  static file(path: string): Uri {
    return new Uri(path, { scheme: 'file', path });
  }

  static from(components: {
    readonly scheme: string;
    readonly authority?: string;
    readonly path?: string;
    readonly query?: string;
    readonly fragment?: string;
  }): Uri {
    return new Uri(components.path ?? '', components);
  }

  static joinPath(uri: Uri, ...pathFragment: string[]): Uri {
    return uri.with({ path: [uri.path, ...pathFragment].join('/').replace(/\/+/g, '/') });
  }

  static revive(data: Uri | Parameters<typeof Uri.from>[0]): Uri {
    return data instanceof Uri ? data : Uri.from(data);
  }

  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(
    private readonly value: string,
    components?: {
      readonly scheme?: string;
      readonly authority?: string;
      readonly path?: string;
      readonly query?: string;
      readonly fragment?: string;
    },
  ) {
    this.scheme = components?.scheme ?? '';
    this.authority = components?.authority ?? '';
    this.path = components?.path ?? value;
    this.query = components?.query ?? '';
    this.fragment = components?.fragment ?? '';
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: {
    readonly scheme?: string;
    readonly authority?: string | null;
    readonly path?: string | null;
    readonly query?: string | null;
    readonly fragment?: string | null;
  }): Uri {
    return new Uri(change.path ?? this.value, {
      scheme: change.scheme ?? this.scheme,
      authority: change.authority ?? this.authority,
      path: change.path ?? this.path,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    });
  }

  toString(): string {
    return this.value;
  }

  toJSON(): {
    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;
  } {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
}

export interface TestModel {
  readonly applied: unknown[][];
  applyEdits(edits: unknown[]): void;
}

export interface TestMarker {
  readonly resource?: TestUri;
  readonly owner?: string;
  readonly code?: string | { readonly value: string };
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export type TestCommandHandler = (accessor: unknown, ...args: unknown[]) => void;

export const __monacoTestState = {
  models: new Map<string, TestModel>(),
  markers: [] as TestMarker[],
  /** `monaco.editor.registerCommand` registrations, keyed by command id. */
  commands: new Map<string, TestCommandHandler>(),
};

let nextAutoModelUri = 0;

/**
 * Live text model for behavioral tests (editor-host-core): value + content
 * events + dispose — the exact surface the editor session core drives. Like
 * real Monaco, touching a disposed model throws (catches use-after-close).
 */
export class TextModel {
  readonly uri: Uri;
  private value: string;
  private readonly languageId: string;
  private disposed = false;
  private readonly contentListeners = new Set<() => void>();

  constructor(value: string, languageId = 'plaintext', uri?: Uri) {
    this.value = value;
    this.languageId = languageId;
    nextAutoModelUri += 1;
    this.uri = uri ?? Uri.parse(`inmemory://model/${nextAutoModelUri}`);
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('TestTextModel is disposed');
  }

  getValue(): string {
    this.assertNotDisposed();
    return this.value;
  }

  setValue(text: string): void {
    this.assertNotDisposed();
    this.value = text;
    for (const listener of [...this.contentListeners]) listener();
  }

  getLanguageId(): string {
    return this.languageId;
  }

  getLineCount(): number {
    this.assertNotDisposed();
    return this.value.split('\n').length;
  }

  onDidChangeContent(listener: () => void): { dispose(): void } {
    this.contentListeners.add(listener);
    return { dispose: () => void this.contentListeners.delete(listener) };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.contentListeners.clear();
  }
}

export const editor = {
  getModel(uri: TestUri): TestModel | undefined {
    return __monacoTestState.models.get(uri.toString());
  },
  createModel(value: string, language?: string, uri?: Uri): TextModel {
    return new TextModel(value, language ?? 'plaintext', uri);
  },
  /** Real replace semantics: resets the (resource, owner) marker channel. */
  setModelMarkers(
    model: { readonly uri: TestUri },
    owner: string,
    markers: readonly Omit<TestMarker, 'resource' | 'owner'>[],
  ): void {
    __monacoTestState.markers = [
      ...__monacoTestState.markers.filter(
        (marker) => marker.owner !== owner || marker.resource?.toString() !== model.uri.toString(),
      ),
      ...markers.map((marker) => ({ ...marker, resource: model.uri as TestUri, owner })),
    ];
  },
  getModelMarkers(filter: { readonly resource?: TestUri; readonly owner?: string }): TestMarker[] {
    return __monacoTestState.markers.filter(
      (marker) =>
        (filter.resource === undefined ||
          marker.resource?.toString() === filter.resource.toString()) &&
        (filter.owner === undefined || marker.owner === filter.owner),
    );
  },
  registerCommand(id?: string, handler?: TestCommandHandler): { dispose(): void } {
    if (typeof id === 'string' && typeof handler === 'function') {
      __monacoTestState.commands.set(id, handler);
      return {
        dispose() {
          __monacoTestState.commands.delete(id);
        },
      };
    }
    return { dispose() {} };
  },
};

/** Constructible (editor-host-core `new monaco.Range(...)` for gutter decorations)
 *  while keeping the static the ts-LS providers call. */
export class Range {
  static areIntersectingOrTouching(): boolean {
    return true;
  }

  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

function disposable(): { dispose(): void } {
  return { dispose() {} };
}

export const languages = {
  // Enum values mirror the real monaco-editor `editor.api.d.ts` verbatim so
  // behavioral tests compare against the same runtime values Monaco ships.
  CompletionItemKind: {
    Method: 0,
    Function: 1,
    Constructor: 2,
    Field: 3,
    Variable: 4,
    Class: 5,
    Struct: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Event: 10,
    Operator: 11,
    Unit: 12,
    Value: 13,
    Constant: 14,
    Enum: 15,
    EnumMember: 16,
    Keyword: 17,
    Text: 18,
    Color: 19,
    File: 20,
    Reference: 21,
    Customcolor: 22,
    Folder: 23,
    TypeParameter: 24,
    User: 25,
    Issue: 26,
    Snippet: 27,
  },
  CompletionItemTag: { Deprecated: 1 },
  CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 },
  CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 },
  SignatureHelpTriggerKind: { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 },
  registerHoverProvider: disposable,
  registerDefinitionProvider: disposable,
  registerTypeDefinitionProvider: disposable,
  registerImplementationProvider: disposable,
  registerCompletionItemProvider: disposable,
  registerReferenceProvider: disposable,
  registerRenameProvider: disposable,
  registerSignatureHelpProvider: disposable,
  registerCodeActionProvider: disposable,
  registerDocumentSymbolProvider: disposable,
  registerFoldingRangeProvider: disposable,
  registerInlayHintsProvider: disposable,
  registerDocumentHighlightProvider: disposable,
  registerDocumentSemanticTokensProvider: disposable,
  registerDocumentRangeSemanticTokensProvider: disposable,
  registerSelectionRangeProvider: disposable,
  registerOnTypeFormattingEditProvider: disposable,
  registerLinkedEditingRangeProvider: disposable,
  registerDocumentFormattingEditProvider: disposable,
  registerDocumentRangeFormattingEditProvider: disposable,
};
