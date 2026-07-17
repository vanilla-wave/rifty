import type { LogEntry } from '@riftydev/git';
import type {
  TsRequest,
  TsRequestMessage,
  TsResponse,
  TsResponseMessage,
} from '@riftydev/ts-language-service/protocol';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import { createTsLanguageServiceClient } from '../../glue/ts-ls-client.ts';
import {
  ClosedHandleError,
  type SerializedWorkbenchOwnerError,
  deserializeWorkbenchOwnerError,
} from '../errors.ts';
import type {
  PlaygroundScm,
  PlaygroundScmBlob,
  PlaygroundScmChange,
  PlaygroundScmDiff,
  PlaygroundScmSnapshot,
} from '../playground.ts';
import type {
  PlaygroundPreviewRegistry,
  PlaygroundSessionTools,
  PlaygroundTypeScript,
} from '../playground.ts';
import type { ProjectDocumentsController, ProjectDocumentsRevision } from '../project-documents.ts';
import { assertProjectPath } from '../project-file-boundary.ts';
import {
  type PlaygroundArchiveBackend,
  type PlaygroundScmBackend,
  createPlaygroundScmArchiveTools,
} from './playground-session-tool-coordinator.ts';
import { createPlaygroundTypeScriptAdapter } from './playground-typescript.ts';

const PAGE_REQUEST = 'workbench:playground-session-tools-request' as const;
const PAGE_TS_REQUEST = 'workbench:playground-session-tools-ts-request' as const;
const OWNER_RESPONSE = 'workbench:playground-session-tools-response' as const;
const OWNER_SCM_SNAPSHOT = 'workbench:playground-session-tools-scm-snapshot' as const;
const OWNER_TS_RESPONSE = 'workbench:playground-session-tools-ts-response' as const;

export type PlaygroundSessionToolOperation =
  | { readonly type: 'scm:refresh' }
  | { readonly type: 'scm:diff'; readonly change: PlaygroundScmChange }
  | { readonly type: 'scm:stage'; readonly path: string }
  | { readonly type: 'scm:unstage'; readonly path: string }
  | { readonly type: 'scm:discard'; readonly path: string }
  | { readonly type: 'scm:commit'; readonly message: string }
  | { readonly type: 'archive:export' }
  | { readonly type: 'archive:import'; readonly archiveJson: string }
  | { readonly type: 'durability:flush' }
  | { readonly type: 'close' };

export type PlaygroundSessionToolResult =
  | { readonly type: 'scm:snapshot'; readonly snapshot: PlaygroundScmSnapshot }
  | { readonly type: 'scm:diff'; readonly diff: PlaygroundScmDiff }
  | { readonly type: 'scm:void' }
  | { readonly type: 'scm:revision'; readonly revision: ProjectDocumentsRevision }
  | { readonly type: 'scm:commit'; readonly oid: string }
  | { readonly type: 'archive:export'; readonly archiveJson: string }
  | { readonly type: 'archive:import'; readonly revision: ProjectDocumentsRevision }
  | { readonly type: 'durability:void' }
  | { readonly type: 'closed' };

export type PlaygroundSessionToolResponse =
  | { readonly ok: true; readonly result: PlaygroundSessionToolResult }
  | { readonly ok: false; readonly error: SerializedWorkbenchOwnerError };

export type PagePlaygroundSessionToolsFrame =
  | {
      readonly type: typeof PAGE_REQUEST;
      readonly requestId: string;
      readonly operation: PlaygroundSessionToolOperation;
    }
  | {
      readonly type: typeof PAGE_TS_REQUEST;
      readonly message: TsRequestMessage;
    };

export type OwnerPlaygroundSessionToolsFrame =
  | {
      readonly type: typeof OWNER_RESPONSE;
      readonly requestId: string;
      readonly response: PlaygroundSessionToolResponse;
    }
  | {
      readonly type: typeof OWNER_SCM_SNAPSHOT;
      readonly snapshot: PlaygroundScmSnapshot;
    }
  | {
      readonly type: typeof OWNER_TS_RESPONSE;
      readonly message: TsResponseMessage;
    };

