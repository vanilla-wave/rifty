/**
 * Tests for {@link NodeModulesCache} (ADR-0080).
 *
 * Driven by a FAKE bridge (no BroadcastChannel) so cache hit/miss/coalesce/
 * evict-on-reject/invalidate are deterministic, with no realm or timing.
 */
import { describe, expect, it } from 'vitest';
import { NodeModulesCache } from './node-modules-cache.ts';
import type { NodeModulesBridge, NodeModulesDirEntry } from './node-modules-model.ts';

const ENTRIES: readonly NodeModulesDirEntry[] = [
  { name: 'dist', kind: 'dir', size: 0 },
  { name: 'package.json', kind: 'file', size: 15 },
];

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: Error): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A bridge stub that counts readdir calls and lets the test control results. */
function fakeBridge(readdirImpl: (call: number) => Promise<readonly NodeModulesDirEntry[]>): {
  bridge: NodeModulesBridge;
  calls(): number;
} {
  let calls = 0;
  const bridge: NodeModulesBridge = {
    readdir(_path) {
      calls += 1;
      return readdirImpl(calls);
    },
    readFile() {
      return Promise.resolve({ size: 0, content: null });
    },
    dispose() {},
  };
  return { bridge, calls: () => calls };
}

describe('NodeModulesCache', () => {
  it('cache miss issues one read; a hit returns the same promise without a second read', async () => {
    const fake = fakeBridge(() => Promise.resolve(ENTRIES));
    const cache = new NodeModulesCache(fake.bridge);

    const p1 = cache.readdir('/ws/node_modules');
    const p2 = cache.readdir('/ws/node_modules');
    expect(p1).toBe(p2);
    expect(await p1).toEqual(ENTRIES);
    expect(await p2).toEqual(ENTRIES);
    expect(fake.calls()).toBe(1);
  });

  it('coalesces concurrent reads of the same path into a single in-flight request', async () => {
    const d = deferred<readonly NodeModulesDirEntry[]>();
    const fake = fakeBridge(() => d.promise);
    const cache = new NodeModulesCache(fake.bridge);

    const p1 = cache.readdir('/x');
    const p2 = cache.readdir('/x');
    expect(fake.calls()).toBe(1); // cached before it resolves

    d.resolve(ENTRIES);
    expect(await p1).toEqual(ENTRIES);
    expect(await p2).toEqual(ENTRIES);
    expect(fake.calls()).toBe(1);
  });

  it('evicts a rejected read so a retry re-issues', async () => {
    const fake = fakeBridge((call) =>
      call === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(ENTRIES),
    );
    const cache = new NodeModulesCache(fake.bridge);

    await expect(cache.readdir('/x')).rejects.toThrow('boom');
    expect(await cache.readdir('/x')).toEqual(ENTRIES);
    expect(fake.calls()).toBe(2);
  });

  it('invalidate() clears the view so peek is empty and the next read re-issues', async () => {
    const fake = fakeBridge(() => Promise.resolve(ENTRIES));
    const cache = new NodeModulesCache(fake.bridge);

    await cache.readdir('/x');
    expect(cache.peek('/x')).toEqual(ENTRIES);

    cache.invalidate();
    expect(cache.peek('/x')).toBeUndefined();

    await cache.readdir('/x');
    expect(fake.calls()).toBe(2);
  });
});
