import type { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REAL_WORKER_TEST_TIMEOUT_MS, runRealWorkerLifecycle } from './real-worker-lifecycle.ts';

function waitForMessage(worker: Worker): Promise<unknown> {
  return new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      reject(new Error(`real Worker exited with code ${code} before message`));
    });
  });
}

describe('real Worker lifecycle owner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'requires a clean physical exit after the observed result',
    async () => {
      await runRealWorkerLifecycle(async (scope) => {
        const worker = scope.spawn(
          `const { parentPort } = require('node:worker_threads'); parentPort.postMessage('ok');`,
          { eval: true },
        );
        await expect(waitForMessage(worker)).resolves.toBe('ok');
      });
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'rejects a fatal Worker error that follows an observed result',
    async () => {
      await expect(
        runRealWorkerLifecycle(async (scope) => {
          const worker = scope.spawn(
            `const { parentPort } = require('node:worker_threads'); parentPort.postMessage('ok'); setImmediate(() => { throw new Error('fatal after reply'); });`,
            { eval: true },
          );
          await expect(waitForMessage(worker)).resolves.toBe('ok');
        }),
      ).rejects.toThrow('fatal after reply');
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'terminates an earlier Worker when a later constructor throws',
    async () => {
      let first: Worker | undefined;
      await expect(
        runRealWorkerLifecycle(async (scope) => {
          const waitSab = new SharedArrayBuffer(4);
          first = scope.spawn(
            `const { workerData } = require('node:worker_threads'); Atomics.wait(new Int32Array(workerData), 0, 0);`,
            { eval: true, workerData: waitSab },
          );
          scope.spawn('void 0', { eval: true, workerData: () => undefined });
        }),
      ).rejects.toThrow();
      expect(first?.threadId).toBe(-1);
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'cuts off an operation early enough to reserve bounded cleanup time',
    async () => {
      vi.useFakeTimers();
      const lifecycle = runRealWorkerLifecycle(() => new Promise<never>(() => undefined));
      const rejection = expect(lifecycle).rejects.toThrow(
        'real Worker operation exceeded its 30000ms lifecycle',
      );
      await vi.advanceTimersByTimeAsync(25_000);
      await rejection;
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'rejects a late spawn after the operation deadline closes admission',
    async () => {
      vi.useFakeTimers();
      let resume: (() => void) | undefined;
      let lateSpawnError: Error | undefined;
      const operationGate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const lifecycle = runRealWorkerLifecycle(async (scope) => {
        await operationGate;
        try {
          scope.spawn('void 0', { eval: true });
        } catch (error) {
          lateSpawnError = error instanceof Error ? error : new Error(String(error));
        }
      });
      const rejection = expect(lifecycle).rejects.toThrow(
        'real Worker operation exceeded its 30000ms lifecycle',
      );
      await vi.advanceTimersByTimeAsync(25_000);
      await rejection;
      resume?.();
      await Promise.resolve();
      expect(lateSpawnError?.message).toBe('real Worker lifecycle is closed to new spawns');
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );
});