interface ExactSchema {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

const TS_REQUEST_SCHEMAS: Readonly<Record<string, ExactSchema>> = Object.freeze({
  'ts:init': { required: ['id', 'type', 'projectRoot'] },
  'ts:open': { required: ['id', 'type', 'path', 'text'] },
  'ts:update': { required: ['id', 'type', 'path', 'text'] },
  'ts:close': { required: ['id', 'type', 'path'] },
  'ts:invalidate': { required: ['id', 'type', 'path'] },
  'ts:getSemanticDiagnostics': { required: ['id', 'type', 'path'] },
  'ts:getSyntacticDiagnostics': { required: ['id', 'type', 'path'] },
  'ts:getQuickInfo': {
    required: ['id', 'type', 'path', 'position'],
    optional: ['options'],
  },
  'ts:getDefinitionLinks': { required: ['id', 'type', 'path', 'position'] },
  'ts:getTypeDefinition': { required: ['id', 'type', 'path', 'position'] },
  'ts:getCompletions': {
    required: ['id', 'type', 'path', 'position'],
    optional: ['options'],
  },
  'ts:getCompletionDetails': {
    required: ['id', 'type', 'path', 'position', 'label'],
    optional: ['source', 'data', 'options'],
  },
  'ts:getReferences': { required: ['id', 'type', 'path', 'position', 'context'] },
  'ts:prepareRename': {
    required: ['id', 'type', 'path', 'position'],
    optional: ['options'],
  },
  'ts:getRenameEdits': {
    required: ['id', 'type', 'path', 'position', 'newName'],
    optional: ['options'],
  },
  'ts:getSignatureHelp': {
    required: ['id', 'type', 'path', 'position'],
    optional: ['options'],
  },
  'ts:getCodeFixes': {
    required: ['id', 'type', 'path', 'range', 'errorCodes'],
    optional: ['options'],
  },
  'ts:getCombinedCodeFix': {
    required: ['id', 'type', 'path', 'fixId'],
    optional: ['options'],
  },
  'ts:organizeImports': { required: ['id', 'type', 'path'], optional: ['options'] },
  'ts:getRefactorActions': {
    required: ['id', 'type', 'path', 'range'],
    optional: ['options'],
  },
  'ts:getFormattingEdits': { required: ['id', 'type', 'path', 'options'] },
  'ts:getRangeFormattingEdits': {
    required: ['id', 'type', 'path', 'range', 'options'],
  },
  'ts:getOnTypeFormattingEdits': {
    required: ['id', 'type', 'path', 'position', 'key', 'options'],
  },
  'ts:getImplementation': { required: ['id', 'type', 'path', 'position'] },
  'ts:getDocumentSymbols': { required: ['id', 'type', 'path'] },
  'ts:getFoldingRanges': { required: ['id', 'type', 'path'] },
  'ts:getInlayHints': {
    required: ['id', 'type', 'path', 'range'],
    optional: ['options'],
  },
  'ts:getDocumentHighlights': {
    required: ['id', 'type', 'path', 'position', 'filesToSearch'],
  },
  'ts:getEncodedSemanticClassifications': {
    required: ['id', 'type', 'path', 'range'],
  },
  'ts:getSelectionRange': { required: ['id', 'type', 'path', 'position'] },
  'ts:getLinkedEditingRange': { required: ['id', 'type', 'path', 'position'] },
  'ts:dispose': { required: ['id', 'type'] },
});

const TS_RESPONSE_SCHEMAS: Readonly<Record<string, ExactSchema>> = Object.freeze({
  ack: { required: ['id', 'ok', 'kind'] },
  diagnostics: { required: ['id', 'ok', 'kind', 'diagnostics'] },
  hover: { required: ['id', 'ok', 'kind', 'hover'] },
  locations: { required: ['id', 'ok', 'kind', 'locations'] },
  completions: { required: ['id', 'ok', 'kind', 'completions'] },
  completionItem: { required: ['id', 'ok', 'kind', 'item'] },
  prepareRename: { required: ['id', 'ok', 'kind', 'result'] },
  workspaceEdit: { required: ['id', 'ok', 'kind', 'edit'] },
  signatureHelp: { required: ['id', 'ok', 'kind', 'signatureHelp'] },
  codeActions: { required: ['id', 'ok', 'kind', 'codeActions'] },
  textEdits: { required: ['id', 'ok', 'kind', 'textEdits'] },
  definitionLinks: { required: ['id', 'ok', 'kind', 'definitionLinks'] },
  documentSymbols: { required: ['id', 'ok', 'kind', 'documentSymbols'] },
  foldingRanges: { required: ['id', 'ok', 'kind', 'foldingRanges'] },
  inlayHints: { required: ['id', 'ok', 'kind', 'inlayHints'] },
  documentHighlights: { required: ['id', 'ok', 'kind', 'documentHighlights'] },
  classifications: { required: ['id', 'ok', 'kind', 'classifications'] },
  selectionRange: { required: ['id', 'ok', 'kind', 'selectionRange'] },
  linkedEditingRange: { required: ['id', 'ok', 'kind', 'linkedEditingRange'] },
});

function invalid(label: string): TypeError {
  return new TypeError(`Invalid ${label}`);
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(label);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw invalid(label);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw invalid(label);
    }
  }
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown>, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !('value' in descriptor)) throw invalid(label);
  return descriptor.value;
}

function exact(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Reflect.ownKeys(record);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    throw invalid(label);
  }
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = field(record, key, label);
  if (typeof value !== 'string') throw invalid(label);
  return value;
}

function nonEmptyString(record: Record<string, unknown>, key: string, label: string): string {
  const value = stringField(record, key, label);
  if (value.length === 0) throw invalid(label);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(label);
  return value as number;
}

