/**
 * rifty-LS-backed Monaco providers — hover / definition / type-definition /
 * completions (ADR-0166 phase 2) + find-references / rename / signature-help
 * (ADR-0166 phase 3) + code-actions/quick-fixes / organize-imports / formatting
 * (ADR-0166 phase 4) for `javascript` + `typescript`.
 *
 * These RETIRE Monaco's built-in TS approximation (the isolated lib.d.ts-only
 * `ts.worker` that can't see the owner VFS / tsconfig / node_modules — the "stub
 * that lies" ADR-0166 rejects). Every query goes through the real
 * page↔owner↔LS relay {@link TsLanguageServiceClient}, so hover types, go-to-def
 * targets, completion candidates, references, rename edits, and signature help
 * reflect the REAL project + dependencies.
 *
 * Provider seam to the editor:
 *  - {@link EditorPathBridge.pathForModel} resolves the `model` a provider is
 *    handed → its VFS path (the service is keyed by path);
 *  - {@link EditorPathBridge.ensureModel} opens a go-to-def target file (sibling
 *    or node_modules `.d.ts`) read-only and returns its Monaco `Uri`, so a
 *    `Location` resolves to a real model + reveal range.
 *
 * Positions cross the {@link ./lsp-position.ts} seam (Monaco 1-based ↔ LSP
 * 0-based). Every async hop re-checks the `CancellationToken` so a moved cursor
 * abandons a stale request instead of flashing it.
 */

import type {
  CodeAction as LspCodeAction,
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  Hover as LspHover,
  Location as LspLocation,
  ParameterInformation as LspParameterInformation,
  SignatureHelp as LspSignatureHelp,
  SignatureInformation as LspSignatureInformation,
  TextEdit as LspTextEdit,
  MarkupContent,
} from '@riftydev/ts-language-service/lsp-types';
import { CompletionItemKind as LspCompletionItemKind } from '@riftydev/ts-language-service/lsp-types';
import * as monaco from 'monaco-editor';
import { lspToMonacoRange, monacoToLspPosition, monacoToLspRange } from './lsp-position.ts';
import type { TsLanguageServiceClient } from './ts-ls-client.ts';

/** The marker owner the rifty diagnostics pass sets (mirrors `EditorHost.setMarkers`). */
const RIFTY_MARKER_OWNER = 'rifty-ts';
/** LSP `CodeActionKind` for the organize-imports source action. */
const ORGANIZE_IMPORTS_KIND = 'source.organizeImports';

/** The minimal editor seam the providers need (subset of `EditorApi`). */
export interface EditorPathBridge {
  /** VFS path for an open model, or `undefined` if it is not one of ours. */
  pathForModel(model: monaco.editor.ITextModel): string | undefined;
  /** Open `path` read-only (no activate) and return its model `Uri`, or `undefined`. */
  ensureModel(path: string): monaco.Uri | undefined;
}

/** Languages the rifty LS serves (the same two Monaco maps to the TS worker). */
const LANGUAGES = ['typescript', 'javascript'] as const;

/** A completion-resolve needs the originating position + label — stash them per item. */
const RESOLVE_KEY = Symbol('rifty-ls-resolve');
interface ResolvableItem extends monaco.languages.CompletionItem {
  [RESOLVE_KEY]?: { readonly path: string; readonly line: number; readonly character: number };
}

