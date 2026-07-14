import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

interface SaveCommand {
  readonly type: 'index-save';
  readonly opId: string;
  readonly id: string;
  readonly name: string;
  readonly starter: string;
}

interface SaveRequest {
  readonly type: 'index-save';
  readonly id: string;
  readonly name: string;
  readonly starter: string;
}

interface SaveAppliedOutcome {
  readonly type: 'index-save-applied';
  readonly opId: string;
  readonly request: SaveRequest;
  readonly index: ProjectIndex;
}

type SaveTerminalOutcome =
  | {
      readonly type: 'index-save-terminal';
      readonly opId: string;
      readonly request: SaveRequest;
      readonly ok: true;
      readonly index: ProjectIndex;
    }
  | {
      readonly type: 'index-save-terminal';
      readonly opId: string;
      readonly request: SaveRequest;
      readonly ok: false;
      readonly applied?: ProjectIndex;
      readonly error: { readonly name: string; readonly message: string };
    };

type SaveOutcome = SaveAppliedOutcome | SaveTerminalOutcome;

function frameType(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const type = (data as { readonly type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function isSaveCommand(data: unknown): data is SaveCommand {
  return (
    frameType(data) === 'index-save' &&
    typeof (data as { readonly opId?: unknown }).opId === 'string'
  );
}

function isSaveAppliedOutcome(data: unknown): data is SaveAppliedOutcome {
  return frameType(data) === 'index-save-applied';
}

function isSaveTerminalOutcome(data: unknown): data is SaveTerminalOutcome {
  return frameType(data) === 'index-save-terminal';
}

function saveReceipt(candidate: SaveOutcome): {
  readonly type: 'index-save-received';
  readonly candidate: SaveOutcome;
} {
  return { type: 'index-save-received', candidate };
}

function requestFromSave(command: SaveCommand): SaveRequest {
  return {
    type: 'index-save',
    id: command.id,
    name: command.name,
    starter: command.starter,
  };
}

function fakeChannelName(): string {
  const name = FakeChannel.buses.keys().next().value;
  if (typeof name !== 'string') throw new Error('expected a project-index channel');
  return name;
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

class HoldSaveReceiptChannel extends FakeChannel {
  static hold = true;
  override postMessage(data: unknown): void {
    if (HoldSaveReceiptChannel.hold && frameType(data) === 'index-save-received') return;
    super.postMessage(data);
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
  HoldSaveReceiptChannel.hold = true;
});
afterEach(() => {
  vi.useRealTimers();
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

  it('fences queued and future mutations after a durability failure without publishing poisoned state', async () => {
    const fs = ownerFs();
    const flushGate = deferred();
    const flushStarted = deferred();
    const failure = new Error('project index durability authority failed');
    failure.name = 'ProjectIndexDurabilityError';
    let flushCalls = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushCalls++;
      if (flushCalls === 1) {
        flushStarted.resolve();
        await flushGate.promise;
        throw failure;
      }
      return undefined;
    });
    const broadcasts: ProjectIndex[] = [];
    const observer = subscribeProjectIndex(PORT, (index) => broadcasts.push(index));
    await Promise.resolve();

    const failed = renameProjectIndex(PORT, 'p-1', 'Poisoned Rename');
    await flushStarted.promise;
    const queued = markScratchDirtyIndex(PORT, 'project-files');
    flushGate.resolve();
    const [failedOutcome, queuedOutcome] = await Promise.allSettled([failed, queued]);
    const futureOutcome = await settlePromptly(markScratchDirtyIndex(PORT, 'project-files'));
    const passiveReplies: ProjectIndex[] = [];
    const passive = subscribeProjectIndex(PORT, (index) => passiveReplies.push(index));
    await Promise.resolve();

    expect([failedOutcome, queuedOutcome]).toMatchObject([
      {
        status: 'rejected',
        reason: {
          name: 'ProjectIndexDurabilityError',
          message: 'project index durability authority failed',
        },
      },
      {
        status: 'rejected',
        reason: {
          name: 'ProjectIndexDurabilityError',
          message: 'project index durability authority failed',
        },
      },
    ]);
    expect(futureOutcome).toMatchObject({
      status: 'rejected',
      error: {
        name: 'ProjectIndexDurabilityError',
        message: 'project index durability authority failed',
      },
    });
    expect(flushCalls).toBe(1);
    expect(broadcasts.at(-1)).toMatchObject({ projects: [{ id: 'p-1', name: 'A' }] });
    expect(passiveReplies).toHaveLength(1);
    expect(passiveReplies[0]).toMatchObject({ projects: [{ id: 'p-1', name: 'A' }] });

    passive.dispose();
    observer.dispose();
    tearOwner();
  });

  it.each(durabilityPublicationScenarios)(
    'fences later mutations when $name loses its durability proof',
    async ({ name, createFs, mutate, before }) => {
      const fs = createFs();
      const failure = new Error(`${name} durability proof failed`);
      failure.name = 'ProjectIndexDurabilityError';
      let flushCalls = 0;
      const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
        flushCalls++;
        throw failure;
      });

      const failedOutcome = await settlePromptly(mutate());
      const laterOutcome = await settlePromptly(markScratchDirtyIndex(PORT, 'project-files'));
      const passiveReplies: ProjectIndex[] = [];
      const passive = subscribeProjectIndex(PORT, (index) => passiveReplies.push(index));
      await Promise.resolve();

      expect(failedOutcome).toMatchObject({
        status: 'rejected',
        error: { name: 'ProjectIndexDurabilityError', message: `${name} durability proof failed` },
      });
      expect(laterOutcome).toMatchObject({
        status: 'rejected',
        error: { name: 'ProjectIndexDurabilityError', message: `${name} durability proof failed` },
      });
      expect(flushCalls).toBe(1);
      expect(passiveReplies).toHaveLength(1);
      expect(passiveReplies[0]).toMatchObject(before);

      passive.dispose();
      tearOwner();
    },
  );

  it('fences later mutations when Save loses durability after its applied state', async () => {
    const fs = scratchOwnerFs('save-durability-fence');
    const failure = new Error('Save durability proof failed');
    failure.name = 'ProjectIndexDurabilityError';
    let flushCalls = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushCalls++;
      throw failure;
    });

    const phases = saveProjectIndexPhases(
      PORT,
      'p-save-durability-fence',
      'Save Durability Fence',
      'project-files',
    );
    const appliedOutcome = await settlePromptly(phases.applied);
    const durableOutcome = await settlePromptly(phases.durable);
    const laterOutcome = await settlePromptly(markScratchDirtyIndex(PORT, 'project-files'));
    const passiveReplies: ProjectIndex[] = [];
    const passive = subscribeProjectIndex(PORT, (index) => passiveReplies.push(index));
    await Promise.resolve();

    expect(appliedOutcome).toMatchObject({
      status: 'resolved',
      value: { activeId: 'p-save-durability-fence' },
    });
    expect(durableOutcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ProjectIndexDurabilityError', message: 'Save durability proof failed' },
    });
    expect(laterOutcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ProjectIndexDurabilityError', message: 'Save durability proof failed' },
    });
    expect(flushCalls).toBe(1);
    expect(passiveReplies).toHaveLength(1);
    expect(passiveReplies[0]).toMatchObject({ activeId: 'scratch', projects: [] });

    passive.dispose();
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

  it('admits one owner mutation for repeated save frames with the same opId', async () => {
    vi.useFakeTimers();
    const fs = scratchOwnerFs('deduped-save');
    const entered = deferred();
    const gate = deferred();
    let admissions = 0;
    const packageMutations: Pick<PackageMutationExecutor, 'reset'> = {
      reset: async (_target, prepare) => {
        admissions++;
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
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
    const phases = saveProjectIndexPhases(PORT, 'p-dedupe', 'Dedupe', 'project-files');

    await entered.promise;
    await vi.advanceTimersByTimeAsync(800);
    gate.resolve();
    await phases.durable;
    await renameProjectIndex(PORT, 'p-dedupe', 'After dedupe');

    expect(admissions).toBe(1);
    expect(loadIndex(fs, '/').projects).toMatchObject([{ id: 'p-dedupe', name: 'After dedupe' }]);
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
    await Promise.resolve();
    await Promise.resolve();
    expect(
      [...AsyncDropOnCloseChannel.buses.values()].reduce((size, peers) => size + peers.size, 0),
    ).toBe(1);
    expect(AsyncDropOnCloseChannel.postsAfterClose).toBe(0);
    expect(AsyncDropOnCloseChannel.repeatedCloses).toBe(0);

    tearOwner();
    await Promise.resolve();
    expect(
      [...AsyncDropOnCloseChannel.buses.values()].reduce((size, peers) => size + peers.size, 0),
    ).toBe(0);
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

  it('rejects both save phases with the exact initial send failure', async () => {
    const failure = new Error('initial index save send failed exactly');
    let closeCalls = 0;
    class InitialSendFailChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (
          data &&
          typeof data === 'object' &&
          (data as { readonly type?: unknown }).type === 'index-save'
        ) {
          throw failure;
        }
        super.postMessage(data);
      }
      override close(): void {
        closeCalls++;
        super.close();
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      InitialSendFailChannel as unknown as typeof BroadcastChannel;

    const phases = saveProjectIndexPhases(PORT, 'p-initial-fail', 'Initial Fail', 'project-files');
    const applied = expect(phases.applied).rejects.toBe(failure);
    const durable = expect(phases.durable).rejects.toBe(failure);

    await Promise.all([applied, durable]);
    expect(closeCalls).toBe(1);
  });

  it('keeps an admitted save pending when a retry send throws, then executes it once', async () => {
    vi.useFakeTimers();
    const failure = new Error('index retry send failed exactly');
    let savePosts = 0;
    let closeCalls = 0;
    let dropAdmission = true;
    class RetrySendFailChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (
          dropAdmission &&
          data &&
          typeof data === 'object' &&
          (data as { readonly type?: unknown }).type === 'index-save-admitted'
        ) {
          dropAdmission = false;
          return;
        }
        if (
          data &&
          typeof data === 'object' &&
          (data as { readonly type?: unknown }).type === 'index-save' &&
          ++savePosts === 2
        ) {
          throw failure;
        }
        super.postMessage(data);
      }
      override close(): void {
        closeCalls++;
        super.close();
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      RetrySendFailChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('retry-failure-save');
    const entered = deferred();
    const gate = deferred();
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(PORT, 'p-retry-fail', 'Retry Fail', 'project-files');
    let applied = 'pending';
    let durable = 'pending';
    void phases.applied.then(
      () => {
        applied = 'resolved';
      },
      () => {
        applied = 'rejected';
      },
    );
    void phases.durable.then(
      () => {
        durable = 'resolved';
      },
      () => {
        durable = 'rejected';
      },
    );

    await entered.promise;
    await vi.advanceTimersByTimeAsync(251);
    expect(savePosts).toBe(2);
    expect({ applied, durable }).toEqual({ applied: 'pending', durable: 'pending' });
    expect(executions).toBe(1);

    await vi.advanceTimersByTimeAsync(251);
    gate.resolve();
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-retry-fail' });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-retry-fail' });
    expect(savePosts).toBe(3);
    expect(executions).toBe(1);
    expect(closeCalls).toBe(1);
    expect(failure.message).toBe('index retry send failed exactly');
    tearOwner();
  });

  it('executes an admitted Save when its first admission notification throws', async () => {
    vi.useFakeTimers();
    const admissionFailure = new Error('first owner admission send failed');
    let admissionPosts = 0;
    let savePosts = 0;
    class AdmissionSendFailChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save') savePosts++;
        if (frameType(data) === 'index-save-admitted' && ++admissionPosts === 1) {
          throw admissionFailure;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      AdmissionSendFailChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('admission-send-failure');
    const entered = deferred();
    const gate = deferred();
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(
      PORT,
      'p-admission-fail',
      'Admission Fail',
      'project-files',
    );

    await entered.promise;
    expect(executions).toBe(1);
    expect(admissionPosts).toBe(1);
    expect(savePosts).toBe(1);

    await vi.advanceTimersByTimeAsync(251);
    expect(admissionPosts).toBe(2);
    expect(savePosts).toBe(2);
    expect(executions).toBe(1);

    gate.resolve();
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-admission-fail' });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-admission-fail' });
    expect(executions).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(1);
    expect(admissionFailure.message).toBe('first owner admission send failed');
    tearOwner();
    await Promise.resolve();
  });

  it('resumes status polling after exact applied release until a dropped terminal replays', async () => {
    vi.useFakeTimers();
    let savePosts = 0;
    let droppedTerminals = 0;
    let appliedReleases = 0;
    class DropFirstSuccessTerminalChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save') savePosts++;
        const candidate =
          data && typeof data === 'object'
            ? (data as { readonly candidate?: unknown }).candidate
            : undefined;
        if (frameType(data) === 'index-save-released' && isSaveAppliedOutcome(candidate)) {
          appliedReleases++;
        }
        if (
          frameType(data) === 'index-save-terminal' &&
          (data as { readonly ok?: unknown }).ok === true &&
          droppedTerminals++ === 0
        ) {
          return;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropFirstSuccessTerminalChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('dropped-terminal-success');
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(
      PORT,
      'p-dropped-terminal',
      'Dropped Terminal',
      'project-files',
    );

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-dropped-terminal' });
    await Promise.resolve();
    let durable = 'pending';
    void phases.durable.then(
      () => {
        durable = 'resolved';
      },
      () => {
        durable = 'rejected';
      },
    );
    expect(droppedTerminals).toBe(1);
    expect(durable).toBe('pending');
    expect(savePosts).toBe(1);
    expect(executions).toBe(1);
    expect(appliedReleases).toBe(1);

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-dropped-terminal' });
    expect(savePosts).toBe(2);
    expect(executions).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(savePosts).toBe(2);
    tearOwner();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays a dropped post-applied failure without re-executing Save', async () => {
    vi.useFakeTimers();
    let savePosts = 0;
    let droppedTerminals = 0;
    class DropFirstFailureTerminalChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save') savePosts++;
        if (
          frameType(data) === 'index-save-terminal' &&
          (data as { readonly ok?: unknown }).ok === false &&
          droppedTerminals++ === 0
        ) {
          return;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropFirstFailureTerminalChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('dropped-terminal-failure');
    const realRm = fs.rmSync.bind(fs);
    const failure = new Error('dropped terminal cleanup failed');
    failure.name = 'DroppedTerminalCleanupError';
    fs.rmSync = ((path, options) => {
      if (path === '/scratch') throw failure;
      realRm(path, options);
    }) as typeof fs.rmSync;
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(
      PORT,
      'p-dropped-failure',
      'Dropped Failure',
      'project-files',
    );

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-dropped-failure' });
    await Promise.resolve();
    await Promise.resolve();
    expect(droppedTerminals).toBe(1);
    expect(savePosts).toBe(1);
    expect(executions).toBe(1);

    const durableFailure = expect(phases.durable).rejects.toMatchObject({
      name: 'DroppedTerminalCleanupError',
      message: 'dropped terminal cleanup failed',
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await durableFailure;
    expect(savePosts).toBe(2);
    expect(executions).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(1);
    tearOwner();
    await Promise.resolve();
  });

  it('retries a failed terminal receipt without changing the Save outcome', async () => {
    vi.useFakeTimers();
    const receiptFailure = new Error('first terminal receipt send failed');
    let terminalReceiptPosts = 0;
    let closeCalls = 0;
    class ReceiptRetryChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        const candidate =
          data && typeof data === 'object'
            ? (data as { readonly candidate?: unknown }).candidate
            : undefined;
        if (
          frameType(data) === 'index-save-received' &&
          frameType(candidate) === 'index-save-terminal' &&
          ++terminalReceiptPosts === 1
        ) {
          throw receiptFailure;
        }
        super.postMessage(data);
      }
      override close(): void {
        closeCalls++;
        super.close();
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      ReceiptRetryChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('receipt-retry');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const phases = saveProjectIndexPhases(
      PORT,
      'p-receipt-retry',
      'Receipt Retry',
      'project-files',
    );

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-receipt-retry' });
    let durableState = 'pending';
    void phases.durable.then(
      () => {
        durableState = 'resolved';
      },
      () => {
        durableState = 'rejected';
      },
    );
    await Promise.resolve();
    expect(durableState).toBe('pending');
    expect(terminalReceiptPosts).toBe(1);
    expect(closeCalls).toBe(0);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(2);

    await vi.advanceTimersByTimeAsync(251);
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-receipt-retry' });
    expect(terminalReceiptPosts).toBe(2);
    expect(closeCalls).toBe(1);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(1);
    expect(FakeChannel.postsAfterClose).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(terminalReceiptPosts).toBe(2);
    expect(closeCalls).toBe(1);
    tearOwner();
    await Promise.resolve();
    expect(closeCalls).toBe(2);
  });

  it('retries exact cleanup confirmation until a dropped closed frame is delivered', async () => {
    vi.useFakeTimers();
    let cleanupConfirmationPosts = 0;
    let closedPosts = 0;
    let closeCalls = 0;
    const firstClosed = deferred();
    class DropFirstClosedChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save-release-confirmed') cleanupConfirmationPosts++;
        if (frameType(data) === 'index-save-closed') {
          closedPosts++;
          firstClosed.resolve();
          if (closedPosts === 1) return;
        }
        super.postMessage(data);
      }
      override close(): void {
        closeCalls++;
        super.close();
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropFirstClosedChannel as unknown as typeof BroadcastChannel;
    const tearOwner = serveProjectIndex(PORT, scratchOwnerFs('dropped-closed'), '/');
    const phases = saveProjectIndexPhases(
      PORT,
      'p-dropped-closed',
      'Dropped Closed',
      'project-files',
    );

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-dropped-closed' });
    await firstClosed.promise;
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-dropped-closed' });
    expect(cleanupConfirmationPosts).toBe(1);
    expect(closedPosts).toBe(1);
    expect(closeCalls).toBe(0);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(2);

    await vi.advanceTimersByTimeAsync(251);
    expect(cleanupConfirmationPosts).toBe(2);
    expect(closedPosts).toBe(2);
    expect(closeCalls).toBe(1);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(1);
    expect(FakeChannel.postsAfterClose).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    tearOwner();
    await Promise.resolve();
    expect(closeCalls).toBe(2);
  });

  it('stops status polling while an exact terminal receipt retries', async () => {
    vi.useFakeTimers();
    let savePosts = 0;
    let terminalReleasePosts = 0;
    const terminalReleaseAttempted = deferred();
    class HoldTerminalReleaseChannel extends FakeChannel {
      static hold = true;
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save') savePosts++;
        const candidate =
          data && typeof data === 'object'
            ? (data as { readonly candidate?: unknown }).candidate
            : undefined;
        if (frameType(data) === 'index-save-released' && isSaveTerminalOutcome(candidate)) {
          terminalReleasePosts++;
          terminalReleaseAttempted.resolve();
          if (HoldTerminalReleaseChannel.hold) return;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      HoldTerminalReleaseChannel as unknown as typeof BroadcastChannel;
    const ownerClosed = deferred();
    const tearOwner = serveProjectIndex(PORT, scratchOwnerFs('terminal-receipt-no-poll'), '/');
    const phases = saveProjectIndexPhases(
      PORT,
      'p-terminal-receipt-no-poll',
      'Terminal Receipt No Poll',
      'project-files',
      { ownerClosed: ownerClosed.promise },
    );

    await expect(phases.applied).resolves.toMatchObject({
      activeId: 'p-terminal-receipt-no-poll',
    });
    await terminalReleaseAttempted.promise;
    await vi.advanceTimersByTimeAsync(1_001);
    const savesWhileTerminalStaged = savePosts;

    ownerClosed.resolve();
    await Promise.allSettled([phases.durable]);
    tearOwner();

    expect(terminalReleasePosts).toBeGreaterThanOrEqual(1);
    expect(savesWhileTerminalStaged).toBe(1);
  });

  it('re-emits an exact terminal release when the first release drops after ledger deletion', async () => {
    vi.useFakeTimers();
    let terminalReleasePosts = 0;
    const firstTerminalRelease = deferred();
    class DropFirstTerminalReleaseChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        const candidate =
          data && typeof data === 'object'
            ? (data as { readonly candidate?: unknown }).candidate
            : undefined;
        if (frameType(data) === 'index-save-released' && isSaveTerminalOutcome(candidate)) {
          terminalReleasePosts++;
          firstTerminalRelease.resolve();
          if (terminalReleasePosts === 1) return;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropFirstTerminalReleaseChannel as unknown as typeof BroadcastChannel;
    const ownerClosed = deferred();
    const tearOwner = serveProjectIndex(PORT, scratchOwnerFs('dropped-terminal-release'), '/');
    const phases = saveProjectIndexPhases(
      PORT,
      'p-dropped-terminal-release',
      'Dropped Terminal Release',
      'project-files',
      { ownerClosed: ownerClosed.promise },
    );
    let durableState = 'pending';
    void phases.durable.then(
      () => {
        durableState = 'resolved';
      },
      () => {
        durableState = 'rejected';
      },
    );

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-dropped-terminal-release' });
    await firstTerminalRelease.promise;
    await vi.advanceTimersByTimeAsync(251);
    const afterExactReceiptRetry = durableState;

    ownerClosed.resolve();
    await Promise.allSettled([phases.durable]);
    tearOwner();

    expect(afterExactReceiptRetry).toBe('resolved');
    expect(terminalReleasePosts).toBe(2);
  });

  it('retains the exact terminal across a dropped release and divergent same-op candidate', async () => {
    let terminalReleasePosts = 0;
    let closedPosts = 0;
    const firstTerminalRelease = deferred();
    class DropFirstExactReleaseChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        const candidate =
          data && typeof data === 'object'
            ? (data as { readonly candidate?: unknown }).candidate
            : undefined;
        if (frameType(data) === 'index-save-released' && isSaveTerminalOutcome(candidate)) {
          terminalReleasePosts++;
          firstTerminalRelease.resolve();
          if (terminalReleasePosts === 1) return;
        }
        if (frameType(data) === 'index-save-closed') closedPosts++;
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropFirstExactReleaseChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('dropped-release-divergent');
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const phases = saveProjectIndexPhases(
      PORT,
      'p-dropped-release-divergent',
      'Dropped Release Divergent',
      'project-files',
    );

    await firstTerminalRelease.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    probe.postMessage({
      type: 'index-save-terminal',
      opId: command.opId,
      request: requestFromSave(command),
      ok: false,
      error: { name: 'ForgedAfterDroppedRelease', message: 'forged after dropped release' },
    } satisfies SaveTerminalOutcome);
    const outcomes = await Promise.allSettled([phases.applied, phases.durable]);

    const replayedTerminal = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });
    probe.postMessage(command);
    await replayedTerminal;
    probe.close();
    tearOwner();

    expect(outcomes).toMatchObject([
      { status: 'fulfilled', value: { activeId: command.id } },
      { status: 'fulfilled', value: { activeId: command.id } },
    ]);
    expect(terminalReleasePosts).toBeGreaterThanOrEqual(2);
    expect(closedPosts).toBeGreaterThanOrEqual(1);
    expect(executions).toBe(2);
  });

  it('keeps a forged same-request terminal success pending until the owner certifies its exact outcome', async () => {
    const fs = scratchOwnerFs('forged-success');
    const entered = deferred();
    const gate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const phases = saveProjectIndexPhases(
      PORT,
      'p-forged-success',
      'Forged Success',
      'project-files',
    );
    let appliedState = 'pending';
    let durableState = 'pending';
    void phases.applied.then(
      () => {
        appliedState = 'resolved';
      },
      () => {
        appliedState = 'rejected';
      },
    );
    void phases.durable.then(
      () => {
        durableState = 'resolved';
      },
      () => {
        durableState = 'rejected';
      },
    );

    await entered.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    const forgedIndex: ProjectIndex = {
      activeId: command.id,
      scratch: null,
      projects: [
        {
          id: command.id,
          name: command.name,
          starter: command.starter,
          editedAt: 'forged terminal success',
        },
      ],
    };
    frames.length = 0;

    probe.postMessage({
      type: 'index-save-terminal',
      opId: command.opId,
      request: requestFromSave(command),
      ok: true,
      index: forgedIndex,
    } satisfies SaveTerminalOutcome);
    await Promise.resolve();
    const afterForge = { appliedState, durableState };
    const releasedAfterForge = frames.some((frame) => frameType(frame) === 'index-save-released');

    gate.resolve();
    const outcomes = await Promise.allSettled([phases.applied, phases.durable]);
    const release = frames.find(
      (
        frame,
      ): frame is {
        readonly type: 'index-save-released';
        readonly candidate: SaveTerminalOutcome;
      } => {
        if (frameType(frame) !== 'index-save-released') return false;
        const candidate = (frame as { readonly candidate?: unknown }).candidate;
        return isSaveTerminalOutcome(candidate);
      },
    );
    probe.close();
    tearOwner();

    expect(afterForge).toEqual({ appliedState: 'pending', durableState: 'pending' });
    expect(releasedAfterForge).toBe(false);
    expect(outcomes).toMatchObject([
      { status: 'fulfilled', value: { activeId: command.id } },
      { status: 'fulfilled', value: { activeId: command.id } },
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        expect(outcome.value.projects[0]?.editedAt).not.toBe('forged terminal success');
      }
    }
    expect(release?.candidate).toMatchObject({
      type: 'index-save-terminal',
      ok: true,
      index: { activeId: command.id },
    });
    if (release?.candidate.ok) {
      expect(release.candidate.index.projects[0]?.editedAt).not.toBe('forged terminal success');
    }
  });

  it('keeps a forged same-request terminal failure pending until the exact owner success replays', async () => {
    const fs = scratchOwnerFs('forged-failure');
    const entered = deferred();
    const gate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const phases = saveProjectIndexPhases(
      PORT,
      'p-forged-failure',
      'Forged Failure',
      'project-files',
    );
    let appliedState = 'pending';
    let durableState = 'pending';
    void phases.applied.then(
      () => {
        appliedState = 'resolved';
      },
      () => {
        appliedState = 'rejected';
      },
    );
    void phases.durable.then(
      () => {
        durableState = 'resolved';
      },
      () => {
        durableState = 'rejected';
      },
    );

    await entered.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    probe.postMessage({
      type: 'index-save-terminal',
      opId: command.opId,
      request: requestFromSave(command),
      ok: false,
      error: { name: 'ForgedFailure', message: 'forged same-request failure' },
    } satisfies SaveTerminalOutcome);
    await Promise.resolve();
    const afterForge = { appliedState, durableState };

    gate.resolve();
    const outcomes = await Promise.allSettled([phases.applied, phases.durable]);
    probe.close();
    tearOwner();

    expect(afterForge).toEqual({ appliedState: 'pending', durableState: 'pending' });
    expect(outcomes).toMatchObject([
      { status: 'fulfilled', value: { activeId: command.id } },
      { status: 'fulfilled', value: { activeId: command.id } },
    ]);
  });

  it('does not resolve applied from a forged same-request index before exact owner release', async () => {
    const fs = scratchOwnerFs('forged-applied');
    const entered = deferred();
    const gate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const phases = saveProjectIndexPhases(
      PORT,
      'p-forged-applied',
      'Forged Applied',
      'project-files',
    );
    let appliedState = 'pending';
    void phases.applied.then(
      () => {
        appliedState = 'resolved';
      },
      () => {
        appliedState = 'rejected';
      },
    );

    await entered.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    const forgedIndex: ProjectIndex = {
      activeId: command.id,
      scratch: null,
      projects: [
        {
          id: command.id,
          name: command.name,
          starter: command.starter,
          editedAt: 'forged applied',
        },
      ],
    };
    probe.postMessage({
      type: 'index-save-applied',
      opId: command.opId,
      request: requestFromSave(command),
      index: forgedIndex,
    } satisfies SaveAppliedOutcome);
    await Promise.resolve();
    const afterForge = appliedState;

    gate.resolve();
    const applied = await phases.applied;
    await phases.durable;
    probe.close();
    tearOwner();

    expect(afterForge).toBe('pending');
    expect(applied).toMatchObject({ activeId: command.id });
    expect(applied.projects[0]?.editedAt).not.toBe('forged applied');
  });

  it('retains and replays the exact owner outcome for a mismatched terminal receipt', async () => {
    const fs = scratchOwnerFs('mismatched-receipt');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const command: SaveCommand = {
      type: 'index-save',
      opId: 'mismatched-terminal-receipt',
      id: 'p-mismatched-receipt',
      name: 'Mismatched Receipt',
      starter: 'project-files',
    };
    const terminalReached = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });
    probe.postMessage(command);
    const terminal = await terminalReached;
    if (!terminal.ok) throw new Error('expected successful owner terminal');
    const forgedTerminal: SaveTerminalOutcome = {
      ...terminal,
      index: {
        ...terminal.index,
        projects: terminal.index.projects.map((project) => ({
          ...project,
          editedAt: 'forged receipt',
        })),
      },
    };
    frames.length = 0;

    probe.postMessage(saveReceipt(forgedTerminal));
    const mismatchReplay = [...frames];
    frames.length = 0;
    probe.postMessage(command);
    const retainedReplay = [...frames];
    frames.length = 0;
    probe.postMessage(saveReceipt(terminal));
    const exactRelease = [...frames];
    probe.close();
    tearOwner();

    expect(mismatchReplay.map(frameType)).toEqual([
      'index-save-admitted',
      'index-save-applied',
      'index-save-terminal',
    ]);
    expect(mismatchReplay.map(frameType)).not.toContain('index-save-released');
    expect(retainedReplay).toEqual(mismatchReplay);
    expect(exactRelease).toContainEqual({
      type: 'index-save-released',
      candidate: terminal,
    });
  });

  it('replays admission for queued duplicate saves without duplicating the FIFO mutation', async () => {
    const fs = scratchOwnerFs('queued-replay');
    const entered = deferred();
    const gate = deferred();
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));

    const phases = saveProjectIndexPhases(
      PORT,
      'p-queued-replay',
      'Queued Replay',
      'project-files',
    );
    await entered.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;

    probe.postMessage(command);
    probe.postMessage(command);

    expect(frames.map(frameType)).toEqual(['index-save-admitted', 'index-save-admitted']);
    expect(executions).toBe(1);

    gate.resolve();
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-queued-replay' });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-queued-replay' });
    expect(executions).toBe(1);
    probe.close();
    tearOwner();
  });

  it('replays admission plus applied state while Save durability is parked', async () => {
    const fs = scratchOwnerFs('applied-replay');
    const flushStarted = deferred();
    const flushGate = deferred();
    let flushes = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushes++;
      if (flushes === 1) {
        flushStarted.resolve();
        await flushGate.promise;
      }
      return undefined;
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));

    const phases = saveProjectIndexPhases(
      PORT,
      'p-applied-replay',
      'Applied Replay',
      'project-files',
    );
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-applied-replay' });
    await flushStarted.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;

    probe.postMessage(command);

    expect(frames.map(frameType)).toEqual(['index-save-admitted', 'index-save-applied']);
    flushGate.resolve();
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-applied-replay' });
    probe.close();
    tearOwner();
  });

  it('replays terminal success until receipt, then releases the bounded owner record', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      HoldSaveReceiptChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('terminal-success-replay');
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const terminalReached = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });

    const phases = saveProjectIndexPhases(
      PORT,
      'p-terminal-success',
      'Terminal Success',
      'project-files',
    );
    await terminalReached;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;

    probe.postMessage(command);

    expect(frames.map(frameType)).toEqual([
      'index-save-admitted',
      'index-save-applied',
      'index-save-terminal',
    ]);
    expect(executions).toBe(1);
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(3);
    const terminal = frames.find(isSaveTerminalOutcome);
    if (!terminal) throw new Error('expected replayed index-save terminal');

    probe.postMessage(saveReceipt(terminal));
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-terminal-success' });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-terminal-success' });
    expect(frames.map(frameType)).toContain('index-save-released');
    expect(frames.map(frameType)).toContain('index-save-closed');
    expect(FakeChannel.buses.get(fakeChannelName())?.size).toBe(2);
    const releases = frames.filter((frame) => frameType(frame) === 'index-save-released').length;
    probe.postMessage(saveReceipt(terminal));
    expect(frames.filter((frame) => frameType(frame) === 'index-save-released')).toHaveLength(
      releases,
    );
    expect(executions).toBe(1);

    frames.length = 0;
    const secondTerminal = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });
    probe.postMessage(command);
    const nextTerminal = await secondTerminal;
    expect(executions).toBe(2);
    expect(frames.map(frameType)).toContain('index-save-admitted');
    probe.postMessage(saveReceipt(nextTerminal));

    probe.close();
    tearOwner();
  });

  it('replays a terminal pre-apply failure without inventing an applied state', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      HoldSaveReceiptChannel as unknown as typeof BroadcastChannel;
    const fs = new MemoryFsSync();
    writeIndex(fs, '/', { activeId: 'scratch', scratch: null, projects: [] });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const terminalReached = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });

    const phases = saveProjectIndexPhases(PORT, 'p-pre-fail', 'Pre Fail', 'project-files');
    const applied = expect(phases.applied).rejects.toThrow(/no scratch to save/);
    const durable = expect(phases.durable).rejects.toThrow(/no scratch to save/);
    await terminalReached;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;

    probe.postMessage(command);

    expect(frames.map(frameType)).toEqual(['index-save-admitted', 'index-save-terminal']);
    expect(frames.find((frame) => frameType(frame) === 'index-save-terminal')).not.toHaveProperty(
      'applied',
    );
    const terminal = frames.find(isSaveTerminalOutcome);
    if (!terminal) throw new Error('expected replayed pre-apply terminal');
    probe.postMessage(saveReceipt(terminal));
    await Promise.all([applied, durable]);

    probe.close();
    tearOwner();
  });

  it('loud-fails divergent Save reuse without poisoning the original operation', async () => {
    const fs = scratchOwnerFs('divergent-reuse');
    const entered = deferred();
    const gate = deferred();
    let executions = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        executions++;
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));

    const phases = saveProjectIndexPhases(PORT, 'p-original', 'Original', 'project-files');
    await entered.promise;
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;
    const divergent = { ...command, name: 'Divergent' } satisfies SaveCommand;

    probe.postMessage(divergent);

    expect(frames).toContainEqual({
      type: 'index-save-conflict',
      opId: command.opId,
      request: requestFromSave(divergent),
      error: {
        name: 'ProjectIndexOperationIdReuseError',
        message: `project index operation id reused with different input (${command.opId})`,
      },
    });
    expect(executions).toBe(1);
    expect(fs.existsSync('/projects/p-original')).toBe(false);

    gate.resolve();
    await expect(phases.applied).resolves.toMatchObject({
      activeId: 'p-original',
      projects: [{ id: 'p-original', name: 'Original' }],
    });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-original' });
    expect(executions).toBe(1);
    probe.close();
    tearOwner();
  });

  it('keeps generic mutation opIds isolated from the Save replay ledger', async () => {
    const fs = scratchOwnerFs('generic-opid-isolation');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const sharedOpId = 'shared-generic-save-op';

    probe.postMessage({
      type: 'index-rename',
      opId: sharedOpId,
      projectId: 'missing',
      name: 'Generic',
    });
    await Promise.resolve();
    expect(frames).toContainEqual(
      expect.objectContaining({ type: 'index-ack', opId: sharedOpId, ok: true }),
    );

    const command: SaveCommand = {
      type: 'index-save',
      opId: sharedOpId,
      id: 'p-generic-isolated',
      name: 'Generic Isolated',
      starter: 'project-files',
    };
    const terminal = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });
    probe.postMessage(command);
    const terminalOutcome = await terminal;

    expect(frames.map(frameType)).toContain('index-save-admitted');
    expect(frames.map(frameType)).toContain('index-save-applied');
    expect(frames.map(frameType)).toContain('index-save-terminal');
    expect(frames.map(frameType)).not.toContain('index-save-conflict');
    expect(loadIndex(fs, '/')).toMatchObject({
      activeId: 'p-generic-isolated',
      projects: [{ id: 'p-generic-isolated', name: 'Generic Isolated' }],
    });
    probe.postMessage(saveReceipt(terminalOutcome));
    probe.close();
    tearOwner();
  });

  it('teardown terminally rejects and releases admitted Save state without a client timer leak', async () => {
    vi.useFakeTimers();
    const fs = scratchOwnerFs('teardown-release');
    const entered = deferred();
    const gate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(PORT, 'p-teardown', 'Teardown', 'project-files');
    const applied = expect(phases.applied).rejects.toMatchObject({
      name: 'ProjectIndexBridgeClosedError',
    });
    const durable = expect(phases.durable).rejects.toMatchObject({
      name: 'ProjectIndexBridgeClosedError',
    });
    await entered.promise;

    tearOwner();
    await Promise.all([applied, durable]);
    await Promise.resolve();
    expect([...FakeChannel.buses.values()].reduce((size, peers) => size + peers.size, 0)).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeChannel.postsAfterClose).toBe(0);
    gate.resolve();
    await Promise.resolve();
    expect(FakeChannel.postsAfterClose).toBe(0);
  });

  it('teardown replays a retained exact terminal before release so a dropped outcome stays finite', async () => {
    class DropTerminalUntilTeardownChannel extends FakeChannel {
      static dropTerminal = true;
      override postMessage(data: unknown): void {
        if (
          DropTerminalUntilTeardownChannel.dropTerminal &&
          frameType(data) === 'index-save-terminal'
        ) {
          return;
        }
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropTerminalUntilTeardownChannel as unknown as typeof BroadcastChannel;
    const ownerClosed = deferred();
    const tearOwner = serveProjectIndex(PORT, scratchOwnerFs('teardown-terminal-replay'), '/');
    const phases = saveProjectIndexPhases(
      PORT,
      'p-teardown-terminal',
      'Teardown Terminal',
      'project-files',
      { ownerClosed: ownerClosed.promise },
    );
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-teardown-terminal' });
    let durableState = 'pending';
    void phases.durable.then(
      () => {
        durableState = 'resolved';
      },
      () => {
        durableState = 'rejected';
      },
    );
    await Promise.resolve();

    DropTerminalUntilTeardownChannel.dropTerminal = false;
    tearOwner();
    await Promise.resolve();
    const afterTeardown = durableState;
    ownerClosed.resolve();
    await Promise.allSettled([phases.durable]);

    expect(afterTeardown).toBe('resolved');
    expect(FakeChannel.postsAfterClose).toBe(0);
  });

  it('keeps both save phases pending past the former timeout before applied', async () => {
    vi.useFakeTimers();
    const fs = scratchOwnerFs('slow-pre-apply');
    const entered = deferred();
    const gate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', undefined, undefined, undefined, {
      reset: async (_target, prepare) => {
        entered.resolve();
        await gate.promise;
        const plan = await prepare();
        if (plan.status === 'ready') await plan.mutate();
      },
    });
    const phases = saveProjectIndexPhases(PORT, 'p-pre-apply', 'Pre Apply', 'project-files');
    let applied = 'pending';
    let durable = 'pending';
    void phases.applied.then(
      () => {
        applied = 'resolved';
      },
      () => {
        applied = 'rejected';
      },
    );
    void phases.durable.then(
      () => {
        durable = 'resolved';
      },
      () => {
        durable = 'rejected';
      },
    );

    await entered.promise;
    await vi.advanceTimersByTimeAsync(90_001);
    expect({ applied, durable }).toEqual({ applied: 'pending', durable: 'pending' });

    gate.resolve();
    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-pre-apply' });
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-pre-apply' });
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
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));

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
    const appliedRelease = frames.find(
      (
        frame,
      ): frame is {
        readonly type: 'index-save-released';
        readonly candidate: SaveAppliedOutcome;
      } => {
        if (frameType(frame) !== 'index-save-released') return false;
        return isSaveAppliedOutcome((frame as { readonly candidate?: unknown }).candidate);
      },
    );
    expect(appliedRelease?.candidate.index).toEqual(applied);
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

    probe.close();
    tearOwner();
  });

  it('keeps durable pending past the former timeout after applied', async () => {
    vi.useFakeTimers();
    const fs = scratchOwnerFs('slow-post-apply');
    const commitFlush = deferred();
    const cleanupFlush = deferred();
    const cleanupStarted = deferred();
    let flushes = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushes++;
      if (flushes === 1) await commitFlush.promise;
      else {
        cleanupStarted.resolve();
        await cleanupFlush.promise;
      }
      return undefined;
    });
    const phases = saveProjectIndexPhases(PORT, 'p-post-apply', 'Post Apply', 'project-files');

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-post-apply' });
    let durable = 'pending';
    void phases.durable.then(
      () => {
        durable = 'resolved';
      },
      () => {
        durable = 'rejected';
      },
    );
    await vi.advanceTimersByTimeAsync(90_001);
    expect(durable).toBe('pending');

    commitFlush.resolve();
    await cleanupStarted.promise;
    cleanupFlush.resolve();
    await expect(phases.durable).resolves.toMatchObject({ activeId: 'p-post-apply' });
    tearOwner();
  });

  it('preserves applied and rejects only durable on certified owner exit', async () => {
    const fs = scratchOwnerFs('owner-exit-after-applied');
    const commitFlush = deferred();
    const cleanupFlush = deferred();
    const cleanupStarted = deferred();
    const ownerClosed = deferred();
    let flushes = 0;
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushes++;
      if (flushes === 1) await commitFlush.promise;
      else {
        cleanupStarted.resolve();
        await cleanupFlush.promise;
      }
      return undefined;
    });
    const phases = saveProjectIndexPhases(PORT, 'p-owner-exit', 'Owner Exit', 'project-files', {
      ownerClosed: ownerClosed.promise,
    });

    await expect(phases.applied).resolves.toMatchObject({ activeId: 'p-owner-exit' });
    ownerClosed.resolve();
    await expect(phases.durable).rejects.toThrow(/owner exited/i);

    commitFlush.resolve();
    await cleanupStarted.promise;
    cleanupFlush.resolve();
    await Promise.resolve();
    tearOwner();
  });

  it('keeps an admitted index mutation pending past the former ack timeout', async () => {
    vi.useFakeTimers();
    const fs = ownerFs();
    const flushStarted = deferred();
    const flushGate = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushStarted.resolve();
      await flushGate.promise;
      return undefined;
    });
    const mutation = renameProjectIndex(PORT, 'p-1', 'Slow but committed');
    let outcome = 'pending';
    void mutation.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    await flushStarted.promise;
    await vi.advanceTimersByTimeAsync(90_001);
    expect(outcome).toBe('pending');

    flushGate.resolve();
    await expect(mutation).resolves.toMatchObject({
      projects: [{ id: 'p-1', name: 'Slow but committed' }],
    });
    tearOwner();
  });

  it('rejects an admitted index mutation when the owner exit is certified', async () => {
    const fs = ownerFs();
    const flushStarted = deferred();
    const flushGate = deferred();
    const ownerClosed = deferred();
    const tearOwner = serveProjectIndex(PORT, fs, '/', async () => {
      flushStarted.resolve();
      await flushGate.promise;
      return undefined;
    });
    const mutation = renameProjectIndex(PORT, 'p-1', 'Owner exits', {
      ownerClosed: ownerClosed.promise,
    });

    await flushStarted.promise;
    ownerClosed.resolve();
    await expect(mutation).rejects.toThrow(/owner exited/i);

    flushGate.resolve();
    await Promise.resolve();
    tearOwner();
  });

  it('certifies both phases from an exact terminal NACK with applied when the applied frame drops', async () => {
    class DropAppliedOutcomeChannel extends FakeChannel {
      override postMessage(data: unknown): void {
        if (frameType(data) === 'index-save-applied') return;
        super.postMessage(data);
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      DropAppliedOutcomeChannel as unknown as typeof BroadcastChannel;
    const fs = scratchOwnerFs('terminal-nack-applied');
    const realRm = fs.rmSync.bind(fs);
    const failure = new Error('terminal NACK cleanup failed');
    failure.name = 'TerminalNackCleanupError';
    fs.rmSync = ((path, options) => {
      if (path === '/scratch') throw failure;
      realRm(path, options);
    }) as typeof fs.rmSync;
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));

    const phases = saveProjectIndexPhases(
      PORT,
      'p-terminal-nack-applied',
      'Terminal NACK Applied',
      'project-files',
    );
    const outcomes = await Promise.allSettled([phases.applied, phases.durable]);
    const release = frames.find(
      (
        frame,
      ): frame is {
        readonly type: 'index-save-released';
        readonly candidate: Extract<SaveTerminalOutcome, { readonly ok: false }>;
      } => {
        if (frameType(frame) !== 'index-save-released') return false;
        const candidate = (frame as { readonly candidate?: unknown }).candidate;
        return isSaveTerminalOutcome(candidate) && !candidate.ok;
      },
    );
    probe.close();
    tearOwner();

    expect(outcomes).toMatchObject([
      { status: 'fulfilled', value: { activeId: 'p-terminal-nack-applied' } },
      {
        status: 'rejected',
        reason: { name: 'TerminalNackCleanupError', message: 'terminal NACK cleanup failed' },
      },
    ]);
    expect(release?.candidate).toMatchObject({
      ok: false,
      applied: { activeId: 'p-terminal-nack-applied' },
      error: { name: 'TerminalNackCleanupError', message: 'terminal NACK cleanup failed' },
    });
  });

  it('index-save keeps applied but rejects durable exactly when committed-source cleanup fails', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      HoldSaveReceiptChannel as unknown as typeof BroadcastChannel;
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
    const probe = new FakeChannel(fakeChannelName());
    const frames: unknown[] = [];
    probe.addEventListener('message', (event) => frames.push(event.data));
    const appliedReached = new Promise<SaveAppliedOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveAppliedOutcome(event.data)) resolve(event.data);
      });
    });
    const terminalReached = new Promise<SaveTerminalOutcome>((resolve) => {
      probe.addEventListener('message', (event) => {
        if (isSaveTerminalOutcome(event.data)) resolve(event.data);
      });
    });

    const phases = saveProjectIndexPhases(PORT, 'p-cleanup-fail', 'Cleanup Fail', 'project-files');

    const appliedOutcome = await appliedReached;
    probe.postMessage(saveReceipt(appliedOutcome));
    await expect(phases.applied).resolves.toMatchObject({
      activeId: 'p-cleanup-fail',
      projects: [{ id: 'p-cleanup-fail' }],
    });
    await terminalReached;
    expect(flushCalls).toBe(1);
    expect(loadIndex(fs, '/').activeId).toBe('p-cleanup-fail');
    expect(fs.existsSync('/projects/p-cleanup-fail/marker.txt')).toBe(true);
    expect(fs.existsSync('/scratch')).toBe(true);
    const command = frames.find(isSaveCommand);
    if (!command) throw new Error('expected captured index-save command');
    frames.length = 0;

    probe.postMessage(command);

    expect(frames.map(frameType)).toEqual([
      'index-save-admitted',
      'index-save-applied',
      'index-save-terminal',
    ]);
    expect(frames.find((frame) => frameType(frame) === 'index-save-terminal')).toMatchObject({
      ok: false,
      applied: { activeId: 'p-cleanup-fail', projects: [{ id: 'p-cleanup-fail' }] },
    });
    const terminal = frames.find(isSaveTerminalOutcome);
    if (!terminal) throw new Error('expected replayed cleanup-failure terminal');
    probe.postMessage(saveReceipt(terminal));
    const outcome = await settlePromptly(phases.durable);
    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'ScratchCleanupError', message: 'scratch cleanup rm failed' },
    });
    probe.close();
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
