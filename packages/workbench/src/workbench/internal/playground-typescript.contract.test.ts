import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServiceEndpoint } from '@riftydev/ts-language-service';
import type {
  CodeAction,
  CompletionItem,
  DefinitionLinks,
  Location,
  Range,
  WorkspaceEdit,
} from '@riftydev/ts-language-service/lsp-types';
import {
  TS_IPC_TYPE,
  type TsRequest,
  type TsResponse,
  isTsRequestMessage,
} from '@riftydev/ts-language-service/protocol';
import type { FsSync } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type PlaygroundTypeScriptAdapter as PlaygroundTypeScript,
  createPlaygroundTypeScriptAdapter,
} from './playground-typescript.ts';
import {
  type TsLanguageServiceClient,
  createTsLanguageServiceClient,
} from './typescript-relay-client.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const OWNER_FILE = `${PROJECT_ROOT}/src/main.ts`;
const OWNER_SECONDARY_FILE = `${PROJECT_ROOT}/src/secondary.ts`;
const PUBLIC_FILE = '/src/main.ts';
const PUBLIC_SECONDARY_FILE = '/src/secondary.ts';
const FOREIGN_FILE = '/.rifty/workbench/v1/projects/project-b/tree/src/foreign.ts';
const REFERENCE_ROOT = '/reference-project';
const REAL_MAIN_TEXT =
  "import { value } from './secondary';\nexport const answer: number = value;\n";
const REAL_VALUE_POSITION = Object.freeze({
  line: 1,
  character: 'export const answer: number = '.length,
});

const range: Range = Object.freeze({
  start: Object.freeze({ line: 0, character: 0 }),
  end: Object.freeze({ line: 0, character: 1 }),
});
const position = range.start;
const ORACLE_POSITION = Object.freeze({ line: 7, character: 13 });
const ORACLE_RANGE: Range = Object.freeze({
  start: Object.freeze({ line: 2, character: 3 }),
  end: Object.freeze({ line: 5, character: 8 }),
});
const ORACLE_FORMATTING = Object.freeze({
  tabSize: 7,
  insertSpaces: false,
  indentStyle: 'Smart',
  semicolons: 'remove',
});
const ORACLE_PREFERENCES = Object.freeze({
  quotePreference: 'single',
  includePackageJsonAutoImports: 'on',
  autoImportFileExcludePatterns: Object.freeze(['**/generated/**']),
});
const QUICK_INFO_OPTIONS = Object.freeze({ maximumLength: 321 });
const COMPLETION_OPTIONS = Object.freeze({
  preferences: ORACLE_PREFERENCES,
  formattingOptions: ORACLE_FORMATTING,
  includeSymbol: true,
  includeExternalModuleExports: false,
  includeCompletionsForModuleExports: true,
  includeInsertTextCompletions: false,
  includeCompletionsWithSnippetText: true,
  triggerCharacter: '@' as const,
  triggerKind: 'trigger-character' as const,
});
const COMPLETION_DATA = Object.freeze({
  exportName: 'value',
  fileName: '/opaque/completion-data.ts',
  metadata: Object.freeze(['preserve', 17, true]),
});
const COMPLETION_DETAILS_OPTIONS = Object.freeze({
  preferences: Object.freeze({ ...ORACLE_PREFERENCES, importModuleSpecifierEnding: 'js' }),
  formattingOptions: ORACLE_FORMATTING,
  includeSymbol: false,
  includeExternalModuleExports: true,
  includeCompletionsForModuleExports: false,
  includeInsertTextCompletions: true,
  includeCompletionsWithSnippetText: false,
  triggerCharacter: '#' as const,
  triggerKind: 'trigger-for-incomplete' as const,
});
const RENAME_OPTIONS = Object.freeze({
  preferences: ORACLE_PREFERENCES,
  findInStrings: true,
  findInComments: false,
});
const SIGNATURE_HELP_OPTIONS = Object.freeze({
  triggerReason: Object.freeze({ kind: 'retrigger' as const, triggerCharacter: ')' as const }),
});
const CODE_FIX_OPTIONS = Object.freeze({
  preferences: ORACLE_PREFERENCES,
  formattingOptions: ORACLE_FORMATTING,
});
const COMBINED_FIX_ID = Object.freeze({
  fixId: 'fix-imports',
  opaquePath: '/opaque/fix-id.ts',
  scope: Object.freeze({ mode: 'file', ordinal: 9 }),
});
const ORGANIZE_IMPORTS_OPTIONS = Object.freeze({
  preferences: ORACLE_PREFERENCES,
  formattingOptions: ORACLE_FORMATTING,
  mode: 'RemoveUnused' as const,
  skipDestructiveCodeActions: false,
});
const REFACTOR_OPTIONS = Object.freeze({
  preferences: ORACLE_PREFERENCES,
  formattingOptions: ORACLE_FORMATTING,
  triggerReason: 'invoked' as const,
  kind: 'refactor.extract.constant',
  includeInteractiveActions: true,
});
const INLAY_HINT_OPTIONS = Object.freeze({ preferences: ORACLE_PREFERENCES });
const ORACLE_ERROR_CODES = [2304, 2552];