/** LSP `CompletionItemKind` (1..25) → Monaco `CompletionItemKind`. */
function toMonacoCompletionKind(
  kind: LspCompletionItemKind | undefined,
): monaco.languages.CompletionItemKind {
  const M = monaco.languages.CompletionItemKind;
  switch (kind) {
    case LspCompletionItemKind.Method:
      return M.Method;
    case LspCompletionItemKind.Function:
      return M.Function;
    case LspCompletionItemKind.Constructor:
      return M.Constructor;
    case LspCompletionItemKind.Field:
      return M.Field;
    case LspCompletionItemKind.Variable:
      return M.Variable;
    case LspCompletionItemKind.Class:
      return M.Class;
    case LspCompletionItemKind.Struct:
      return M.Struct;
    case LspCompletionItemKind.Interface:
      return M.Interface;
    case LspCompletionItemKind.Module:
      return M.Module;
    case LspCompletionItemKind.Property:
      return M.Property;
    case LspCompletionItemKind.Event:
      return M.Event;
    case LspCompletionItemKind.Operator:
      return M.Operator;
    case LspCompletionItemKind.Unit:
      return M.Unit;
    case LspCompletionItemKind.Value:
      return M.Value;
    case LspCompletionItemKind.Constant:
      return M.Constant;
    case LspCompletionItemKind.Enum:
      return M.Enum;
    case LspCompletionItemKind.EnumMember:
      return M.EnumMember;
    case LspCompletionItemKind.Keyword:
      return M.Keyword;
    case LspCompletionItemKind.Color:
      return M.Color;
    case LspCompletionItemKind.File:
      return M.File;
    case LspCompletionItemKind.Reference:
      return M.Reference;
    case LspCompletionItemKind.Folder:
      return M.Folder;
    case LspCompletionItemKind.TypeParameter:
      return M.TypeParameter;
    case LspCompletionItemKind.Snippet:
      return M.Snippet;
    default: // Text + unmapped
      return M.Text;
  }
}

/** LSP `MarkupContent | string` documentation → a Monaco `IMarkdownString`. */
function toMarkdown(doc: string | MarkupContent | undefined): monaco.IMarkdownString | undefined {
  if (doc === undefined) return undefined;
  const value = typeof doc === 'string' ? doc : doc.value;
  return value.length > 0 ? { value } : undefined;
}

/** Map one LSP `Location` → a Monaco `Location`, opening its target model if needed. */
function toMonacoLocation(
  loc: LspLocation,
  bridge: EditorPathBridge,
): monaco.languages.Location | undefined {
  const uri = bridge.ensureModel(loc.uri);
  if (!uri) return undefined; // no model could be made (e.g. synthetic /ts-lib/)
  return { uri, range: lspToMonacoRange(loc.range) };
}

/** Build a Monaco `Hover` from the LSP `Hover` (markdown contents + optional range). */
function toMonacoHover(h: LspHover): monaco.languages.Hover {
  const contents: monaco.IMarkdownString[] = [{ value: h.contents.value }];
  return h.range ? { contents, range: lspToMonacoRange(h.range) } : { contents };
}

/** Map one LSP `ParameterInformation` → Monaco. The LSP label is always a string here. */
function toMonacoParameter(p: LspParameterInformation): monaco.languages.ParameterInformation {
  const docs = toMarkdown(p.documentation);
  return docs ? { label: p.label, documentation: docs } : { label: p.label };
}

/** Map one LSP `SignatureInformation` → Monaco (label + params + optional docs). */
function toMonacoSignature(s: LspSignatureInformation): monaco.languages.SignatureInformation {
  const docs = toMarkdown(s.documentation);
  const parameters = s.parameters.map(toMonacoParameter);
  return docs
    ? { label: s.label, documentation: docs, parameters }
    : { label: s.label, parameters };
}

/**
 * Build a Monaco `SignatureHelpResult` from the LSP `SignatureHelp`. The result
 * is `IDisposable`; rifty's payload holds no native resources, so `dispose` is a
 * no-op (Monaco still calls it when it drops the hint).
 */
function toMonacoSignatureHelp(sh: LspSignatureHelp): monaco.languages.SignatureHelpResult {
  return {
    value: {
      signatures: sh.signatures.map(toMonacoSignature),
      activeSignature: sh.activeSignature,
      activeParameter: sh.activeParameter,
    },
    dispose() {},
  };
}

/** Map one LSP `TextEdit` → Monaco's `{range, text}` (insert when the range is empty). */
function toMonacoTextEdit(e: LspTextEdit): monaco.languages.TextEdit {
  return { range: lspToMonacoRange(e.range), text: e.newText };
}

