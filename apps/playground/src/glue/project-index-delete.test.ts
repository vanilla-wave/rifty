import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProjectTree,
  serveProjectIndex,
  subscribeProjectIndex,
} from './project-index-port.ts';
import type { ProjectIndex } from './project-index.ts';
import { loadIndex, rootForId, writeIndex } from './project-index.ts';

/**
 * Owner-side `index-delete` (ADR-0165 §56): the DURABLE half of delete-with-Undo.
 * The page-mirror flip + Undo are real (app-project-store); after the grace window
 * the owner must `rmSync` `/projects/<id>` from OPFS and drop it from the index, then
 * re-publish so every page mirror reconciles. Re-uses the in-process FakeChannel bus
 * + MemoryFsSync harness from project-index-port.test.ts (node env has no
 * BroadcastChannel).
 */

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

const PORT = 59126;
const enc = new TextEncoder();

/** Seed a project tree at /projects/<id> with a marker file (mirrors the test convention). */
function seedTree(fs: MemoryFsSync, id: string, marker: string): void {
  const root = rootForId(id);
  fs.mkdirSync(`${root}/src`, { recursive: true });
  fs.writeFileSync(`${root}/src/main.js`, enc.encode(marker));
}

function seededFs(activeId: ProjectIndex['activeId']): MemoryFsSync {
  const fs = new MemoryFsSync();
  seedTree(fs, 'p1', 'one');
  seedTree(fs, 'p2', 'two');
  writeIndex(fs, '/', {
    activeId,
    scratch: { starter: 'project-files', dirty: false, editedAt: 'z' },
    projects: [
      { id: 'p1', name: 'One', starter: 'project-files', editedAt: 'a' },
      { id: 'p2', name: 'Two', starter: 'project-files', editedAt: 'b' },
    ],
  });
  return fs;
}

/** Pull the current owner index via one index-req round-trip. */
async function pullIndex(): Promise<ProjectIndex> {
  let got: ProjectIndex | null = null;
  const { dispose } = subscribeProjectIndex(PORT, (idx) => {
    got = idx;
  });
  await Promise.resolve();
  dispose();
  if (!got) throw new Error('no index reply');
  return got;
}

describe('owner index-delete (ADR-0165 §56 durable delete)', () => {
  it('removes the project tree from disk and drops it from the index', async () => {
    const fs = seededFs('p2');
    const tear = serveProjectIndex(PORT, fs, '/');

    deleteProjectTree(PORT, 'p1');
    await Promise.resolve();

    // (a) p1 tree GONE on disk.
    expect(fs.existsSync(rootForId('p1'))).toBe(false);
    // (b) p2 tree intact.
    expect(fs.existsSync(rootForId('p2'))).toBe(true);
    // (c) a fresh pull no longer lists p1.
    const idx = await pullIndex();
    expect(idx.projects.map((p) => p.id)).toEqual(['p2']);

    tear();
  });

  it('re-points activeId when the active project is deleted (falls back to scratch)', async () => {
    const fs = seededFs('p2'); // p2 is active, and a scratch pointer exists
    const tear = serveProjectIndex(PORT, fs, '/');

    deleteProjectTree(PORT, 'p2');
    await Promise.resolve();

    expect(fs.existsSync(rootForId('p2'))).toBe(false);
    const idx = await pullIndex();
    expect(idx.projects.map((p) => p.id)).toEqual(['p1']);
    expect(idx.activeId).toBe('scratch'); // scratch present → fall back to it
    tear();
  });

  it('re-points activeId to the first remaining project when no scratch exists', async () => {
    const fs = new MemoryFsSync();
    seedTree(fs, 'p1', 'one');
    seedTree(fs, 'p2', 'two');
    writeIndex(fs, '/', {
      activeId: 'p2',
      scratch: null,
      projects: [
        { id: 'p1', name: 'One', starter: 'project-files', editedAt: 'a' },
        { id: 'p2', name: 'Two', starter: 'project-files', editedAt: 'b' },
      ],
    });
    const tear = serveProjectIndex(PORT, fs, '/');

    deleteProjectTree(PORT, 'p2');
    await Promise.resolve();

    const idx = await pullIndex();
    expect(idx.activeId).toBe('p1'); // no scratch → first remaining project
    tear();
  });

  it('COMMITS the index drop BEFORE removing the tree (crash-safe ordering, ADR-0165 §56)', () => {
    // Inverse of the dangerous order: if the tree removal could not be torn AFTER
    // the index commit, a crash leaves an orphan tree (recoverIndex case A rolls it
    // back), never an indexed-but-missing tree (case D throws = boot brick). Proxy
    // a tree rm that throws (a torn write-through stand-in): the index entry must
    // already be gone on disk, proving the commit landed first.
    const fs = seededFs('p2');
    const realRm = fs.rmSync.bind(fs);
    fs.rmSync = ((p: string, opts?: unknown) => {
      if (p === rootForId('p1')) throw new Error('simulated torn tree-removal');
      return realRm(p, opts as never);
    }) as typeof fs.rmSync;
    const tear = serveProjectIndex(PORT, fs, '/');

    // The torn rm propagates loud (sync FakeChannel) — never swallowed.
    expect(() => deleteProjectTree(PORT, 'p1')).toThrow(/torn tree-removal/);
    // …but the index was already committed WITHOUT p1, so a reboot reconcile sees
    // an orphan tree (case A), not an indexed-missing tree (case D brick).
    expect(loadIndex(fs, '/').projects.map((p) => p.id)).toEqual(['p2']);
    tear();
  });

  it('deleting an unknown id is an idempotent no-op publish (no throw, index unchanged)', async () => {
    const fs = seededFs('p2');
    const tear = serveProjectIndex(PORT, fs, '/');

    expect(() => deleteProjectTree(PORT, 'ghost')).not.toThrow();
    await Promise.resolve();

    expect(fs.existsSync(rootForId('p1'))).toBe(true);
    expect(fs.existsSync(rootForId('p2'))).toBe(true);
    const idx = await pullIndex();
    expect(idx.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(idx.activeId).toBe('p2');
    tear();
  });
});
