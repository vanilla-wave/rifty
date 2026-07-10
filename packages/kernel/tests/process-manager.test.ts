/**
 * Kernel `ProcessRecord.cwd` (ADR-0019) — snapshot inheritance at spawn.
 * Plus bookkeeping invariants: after every exit the per-PID `table` MUST
 * shrink back to empty and the internal stdio emitters MUST drop their
 * listeners so a long-lived host (the playground) doesn't accumulate.
 */
import { once } from '@riftydev/io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CWD, ProcessManager } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';

type WorkerListener = (ev: MessageEvent) => void;

/** Stub worker that records added/removed listeners and lets the test fire events. */
class FakeWorker implements WorkerLike {
  private readonly listeners = new Map<string, Set<WorkerListener>>();
  readonly posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: WorkerListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  /** Test helper — count listeners for a given type. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** Test helper — dispatch a synthetic event to subscribers. */
  fire(type: string, ev: MessageEvent): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const cb of [...set]) cb(ev);
  }
}

describe('ProcessManager — cwd inheritance (ADR-0019)', () => {
  it('root spawn defaults cwd to DEFAULT_CWD', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn('test-child', async () => {
      /* noop */
    });
    expect(child.cwd).toBe(DEFAULT_CWD);
  });

  it('explicit options.cwd wins over the default', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn(
      'test-child',
      async () => {
        /* noop */
      },
      1,
      { cwd: '/var/log' },
    );
    expect(child.cwd).toBe('/var/log');
  });

  it('setCwd mutates the record visible through the handle', async () => {
    const pm = new ProcessManager();
    const child = pm.spawn('test-child', async () => {
      /* noop */
    });
    child.setCwd('/srv');
    expect(child.cwd).toBe('/srv');
  });

  it('child spawned with a parent snapshots the parent cwd; later parent chdir does not propagate', async () => {
    const pm = new ProcessManager();
    const parent = pm.spawn(
      'parent',
      async () => {
        /* noop */
      },
      1,
      { cwd: '/a' },
    );
    const child = pm.spawn(
      'child',
      async () => {
        /* noop */
      },
      parent.pid,
    );
    expect(child.cwd).toBe('/a');
    parent.setCwd('/b');
    expect(child.cwd).toBe('/a');
    expect(parent.cwd).toBe('/b');
  });
});

describe('ProcessManager — PID allocation', () => {
  it('same-realm child never reuses an externally supplied parent PID', () => {
    const pm = new ProcessManager();
    const child = pm.spawn('child', async () => {}, 2);

    expect(child.ppid).toBe(2);
    expect(child.pid).not.toBe(child.ppid);
  });
});

/** Wait one microtask so the post-`exit` cleanup queued by the manager runs. */
const flushMicrotasks = (): Promise<void> => new Promise((r) => queueMicrotask(r));

describe('ProcessManager — table cleanup on exit (no leaked records)', () => {
  it('does not start a same-realm handler killed before its queued launch', async () => {
    const pm = new ProcessManager();
    const handler = vi.fn(async () => {});
    const handle = pm.spawn('cancel-before-start', handler);

    expect(handle.kill('SIGTERM')).toBe(true);
    await flushMicrotasks();

    expect(handler).not.toHaveBeenCalled();
    expect(handle.exitCode).toBeNull();
    expect(handle.signalCode).toBe('SIGTERM');
    expect(pm.get(handle.pid)).toBeNull();
  });

  it('same-realm: 10 spawned-and-exited children leave list() empty', async () => {
    const pm = new ProcessManager();
    const handles = [];
    for (let i = 0; i < 10; i++) {
      handles.push(pm.spawn(`child-${i}`, async () => {}));
    }
    await Promise.all(handles.map((h) => once(h, 'exit')));
    await flushMicrotasks();

    expect(pm.list()).toHaveLength(0);
    for (const h of handles) expect(h.exitCode).toBe(0);
  });

  it('after exit, manager.get(pid) returns null', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawn('quick', async () => {});
    expect(pm.get(handle.pid)).toBe(handle);
    await once(handle, 'exit');
    await flushMicrotasks();
    expect(pm.get(handle.pid)).toBeNull();
  });

  it('inner stdio emitters lose all listeners when the same-realm process exits', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawn('streamy', async (io) => {
      io.write('stdout', 'hello\n');
      io.write('stderr', 'oops\n');
      io.send('ipc');
    });
    handle.on('stdout', () => {});
    handle.on('message', () => {});

    await once(handle, 'exit');
    await flushMicrotasks();

    // The internal `parentToChild`/`childToParent` emitters are unreachable
    // post-sweep; assert the public handle's listeners are also cleared.
    expect(handle.listenerCount('stdout')).toBe(0);
    expect(handle.listenerCount('stderr')).toBe(0);
    expect(handle.listenerCount('message')).toBe(0);
  });

  it('a new same-realm child does not inherit a deceased parent cwd', async () => {
    const pm = new ProcessManager();
    const parent = pm.spawn('parent', async () => {}, 1, { cwd: '/zombieland' });
    await once(parent, 'exit');
    await flushMicrotasks();
    const orphan = pm.spawn('orphan', async () => {}, parent.pid);
    expect(orphan.cwd).toBe(DEFAULT_CWD);
  });
});

