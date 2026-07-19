/**
 * rifty-LS-backed Monaco providers — hover / definition / type-definition /
 * completions (ADR-0166 phase 2) + find-references / rename / signature-help
 * (ADR-0166 phase 3) + code-actions/quick-fixes / organize-imports / formatting
 * (ADR-0166 phase 4) for `javascript` + `typescript`.
 *
 * These RETIRE Monaco's built-in TS approximation (the isolated lib.d.ts-only
 * `ts.worker` that can't see the owner VFS / tsconfig / node_modules — the "stub
 * that lies" ADR-0166 rejects). Every query goes through the real
 * companion semantic interface, so hover types, go-to-def
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
  CompletionOptions as LspCompletionOptions,
  CompletionTriggerCharacter as LspCompletionTriggerCharacter,
  CompletionTriggerKind as LspCompletionTriggerKind,
  DefinitionLinks as LspDefinitionLinks,
  DocumentHighlight as LspDocumentHighlight,
  DocumentSymbol as LspDocumentSymbol,
  EncodedClassifications as LspEncodedClassifications,
  FoldingRange as LspFoldingRange,
  Hover as LspHover,
  InlayHint as LspInlayHint,
  Location as LspLocation,
  LocationLink as LspLocationLink,
  ParameterInformation as LspParameterInformation,
  SelectionRange as LspSelectionRange,
  SignatureHelp as LspSignatureHelp,
  SignatureHelpOptions as LspSignatureHelpOptions,
  SignatureHelpRetriggerCharacter as LspSignatureHelpRetriggerCharacter,
  SignatureHelpTriggerCharacter as LspSignatureHelpTriggerCharacter,
  SignatureInformation as LspSignatureInformation,
  TextEdit as LspTextEdit,
  WorkspaceEdit as LspWorkspaceEdit,
  MarkupContent,
} from '@riftydev/ts-language-service/lsp-types';
import {
  CompletionItemKind as LspCompletionItemKind,
  DocumentHighlightKind as LspDocumentHighlightKind,
  type SymbolKind as LspSymbolKind,
  type TypeScriptFormatCodeSettings as LspTypeScriptFormatCodeSettings,
} from '@riftydev/ts-language-service/lsp-types';
import type { PlaygroundTypeScript } from '@riftydev/workbench/playground';
import * as monaco from 'monaco-editor';
import { lspToMonacoRange, monacoToLspPosition, monacoToLspRange } from './lsp-position.ts';

/** Semantic query surface consumed by Monaco; transport/lifecycle stay outside this seam. */
export type TsLanguageServiceProviderClient = Pick<
  PlaygroundTypeScript,
  | 'getCodeFixes'
  | 'getCombinedCodeFix'
  | 'getCompletionDetails'
  | 'getCompletions'
  | 'getDefinitionLinks'
  | 'getDocumentHighlights'
  | 'getDocumentSymbols'
  | 'getEncodedSemanticClassifications'
  | 'getFoldingRanges'
  | 'getFormattingEdits'
  | 'getImplementation'
  | 'getInlayHints'
  | 'getLinkedEditingRange'
  | 'getOnTypeFormattingEdits'
  | 'getQuickInfo'
  | 'getRangeFormattingEdits'
  | 'getRefactorActions'
  | 'getReferences'
  | 'getRenameEdits'
  | 'getSelectionRange'
  | 'getSignatureHelp'
  | 'getTypeDefinition'
  | 'organizeImports'
  | 'prepareRename'
>;

/** The marker owner the rifty diagnostics pass sets (mirrors `EditorHost.setMarkers`). */
const RIFTY_MARKER_OWNER = 'rifty-ts';
/** LSP `CodeActionKind` for the organize-imports source action. */
const ORGANIZE_IMPORTS_KIND = 'source.organizeImports';
const FIX_ALL_KIND = 'source.fixAll.ts';
const APPLY_COMPLETION_WORKSPACE_EDIT_COMMAND = 'rifty.ts.applyCompletionWorkspaceEdit';
const MISSING_WORKSPACE_TYPESCRIPT_ERROR =
  'TypeScript is not installed in this project; run npm install -D typescript';
const BROKEN_WORKSPACE_TYPESCRIPT_ERROR = 'has no resolvable compiler entry';
const UNREADABLE_WORKSPACE_TYPESCRIPT_LIB_ERROR = 'workspace TypeScript lib unreadable';

/** The minimal editor seam the providers need (subset of `EditorApi`). */
export interface EditorPathBridge {
  /** VFS path for an open model, or `undefined` if it is not one of ours. */
  pathForModel(model: monaco.editor.ITextModel): string | undefined;
  /** Open `path` read-only (no activate) and return its model `Uri`, or `undefined`. */
  ensureModel(path: string, options?: { readonly isNewFile?: boolean }): monaco.Uri | undefined;
  /** Dry-run check used to validate workspace edits before opening/creating targets. */
  canEnsureModel(path: string, options?: { readonly isNewFile?: boolean }): boolean;
}

/** Languages the rifty LS serves (the same two Monaco maps to the TS worker). */
const LANGUAGES = ['typescript', 'javascript'] as const;
const TS_COMPLETION_TRIGGER_CHARACTERS = ['.', '"', "'", '`', '/', '@', '<', '#', ' '] as const;
const TS_SIGNATURE_TRIGGER_CHARACTERS = ['(', ',', '<'] as const;
const TS_SIGNATURE_RETRIGGER_CHARACTERS = [')', ...TS_SIGNATURE_TRIGGER_CHARACTERS] as const;
const DISPOSED_CLIENT_ERROR = 'ts-lsp client disposed';