function clonePlainData(value: unknown, label: string, ancestors = new Set<object>()): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(label);
    return value;
  }
  if (typeof value !== 'object') throw invalid(label);
  if (ancestors.has(value)) throw invalid(label);

  if (value instanceof Uint8Array) {
    if (Object.getPrototypeOf(value) !== Uint8Array.prototype) throw invalid(label);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw invalid(label);
    }
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    if (
      Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
      Reflect.ownKeys(value).length !== 0
    ) {
      throw invalid(label);
    }
    return value.slice(0);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalid(label);
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.at(-1) !== 'length' ||
        keys.slice(0, -1).some((key, index) => key !== String(index))
      ) {
        throw invalid(label);
      }
      const copied = value.map((item, index) =>
        clonePlainData(item, `${label}[${String(index)}]`, ancestors),
      );
      return Object.freeze(copied);
    }

    const record = plainRecord(value, label);
    const copied: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      copied[key] = clonePlainData(field(record, key, label), `${label}.${key}`, ancestors);
    }
    return Object.freeze(copied);
  } finally {
    ancestors.delete(value);
  }
}

function cloneExactRecord(
  value: unknown,
  schema: ExactSchema,
  label: string,
): Readonly<Record<string, unknown>> {
  const record = plainRecord(value, label);
  const optional = schema.optional ?? [];
  const expected = [...schema.required, ...optional.filter((key) => Object.hasOwn(record, key))];
  exact(record, expected, label);
  const copied: Record<string, unknown> = {};
  for (const key of expected) {
    copied[key] = clonePlainData(field(record, key, label), `${label}.${key}`);
  }
  return Object.freeze(copied);
}

function cloneStringArray(value: unknown, label: string): readonly string[] {
  const cloned = clonePlainData(value, label);
  if (!Array.isArray(cloned) || cloned.some((item) => typeof item !== 'string')) {
    throw invalid(label);
  }
  return cloned as readonly string[];
}

function cloneTsRequest(value: unknown): TsRequest {
  const record = plainRecord(value, 'session tools TS request');
  const type = stringField(record, 'type', 'session tools TS request type');
  const schema = TS_REQUEST_SCHEMAS[type];
  if (schema === undefined) throw invalid('session tools TS request type');
  const cloned = cloneExactRecord(record, schema, 'session tools TS request');
  safeInteger(cloned.id, 'session tools TS request id');
  if (cloned.type !== type) throw invalid('session tools TS request type');

  for (const key of ['projectRoot', 'path', 'text', 'label', 'source', 'newName', 'key']) {
    if (Object.hasOwn(cloned, key) && typeof cloned[key] !== 'string') {
      throw invalid(`session tools TS request ${key}`);
    }
  }
  if (Object.hasOwn(cloned, 'filesToSearch')) {
    cloneStringArray(cloned.filesToSearch, 'session tools TS filesToSearch');
  }
  if (Object.hasOwn(cloned, 'errorCodes')) {
    const codes = clonePlainData(cloned.errorCodes, 'session tools TS errorCodes');
    if (!Array.isArray(codes) || codes.some((code) => !Number.isSafeInteger(code))) {
      throw invalid('session tools TS errorCodes');
    }
  }
  return cloned as unknown as TsRequest;
}

function cloneTsResponse(value: unknown): TsResponse {
  const record = plainRecord(value, 'session tools TS response');
  const kind = stringField(record, 'kind', 'session tools TS response kind');
  if (kind === 'error') {
    const cloned = cloneExactRecord(
      record,
      { required: ['id', 'ok', 'kind', 'error'] },
      'session tools TS response',
    );
    safeInteger(cloned.id, 'session tools TS response id');
    if (cloned.ok !== false) throw invalid('session tools TS response error flag');
    const error = plainRecord(cloned.error, 'session tools TS response error');
    const expected = ['name', 'message', ...(Object.hasOwn(error, 'feature') ? ['feature'] : [])];
    exact(error, expected, 'session tools TS response error');
    nonEmptyString(error, 'name', 'session tools TS response error name');
    stringField(error, 'message', 'session tools TS response error message');
    if (Object.hasOwn(error, 'feature')) {
      nonEmptyString(error, 'feature', 'session tools TS response error feature');
    }
    return cloned as unknown as TsResponse;
  }

  const schema = TS_RESPONSE_SCHEMAS[kind];
  if (schema === undefined) throw invalid('session tools TS response kind');
  const cloned = cloneExactRecord(record, schema, 'session tools TS response');
  safeInteger(cloned.id, 'session tools TS response id');
  if (cloned.ok !== true || cloned.kind !== kind) {
    throw invalid('session tools TS response success flag');
  }
  return cloned as unknown as TsResponse;
}

