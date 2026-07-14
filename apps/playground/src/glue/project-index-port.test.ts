import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installStampPath } from './install-stamp.ts';
import type { PackageMutationExecutor } from './package-mutation-executor.ts';
import {
  deleteProjectTree,
  markScratchDirtyIndex,
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndex,
  saveProjectIndexPhases,
  serveProjectIndex as serveProjectIndexRaw,
  setActiveIndex,
  subscribeProjectIndex,
} from './project-index-port.ts';
import type { ProjectIndex } from './project-index.ts';
import { loadIndex, writeIndex } from './project-index.ts';
import { viteConfigSeedClaimPath } from './vite-config-seed.ts';

const directPackageMutations: Pick<PackageMutationExecutor, 'reset'> = {
  reset: async (_target, prepare) => {
    const plan = await prepare();
    if (plan.status === 'ready') await plan.mutate();
  },
};

const serveProjectIndex: typeof serveProjectIndexRaw = (
  key,
  fs,
  base,
  flush,
  refresh,
  initializeStarterGit,
  packageMutations = directPackageMutations,
) => serveProjectIndexRaw(key, fs, base, flush, refresh, initializeStarterGit, packageMutations);

// In-process BroadcastChannel fake (node env has none): a name-keyed bus.
class FakeChannel {
  static buses = new Map<string, Set<FakeChannel>>();
  static postsAfterClose = 0;
  static repeatedCloses = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  #listeners = new Set<(ev: { data: unknown }) => void>();
  #closed = false;
  constructor(public name: string) {
    const peers = FakeChannel.buses.get(name) ?? new Set<FakeChannel>();
    peers.add(this);
    FakeChannel.buses.set(name, peers);
  }
  postMessage(data: unknown): void {
    if (this.#closed) {
      FakeChannel.postsAfterClose += 1;
      throw new Error('InvalidStateError: BroadcastChannel is closed');
    }
    for (const peer of FakeChannel.buses.get(this.name) ?? []) {
      if (peer === this) continue;
      peer.onmessage?.({ data });
      for (const l of peer.#listeners) l({ data });
    }
  }
  addEventListener(_t: string, cb: (ev: { data: unknown }) => void): void {
    this.#listeners.add(cb);
  }
  removeEventListener(_t: string, cb: (ev: { data: unknown }) => void): void {
    this.#listeners.delete(cb);
  }
  close(): void {
    if (this.#closed) {
      FakeChannel.repeatedCloses += 1;
      return;
    }
    this.#closed = true;
    FakeChannel.buses.get(this.name)?.delete(this);
  }
}

// Browser BroadcastChannel delivery is async; closing the sender before the
// queued delivery runs drops the frame in this fake, matching the PR-red race.
class AsyncDropOnCloseChannel {
  static buses = new Map<string, Set<AsyncDropOnCloseChannel>>();
  static postsAfterClose = 0;
  static repeatedCloses = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  #listeners = new Set<(ev: { data: unknown }) => void>();
  #closed = false;
  constructor(public name: string) {
    const peers = AsyncDropOnCloseChannel.buses.get(name) ?? new Set<AsyncDropOnCloseChannel>();
    peers.add(this);
    AsyncDropOnCloseChannel.buses.set(name, peers);
  }
  postMessage(data: unknown): void {
    if (this.#closed) {
      AsyncDropOnCloseChannel.postsAfterClose += 1;
      throw new Error('InvalidStateError: BroadcastChannel is closed');
    }
    queueMicrotask(() => {
      const peers = AsyncDropOnCloseChannel.buses.get(this.name);
      if (!peers?.has(this)) return;
      for (const peer of peers) {
        if (peer === this) continue;
        peer.onmessage?.({ data });
        for (const l of peer.#listeners) l({ data });
      }
    });
  }
  addEventListener(_t: string, cb: (ev: { data: unknown }) => void): void {
    this.#listeners.add(cb);
  }
  removeEventListener(_t: string, cb: (ev: { data: unknown }) => void): void {
    this.#listeners.delete(cb);
  }
  close(): void {
    if (this.#closed) {
      AsyncDropOnCloseChannel.repeatedCloses += 1;
      return;
    }
    this.#closed = true;
    AsyncDropOnCloseChannel.buses.get(this.name)?.delete(this);
  }
}

beforeEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
    FakeChannel as unknown as typeof BroadcastChannel;
  FakeChannel.buses.clear();
  FakeChannel.postsAfterClose = 0;
  FakeChannel.repeatedCloses = 0;
  AsyncDropOnCloseChannel.buses.clear();
  AsyncDropOnCloseChannel.postsAfterClose = 0;
  AsyncDropOnCloseChannel.repeatedCloses = 0;
});
afterEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});

const PORT = 59124;
function ownerFs(): MemoryFsSync {
  const fs = new MemoryFsSync();
  writeIndex(fs, '/', {
    activeId: 'p-1',
    scratch: null,
    projects: [
      { id: 'p-1', name: 'A', starter: 'project-files', editedAt: '2026-06-21T00:00:00.000Z' },
    ],
  });
  return fs;
}

