import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  markScratchDirtyIndex,
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndex,
  saveProjectIndexPhases,
  serveProjectIndex,
  setActiveIndex,
  subscribeProjectIndex,
} from './project-index-port.ts';
import type { ProjectIndex } from './project-index.ts';
import { loadIndex, writeIndex } from './project-index.ts';

// In-process BroadcastChannel fake (node env has none): a name-keyed bus.
class FakeChannel {
  static buses = new Map<string, Set<FakeChannel>>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  #listeners = new Set<(ev: { data: unknown }) => void>();
  constructor(public name: string) {
    const peers = FakeChannel.buses.get(name) ?? new Set<FakeChannel>();
    peers.add(this);
    FakeChannel.buses.set(name, peers);
  }
  postMessage(data: unknown): void {
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
    FakeChannel.buses.get(this.name)?.delete(this);
  }
}

// Browser BroadcastChannel delivery is async; closing the sender before the
// queued delivery runs drops the frame in this fake, matching the PR-red race.
class AsyncDropOnCloseChannel {
  static buses = new Map<string, Set<AsyncDropOnCloseChannel>>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  #listeners = new Set<(ev: { data: unknown }) => void>();
  constructor(public name: string) {
    const peers = AsyncDropOnCloseChannel.buses.get(name) ?? new Set<AsyncDropOnCloseChannel>();
    peers.add(this);
    AsyncDropOnCloseChannel.buses.set(name, peers);
  }
  postMessage(data: unknown): void {
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
    AsyncDropOnCloseChannel.buses.get(this.name)?.delete(this);
  }
}

beforeEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
    FakeChannel as unknown as typeof BroadcastChannel;
  FakeChannel.buses.clear();
  AsyncDropOnCloseChannel.buses.clear();
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
async function nextTimer(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('project-index durable save/rename/reset (ADR-0165 §7)', () => {
  it('index-save commits /scratch → /projects/<id>, flips the index, then cleans stale source', async () => {
    const fs = scratchOwnerFs('alpha-bytes');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve(); // initial reply

    await saveProjectIndex(PORT, 'p-alpha', 'Alpha', 'project-files');

    // Disk: the project tree + index are durable at ack time; stale /scratch is
    // recoverable and cleaned on a later tick so huge derived deps do not hold ack.
    expect(fs.existsSync('/projects/p-alpha/marker.txt')).toBe(true);
    expect(readUtf8(fs, '/projects/p-alpha/marker.txt')).toBe('alpha-bytes');
    expect(fs.existsSync('/scratch')).toBe(true);

    // Index: activeId = the new id, scratch cleared, project listed.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('p-alpha');
    expect(reply?.scratch).toBeNull();
    expect(reply?.projects).toMatchObject([
      { id: 'p-alpha', name: 'Alpha', starter: 'project-files' },
    ]);

    await nextTimer();
    expect(fs.existsSync('/scratch')).toBe(false);

    dispose();
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
    let releaseFlush!: () => void;
    let flushStarted = 0;
    const flush = (): Promise<void> => {
      flushStarted++;
      return new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
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

    releaseFlush();
    await phases.durable;
    expect(durableSettled).toBe(true);

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

    saveProjectIndex(PORT, 'p-nw', 'NW', 'node-worker');
    await Promise.resolve();
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-nw', starter: 'node-worker' }]);

    dispose();
    tearOwner();
  });

  it('a save with NO scratch is a LOUD throw, never a silent swallow', () => {
    const fs = new MemoryFsSync();
    writeIndex(fs, '/', { activeId: 'scratch', scratch: null, projects: [] });
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    // The poster fires over the channel; the owner handler runs synchronously in
    // the same tick (FakeChannel is synchronous), so the throw surfaces here.
    expect(() => saveProjectIndex(PORT, 'p-x', 'X', 'project-files')).toThrow(/no scratch to save/);
    tearOwner();
  });

  it('index-rename renames a project in the index + re-publishes (idempotent on unknown id)', async () => {
    const fs = scratchOwnerFs();
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve();
    saveProjectIndex(PORT, 'p-1', 'First', 'project-files');
    await Promise.resolve();

    renameProjectIndex(PORT, 'p-1', 'Renamed');
    await Promise.resolve();
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'Renamed' }]);

    // Unknown id → idempotent no-op publish (no throw, state re-asserted).
    expect(() => renameProjectIndex(PORT, 'nope', 'Z')).not.toThrow();
    await Promise.resolve();
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'Renamed' }]);

    dispose();
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

    setActiveIndex(PORT, 'p-2');
    await Promise.resolve();

    // Durable on disk + re-published, so a respawned owner reads p-2 (no revert).
    expect(received.at(-1)?.activeId).toBe('p-2');
    expect(loadIndex(fs, '/').activeId).toBe('p-2');

    dispose();
    tearOwner();
  });

  it('index-set-active rejects an unknown project id without corrupting the index', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'a' }],
    });
    const tearOwner = serveProjectIndex(PORT, fs, '/');

    expect(() => setActiveIndex(PORT, 'p-missing')).toThrow(/unknown active project/i);
    expect(loadIndex(fs, '/').activeId).toBe('p-1');

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

    newScratchIndex(PORT, 'node-worker');
    await Promise.resolve();

    // A fresh scratch entry + activeId re-pointed to scratch; the prior project stays.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('scratch');
    expect(reply?.scratch).toMatchObject({ starter: 'node-worker', dirty: false });
    expect(reply?.projects).toMatchObject([{ id: 'p-1' }]);
    // /scratch re-seeded from the starter bundle.
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);
    // The Save precondition now holds (no throw).
    expect(() => saveProjectIndex(PORT, 'p-2', 'B', 'node-worker')).not.toThrow();

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

    resetScratchIndex(PORT, 'project-files');
    await Promise.resolve();

    // The stray marker is gone (whole-workspace re-seed) and the starter baseline
    // is written back (the entry the starter seeds is present).
    expect(fs.existsSync('/scratch/marker.txt')).toBe(false);
    expect(fs.existsSync('/scratch')).toBe(true);
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);

    // Index: scratch dirty cleared, still scratch-active.
    const reply = received.at(-1);
    expect(reply?.activeId).toBe('scratch');
    expect(reply?.scratch).toMatchObject({ starter: 'project-files', dirty: false });

    dispose();
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

    resetScratchIndex(PORT, 'project-files');
    await Promise.resolve();
    // The reset published a fresh FILE snapshot so the editor/explorer reflect the
    // restored tree — without this the on-disk re-seed would be invisible.
    expect(refreshed).toBe(1);

    dispose();
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

    resetProjectIndex(PORT, 'p-1');
    await Promise.resolve();

    // Tree restored from the starter bundle: edit reverted, stray + node_modules gone.
    expect(readUtf8(fs, '/projects/p-1/src/main.js')).not.toBe('user-edited-source');
    expect(fs.existsSync('/projects/p-1/stray.txt')).toBe(false);
    expect(fs.existsSync('/projects/p-1/node_modules')).toBe(false);
    expect(fs.existsSync('/projects/p-1/src/main.js')).toBe(true);
    // editedAt bumped; live snapshot refreshed; project still listed.
    expect(received.at(-1)?.projects).toMatchObject([{ id: 'p-1', name: 'A' }]);
    expect(received.at(-1)?.projects[0]?.editedAt).not.toBe('old');
    expect(refreshed).toBe(1);

    // Unknown id = idempotent no-op publish (no throw).
    expect(() => resetProjectIndex(PORT, 'nope')).not.toThrow();

    dispose();
    tearOwner();
  });
});