const METHOD_NAMES = Object.freeze([
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
] as const);

type PlaygroundTypeScriptMethod = (typeof METHOD_NAMES)[number];
type ExpectedPlaygroundTypeScript = Pick<TsLanguageServiceClient, PlaygroundTypeScriptMethod>;
type Responder = (request: TsRequest) => TsResponse;

function emptyResponse(request: TsRequest): TsResponse {
  switch (request.type) {
    case 'ts:open':
    case 'ts:update':
    case 'ts:close':
    case 'ts:invalidate':
      return { id: request.id, ok: true, kind: 'ack' };
    case 'ts:getSemanticDiagnostics':
    case 'ts:getSyntacticDiagnostics':
      return { id: request.id, ok: true, kind: 'diagnostics', diagnostics: [] };
    case 'ts:getQuickInfo':
      return { id: request.id, ok: true, kind: 'hover', hover: null };
    case 'ts:getDefinitionLinks':
      return {
        id: request.id,
        ok: true,
        kind: 'definitionLinks',
        definitionLinks: { locations: [] },
      };
    case 'ts:getTypeDefinition':
    case 'ts:getReferences':
    case 'ts:getImplementation':
      return { id: request.id, ok: true, kind: 'locations', locations: [] };
    case 'ts:getCompletions':
      return {
        id: request.id,
        ok: true,
        kind: 'completions',
        completions: {
          isIncomplete: false,
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          items: [],
        },
      };
    case 'ts:getCompletionDetails':
      return { id: request.id, ok: true, kind: 'completionItem', item: null };
    case 'ts:prepareRename':
      return { id: request.id, ok: true, kind: 'prepareRename', result: null };
    case 'ts:getRenameEdits':
    case 'ts:getCombinedCodeFix':
    case 'ts:organizeImports':
      return {
        id: request.id,
        ok: true,
        kind: 'workspaceEdit',
        edit: { changes: {} },
      };
    case 'ts:getSignatureHelp':
      return { id: request.id, ok: true, kind: 'signatureHelp', signatureHelp: null };
    case 'ts:getCodeFixes':
    case 'ts:getRefactorActions':
      return { id: request.id, ok: true, kind: 'codeActions', codeActions: [] };
    case 'ts:getFormattingEdits':
    case 'ts:getRangeFormattingEdits':
    case 'ts:getOnTypeFormattingEdits':
      return { id: request.id, ok: true, kind: 'textEdits', textEdits: [] };
    case 'ts:getDocumentSymbols':
      return { id: request.id, ok: true, kind: 'documentSymbols', documentSymbols: [] };
    case 'ts:getFoldingRanges':
      return { id: request.id, ok: true, kind: 'foldingRanges', foldingRanges: [] };
    case 'ts:getInlayHints':
      return { id: request.id, ok: true, kind: 'inlayHints', inlayHints: [] };
    case 'ts:getDocumentHighlights':
      return {
        id: request.id,
        ok: true,
        kind: 'documentHighlights',
        documentHighlights: [],
      };
    case 'ts:getEncodedSemanticClassifications':
      return {
        id: request.id,
        ok: true,
        kind: 'classifications',
        classifications: { spans: [], endOfLineState: 0 },
      };
    case 'ts:getSelectionRange':
      return { id: request.id, ok: true, kind: 'selectionRange', selectionRange: null };
    case 'ts:getLinkedEditingRange':
      return {
        id: request.id,
        ok: true,
        kind: 'linkedEditingRange',
        linkedEditingRange: null,
      };
    default:
      return {
        id: request.id,
        ok: false,
        kind: 'error',
        error: { name: 'UnexpectedTypeScriptRequest', message: request.type },
      };
  }
}

