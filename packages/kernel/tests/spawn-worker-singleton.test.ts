/**
 * ADR-0011 (review item §2.11): `SyncRpcDispatcher` MUST be a singleton —
 * the docstring promises "the same dispatcher instance can serve many
 * rings", and the parent-side polling timer was leaking one
 * `setInterval(1ms)` per spawned child. With N workers, that's N busy-poll
 * timers on the main realm.
 *
 * After the fix:
 *   - One module-level dispatcher reused across every `spawnKernelWorker`.
 *   - A single global timer iterating over all attached rings.
 *
 * The stress test spawns 10 mock workers and asserts both invariants.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  getKernelDispatcher,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';

class StubWorker implements WorkerLike {
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('spawnKernelWorker — singleton SyncRpcDispatcher (ADR-0011 phase 3 fix)', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => new StubWorker());
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
  });

  it('10 spawned workers share exactly 1 dispatcher and 1 polling timer', () => {
    const dispatcherBefore = getKernelDispatcher();
    expect(dispatcherBefore.getAttachmentCount()).toBe(0);

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(
        spawnKernelWorker(
          {
            entry: { kind: 'source', code: 'void 0;', sourceUrl: `/tmp/c${i}.js` },
            argv: ['rifty', `/tmp/c${i}.js`],
            env: {},
            cwd: '/workspace',
          },
          { pid: 100 + i, ppid: 1 },
        ),
      );
    }

    // Every spawn must reuse the same instance.
    for (const r of results) {
      expect(r.dispatcher).toBe(dispatcherBefore);
    }
    expect(getKernelDispatcher()).toBe(dispatcherBefore);

    // All 10 rings attached; only one timer drives the dispatcher.
    expect(dispatcherBefore.getAttachmentCount()).toBe(10);
    expect(dispatcherBefore.getActiveTimerCount()).toBe(1);

    // Tear down: detach each ring; timer goes away once empty.
    for (const r of results) r.terminate();
    expect(dispatcherBefore.getAttachmentCount()).toBe(0);
    expect(dispatcherBefore.getActiveTimerCount()).toBe(0);
  });
});
