import { RegistryClient } from '@riftydev/npm-client';
import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { HostCommitRequest } from '../glue/owner-vfs-protocol.ts';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
} from '../workbench/project-vfs-protocol.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const OUTSIDE = '/.rifty/workbench/v1/projects/project-b/tree';
const OWNER_EPOCH = 'workbench-project-vfs-test';
const encoder = new TextEncoder();
const packageJson = '{"name":"project-a","version":"1.0.0"}\n';
const bootstrapConfig: OwnerPackageConfig['cfg'] = {
  runtime: 'node-cli',
  root: ROOT,
  entryPath: `${ROOT}/src/main.ts`,
  packageName: 'project-a',
  packageVersion: '1.0.0',
  installDeps: {},
  packageJson,
  seedFiles: {},
};
const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'project-vfs-test',
  slug: 'project-a',
  fromScratch: true,
};

class FaultInjectableMemoryFsSync extends MemoryFsSync {
  #readdirFailure: Error | null = null;

  failNextReaddir(error: Error): void {
    this.#readdirFailure = error;
  }

  override readdirSync(path: string) {
    const failure = this.#readdirFailure;
    this.#readdirFailure = null;
    if (failure !== null) throw failure;
    return super.readdirSync(path);
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function isPending<T>(promise: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function harness(
  fatal: (error: Error) => void = (error) => {
    throw error;
  },
  onEmit: (frame: OwnerProjectVfsFrame) => void = () => {},
  recordMutation: (kind: 'guest' | 'file', treeRevision: number) => Promise<void> = async () => {},
) {
  const memory = createMemoryFs();
  const rawFs = new FaultInjectableMemoryFsSync(memory.backend);
  const { authority, appliedMutations, installStampClaims } = createOwnerVfsAuthorityComposition(
    rawFs,
    {
      ownerEpoch: OWNER_EPOCH,
      initialRoots: ['/'],
    },
  );
  authority.mkdirSync(`${ROOT}/src/nested`, { recursive: true });
  authority.writeFileSync(`${ROOT}/src/main.ts`, encoder.encode('old'));
  authority.writeFileSync(`${ROOT}/src/nested/child.ts`, encoder.encode('child'));
  authority.mkdirSync(OUTSIDE, { recursive: true });
  authority.writeFileSync(`${OUTSIDE}/secret.ts`, encoder.encode('outside'));

  const packageState = createOwnerPackageState({
    initial: packageConfig,
    vfs: memory.vfs,
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://example.test/registry',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const emitted: OwnerProjectVfsFrame[] = [];
  const vfs = createWorkbenchProjectVfs({
    projectRoot: ROOT,
    authority,
    appliedMutations,
    packageMutations: packageState.mutations,
    durability: 'ephemeral',
    emit: (frame) => {
      emitted.push(frame);
      onEmit(frame);
    },
    recordMutation,
    fatal,
  });
  return {
    authority,
    emitted,
    vfs,
    failNextReaddir: (error: Error) => rawFs.failNextReaddir(error),
  };
}

function writeRequest(
  operationId: string,
  path: string,
  expectedVersion: string | null,
): HostCommitRequest {
  return {
    kind: 'write',
    operationId,
    path,
    data: encoder.encode('new'),
    expectedVersion,
  };
}

describe('Workbench project VFS owner adapter', () => {
  it('notifies one publication seam for host, guest/package, and owner-applied revisions', async () => {
    const h = harness();
    const revisions: number[] = [];
    const unsubscribe = h.vfs.subscribePublications((treeRevision) => {
      revisions.push(treeRevision);
    });
    const path = `${ROOT}/src/main.ts`;

    h.vfs.publishSnapshot();

    const hostVersion = h.authority.versionOf(path);
    if (hostVersion === null) throw new Error('test version missing');
    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-commit',
      request: writeRequest('publication-host', path, hostVersion),
    });

    await h.vfs.mutationGuard([{ kind: 'write', path }], () => {
      h.authority.writeFileSync(path, encoder.encode('guest-or-package'));
    });

    h.authority.writeFileSync(path, encoder.encode('owner-applied'));
    await h.vfs.publicationBarrier();

    expect(revisions).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
    expect(new Set(revisions).size).toBe(revisions.length);

    unsubscribe();
    h.authority.writeFileSync(path, encoder.encode('after-unsubscribe'));
    await h.vfs.publicationBarrier();
    expect(revisions).toHaveLength(3);
  });

  it('records file and guest mutations before their publication settles', async () => {
    const events: string[] = [];
    const recordMutation = vi.fn(async (kind: string, treeRevision: number) => {
      events.push(`dirty:${kind}:${String(treeRevision)}`);
    });
    const h = harness(undefined, (frame) => events.push(`emit:${frame.type}`), recordMutation);
    const path = `${ROOT}/src/main.ts`;
    const expectedVersion = h.authority.versionOf(path);
    if (expectedVersion === null) throw new Error('test version missing');
    h.vfs.publishSnapshot();
    events.splice(0);

    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-commit',
      request: writeRequest('dirty-file', path, expectedVersion),
    });
    const fileRevision = h.authority.treeRevision;
    expect(events).toEqual([
      `dirty:file:${String(fileRevision)}`,
      'emit:workbench:project-vfs-state',
      'emit:rifty:owner-vfs-commit-ack',
    ]);

    events.splice(0);
    await h.vfs.mutationGuard([{ kind: 'write', path }], () => {
      h.authority.writeFileSync(path, encoder.encode('guest'));
    });
    const guestRevision = h.authority.treeRevision;
    expect(events).toEqual([
      `dirty:guest:${String(guestRevision)}`,
      'emit:workbench:project-vfs-state',
    ]);
    expect(recordMutation).toHaveBeenCalledTimes(2);
  });

  it('publishes only the active source tree and serves each read from one atomic snapshot', () => {
    const h = harness();

    h.vfs.publishSnapshot();
    expect(h.emitted[0]).toMatchObject({
      type: 'workbench:project-vfs-snapshot',
      frame: {
        type: 'snapshot',
        root: ROOT,
        ownerEpoch: OWNER_EPOCH,
        entries: expect.arrayContaining([
          expect.objectContaining({ path: `${ROOT}/src`, kind: 'dir' }),
          expect.objectContaining({ path: `${ROOT}/src/main.ts`, kind: 'file' }),
        ]),
      },
    });
    expect(JSON.stringify(h.emitted[0])).not.toContain(OUTSIDE);

    const snapshot = vi.spyOn(h.authority, 'snapshot');
    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-file',
      requestId: 'read-file-1',
      path: `${ROOT}/src/main.ts`,
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-read-file-result',
      requestId: 'read-file-1',
      ok: true,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
      entry: {
        path: `${ROOT}/src/main.ts`,
        kind: 'file',
        size: 3,
        content: encoder.encode('old'),
        version: h.authority.versionOf(`${ROOT}/src/main.ts`),
      },
    });

    snapshot.mockClear();
    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-directory',
      requestId: 'read-dir-1',
      path: `${ROOT}/src`,
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-read-directory-result',
      requestId: 'read-dir-1',
      ok: true,
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
      entries: [
        {
          path: `${ROOT}/src/nested`,
          kind: 'dir',
          size: 0,
          version: h.authority.versionOf(`${ROOT}/src/nested`),
        },
        {
          path: `${ROOT}/src/main.ts`,
          kind: 'file',
          size: 3,
          version: h.authority.versionOf(`${ROOT}/src/main.ts`),
        },
      ],
    });
  });

  it('runs commit, snapshot, terminal retention, cleanup, and durability through existing authorities', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const expectedVersion = h.authority.versionOf(path);
    if (expectedVersion === null) throw new Error('test version missing');
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-commit',
      request: writeRequest('write-1', path, expectedVersion),
    });

    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    const terminal = h.emitted.find((frame) => frame.type === 'rifty:owner-vfs-commit-ack');
    if (terminal?.type !== 'rifty:owner-vfs-commit-ack') {
      throw new Error('commit terminal missing');
    }
    expect(h.emitted.map((frame) => frame.type)).toEqual([
      'workbench:project-vfs-snapshot',
      'workbench:project-vfs-state',
      'rifty:owner-vfs-commit-ack',
    ]);
    expect(h.emitted[1]).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: baselineRevision,
      mutations: [],
      frame: collectSnapshot(h.authority, ROOT),
    });
    expect(terminal).toMatchObject({
      operationId: 'write-1',
      ok: true,
      ack: {
        ownerEpoch: OWNER_EPOCH,
        versions: [{ path, version: h.authority.versionOf(path) }],
      },
    });
    expect(h.authority.retainedHostCommitTerminal('write-1')).toEqual(terminal);

    h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit-received', terminal });
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-released',
      terminal,
    });
    h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit-cleanup', terminal });
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-commit-cleaned',
      terminal,
    });
    expect(h.authority.retainedHostCommitTerminal('write-1')).toBeNull();

    const flush = vi.spyOn(h.authority, 'flush');
    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'durability-1',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'durability-1',
      ok: true,
      receipt: {
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
        durability: 'ephemeral',
      },
    });
  });

  it('ignores asset-only owner damage at the project durability barrier', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-asset';
    vi.spyOn(h.authority, 'flush').mockResolvedValue({
      failures: [{ path: assetPath, op: 'write', message: 'private asset quota detail' }],
      total: 1,
    });

    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'asset-only-durability',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
    });

    expect(h.emitted.at(-1)).toEqual({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'asset-only-durability',
      ok: true,
      receipt: {
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
        durability: 'ephemeral',
      },
    });
  });

  it('rejects mixed project damage without exposing sibling-ledger details', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-asset';
    vi.spyOn(h.authority, 'flush').mockResolvedValue({
      failures: [
        { path: assetPath, op: 'write', message: 'private asset quota detail' },
        { path: `${ROOT}/src/main.ts`, op: 'write', message: 'project quota detail' },
      ],
      total: 2,
    });

    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-durability',
      barrierId: 'mixed-durability',
      ownerEpoch: OWNER_EPOCH,
      treeRevision: h.authority.treeRevision,
    });

    const terminal = h.emitted.at(-1);
    expect(terminal).toMatchObject({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: 'mixed-durability',
      ok: false,
    });
    const serialized = JSON.stringify(terminal);
    expect(serialized).not.toContain(assetPath);
    expect(serialized).not.toContain('private asset quota detail');
    expect(serialized).not.toContain(ROOT);
    expect(serialized).not.toContain('2 unhealed');
  });

  // Fault class: torn-state. Once bytes apply, both snapshot construction and
  // state delivery failures must retain applied evidence and terminate the owner.
  it.each([
    {
      name: 'construction',
      inject(h: ReturnType<typeof harness>, failure: Error) {
        h.failNextReaddir(failure);
      },
    },
    {
      name: 'delivery',
      inject(h: ReturnType<typeof harness>, failure: Error) {
        vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
          if (frames.some((frame) => frame.type === 'workbench:project-vfs-snapshot')) {
            throw failure;
          }
          return Array.prototype.push.apply(h.emitted, frames);
        });
      },
    },
  ])(
    'fatally rejects owner lifetime when initial snapshot $name fails',
    async ({ inject, name }) => {
      const failure = new Error(`initial snapshot ${name} failed`);
      let rejectOwnerLifetime = (_error: Error): void => {};
      const ownerLifetime = new Promise<never>((_resolve, reject) => {
        rejectOwnerLifetime = reject;
      });
      void ownerLifetime.catch(() => {});
      const h = harness((error) => rejectOwnerLifetime(error));
      inject(h, failure);

      expect(() => h.vfs.publishSnapshot()).toThrow(failure);
      expect(h.emitted).toEqual([
        {
          type: 'workbench:project-vfs-fatal',
          error: { name: 'Error', message: failure.message },
        },
      ]);
      await expect(ownerLifetime).rejects.toBe(failure);
      expect(() => h.vfs.handleFrame({ type: 'workbench:project-vfs-snapshot-request' })).toThrow(
        ClosedHandleError,
      );
    },
  );

  it('preserves the initial snapshot failure when fatal-frame delivery also fails', async () => {
    const failure = new Error('initial snapshot delivery failed');
    const fatalDeliveryFailure = new Error('fatal frame delivery failed');
    const attempted: OwnerProjectVfsFrame['type'][] = [];
    let rejectOwnerLifetime = (_error: Error): void => {};
    const ownerLifetime = new Promise<never>((_resolve, reject) => {
      rejectOwnerLifetime = reject;
    });
    void ownerLifetime.catch(() => {});
    const h = harness((error) => rejectOwnerLifetime(error));
    vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
      for (const frame of frames) {
        attempted.push(frame.type);
        if (frame.type === 'workbench:project-vfs-snapshot') throw failure;
        if (frame.type === 'workbench:project-vfs-fatal') throw fatalDeliveryFailure;
      }
      return Array.prototype.push.apply(h.emitted, frames);
    });

    expect(() => h.vfs.publishSnapshot()).toThrow(failure);
    expect(attempted).toEqual(['workbench:project-vfs-snapshot', 'workbench:project-vfs-fatal']);
    await expect(ownerLifetime).rejects.toBe(failure);
    expect(() => h.vfs.handleFrame({ type: 'workbench:project-vfs-snapshot-request' })).toThrow(
      ClosedHandleError,
    );
  });

  it('preserves a semantic state failure when fatal-frame delivery also fails', async () => {
    const stateFailure = new Error('semantic state delivery failed');
    const fatalDeliveryFailure = new Error('semantic fatal delivery failed');
    const attempted: OwnerProjectVfsFrame['type'][] = [];
    const fatalFailures: Error[] = [];
    const h = harness((error) => fatalFailures.push(error));
    const path = `${ROOT}/src/main.ts`;
    h.vfs.publishSnapshot();
    vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
      for (const frame of frames) {
        attempted.push(frame.type);
        if (frame.type === 'workbench:project-vfs-state') throw stateFailure;
        if (frame.type === 'workbench:project-vfs-fatal') throw fatalDeliveryFailure;
      }
      return Array.prototype.push.apply(h.emitted, frames);
    });

    const operation = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path }], () => {
        h.authority.writeFileSync(path, encoder.encode('replacement'));
      }),
    );

    await expect(operation).rejects.toBe(stateFailure);
    expect(attempted).toEqual(['workbench:project-vfs-state', 'workbench:project-vfs-fatal']);
    expect(fatalFailures).toEqual([stateFailure]);
  });

  it('aggregates an admitted mutation failure with a concurrent pump failure on close', async () => {
    const stateFailure = new Error('background state delivery failed');
    const fatalFailures: Error[] = [];
    let closing: Promise<void> | null = null;
    const h = harness((error) => {
      fatalFailures.push(error);
      closing = h.vfs.close();
      void closing.catch(() => {});
    });
    h.vfs.publishSnapshot();
    vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
      if (frames.some((frame) => frame.type === 'workbench:project-vfs-state')) {
        throw stateFailure;
      }
      return Array.prototype.push.apply(h.emitted, frames);
    });

    let applied = false;
    const mutation = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path: 'relative' }], () => {
        applied = true;
      }),
    );
    h.authority.writeFileSync(`${ROOT}/src/background.ts`, encoder.encode('background'));

    await vi.waitFor(() => expect(closing).not.toBeNull());
    const admittedClose = closing;
    if (admittedClose === null) throw new Error('fatal close was not admitted');
    const [mutationResult, closeResult] = await Promise.allSettled([mutation, admittedClose]);
    expect(mutationResult.status).toBe('rejected');
    if (mutationResult.status !== 'rejected') throw new Error('mutation unexpectedly fulfilled');
    expect(closeResult.status).toBe('rejected');
    if (closeResult.status !== 'rejected') throw new Error('close unexpectedly fulfilled');
    expect(closeResult.reason).toBeInstanceOf(AggregateError);
    expect((closeResult.reason as AggregateError).errors).toEqual([
      mutationResult.reason,
      stateFailure,
    ]);
    expect(applied).toBe(false);
    expect(fatalFailures).toEqual([stateFailure]);
  });

  // Fault class: torn-state. A queued source must recheck owner lifetime at
  // the shared package-FIFO head, before transitions or bytes can apply.
  it('fences a queued semantic mutation after state delivery becomes fatal', async () => {
    const stateFailure = new Error('semantic state delivery failed');
    const fatalFailures: Error[] = [];
    const h = harness((error) => fatalFailures.push(error));
    const triggerPath = `${ROOT}/src/trigger.ts`;
    const queuedPath = `${ROOT}/src/queued.ts`;
    const entered = deferred<void>();
    const release = deferred<void>();
    h.vfs.publishSnapshot();
    vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
      if (frames.some((frame) => frame.type === 'workbench:project-vfs-state')) {
        throw stateFailure;
      }
      return Array.prototype.push.apply(h.emitted, frames);
    });

    const trigger = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path: triggerPath }], async () => {
        h.authority.writeFileSync(triggerPath, encoder.encode('trigger'));
        entered.resolve();
        await release.promise;
      }),
    );
    await entered.promise;
    const queued = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path: queuedPath }], () => {
        h.authority.writeFileSync(queuedPath, encoder.encode('queued'));
      }),
    );
    const results = Promise.allSettled([trigger, queued]);
    await settle();
    expect(await isPending(queued)).toBe(true);

    release.resolve();
    await expect(results).resolves.toEqual([
      { status: 'rejected', reason: stateFailure },
      { status: 'rejected', reason: stateFailure },
    ]);
    expect(h.authority.existsSync(queuedPath)).toBe(false);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-fatal',
      error: { name: 'Error', message: stateFailure.message },
    });
    expect(fatalFailures).toEqual([stateFailure]);
  });

  it('fences a queued host commit after state delivery becomes fatal', async () => {
    const stateFailure = new Error('host state delivery failed');
    const fatalFailures: Error[] = [];
    const h = harness((error) => fatalFailures.push(error));
    const triggerPath = `${ROOT}/src/trigger.ts`;
    const hostPath = `${ROOT}/src/main.ts`;
    const hostVersion = h.authority.versionOf(hostPath);
    if (hostVersion === null) throw new Error('test version missing');
    const entered = deferred<void>();
    const release = deferred<void>();
    h.vfs.publishSnapshot();
    vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
      if (frames.some((frame) => frame.type === 'workbench:project-vfs-state')) {
        throw stateFailure;
      }
      return Array.prototype.push.apply(h.emitted, frames);
    });

    const trigger = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path: triggerPath }], async () => {
        h.authority.writeFileSync(triggerPath, encoder.encode('trigger'));
        entered.resolve();
        await release.promise;
      }),
    );
    await entered.promise;
    const queued = Promise.resolve(
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('post-fatal-host-write', hostPath, hostVersion),
      }),
    );
    const results = Promise.allSettled([trigger, queued]);
    await settle();
    expect(await isPending(queued)).toBe(true);

    release.resolve();
    await expect(results).resolves.toEqual([
      { status: 'rejected', reason: stateFailure },
      { status: 'rejected', reason: stateFailure },
    ]);
    expect(h.authority.readFileBytesSync(hostPath)).toEqual(encoder.encode('old'));
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-fatal',
      error: { name: 'Error', message: stateFailure.message },
    });
    expect(fatalFailures).toEqual([stateFailure]);
  });

  it.each([
    {
      name: 'snapshot construction',
      inject(h: ReturnType<typeof harness>, failure: Error) {
        h.failNextReaddir(failure);
      },
    },
    {
      name: 'state delivery',
      inject(h: ReturnType<typeof harness>, failure: Error) {
        vi.spyOn(h.emitted, 'push').mockImplementation((...frames) => {
          if (frames.some((frame) => frame.type === 'workbench:project-vfs-state')) {
            throw failure;
          }
          return Array.prototype.push.apply(h.emitted, frames);
        });
      },
    },
  ])(
    'retains an applied NACK and fatally rejects owner lifetime after $name failure',
    async ({ inject, name }) => {
      const failure = new Error(`${name} failed`);
      let rejectOwnerLifetime = (_error: Error): void => {};
      const ownerLifetime = new Promise<never>((_resolve, reject) => {
        rejectOwnerLifetime = reject;
      });
      void ownerLifetime.catch(() => {});
      const h = harness((error) => rejectOwnerLifetime(error));
      const path = `${ROOT}/src/main.ts`;
      const expectedVersion = h.authority.versionOf(path);
      if (expectedVersion === null) throw new Error('test version missing');
      h.vfs.publishSnapshot();
      inject(h, failure);

      await expect(
        h.vfs.handleFrame({
          type: 'rifty:owner-vfs-commit',
          request: writeRequest(`failed-${name}`, path, expectedVersion),
        }),
      ).resolves.toBeUndefined();

      expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
      expect(h.emitted.map((frame) => frame.type)).toEqual([
        'workbench:project-vfs-snapshot',
        'rifty:owner-vfs-commit-ack',
        'workbench:project-vfs-fatal',
      ]);
      expect(h.emitted[1]).toMatchObject({
        type: 'rifty:owner-vfs-commit-ack',
        operationId: `failed-${name}`,
        ok: false,
        error: { kind: 'error', name: 'Error', message: failure.message },
        applied: {
          operationId: `failed-${name}`,
          ownerEpoch: OWNER_EPOCH,
          treeRevision: h.authority.treeRevision,
          versions: [{ path, version: h.authority.versionOf(path) }],
        },
      });
      expect(h.emitted[2]).toEqual({
        type: 'workbench:project-vfs-fatal',
        error: { name: 'Error', message: failure.message },
      });
      expect(h.authority.retainedHostCommitTerminal(`failed-${name}`)).toEqual(h.emitted[1]);
      await expect(ownerLifetime).rejects.toBe(failure);
      expect(() => h.vfs.handleFrame({ type: 'workbench:project-vfs-snapshot-request' })).toThrow(
        ClosedHandleError,
      );
    },
  );

  it('auto-publishes direct authority write, rename, and remove revisions through the journal', async () => {
    const h = harness();
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;
    const generated = `${ROOT}/src/generated.ts`;
    const moved = `${ROOT}/src/moved.ts`;

    h.authority.writeFileSync(generated, encoder.encode('generated'));
    const writeRevision = h.authority.treeRevision;
    await vi.waitFor(() => expect(h.emitted).toHaveLength(2));
    expect(h.emitted[1]).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: baselineRevision,
      mutations: [],
      frame: collectSnapshot(h.authority, ROOT),
    });

    h.authority.renameSync(generated, moved);
    const renameRevision = h.authority.treeRevision;
    await vi.waitFor(() => expect(h.emitted).toHaveLength(3));
    expect(h.emitted[2]).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: writeRevision,
      mutations: [
        {
          kind: 'rename',
          treeRevision: renameRevision,
          sourcePath: generated,
          targetPath: moved,
        },
      ],
      frame: collectSnapshot(h.authority, ROOT),
    });

    h.authority.rmSync(moved, { recursive: false });
    const removeRevision = h.authority.treeRevision;
    await vi.waitFor(() => expect(h.emitted).toHaveLength(4));
    expect(h.emitted[3]).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: renameRevision,
      mutations: [
        {
          kind: 'remove',
          treeRevision: removeRevision,
          path: moved,
          recursive: false,
        },
      ],
      frame: collectSnapshot(h.authority, ROOT),
    });
  });

  it('publishes the current revision at the barrier and emits nothing when already current', async () => {
    const h = harness();
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    await expect(h.vfs.publicationBarrier()).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(1);

    h.authority.writeFileSync(`${ROOT}/src/barrier.ts`, encoder.encode('barrier'));
    const targetRevision = h.authority.treeRevision;
    await expect(h.vfs.publicationBarrier()).resolves.toBeUndefined();
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);
    expect(h.emitted[1]).toMatchObject({ frame: { treeRevision: targetRevision } });

    await expect(h.vfs.publicationBarrier()).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(2);
  });

  it('publishes exact applied replacement evidence before its mutation guard settles', async () => {
    const h = harness();
    const source = `${ROOT}/src/main.ts`;
    const metadata = `${ROOT}/.git/index`;
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    await expect(
      h.vfs.mutationGuard(
        [
          { kind: 'replace', path: ROOT },
          { kind: 'write', path: `${ROOT}/.git` },
        ],
        () => {
          h.authority.mkdirSync(`${ROOT}/.git`, { recursive: true });
          h.authority.writeFileSync(metadata, encoder.encode('metadata'));
          h.authority.writeFileSync(source, encoder.encode('replaced'));
          return 'applied';
        },
      ),
    ).resolves.toBe('applied');

    const finalRevision = h.authority.treeRevision;
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [{ kind: 'reset', treeRevision: finalRevision, rootPath: source }],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);

    const emittedBeforeNoop = h.emitted.length;
    await expect(
      h.vfs.mutationGuard([{ kind: 'replace', path: source }], () => 'noop'),
    ).resolves.toBe('noop');
    expect(h.authority.treeRevision).toBe(finalRevision);
    expect(h.emitted).toHaveLength(emittedBeforeNoop);
  });

  it('publishes partial replacement evidence before the mutation guard rejects', async () => {
    const timeline: string[] = [];
    const h = harness(undefined, (frame) => {
      if (frame.type === 'workbench:project-vfs-state') timeline.push('state');
    });
    const path = `${ROOT}/src/partial.ts`;
    const failure = new Error('replacement failed after applying bytes');
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    const operation = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path }], () => {
        h.authority.writeFileSync(path, encoder.encode('partial'));
        throw failure;
      }),
    ).catch((error: unknown) => {
      timeline.push('rejection');
      throw error;
    });

    await expect(operation).rejects.toBe(failure);
    expect(timeline).toEqual(['state', 'rejection']);
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: baselineRevision,
      mutations: [
        {
          kind: 'reset',
          treeRevision: h.authority.treeRevision,
          rootPath: path,
        },
      ],
      frame: collectSnapshot(h.authority, ROOT),
    });
  });

  // Fault class: quota-perm-fail × recoverable owner transaction publication.
  it('suppresses a recovered transaction revision instead of publishing tentative Files state', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const failure = new Error('archive durability failed; private recovery retained');
    h.vfs.publishSnapshot();
    const baseline = h.emitted[0];

    await expect(
      h.vfs.recoverableMutation([{ kind: 'replace', path }], async () => {
        h.authority.writeFileSync(path, encoder.encode('tentative'));
        h.authority.writeFileSync(path, encoder.encode('old'));
        return { status: 'recoverable-failure', error: failure };
      }),
    ).rejects.toBe(failure);
    await settle();

    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('old'));
    expect(h.emitted).toEqual([baseline]);
  });

  // Fault class: hidden-ack. A pre-arm private write still advances the shared
  // owner revision and therefore needs an explicit empty project-state frame.
  it('publishes an empty Files revision when a private prepare fails before arming', async () => {
    const h = harness();
    const failure = new Error('archive stage persistence failed');
    let applied = false;
    h.vfs.publishSnapshot();
    const baseline = h.emitted[0];
    const baselineRevision = h.authority.treeRevision;

    await expect(
      h.vfs.recoverableProjectReplace(
        () => {
          h.authority.writeFileSync('/archive-stage', encoder.encode('private'));
          throw failure;
        },
        () => {
          applied = true;
          return { status: 'committed', value: undefined };
        },
      ),
    ).rejects.toBe(failure);
    await settle();

    expect(applied).toBe(false);
    expect(h.emitted).toEqual([
      baseline,
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);
  });

  // Fault class: torn-state. Once a recoverable replacement is armed and has
  // applied effects, startup recovery is the only authority allowed to continue.
  it('fatally fences the owner immediately after an armed recoverable project replacement fails', async () => {
    const failure = new Error('armed archive replacement failed');
    const fatalFailures: Error[] = [];
    const timeline: string[] = [];
    const h = harness(
      (error) => {
        fatalFailures.push(error);
        timeline.push('fatal-callback');
      },
      (frame) => {
        if (frame.type === 'workbench:project-vfs-fatal') timeline.push('fatal-frame');
      },
    );
    const path = `${ROOT}/src/main.ts`;
    let continued = false;
    h.vfs.publishSnapshot();
    const baseline = h.emitted[0];

    const replacement = h.vfs
      .recoverableProjectReplace(
        () => {
          h.authority.mkdirSync('/archive-transaction', { recursive: true });
          h.authority.writeFileSync('/archive-transaction/phase', encoder.encode('promoting\n'));
        },
        () => {
          h.authority.writeFileSync(path, encoder.encode('tentative'));
          return { status: 'recoverable-failure', error: failure };
        },
      )
      .catch((error: unknown) => {
        timeline.push('rejection');
        throw error;
      });

    await expect(replacement).rejects.toBe(failure);
    expect(timeline).toEqual(['fatal-frame', 'fatal-callback', 'rejection']);
    expect(h.emitted).toEqual([
      baseline,
      {
        type: 'workbench:project-vfs-fatal',
        error: { name: 'Error', message: failure.message },
      },
    ]);
    expect(fatalFailures).toEqual([failure]);

    await expect(
      h.vfs.mutationGuard([{ kind: 'write', path }], () => {
        continued = true;
        h.authority.writeFileSync(path, encoder.encode('silently continued'));
      }),
    ).rejects.toBe(failure);
    expect(continued).toBe(false);
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('tentative'));
  });

  // Fault class: torn-state × quota-perm-fail × observable-order. Arming
  // precedes the first possibly durable roll-forward marker effect.
  it('fatally fences when the project replacement point of no return fails durably', async () => {
    const failure = new Error('phase marker durability failed');
    const fatalFailures: Error[] = [];
    const timeline: string[] = [];
    const h = harness(
      (error) => {
        fatalFailures.push(error);
        timeline.push('fatal-callback');
      },
      (frame) => {
        if (frame.type === 'workbench:project-vfs-fatal') timeline.push('fatal-frame');
      },
    );
    const path = `${ROOT}/src/main.ts`;
    let continued = false;
    h.vfs.publishSnapshot();

    const replacement = h.vfs
      .recoverableProjectReplace(
        (armPointOfNoReturn) => {
          h.authority.mkdirSync('/archive-transaction', { recursive: true });
          armPointOfNoReturn();
          h.authority.writeFileSync('/archive-transaction/phase', encoder.encode('promoting\n'));
          throw failure;
        },
        () => ({ status: 'committed', value: undefined }),
      )
      .catch((error: unknown) => {
        timeline.push('rejection');
        throw error;
      });

    await expect(replacement).rejects.toBe(failure);
    expect(timeline).toEqual(['fatal-frame', 'fatal-callback', 'rejection']);
    expect(fatalFailures).toEqual([failure]);
    await expect(
      h.vfs.mutationGuard([{ kind: 'write', path }], () => {
        continued = true;
      }),
    ).rejects.toBe(failure);
    expect(continued).toBe(false);
  });

  // Fault class: torn-state × semantic scope/background publisher.
  it('does not publish a torn journal while a semantic replacement scope is active', async () => {
    const fatalFailures: Error[] = [];
    const h = harness((error) => fatalFailures.push(error));
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    const replaced = `${ROOT}/src/main.ts`;
    const releaseReplacement = deferred<void>();
    const replacementEntered = deferred<void>();
    const replacement = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path: replaced }], async () => {
        h.authority.writeFileSync(replaced, encoder.encode('replaced'));
        replacementEntered.resolve();
        await releaseReplacement.promise;
        return 'applied';
      }),
    );
    const prior = `${ROOT}/src/prior.ts`;
    h.authority.writeFileSync(prior, encoder.encode('prior'));
    await replacementEntered.promise;
    const replacementRevision = h.authority.treeRevision;

    await settle();
    expect(await isPending(replacement)).toBe(true);
    expect(fatalFailures).toEqual([]);
    expect(h.emitted).toHaveLength(1);

    releaseReplacement.resolve();
    await expect(replacement).resolves.toBe('applied');
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [{ kind: 'reset', treeRevision: replacementRevision, rootPath: replaced }],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);

    h.authority.writeFileSync(`${ROOT}/src/after.ts`, encoder.encode('after'));
    await vi.waitFor(() => expect(h.emitted).toHaveLength(3));
    expect(h.emitted.at(-1)).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: replacementRevision,
      mutations: [],
      frame: collectSnapshot(h.authority, ROOT),
    });
    expect(fatalFailures).toEqual([]);
  });

  // Fault class: torn-state × provenance-lie. A separately proven whole-tree
  // replacement is one reset, not its incidental delete/write sequence.
  it('publishes one root reset for an explicit whole-project replacement', async () => {
    const h = harness();
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    await h.vfs.recoverableProjectReplace(
      () => undefined,
      () => {
        h.authority.rmSync(`${ROOT}/src`, { recursive: true, force: true });
        h.authority.mkdirSync(`${ROOT}/src`, { recursive: true });
        h.authority.writeFileSync(`${ROOT}/src/main.ts`, encoder.encode('replacement'));
        return { status: 'committed', value: undefined };
      },
    );

    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [{ kind: 'reset', treeRevision: h.authority.treeRevision, rootPath: ROOT }],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);
  });

  // Fault class: torn-state × semantic scope/external publication barrier.
  it('holds an external publication barrier until semantic evidence is finalized', async () => {
    const fatalFailures: Error[] = [];
    const h = harness((error) => fatalFailures.push(error));
    const path = `${ROOT}/src/main.ts`;
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;
    const entered = deferred<void>();
    const release = deferred<void>();
    const mutation = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path }], async () => {
        h.authority.writeFileSync(path, encoder.encode('barrier replacement'));
        entered.resolve();
        await release.promise;
        return 'applied';
      }),
    );
    await entered.promise;
    const replacementRevision = h.authority.treeRevision;

    const barrier = h.vfs.publicationBarrier();
    await settle();
    const barrierWasPending = await isPending(barrier);
    release.resolve();
    const [mutationResult, barrierResult] = await Promise.allSettled([mutation, barrier]);

    expect(barrierWasPending).toBe(true);
    expect(mutationResult).toEqual({ status: 'fulfilled', value: 'applied' });
    expect(barrierResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [{ kind: 'reset', treeRevision: replacementRevision, rootPath: path }],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);
    expect(fatalFailures).toEqual([]);
  });

  // Fault class: concurrent-same-key × owner writer/SCM reader.
  it('gives a consistent read one FIFO slot between prior and later project mutations', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    h.vfs.publishSnapshot();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const first = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path }], async () => {
        h.authority.writeFileSync(path, encoder.encode('first'));
        firstEntered.resolve();
        await releaseFirst.promise;
      }),
    );
    await firstEntered.promise;

    const readEntered = deferred<void>();
    const releaseRead = deferred<void>();
    const read = h.vfs.readConsistent(async () => {
      readEntered.resolve();
      await releaseRead.promise;
      return new TextDecoder().decode(h.authority.readFileBytesSync(path));
    });
    await settle();
    expect(await isPending(read)).toBe(true);

    releaseFirst.resolve();
    await first;
    await readEntered.promise;
    const later = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path }], () => {
        h.authority.writeFileSync(path, encoder.encode('later'));
      }),
    );
    await settle();
    expect(await isPending(later)).toBe(true);

    releaseRead.resolve();
    await expect(read).resolves.toBe('first');
    await later;
    expect(new TextDecoder().decode(h.authority.readFileBytesSync(path))).toBe('later');
  });

  // Fault class: starvation/unbounded-read. A barrier closes the admission gate
  // synchronously, so later mutation traffic cannot extend its wait forever.
  it('admits a publication barrier before a later long-running mutation', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    h.vfs.publishSnapshot();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const first = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path }], async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
      }),
    );
    await firstEntered.promise;

    const readEntered = deferred<void>();
    const read = h.vfs.readConsistent(() => {
      readEntered.resolve();
      return 'consistent';
    });
    const laterEntered = deferred<void>();
    const releaseLater = deferred<void>();
    const later = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'write', path }], async () => {
        laterEntered.resolve();
        await releaseLater.promise;
      }),
    );

    releaseFirst.resolve();
    await first;
    await settle();
    expect(await isPending(readEntered.promise)).toBe(false);
    expect(await isPending(laterEntered.promise)).toBe(true);
    await expect(read).resolves.toBe('consistent');

    releaseLater.resolve();
    await later;
  });

  it('publishes a same-revision empty state before ACK for a host no-op', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const version = h.authority.versionOf(path);
    if (version === null) throw new Error('test version missing');
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;

    await h.vfs.handleFrame({
      type: 'rifty:owner-vfs-commit',
      request: {
        kind: 'rename',
        operationId: 'same-path-rename',
        sourcePath: path,
        targetPath: path,
        expectedSourceVersion: version,
        expectedTargetVersion: version,
      },
    });

    expect(h.authority.treeRevision).toBe(baselineRevision);
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [],
        frame: collectSnapshot(h.authority, ROOT),
      },
      {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: 'same-path-rename',
        ok: true,
        ack: {
          operationId: 'same-path-rename',
          ownerEpoch: OWNER_EPOCH,
          treeRevision: baselineRevision,
          versions: [{ path, version }],
        },
      },
    ]);
  });

  it('does not deadlock or skip a journal revision when a source barrier races a queued host commit', async () => {
    const h = harness();
    const hostPath = `${ROOT}/src/main.ts`;
    const hostVersion = h.authority.versionOf(hostPath);
    if (hostVersion === null) throw new Error('test version missing');
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;
    const hostCommit = Promise.resolve(
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('queued-host-write', hostPath, hostVersion),
      }),
    );
    const source = `${ROOT}/src/nested/child.ts`;
    const target = `${ROOT}/src/direct-child.ts`;
    h.authority.renameSync(source, target);
    const directRevision = h.authority.treeRevision;
    const barrier = h.vfs.publicationBarrier();

    await expect(Promise.all([barrier, hostCommit])).resolves.toEqual([undefined, undefined]);

    const finalRevision = h.authority.treeRevision;
    const states = h.emitted.filter((frame) => frame.type === 'workbench:project-vfs-state');
    expect(finalRevision).toBe(directRevision + 1);
    expect(states.length).toBeGreaterThanOrEqual(1);
    let expectedFrom = baselineRevision;
    for (const state of states) {
      expect(state.fromTreeRevision).toBe(expectedFrom);
      expectedFrom = state.frame.treeRevision;
    }
    expect(expectedFrom).toBe(finalRevision);
    expect(states.flatMap((state) => state.mutations)).toEqual([
      {
        kind: 'rename',
        treeRevision: directRevision,
        sourcePath: source,
        targetPath: target,
      },
    ]);
    expect(states.at(-1)?.frame).toEqual(collectSnapshot(h.authority, ROOT));
    expect(h.emitted.at(-1)).toMatchObject({
      type: 'rifty:owner-vfs-commit-ack',
      operationId: 'queued-host-write',
      ok: true,
      ack: { treeRevision: finalRevision },
    });
    expect(h.emitted.some((frame) => frame.type === 'workbench:project-vfs-fatal')).toBe(false);
  });

  it('returns an exact read failure without making a second authority observation', () => {
    const h = harness();
    const snapshot = vi.spyOn(h.authority, 'snapshot');

    h.vfs.handleFrame({
      type: 'workbench:project-vfs-read-file',
      requestId: 'missing-file',
      path: `${ROOT}/missing.ts`,
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-read-file-result',
        requestId: 'missing-file',
        ok: false,
        error: {
          name: 'Error',
          message: `No file exists at ${ROOT}/missing.ts`,
        },
      },
    ]);
  });

  it.each([
    writeRequest('outside-write', `${OUTSIDE}/new.ts`, null),
    {
      kind: 'mkdir',
      operationId: 'outside-mkdir',
      path: `${ROOT}/../escaped`,
      expectedVersion: null,
    },
    {
      kind: 'remove',
      operationId: 'outside-remove',
      path: `${ROOT}-sibling`,
      expectedVersion: 'forged-version',
    },
    {
      kind: 'rename',
      operationId: 'outside-rename-source',
      sourcePath: `${OUTSIDE}/secret.ts`,
      targetPath: `${ROOT}/src/moved.ts`,
      expectedSourceVersion: 'forged-version',
      expectedTargetVersion: null,
    },
    {
      kind: 'rename',
      operationId: 'outside-rename-target',
      sourcePath: `${ROOT}/src/main.ts`,
      targetPath: `${OUTSIDE}/moved.ts`,
      expectedSourceVersion: 'forged-version',
      expectedTargetVersion: null,
    },
  ] satisfies readonly HostCommitRequest[])(
    'rejects an out-of-project $kind before mutation',
    (request) => {
      const h = harness();
      const revision = h.authority.treeRevision;

      expect(() => h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit', request })).toThrow(
        TypeError,
      );
      expect(h.authority.treeRevision).toBe(revision);
      expect(h.authority.readFileBytesSync(`${OUTSIDE}/secret.ts`)).toEqual(
        encoder.encode('outside'),
      );
      expect(h.emitted).toEqual([]);
    },
  );

  it.each([
    {
      type: 'workbench:project-vfs-read-file',
      requestId: 'outside-file',
      path: `${OUTSIDE}/secret.ts`,
    },
    {
      type: 'workbench:project-vfs-read-directory',
      requestId: 'outside-dir',
      path: `${ROOT}/../escaped`,
    },
  ] satisfies readonly PageProjectVfsFrame[])(
    'rejects an out-of-project read before observing authority',
    (frame) => {
      const h = harness();
      const snapshot = vi.spyOn(h.authority, 'snapshot');

      expect(() => h.vfs.handleFrame(frame)).toThrow(TypeError);
      expect(snapshot).not.toHaveBeenCalled();
      expect(h.emitted).toEqual([]);
    },
  );

  // Fault class: torn-state × close during an admitted semantic mutation.
  it('joins an admitted semantic replacement through publication before close settles', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;
    const entered = deferred<void>();
    const release = deferred<void>();
    const mutation = Promise.resolve(
      h.vfs.mutationGuard([{ kind: 'replace', path }], async () => {
        h.authority.writeFileSync(path, encoder.encode('closing replacement'));
        entered.resolve();
        await release.promise;
        return 'applied';
      }),
    );
    await entered.promise;

    const closing = h.vfs.close();
    const closeWasPending = await isPending(closing);
    const revisionWhileClosing = h.authority.treeRevision;
    await expect(
      Promise.resolve().then(() =>
        h.vfs.mutationGuard([{ kind: 'replace', path }], () => {
          h.authority.writeFileSync(path, encoder.encode('late'));
        }),
      ),
    ).rejects.toBeInstanceOf(ClosedHandleError);
    expect(h.authority.treeRevision).toBe(revisionWhileClosing);

    release.resolve();
    const [mutationResult, closeResult] = await Promise.allSettled([mutation, closing]);
    expect(closeWasPending).toBe(true);
    expect(mutationResult).toEqual({ status: 'fulfilled', value: 'applied' });
    expect(closeResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(h.emitted).toEqual([
      {
        type: 'workbench:project-vfs-snapshot',
        frame: expect.objectContaining({ treeRevision: baselineRevision }),
      },
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: baselineRevision,
        mutations: [{ kind: 'reset', treeRevision: revisionWhileClosing, rootPath: path }],
        frame: collectSnapshot(h.authority, ROOT),
      },
    ]);
  });

  it('fences new frames synchronously and joins an admitted delayed commit through terminal delivery', async () => {
    const h = harness();
    const path = `${ROOT}/src/main.ts`;
    const expectedVersion = h.authority.versionOf(path);
    if (expectedVersion === null) throw new Error('test version missing');
    h.vfs.publishSnapshot();
    const baselineRevision = h.authority.treeRevision;
    const originalGuard = h.vfs;

    const applying = Promise.resolve(
      originalGuard.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('delayed-write', path, expectedVersion),
      }),
    );
    const closing = originalGuard.close();

    expect(await isPending(closing)).toBe(true);
    expect(() =>
      originalGuard.handleFrame({ type: 'workbench:project-vfs-snapshot-request' }),
    ).toThrow(ClosedHandleError);
    expect(h.emitted).toHaveLength(1);

    await expect(applying).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    expect(h.emitted.map((frame) => frame.type)).toEqual([
      'workbench:project-vfs-snapshot',
      'workbench:project-vfs-state',
      'rifty:owner-vfs-commit-ack',
    ]);
    expect(h.emitted[1]).toEqual({
      type: 'workbench:project-vfs-state',
      fromTreeRevision: baselineRevision,
      mutations: [],
      frame: collectSnapshot(h.authority, ROOT),
    });

    const outputCount = h.emitted.length;
    expect(() =>
      originalGuard.handleFrame({
        type: 'rifty:owner-vfs-commit',
        request: writeRequest('late-write', path, h.authority.versionOf(path)),
      }),
    ).toThrow(ClosedHandleError);
    await settle();
    expect(h.authority.readFileBytesSync(path)).toEqual(encoder.encode('new'));
    expect(h.emitted).toHaveLength(outputCount);
  });

  it('joins delayed durability ACK delivery before close resolves and rejects late barriers', async () => {
    const h = harness();
    const flushed = deferred<undefined>();
    vi.spyOn(h.authority, 'flush').mockImplementation(() => flushed.promise);

    const durability = Promise.resolve(
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-durability',
        barrierId: 'delayed-durability',
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
      }),
    );
    const closing = h.vfs.close();

    expect(await isPending(closing)).toBe(true);
    expect(h.emitted).toEqual([]);
    expect(() =>
      h.vfs.handleFrame({
        type: 'rifty:owner-vfs-durability',
        barrierId: 'late-durability',
        ownerEpoch: OWNER_EPOCH,
        treeRevision: h.authority.treeRevision,
      }),
    ).toThrow(ClosedHandleError);

    flushed.resolve(undefined);
    await expect(durability).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(h.emitted).toEqual([
      {
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: 'delayed-durability',
        ok: true,
        receipt: {
          ownerEpoch: OWNER_EPOCH,
          treeRevision: h.authority.treeRevision,
          durability: 'ephemeral',
        },
      },
    ]);
    await settle();
    expect(h.emitted).toHaveLength(1);
  });
});
