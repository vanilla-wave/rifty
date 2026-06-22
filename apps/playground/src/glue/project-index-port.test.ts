import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndex,
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

beforeEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
    FakeChannel as unknown as typeof BroadcastChannel;
  FakeChannel.buses.clear();
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

describe('project-index durable save/rename/reset (ADR-0165 §7)', () => {
  it('index-save moves /scratch → /projects/<id>, flips the index, and re-publishes', async () => {
    const fs = scratchOwnerFs('alpha-bytes');
    const tearOwner = serveProjectIndex(PORT, fs, '/');
    const received: ProjectIndex[] = [];
    const { dispose } = subscribeProjectIndex(PORT, (idx) => received.push(idx));
    await Promise.resolve(); // initial reply

    saveProjectIndex(PORT, 'p-alpha', 'Alpha', 'project-files');
    await Promise.resolve();

    // Disk: the tree moved, /scratch is gone.
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