function isDisposedClientError(err: unknown): boolean {
  return err instanceof Error && err.message === DISPOSED_CLIENT_ERROR;
}

function isTsUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes(MISSING_WORKSPACE_TYPESCRIPT_ERROR) ||
    err.message.includes(BROKEN_WORKSPACE_TYPESCRIPT_ERROR) ||
    err.message.includes(UNREADABLE_WORKSPACE_TYPESCRIPT_LIB_ERROR)
  );
}

function isProviderLifecycleError(err: unknown): boolean {
  return isDisposedClientError(err) || isTsUnavailableError(err);
}

async function tsRequestOr<T>(request: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (isProviderLifecycleError(err)) return fallback;
    throw err;
  }
}

type TsRequestResult<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'disposed' };

async function tsRequestResult<T>(request: () => Promise<T>): Promise<TsRequestResult<T>> {
  try {
    return { status: 'ok', value: await request() };
  } catch (err) {
    if (isProviderLifecycleError(err)) return { status: 'disposed' };
    throw err;
  }
}

function emptyDefinitionLinks(): LspDefinitionLinks {
  return { locations: [] };
}

function emptyWorkspaceEdit(): LspWorkspaceEdit {
  return { changes: {} };
}

function emptyEncodedClassifications(): LspEncodedClassifications {
  return { spans: [], endOfLineState: 0 };
}

function emptyCompletionList(): LspCompletionList {
  return {
    isIncomplete: false,
    isGlobalCompletion: false,
    isMemberCompletion: false,
    isNewIdentifierLocation: false,
    items: [],
  };
}

function emptyCodeActions(): monaco.languages.CodeActionList {
  return { actions: [], dispose() {} };
}

/** A completion-resolve needs the originating position + label — stash them per item. */
const RESOLVE_KEY = Symbol('rifty-ls-resolve');
interface ResolvableItem extends monaco.languages.CompletionItem {
  [RESOLVE_KEY]?: {
    readonly path: string;
    readonly line: number;
    readonly character: number;
    readonly source?: string;
    readonly data?: unknown;
    readonly options: LspCompletionOptions;
  };
}

