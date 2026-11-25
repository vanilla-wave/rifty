/**
 * ADR-0576 fault rows on the real SAB sync-RPC ring (fault-classes.md, SAB
 * row): a positional `readSync` over the ring keeps the ring's model — an
 * oversize reply is an in-band error, responder death in `HANDLING` is a loud
 * permanent wedge (no timeout), a second caller fails at its claim — and no
 * partial bytes ever reach the caller's buffer.
 */
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SyncRpcDispatcher } from '../../../packages/kernel/src/ipc/sync-dispatch.ts';
import { installRuntimeJsFsHandlers } from '../../../packages/runtime-js/src/ipc/fs-handlers.ts';
import { MemoryFsSync } from '../../../packages/vfs/src/sync-mirror.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const readerUrl = new URL('./fixtures/fs-range-reader.ts', import.meta.url);
const ownerUrl = new URL('./fixtures/fs-range-owner.ts', import.meta.url);
const STATE_HANDLING = 2;
const MARK = 0x2e;
const PATH = '/data/f.bin';

interface Message {
  readonly type: string;
  readonly n?: number;
  readonly message?: string;
}

const live: Worker[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((worker) => worker.terminate()));
});

function spawn(
  url: URL,
  workerData: unknown,
): { worker: Worker; messages: Message[]; next: (type: string) => Promise<Message> } {
  const worker = new Worker(fileURLToPath(url), { workerData, execArgv: ['--import', 'tsx'] });
  live.push(worker);
  const messages: Message[] = [];
  const waiters: Array<{ type: string; resolve: (m: Message) => void }> = [];
  worker.on('message', (message: Message) => {
    messages.push(message);
    for (const waiter of waiters.splice(0)) {
      if (waiter.type === message.type) waiter.resolve(message);
      else waiters.push(waiter);
    }
  });
  worker.on('error', (error) => messages.push({ type: 'worker-error', message: String(error) }));
  const next = (type: string) =>
    new Promise<Message>((resolve) => {
      const seen = messages.find((m) => m.type === type);
      if (seen) resolve(seen);
      else waiters.push({ type, resolve });
    });
  return { worker, messages, next };
}

describe.skipIf(!hasSab)('positional readSync over a real SAB ring — fault rows', () => {
  it('an oversize range reply is the in-band error; no partial bytes; the ring stays usable', async () => {
    const payloadCapacity = 16 * 1024;
    const { sab, ring } = createSabRing({ payloadCapacity });
    const store = new MemoryFsSync();
    store.mkdirSync('/data', { recursive: true });
    const file = Uint8Array.from({ length: 64 * 1024 }, (_, i) => i % 251);
    store.writeFileSync(PATH, file);
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
    installRuntimeJsFsHandlers(dispatcher, () => store);
    dispatcher.attach(ring);
    const bufferSab = new SharedArrayBuffer(64 * 1024);
    const buffer = new Uint8Array(bufferSab).fill(MARK);
    try {
      const reader = spawn(readerUrl, {
        sab,
        payloadCapacity,
        bufferSab,
        path: PATH,
        reads: [
          { offset: 0, length: 8192, position: 0 },
          { offset: 16384, length: 32768, position: 0 },
          { offset: 8192, length: 4096, position: 100 },
        ],
      });
      await reader.next('done');
      const results = reader.messages.filter((m) => m.type === 'read' || m.type === 'error');
      expect(results[0]).toEqual({ type: 'read', n: 8192 });
      expect(results[1]?.type).toBe('error');
      expect(results[1]?.message).toMatch(/fs\.readChunk|capacity|too large/i);
      expect(results[2]).toEqual({ type: 'read', n: 4096 });
      expect(Array.from(buffer.subarray(0, 8192))).toEqual(Array.from(file.subarray(0, 8192)));
      expect(buffer.subarray(16384, 16384 + 32768).every((b) => b === MARK)).toBe(true);
      expect(Array.from(buffer.subarray(8192, 8192 + 4096))).toEqual(
        Array.from(file.subarray(100, 4196)),
      );
    } finally {
      dispatcher.detachAll();
    }
  }, 30_000);

  it('owner death in HANDLING: a permanent wedge until teardown, a second caller fails at its claim, no bytes', async () => {
    const payloadCapacity = 1024 * 1024;
    const { sab } = createSabRing({ payloadCapacity });
    const gateSab = new SharedArrayBuffer(4);
    const bufferSab = new SharedArrayBuffer(8192);
    const buffer = new Uint8Array(bufferSab).fill(MARK);
    const owner = spawn(ownerUrl, { sab, payloadCapacity, gateSab, path: PATH, size: 64 * 1024 });
    await owner.next('ready');
    const reader = spawn(readerUrl, {
      sab,
      payloadCapacity,
      bufferSab,
      path: PATH,
      reads: [{ offset: 0, length: 4096, position: 0 }],
    });
    await reader.next('opened');
    await owner.next('handling');
    await owner.worker.terminate();

    // No timeout exists in production: the caller stays blocked, its buffer untouched.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reader.messages.map((m) => m.type)).toEqual(['opened']);
    expect(buffer.every((b) => b === MARK)).toBe(true);
    const header = new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2);
    expect(Atomics.load(header, 1)).toBe(STATE_HANDLING);
    // The wedge is loud: a second caller fails at its claim.
    expect(() => SabRing.attach(sab, payloadCapacity).writeRequest(new Uint8Array([1]))).toThrow(
      /previous request is being handled/,
    );
    // Teardown is the only exit.
    await reader.worker.terminate();
    expect(reader.messages.map((m) => m.type)).toEqual(['opened']);
    expect(buffer.every((b) => b === MARK)).toBe(true);
  }, 30_000);
});
