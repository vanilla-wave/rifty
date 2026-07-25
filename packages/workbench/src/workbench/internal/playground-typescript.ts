import type {
  CodeAction,
  CompletionItem,
  CompletionList,
  DefinitionLinks,
  Location,
  WorkspaceEdit,
} from '@riftydev/ts-language-service/lsp-types';
import type { PlaygroundTypeScript as PublicPlaygroundTypeScript } from '../playground.ts';
import { toOwnerProjectPath, toProjectPath } from '../project-file-boundary.ts';
import type { TsLanguageServiceClient } from './typescript-relay-client.ts';

const PLAYGROUND_TYPESCRIPT_METHODS = [
  'open',
  'update',
  'close',
  'invalidate',
  'getSemanticDiagnostics',
  'getSyntacticDiagnostics',
  'getQuickInfo',
  'getDefinitionLinks',
  'getTypeDefinition',
  'getCompletions',
  'getCompletionDetails',
  'getReferences',
  'prepareRename',
  'getRenameEdits',
  'getSignatureHelp',
  'getCodeFixes',
  'getCombinedCodeFix',
  'organizeImports',
  'getRefactorActions',
  'getFormattingEdits',
  'getRangeFormattingEdits',
  'getOnTypeFormattingEdits',
  'getImplementation',
  'getDocumentSymbols',
  'getFoldingRanges',
  'getInlayHints',
  'getDocumentHighlights',
  'getEncodedSemanticClassifications',
  'getSelectionRange',
  'getLinkedEditingRange',
] as const;

type PlaygroundTypeScriptMethod = (typeof PLAYGROUND_TYPESCRIPT_METHODS)[number];

/** Finite semantic TypeScript surface. Owner paths never cross this boundary. */
export type PlaygroundTypeScriptAdapter = Pick<
  PublicPlaygroundTypeScript,
  PlaygroundTypeScriptMethod
>;

export interface PlaygroundTypeScriptAuthority {
  readonly projectRoot: string;
  readonly client: TsLanguageServiceClient;
}

function mapLocation(location: Location, projectRoot: string): Location {
  return { ...location, uri: toProjectPath(projectRoot, location.uri) };
}

function mapLocations(locations: readonly Location[], projectRoot: string): readonly Location[] {
  return locations.map((location) => mapLocation(location, projectRoot));
}

function mapDefinitionLinks(links: DefinitionLinks, projectRoot: string): DefinitionLinks {
  return {
    ...links,
    locations: links.locations.map((location) => ({
      ...location,
      targetUri: toProjectPath(projectRoot, location.targetUri),
    })),
  };
}

function mapWorkspaceEdit(edit: WorkspaceEdit, projectRoot: string): WorkspaceEdit {
  const changes: Record<string, WorkspaceEdit['changes'][string]> = {};
  for (const [ownerPath, edits] of Object.entries(edit.changes)) {
    changes[toProjectPath(projectRoot, ownerPath)] = edits;
  }
  return {
    ...edit,
    changes,
    ...(edit.newFiles === undefined
      ? {}
      : { newFiles: edit.newFiles.map((path) => toProjectPath(projectRoot, path)) }),
    ...(edit.renameLocation === undefined
      ? {}
      : { renameLocation: mapLocation(edit.renameLocation, projectRoot) }),
    ...(edit.renameFilename === undefined
      ? {}
      : { renameFilename: toProjectPath(projectRoot, edit.renameFilename) }),
  };
}

function mapCompletionItem(item: CompletionItem, projectRoot: string): CompletionItem {
  return item.additionalTextEditChanges === undefined
    ? item
    : {
        ...item,
        additionalTextEditChanges: mapWorkspaceEdit(item.additionalTextEditChanges, projectRoot),
      };
}

function mapCompletionList(list: CompletionList, projectRoot: string): CompletionList {
  return {
    ...list,
    items: list.items.map((item) => mapCompletionItem(item, projectRoot)),
  };
}

function mapCodeActions(
  actions: readonly CodeAction[],
  projectRoot: string,
): readonly CodeAction[] {
  return actions.map((action) =>
    action.edit === undefined
      ? action
      : { ...action, edit: mapWorkspaceEdit(action.edit, projectRoot) },
  );
}

