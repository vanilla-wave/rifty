import type * as monaco from 'monaco-editor';
import type { EditorApi } from '../components/editor-host-core.ts';
import type { TsLanguageServiceProvidersHandle } from '../glue/ts-ls-monaco-providers.ts';

interface PlaygroundTsDevHookGlobals {
  __riftyTsHover?: (path: string, line: number, col: number) => Promise<string | null>;
  __riftyTsDefinition?: (
    path: string,
    line: number,
    col: number,
  ) => Promise<{ uri: string; line: number; column: number }[] | null>;
  __riftyTsCompletions?: (path: string, line: number, col: number) => Promise<string[] | null>;
  __riftyTsCompletionItems?: (
    path: string,
    line: number,
    col: number,
  ) => Promise<
    | {
        label: string;
        insertText: string;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
        insertTextRules?: number;
        commitCharacters: string[];
        additionalTextEditCount: number;
      }[]
    | null
  >;
  __riftyTsReferences?: (
    path: string,
    line: number,
    col: number,
    includeDeclaration: boolean,
  ) => Promise<{ uri: string; line: number; column: number }[] | null>;
  __riftyTsPrepareRename?: (
    path: string,
    line: number,
    col: number,
  ) => Promise<{ text: string; line: number; column: number } | { rejectReason: string } | null>;
  __riftyTsRenameEdits?: (
    path: string,
    line: number,
    col: number,
    newName: string,
  ) => Promise<{ uri: string; text: string; line: number; column: number }[] | null>;
  __riftyTsSignatureHelp?: (
    path: string,
    line: number,
    col: number,
  ) => Promise<{ label: string; activeSignature: number; activeParameter: number } | null>;
  __riftyTsCodeFixes?: (
    path: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
  ) => Promise<
    {
      title: string;
      kind?: string;
      edits: { uri: string; text: string }[];
    }[]
  >;
  __riftyTsOrganizeImports?: (path: string) => Promise<{
    title: string;
    kind?: string;
    edits: { uri: string; text: string }[];
  } | null>;
  __riftyTsFormat?: (path: string) => Promise<{ editCount: number; applied: string } | null>;
  __riftyTsRangeSemanticTokenCount?: (
    path: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
  ) => Promise<number | null>;
  __riftyTsReinit?: () => Promise<boolean>;
}

export interface InstallPlaygroundTsDevHooksOptions {
  readonly api: EditorApi;
  readonly providers: TsLanguageServiceProvidersHandle;
  readonly reinitialize: () => Promise<boolean>;
}

export interface PlaygroundTsDevHooksHandle {
  dispose(): void;
}

const NO_DEV_HOOKS = Object.freeze({ dispose() {} });