describe('ProcessManager — Worker-backed table cleanup + listener removal', () => {
  let factoryWorker: FakeWorker | undefined;

  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => {
      factoryWorker = new FakeWorker();
      return factoryWorker;
    });
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    factoryWorker = undefined;
  });

  it('worker-backed child never reuses an externally supplied parent PID', () => {
    const pm = new ProcessManager();
    const child = pm.spawnWorker(
      'node',
      {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/external-parent.js' },
        argv: ['rifty', '/tmp/external-parent.js'],
        env: {},
        cwd: '/workspace',
      },
      2,
    );

    expect(child.ppid).toBe(2);
    expect(child.pid).not.toBe(child.ppid);
  });

  it('10 worker-backed children exited leave list() empty', async () => {
    const pm = new ProcessManager();
    const workers: FakeWorker[] = [];
    const handles = [];
    for (let i = 0; i < 10; i++) {
      const handle = pm.spawnWorker('node', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: `/tmp/c${i}.js` },
        argv: ['rifty', `/tmp/c${i}.js`],
        env: {},
        cwd: '/workspace',
      });
      handles.push(handle);
      if (factoryWorker) workers.push(factoryWorker);
    }
    expect(workers).toHaveLength(10);
    expect(pm.list()).toHaveLength(10);

    // Drive an exit on each worker.
    const exits = handles.map((h) => once(h, 'exit'));
    for (const w of workers) {
      w.fire('message', new MessageEvent('message', { data: { type: 'exit', code: 0 } }));
    }
    await Promise.all(exits);

    expect(pm.list()).toHaveLength(0);
    for (const h of handles) {
      expect(h.exitCode).toBe(0);
    }
  });

  it('worker exit removes the kernel-side message/error/messageerror listeners on the underlying Worker', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    const w = factoryWorker as FakeWorker;

    // Sanity: spawn-worker attached exactly the three lifecycle listeners.
    expect(w.listenerCount('message')).toBeGreaterThan(0);
    expect(w.listenerCount('error')).toBeGreaterThan(0);
    expect(w.listenerCount('messageerror')).toBeGreaterThan(0);

    const exit = once(handle, 'exit');
    w.fire('message', new MessageEvent('message', { data: { type: 'exit', code: 0 } }));
    await exit;

    // After exit, the kernel must drop its listeners so the Worker GC-able.
    expect(w.listenerCount('message')).toBe(0);
    expect(w.listenerCount('error')).toBe(0);
    expect(w.listenerCount('messageerror')).toBe(0);
    expect(handle.exitCode).toBe(0);
  });

  it('worker exit clears handle event-emitter listeners', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/y.js' },
      argv: ['rifty', '/tmp/y.js'],
      env: {},
      cwd: '/workspace',
    });
    handle.on('messageerror', () => {});
    handle.on('close', () => {});

    const w = factoryWorker as FakeWorker;
    const exit = once(handle, 'exit');
    w.fire('message', new MessageEvent('message', { data: { type: 'exit', code: 0 } }));
    await exit;

    // The exit/close handlers above ran; we now expect the handle to be
    // listener-free so long-lived hosts don't accumulate references.
    expect(handle.listenerCount('messageerror')).toBe(0);
    expect(handle.listenerCount('close')).toBe(0);
  });

  it('worker-backed natural exit drains stdout chunks that arrive after the exit message', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/late-stdout.js' },
      argv: ['rifty', '/tmp/late-stdout.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const chunks: string[] = [];
    handle.stdout().on('data', (chunk: unknown) => {
      chunks.push(new TextDecoder().decode(chunk as Uint8Array));
    });

    const w = factoryWorker as FakeWorker;
    const init = w.posted[0] as { spec: { stdio: { stdout: MessagePort } } };
    const exit = once(handle, 'exit');
    w.fire('message', new MessageEvent('message', { data: { type: 'exit', code: 0 } }));
    init.spec.stdio.stdout.postMessage(new TextEncoder().encode('late\n'));
    await exit;

    expect(chunks.join('')).toBe('late\n');
    expect(handle.exitCode).toBe(0);
  });

  it('worker-backed: new spawn does not inherit a dead worker parent cwd', async () => {
    const pm = new ProcessManager();
    const parent = pm.spawnWorker(
      'node',
      {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/p.js' },
        argv: ['rifty', '/tmp/p.js'],
        env: {},
        cwd: '/worker-zombie',
      },
      1,
      { cwd: '/worker-zombie' },
    );
    const w = factoryWorker as FakeWorker;
    const exit = once(parent, 'exit');
    w.fire('message', new MessageEvent('message', { data: { type: 'exit', code: 0 } }));
    await exit;
    expect(pm.list()).toHaveLength(0);

    // Spawn a same-realm child that names the dead worker as parent.
    const orphan = pm.spawn(
      'orphan',
      async () => {
        /* noop */
      },
      parent.pid,
    );
    expect(orphan.cwd).toBe(DEFAULT_CWD);
  });
});
