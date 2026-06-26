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

export const __monacoTestState = {
  models: new Map<string, TestModel>(),
  markers: [] as TestMarker[],
};

export const editor = {
  getModel(uri: TestUri): TestModel | undefined {
    return __monacoTestState.models.get(uri.toString());
  },
  getModelMarkers(filter: { readonly resource?: TestUri; readonly owner?: string }): TestMarker[] {
    return __monacoTestState.markers.filter(
      (marker) =>
        (filter.resource === undefined ||
          marker.resource?.toString() === filter.resource.toString()) &&
        (filter.owner === undefined || marker.owner === filter.owner),
    );
  },
  registerCommand(): { dispose(): void } {
    return { dispose() {} };
  },
};

export const Range = {
  areIntersectingOrTouching(): boolean {
    return true;
  },
};

function disposable(): { dispose(): void } {
  return { dispose() {} };
}

export const languages = {
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