const CODE_ACTION_KEY = Symbol('rifty-ls-code-action');
interface ResolvableCodeAction extends monaco.languages.CodeAction {
  [CODE_ACTION_KEY]?: LspCodeAction;
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

function toMonacoLocationLink(
  link: LspLocationLink,
  originSelectionRange: LspLocationLink['originSelectionRange'],
  bridge: EditorPathBridge,
): monaco.languages.LocationLink | undefined {
  const uri = bridge.ensureModel(link.targetUri);
  if (!uri) return undefined;
  const origin = link.originSelectionRange ?? originSelectionRange;
  return {
    uri,
    range: lspToMonacoRange(link.targetRange),
    targetSelectionRange: lspToMonacoRange(link.targetSelectionRange),
    ...(origin !== undefined ? { originSelectionRange: lspToMonacoRange(origin) } : {}),
  };
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

function toMonacoSingleEdit(e: LspTextEdit): monaco.editor.ISingleEditOperation {
  return { range: lspToMonacoRange(e.range), text: e.newText };
}

function toMonacoSymbolKind(kind: LspSymbolKind): monaco.languages.SymbolKind {
  return Math.max(0, kind - 1) as monaco.languages.SymbolKind;
}

function toMonacoDocumentSymbol(symbol: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: toMonacoSymbolKind(symbol.kind),
    tags: [],
    range: lspToMonacoRange(symbol.range),
    selectionRange: lspToMonacoRange(symbol.selectionRange),
    ...(symbol.children ? { children: symbol.children.map(toMonacoDocumentSymbol) } : {}),
  };
}

function toMonacoFoldingRange(range: LspFoldingRange): monaco.languages.FoldingRange {
  return {
    start: range.startLine + 1,
    end: range.endLine + 1,
    ...(range.kind ? { kind: monaco.languages.FoldingRangeKind.fromValue(range.kind) } : {}),
  };
}

function toMonacoInlayHint(hint: LspInlayHint): monaco.languages.InlayHint {
  const kind =
    hint.kind === 'Parameter'
      ? monaco.languages.InlayHintKind.Parameter
      : hint.kind === 'Type' || hint.kind === 'Enum'
        ? monaco.languages.InlayHintKind.Type
        : undefined;
  return {
    label: hint.label,
    position: {
      lineNumber: hint.position.line + 1,
      column: hint.position.character + 1,
    },
    ...(kind !== undefined ? { kind } : {}),
    ...(hint.paddingLeft !== undefined ? { paddingLeft: hint.paddingLeft } : {}),
    ...(hint.paddingRight !== undefined ? { paddingRight: hint.paddingRight } : {}),
  };
}

function toMonacoDocumentHighlight(
  highlight: LspDocumentHighlight,
): monaco.languages.DocumentHighlight {
  const kind =
    highlight.kind === LspDocumentHighlightKind.Write
      ? monaco.languages.DocumentHighlightKind.Write
      : highlight.kind === LspDocumentHighlightKind.Read
        ? monaco.languages.DocumentHighlightKind.Read
        : monaco.languages.DocumentHighlightKind.Text;
  return { range: lspToMonacoRange(highlight.range), kind };
}

function toMonacoSelectionRange(range: LspSelectionRange): monaco.languages.SelectionRange[] {
  const out: monaco.languages.SelectionRange[] = [];
  let current: LspSelectionRange | undefined = range;
  while (current) {
    out.push({ range: lspToMonacoRange(current.range) });
    current = current.parent;
  }
  return out;
}

function wordPattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function isCompletionTriggerCharacter(ch: string | undefined): ch is LspCompletionTriggerCharacter {
  return ch !== undefined && (TS_COMPLETION_TRIGGER_CHARACTERS as readonly string[]).includes(ch);
}

function completionTriggerKindFromMonaco(
  kind: monaco.languages.CompletionTriggerKind,
): LspCompletionTriggerKind {
  switch (kind) {
    case monaco.languages.CompletionTriggerKind.TriggerCharacter:
      return 'trigger-character';
    case monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions:
      return 'trigger-for-incomplete';
    default:
      return 'invoked';
  }
}

function completionOptionsFromMonaco(
  context: monaco.languages.CompletionContext,
): Pick<LspCompletionOptions, 'triggerCharacter' | 'triggerKind'> {
  return {
    triggerKind: completionTriggerKindFromMonaco(context.triggerKind),
    ...(isCompletionTriggerCharacter(context.triggerCharacter)
      ? { triggerCharacter: context.triggerCharacter }
      : {}),
  };
}

function completionOptionsFromModel(
  model: monaco.editor.ITextModel,
  context: monaco.languages.CompletionContext,
): LspCompletionOptions {
  return {
    includeCompletionsForModuleExports: true,
    includeInsertTextCompletions: true,
    includeCompletionsWithSnippetText: true,
    ...completionOptionsFromMonaco(context),
    ...actionEditOptionsFromModel(model),
  };
}

function actionEditOptionsFromModel(model: monaco.editor.ITextModel): {
  readonly formattingOptions: LspTypeScriptFormatCodeSettings;
} {
  const modelOptions = model.getOptions();
  return {
    formattingOptions: {
      tabSize: modelOptions.tabSize,
      insertSpaces: modelOptions.insertSpaces,
    },
  };
}

function isSignatureTriggerCharacter(
  ch: string | undefined,
): ch is LspSignatureHelpTriggerCharacter {
  return ch !== undefined && (TS_SIGNATURE_TRIGGER_CHARACTERS as readonly string[]).includes(ch);
}

function isSignatureRetriggerCharacter(
  ch: string | undefined,
): ch is LspSignatureHelpRetriggerCharacter {
  return ch !== undefined && (TS_SIGNATURE_RETRIGGER_CHARACTERS as readonly string[]).includes(ch);
}

function signatureHelpOptionsFromMonaco(
  context: monaco.languages.SignatureHelpContext,
): LspSignatureHelpOptions {
  if (context.triggerKind === monaco.languages.SignatureHelpTriggerKind.TriggerCharacter) {
    return {
      triggerReason: isSignatureTriggerCharacter(context.triggerCharacter)
        ? { kind: 'characterTyped', triggerCharacter: context.triggerCharacter }
        : { kind: 'invoked' },
    };
  }
  if (context.triggerKind === monaco.languages.SignatureHelpTriggerKind.ContentChange) {
    return {
      triggerReason: {
        kind: 'retrigger',
        ...(isSignatureRetriggerCharacter(context.triggerCharacter)
          ? { triggerCharacter: context.triggerCharacter }
          : {}),
      },
    };
  }
  return { triggerReason: { kind: 'invoked' } };
}

const SEMANTIC_TOKEN_TYPES = [
  'class',
  'enum',
  'interface',
  'namespace',
  'typeParameter',
  'type',
  'parameter',
  'variable',
  'enumMember',
  'property',
  'function',
  'member',
] as const;

const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'static',
  'async',
  'readonly',
  'defaultLibrary',
  'local',
] as const;

function semanticTokenType(classification: number): number {
  const tokenType = (classification >> 8) - 1;
  return Math.max(0, Math.min(SEMANTIC_TOKEN_TYPES.length - 1, tokenType));
}

function semanticTokensData(
  model: monaco.editor.ITextModel,
  spans: readonly number[],
): Uint32Array {
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (let i = 0; i + 2 < spans.length; i += 3) {
    const start = spans[i] ?? 0;
    const length = spans[i + 1] ?? 0;
    const classification = spans[i + 2] ?? 0;
    if (length <= 0) continue;
    const pos = model.getPositionAt(start);
    const line = pos.lineNumber - 1;
    const char = pos.column - 1;
    const deltaLine = line - prevLine;
    const deltaChar = deltaLine === 0 ? char - prevChar : char;
    data.push(
      deltaLine,
      deltaChar,
      length,
      semanticTokenType(classification),
      classification & 0xff,
    );
    prevLine = line;
    prevChar = char;
  }
  return new Uint32Array(data);
}

function hasDeprecatedModifier(kindModifiers: string | undefined): boolean {
  return kindModifiers?.split(/[,\s]+/).includes('deprecated') ?? false;
}

