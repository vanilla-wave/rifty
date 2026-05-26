/**
 * Verifies — at the type level — that the Worker-backed `ProcessHandle`
 * variant does NOT expose `.send()`. The sealed-union refactor moved `send`
 * off the {@link ProcessHandleBase} and onto {@link SameRealmProcessHandle}
 * only; the throwing stub that used to live on {@link WorkerProcessHandle}
 * is gone. Callers narrow on `handle.kind` before reaching for `send`.
 *
 * Fork-mode IPC for Worker-backed children is still pending — see ADR-0011
 * phase 2 follow-ups and the M6 "Open acceptance" entry in TASKS.md. When
 * that lands, `send` is added to {@link WorkerProcessHandle} additively;
 * the `@ts-expect-error` here becomes the trigger that flips the test from
 * "negative-type guard" to "send is required on both branches".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import { clearKernelWorkerUrl, setKernelWorkerUrl } from '../src/spawn-worker.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';

class StubWorker implements WorkerLike {
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('ProcessHandle.send (Worker-backed) — sealed-union split', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => new StubWorker());
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
  });

  it('does not expose .send on WorkerProcessHandle (type-level)', () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    // Type-narrowing: the Worker branch carries `ports`, no `send`.
    if (handle.kind === 'worker') {
      expect(handle.ports).toBeDefined();
      // @ts-expect-error — `send` is intentionally absent from WorkerProcessHandle.
      handle.send;
    }
    handle.kill('SIGTERM');
  });
});