/** DEV-only deterministic drivers for the exact Monaco providers registered by the App. */
export function installPlaygroundTsDevHooks(
  options: InstallPlaygroundTsDevHooksOptions,
): PlaygroundTsDevHooksHandle {
  if (!import.meta.env.DEV) return NO_DEV_HOOKS;
  const { api, providers } = options;
  const mon = api.monaco;
  const NEVER_CANCEL: monaco.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  const modelFor = (path: string): monaco.editor.ITextModel | null => {
    const uri = api.ensureModel(path);
    return uri ? mon.editor.getModel(uri) : null;
  };
  const pos = (line: number, column: number): monaco.Position => new mon.Position(line, column);
  const pathForUri = (uri: monaco.Uri): string => {
    const target = mon.editor.getModel(uri);
    const targetPath = target ? api.pathForModel(target) : undefined;
    return targetPath ?? uri.toString();
  };
  const codeActionEdits = (
    action: monaco.languages.CodeAction,
  ): { uri: string; text: string }[] => {
    const out: { uri: string; text: string }[] = [];
    for (const edit of action.edit?.edits ?? []) {
      if (!('textEdit' in edit)) continue;
      const textEdit = edit as monaco.languages.IWorkspaceTextEdit;
      out.push({ uri: pathForUri(textEdit.resource), text: textEdit.textEdit.text });
    }
    return out;
  };
  const resolveCodeAction = async (
    action: monaco.languages.CodeAction,
  ): Promise<monaco.languages.CodeAction> =>
    (await providers.providers.codeAction.resolveCodeAction?.(action, NEVER_CANCEL)) ?? action;

  const installed = {
    __riftyTsReinit: async () => options.reinitialize(),
    __riftyTsHover: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const hover = await providers.providers.hover.provideHover(
        model,
        pos(line, col),
        NEVER_CANCEL,
      );
      if (!hover) return null;
      return hover.contents.map((content) => content.value).join('\n');
    },
    __riftyTsDefinition: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const definition = await providers.providers.definition.provideDefinition(
        model,
        pos(line, col),
        NEVER_CANCEL,
      );
      if (!definition) return null;
      const locations = Array.isArray(definition) ? definition : [definition];
      return locations.map((location) => {
        const target = mon.editor.getModel(location.uri);
        const targetPath = target ? api.pathForModel(target) : undefined;
        return {
          uri: targetPath ?? location.uri.toString(),
          line: location.range.startLineNumber,
          column: location.range.startColumn,
        };
      });
    },
    __riftyTsCompletions: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const result = await providers.providers.completion.provideCompletionItems(
        model,
        pos(line, col),
        { triggerKind: 0 } as monaco.languages.CompletionContext,
        NEVER_CANCEL,
      );
      if (!result) return null;
      return result.suggestions.map((suggestion) =>
        typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.label,
      );
    },
    __riftyTsCompletionItems: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const result = await providers.providers.completion.provideCompletionItems(
        model,
        pos(line, col),
        { triggerKind: 0 } as monaco.languages.CompletionContext,
        NEVER_CANCEL,
      );
      if (!result) return null;
      const resolve = providers.providers.completion.resolveCompletionItem;
      const out = [];
      for (const suggestion of result.suggestions) {
        const item = (resolve ? await resolve(suggestion, NEVER_CANCEL) : suggestion) ?? suggestion;
        const label = typeof item.label === 'string' ? item.label : item.label.label;
        const range =
          'startLineNumber' in item.range ? item.range : (item.range.insert ?? item.range.replace);
        out.push({
          label,
          insertText: item.insertText,
          startLine: range.startLineNumber,
          startColumn: range.startColumn,
          endLine: range.endLineNumber,
          endColumn: range.endColumn,
          ...(item.insertTextRules !== undefined ? { insertTextRules: item.insertTextRules } : {}),
          commitCharacters: item.commitCharacters ?? [],
          additionalTextEditCount: item.additionalTextEdits?.length ?? 0,
        });
      }
      return out;
    },
    __riftyTsReferences: async (
      path: string,
      line: number,
      col: number,
      includeDeclaration: boolean,
    ) => {
      const model = modelFor(path);
      if (!model) return null;
      const references = await providers.providers.reference.provideReferences(
        model,
        pos(line, col),
        { includeDeclaration },
        NEVER_CANCEL,
      );
      if (!references) return null;
      return references.map((reference) => ({
        uri: pathForUri(reference.uri),
        line: reference.range.startLineNumber,
        column: reference.range.startColumn,
      }));
    },
    __riftyTsPrepareRename: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const resolve = providers.providers.rename.resolveRenameLocation;
      if (!resolve) return null;
      const result = await resolve(model, pos(line, col), NEVER_CANCEL);
      if (!result) return null;
      if ('rejectReason' in result && result.rejectReason !== undefined) {
        return { rejectReason: result.rejectReason };
      }
      const location = result as monaco.languages.RenameLocation;
      return {
        text: location.text,
        line: location.range.startLineNumber,
        column: location.range.startColumn,
      };
    },
    __riftyTsRenameEdits: async (path: string, line: number, col: number, newName: string) => {
      const model = modelFor(path);
      if (!model) return null;
      const edit = await providers.providers.rename.provideRenameEdits(
        model,
        pos(line, col),
        newName,
        NEVER_CANCEL,
      );
      if (!edit) return null;
      const out: { uri: string; text: string; line: number; column: number }[] = [];
      for (const entry of edit.edits) {
        if (!('textEdit' in entry)) continue;
        const textEdit = entry as monaco.languages.IWorkspaceTextEdit;
        out.push({
          uri: pathForUri(textEdit.resource),
          text: textEdit.textEdit.text,
          line: textEdit.textEdit.range.startLineNumber,
          column: textEdit.textEdit.range.startColumn,
        });
      }
      return out;
    },
    __riftyTsSignatureHelp: async (path: string, line: number, col: number) => {
      const model = modelFor(path);
      if (!model) return null;
      const result = await providers.providers.signatureHelp.provideSignatureHelp(
        model,
        pos(line, col),
        NEVER_CANCEL,
        {
          triggerKind: mon.languages.SignatureHelpTriggerKind.Invoke,
          isRetrigger: false,
        },
      );
      if (!result) return null;
      const { value } = result;
      const signature = value.signatures[value.activeSignature];
      result.dispose();
      if (!signature) return null;
      return {
        label: signature.label,
        activeSignature: value.activeSignature,
        activeParameter: value.activeParameter,
      };
    },
    __riftyTsCodeFixes: async (
      path: string,
      startLine: number,
      startCol: number,
      endLine: number,
      endCol: number,
    ) => {
      const model = modelFor(path);
      if (!model) return [];
      const range = new mon.Range(startLine, startCol, endLine, endCol);
      const list = await providers.providers.codeAction.provideCodeActions(
        model,
        range,
        { markers: [], trigger: mon.languages.CodeActionTriggerType.Invoke },
        NEVER_CANCEL,
      );
      if (!list) return [];
      const actions = await Promise.all(
        list.actions.map(async (action) => {
          const resolved = await resolveCodeAction(action);
          return {
            title: resolved.title,
            ...(resolved.kind !== undefined ? { kind: resolved.kind } : {}),
            edits: codeActionEdits(resolved),
          };
        }),
      );
      list.dispose();
      return actions;
    },
    __riftyTsOrganizeImports: async (path: string) => {
      const model = modelFor(path);
      if (!model) return null;
      const list = await providers.providers.codeAction.provideCodeActions(
        model,
        model.getFullModelRange(),
        { markers: [], trigger: mon.languages.CodeActionTriggerType.Invoke },
        NEVER_CANCEL,
      );
      if (!list) return null;
      const organize = list.actions.find((action) => action.kind === 'source.organizeImports');
      const resolved = organize ? await resolveCodeAction(organize) : undefined;
      const result = resolved
        ? {
            title: resolved.title,
            ...(resolved.kind !== undefined ? { kind: resolved.kind } : {}),
            edits: codeActionEdits(resolved),
          }
        : null;
      list.dispose();
      return result;
    },
    __riftyTsFormat: async (path: string) => {
      const model = modelFor(path);
      if (!model) return null;
      const modelOptions = model.getOptions();
      const edits = await providers.providers.documentFormatting.provideDocumentFormattingEdits(
        model,
        { tabSize: modelOptions.tabSize, insertSpaces: modelOptions.insertSpaces },
        NEVER_CANCEL,
      );
      if (!edits) return null;
      const scratch = mon.editor.createModel(model.getValue(), model.getLanguageId());
      try {
        scratch.applyEdits(edits.map((edit) => ({ range: edit.range, text: edit.text })));
        return { editCount: edits.length, applied: scratch.getValue() };
      } finally {
        scratch.dispose();
      }
    },
    __riftyTsRangeSemanticTokenCount: async (
      path: string,
      startLine: number,
      startCol: number,
      endLine: number,
      endCol: number,
    ) => {
      const model = modelFor(path);
      if (!model) return null;
      const result =
        await providers.providers.rangeSemanticTokens.provideDocumentRangeSemanticTokens(
          model,
          new mon.Range(startLine, startCol, endLine, endCol),
          NEVER_CANCEL,
        );
      return result ? result.data.length : null;
    },
  } satisfies Required<PlaygroundTsDevHookGlobals>;

  const globals = globalThis as unknown as PlaygroundTsDevHookGlobals;
  Object.assign(globals, installed);
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      const mutableGlobals = globals as unknown as Record<string, unknown>;
      for (const [key, hook] of Object.entries(installed)) {
        if (mutableGlobals[key] === hook) mutableGlobals[key] = undefined;
      }
    },
  });
}
