/**
 * ADR-0011 review item §1.10: the parent-side worker handler subscribed to
 * `'error'` but NOT `'messageerror'`, so structured-clone failures during
 * `postMessage` were silently dropped.
 *
 * After the fix:
 *   - `messageerror` events surface via `SpawnWorkerResult.onMessageError`.
 *   - The kernel worker handle emits a `'messageerror'` event so higher
 *     layers can observe the failure without polling.
 *   - The worker stays alive (deserialization failure is not fatal — that
 *     mirrors the browser, which keeps the realm running after a
 *     messageerror).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';

type Listener = (ev: MessageEvent) => void;

class FakeWorker implements WorkerLike {
  private readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;

  postMessage(): void {}
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
  /** Test helper — dispatch a synthetic event to subscribers. */
  fire(type: string, ev: MessageEvent): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const cb of [...set]) cb(ev);
  }
}

describe('spawnKernelWorker — messageerror surfaces (review §1.10 fix)', () => {
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

  it('SpawnWorkerResult.onMessageError fires when the worker reports a messageerror', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = spawnKernelWorker(
      {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      },
      { pid: 200, ppid: 1 },
    );

    const seen: Array<MessageEvent> = [];
    result.onMessageError((ev) => seen.push(ev));

    // Drive a messageerror — simulates the browser's report when an
    // un-cloneable value was posted (e.g. a Symbol or a function).
    const ev = new MessageEvent('messageerror', { data: 'uncloneable' });
    factoryWorker?.fire('messageerror', ev);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(ev);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    // Worker must NOT be terminated on a deserialization error.
    expect(factoryWorker?.terminated).toBe(false);

    result.terminate();
    consoleSpy.mockRestore();
  });

  it('ProcessHandle emits "messageerror" so callers can subscribe through the kernel record', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });

    const seen: unknown[] = [];
    handle.on('messageerror', (ev) => {
      seen.push(ev);
    });

    const ev = new MessageEvent('messageerror', { data: 'still-bad' });
    factoryWorker?.fire('messageerror', ev);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(ev);

    handle.kill('SIGTERM');
    consoleSpy.mockRestore();
  });
});