export function inspectSessionToolsTsRequestMessage(value: unknown): TsRequestMessage {
  const record = plainRecord(value, 'session tools TS request envelope');
  exact(record, ['type', 'request'], 'session tools TS request envelope');
  if (stringField(record, 'type', 'session tools TS request envelope type') !== 'rifty:ts-lsp') {
    throw invalid('session tools TS request envelope type');
  }
  return Object.freeze({
    type: 'rifty:ts-lsp',
    request: cloneTsRequest(field(record, 'request', 'session tools TS request envelope')),
  });
}

export function inspectSessionToolsTsResponseMessage(value: unknown): TsResponseMessage {
  const record = plainRecord(value, 'session tools TS response envelope');
  exact(record, ['type', 'response'], 'session tools TS response envelope');
  if (stringField(record, 'type', 'session tools TS response envelope type') !== 'rifty:ts-lsp') {
    throw invalid('session tools TS response envelope type');
  }
  return Object.freeze({
    type: 'rifty:ts-lsp',
    response: cloneTsResponse(field(record, 'response', 'session tools TS response envelope')),
  });
}

function ownerScopedPath(path: string, projectRoot: string): boolean {
  return (
    isAbsolute(path) &&
    !path.includes('\0') &&
    normalizePath(path) === path &&
    (path === projectRoot || path.startsWith(`${projectRoot}/`))
  );
}

/** Enforce the session root on every direct and nested path-bearing public TS request. */
export function assertSessionToolsTsRequestScope(
  message: TsRequestMessage,
  projectRoot: string,
): void {
  const request = message.request;
  if (request.type === 'ts:init' && request.projectRoot !== projectRoot) {
    throw new TypeError('TypeScript init project root does not match the session project root');
  }
  if (
    'path' in request &&
    (typeof request.path !== 'string' || !ownerScopedPath(request.path, projectRoot))
  ) {
    throw new TypeError('TypeScript request path is outside the session project root');
  }
  if (request.type === 'ts:getDocumentHighlights') {
    for (const path of request.filesToSearch) {
      if (!ownerScopedPath(path, projectRoot)) {
        throw new TypeError('TypeScript filesToSearch path is outside the session project root');
      }
    }
  }
}

function cloneIdentity(value: unknown): LogEntry['author'] {
  const record = plainRecord(value, 'SCM identity');
  exact(record, ['name', 'email', 'timestamp', 'timezoneOffset'], 'SCM identity');
  const name = stringField(record, 'name', 'SCM identity name');
  const email = stringField(record, 'email', 'SCM identity email');
  const timestamp = field(record, 'timestamp', 'SCM identity timestamp');
  const timezoneOffset = field(record, 'timezoneOffset', 'SCM identity timezone');
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(timezoneOffset)) {
    throw invalid('SCM identity timestamp');
  }
  return Object.freeze({
    name,
    email,
    timestamp: timestamp as number,
    timezoneOffset: timezoneOffset as number,
  });
}

function cloneLogEntry(value: unknown): LogEntry {
  const record = plainRecord(value, 'SCM history entry');
  exact(record, ['oid', 'message', 'author', 'committer', 'tree', 'parents'], 'SCM history entry');
  return Object.freeze({
    oid: nonEmptyString(record, 'oid', 'SCM history oid'),
    message: stringField(record, 'message', 'SCM history message'),
    author: cloneIdentity(field(record, 'author', 'SCM history author')),
    committer: cloneIdentity(field(record, 'committer', 'SCM history committer')),
    tree: nonEmptyString(record, 'tree', 'SCM history tree'),
    parents: cloneStringArray(
      field(record, 'parents', 'SCM history parents'),
      'SCM history parents',
    ) as string[],
  });
}

function cloneScmChange(value: unknown): PlaygroundScmChange {
  const record = plainRecord(value, 'SCM change');
  exact(record, ['path', 'code', 'area'], 'SCM change');
  const path = assertProjectPath(stringField(record, 'path', 'SCM change path'));
  const code = stringField(record, 'code', 'SCM change code');
  const area = stringField(record, 'area', 'SCM change area');
  if (code.length !== 2 || (area !== 'staged' && area !== 'working')) {
    throw invalid('SCM change');
  }
  return Object.freeze({ path, code, area });
}

export function inspectPlaygroundScmSnapshot(value: unknown): PlaygroundScmSnapshot {
  const record = plainRecord(value, 'SCM snapshot');
  const expected = Object.hasOwn(record, 'branch')
    ? ['branch', 'history', 'changes']
    : ['history', 'changes'];
  exact(record, expected, 'SCM snapshot');
  const history = clonePlainData(field(record, 'history', 'SCM history'), 'SCM history');
  const changes = clonePlainData(field(record, 'changes', 'SCM changes'), 'SCM changes');
  if (!Array.isArray(history) || !Array.isArray(changes)) throw invalid('SCM snapshot');
  return Object.freeze({
    ...(Object.hasOwn(record, 'branch')
      ? { branch: nonEmptyString(record, 'branch', 'SCM branch') }
      : {}),
    history: Object.freeze(history.map(cloneLogEntry)),
    changes: Object.freeze(changes.map(cloneScmChange)),
  });
}