/**
 * Flatten an LSP `WorkspaceEdit` (`changes` keyed by document uri → `TextEdit[]`)
 * into Monaco's flat `IWorkspaceTextEdit[]`. Each uri is resolved to a model `Uri`
 * via {@link EditorPathBridge.ensureModel} (opening a sibling/dep buffer read-only
 * if needed). A file whose model can't be made is dropped — never an edit applied
 * to a phantom resource. `versionId: undefined` — the edit applies to the current
 * model version (the type permits it; no version is held across the relay).
 */
function toMonacoWorkspaceTextEdits(
  changes: Readonly<Record<string, LspTextEdit[]>>,
  bridge: EditorPathBridge,
): monaco.languages.IWorkspaceTextEdit[] {
  const edits: monaco.languages.IWorkspaceTextEdit[] = [];
  for (const [uri, textEdits] of Object.entries(changes)) {
    const resource = bridge.ensureModel(uri);
    if (!resource) continue;
    for (const textEdit of textEdits) {
      edits.push({ resource, textEdit: toMonacoTextEdit(textEdit), versionId: undefined });
    }
  }
  return edits;
}

/**
 * Map an LSP {@link LspCodeAction} → a Monaco `CodeAction`, resolving its
 * `edit.changes` uris to model Uris (so the action applies real edits). The
 * optional `diagnostics` ties a quick-fix to the markers it addresses (Monaco
 * groups/labels it under them). An action whose edit resolves to no resources is
 * still returned (its title can carry a command-less hint), but here every rifty
 * action carries an edit.
 */
function toMonacoCodeAction(
  action: LspCodeAction,
  bridge: EditorPathBridge,
  diagnostics?: monaco.editor.IMarkerData[],
): monaco.languages.CodeAction {
  const out: monaco.languages.CodeAction = { title: action.title };
  if (action.kind !== undefined) out.kind = action.kind;
  if (action.isPreferred !== undefined) out.isPreferred = action.isPreferred;
  if (action.edit) out.edit = { edits: toMonacoWorkspaceTextEdits(action.edit.changes, bridge) };
  if (diagnostics && diagnostics.length > 0) out.diagnostics = diagnostics;
  return out;
}

/**
 * Parse a Monaco marker `code` (string, or `{value,target}`) to the numeric TS
 * error number the service keys code-fixes by — `undefined` if non-numeric. The
 * rifty diagnostics pass stringifies the LSP `Diagnostic.code` (the TS error
 * number) into the marker, so this reverses that.
 */
