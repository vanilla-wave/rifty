import { describe, expect, it, vi } from 'vitest';
import { watchServedPorts } from './port-watch.ts';

function fakeRegistry(initial: number[] = []) {
  const ports = new Set<number>(initial);
  const listeners = new Set<() => void>();
  return {
    listPorts: () => [...ports].sort((a, b) => a - b),
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    listen(port: number) {
      ports.add(port);
      for (const cb of [...listeners]) cb();
    },
    close(port: number) {
      ports.delete(port);
      for (const cb of [...listeners]) cb();
    },
  };
}

describe('watchServedPorts', () => {
  it('serves a new port, tears a closed one, posts the full set each change', () => {
    const reg = fakeRegistry([3000]);
    const teardowns = new Map<number, ReturnType<typeof vi.fn>>();
    const posts: number[][] = [];
    watchServedPorts({
      listPorts: reg.listPorts,
      subscribe: reg.subscribe,
      servePreview: (port) => {
        const tear = vi.fn();
        teardowns.set(port, tear);
        return tear;
      },
      post: (ports) => posts.push(ports),
      served: new Map([[3000, () => {}]]), // initial bridge owned elsewhere
    });
    reg.listen(3001);
    expect(teardowns.has(3001)).toBe(true);
    expect(posts.at(-1)).toEqual([3000, 3001]);
    reg.close(3001);
    expect(teardowns.get(3001)).toHaveBeenCalledOnce();
    expect(posts.at(-1)).toEqual([3000]);
    reg.close(3000); // pre-served port: no local teardown to run, still reposted
    expect(posts.at(-1)).toEqual([]);
  });

  it('reconciles ONCE at start: a port already listening when the watch begins is served without waiting for a change', () => {
    // Multi-port entries can open a second port BEFORE the ready handshake
    // finishes; the watch begins after ready with only the boot port seeded —
    // a subscribe-only watch would miss it until some unrelated change.
    const reg = fakeRegistry([3000, 3100]);
    const teardowns = new Map<number, ReturnType<typeof vi.fn>>();
    const posts: number[][] = [];
    watchServedPorts({
      listPorts: reg.listPorts,
      subscribe: reg.subscribe,
      servePreview: (port) => {
        const tear = vi.fn();
        teardowns.set(port, tear);
        return tear;
      },
      post: (ports) => posts.push(ports),
      served: new Map([[3000, () => {}]]),
    });
    expect(teardowns.has(3100)).toBe(true);
    expect(posts.at(-1)).toEqual([3000, 3100]);
  });

  it('unsubscribe stops reconciliation (only the initial reconcile posted)', () => {
    const reg = fakeRegistry();
    const posts: number[][] = [];
    const unsubscribe = watchServedPorts({
      listPorts: reg.listPorts,
      subscribe: reg.subscribe,
      servePreview: () => () => {},
      post: (ports) => posts.push(ports),
    });
    unsubscribe();
    reg.listen(4000);
    expect(posts).toEqual([[]]);
  });
});