function cloneScmBlob(value: unknown): PlaygroundScmBlob {
  const record = plainRecord(value, 'SCM blob');
  exact(record, ['source', 'bytes'], 'SCM blob');
  const source = stringField(record, 'source', 'SCM blob source');
  if (source !== 'head' && source !== 'index' && source !== 'working' && source !== 'empty') {
    throw invalid('SCM blob source');
  }
  const bytes = clonePlainData(field(record, 'bytes', 'SCM blob bytes'), 'SCM blob bytes');
  if (!(bytes instanceof Uint8Array)) throw invalid('SCM blob bytes');
  return Object.freeze({ source, bytes });
}

function cloneScmDiff(value: unknown): PlaygroundScmDiff {
  const record = plainRecord(value, 'SCM diff');
  exact(record, ['original', 'modified'], 'SCM diff');
  return Object.freeze({
    original: cloneScmBlob(field(record, 'original', 'SCM diff original')),
    modified: cloneScmBlob(field(record, 'modified', 'SCM diff modified')),
  });
}

function cloneRevision(value: unknown): ProjectDocumentsRevision {
  const record = plainRecord(value, 'session tools revision');
  exact(record, ['ownerEpoch', 'treeRevision'], 'session tools revision');
  return Object.freeze({
    ownerEpoch: nonEmptyString(record, 'ownerEpoch', 'session tools owner epoch'),
    treeRevision: safeInteger(
      field(record, 'treeRevision', 'session tools tree revision'),
      'session tools tree revision',
    ),
  });
}

function cloneError(value: unknown): SerializedWorkbenchOwnerError {
  const record = plainRecord(value, 'session tools error');
  exact(record, ['name', 'message'], 'session tools error');
  return Object.freeze({
    name: nonEmptyString(record, 'name', 'session tools error name'),
    message: stringField(record, 'message', 'session tools error message'),
  });
}

function cloneOperation(value: unknown): PlaygroundSessionToolOperation {
  const record = plainRecord(value, 'session tools operation');
  const type = stringField(record, 'type', 'session tools operation type');
  switch (type) {
    case 'scm:refresh':
    case 'archive:export':
    case 'durability:flush':
    case 'close':
      exact(record, ['type'], 'session tools operation');
      return Object.freeze({ type });
    case 'scm:diff':
      exact(record, ['type', 'change'], 'session tools operation');
      return Object.freeze({
        type,
        change: cloneScmChange(field(record, 'change', 'session tools SCM change')),
      });
    case 'scm:stage':
    case 'scm:unstage':
    case 'scm:discard':
      exact(record, ['type', 'path'], 'session tools operation');
      return Object.freeze({
        type,
        path: assertProjectPath(stringField(record, 'path', 'session tools SCM path')),
      });
    case 'scm:commit':
      exact(record, ['type', 'message'], 'session tools operation');
      return Object.freeze({
        type,
        message: stringField(record, 'message', 'session tools commit message'),
      });
    case 'archive:import':
      exact(record, ['type', 'archiveJson'], 'session tools operation');
      return Object.freeze({
        type,
        archiveJson: stringField(record, 'archiveJson', 'session tools archive JSON'),
      });
    default:
      throw invalid('session tools operation type');
  }
}

function cloneResult(value: unknown): PlaygroundSessionToolResult {
  const record = plainRecord(value, 'session tools result');
  const type = stringField(record, 'type', 'session tools result type');
  switch (type) {
    case 'scm:snapshot':
      exact(record, ['type', 'snapshot'], 'session tools result');
      return Object.freeze({
        type,
        snapshot: inspectPlaygroundScmSnapshot(
          field(record, 'snapshot', 'session tools SCM snapshot'),
        ),
      });
    case 'scm:diff':
      exact(record, ['type', 'diff'], 'session tools result');
      return Object.freeze({
        type,
        diff: cloneScmDiff(field(record, 'diff', 'session tools SCM diff')),
      });
    case 'scm:void':
    case 'durability:void':
    case 'closed':
      exact(record, ['type'], 'session tools result');
      return Object.freeze({ type });
    case 'scm:revision':
    case 'archive:import':
      exact(record, ['type', 'revision'], 'session tools result');
      return Object.freeze({
        type,
        revision: cloneRevision(field(record, 'revision', 'session tools revision')),
      });
    case 'scm:commit':
      exact(record, ['type', 'oid'], 'session tools result');
      return Object.freeze({
        type,
        oid: nonEmptyString(record, 'oid', 'session tools commit oid'),
      });
    case 'archive:export':
      exact(record, ['type', 'archiveJson'], 'session tools result');
      return Object.freeze({
        type,
        archiveJson: stringField(record, 'archiveJson', 'session tools archive JSON'),
      });
    default:
      throw invalid('session tools result type');
  }
}

