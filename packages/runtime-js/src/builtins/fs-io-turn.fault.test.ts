/**
 * Fault matrix of unit runtime-js/fs-callbacks-io-turn on the Workbench transport: a real
 * SAB sync-RPC ring between a kernel child (worker_threads + the production client) and
 * a responder on this thread (the production dispatcher and fs handlers, or none).
 */
import { Worker } from 'node:worker_threads';
import { SyncRpcDispatcher, createSabRing } from '@riftydev/kernel';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { installRuntimeJsFsHandlers } from '../ipc/fs-handlers.ts';

const HELPER = new URL('./fs-io-turn.fault-worker.test-helper.ts', import.meta.url);
const CAPACITY = 64 * 1024;
let live: Worker | undefined;

afterEach(async () => {
  await live?.terminate();
  live = undefined;
});

function child(mode: string, sab: SharedArrayBuffer) {
  const messages: unknown[] = [];
  const worker = new Worker(HELPER, {
    execArgv: ['--import', 'tsx'],
    workerData: { sab, capacity: CAPACITY, mode },
  });
  live = worker;
  const seen = (want: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      const check = () => {
        if (messages.some((m) => JSON.stringify(m) === JSON.stringify(want))) resolve();
      };
      worker.on('message', (m) => {
        messages.push(m);
        check();
      });
      worker.on('error', reject);
      check();
    });
  return { worker, messages, seen };
}

const quiet = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('fs callbacks over a SAB sync-RPC ring (Workbench transport)', () => {
  it('an oversize reply reaches the callback as an error, in its I/O turn', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: CAPACITY });
    const owner = new MemoryFsSync();
    owner.mkdirSync('/data', { recursive: true });
    owner.writeFileSync('/data/big.bin', new Uint8Array(2 * CAPACITY));
    const dispatcher = new SyncRpcDispatcher();
    installRuntimeJsFsHandlers(dispatcher, () => owner);
    dispatcher.attach(ring);
    try {
      const { messages, seen } = child('oversize', sab);
      await seen('immediate queued before the call');
      await quiet(300);
      const callbacks = messages.filter((m) => String(m).startsWith('callback'));
      expect(callbacks).toEqual([expect.stringMatching(/^callback error: .*exceeds capacity/)]);
      // The call returned first; the immediate queued before it ran before the callback.
      expect(messages.indexOf('submitted')).toBeLessThan(
        messages.indexOf('immediate queued before the call'),
      );
      expect(messages.indexOf('immediate queued before the call')).toBeLessThan(
        messages.indexOf(callbacks[0]),
      );
    } finally {
      dispatcher.detach(ring);
    }
  }, 30_000);

  it('a responder dead in HANDLING: the caller stays blocked, no callback runs', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: CAPACITY });
    const { worker, messages, seen } = child('dead', sab);
    await seen('submitted');
    // The responder takes the request and dies: no reply is ever written.
    let request: Uint8Array | null = null;
    for (let i = 0; i < 200 && request === null; i++) {
      request = ring.readRequest();
      if (request === null) await quiet(10);
    }
    expect(request).not.toBeNull();
    await quiet(500);
    expect(messages).toEqual(['submitted']);
    // Blocked in `Atomics.wait`: the thread runs nothing until owner teardown.
    expect(await worker.terminate()).toBe(1);
  }, 30_000);

  it('a responder dead at the process end: exit blocks on the submitted op (no exit request, no callback)', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: CAPACITY });
    const { worker, messages, seen } = child('dead-exit', sab);
    await seen('exiting');
    // `exit()` runs the submitted `stat` (Node joins its threadpool): its exchange is the
    // request the dead responder took; the exit request never goes out.
    let request: Uint8Array | null = null;
    for (let i = 0; i < 200 && request === null; i++) {
      request = ring.readRequest();
      if (request === null) await quiet(10);
    }
    expect(request).not.toBeNull();
    await quiet(500);
    expect(messages).toEqual(['exiting']);
    expect(await worker.terminate()).toBe(1);
  }, 30_000);
});
