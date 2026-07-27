/**
 * `observable-order` × close. Killing a subtree fences NEW children — otherwise
 * a terminal callback of the dying process re-populates the tree the kill just
 * emptied, and the survivor holds a port or preview slot no later teardown ever
 * sweeps (the parent's descendants were already terminated when it ran).
 *
 * Two windows exist and only the first is obvious: the record can still be in
 * the table with termination requested, and — on the Worker path — it is
 * already retired by the time its deferred `'close'` fires, so "is the parent
 * still live?" answers the wrong question. Both stay fenced until settlement
 * completes.
 */
import { describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';

type Listener = (ev: MessageEvent) => void;

class FakeWorker implements WorkerLike {
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly posted: unknown[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function withFakeWorker<T>(fn: () => T): T {
  setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
  setWorkerFactoryForTests(() => new FakeWorker());
  try {
    return fn();
  } finally {
    clearWorkerFactoryForTests();
    clearKernelDispatcher();
  }
}

const idleHandler = () => new Promise<never>(() => {});

describe('ProcessManager — a terminating subtree cannot admit new children', () => {
  it('rejects a same-realm spawn from the dying parent close callback', async () => {
    const pm = new ProcessManager();
    const parent = pm.spawn('parent', idleHandler, 1);
    let resurrection: unknown;
    parent.on('close', () => {
      try {
        pm.spawn('late', idleHandler, parent.pid);
      } catch (error) {
        resurrection = error;
      }
    });

    parent.kill('SIGTERM');
    await vi.waitFor(() => expect(resurrection).toBeDefined());

    expect((resurrection as Error).message).toContain(String(parent.pid));
    expect(pm.list().map((row) => row.command)).not.toContain('late');
  });

  it('rejects a Worker spawn from the dying parent close callback', async () => {
    await withFakeWorker(async () => {
      const pm = new ProcessManager();
      const parent = pm.spawnWorker('parent', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      });
      let resurrection: unknown;
      parent.on('close', () => {
        try {
          pm.spawn('late', idleHandler, parent.pid);
        } catch (error) {
          resurrection = error;
        }
      });

      parent.kill('SIGTERM');
      await vi.waitFor(() => expect(resurrection).toBeDefined());

      expect((resurrection as Error).message).toContain(String(parent.pid));
      expect(pm.list().map((row) => row.command)).not.toContain('late');
    });
  });

  it('rejects a spawn under a Worker parent whose kill is still draining', async () => {
    // A Worker kill settles asynchronously (output drain), so the record stays
    // in the table with termination requested — the widest resurrection window.
    await withFakeWorker(() => {
      const pm = new ProcessManager();
      const parent = pm.spawnWorker('parent', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      });

      parent.kill('SIGTERM');

      expect(() => pm.spawn('late', idleHandler, parent.pid)).toThrow(String(parent.pid));
      expect(pm.list().map((row) => row.command)).not.toContain('late');
    });
  });

  it('still admits a child of a live parent', () => {
    const pm = new ProcessManager();
    const parent = pm.spawn('parent', idleHandler, 1);

    const child = pm.spawn('child', idleHandler, parent.pid);

    expect(pm.list().map((row) => row.pid)).toContain(child.pid);
  });
});