describe('project-index bridge (ADR-0165 realm split)', () => {
  it('a page subscriber pulls the owner index (pull, not spray)', async () => {
    const fs = ownerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: unknown[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve(); // flush the request/reply microtask
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ activeId: 'p-1', projects: [{ id: 'p-1', name: 'A' }] });
    dispose();
    tearOwner();
  });

  it('the page receives a DISTINCT object (no shared mutable ref across realms)', async () => {
    const fs = ownerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    let got: ProjectIndex | null = null;
    const { dispose } = subscribeProjectIndex(PORT, (idx) => {
      got = idx;
    });
    await Promise.resolve();
    const ownerIndex = JSON.parse(
      new TextDecoder().decode(fs.readFileBytesSync('/.rifty-project-index.json')),
    );
    expect(got).not.toBe(ownerIndex); // structurally equal, identity distinct
    expect(got).toMatchObject({ activeId: 'p-1' });
    dispose();
    tearOwner();
  });

  it('string owner bridge keys isolate parallel same-origin owners', async () => {
    const fsA = ownerFs();
    const fsB = new MemoryFsSync();
    writeIndex(fsB, '/', {
      activeId: 'p-2',
      scratch: null,
      projects: [
        { id: 'p-2', name: 'B', starter: 'project-files', editedAt: '2026-06-21T00:00:00.000Z' },
      ],
    });
    const tearA = serveProjectIndex('owner:a', fsA, '/');
    const tearB = serveProjectIndex('owner:b', fsB, '/');
    const receivedA: ProjectIndex[] = [];
    const receivedB: ProjectIndex[] = [];
    const subA = subscribeProjectIndex('owner:a', (idx) => receivedA.push(idx));
    const subB = subscribeProjectIndex('owner:b', (idx) => receivedB.push(idx));
    await Promise.resolve();

    expect(receivedA).toHaveLength(1);
    expect(receivedA.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'A' }]);
    expect(receivedB).toHaveLength(1);
    expect(receivedB.at(-1)?.projects).toMatchObject([{ id: 'p-2', name: 'B' }]);

    await renameProjectIndex('owner:b', 'p-2', 'B2');
    await Promise.resolve();

    expect(receivedA).toHaveLength(1);
    expect(receivedB.at(-1)?.projects).toMatchObject([{ id: 'p-2', name: 'B2' }]);

    subA.dispose();
    subB.dispose();
    tearA();
    tearB();
  });

  it('teardown closes the owner channel (idempotent)', () => {
    const fs = ownerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    expect(() => {
      tearOwner();
      tearOwner();
    }).not.toThrow();
  });
});

