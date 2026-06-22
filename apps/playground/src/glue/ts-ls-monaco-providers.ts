/**
 * rifty-LS-backed Monaco providers — hover / definition / type-definition /
 * completions for `javascript` + `typescript` (ADR-0166 phase 2).
 *
 * These RETIRE Monaco's built-in TS approximation (the isolated lib.d.ts-only
 * `ts.worker` that can't see the owner VFS / tsconfig / node_modules — the "stub
 * that lies" ADR-0166 rejects). Every query goes through the real
 * page↔owner↔LS relay {@link TsLanguageServiceClient}, so hover types, go-to-def
 * targets, and completion candidates reflect the REAL project + dependencies.
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
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  Hover as LspHover,
  Location as LspLocation,
  MarkupContent,
} from '@riftydev/ts-language-service/lsp-types';
import { CompletionItemKind as LspCompletionItemKind } from '@riftydev/ts-language-service/lsp-types';
import * as monaco from 'monaco-editor';
import { lspToMonacoRange, monacoToLspPosition } from './lsp-position.ts';
import type { TsLanguageServiceClient } from './ts-ls-client.ts';

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

  for (const language of LANGUAGES) {
    disposables.push(monaco.languages.registerHoverProvider(language, hoverProvider));
    disposables.push(monaco.languages.registerDefinitionProvider(language, definitionProvider));
    disposables.push(
      monaco.languages.registerTypeDefinitionProvider(language, typeDefinitionProvider),
    );
    disposables.push(monaco.languages.registerCompletionItemProvider(language, completionProvider));
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
    },
  };
}
