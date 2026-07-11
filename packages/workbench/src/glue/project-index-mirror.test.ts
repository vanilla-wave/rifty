import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeProjectIndex, serveProjectIndex } from './project-index-port.ts';
import type { ProjectIndex } from './project-index.ts';
import { writeIndex } from './project-index.ts';

/**
 * page-mirror over the owner-serve bridge (ADR-0165 realm split). The OPFS
 * index is worker-writable only (sync OPFS, ADR-0135), so the launcher renders
 * from an in-memory MIRROR the owner publishes. `bridgeProjectIndex` wraps the
 * `subscribeProjectIndex` callback into a mirror with `current()`/`request()`
 * — the switch path re-`request()`s after a respawn and the mirror is replaced
 * WHOLESALE (never merged) so the re-publish is authoritative.
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

const PORT = 59125;

function ownerFs(index: ProjectIndex): MemoryFsSync {
  const fs = new MemoryFsSync();
  writeIndex(fs, '/', index);
  return fs;
}

const SCRATCH: ProjectIndex = {
  activeId: 'scratch',
  scratch: { starter: 'project-files', dirty: false, editedAt: 'z' },
  projects: [],
};

describe('project-index page mirror (ADR-0165 realm split)', () => {
  it('hydrates the page mirror with the owner index on subscribe-handshake', async () => {
    const fs = ownerFs(SCRATCH);
    const tear = serveProjectIndex(PORT, fs, '/');
    const mirror = bridgeProjectIndex(PORT);
    const seen = vi.fn();
    mirror.subscribe(seen);
    await mirror.request(); // page asks; owner re-publishes

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ activeId: 'scratch' }));
    expect(mirror.current()).toMatchObject({ activeId: 'scratch' });
    mirror.dispose();
    tear();
  });

  it('replaces the mirror when the owner re-publishes after a respawn', async () => {
    const fs = ownerFs(SCRATCH);
    const tear = serveProjectIndex(PORT, fs, '/');
    const mirror = bridgeProjectIndex(PORT);
    const states: ProjectIndex[] = [];
    mirror.subscribe((i) => states.push(i));
    await mirror.request();

    // Owner mutates the on-disk index (a Save), then the page re-requests after
    // the respawn — the mirror must reflect the NEW state wholesale.
    writeIndex(fs, '/', {
      activeId: 'p1',
      scratch: null,
      projects: [{ id: 'p1', name: 'One', starter: 'project-files', editedAt: 'y' }],
    });
    await mirror.request(); // simulate post-respawn re-publish

    expect(states.at(-1)?.activeId).toBe('p1');
    expect(states.at(-1)?.projects).toHaveLength(1);
    expect(mirror.current()?.activeId).toBe('p1');
    mirror.dispose();
    tear();
  });
});