// A scratch-active owner store: an on-disk /scratch tree + a scratch-active index
// with a real-starter scratch entry (so saveScratchAsProject's `!index.scratch`
// precondition holds and resetScratchToStarter can re-derive the bundle).
const enc = new TextEncoder();
const dec = new TextDecoder();
function scratchOwnerFs(marker = 'scratch-marker'): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/scratch', { recursive: true });
  fs.writeFileSync('/scratch/marker.txt', enc.encode(marker));
  writeIndex(fs, '/', {
    activeId: 'scratch',
    scratch: { starter: 'project-files', dirty: true, editedAt: 'edited just now' },
    projects: [],
  });
  return fs;
}
function readUtf8(fs: MemoryFsSync, path: string): string {
  return dec.decode(fs.readFileBytesSync(path));
}
async function settlePromptly<T>(
  promise: Promise<T>,
): Promise<
  | { readonly status: 'resolved'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }
  | { readonly status: 'timed-out' }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    ),
    new Promise<{ readonly status: 'timed-out' }>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'timed-out' }), 100);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return outcome;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('project-index durable save/rename/reset (ADR-0165 §7)', () => {
  const durabilityPublicationScenarios: readonly {
    readonly name: string;
    readonly createFs: () => MemoryFsSync;
    readonly mutate: () => Promise<ProjectIndex>;
    readonly before: Readonly<Record<string, unknown>>;
    readonly after: Readonly<Record<string, unknown>>;
  }[] = [
    {
      name: 'rename',
      createFs: ownerFs,
      mutate: () => renameProjectIndex(PORT, 'p-1', 'Renamed'),
      before: {
        projects: [
          { id: 'p-1', name: 'A', starter: 'project-files', editedAt: '2026-06-21T00:00:00.000Z' },
        ],
      },
      after: {
        projects: [
          {
            id: 'p-1',
            name: 'Renamed',
            starter: 'project-files',
            editedAt: '2026-06-21T00:00:00.000Z',
          },
        ],
      },
    },
    {
      name: 'set-active',
      createFs: () => {
        const fs = ownerFs();
        fs.mkdirSync('/projects/p-2', { recursive: true });
        writeIndex(fs, '/', {
          ...loadIndex(fs, '/'),
          projects: [
            ...loadIndex(fs, '/').projects,
            { id: 'p-2', name: 'B', starter: 'project-files', editedAt: 'b' },
          ],
        });
        return fs;
      },
      mutate: () => setActiveIndex(PORT, 'p-2'),
      before: { activeId: 'p-1' },
      after: { activeId: 'p-2' },
    },
    {
      name: 'mark-scratch-dirty',
      createFs: () => {
        const fs = scratchOwnerFs();
        writeIndex(fs, '/', {
          ...loadIndex(fs, '/'),
          scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
        });
        return fs;
      },
      mutate: () => markScratchDirtyIndex(PORT, 'project-files'),
      before: { scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' } },
      after: { scratch: { starter: 'project-files', dirty: true } },
    },
    {
      name: 'reset-scratch',
      createFs: scratchOwnerFs,
      mutate: () => resetScratchIndex(PORT, 'node-worker'),
      before: { scratch: { starter: 'project-files', dirty: true, editedAt: 'edited just now' } },
      after: { scratch: { starter: 'node-worker', dirty: false } },
    },
    {
      name: 'new-scratch',
      createFs: ownerFs,
      mutate: () => newScratchIndex(PORT, 'node-worker'),
      before: { activeId: 'p-1', scratch: null },
      after: { activeId: 'scratch', scratch: { starter: 'node-worker', dirty: false } },
    },
    {
      name: 'delete',
      createFs: () => {
        const fs = ownerFs();
        fs.mkdirSync('/projects/p-1', { recursive: true });
        return fs;
      },
      mutate: () => deleteProjectTree(PORT, 'p-1'),
      before: { activeId: 'p-1', projects: [{ id: 'p-1' }] },
      after: { activeId: 'scratch', projects: [] },
    },
  ];

  it.each(durabilityPublicationScenarios)(
    'serves the last durable index while $name is parked before flush',
    async ({ createFs, mutate, before, after }) => {
      const fs = createFs();
      const flushGate = deferred();
      const flushStarted = deferred();
      const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
        flushStarted.resolve();
        await flushGate.promise;
        return undefined;
      });
      const broadcasts: ProjectIndex[] = [];
      const observer = subscribeProjectIndex(PORT, (index) => broadcasts.push(index));
      await Promise.resolve();

      const mutation = mutate();
      await flushStarted.promise;
      const passiveReplies: ProjectIndex[] = [];
      const passive = subscribeProjectIndex(PORT, (index) => passiveReplies.push(index));
      await Promise.resolve();

      expect(broadcasts).toHaveLength(2);
      for (const index of broadcasts) expect(index).toMatchObject(before);
      expect(passiveReplies).toHaveLength(1);
      expect(passiveReplies[0]).toMatchObject(before);

      flushGate.resolve();
      await mutation;
      expect(broadcasts.at(-1)).toMatchObject(after);

      passive.dispose();
      observer.dispose();
      tearOwner();
    },
  );

  it('save emits only its correlated applied frame until both durability proofs finish', async () => {
    const fs = scratchOwnerFs('save-durability-publication');
    const commitFlush = deferred();
    const cleanupFlush = deferred();
    const commitFlushStarted = deferred();
    const cleanupFlushStarted = deferred();
    let flushes = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushes++;
      if (flushes === 1) {
        commitFlushStarted.resolve();
        await commitFlush.promise;
      } else {
        cleanupFlushStarted.resolve();
        await cleanupFlush.promise;
      }
      return undefined;
    });
    const broadcasts: ProjectIndex[] = [];
    const observer = subscribeProjectIndex(PORT, (index) => broadcasts.push(index));
    await Promise.resolve();

    const phases = saveProjectIndexPhases(PORT, 'p-save-proof', 'Save Proof', 'project-files');
    const applied = await phases.applied;
    await commitFlushStarted.promise;
    expect(applied).toMatchObject({ activeId: 'p-save-proof', projects: [{ id: 'p-save-proof' }] });
    expect(broadcasts).toHaveLength(1);

    const beforeCommitProof: ProjectIndex[] = [];
    const passive = subscribeProjectIndex(PORT, (index) => beforeCommitProof.push(index));
    await Promise.resolve();
    expect(beforeCommitProof).toHaveLength(1);
    expect(beforeCommitProof[0]).toMatchObject({ activeId: 'scratch', projects: [] });
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.at(-1)).toMatchObject({ activeId: 'scratch', projects: [] });

    commitFlush.resolve();
    await cleanupFlushStarted.promise;
    expect(broadcasts).toHaveLength(2);
    cleanupFlush.resolve();
    await phases.durable;
    expect(broadcasts.at(-1)).toMatchObject({
      activeId: 'p-save-proof',
      projects: [{ id: 'p-save-proof' }],
    });

    passive.dispose();
    observer.dispose();
    tearOwner();
  });

  it('keeps serving the prior durable index after a deferred flush rejects', async () => {
    const fs = ownerFs();
    const flushGate = deferred();
    const flushStarted = deferred();
    const failure = new Error('deferred index flush failed');
    failure.name = 'IndexFlushError';
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushStarted.resolve();
      await flushGate.promise;
      throw failure;
    });
    const broadcasts: ProjectIndex[] = [];
    const observer = subscribeProjectIndex(PORT, (index) => broadcasts.push(index));
    await Promise.resolve();

    const mutation = renameProjectIndex(PORT, 'p-1', 'Unproven');
    await flushStarted.promise;
    flushGate.resolve();
    await expect(mutation).rejects.toThrow('deferred index flush failed');

    const passiveReplies: ProjectIndex[] = [];
    const passive = subscribeProjectIndex(PORT, (index) => passiveReplies.push(index));
    await Promise.resolve();
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.at(-1)).toMatchObject({ projects: [{ id: 'p-1', name: 'A' }] });
    expect(passiveReplies).toHaveLength(1);
    expect(passiveReplies[0]).toMatchObject({ projects: [{ id: 'p-1', name: 'A' }] });

    passive.dispose();
    observer.dispose();
    tearOwner();
  });

  it('index-save commits /scratch → /projects/<id>, flips the index, then cleans stale source', async () => {
    const fs = scratchOwnerFs('alpha-bytes');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve(); // initial reply

    await saveProjectIndex(PORT, 'p-alpha', 'Alpha', 'project-files');

    // Disk: project + index are durable at ack; source cleanup ran in the same
    // package FIFO mutation, after the crash-safe commit point.
    expect(fs.existsSync('/projects/p-alpha/marker.txt')).toBe(true);
    expect(readUtf8(fs, '/projects/p-alpha/marker.txt')).toBe('alpha-bytes');
    expect(fs.existsSync('/scratch')).toBe(false);

    // Index: activeId = the new id, scratch cleared, project listed.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('p-alpha');
    expect(reply?.scratch).toBeNull();
    expect(reply?.projects).toMatchObject([
      { id: 'p-alpha', name: 'Alpha', starter: 'project-files' },
    ]);

    dispose();
    tearOwner();
  });

  it('index-save never exports a partial unstamped node_modules tree', async () => {
    const fs = scratchOwnerFs('source');
    fs.mkdirSync('/scratch/node_modules/partial', { recursive: true });
    fs.writeFileSync('/scratch/node_modules/partial/index.js', enc.encode('torn-install'));
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    await saveProjectIndex(PORT, 'p-partial', 'Partial', 'project-files');

    expect(fs.existsSync('/projects/p-partial/marker.txt')).toBe(true);
    expect(fs.existsSync('/projects/p-partial/node_modules')).toBe(false);
    tearOwner();
  });

  it('waits behind a parked package mutation and cleans Save before a following new scratch', async () => {
    const fs = scratchOwnerFs('saved-source');
    let releaseHead!: () => void;
    let markHeadEntered!: () => void;
    const headEntered = new Promise<void>((resolve) => {
      markHeadEntered = resolve;
    });
    const headGate = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    let fifo = Promise.resolve();
    let sequence = 0;
    const exits: Array<{ readonly sequence: number; readonly scratchExists: boolean }> = [];
    const packageMutations: Pick<PackageMutationExecutor, 'reset'> = {
      reset: (_target, prepare) => {
        const current = ++sequence;
        const operation = fifo.then(async () => {
          const plan = await prepare();
          if (plan.status === 'ready') await plan.mutate();
          exits.push({ sequence: current, scratchExists: fs.existsSync('/scratch') });
        });
        fifo = operation.catch(() => undefined);
        return operation;
      },
    };
    const blocker = packageMutations.reset({ root: '/scratch' }, async () => ({
      status: 'ready',
      mutate: async () => {
        markHeadEntered();
        await headGate;
      },
    }));
    await headEntered;
    const tearOwner = serveProjectIndex(
      PORT,
      fs,
      '/',
      undefined,
      undefined,
      undefined,
      packageMutations,
    );

    const save = saveProjectIndex(PORT, 'p-fifo', 'FIFO', 'project-files');
    await Promise.resolve();
    expect(fs.existsSync('/projects/p-fifo')).toBe(false);

    releaseHead();
    await blocker;
    await save;
    await newScratchIndex(PORT, 'node-worker');
    await fifo;

    expect(exits).toEqual([
      { sequence: 1, scratchExists: true },
      { sequence: 2, scratchExists: false },
      { sequence: 3, scratchExists: true },
    ]);
    expect(readUtf8(fs, '/projects/p-fifo/marker.txt')).toBe('saved-source');
    expect(fs.existsSync('/scratch/marker.txt')).toBe(false);
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);
    tearOwner();
  });

  it('excludes node_modules after package revocation removes its root marker', async () => {
    const fs = scratchOwnerFs('saved-source');
    fs.mkdirSync('/scratch/node_modules/vite', { recursive: true });
    fs.writeFileSync('/scratch/node_modules/vite/package.json', enc.encode('{}\n'));
    fs.writeFileSync(installStampPath('/scratch'), enc.encode('{}\n'));
    let resetCalls = 0;
    const packageMutations: Pick<PackageMutationExecutor, 'reset'> = {
      reset: async (_target, prepare) => {
        resetCalls++;
        const plan = await prepare();
        if (plan.status === 'noop') return;
        fs.rmSync(installStampPath('/scratch'), { force: true });
        await plan.mutate();
      },
    };
    const tearOwner = serveProjectIndex(
      PORT,
      fs,
      '/',
      undefined,
      undefined,
      undefined,
      packageMutations,
    );

    await saveProjectIndex(PORT, 'p-stamped', 'Stamped', 'project-files');

    expect(resetCalls).toBe(1);
    expect(fs.existsSync('/projects/p-stamped/node_modules')).toBe(false);
    tearOwner();
  });

  it('index-save keeps the sender channel alive until async browser delivery reaches the owner', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      AsyncDropOnCloseChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('alpha-async-bytes');
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    await saveProjectIndex(PORT, 'p-alpha-async', 'Alpha Async', 'project-files');

    expect(loadIndex(fs, '/')).toMatchObject({
      activeId: 'p-alpha-async',
      scratch: null,
      projects: [{ id: 'p-alpha-async', name: 'Alpha Async', starter: 'project-files' }],
    });
    expect(readUtf8(fs, '/projects/p-alpha-async/marker.txt')).toBe('alpha-async-bytes');

    tearOwner();
  });

  it('index-save retries until a late owner bridge is listening', async () => {
    const fs = scratchOwnerFs('late-owner-bytes');
    const phases = saveProjectIndexPhases(PORT, 'p-late-owner', 'Late Owner', 'project-files');

    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const applied = await phases.applied;

    expect(applied).toMatchObject({
      activeId: 'p-late-owner',
      projects: [{ id: 'p-late-owner', name: 'Late Owner', starter: 'project-files' }],
    });
    expect(readUtf8(fs, '/projects/p-late-owner/marker.txt')).toBe('late-owner-bytes');
    await phases.durable;

    tearOwner();
  });

  it('index-save applied ack resolves before a slow durable flush', async () => {
    const fs = scratchOwnerFs('alpha-slow-flush');
    let releaseCommitFlush!: () => void;
    let releaseCleanupFlush!: () => void;
    const commitFlushGate = new Promise<void>((resolve) => {
      releaseCommitFlush = resolve;
    });
    const cleanupFlushGate = new Promise<void>((resolve) => {
      releaseCleanupFlush = resolve;
    });
    let flushStarted = 0;
    const flush = async (): Promise<undefined> => {
      flushStarted++;
      await (flushStarted === 1 ? commitFlushGate : cleanupFlushGate);
      return undefined;
    };
    const tearOwner = serveProjectIndex(PORT, fs, '/', flush);

    const phases = saveProjectIndexPhases(PORT, 'p-alpha-slow', 'Alpha Slow', 'project-files');
    const applied = await phases.applied;
    let durableSettled = false;
    void phases.durable.then(() => {
      durableSettled = true;
    });

    expect(applied).toMatchObject({
      activeId: 'p-alpha-slow',
      projects: [{ id: 'p-alpha-slow', name: 'Alpha Slow', starter: 'project-files' }],
    });
    expect(flushStarted).toBe(1);
    expect(durableSettled).toBe(false);

    releaseCommitFlush();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(flushStarted).toBe(2);
    expect(durableSettled).toBe(false);
    expect(fs.existsSync('/scratch')).toBe(false);

    releaseCleanupFlush();
    await phases.durable;
    expect(durableSettled).toBe(true);

    tearOwner();
  });

  it('index-save keeps applied but rejects durable exactly when committed-source cleanup fails', async () => {
    const fs = scratchOwnerFs('cleanup-failure-source');
    const realRm = fs.rmSync.bind(fs);
    const failure = new Error('scratch cleanup rm failed');
    failure.name = 'ScratchCleanupError';
    fs.rmSync = ((path, options) => {
      if (path === '/scratch') throw failure;
      realRm(path, options);
    }) as typeof fs.rmSync;
    let flushCalls = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushCalls++;
      return undefined;
    });

    const phases = saveProjectIndexPhases(PORT, 'p-cleanup-fail', 'Cleanup Fail', 'project-files');

    await expect(phases.applied).resolves.toMatchObject({
      activeId: 'p-cleanup-fail',
      projects: [{ id: 'p-cleanup-fail' }],
    });
    const outcome = await settlePromptly(phases.durable);
    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ScratchCleanupError', message: 'scratch cleanup rm failed' },
    });
    expect(flushCalls).toBe(1);
    expect(loadIndex(fs, '/').activeId).toBe('p-cleanup-fail');
    expect(fs.existsSync('/projects/p-cleanup-fail/marker.txt')).toBe(true);
    expect(fs.existsSync('/scratch')).toBe(true);
    tearOwner();
  });

  it('index-save RECONCILES the saved starter to the frame (owner scratch.starter may be stale)', async () => {
    // The owner's synthesized scratch records the BOOT starter; a mid-session
    // starter pick (no owner respawn) makes the page the authority. The save frame
    // carries `node-worker`; the saved project must record THAT, not the stale one.
    const fs = scratchOwnerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await saveProjectIndex(PORT, 'p-nw', 'NW', 'node-worker');
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-nw', starter: 'node-worker' }]);

    dispose();
    tearOwner();
  });

  it('a save with NO scratch is a LOUD correlated rejection, never a silent swallow', async () => {
    const fs = new MemoryFsSync();
    writeIndex(fs, '/', { activeId: 'scratch', scratch: null, projects: [] });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    await expect(saveProjectIndex(PORT, 'p-x', 'X', 'project-files')).rejects.toThrow(
      /no scratch to save/,
    );
    tearOwner();
  });

  it('index-rename renames a project in the index + re-publishes (idempotent on unknown id)', async () => {
    const fs = scratchOwnerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();
    await saveProjectIndex(PORT, 'p-1', 'First', 'project-files');

    await renameProjectIndex(PORT, 'p-1', 'Renamed');
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'Renamed' }]);

    // Unknown id → idempotent no-op publish (no throw, state re-asserted).
    await expect(renameProjectIndex(PORT, 'nope', 'Z')).resolves.toBeDefined();
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'Renamed' }]);

    dispose();
    tearOwner();
  });

  it('index-rename returns an exact correlated NACK when its index write fails', async () => {
    const fs = ownerFs();
    const failure = new Error('rename index write failed');
    failure.name = 'IndexWriteError';
    fs.writeFileSync = (() => {
      throw failure;
    }) as typeof fs.writeFileSync;
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    let mutation: Promise<ProjectIndex> | undefined;

    expect(() => {
      mutation = renameProjectIndex(PORT, 'p-1', 'Renamed');
    }).not.toThrow();
    const outcome = await settlePromptly(mutation as Promise<ProjectIndex>);

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'IndexWriteError', message: 'rename index write failed' },
    });
    tearOwner();
  });

  it('index-set-active PERSISTS the active root (ADR-0165 §3 — a switch must survive the owner respawn)', async () => {
    // Two saved projects, p-1 active; the on-disk index would otherwise never
    // record a switch, so the respawned owner re-publishes the stale activeId.
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    fs.mkdirSync('/projects/p-2', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [
        { id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'a' },
        { id: 'p-2', name: 'B', starter: 'project-files', editedAt: 'b' },
      ],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await setActiveIndex(PORT, 'p-2');

    // Durable on disk + re-published, so a respawned owner reads p-2 (no revert).
    expect(received.at(-1)?.activeId).toBe('p-2');
    expect(loadIndex(fs, '/').activeId).toBe('p-2');

    dispose();
    tearOwner();
  });

  it('index-set-active rejects an unknown project id without corrupting the index', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'a' }],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    await expect(setActiveIndex(PORT, 'p-missing')).rejects.toThrow(/unknown active project/i);
    expect(loadIndex(fs, '/').activeId).toBe('p-1');

    tearOwner();
  });

  it('index-set-active returns an exact correlated NACK when publish fails', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    fs.mkdirSync('/projects/p-2', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [
        { id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'a' },
        { id: 'p-2', name: 'B', starter: 'project-files', editedAt: 'b' },
      ],
    });
    const failure = new Error('active index publish failed');
    failure.name = 'IndexPublishError';
    class PublishFailChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if ((data as { readonly type?: string }).type === 'index-reply') throw failure;
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      PublishFailChannel as unknown as typeof BroadcastChannel;
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    const outcome = await settlePromptly(setActiveIndex(PORT, 'p-2'));

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'IndexPublishError', message: 'active index publish failed' },
    });
    tearOwner();
  });

  it('index-new-scratch (re)creates the scratch entry AFTER a Save (index scratch:null) so the next Save works', async () => {
    // Post-Save shape: a project listed, scratch:null, activeId=the project.
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'x' }],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await newScratchIndex(PORT, 'node-worker');

    // A fresh scratch entry + activeId re-pointed to scratch; the prior project stays.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('scratch');
    expect(reply?.scratch).toMatchObject({ starter: 'node-worker', dirty: false });
    expect(reply?.projects).toMatchObject([{ id: 'p-1' }]);
    // /scratch re-seeded from the starter bundle.
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);
    expect(fs.existsSync('/scratch/vite.config.js')).toBe(true);
    expect(JSON.parse(readUtf8(fs, viteConfigSeedClaimPath('/scratch')))).toMatchObject({
      schema: 1,
      starter: 'node-worker',
      file: 'vite.config.js',
    });
    // The Save precondition now holds (no throw).
    await expect(saveProjectIndex(PORT, 'p-2', 'B', 'node-worker')).resolves.toMatchObject({
      activeId: 'p-2',
    });

    dispose();
    tearOwner();
  });

  it('index-new-scratch can preserve a dirty same-starter draft from a fast edit race', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/scratch/src', { recursive: true });
    fs.writeFileSync('/scratch/src/main.js', enc.encode('user edit'));
    writeIndex(fs, '/', {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: 'edited just now' },
      projects: [],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    await newScratchIndex(PORT, 'project-files', { preserveDirtySameStarter: true });

    expect(readUtf8(fs, '/scratch/src/main.js')).toBe('user edit');
    expect(loadIndex(fs, '/').scratch).toMatchObject({
      starter: 'project-files',
      dirty: true,
    });

    tearOwner();
  });

  it('index-mark-scratch-dirty persists a dirty scratch draft without reseeding files', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/scratch/src', { recursive: true });
    fs.writeFileSync('/scratch/src/main.js', enc.encode('user edit'));
    writeIndex(fs, '/', {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: false, editedAt: 'no edits yet' },
      projects: [],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await markScratchDirtyIndex(PORT, 'project-files');

    expect(readUtf8(fs, '/scratch/src/main.js')).toBe('user edit');
    expect(received.at(-1)).toMatchObject({
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true },
    });
    expect(loadIndex(fs, '/').scratch).toMatchObject({
      starter: 'project-files',
      dirty: true,
    });

    dispose();
    tearOwner();
  });

  it('index-mark-scratch-dirty returns an exact correlated NACK when durability flush fails', async () => {
    const fs = scratchOwnerFs('user edit');
    const failure = new Error('dirty marker flush failed');
    failure.name = 'IndexFlushError';
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      throw failure;
    });

    const outcome = await settlePromptly(markScratchDirtyIndex(PORT, 'project-files'));

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'IndexFlushError', message: 'dirty marker flush failed' },
    });
    tearOwner();
  });

  it('index-mark-scratch-dirty synthesizes the scratch entry when the tree exists but the index is cold-empty', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/scratch/src', { recursive: true });
    fs.writeFileSync('/scratch/src/main.js', enc.encode('user edit'));
    writeIndex(fs, '/', { activeId: 'scratch', scratch: null, projects: [] });
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    await markScratchDirtyIndex(PORT, 'node-worker');

    expect(loadIndex(fs, '/')).toMatchObject({
      activeId: 'scratch',
      scratch: { starter: 'node-worker', dirty: true },
    });
    expect(readUtf8(fs, '/scratch/src/main.js')).toBe('user edit');

    tearOwner();
  });

  it('index-reset re-seeds the active scratch from its starter, clears dirty, re-publishes', async () => {
    const fs = scratchOwnerFs('user-edits');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await resetScratchIndex(PORT, 'project-files');

    // The stray marker is gone (whole-workspace re-seed) and the starter baseline
    // is written back (the entry the starter seeds is present).
    expect(fs.existsSync('/scratch/marker.txt')).toBe(false);
    expect(fs.existsSync('/scratch')).toBe(true);
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);
    expect(fs.existsSync('/scratch/vite.config.js')).toBe(true);
    expect(JSON.parse(readUtf8(fs, viteConfigSeedClaimPath('/scratch')))).toMatchObject({
      schema: 1,
      starter: 'project-files',
      file: 'vite.config.js',
    });

    // Index: scratch dirty cleared, still scratch-active.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('scratch');
    expect(reply?.scratch).toMatchObject({ starter: 'project-files', dirty: false });

    dispose();
    tearOwner();
  });

  it('runs scratch reset, new scratch, and named reset inside the supplied package FIFO', async () => {
    const fs = scratchOwnerFs('user-edits');
    fs.mkdirSync('/projects/p-1', { recursive: true });
    fs.writeFileSync('/projects/p-1/package.json', enc.encode('{"name":"old"}\n'));
    writeIndex(fs, '/', {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: 'edited' },
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'old' }],
    });
    const calls: string[] = [];
    let fifo = Promise.resolve();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: (target, prepare) => {
        const operation = fifo.then(async () => {
          const slug = target.root === '/scratch' ? 'scratch' : target.root.split('/').at(-1);
          calls.push(`before:${slug}`);
          const plan = await prepare();
          if (plan.status === 'ready') await plan.mutate();
          calls.push(`after:${slug}`);
        });
        fifo = operation.catch(() => undefined);
        return operation;
      },
    });

    await resetScratchIndex(PORT, 'project-files');
    await newScratchIndex(PORT, 'node-worker');
    await resetProjectIndex(PORT, 'p-1');
    await fifo;

    expect(calls).toEqual([
      'before:scratch',
      'after:scratch',
      'before:scratch',
      'after:scratch',
      'before:p-1',
      'after:p-1',
    ]);
    tearOwner();
  });

  it('serializes rename behind a parked reset without losing the later index mutation', async () => {
    const fs = ownerFs();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    let releaseReset!: () => void;
    let markResetPrepared!: () => void;
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    const resetPrepared = new Promise<void>((resolve) => {
      markResetPrepared = resolve;
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        const plan = await prepare();
        markResetPrepared();
        await resetGate;
        if (plan.status === 'ready') await plan.mutate();
      },
    });

    const reset = resetProjectIndex(PORT, 'p-1');
    await resetPrepared;
    const rename = renameProjectIndex(PORT, 'p-1', 'Renamed after reset');
    await Promise.resolve();
    releaseReset();
    await Promise.all([reset, rename]);

    expect(loadIndex(fs, '/').projects).toMatchObject([{ id: 'p-1', name: 'Renamed after reset' }]);
    tearOwner();
  });

  it('teardown rejects parked and queued mutations, then fences every later write and post', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      AsyncDropOnCloseChannel as unknown as typeof BroadcastChannel;
    const fs = ownerFs();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    fs.writeFileSync('/projects/p-1/sentinel.txt', enc.encode('must survive'));
    const parked = deferred();
    const release = deferred();
    const completed = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        try {
          const plan = await prepare();
          parked.resolve();
          await release.promise;
          if (plan.status === 'ready') await plan.mutate();
        } finally {
          completed.resolve();
        }
      },
    });

    const reset = resetProjectIndex(PORT, 'p-1');
    await parked.promise;
    const rename = renameProjectIndex(PORT, 'p-1', 'must not land');
    await Promise.resolve();

    tearOwner();
    const [resetOutcome, renameOutcome] = await Promise.all([
      settlePromptly(reset),
      settlePromptly(rename),
    ]);
    release.resolve();
    await completed.promise;
    await Promise.resolve();

    expect(resetOutcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ProjectIndexBridgeClosedError' },
    });
    expect(renameOutcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ProjectIndexBridgeClosedError' },
    });
    expect(readUtf8(fs, '/projects/p-1/sentinel.txt')).toBe('must survive');
    expect(loadIndex(fs, '/').projects).toMatchObject([{ id: 'p-1', name: 'A' }]);
    expect(AsyncDropOnCloseChannel.postsAfterClose).toBe(0);
    expect(AsyncDropOnCloseChannel.repeatedCloses).toBe(0);
  });

  it('rejects promptly with the exact reset revocation failure NACK', async () => {
    const fs = scratchOwnerFs('must-survive');
    const failure = new Error('install-stamp revoke durability check failed');
    failure.name = 'InstallStampAuthorityError';
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async () => {
        throw failure;
      },
    });

    const outcome = await settlePromptly(resetScratchIndex(PORT, 'project-files'));

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: {
        name: 'InstallStampAuthorityError',
        message: 'install-stamp revoke durability check failed',
      },
    });
    expect(readUtf8(fs, '/scratch/marker.txt')).toBe('must-survive');
    expect(loadIndex(fs, '/').scratch?.dirty).toBe(true);
    tearOwner();
  });

  it('rejects promptly with the exact reset mutation failure NACK', async () => {
    const fs = scratchOwnerFs('will-be-reset');
    const failure = new Error('starter git initialization failed');
    failure.name = 'StarterGitMutationError';
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, async () => {
      throw failure;
    });

    const outcome = await settlePromptly(resetScratchIndex(PORT, 'project-files'));

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: {
        name: 'StarterGitMutationError',
        message: 'starter git initialization failed',
      },
    });
    expect(fs.existsSync('/scratch/marker.txt')).toBe(false);
    expect(loadIndex(fs, '/').scratch).toMatchObject({ dirty: false });
    tearOwner();
  });

  it('index-reset re-seeds + REFRESHES the live snapshot (owner index writes bypass onVfsWrite)', async () => {
    const fs = scratchOwnerFs('user-edits');
    let refreshed = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, () => {
      refreshed++;
    });
    const { dispose } = subscribeProjectIndex(PORT, () => {});
    await Promise.resolve();

    await resetScratchIndex(PORT, 'project-files');
    // The reset published a fresh FILE snapshot so the editor/explorer reflect the
    // restored tree — without this the on-disk re-seed would be invisible.
    expect(refreshed).toBe(1);

    dispose();
    tearOwner();
  });

  it('index-reset proves config then claim durable before git, refresh, and ack', async () => {
    const fs = scratchOwnerFs('user-edits');
    const marker = viteConfigSeedClaimPath('/scratch');
    const events: string[] = [];
    const flush = async (): Promise<undefined> => {
      events.push(
        fs.existsSync(marker)
          ? 'flush:claim'
          : fs.existsSync('/scratch/vite.config.js')
            ? 'flush:config'
            : 'flush:baseline',
      );
      return undefined;
    };
    const tearOwner = serveProjectIndex(
      PORT,
      fs,
      '/',
      flush,
      () => events.push('refresh'),
      async () => {
        expect(fs.existsSync('/scratch/vite.config.js')).toBe(true);
        expect(fs.existsSync(marker)).toBe(true);
        events.push('git');
      },
    );

    await resetScratchIndex(PORT, 'project-files');

    expect(events).toEqual(['flush:config', 'flush:claim', 'git', 'flush:claim', 'refresh']);
    tearOwner();
  });

  it('keeps a parked named reset pending across an unrelated index reply, then rejects its exact NACK', async () => {
    const fs = ownerFs();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    let releaseReset!: () => void;
    let markResetParked!: () => void;
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    const resetParked = new Promise<void>((resolve) => {
      markResetParked = resolve;
    });
    const failure = new Error('named reset failed after park');
    failure.name = 'NamedResetError';
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async () => {
        markResetParked();
        await resetGate;
        throw failure;
      },
    });

    const mutation = resetProjectIndex(PORT, 'p-1');
    await resetParked;
    let observed:
      | { readonly status: 'resolved' }
      | { readonly status: 'rejected'; readonly error: unknown }
      | undefined;
    void mutation.then(
      () => {
        observed = { status: 'resolved' };
      },
      (error: unknown) => {
        observed = { status: 'rejected', error };
      },
    );
    const replies: ProjectIndex[] = [];
    const subscription = subscribeProjectIndex(PORT, (index) => replies.push(index));
    await Promise.resolve();

    expect(replies).toHaveLength(1);
    expect(observed).toBeUndefined();

    releaseReset();
    const outcome = await settlePromptly(mutation);
    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'NamedResetError', message: 'named reset failed after park' },
    });
    subscription.dispose();
    tearOwner();
  });

  it('index-reset-project RE-SEEDS /projects/<id> from the project starter (real restore, not a no-op)', async () => {
    // A named project with user edits + a stray file + node_modules to be wiped.
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1/src', { recursive: true });
    fs.writeFileSync('/projects/p-1/src/main.js', enc.encode('user-edited-source'));
    fs.writeFileSync('/projects/p-1/stray.txt', enc.encode('orphan'));
    fs.mkdirSync('/projects/p-1/node_modules/x', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'old' }],
    });
    let refreshed = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, () => {
      refreshed++;
    });
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();

    await resetProjectIndex(PORT, 'p-1');

    // Tree restored from the starter bundle: edit reverted, stray + node_modules gone.
    expect(readUtf8(fs, '/projects/p-1/src/main.js')).not.toBe('user-edited-source');
    expect(fs.existsSync('/projects/p-1/stray.txt')).toBe(false);
    expect(fs.existsSync('/projects/p-1/node_modules')).toBe(false);
    expect(fs.existsSync('/projects/p-1/src/main.js')).toBe(true);
    expect(fs.existsSync('/projects/p-1/vite.config.js')).toBe(true);
    expect(JSON.parse(readUtf8(fs, viteConfigSeedClaimPath('/projects/p-1')))).toMatchObject({
      schema: 1,
      starter: 'project-files',
      file: 'vite.config.js',
    });
    // editedAt bumped; live snapshot refreshed; project still listed.
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'A' }]);
    expect(received.at(-1)?.projects[0]?.editedAt).not.toBe('old');
    expect(refreshed).toBe(1);

    // Unknown id = idempotent no-op publish (no throw).
    await expect(resetProjectIndex(PORT, 'nope')).resolves.toBeDefined();

    dispose();
    tearOwner();
  });
});