function toMonacoCompletionLabel(
  entry: Pick<LspCompletionItem, 'label' | 'labelDetails' | 'sourceDisplay'>,
): monaco.languages.CompletionItem['label'] {
  const detail = entry.labelDetails?.detail;
  const description = entry.labelDetails?.description ?? entry.sourceDisplay;
  return detail !== undefined || description !== undefined
    ? {
        label: entry.label,
        ...(detail !== undefined ? { detail } : {}),
        ...(description !== undefined ? { description } : {}),
      }
    : entry.label;
}

function applyCompletionSourceDisplay(
  item: monaco.languages.CompletionItem,
  sourceDisplay: string | undefined,
): void {
  if (sourceDisplay === undefined) return;
  const label = typeof item.label === 'string' ? { label: item.label } : { ...item.label };
  if (label.description === undefined) {
    item.label = { ...label, description: sourceDisplay };
  }
}

/**
 * Flatten an LSP `WorkspaceEdit` (`changes` keyed by document uri → `TextEdit[]`)
 * into Monaco's flat `IWorkspaceTextEdit[]`. Each uri is resolved to a model `Uri`
 * via {@link EditorPathBridge.ensureModel} (opening a sibling/dep buffer read-only
 * if needed). The edit is atomic at the relay boundary: if any target cannot be
 * opened, no partial edit is returned/applied.
 */
function resolveWorkspaceEditTargets(
  edit: Pick<LspWorkspaceEdit, 'changes' | 'newFiles'>,
  bridge: EditorPathBridge,
): Array<{
  readonly resource: monaco.Uri;
  readonly model: monaco.editor.ITextModel;
  readonly textEdits: readonly LspTextEdit[];
}> | null {
  const targets: Array<{
    readonly resource: monaco.Uri;
    readonly model: monaco.editor.ITextModel;
    readonly textEdits: readonly LspTextEdit[];
  }> = [];
  for (const uri of Object.keys(edit.changes)) {
    const isNewFile = edit.newFiles?.includes(uri) ?? false;
    if (!bridge.canEnsureModel(uri, { isNewFile })) return null;
  }
  for (const [uri, textEdits] of Object.entries(edit.changes)) {
    const isNewFile = edit.newFiles?.includes(uri) ?? false;
    const resource = bridge.ensureModel(uri, { isNewFile });
    if (!resource) return null;
    const model = monaco.editor.getModel(resource);
    if (!model) return null;
    targets.push({ resource, model, textEdits });
  }
  return targets;
}

function toMonacoWorkspaceTextEdits(
  edit: Pick<LspWorkspaceEdit, 'changes' | 'newFiles'>,
  bridge: EditorPathBridge,
): monaco.languages.IWorkspaceTextEdit[] | null {
  const targets = resolveWorkspaceEditTargets(edit, bridge);
  if (targets === null) return null;
  const edits: monaco.languages.IWorkspaceTextEdit[] = [];
  for (const target of targets) {
    for (const textEdit of target.textEdits) {
      edits.push({
        resource: target.resource,
        textEdit: toMonacoTextEdit(textEdit),
        versionId: undefined,
      });
    }
  }
  return edits;
}

export function applyWorkspaceTextEdit(edit: LspWorkspaceEdit, bridge: EditorPathBridge): boolean {
  const targets = resolveWorkspaceEditTargets(edit, bridge);
  if (targets === null) return false;
  for (const { model, textEdits } of targets) {
    model.applyEdits(textEdits.map(toMonacoSingleEdit));
  }
  return true;
}

function hasWorkspaceEditCommands(edit: LspWorkspaceEdit | undefined): boolean {
  return (edit?.commands?.length ?? 0) > 0;
}

function hasTsSideEffectCommands(action: LspCodeAction): boolean {
  return (action.commands?.length ?? 0) > 0 || hasWorkspaceEditCommands(action.edit);
}

function canApplyInMonacoEditor(action: LspCodeAction): boolean {
  // TODO(backlog: playground/ts-refactor-interactive-ui): custom UI for interactive/post-edit rename refactors.
  if (hasTsSideEffectCommands(action)) return false;
  return action.edit?.renameLocation === undefined && action.edit?.renameFilename === undefined;
}

function hasWorkspaceTextEdits(edit: Pick<LspWorkspaceEdit, 'changes'>): boolean {
  return Object.values(edit.changes).some((textEdits) => textEdits.length > 0);
}

/**
 * Map an LSP {@link LspCodeAction} → an unresolved Monaco `CodeAction`.
 * `resolveCodeAction` fills the edit only after the user chooses it, avoiding
 * discovery-time side effects such as creating a new-file model.
 */
function toMonacoLazyCodeAction(
  action: LspCodeAction,
  diagnostics?: monaco.editor.IMarkerData[],
): ResolvableCodeAction {
  const out: ResolvableCodeAction = { title: action.title };
  if (action.kind !== undefined) out.kind = action.kind;
  if (action.isPreferred !== undefined) out.isPreferred = action.isPreferred;
  if (hasTsSideEffectCommands(action)) return out;
  if (diagnostics && diagnostics.length > 0) out.diagnostics = diagnostics;
  out[CODE_ACTION_KEY] = action;
  return out;
}

