/**
 * Conformance test for ADR-0011 phase 3 — JSON-over-UTF-8 RPC framing
 * exercised across a real Worker realm.
 *
 * The fixture worker plays the role of `SyncRpcClient`: it writes a
 * JSON-encoded request into the SAB ring, `Atomics.wait`s for the reply,
 * decodes the JSON, and posts the parsed `value` back via `parentPort`.
 *
 * The parent side wires a `SyncRpcDispatcher` with an `'echo'` handler
 * that returns its payload verbatim. This proves end-to-end that the
 * framing in `sync-rpc.ts` matches both the dispatcher's writer and the
 * client's reader.
 *
 * Skipped when SAB is unavailable (Node missing `Atomics.waitAsync`).
 */
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createSabRing } from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcDispatcher } from '../../../packages/kernel/src/ipc/sync-dispatch.ts';
import { SYNC_RPC_PROTOCOL_VERSION } from '../../../packages/kernel/src/ipc/sync-rpc.ts';
import { REAL_WORKER_TEST_TIMEOUT_MS, runRealWorkerLifecycle } from './real-worker-lifecycle.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof Atomics !== 'undefined' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const fixtureUrl = new URL('./fixtures/sync-rpc-echo.js', import.meta.url);
const productionClientUrl = new URL('./fixtures/sync-rpc-production-client.ts', import.meta.url);

interface WorkerReply {
  readonly type: 'reply' | 'error';
  readonly reply?: { readonly ok: boolean; readonly value?: unknown };
  readonly replies?: ReadonlyArray<{ readonly ok: boolean; readonly value?: unknown }>;
  readonly message?: string;
}

function observeWorkerReply(worker: Worker): Promise<WorkerReply> {
  return new Promise<WorkerReply>((resolve, reject) => {
    let settled = false;
    worker.once('message', (message: WorkerReply) => {
      settled = true;
      resolve(message);
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`sync-rpc fixture exited with code ${code} before reply`));
    });
  });
}

describe.skipIf(!hasSab)('SyncRpc — real Worker round-trip (ADR-0011 phase 3)', () => {
  it(
    'client completes two claimed JSON exchanges on one ring',
    async () => {
      const payloadCapacity = 1024;
      const { sab, ring } = createSabRing({ payloadCapacity });

      const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
      try {
        await runRealWorkerLifecycle(async (scope) => {
          dispatcher.register('echo', (p) => p);
          dispatcher.attach(ring);
          const worker = scope.spawn(fileURLToPath(fixtureUrl), {
            workerData: {
              sab,
              payloadCapacity,
              requests: [
                { method: 'echo', payload: { hello: 'world', n: 42 } },
                { method: 'echo', payload: { hello: 'again', n: 43 } },
              ],
              protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
            },
          });
          const msg = await observeWorkerReply(worker);
          expect(msg.type).toBe('reply');
          expect(msg.reply?.ok).toBe(true);
          expect(msg.reply?.value).toEqual({ hello: 'world', n: 42 });
          expect(msg.replies).toEqual([
            { ok: true, value: { hello: 'world', n: 42 } },
            { ok: true, value: { hello: 'again', n: 43 } },
          ]);
        });
      } finally {
        dispatcher.detachAll();
      }
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'dispatcher reports unknown method as ok=false with ERPCNOHANDLER',
    async () => {
      const payloadCapacity = 256;
      const { sab, ring } = createSabRing({ payloadCapacity });

      const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
      try {
        await runRealWorkerLifecycle(async (scope) => {
          dispatcher.attach(ring);
          const worker = scope.spawn(fileURLToPath(fixtureUrl), {
            workerData: {
              sab,
              payloadCapacity,
              method: 'doesNotExist',
              payload: null,
              protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
            },
          });
          const msg = await observeWorkerReply(worker);
          expect(msg.type).toBe('reply');
          expect(msg.reply?.ok).toBe(false);
          const errorShape = (
            msg.reply as { error?: { code?: string; message?: string } } | undefined
          )?.error;
          expect(errorShape?.code).toBe('ERPCNOHANDLER');
          expect(errorShape?.message ?? '').toContain('doesNotExist');
        });
      } finally {
        dispatcher.detachAll();
      }
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'hand-written and production clients each complete JSON→binary→JSON on one ring',
    async () => {
      const payloadCapacity = 1024;
      const { sab, ring } = createSabRing({ payloadCapacity });
      const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
      const register = dispatcher.register as unknown as (
        method: string,
        handler: (payload: unknown) => unknown,
        options: { decodeBinaryRequest: (payload: Uint8Array) => unknown },
      ) => void;
      try {
        await runRealWorkerLifecycle(async (scope) => {
          register.call(dispatcher, 'binary-echo', (payload) => payload, {
            decodeBinaryRequest: (payload) => ({ bytes: [...payload] }),
          });
          register.call(
            dispatcher,
            'binary-failure',
            () => {
              throw Object.assign(new Error('injected production binary failure'), {
                code: 'EBINARYFAIL',
              });
            },
            { decodeBinaryRequest: (payload) => payload },
          );
          dispatcher.register('echo', (payload) => payload);
          dispatcher.attach(ring);
          const worker = scope.spawn(fileURLToPath(fixtureUrl), {
            workerData: {
              sab,
              payloadCapacity,
              requests: [
                { method: 'echo', payload: { sequence: 1 } },
                { method: 'binary-echo', binaryPayload: [0xff, 0x00, 0x7f] },
                { method: 'binary-failure', binaryPayload: [1] },
                { method: 'echo', payload: { sequence: 3 } },
              ],
              timeoutMs: 2000,
              protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
            },
          });
          const msg = await observeWorkerReply(worker);
          expect(msg.replies).toEqual([
            { ok: true, value: { sequence: 1 } },
            { ok: true, value: { bytes: [0xff, 0x00, 0x7f] } },
            {
              ok: false,
              error: {
                name: 'Error',
                message: 'injected production binary failure',
                code: 'EBINARYFAIL',
              },
            },
            { ok: true, value: { sequence: 3 } },
          ]);

          const production = createSabRing({ payloadCapacity });
          dispatcher.attach(production.ring);
          const productionWorker = scope.spawn(fileURLToPath(productionClientUrl), {
            workerData: { sab: production.sab, payloadCapacity },
            execArgv: ['--import', 'tsx'],
          });
          const productionMessage = await observeWorkerReply(productionWorker);
          expect(productionMessage).toEqual({
            type: 'reply',
            replies: [
              { sequence: 1 },
              { bytes: [0xff, 0x00, 0x7f] },
              {
                name: 'Error',
                message: 'injected production binary failure',
                code: 'EBINARYFAIL',
              },
              { sequence: 3 },
            ],
          });
        });
      } finally {
        dispatcher.detachAll();
      }
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );
});
