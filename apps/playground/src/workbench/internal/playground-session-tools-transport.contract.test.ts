import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommitOperation, OwnerVfsSnapshotEntry } from '../../glue/owner-vfs-protocol.ts';
import type { VfsCommitReceipt } from '../../glue/vfs-commit-coordinator.ts';
import { ClosedHandleError } from '../errors.ts';
import type { PlaygroundPreviewRegistry } from '../playground.ts';
import { createProjectDocumentsController } from '../project-documents.ts';
import { createProjectFileVersionBoundary } from '../project-file-boundary.ts';
import {
  type OwnerPlaygroundSessionToolsFrame,
  type PagePlaygroundSessionToolsFrame,
  createBrowserPlaygroundSessionTools,
  inspectOwnerPlaygroundSessionToolsFrame,
  inspectPagePlaygroundSessionToolsFrame,
} from './playground-session-tools-transport.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const SOURCE = '/src/main.ts';
const OWNER_SOURCE = `${PROJECT_ROOT}${SOURCE}`;
const encoder = new TextEncoder();

const identity = Object.freeze({
  name: 'Rifty',
  email: 'rifty@example.test',
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
});
const noParents: string[] = [];
Object.freeze(noParents);

const snapshot = Object.freeze({
  branch: 'main',
  history: Object.freeze([
    Object.freeze({
      oid: 'commit-a',
      message: 'initial',
      author: identity,
      committer: identity,
      tree: 'tree-a',
      parents: noParents,
    }),
  ]),
  changes: Object.freeze([Object.freeze({ path: SOURCE, code: ' M', area: 'working' as const })]),
});

const revision = Object.freeze({ ownerEpoch: 'owner-a', treeRevision: 7 });

function emptyPreviews(): PlaygroundPreviewRegistry {
  const snapshot = Object.freeze([]);
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: Parameters<PlaygroundPreviewRegistry['subscribe']>[0]) {
      listener(snapshot);
      return () => {};
    },
  });
}

function pageFrames(): readonly PagePlaygroundSessionToolsFrame[] {
  return [
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '1',
      operation: { type: 'scm:refresh' },
    },
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '2',
      operation: { type: 'scm:diff', change: snapshot.changes[0]! },
    },
    ...(['stage', 'unstage', 'discard'] as const).map(
      (operation, index): PagePlaygroundSessionToolsFrame => ({
        type: 'workbench:playground-session-tools-request',
        requestId: String(index + 3),
        operation: { type: `scm:${operation}`, path: SOURCE },
      }),
    ),
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '6',
      operation: { type: 'scm:commit', message: 'commit message' },
    },
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '7',
      operation: { type: 'archive:export' },
    },
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '8',
      operation: {
        type: 'archive:import',
        archiveJson: '{"version":1,"root":"/","files":[]}',
      },
    },
    {
      type: 'workbench:playground-session-tools-request',
      requestId: '9',
      operation: { type: 'close' },
    },
    {
      type: 'workbench:playground-session-tools-ts-request',
      message: {
        type: 'rifty:ts-lsp',
        request: { id: 11, type: 'ts:init', projectRoot: PROJECT_ROOT },
      },
    },
    {
      type: 'workbench:playground-session-tools-ts-request',
      message: {
        type: 'rifty:ts-lsp',
        request: {
          id: 12,
          type: 'ts:getDocumentHighlights',
          path: OWNER_SOURCE,
          position: { line: 0, character: 1 },
          filesToSearch: [OWNER_SOURCE],
        },
      },
    },
  ];
}