function toMonacoResolvedCodeAction(
  action: monaco.languages.CodeAction,
  bridge: EditorPathBridge,
): monaco.languages.CodeAction {
  const lsp = (action as ResolvableCodeAction)[CODE_ACTION_KEY];
  if (!lsp || hasTsSideEffectCommands(lsp)) return action;
  if (lsp.edit) {
    const edits = toMonacoWorkspaceTextEdits(lsp.edit, bridge);
    if (edits === null) {
      throw new Error('TypeScript workspace edit target could not be opened');
    }
    action.edit = { edits };
  }
  return action;
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
    readonly implementation: monaco.languages.ImplementationProvider;
    readonly documentSymbol: monaco.languages.DocumentSymbolProvider;
    readonly foldingRange: monaco.languages.FoldingRangeProvider;
    readonly inlayHints: monaco.languages.InlayHintsProvider;
    readonly documentHighlight: monaco.languages.DocumentHighlightProvider;
    readonly semanticTokens: monaco.languages.DocumentSemanticTokensProvider;
    readonly rangeSemanticTokens: monaco.languages.DocumentRangeSemanticTokensProvider;
    readonly selectionRange: monaco.languages.SelectionRangeProvider;
    readonly onTypeFormatting: monaco.languages.OnTypeFormattingEditProvider;
    readonly linkedEditingRange: monaco.languages.LinkedEditingRangeProvider;
  };
}

export interface TsLanguageServiceProviderOptions {
  /**
   * Awaited before provider requests. The App uses this to keep user-facing
   * editor actions behind the current `ts:init` + open-document replay, without
   * disposing providers during same-owner starter reseeds.
   */
  beforeRequest?(): Promise<void>;
}

/**
 * Register all rifty-LS Monaco providers (hover / def / type-def / completions)
 * for `javascript` + `typescript`. Returns a disposer that unregisters every
 * provider (so the App effect can tear them down with the LS client — no leak,
 * no stale provider pointing at a disposed client).
 */