function harness(responder: Responder = emptyResponse): {
  readonly typescript: PlaygroundTypeScript;
  readonly requests: TsRequest[];
  close(): void;
} {
  let listener: ((message: unknown) => void) | undefined;
  const requests: TsRequest[] = [];
  const client = createTsLanguageServiceClient(
    {
      sendTsLsp(message) {
        if (!isTsRequestMessage(message)) throw new TypeError('Expected TS request');
        requests.push(message.request);
        const response = responder(message.request);
        queueMicrotask(() => listener?.({ type: TS_IPC_TYPE, response }));
      },
      onTsLsp(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    { timeoutMs: 1_000 },
  );
  return {
    typescript: createPlaygroundTypeScriptAdapter({ projectRoot: PROJECT_ROOT, client }),
    requests,
    close: () => client.dispose(),
  };
}

async function callEveryMethod(typescript: PlaygroundTypeScript): Promise<void> {
  await Promise.all([
    typescript.open(PUBLIC_FILE, 'export const opened = 11;'),
    typescript.update(PUBLIC_FILE, 'export const updated = 29;'),
    typescript.close(PUBLIC_FILE),
    typescript.invalidate(PUBLIC_FILE),
    typescript.getSemanticDiagnostics(PUBLIC_FILE),
    typescript.getSyntacticDiagnostics(PUBLIC_FILE),
    typescript.getQuickInfo(PUBLIC_FILE, ORACLE_POSITION, QUICK_INFO_OPTIONS),
    typescript.getDefinitionLinks(PUBLIC_FILE, ORACLE_POSITION),
    typescript.getTypeDefinition(PUBLIC_FILE, ORACLE_POSITION),
    typescript.getCompletions(PUBLIC_FILE, ORACLE_POSITION, COMPLETION_OPTIONS),
    typescript.getCompletionDetails(
      PUBLIC_FILE,
      ORACLE_POSITION,
      'exact-label',
      '/opaque/completion-source',
      COMPLETION_DATA,
      COMPLETION_DETAILS_OPTIONS,
    ),
    typescript.getReferences(PUBLIC_FILE, ORACLE_POSITION, { includeDeclaration: false }),
    typescript.prepareRename(PUBLIC_FILE, ORACLE_POSITION, RENAME_OPTIONS),
    typescript.getRenameEdits(PUBLIC_FILE, ORACLE_POSITION, 'exactNewName', RENAME_OPTIONS),
    typescript.getSignatureHelp(PUBLIC_FILE, ORACLE_POSITION, SIGNATURE_HELP_OPTIONS),
    typescript.getCodeFixes(PUBLIC_FILE, ORACLE_RANGE, ORACLE_ERROR_CODES, CODE_FIX_OPTIONS),
    typescript.getCombinedCodeFix(PUBLIC_FILE, COMBINED_FIX_ID, CODE_FIX_OPTIONS),
    typescript.organizeImports(PUBLIC_FILE, ORGANIZE_IMPORTS_OPTIONS),
    typescript.getRefactorActions(PUBLIC_FILE, ORACLE_RANGE, REFACTOR_OPTIONS),
    typescript.getFormattingEdits(PUBLIC_FILE, ORACLE_FORMATTING),
    typescript.getRangeFormattingEdits(PUBLIC_FILE, ORACLE_RANGE, ORACLE_FORMATTING),
    typescript.getOnTypeFormattingEdits(PUBLIC_FILE, ORACLE_POSITION, '}', ORACLE_FORMATTING),
    typescript.getImplementation(PUBLIC_FILE, ORACLE_POSITION),
    typescript.getDocumentSymbols(PUBLIC_FILE),
    typescript.getFoldingRanges(PUBLIC_FILE),
    typescript.getInlayHints(PUBLIC_FILE, ORACLE_RANGE, INLAY_HINT_OPTIONS),
    typescript.getDocumentHighlights(PUBLIC_FILE, ORACLE_POSITION, [
      PUBLIC_FILE,
      PUBLIC_SECONDARY_FILE,
    ]),
    typescript.getEncodedSemanticClassifications(PUBLIC_FILE, ORACLE_RANGE),
    typescript.getSelectionRange(PUBLIC_FILE, ORACLE_POSITION),
    typescript.getLinkedEditingRange(PUBLIC_FILE, ORACLE_POSITION),
  ]);
}

function exactRequestOracle(): readonly TsRequest[] {
  const id = 0;
  return [
    { id, type: 'ts:open', path: OWNER_FILE, text: 'export const opened = 11;' },
    { id, type: 'ts:update', path: OWNER_FILE, text: 'export const updated = 29;' },
    { id, type: 'ts:close', path: OWNER_FILE },
    { id, type: 'ts:invalidate', path: OWNER_FILE },
    { id, type: 'ts:getSemanticDiagnostics', path: OWNER_FILE },
    { id, type: 'ts:getSyntacticDiagnostics', path: OWNER_FILE },
    {
      id,
      type: 'ts:getQuickInfo',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      options: QUICK_INFO_OPTIONS,
    },
    { id, type: 'ts:getDefinitionLinks', path: OWNER_FILE, position: ORACLE_POSITION },
    { id, type: 'ts:getTypeDefinition', path: OWNER_FILE, position: ORACLE_POSITION },
    {
      id,
      type: 'ts:getCompletions',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      options: COMPLETION_OPTIONS,
    },
    {
      id,
      type: 'ts:getCompletionDetails',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      label: 'exact-label',
      source: '/opaque/completion-source',
      data: COMPLETION_DATA,
      options: COMPLETION_DETAILS_OPTIONS,
    },
    {
      id,
      type: 'ts:getReferences',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      context: { includeDeclaration: false },
    },
    {
      id,
      type: 'ts:prepareRename',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      options: RENAME_OPTIONS,
    },
    {
      id,
      type: 'ts:getRenameEdits',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      newName: 'exactNewName',
      options: RENAME_OPTIONS,
    },
    {
      id,
      type: 'ts:getSignatureHelp',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      options: SIGNATURE_HELP_OPTIONS,
    },
    {
      id,
      type: 'ts:getCodeFixes',
      path: OWNER_FILE,
      range: ORACLE_RANGE,
      errorCodes: [2304, 2552],
      options: CODE_FIX_OPTIONS,
    },
    {
      id,
      type: 'ts:getCombinedCodeFix',
      path: OWNER_FILE,
      fixId: COMBINED_FIX_ID,
      options: CODE_FIX_OPTIONS,
    },
    {
      id,
      type: 'ts:organizeImports',
      path: OWNER_FILE,
      options: ORGANIZE_IMPORTS_OPTIONS,
    },
    {
      id,
      type: 'ts:getRefactorActions',
      path: OWNER_FILE,
      range: ORACLE_RANGE,
      options: REFACTOR_OPTIONS,
    },
    { id, type: 'ts:getFormattingEdits', path: OWNER_FILE, options: ORACLE_FORMATTING },
    {
      id,
      type: 'ts:getRangeFormattingEdits',
      path: OWNER_FILE,
      range: ORACLE_RANGE,
      options: ORACLE_FORMATTING,
    },
    {
      id,
      type: 'ts:getOnTypeFormattingEdits',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      key: '}',
      options: ORACLE_FORMATTING,
    },
    { id, type: 'ts:getImplementation', path: OWNER_FILE, position: ORACLE_POSITION },
    { id, type: 'ts:getDocumentSymbols', path: OWNER_FILE },
    { id, type: 'ts:getFoldingRanges', path: OWNER_FILE },
    {
      id,
      type: 'ts:getInlayHints',
      path: OWNER_FILE,
      range: ORACLE_RANGE,
      options: INLAY_HINT_OPTIONS,
    },
    {
      id,
      type: 'ts:getDocumentHighlights',
      path: OWNER_FILE,
      position: ORACLE_POSITION,
      filesToSearch: [OWNER_FILE, OWNER_SECONDARY_FILE],
    },
    {
      id,
      type: 'ts:getEncodedSemanticClassifications',
      path: OWNER_FILE,
      range: ORACLE_RANGE,
    },
    { id, type: 'ts:getSelectionRange', path: OWNER_FILE, position: ORACLE_POSITION },
    { id, type: 'ts:getLinkedEditingRange', path: OWNER_FILE, position: ORACLE_POSITION },
  ];
}

function withNormalizedRequestIds(requests: readonly TsRequest[]): readonly TsRequest[] {
  return requests.map((request) => ({ ...request, id: 0 }));
}

function ownerWorkspaceEdit(path = OWNER_FILE): WorkspaceEdit {
  return {
    changes: { [path]: [{ range, newText: 'replacement' }] },
    newFiles: [OWNER_SECONDARY_FILE],
    renameLocation: { uri: OWNER_SECONDARY_FILE, range },
    renameFilename: OWNER_SECONDARY_FILE,
  };
}

function publicWorkspaceEdit(): WorkspaceEdit {
  return {
    changes: { [PUBLIC_FILE]: [{ range, newText: 'replacement' }] },
    newFiles: [PUBLIC_SECONDARY_FILE],
    renameLocation: { uri: PUBLIC_SECONDARY_FILE, range },
    renameFilename: PUBLIC_SECONDARY_FILE,
  };
}

function writeWorkspaceTypeScript(fs: FsSync, projectRoot: string): void {
  const requireFromTest = createRequire(import.meta.url);
  const serviceEntry = requireFromTest.resolve('@riftydev/ts-language-service');
  const requireFromService = createRequire(serviceEntry);
  const packageJsonPath = requireFromService.resolve('typescript/package.json');
  const packageRoot = dirname(packageJsonPath);
  const libRoot = join(packageRoot, 'lib');
  const target = `${projectRoot}/node_modules/typescript`;
  fs.mkdirSync(`${target}/lib`, { recursive: true });
  fs.writeFileSync(`${target}/package.json`, readFileSync(packageJsonPath));
  for (const name of readdirSync(libRoot)) {
    if (name !== 'typescript.js' && !/^lib(\.[^.]+)*\.d\.ts$/.test(name)) continue;
    fs.writeFileSync(`${target}/lib/${name}`, readFileSync(join(libRoot, name)));
  }
}

function seedRealTypeScriptWorkspace(fs: FsSync, projectRoot: string): void {
  fs.mkdirSync(`${projectRoot}/src`, { recursive: true });
  fs.writeFileSync(
    `${projectRoot}/tsconfig.json`,
    new TextEncoder().encode(
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'esnext',
          target: 'es2022',
          moduleResolution: 'bundler',
        },
      }),
    ),
  );
  fs.writeFileSync(`${projectRoot}/src/main.ts`, new TextEncoder().encode(REAL_MAIN_TEXT));
  fs.writeFileSync(
    `${projectRoot}/src/secondary.ts`,
    new TextEncoder().encode('export const value: number = 21;\n'),
  );
  writeWorkspaceTypeScript(fs, projectRoot);
}