function ownerFrames(): readonly OwnerPlaygroundSessionToolsFrame[] {
  return [
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '1',
      response: { ok: true, result: { type: 'scm:snapshot', snapshot } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '2',
      response: {
        ok: true,
        result: {
          type: 'scm:diff',
          diff: {
            original: { source: 'head', bytes: encoder.encode('old') },
            modified: { source: 'working', bytes: encoder.encode('new') },
          },
        },
      },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '3',
      response: { ok: true, result: { type: 'scm:void' } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '4',
      response: { ok: true, result: { type: 'scm:revision', revision } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '5',
      response: { ok: true, result: { type: 'scm:commit', oid: 'commit-b' } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '6',
      response: {
        ok: true,
        result: { type: 'archive:export', archiveJson: '{"version":1,"root":"/","files":[]}' },
      },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '7',
      response: { ok: true, result: { type: 'archive:import', revision } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '8',
      response: { ok: true, result: { type: 'closed' } },
    },
    {
      type: 'workbench:playground-session-tools-response',
      requestId: '9',
      response: { ok: false, error: { name: 'Error', message: 'failed' } },
    },
    {
      type: 'workbench:playground-session-tools-scm-snapshot',
      snapshot,
    },
    {
      type: 'workbench:playground-session-tools-ts-response',
      message: {
        type: 'rifty:ts-lsp',
        response: { id: 11, ok: true, kind: 'ack' },
      },
    },
  ];
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return;
  if (seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) expectDeepFrozen(descriptor.value, seen);
  }
}

describe('exact session-tools transport frames', () => {
  it('copies, freezes, and structured-clones every finite page operation and TS envelope', () => {
    for (const source of pageFrames()) {
      const inspected = inspectPagePlaygroundSessionToolsFrame(source);
      expect(inspected).toEqual(source);
      expect(inspected).not.toBe(source);
      expect(structuredClone(inspected)).toEqual(inspected);
      expectDeepFrozen(inspected);
    }
  });

  it('copies, freezes, and structured-clones every finite owner result sibling', () => {
    for (const source of ownerFrames()) {
      const inspected = inspectOwnerPlaygroundSessionToolsFrame(source);
      expect(inspected).toEqual(source);
      expect(inspected).not.toBe(source);
      expect(structuredClone(inspected)).toEqual(inspected);
      expectDeepFrozen(inspected);
    }
  });

  it('rejects extra keys, symbols, custom prototypes, accessors, and malformed byte views', () => {
    const valid = pageFrames()[0]!;
    expect(() =>
      inspectPagePlaygroundSessionToolsFrame({ ...valid, ownerRoot: PROJECT_ROOT }),
    ).toThrow(TypeError);
    expect(() =>
      inspectPagePlaygroundSessionToolsFrame(Object.assign(Object.create({}), valid)),
    ).toThrow(TypeError);
    expect(() =>
      inspectPagePlaygroundSessionToolsFrame({ ...valid, [Symbol('secret')]: true }),
    ).toThrow(TypeError);

    let getterRead = false;
    const accessor = {};
    Object.defineProperty(accessor, 'type', {
      enumerable: true,
      get() {
        getterRead = true;
        return valid.type;
      },
    });
    expect(() => inspectPagePlaygroundSessionToolsFrame(accessor)).toThrow(TypeError);
    expect(getterRead).toBe(false);

    const response = ownerFrames()[1]!;
    const malformed = structuredClone(response) as Extract<
      OwnerPlaygroundSessionToolsFrame,
      { readonly type: 'workbench:playground-session-tools-response' }
    >;
    if (malformed.response.ok === true && malformed.response.result.type === 'scm:diff') {
      Object.defineProperty(malformed.response.result.diff.original.bytes, 'secret', { value: 1 });
    }
    expect(() => inspectOwnerPlaygroundSessionToolsFrame(malformed)).toThrow(TypeError);
  });

  it('rejects unsupported or inexact official TS protocol siblings', () => {
    const base = pageFrames().at(-1)! as Extract<
      PagePlaygroundSessionToolsFrame,
      { readonly type: 'workbench:playground-session-tools-ts-request' }
    >;
    expect(() =>
      inspectPagePlaygroundSessionToolsFrame({
        ...base,
        message: { ...base.message, request: { ...base.message.request, ownerBridgeKey: 'old' } },
      }),
    ).toThrow(TypeError);
    expect(() =>
      inspectPagePlaygroundSessionToolsFrame({
        ...base,
        message: { type: 'rifty:ts-lsp', request: { id: 1, type: 'ts:getProgram' } },
      }),
    ).toThrow(TypeError);
  });
});

function documentsController() {
  const fs = new MemoryFsSync();
  fs.mkdirSync(`${PROJECT_ROOT}/src`, { recursive: true });
  fs.writeFileSync(OWNER_SOURCE, encoder.encode('export const value = 1;\n'));
  const versions = createProjectFileVersionBoundary('session-tools-transport');
  const readVersionedFile = async (path: string) => {
    const content = fs.readFileBytesSync(path);
    return {
      path,
      kind: 'file' as const,
      size: content.byteLength,
      content,
      version: 'v1',
      ownerEpoch: 'owner-a',
      treeRevision: 1,
    } satisfies Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }> & {
      readonly ownerEpoch: string;
      readonly treeRevision: number;
    };
  };
  const commit = async (_operation: HostCommitOperation): Promise<VfsCommitReceipt> => {
    throw new Error('unexpected document commit');
  };
  return createProjectDocumentsController({
    projectRoot: PROJECT_ROOT,
    versions,
    readVersionedFile,
    committer: { commit },
  });
}

interface RouteHarness {
  readonly sent: PagePlaygroundSessionToolsFrame[];
  readonly send: (frame: PagePlaygroundSessionToolsFrame) => boolean;
  readonly subscribe: (listener: (frame: unknown) => void) => () => void;
  deliver(frame: OwnerPlaygroundSessionToolsFrame): void;
}

function routeHarness(): RouteHarness {
  const sent: PagePlaygroundSessionToolsFrame[] = [];
  const listeners = new Set<(frame: unknown) => void>();
  return {
    sent,
    send(frame) {
      sent.push(structuredClone(frame));
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    deliver(frame) {
      for (const listener of [...listeners]) listener(structuredClone(frame));
    },
  };
}

function okResponse(
  requestId: string,
  result: Extract<
    OwnerPlaygroundSessionToolsFrame,
    { readonly type: 'workbench:playground-session-tools-response' }
  >['response'] extends infer Response
    ? Response extends { readonly ok: true; readonly result: infer Result }
      ? Result
      : never
    : never,
): OwnerPlaygroundSessionToolsFrame {
  return {
    type: 'workbench:playground-session-tools-response',
    requestId,
    response: { ok: true, result },
  };
}

describe('browser session-tools lifecycle and proxies', () => {
  it('keeps routing private, replays SCM state, and maps TS paths through the semantic adapter', async () => {
    const route = routeHarness();
    let requestSequence = 0;
    const lifecycle = createBrowserPlaygroundSessionTools({
      projectRoot: PROJECT_ROOT,
      documents: documentsController(),
      initialScmSnapshot: snapshot,
      previews: emptyPreviews(),
      send: route.send,
      subscribe: route.subscribe,
      generateRequestId: () => `request-${String(++requestSequence)}`,
      requestTimeoutMs: 1_000,
      tsRequestTimeoutMs: 1_000,
    });

    expect(Object.isFrozen(lifecycle.tools)).toBe(true);
    expect(Reflect.ownKeys(lifecycle.tools)).toEqual(['typescript', 'scm', 'archive', 'previews']);
    expect(lifecycle.tools.previews.snapshot()).toEqual([]);
    expect(JSON.stringify(lifecycle.tools)).not.toContain(PROJECT_ROOT);

    const scmListener = vi.fn();
    lifecycle.tools.scm.subscribe(scmListener);
    expect(scmListener).toHaveBeenLastCalledWith(snapshot);
    route.deliver({ type: 'workbench:playground-session-tools-scm-snapshot', snapshot });
    expect(scmListener).toHaveBeenCalledTimes(2);

    const diagnostics = lifecycle.tools.typescript.getSyntacticDiagnostics(SOURCE);
    await vi.waitFor(() => expect(route.sent).toHaveLength(1));
    const init = route.sent[0]!;
    expect(init).toEqual({
      type: 'workbench:playground-session-tools-ts-request',
      message: {
        type: 'rifty:ts-lsp',
        request: { id: expect.any(Number), type: 'ts:init', projectRoot: PROJECT_ROOT },
      },
    });
    if (init.type !== 'workbench:playground-session-tools-ts-request')
      throw new Error('expected TS init');
    route.deliver({
      type: 'workbench:playground-session-tools-ts-response',
      message: {
        type: 'rifty:ts-lsp',
        response: { id: init.message.request.id, ok: true, kind: 'ack' },
      },
    });
    await vi.waitFor(() => expect(route.sent).toHaveLength(2));
    const query = route.sent[1]!;
    if (query.type !== 'workbench:playground-session-tools-ts-request')
      throw new Error('expected TS query');
    expect(query.message.request).toMatchObject({
      type: 'ts:getSyntacticDiagnostics',
      path: OWNER_SOURCE,
    });
    route.deliver({
      type: 'workbench:playground-session-tools-ts-response',
      message: {
        type: 'rifty:ts-lsp',
        response: { id: query.message.request.id, ok: true, kind: 'diagnostics', diagnostics: [] },
      },
    });
    await expect(diagnostics).resolves.toEqual([]);

    const close = lifecycle.close();
    await vi.waitFor(() => expect(route.sent).toHaveLength(3));
    const dispose = route.sent[2]!;
    if (dispose.type !== 'workbench:playground-session-tools-ts-request')
      throw new Error('expected TS dispose');
    route.deliver({
      type: 'workbench:playground-session-tools-ts-response',
      message: {
        type: 'rifty:ts-lsp',
        response: { id: dispose.message.request.id, ok: true, kind: 'ack' },
      },
    });
    await vi.waitFor(() => expect(route.sent).toHaveLength(4));
    const closeRequest = route.sent[3]!;
    if (closeRequest.type !== 'workbench:playground-session-tools-request')
      throw new Error('expected close request');
    route.deliver(okResponse(closeRequest.requestId, { type: 'closed' }));
    await close;
  });

  it('fences new calls, drains admitted work, then closes the owner endpoint exactly once', async () => {
    const route = routeHarness();
    let requestSequence = 0;
    const lifecycle = createBrowserPlaygroundSessionTools({
      projectRoot: PROJECT_ROOT,
      documents: documentsController(),
      initialScmSnapshot: snapshot,
      previews: emptyPreviews(),
      send: route.send,
      subscribe: route.subscribe,
      generateRequestId: () => `drain-${String(++requestSequence)}`,
      requestTimeoutMs: 1_000,
      tsRequestTimeoutMs: 1_000,
    });

    const refresh = lifecycle.tools.scm.refresh();
    await vi.waitFor(() => expect(route.sent).toHaveLength(1));
    const close = lifecycle.close();
    expect(lifecycle.close()).toBe(close);
    await expect(lifecycle.tools.scm.refresh()).rejects.toBeInstanceOf(ClosedHandleError);
    expect(() => lifecycle.tools.previews.snapshot()).toThrow(ClosedHandleError);
    expect(route.sent).toHaveLength(1);

    const refreshRequest = route.sent[0]!;
    if (refreshRequest.type !== 'workbench:playground-session-tools-request')
      throw new Error('expected refresh');
    route.deliver(okResponse(refreshRequest.requestId, { type: 'scm:snapshot', snapshot }));
    await expect(refresh).resolves.toEqual(snapshot);
    await vi.waitFor(() => expect(route.sent).toHaveLength(2));
    const closeRequest = route.sent[1]!;
    if (closeRequest.type !== 'workbench:playground-session-tools-request')
      throw new Error('expected close');
    expect(closeRequest.operation).toEqual({ type: 'close' });
    route.deliver(okResponse(closeRequest.requestId, { type: 'closed' }));
    await expect(close).resolves.toBeUndefined();
  });
});