export function registerTsLanguageServiceProviders(
  client: TsLanguageServiceProviderClient,
  bridge: EditorPathBridge,
  options: TsLanguageServiceProviderOptions = {},
): TsLanguageServiceProvidersHandle {
  const disposables: monaco.IDisposable[] = [];
  const readyRequest = async <T>(request: () => Promise<T>): Promise<T> => {
    await options.beforeRequest?.();
    return request();
  };
  const tsRequestOrReady = <T>(request: () => Promise<T>, fallback: T): Promise<T> =>
    tsRequestOr(() => readyRequest(request), fallback);
  const tsRequestResultReady = <T>(request: () => Promise<T>): Promise<TsRequestResult<T>> =>
    tsRequestResult(() => readyRequest(request));
  disposables.push(
    monaco.editor.registerCommand(
      APPLY_COMPLETION_WORKSPACE_EDIT_COMMAND,
      (_accessor: unknown, edit: LspWorkspaceEdit | undefined) => {
        if (edit !== undefined && !hasWorkspaceEditCommands(edit)) {
          if (!applyWorkspaceTextEdit(edit, bridge)) {
            throw new Error('TypeScript completion edit target could not be opened');
          }
        }
      },
    ),
  );

  const hoverProvider: monaco.languages.HoverProvider = {
    async provideHover(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const hover = await tsRequestOrReady(
        () => client.getQuickInfo(path, monacoToLspPosition(position)),
        null,
      );
      if (token.isCancellationRequested || !hover || hover.contents.value.length === 0) return null;
      return toMonacoHover(hover);
    },
  };

  const definitionProvider: monaco.languages.DefinitionProvider = {
    async provideDefinition(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const links = await tsRequestOrReady(
        () => client.getDefinitionLinks(path, monacoToLspPosition(position)),
        emptyDefinitionLinks(),
      );
      if (token.isCancellationRequested) return null;
      return links.locations
        .map((link) => toMonacoLocationLink(link, links.originSelectionRange, bridge))
        .filter((l): l is monaco.languages.LocationLink => l !== undefined);
    },
  };

  const typeDefinitionProvider: monaco.languages.TypeDefinitionProvider = {
    async provideTypeDefinition(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const locations = await tsRequestOrReady(
        () => client.getTypeDefinition(path, monacoToLspPosition(position)),
        [],
      );
      if (token.isCancellationRequested) return null;
      return locations
        .map((loc) => toMonacoLocation(loc, bridge))
        .filter((l): l is monaco.languages.Location => l !== undefined);
    },
  };

  const completionProvider: monaco.languages.CompletionItemProvider = {
    triggerCharacters: [...TS_COMPLETION_TRIGGER_CHARACTERS],
    async provideCompletionItems(model, position, context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { suggestions: [] };
      const lspPosition = monacoToLspPosition(position);
      const options = completionOptionsFromModel(model, context);
      const list = await tsRequestOrReady(
        () => client.getCompletions(path, lspPosition, options),
        emptyCompletionList(),
      );
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
        const entryRange = entry.replacementRange ?? list.optionalReplacementRange;
        const item: ResolvableItem = {
          label: toMonacoCompletionLabel(entry),
          kind: toMonacoCompletionKind(entry.kind),
          insertText: entry.insertText ?? entry.label,
          range: entryRange ? lspToMonacoRange(entryRange) : range,
          preselect: entry.isRecommended === true,
          ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
          ...(hasDeprecatedModifier(entry.kindModifiers)
            ? { tags: [monaco.languages.CompletionItemTag.Deprecated] }
            : {}),
          ...(entry.sortText !== undefined ? { sortText: entry.sortText } : {}),
          ...(entry.filterText !== undefined ? { filterText: entry.filterText } : {}),
          ...(entry.isSnippet === true
            ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
            : {}),
          ...(entry.commitCharacters !== undefined
            ? { commitCharacters: [...entry.commitCharacters] }
            : list.defaultCommitCharacters !== undefined
              ? { commitCharacters: [...list.defaultCommitCharacters] }
              : {}),
          ...(entry.additionalTextEdits !== undefined
            ? { additionalTextEdits: entry.additionalTextEdits.map(toMonacoSingleEdit) }
            : {}),
        };
        const docs = toMarkdown(entry.documentation);
        if (docs) item.documentation = docs;
        // Stash the resolve coordinates: `resolveCompletionItem` re-queries the
        // service by (path, position, label) to fill detail + docs lazily.
        item[RESOLVE_KEY] = {
          path,
          line: lspPosition.line,
          character: lspPosition.character,
          options: completionOptionsFromModel(model, context),
        };
        if (entry.source !== undefined || entry.data !== undefined) {
          item[RESOLVE_KEY] = {
            path,
            line: lspPosition.line,
            character: lspPosition.character,
            options,
            ...(entry.source !== undefined ? { source: entry.source } : {}),
            ...(entry.data !== undefined ? { data: entry.data } : {}),
          };
        }
        return item;
      });
      return { suggestions, incomplete: list.isIncomplete };
    },
    async resolveCompletionItem(item, token) {
      const ctx = (item as ResolvableItem)[RESOLVE_KEY];
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      if (!ctx) return item;
      const resolved = await tsRequestOrReady(
        () =>
          client.getCompletionDetails(
            ctx.path,
            { line: ctx.line, character: ctx.character },
            label,
            ctx.source,
            ctx.data,
            ctx.options,
          ),
        null,
      );
      if (token.isCancellationRequested || !resolved) return item;
      if (resolved.detail !== undefined) item.detail = resolved.detail;
      if (hasDeprecatedModifier(resolved.kindModifiers)) {
        item.tags = [monaco.languages.CompletionItemTag.Deprecated];
      }
      if (resolved.isRecommended === true) item.preselect = true;
      applyCompletionSourceDisplay(item, resolved.sourceDisplay);
      const docs = toMarkdown(resolved.documentation);
      if (docs) item.documentation = docs;
      if (resolved.additionalTextEditChanges !== undefined) {
        item.additionalTextEdits = undefined;
        if (!hasWorkspaceEditCommands(resolved.additionalTextEditChanges)) {
          item.command = {
            id: APPLY_COMPLETION_WORKSPACE_EDIT_COMMAND,
            title: 'Apply TypeScript completion edits',
            arguments: [resolved.additionalTextEditChanges],
          };
        } else {
          item.command = undefined;
        }
      } else if (resolved.additionalTextEdits !== undefined) {
        item.additionalTextEdits = resolved.additionalTextEdits.map(toMonacoSingleEdit);
      }
      return item;
    },
  };

  const referenceProvider: monaco.languages.ReferenceProvider = {
    async provideReferences(model, position, context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const refs = await tsRequestOrReady(
        () =>
          client.getReferences(path, monacoToLspPosition(position), {
            includeDeclaration: context.includeDeclaration,
          }),
        [],
      );
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
      const result = await tsRequestOrReady(
        () => client.prepareRename(path, monacoToLspPosition(position)),
        null,
      );
      if (token.isCancellationRequested) return renameRejection('Rename cancelled');
      if (!result) return renameRejection('You cannot rename this element');
      return { range: lspToMonacoRange(result.range), text: result.placeholder };
    },
    async provideRenameEdits(model, position, newName, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { edits: [], rejectReason: 'Not a rifty TypeScript document' };
      const edit = await tsRequestOrReady(
        () => client.getRenameEdits(path, monacoToLspPosition(position), newName),
        emptyWorkspaceEdit(),
      );
      if (token.isCancellationRequested) return { edits: [], rejectReason: 'Rename cancelled' };
      // WorkspaceEdit.changes is keyed by document uri (the VFS path verbatim);
      // flatten it into Monaco's `edits: IWorkspaceTextEdit[]`, resolving every
      // target uri first. Missing target = reject, never partial rename.
      const edits = toMonacoWorkspaceTextEdits(edit, bridge);
      if (edits === null) {
        return { edits: [], rejectReason: 'TypeScript rename edit target could not be opened' };
      }
      return { edits };
    },
  };

  const signatureHelpProvider: monaco.languages.SignatureHelpProvider = {
    signatureHelpTriggerCharacters: [...TS_SIGNATURE_TRIGGER_CHARACTERS],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position, token, context) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const help = await tsRequestOrReady(
        () =>
          client.getSignatureHelp(
            path,
            monacoToLspPosition(position),
            signatureHelpOptionsFromMonaco(context),
          ),
        null,
      );
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
      const actionEditOptions = actionEditOptionsFromModel(model);
      for (const marker of markers) {
        const code = markerErrorCode(marker.code);
        if (code === undefined) continue;
        const fixesResult = await tsRequestResultReady(() =>
          client.getCodeFixes(path, monacoToLspRange(marker), [code], actionEditOptions),
        );
        if (fixesResult.status === 'disposed') return emptyCodeActions();
        const fixes = fixesResult.value;
        if (token.isCancellationRequested) return emptyCodeActions();
        for (const fix of fixes) {
          if (!canApplyInMonacoEditor(fix)) continue;
          if (seenFixTitles.has(fix.title)) continue;
          seenFixTitles.add(fix.title);
          actions.push(toMonacoLazyCodeAction(fix, [marker]));
          if (fix.fixId !== undefined && fix.fixAllDescription) {
            const editResult = await tsRequestResultReady(() =>
              client.getCombinedCodeFix(path, fix.fixId, actionEditOptions),
            );
            if (editResult.status === 'disposed') return emptyCodeActions();
            const edit = editResult.value;
            if (token.isCancellationRequested) return emptyCodeActions();
            const fixAll = {
              title: fix.fixAllDescription,
              kind: FIX_ALL_KIND,
              edit,
            };
            if (canApplyInMonacoEditor(fixAll)) {
              actions.push(toMonacoLazyCodeAction(fixAll, [marker]));
            }
          }
        }
      }

      // Organize-imports: ALWAYS offered (a source action, independent of the
      // selection). An already-organized file yields an empty `changes` → an action
      // with no resources; only push it when it carries real edits so the menu
      // doesn't show a no-op entry.
      const organizeResult = await tsRequestResultReady(() =>
        client.organizeImports(path, actionEditOptions),
      );
      if (organizeResult.status === 'disposed') return emptyCodeActions();
      const organize = organizeResult.value;
      if (token.isCancellationRequested) return emptyCodeActions();
      if (hasWorkspaceTextEdits(organize)) {
        const organizeAction = {
          title: 'Organize imports',
          kind: ORGANIZE_IMPORTS_KIND,
          edit: organize,
        };
        if (canApplyInMonacoEditor(organizeAction)) {
          actions.push(toMonacoLazyCodeAction(organizeAction));
        }
      }

      const refactorsResult = await tsRequestResultReady(() =>
        client.getRefactorActions(path, monacoToLspRange(range), actionEditOptions),
      );
      if (refactorsResult.status === 'disposed') return emptyCodeActions();
      const refactors = refactorsResult.value;
      if (token.isCancellationRequested) return emptyCodeActions();
      for (const refactor of refactors) {
        if (!canApplyInMonacoEditor(refactor)) continue;
        if (refactor.edit) actions.push(toMonacoLazyCodeAction(refactor));
      }

      return { actions, dispose() {} };
    },
    async resolveCodeAction(action, token) {
      if (token.isCancellationRequested) return action;
      return toMonacoResolvedCodeAction(action, bridge);
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
      const edits = await tsRequestOrReady(
        () =>
          client.getFormattingEdits(path, {
            tabSize: options.tabSize ?? modelOptions.tabSize,
            insertSpaces: options.insertSpaces ?? modelOptions.insertSpaces,
          }),
        [],
      );
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
      const edits = await tsRequestOrReady(
        () =>
          client.getRangeFormattingEdits(path, monacoToLspRange(range), {
            tabSize: options.tabSize ?? modelOptions.tabSize,
            insertSpaces: options.insertSpaces ?? modelOptions.insertSpaces,
          }),
        [],
      );
      if (token.isCancellationRequested) return undefined;
      return edits.map(toMonacoTextEdit);
    },
  };

  const implementationProvider: monaco.languages.ImplementationProvider = {
    async provideImplementation(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const locations = await tsRequestOrReady(
        () => client.getImplementation(path, monacoToLspPosition(position)),
        [],
      );
      if (token.isCancellationRequested) return null;
      return locations
        .map((loc) => toMonacoLocation(loc, bridge))
        .filter((l): l is monaco.languages.Location => l !== undefined);
    },
  };

  const documentSymbolProvider: monaco.languages.DocumentSymbolProvider = {
    displayName: 'rifty TypeScript',
    async provideDocumentSymbols(model, token) {
      const path = bridge.pathForModel(model);
      if (!path) return [];
      const symbols = await tsRequestOrReady(() => client.getDocumentSymbols(path), []);
      if (token.isCancellationRequested) return [];
      return symbols.map(toMonacoDocumentSymbol);
    },
  };

  const foldingRangeProvider: monaco.languages.FoldingRangeProvider = {
    async provideFoldingRanges(model, _context, token) {
      const path = bridge.pathForModel(model);
      if (!path) return [];
      const ranges = await tsRequestOrReady(() => client.getFoldingRanges(path), []);
      if (token.isCancellationRequested) return [];
      return ranges.map(toMonacoFoldingRange);
    },
  };

  const inlayHintsProvider: monaco.languages.InlayHintsProvider = {
    displayName: 'rifty TypeScript',
    async provideInlayHints(model, range, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { hints: [], dispose() {} };
      const hints = await tsRequestOrReady(
        () => client.getInlayHints(path, monacoToLspRange(range)),
        [],
      );
      if (token.isCancellationRequested) return { hints: [], dispose() {} };
      return { hints: hints.map(toMonacoInlayHint), dispose() {} };
    },
  };

  const documentHighlightProvider: monaco.languages.DocumentHighlightProvider = {
    async provideDocumentHighlights(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return [];
      const highlights = await tsRequestOrReady(
        () => client.getDocumentHighlights(path, monacoToLspPosition(position), [path]),
        [],
      );
      if (token.isCancellationRequested) return [];
      return highlights.map(toMonacoDocumentHighlight);
    },
  };

  const semanticTokensProvider: monaco.languages.DocumentSemanticTokensProvider = {
    getLegend() {
      return {
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
      };
    },
    async provideDocumentSemanticTokens(model, _lastResultId, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { data: new Uint32Array() };
      const range = model.getFullModelRange();
      const semantic = await tsRequestOrReady(
        () => client.getEncodedSemanticClassifications(path, monacoToLspRange(range)),
        emptyEncodedClassifications(),
      );
      if (token.isCancellationRequested) return { data: new Uint32Array() };
      return { data: semanticTokensData(model, semantic.spans) };
    },
    releaseDocumentSemanticTokens() {},
  };

  const rangeSemanticTokensProvider: monaco.languages.DocumentRangeSemanticTokensProvider = {
    getLegend() {
      return {
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
      };
    },
    async provideDocumentRangeSemanticTokens(model, range, token) {
      const path = bridge.pathForModel(model);
      if (!path) return { data: new Uint32Array() };
      const semantic = await tsRequestOrReady(
        () => client.getEncodedSemanticClassifications(path, monacoToLspRange(range)),
        emptyEncodedClassifications(),
      );
      if (token.isCancellationRequested) return { data: new Uint32Array() };
      return { data: semanticTokensData(model, semantic.spans) };
    },
  };

  const selectionRangeProvider: monaco.languages.SelectionRangeProvider = {
    async provideSelectionRanges(model, positions, token) {
      const path = bridge.pathForModel(model);
      if (!path) return [];
      const ranges: monaco.languages.SelectionRange[][] = [];
      for (const position of positions) {
        const selection = await tsRequestOrReady(
          () => client.getSelectionRange(path, monacoToLspPosition(position)),
          null,
        );
        if (token.isCancellationRequested) return [];
        ranges.push(selection ? toMonacoSelectionRange(selection) : []);
      }
      return ranges;
    },
  };

  const onTypeFormattingProvider: monaco.languages.OnTypeFormattingEditProvider = {
    autoFormatTriggerCharacters: [';', '}', '\n'],
    async provideOnTypeFormattingEdits(model, position, ch, options, token) {
      const path = bridge.pathForModel(model);
      if (!path) return [];
      const modelOptions = model.getOptions();
      const edits = await tsRequestOrReady(
        () =>
          client.getOnTypeFormattingEdits(path, monacoToLspPosition(position), ch, {
            tabSize: options.tabSize ?? modelOptions.tabSize,
            insertSpaces: options.insertSpaces ?? modelOptions.insertSpaces,
          }),
        [],
      );
      if (token.isCancellationRequested) return [];
      return edits.map(toMonacoTextEdit);
    },
  };

  const linkedEditingRangeProvider: monaco.languages.LinkedEditingRangeProvider = {
    async provideLinkedEditingRanges(model, position, token) {
      const path = bridge.pathForModel(model);
      if (!path) return null;
      const ranges = await tsRequestOrReady(
        () => client.getLinkedEditingRange(path, monacoToLspPosition(position)),
        null,
      );
      if (token.isCancellationRequested || !ranges) return null;
      return {
        ranges: ranges.ranges.map(lspToMonacoRange),
        ...(ranges.wordPattern ? { wordPattern: wordPattern(ranges.wordPattern) } : {}),
      };
    },
  };

  for (const language of LANGUAGES) {
    disposables.push(monaco.languages.registerHoverProvider(language, hoverProvider));
    disposables.push(monaco.languages.registerDefinitionProvider(language, definitionProvider));
    disposables.push(
      monaco.languages.registerTypeDefinitionProvider(language, typeDefinitionProvider),
    );
    disposables.push(
      monaco.languages.registerImplementationProvider(language, implementationProvider),
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
        providedCodeActionKinds: ['quickfix', ORGANIZE_IMPORTS_KIND, FIX_ALL_KIND, 'refactor'],
      }),
    );
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(language, documentSymbolProvider),
    );
    disposables.push(monaco.languages.registerFoldingRangeProvider(language, foldingRangeProvider));
    disposables.push(monaco.languages.registerInlayHintsProvider(language, inlayHintsProvider));
    disposables.push(
      monaco.languages.registerDocumentHighlightProvider(language, documentHighlightProvider),
    );
    disposables.push(
      monaco.languages.registerDocumentSemanticTokensProvider(language, semanticTokensProvider),
    );
    disposables.push(
      monaco.languages.registerDocumentRangeSemanticTokensProvider(
        language,
        rangeSemanticTokensProvider,
      ),
    );
    disposables.push(
      monaco.languages.registerSelectionRangeProvider(language, selectionRangeProvider),
    );
    disposables.push(
      monaco.languages.registerOnTypeFormattingEditProvider(language, onTypeFormattingProvider),
    );
    disposables.push(
      monaco.languages.registerLinkedEditingRangeProvider(language, linkedEditingRangeProvider),
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
      implementation: implementationProvider,
      documentSymbol: documentSymbolProvider,
      foldingRange: foldingRangeProvider,
      inlayHints: inlayHintsProvider,
      documentHighlight: documentHighlightProvider,
      semanticTokens: semanticTokensProvider,
      rangeSemanticTokens: rangeSemanticTokensProvider,
      selectionRange: selectionRangeProvider,
      onTypeFormatting: onTypeFormattingProvider,
      linkedEditingRange: linkedEditingRangeProvider,
    },
  };
}
