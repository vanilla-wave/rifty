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
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createSabRing } from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcDispatcher } from '../../../packages/kernel/src/ipc/sync-dispatch.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof Atomics !== 'undefined' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const fixtureUrl = new URL('./fixtures/sync-rpc-echo.js', import.meta.url);

interface WorkerReply {
  readonly type: 'reply' | 'error';
  readonly reply?: { readonly ok: boolean; readonly value?: unknown };
  readonly message?: string;
}

describe.skipIf(!hasSab)('SyncRpc — real Worker round-trip (ADR-0011 phase 3)', () => {
  it('client writes JSON request; dispatcher echoes; client decodes value', async () => {
    const payloadCapacity = 1024;
    const { sab, ring } = createSabRing({ payloadCapacity });

    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
    dispatcher.register('echo', (p) => p);
    dispatcher.attach(ring);

    const worker = new Worker(fileURLToPath(fixtureUrl), {
      workerData: {
        sab,
        payloadCapacity,
        method: 'echo',
        payload: { hello: 'world', n: 42 },
        timeoutMs: 2000,
      },
    });

    const msg = await new Promise<WorkerReply>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });

    dispatcher.detachAll();
    await worker.terminate();

    expect(msg.type).toBe('reply');
    expect(msg.reply?.ok).toBe(true);
    expect(msg.reply?.value).toEqual({ hello: 'world', n: 42 });
  });

  it('dispatcher reports unknown method as ok=false with ERPCNOHANDLER', async () => {
    const payloadCapacity = 256;
    const { sab, ring } = createSabRing({ payloadCapacity });

    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
    dispatcher.attach(ring);

    const worker = new Worker(fileURLToPath(fixtureUrl), {
      workerData: {
        sab,
        payloadCapacity,
        method: 'doesNotExist',
        payload: null,
        timeoutMs: 2000,
      },
    });

    const msg = await new Promise<WorkerReply>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });

    dispatcher.detachAll();
    await worker.terminate();

    expect(msg.type).toBe('reply');
    expect(msg.reply?.ok).toBe(false);
    const errorShape = (msg.reply as { error?: { code?: string; message?: string } } | undefined)
      ?.error;
    expect(errorShape?.code).toBe('ERPCNOHANDLER');
    expect(errorShape?.message ?? '').toContain('doesNotExist');
  });
});