function markerErrorCode(code: monaco.editor.IMarkerData['code']): number | undefined {
  const raw = typeof code === 'string' ? code : code?.value;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * A `resolveRenameLocation` rejection. Monaco types the return as the intersection
 * `RenameLocation & Rejection` (so range/text are nominally required), yet its
 * runtime keys on `rejectReason` first and a real rejection carries no span — the
 * cast bridges that monaco modeling quirk without lying (no fake range is built).
 */
function renameRejection(
  reason: string,
): monaco.languages.RenameLocation & monaco.languages.Rejection {
  return { rejectReason: reason } as monaco.languages.RenameLocation & monaco.languages.Rejection;
}

/**
 * Handle returned by {@link registerTsLanguageServiceProviders}. `dispose`
 * unregisters every provider; `providers` exposes the SAME registered provider
 * objects Monaco calls — a DEV-only e2e hook drives them directly (deterministic,
 * no flaky hover-widget / suggest-dropdown rendering) so the assertion exercises
 * the exact registered code, not a reimplementation.
 */
export interface TsLanguageServiceProvidersHandle {
  dispose(): void;
  readonly providers: {
    readonly hover: monaco.languages.HoverProvider;
    readonly definition: monaco.languages.DefinitionProvider;
    readonly typeDefinition: monaco.languages.TypeDefinitionProvider;
    readonly completion: monaco.languages.CompletionItemProvider;
    readonly reference: monaco.languages.ReferenceProvider;
    readonly rename: monaco.languages.RenameProvider;
    readonly signatureHelp: monaco.languages.SignatureHelpProvider;
    readonly codeAction: monaco.languages.CodeActionProvider;
    readonly documentFormatting: monaco.languages.DocumentFormattingEditProvider;
    readonly documentRangeFormatting: monaco.languages.DocumentRangeFormattingEditProvider;
  };
}

/**
 * Register all rifty-LS Monaco providers (hover / def / type-def / completions)
 * for `javascript` + `typescript`. Returns a disposer that unregisters every
 * provider (so the App effect can tear them down with the LS client — no leak,
 * no stale provider pointing at a disposed client).
 */
export function registerTsLanguageServiceProviders(
  client: TsLanguageServiceClient,
  bridge: EditorPathBridge,
): TsLanguageServiceProvidersHandle {
  const disposables: monaco.IDisposable[] = [];

  const hoverProvider: monaco.languages.HoverProvider = {
    async provideHover(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const hover = await client.getQuickInfo(path, monacoToLspPosition(position));
      if (token.isCancellationRequested || !hover || hover.contents.value.length === 0) return null;
      return toMonacoHover(hover);
    },
  };

  const definitionProvider: monaco.languages.DefinitionProvider = {
    async provideDefinition(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const locations = await client.getDefinition(path, monacoToLspPosition(position));
      if (token.isCancellationRequested) return null;
      return locations
        .map((loc) => toMonacoLocation(loc, bridge))
        .filter((l): l is monaco.languages.Location => l !== undefined);
    },
  };

  const typeDefinitionProvider: monaco.languages.TypeDefinitionProvider = {
    async provideTypeDefinition(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const locations = await client.getTypeDefinition(path, monacoToLspPosition(position));
      if (token.isCancellationRequested) return null;
      return locations
        .map((loc) => toMonacoLocation(loc, bridge))
        .filter((l): l is monaco.languages.Location => l !== undefined);
    },
  };

  const completionProvider: monaco.languages.CompletionItemProvider = {
    // '.' so a member access (`foo.|`) triggers the list; identifier typing
    // triggers it via Monaco's default word-character behavior.
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position, _context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { suggestions: [] };
      const lspPosition = monacoToLspPosition(position);
      const list: LspCompletionList = await client.getCompletions(path, lspPosition);
      if (token.isCancellationRequested) return { suggestions: [] };
      // The completion replaces the word being typed up to the cursor (member
      // names, partial identifiers) — a single-line range Monaco requires.
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };
      const suggestions: ResolvableItem[] = list.items.map((entry: LspCompletionItem) => {
        const item: ResolvableItem = {
          label: entry.label,
          kind: toMonacoCompletionKind(entry.kind),
          insertText: entry.insertText ?? entry.label,
          range,
          ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
          ...(entry.sortText !== undefined ? { sortText: entry.sortText } : {}),
          ...(entry.filterText !== undefined ? { filterText: entry.filterText } : {}),
        };
        const docs = toMarkdown(entry.documentation);
        if (docs) item.documentation = docs;
        // Stash the resolve coordinates: `resolveCompletionItem` re-queries the
        // service by (path, position, label) to fill detail + docs lazily.
        item[RESOLVE_KEY] = { path, line: lspPosition.line, character: lspPosition.character };
        return item;
      });
      return { suggestions, incomplete: list.isIncomplete };
    },
    async resolveCompletionItem(item, token) {
      const ctx = (item as ResolvableItem)[RESOLVE_KEY];
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      if (!ctx) return item;
      const resolved = await client.getCompletionDetails(
        ctx.path,
        { line: ctx.line, character: ctx.character },
        label,
      );
      if (token.isCancellationRequested || !resolved) return item;
      if (resolved.detail !== undefined) item.detail = resolved.detail;
      const docs = toMarkdown(resolved.documentation);
      if (docs) item.documentation = docs;
      return item;
    },
  };

  const referenceProvider: monaco.languages.ReferenceProvider = {
    async provideReferences(model, position, context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const refs = await client.getReferences(path, monacoToLspPosition(position), {
        includeDeclaration: context.includeDeclaration,
      });
      if (token.isCancellationRequested) return null;
      // Each reference is a Location in some project file; resolve its uri → model
      // (a sibling/dep buffer is opened read-only) so the peek/results list reveals
      // the real span. A Location whose model can't be made is dropped (never faked).
      return refs
        .map((loc) => toMonacoLocation(loc, bridge))
        .filter((l): l is monaco.languages.Location => l !== undefined);
    },
  };

  const renameProvider: monaco.languages.RenameProvider = {
    async resolveRenameLocation(model, position, token) {
      const path = bridge.pathForModel(model);
      // Reject (not return null) so Monaco shows "cannot rename here" — the
      // RenameProvider resolve contract uses `rejectReason`, not a null sentinel.
      // Monaco's return type is the intersection `RenameLocation & Rejection`, but
      // its runtime keys on `rejectReason` first: a pure rejection legitimately
      // carries no range/text, so the cast bridges that monaco modeling quirk.
      if (!path) return renameRejection('Not a rifty TypeScript document');
      const result = await client.prepareRename(path, monacoToLspPosition(position));
      if (token.isCancellationRequested) return renameRejection('Rename cancelled');
      if (!result) return renameRejection('You cannot rename this element');
      return { range: lspToMonacoRange(result.range), text: result.placeholder };
    },
    async provideRenameEdits(model, position, newName, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { edits: [], rejectReason: 'Not a rifty TypeScript document' };
      const edit = await client.getRenameEdits(path, monacoToLspPosition(position), newName);
      if (token.isCancellationRequested) return { edits: [], rejectReason: 'Rename cancelled' };
      // WorkspaceEdit.changes is keyed by document uri (the VFS path verbatim);
      // flatten it into Monaco's `edits: IWorkspaceTextEdit[]`, resolving each uri
      // → model Uri (a file whose model can't be made is dropped, never faked).
      return { edits: toMonacoWorkspaceTextEdits(edit.changes, bridge) };
    },
  };

  const signatureHelpProvider: monaco.languages.SignatureHelpProvider = {
    // '(' opens the hint on a fresh call, ',' advances to the next argument;
    // ')' retriggers so closing one nested call falls back to the enclosing one.
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position, token, _context) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const help = await client.getSignatureHelp(path, monacoToLspPosition(position));
      if (token.isCancellationRequested || !help) return null;
      return toMonacoSignatureHelp(help);
    },
  };

  const codeActionProvider: monaco.languages.CodeActionProvider = {
    async provideCodeActions(model, range, _context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return undefined;
      const actions: monaco.languages.CodeAction[] = [];

      // Quick-fixes: tsc only returns a fix when the request span lies WITHIN the
      // diagnostic span, so query per rifty-TS diagnostic OVERLAPPING `range` using
      // THAT diagnostic's own span + code (not the user's selection). Source the
      // diagnostics from the rifty marker owner (Monaco's `context.markers` are not
      // owner-tagged), intersected with `range`. Coalesce duplicate fix titles
      // across diagnostics so the menu doesn't list the same fix twice.
      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri, owner: RIFTY_MARKER_OWNER })
        .filter((m) => monaco.Range.areIntersectingOrTouching(range, m as monaco.IRange));
      const seenFixTitles = new Set<string>();
      for (const marker of markers) {
        const code = markerErrorCode(marker.code);
        if (code === undefined) continue;
        const fixes = await client.getCodeFixes(path, monacoToLspRange(marker), [code]);
        if (token.isCancellationRequested) return { actions: [], dispose() {} };
        for (const fix of fixes) {
          if (seenFixTitles.has(fix.title)) continue;
          seenFixTitles.add(fix.title);
          actions.push(toMonacoCodeAction(fix, bridge, [marker]));
        }
      }

      // Organize-imports: ALWAYS offered (a source action, independent of the
      // selection). An already-organized file yields an empty `changes` → an action
      // with no resources; only push it when it carries real edits so the menu
      // doesn't show a no-op entry.
      const organize = await client.organizeImports(path);
      if (token.isCancellationRequested) return { actions: [], dispose() {} };
      const organizeEdits = toMonacoWorkspaceTextEdits(organize.changes, bridge);
      if (organizeEdits.length > 0) {
        actions.push({
          title: 'Organize imports',
          kind: ORGANIZE_IMPORTS_KIND,
          edit: { edits: organizeEdits },
        });
      }

      return { actions, dispose() {} };
    },
  };

  const documentFormattingProvider: monaco.languages.DocumentFormattingEditProvider = {
    displayName: 'rifty TypeScript',
    async provideDocumentFormattingEdits(model, options, token) {
      const path = bridge.pathForModel(model);
      if (!path) return undefined;
      // Pull the EDITOR's indent settings (the `options` Monaco passes derive from
      // the model's resolved options too, but read the model directly so the source
      // is unambiguous): tabSize + insertSpaces feed the service's FormatCodeSettings.
      const modelOptions = model.getOptions();
      const edits = await client.getFormattingEdits(path, {
        tabSize: options.tabSize ?? modelOptions.tabSize,
        insertSpaces: options.insertSpaces ?? modelOptions.insertSpaces,
      });
      if (token.isCancellationRequested) return undefined;
      return edits.map(toMonacoTextEdit);
    },
  };

  const documentRangeFormattingProvider: monaco.languages.DocumentRangeFormattingEditProvider = {
    displayName: 'rifty TypeScript',
    async provideDocumentRangeFormattingEdits(model, range, options, token) {
      const path = bridge.pathForModel(model);
      if (!path) return undefined;
      const modelOptions = model.getOptions();
      const edits = await client.getRangeFormattingEdits(path, monacoToLspRange(range), {
        tabSize: options.tabSize ?? modelOptions.tabSize,
        insertSpaces: options.insertSpaces ?? modelOptions.insertSpaces,
      });
      if (token.isCancellationRequested) return undefined;
      return edits.map(toMonacoTextEdit);
    },
  };

  for (const language of LANGUAGES) {
    disposables.push(monaco.languages.registerHoverProvider(language, hoverProvider));
    disposables.push(monaco.languages.registerDefinitionProvider(language, definitionProvider));
    disposables.push(
      monaco.languages.registerTypeDefinitionProvider(language, typeDefinitionProvider),
    );
    disposables.push(monaco.languages.registerCompletionItemProvider(language, completionProvider));
    disposables.push(monaco.languages.registerReferenceProvider(language, referenceProvider));
    disposables.push(monaco.languages.registerRenameProvider(language, renameProvider));
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(language, signatureHelpProvider),
    );
    // `providedCodeActionKinds` lets Monaco skip the provider when only a
    // non-matching kind is requested; we serve quickfixes + organize-imports.
    disposables.push(
      monaco.languages.registerCodeActionProvider(language, codeActionProvider, {
        providedCodeActionKinds: ['quickfix', ORGANIZE_IMPORTS_KIND],
      }),
    );
    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(language, documentFormattingProvider),
    );
    disposables.push(
      monaco.languages.registerDocumentRangeFormattingEditProvider(
        language,
        documentRangeFormattingProvider,
      ),
    );
  }

  return {
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
    providers: {
      hover: hoverProvider,
      definition: definitionProvider,
      typeDefinition: typeDefinitionProvider,
      completion: completionProvider,
      reference: referenceProvider,
      rename: renameProvider,
      signatureHelp: signatureHelpProvider,
      codeAction: codeActionProvider,
      documentFormatting: documentFormattingProvider,
      documentRangeFormatting: documentRangeFormattingProvider,
    },
  };
}