/** Translate the finite public path namespace at one semantic chokepoint. */
export function createPlaygroundTypeScriptAdapter(
  authority: PlaygroundTypeScriptAuthority,
): PlaygroundTypeScriptAdapter {
  const { client, projectRoot } = authority;
  const ownerPath = (path: string): string => toOwnerProjectPath(projectRoot, path);

  const typescript: PlaygroundTypeScriptAdapter = {
    async open(path, text) {
      await client.open(ownerPath(path), text);
    },
    async update(path, text) {
      await client.update(ownerPath(path), text);
    },
    async close(path) {
      await client.close(ownerPath(path));
    },
    async invalidate(path) {
      await client.invalidate(ownerPath(path));
    },
    async getSemanticDiagnostics(path) {
      return client.getSemanticDiagnostics(ownerPath(path));
    },
    async getSyntacticDiagnostics(path) {
      return client.getSyntacticDiagnostics(ownerPath(path));
    },
    async getQuickInfo(path, position, options) {
      return client.getQuickInfo(ownerPath(path), position, options);
    },
    async getDefinitionLinks(path, position) {
      return mapDefinitionLinks(
        await client.getDefinitionLinks(ownerPath(path), position),
        projectRoot,
      );
    },
    async getTypeDefinition(path, position) {
      return mapLocations(await client.getTypeDefinition(ownerPath(path), position), projectRoot);
    },
    async getCompletions(path, position, options) {
      return mapCompletionList(
        await client.getCompletions(ownerPath(path), position, options),
        projectRoot,
      );
    },
    async getCompletionDetails(path, position, label, source, data, options) {
      const item = await client.getCompletionDetails(
        ownerPath(path),
        position,
        label,
        source,
        data,
        options,
      );
      return item === null ? null : mapCompletionItem(item, projectRoot);
    },
    async getReferences(path, position, context) {
      return mapLocations(
        await client.getReferences(ownerPath(path), position, context),
        projectRoot,
      );
    },
    async prepareRename(path, position, options) {
      return client.prepareRename(ownerPath(path), position, options);
    },
    async getRenameEdits(path, position, newName, options) {
      return mapWorkspaceEdit(
        await client.getRenameEdits(ownerPath(path), position, newName, options),
        projectRoot,
      );
    },
    async getSignatureHelp(path, position, options) {
      return client.getSignatureHelp(ownerPath(path), position, options);
    },
    async getCodeFixes(path, range, errorCodes, options) {
      return mapCodeActions(
        await client.getCodeFixes(ownerPath(path), range, errorCodes, options),
        projectRoot,
      );
    },
    async getCombinedCodeFix(path, fixId, options) {
      return mapWorkspaceEdit(
        await client.getCombinedCodeFix(ownerPath(path), fixId, options),
        projectRoot,
      );
    },
    async organizeImports(path, options) {
      return mapWorkspaceEdit(await client.organizeImports(ownerPath(path), options), projectRoot);
    },
    async getRefactorActions(path, range, options) {
      return mapCodeActions(
        await client.getRefactorActions(ownerPath(path), range, options),
        projectRoot,
      );
    },
    async getFormattingEdits(path, options) {
      return client.getFormattingEdits(ownerPath(path), options);
    },
    async getRangeFormattingEdits(path, range, options) {
      return client.getRangeFormattingEdits(ownerPath(path), range, options);
    },
    async getOnTypeFormattingEdits(path, position, key, options) {
      return client.getOnTypeFormattingEdits(ownerPath(path), position, key, options);
    },
    async getImplementation(path, position) {
      return mapLocations(await client.getImplementation(ownerPath(path), position), projectRoot);
    },
    async getDocumentSymbols(path) {
      return client.getDocumentSymbols(ownerPath(path));
    },
    async getFoldingRanges(path) {
      return client.getFoldingRanges(ownerPath(path));
    },
    async getInlayHints(path, range, options) {
      return client.getInlayHints(ownerPath(path), range, options);
    },
    async getDocumentHighlights(path, position, filesToSearch) {
      const ownerFiles = filesToSearch.map(ownerPath);
      return client.getDocumentHighlights(ownerPath(path), position, ownerFiles);
    },
    async getEncodedSemanticClassifications(path, range) {
      return client.getEncodedSemanticClassifications(ownerPath(path), range);
    },
    async getSelectionRange(path, position) {
      return client.getSelectionRange(ownerPath(path), position);
    },
    async getLinkedEditingRange(path, position) {
      return client.getLinkedEditingRange(ownerPath(path), position);
    },
  };

  return Object.freeze(typescript);
}