function cloneResponse(value: unknown): PlaygroundSessionToolResponse {
  const record = plainRecord(value, 'session tools response');
  const ok = field(record, 'ok', 'session tools response');
  if (ok === true) {
    exact(record, ['ok', 'result'], 'session tools response');
    return Object.freeze({
      ok: true,
      result: cloneResult(field(record, 'result', 'session tools response result')),
    });
  }
  if (ok === false) {
    exact(record, ['ok', 'error'], 'session tools response');
    return Object.freeze({
      ok: false,
      error: cloneError(field(record, 'error', 'session tools response error')),
    });
  }
  throw invalid('session tools response status');
}

export function inspectPagePlaygroundSessionToolsFrame(
  value: unknown,
): PagePlaygroundSessionToolsFrame {
  const record = plainRecord(value, 'page session tools frame');
  const type = stringField(record, 'type', 'page session tools frame type');
  if (type === PAGE_REQUEST) {
    exact(record, ['type', 'requestId', 'operation'], 'page session tools frame');
    return Object.freeze({
      type,
      requestId: nonEmptyString(record, 'requestId', 'session tools request id'),
      operation: cloneOperation(field(record, 'operation', 'session tools operation')),
    });
  }
  if (type === PAGE_TS_REQUEST) {
    exact(record, ['type', 'message'], 'page session tools frame');
    return Object.freeze({
      type,
      message: inspectSessionToolsTsRequestMessage(
        field(record, 'message', 'session tools TS request'),
      ),
    });
  }
  throw invalid('page session tools frame type');
}

export function inspectOwnerPlaygroundSessionToolsFrame(
  value: unknown,
): OwnerPlaygroundSessionToolsFrame {
  const record = plainRecord(value, 'owner session tools frame');
  const type = stringField(record, 'type', 'owner session tools frame type');
  if (type === OWNER_RESPONSE) {
    exact(record, ['type', 'requestId', 'response'], 'owner session tools frame');
    return Object.freeze({
      type,
      requestId: nonEmptyString(record, 'requestId', 'session tools request id'),
      response: cloneResponse(field(record, 'response', 'session tools response')),
    });
  }
  if (type === OWNER_SCM_SNAPSHOT) {
    exact(record, ['type', 'snapshot'], 'owner session tools frame');
    return Object.freeze({
      type,
      snapshot: inspectPlaygroundScmSnapshot(
        field(record, 'snapshot', 'session tools SCM snapshot'),
      ),
    });
  }
  if (type === OWNER_TS_RESPONSE) {
    exact(record, ['type', 'message'], 'owner session tools frame');
    return Object.freeze({
      type,
      message: inspectSessionToolsTsResponseMessage(
        field(record, 'message', 'session tools TS response'),
      ),
    });
  }
  throw invalid('owner session tools frame type');
}