async function realServiceClient(projectRoot: string): Promise<TsLanguageServiceClient> {
  const { fsSync } = createMemoryFs();
  seedRealTypeScriptWorkspace(fsSync, projectRoot);
  const endpoint = createServiceEndpoint({
    buildFsSync: () => fsSync,
    call(method) {
      throw new Error(`Unexpected real-memory endpoint RPC: ${method}`);
    },
  });
  let listener: ((message: unknown) => void) | undefined;
  const client = createTsLanguageServiceClient(
    {
      sendTsLsp(message) {
        if (!isTsRequestMessage(message)) throw new TypeError('Expected TS request');
        void endpoint.dispatch(message.request).then((response) => {
          listener?.({ type: TS_IPC_TYPE, response });
        });
      },
      onTsLsp(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    { timeoutMs: 30_000 },
  );
  await client.init(projectRoot);
  return client;
}

function publicPathFrom(path: string, projectRoot: string): string {
  if (!path.startsWith(`${projectRoot}/`)) {
    throw new TypeError(`Real TS oracle returned a foreign path: ${path}`);
  }
  return path.slice(projectRoot.length);
}

function publicLocationsFrom(
  locations: readonly Location[],
  projectRoot: string,
): readonly Location[] {
  return locations.map((location) => ({
    ...location,
    uri: publicPathFrom(location.uri, projectRoot),
  }));
}

function publicDefinitionLinksFrom(
  definitionLinks: DefinitionLinks,
  projectRoot: string,
): DefinitionLinks {
  return {
    ...definitionLinks,
    locations: definitionLinks.locations.map((location) => ({
      ...location,
      targetUri: publicPathFrom(location.targetUri, projectRoot),
    })),
  };
}

function publicWorkspaceEditFrom(edit: WorkspaceEdit, projectRoot: string): WorkspaceEdit {
  return {
    ...edit,
    changes: Object.fromEntries(
      Object.entries(edit.changes).map(([path, edits]) => [
        publicPathFrom(path, projectRoot),
        edits,
      ]),
    ),
    ...(edit.newFiles === undefined
      ? {}
      : { newFiles: edit.newFiles.map((path) => publicPathFrom(path, projectRoot)) }),
    ...(edit.renameLocation === undefined
      ? {}
      : {
          renameLocation: {
            ...edit.renameLocation,
            uri: publicPathFrom(edit.renameLocation.uri, projectRoot),
          },
        }),
    ...(edit.renameFilename === undefined
      ? {}
      : { renameFilename: publicPathFrom(edit.renameFilename, projectRoot) }),
  };
}

describe('Playground TypeScript finite contract', () => {
  it('is differentially equivalent to a real service endpoint over real MemoryFs', async () => {
    const reference = await realServiceClient(REFERENCE_ROOT);
    const owner = await realServiceClient(PROJECT_ROOT);
    const typescript = createPlaygroundTypeScriptAdapter({
      projectRoot: PROJECT_ROOT,
      client: owner,
    });
    const referenceMain = `${REFERENCE_ROOT}${PUBLIC_FILE}`;
    const errorText = REAL_MAIN_TEXT.replace('answer: number', 'answer: string');

    try {
      await expect(typescript.getSemanticDiagnostics(PUBLIC_FILE)).resolves.toEqual(
        await reference.getSemanticDiagnostics(referenceMain),
      );

      await Promise.all([
        reference.open(referenceMain, REAL_MAIN_TEXT),
        typescript.open(PUBLIC_FILE, REAL_MAIN_TEXT),
      ]);
      await Promise.all([
        reference.update(referenceMain, errorText),
        typescript.update(PUBLIC_FILE, errorText),
      ]);
      const referenceErrors = await reference.getSemanticDiagnostics(referenceMain);
      expect(referenceErrors.map((diagnostic) => diagnostic.code)).toContain(2322);
      await expect(typescript.getSemanticDiagnostics(PUBLIC_FILE)).resolves.toEqual(
        referenceErrors,
      );

      await Promise.all([reference.close(referenceMain), typescript.close(PUBLIC_FILE)]);
      await expect(typescript.getSemanticDiagnostics(PUBLIC_FILE)).resolves.toEqual(
        await reference.getSemanticDiagnostics(referenceMain),
      );

      const referenceLocations = await reference.getReferences(referenceMain, REAL_VALUE_POSITION, {
        includeDeclaration: true,
      });
      await expect(
        typescript.getReferences(PUBLIC_FILE, REAL_VALUE_POSITION, { includeDeclaration: true }),
      ).resolves.toEqual(publicLocationsFrom(referenceLocations, REFERENCE_ROOT));

      const referenceLinks = await reference.getDefinitionLinks(referenceMain, REAL_VALUE_POSITION);
      await expect(
        typescript.getDefinitionLinks(PUBLIC_FILE, REAL_VALUE_POSITION),
      ).resolves.toEqual(publicDefinitionLinksFrom(referenceLinks, REFERENCE_ROOT));

      const referenceRename = await reference.getRenameEdits(
        referenceMain,
        REAL_VALUE_POSITION,
        'renamedValue',
      );
      await expect(
        typescript.getRenameEdits(PUBLIC_FILE, REAL_VALUE_POSITION, 'renamedValue'),
      ).resolves.toEqual(publicWorkspaceEditFrom(referenceRename, REFERENCE_ROOT));
    } finally {
      await Promise.all([reference.disposeLanguageService(), owner.disposeLanguageService()]);
      reference.dispose();
      owner.dispose();
    }
  }, 30_000);

  it('has exactly the initial public method set in both types and runtime', () => {
    expectTypeOf<PlaygroundTypeScript>().toEqualTypeOf<ExpectedPlaygroundTypeScript>();
    const h = harness();

    expect(Object.keys(h.typescript).sort()).toEqual([...METHOD_NAMES].sort());
    expect(Object.isFrozen(h.typescript)).toBe(true);

    h.close();
  });

  it('translates only paths and preserves every request field against an exact oracle', async () => {
    const h = harness();

    await callEveryMethod(h.typescript);

    expect(h.requests).toHaveLength(METHOD_NAMES.length);
    expect(new Set(h.requests.map((request) => request.id)).size).toBe(METHOD_NAMES.length);
    expect(h.requests.every((request) => Number.isSafeInteger(request.id) && request.id > 0)).toBe(
      true,
    );
    expect(
      [...withNormalizedRequestIds(h.requests)].sort((left, right) =>
        left.type.localeCompare(right.type),
      ),
    ).toEqual([...exactRequestOracle()].sort((left, right) => left.type.localeCompare(right.type)));
    h.close();
  });

  it('rejects physical owner, non-normalized and nested foreign inputs before a relay effect', async () => {
    const h = harness();

    await expect(h.typescript.getSemanticDiagnostics(OWNER_FILE)).rejects.toBeInstanceOf(TypeError);
    await expect(h.typescript.getSemanticDiagnostics('/src/../foreign.ts')).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      h.typescript.getDocumentHighlights(PUBLIC_FILE, position, [PUBLIC_FILE, OWNER_FILE]),
    ).rejects.toBeInstanceOf(TypeError);
    expect(h.requests).toEqual([]);
    h.close();
  });
});

describe('Playground TypeScript result path boundary', () => {
  it('maps Locations and DefinitionLinks back to project-rooted paths', async () => {
    const h = harness((request) => {
      if (
        request.type === 'ts:getTypeDefinition' ||
        request.type === 'ts:getReferences' ||
        request.type === 'ts:getImplementation'
      ) {
        const locations: readonly Location[] = [{ uri: OWNER_FILE, range }];
        return { id: request.id, ok: true, kind: 'locations', locations };
      }
      if (request.type === 'ts:getDefinitionLinks') {
        const definitionLinks: DefinitionLinks = {
          originSelectionRange: range,
          locations: [
            {
              targetUri: OWNER_SECONDARY_FILE,
              targetRange: range,
              targetSelectionRange: range,
              originSelectionRange: range,
            },
          ],
        };
        return { id: request.id, ok: true, kind: 'definitionLinks', definitionLinks };
      }
      return emptyResponse(request);
    });

    await expect(h.typescript.getTypeDefinition(PUBLIC_FILE, position)).resolves.toEqual([
      { uri: PUBLIC_FILE, range },
    ]);
    await expect(
      h.typescript.getReferences(PUBLIC_FILE, position, { includeDeclaration: true }),
    ).resolves.toEqual([{ uri: PUBLIC_FILE, range }]);
    await expect(h.typescript.getImplementation(PUBLIC_FILE, position)).resolves.toEqual([
      { uri: PUBLIC_FILE, range },
    ]);
    await expect(h.typescript.getDefinitionLinks(PUBLIC_FILE, position)).resolves.toEqual({
      originSelectionRange: range,
      locations: [
        {
          targetUri: PUBLIC_SECONDARY_FILE,
          targetRange: range,
          targetSelectionRange: range,
          originSelectionRange: range,
        },
      ],
    });
    h.close();
  });

  it('maps every WorkspaceEdit path, including nested code-action and completion edits', async () => {
    const h = harness((request) => {
      if (
        request.type === 'ts:getRenameEdits' ||
        request.type === 'ts:getCombinedCodeFix' ||
        request.type === 'ts:organizeImports'
      ) {
        return {
          id: request.id,
          ok: true,
          kind: 'workspaceEdit',
          edit: ownerWorkspaceEdit(),
        };
      }
      if (request.type === 'ts:getCodeFixes' || request.type === 'ts:getRefactorActions') {
        const codeActions: readonly CodeAction[] = [
          { title: 'owner edit', edit: ownerWorkspaceEdit() },
        ];
        return { id: request.id, ok: true, kind: 'codeActions', codeActions };
      }
      const completion: CompletionItem = {
        label: 'owner completion',
        additionalTextEditChanges: ownerWorkspaceEdit(),
      };
      if (request.type === 'ts:getCompletions') {
        return {
          id: request.id,
          ok: true,
          kind: 'completions',
          completions: {
            isIncomplete: false,
            isGlobalCompletion: false,
            isMemberCompletion: false,
            isNewIdentifierLocation: false,
            items: [completion],
          },
        };
      }
      if (request.type === 'ts:getCompletionDetails') {
        return { id: request.id, ok: true, kind: 'completionItem', item: completion };
      }
      return emptyResponse(request);
    });
    const expectedEdit = publicWorkspaceEdit();

    await expect(h.typescript.getRenameEdits(PUBLIC_FILE, position, 'next')).resolves.toEqual(
      expectedEdit,
    );
    await expect(h.typescript.getCombinedCodeFix(PUBLIC_FILE, 'all')).resolves.toEqual(
      expectedEdit,
    );
    await expect(h.typescript.organizeImports(PUBLIC_FILE)).resolves.toEqual(expectedEdit);
    await expect(h.typescript.getCodeFixes(PUBLIC_FILE, range, [2304])).resolves.toEqual([
      { title: 'owner edit', edit: expectedEdit },
    ]);
    await expect(h.typescript.getRefactorActions(PUBLIC_FILE, range)).resolves.toEqual([
      { title: 'owner edit', edit: expectedEdit },
    ]);
    await expect(h.typescript.getCompletions(PUBLIC_FILE, position)).resolves.toMatchObject({
      items: [{ additionalTextEditChanges: expectedEdit }],
    });
    await expect(
      h.typescript.getCompletionDetails(PUBLIC_FILE, position, 'owner completion'),
    ).resolves.toEqual({
      label: 'owner completion',
      additionalTextEditChanges: expectedEdit,
    });
    h.close();
  });

  it.each([
    {
      family: 'Location',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'locations',
        locations: [
          { uri: OWNER_FILE, range },
          { uri: FOREIGN_FILE, range },
        ],
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getTypeDefinition(PUBLIC_FILE, position),
    },
    {
      family: 'DefinitionLinks',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'definitionLinks',
        definitionLinks: {
          locations: [
            { targetUri: OWNER_FILE, targetRange: range, targetSelectionRange: range },
            { targetUri: FOREIGN_FILE, targetRange: range, targetSelectionRange: range },
          ],
        },
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getDefinitionLinks(PUBLIC_FILE, position),
    },
    {
      family: 'WorkspaceEdit changes',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'workspaceEdit',
        edit: ownerWorkspaceEdit(FOREIGN_FILE),
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getRenameEdits(PUBLIC_FILE, position, 'next'),
    },
    {
      family: 'WorkspaceEdit newFiles',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'workspaceEdit',
        edit: { ...ownerWorkspaceEdit(), newFiles: [OWNER_SECONDARY_FILE, FOREIGN_FILE] },
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getRenameEdits(PUBLIC_FILE, position, 'next'),
    },
    {
      family: 'WorkspaceEdit renameLocation',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'workspaceEdit',
        edit: { ...ownerWorkspaceEdit(), renameLocation: { uri: FOREIGN_FILE, range } },
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getRenameEdits(PUBLIC_FILE, position, 'next'),
    },
    {
      family: 'WorkspaceEdit renameFilename',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'workspaceEdit',
        edit: { ...ownerWorkspaceEdit(), renameFilename: FOREIGN_FILE },
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getRenameEdits(PUBLIC_FILE, position, 'next'),
    },
    {
      family: 'nested CodeAction',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'codeActions',
        codeActions: [{ title: 'foreign', edit: ownerWorkspaceEdit(FOREIGN_FILE) }],
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getCodeFixes(PUBLIC_FILE, range, [2304]),
    },
    {
      family: 'nested CompletionItem',
      respond: (request: TsRequest): TsResponse => ({
        id: request.id,
        ok: true,
        kind: 'completionItem',
        item: {
          label: 'foreign',
          additionalTextEditChanges: ownerWorkspaceEdit(FOREIGN_FILE),
        },
      }),
      invoke: (typescript: PlaygroundTypeScript) =>
        typescript.getCompletionDetails(PUBLIC_FILE, position, 'foreign'),
    },
  ])('rejects the whole $family result when one nested owner path is foreign', async (testCase) => {
    const h = harness(testCase.respond);

    await expect(testCase.invoke(h.typescript)).rejects.toBeInstanceOf(TypeError);

    h.close();
  });
});