interface PendingRequest {
  readonly resolve: (result: PlaygroundSessionToolResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const browserTypeScriptReinitializers = new WeakMap<object, () => Promise<void>>();
const browserSessionDurabilityFlushers = new WeakMap<object, () => Promise<void>>();

/** Package-private App seam: rebuild the captured project without exposing init(root). */
export function reinitializeBrowserPlaygroundTypeScript(
  typescript: PlaygroundTypeScript,
): Promise<void> {
  const reinitialize = browserTypeScriptReinitializers.get(typescript as object);
  return reinitialize === undefined
    ? Promise.reject(new TypeError('Unknown browser Playground TypeScript tool'))
    : reinitialize();
}

/** Package-private App seam: settle the captured owner without widening session tools. */
export function flushBrowserPlaygroundSessionDurability(
  tools: PlaygroundSessionTools,
): Promise<void> {
  const flush = browserSessionDurabilityFlushers.get(tools as object);
  return flush === undefined
    ? Promise.reject(new TypeError('Unknown browser Playground session tools'))
    : flush();
}

export interface BrowserPlaygroundSessionToolsOptions {
  readonly projectRoot: string;
  readonly documents: Pick<ProjectDocumentsController, 'awaitOwnerByteAdmission' | 'invalidate'>;
  readonly initialScmSnapshot: PlaygroundScmSnapshot;
  readonly previews: PlaygroundPreviewRegistry;
  readonly send: (frame: PagePlaygroundSessionToolsFrame) => boolean | undefined;
  readonly subscribe: (listener: (frame: unknown) => void) => () => void;
  readonly generateRequestId?: () => string;
  readonly requestTimeoutMs?: number;
  readonly tsRequestTimeoutMs?: number;
}

export interface BrowserPlaygroundSessionToolsLifecycle {
  readonly tools: PlaygroundSessionTools;
  close(): Promise<void>;
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function aggregateOrThrow(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

/** Browser-side semantic proxy; owner identity and physical routing stay captured. */
export function createBrowserPlaygroundSessionTools(
  options: BrowserPlaygroundSessionToolsOptions,
): BrowserPlaygroundSessionToolsLifecycle {
  const requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  const pending = new Map<string, PendingRequest>();
  const admitted = new Set<Promise<unknown>>();
  const scmListeners = new Set<(snapshot: PlaygroundScmSnapshot) => void>();
  const tsListeners = new Set<(message: unknown) => void>();
  let scmSnapshot = inspectPlaygroundScmSnapshot(options.initialScmSnapshot);
  let accepting = true;
  let transportFailure: Error | null = null;
  let closePromise: Promise<void> | null = null;
  let requestSequence = 0;
  let tsInitialized = false;
  let tsInit: Promise<void> | null = null;
  let disposeTsClient = (): void => {};

  const assertAccepting = (): void => {
    if (transportFailure !== null) throw transportFailure;
    if (!accepting) throw new ClosedHandleError('Playground session tools');
  };

  const failTransport = (reason: unknown): void => {
    if (transportFailure !== null) return;
    transportFailure = errorFrom(reason);
    accepting = false;
    for (const [requestId, waiter] of pending) {
      pending.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.reject(transportFailure);
    }
    disposeTsClient();
  };

  const emit = (frame: PagePlaygroundSessionToolsFrame): void => {
    const inspected = inspectPagePlaygroundSessionToolsFrame(frame);
    const accepted = options.send(inspected);
    if (accepted === false) throw new Error('Playground session tools transport refused a frame');
  };

  const unsubscribe = options.subscribe((candidate) => {
    let frame: OwnerPlaygroundSessionToolsFrame;
    try {
      frame = inspectOwnerPlaygroundSessionToolsFrame(candidate);
    } catch (error) {
      failTransport(error);
      return;
    }
    switch (frame.type) {
      case OWNER_RESPONSE: {
        const waiter = pending.get(frame.requestId);
        if (waiter === undefined) return;
        pending.delete(frame.requestId);
        clearTimeout(waiter.timer);
        if (frame.response.ok) waiter.resolve(frame.response.result);
        else waiter.reject(deserializeWorkbenchOwnerError(frame.response.error));
        return;
      }
      case OWNER_SCM_SNAPSHOT:
        scmSnapshot = frame.snapshot;
        for (const listener of [...scmListeners]) {
          try {
            listener(scmSnapshot);
          } catch {
            // One host listener cannot suppress sibling state delivery.
          }
        }
        return;
      case OWNER_TS_RESPONSE:
        for (const listener of [...tsListeners]) {
          try {
            listener(frame.message);
          } catch {
            // The correlated TS client owns its own failure state.
          }
        }
    }
  });

  const nextRequestId = (): string => {
    const requestId = options.generateRequestId?.() ?? `session-tools-${String(++requestSequence)}`;
    if (typeof requestId !== 'string' || requestId.length === 0 || pending.has(requestId)) {
      throw new TypeError('Playground session tools request id must be unique and non-empty');
    }
    return requestId;
  };

  const request = (
    operation: PlaygroundSessionToolOperation,
  ): Promise<PlaygroundSessionToolResult> => {
    if (transportFailure !== null) return Promise.reject(transportFailure);
    const requestId = nextRequestId();
    return new Promise<PlaygroundSessionToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            `Playground session tools request ${requestId} timed out after ${String(requestTimeoutMs)}ms`,
          ),
        );
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        emit({ type: PAGE_REQUEST, requestId, operation });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(errorFrom(error));
      }
    });
  };

  const admit = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      assertAccepting();
    } catch (error) {
      return Promise.reject(error);
    }
    let task: Promise<T>;
    try {
      task = Promise.resolve(operation());
    } catch (error) {
      task = Promise.reject(error);
    }
    admitted.add(task);
    void task.then(
      () => admitted.delete(task),
      () => admitted.delete(task),
    );
    return task;
  };

  const resultType = <Type extends PlaygroundSessionToolResult['type']>(
    result: PlaygroundSessionToolResult,
    expected: Type,
  ): Extract<PlaygroundSessionToolResult, { readonly type: Type }> => {
    if (result.type !== expected) {
      throw new Error(`Playground session tools expected ${expected}, got ${result.type}`);
    }
    return result as Extract<PlaygroundSessionToolResult, { readonly type: Type }>;
  };

  const scmBackend: PlaygroundScmBackend = Object.freeze({
    snapshot: () => scmSnapshot,
    subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void) {
      scmListeners.add(listener);
      try {
        listener(scmSnapshot);
      } catch {
        // Initial delivery obeys sibling listener isolation.
      }
      return () => scmListeners.delete(listener);
    },
    async refresh() {
      const result = resultType(await request({ type: 'scm:refresh' }), 'scm:snapshot');
      scmSnapshot = result.snapshot;
      return result.snapshot;
    },
    async diff(change) {
      return resultType(await request({ type: 'scm:diff', change }), 'scm:diff').diff;
    },
    async stage(path) {
      resultType(await request({ type: 'scm:stage', path }), 'scm:void');
    },
    async unstage(path) {
      resultType(await request({ type: 'scm:unstage', path }), 'scm:void');
    },
    async discard(path) {
      return resultType(await request({ type: 'scm:discard', path }), 'scm:revision');
    },
    async commit(message) {
      return resultType(await request({ type: 'scm:commit', message }), 'scm:commit').oid;
    },
  });

  const archiveBackend: PlaygroundArchiveBackend = Object.freeze({
    async export() {
      return resultType(await request({ type: 'archive:export' }), 'archive:export').archiveJson;
    },
    async import(archiveJson: string) {
      return resultType(await request({ type: 'archive:import', archiveJson }), 'archive:import');
    },
  });

  const coordinated = createPlaygroundScmArchiveTools({
    documents: options.documents,
    scm: scmBackend,
    archive: archiveBackend,
  });

  const tsClient = createTsLanguageServiceClient(
    {
      sendTsLsp(message) {
        emit({
          type: PAGE_TS_REQUEST,
          message: inspectSessionToolsTsRequestMessage(message),
        });
      },
      onTsLsp(listener) {
        tsListeners.add(listener);
        return () => tsListeners.delete(listener);
      },
    },
    { timeoutMs: options.tsRequestTimeoutMs },
  );
  disposeTsClient = () => tsClient.dispose();
  const initializeTs = (): Promise<void> => {
    const prior = tsInit;
    const initialized = (prior === null ? Promise.resolve() : prior.catch(() => {}))
      .then(() => tsClient.init(options.projectRoot))
      .then(() => {
        tsInitialized = true;
      });
    tsInit = initialized;
    return initialized;
  };
  const ensureTs = (): Promise<void> => tsInit ?? initializeTs();
  const adaptedTypeScript = createPlaygroundTypeScriptAdapter({
    projectRoot: options.projectRoot,
    client: tsClient,
  });
  const wrappedTsMethods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const property of Reflect.ownKeys(adaptedTypeScript)) {
    if (typeof property !== 'string') {
      throw new TypeError('Playground TypeScript adapter exposed a symbol method');
    }
    const descriptor = Object.getOwnPropertyDescriptor(adaptedTypeScript, property);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`Playground TypeScript adapter method ${property} is invalid`);
    }
    const method = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    wrappedTsMethods[property] = (...args: unknown[]): Promise<unknown> =>
      admit(async () => {
        await ensureTs();
        return Reflect.apply(method, adaptedTypeScript, args);
      });
  }
  const typescript = Object.freeze(wrappedTsMethods) as unknown as PlaygroundTypeScript;
  browserTypeScriptReinitializers.set(typescript as object, () => admit(initializeTs));

  const scm: PlaygroundScm = Object.freeze({
    snapshot() {
      assertAccepting();
      return coordinated.scm.snapshot();
    },
    subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void) {
      assertAccepting();
      return coordinated.scm.subscribe(listener);
    },
    refresh: () => admit(() => coordinated.scm.refresh()),
    diff: (change: PlaygroundScmChange) => admit(() => coordinated.scm.diff(change)),
    stage: (path: string) => admit(() => coordinated.scm.stage(path)),
    unstage: (path: string) => admit(() => coordinated.scm.unstage(path)),
    discard: (path: string) => admit(() => coordinated.scm.discard(path)),
    commit: (message: string) => admit(() => coordinated.scm.commit(message)),
  });
  const archive = Object.freeze({
    export: () => admit(() => coordinated.archive.export()),
    import: (archiveJson: string) => admit(() => coordinated.archive.import(archiveJson)),
  });
  const previews: PlaygroundPreviewRegistry = Object.freeze({
    snapshot() {
      assertAccepting();
      return options.previews.snapshot();
    },
    subscribe(listener: Parameters<PlaygroundPreviewRegistry['subscribe']>[0]) {
      assertAccepting();
      return options.previews.subscribe(listener);
    },
  });
  const tools: PlaygroundSessionTools = Object.freeze({ typescript, scm, archive, previews });
  browserSessionDurabilityFlushers.set(tools as object, () =>
    admit(async () => {
      resultType(await request({ type: 'durability:flush' }), 'durability:void');
    }),
  );

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    accepting = false;
    closePromise = (async () => {
      const failures: unknown[] = [];
      await Promise.allSettled([...admitted]);
      if (tsInitialized) {
        try {
          await tsClient.disposeLanguageService();
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        resultType(await request({ type: 'close' }), 'closed');
      } catch (error) {
        failures.push(error);
      } finally {
        tsClient.dispose();
        unsubscribe();
        scmListeners.clear();
        tsListeners.clear();
        for (const [requestId, waiter] of pending) {
          pending.delete(requestId);
          clearTimeout(waiter.timer);
          waiter.reject(new ClosedHandleError('Playground session tools'));
        }
      }
      aggregateOrThrow(failures, 'Playground session tools close failed');
    })();
    return closePromise;
  };

  return Object.freeze({ tools, close });
}
