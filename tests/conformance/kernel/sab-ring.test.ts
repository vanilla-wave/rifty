/**
 * Conformance test for ADR-0011 phase 1 — SAB ring exercised across a real
 * Worker realm.
 *
 * The fixture worker uses the production caller-side primitive
 * (`Atomics.wait`) to block on incoming requests and `Atomics.notify` to
 * wake the parent's `waitReplyAsync` after each echo. This catches any
 * regression where the layout / state-slot semantics drift between the
 * `SabRing` class (TS) and a hand-written peer (JS fixture).
 *
 * Skipped when the host lacks SAB (no `SharedArrayBuffer` constructor or
 * no `Atomics.waitAsync`). Vitest's Node environment normally satisfies
 * both, so this stays alive in CI.
 */
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SYNC_RPC_PROTOCOL_VERSION } from '../../../packages/kernel/src/ipc/sync-rpc.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof Atomics !== 'undefined' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const fixtureUrl = new URL('./fixtures/sab-ring-echo.js', import.meta.url);
const contenderFixtureUrl = new URL('./fixtures/sab-ring-contender.js', import.meta.url);

interface ContenderMessage {
  readonly type: 'ready' | 'lost' | 'done';
  readonly role?: 'caller' | 'responder';
  readonly marker?: number;
  readonly state?: number;
  readonly reply?: number;
  readonly request?: number;
}

function observeContender(worker: Worker): {
  readonly ready: Promise<void>;
  readonly result: Promise<ContenderMessage>;
  readonly exit: Promise<void>;
} {
  let resolveReady: (() => void) | undefined;
  let resolveResult: ((message: ContenderMessage) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let rejectResult: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ContenderMessage>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const exit = new Promise<void>((resolve, reject) => {
    worker.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`SAB contender exited with code ${code}`));
    });
    worker.once('error', reject);
  });
  worker.on('message', (message: ContenderMessage) => {
    if (message.type === 'ready') resolveReady?.();
    else resolveResult?.(message);
  });
  worker.once('error', (error) => {
    rejectReady?.(error);
    rejectResult?.(error);
  });
  return { ready, result, exit };
}

function startContenders(startSab: SharedArrayBuffer): void {
  const start = new Int32Array(startSab);
  Atomics.store(start, 0, 1);
  Atomics.notify(start, 0);
}

async function readPublishedRequest(ring: SabRing, timeoutMs: number): Promise<Uint8Array> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const request = ring.readRequest();
    if (request !== null) return request;

    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) throw new Error(`SAB request timed out after ${timeoutMs}ms`);
    const arm = ring.armRequest(remainingMs);
    const wake = arm.async ? await arm.value : arm.value;
    if (wake === 'timed-out') throw new Error(`SAB request timed out after ${timeoutMs}ms`);
  }
}

// Real-Worker lifecycle (spawn + 4 cross-thread Atomics round-trips + join) is
// load-sensitive: under a fully-loaded CI runner the worker's startup/exit can
// stall past vitest's 5000ms default, yielding a flaky bare test-timeout (no
// assertion). Protocol correctness stays bounded by the inner waitReplyAsync(2000)
// — a genuine SAB deadlock still throws RingTimeoutError at 2s, not here.
const REAL_WORKER_TIMEOUT_MS = 30_000;

describe.skipIf(!hasSab)('SabRing — real Worker round-trip (ADR-0011 phase 1)', () => {
  it(
    'parent writes requests; worker echoes via Atomics.wait/notify on the SAB ring',
    async () => {
      const payloadCapacity = 1024;
      const { sab, ring } = createSabRing({ payloadCapacity });
      const successorPublicationGateSab = new SharedArrayBuffer(4);
      const successorPublicationGate = new Int32Array(successorPublicationGateSab);
      expect(sab.byteLength).toBe(SAB_RING_HEADER_BYTES + payloadCapacity * 2);

      const worker = new Worker(fileURLToPath(fixtureUrl), {
        workerData: {
          sab,
          payloadCapacity,
          protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
          successorPublicationGateSab,
        },
      });
      const exitPromise = new Promise<void>((resolve, reject) => {
        worker.once('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`sab-ring fixture exited with code ${code}`));
        });
        worker.once('error', reject);
      });

      // Wait for the fixture to signal it's installed and looping.
      await new Promise<void>((resolve, reject) => {
        worker.once('message', (msg) => {
          if (msg?.type === 'ready') resolve();
          else reject(new Error(`unexpected worker message: ${JSON.stringify(msg)}`));
        });
        worker.once('error', reject);
      });

      const firstReplyPublished = new Promise<void>((resolve, reject) => {
        worker.once('message', (msg) => {
          if (msg?.type === 'reply-published') resolve();
          else reject(new Error(`unexpected worker message: ${JSON.stringify(msg)}`));
        });
        worker.once('error', reject);
      });

      // Three sequential request/reply cycles.
      const payloads = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([42]),
        new Uint8Array([0xff, 0x00, 0x10, 0x20, 0x40]),
      ];
      for (const [index, payload] of payloads.entries()) {
        ring.writeRequest(payload);
        if (index === 0) await firstReplyPublished;
        if (index === 1) {
          Atomics.store(successorPublicationGate, 0, 1);
          Atomics.notify(successorPublicationGate, 0);
        }
        const reply = await ring.waitReplyAsync(2000);
        expect(Array.from(reply)).toEqual(Array.from(payload));
      }

      // Shutdown handshake: empty payload tells the fixture to exit.
      ring.writeRequest(new Uint8Array(0));
      const finalReply = await ring.waitReplyAsync(2000);
      expect(finalReply.byteLength).toBe(0);

      await exitPromise;
    },
    REAL_WORKER_TIMEOUT_MS,
  );

  it('responder side: parent attaches a SabRing peer, polls, and replies', () => {
    // Pure in-realm sanity round-trip — the conformance test above already
    // covers cross-realm. This guards the layout constants when a downstream
    // package wires SabRing.attach() directly.
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    caller.writeRequest(new Uint8Array([7, 8, 9]));
    const got = responder.readRequest();
    expect(got).not.toBeNull();
    responder.writeReply(new Uint8Array((got ?? []).map((b) => b * 2)));
    // The caller side would use waitReply (sync) from a Worker, but in this
    // realm we exercise the async sibling.
    return caller.waitReplyAsync(500).then((reply) => {
      expect(Array.from(reply)).toEqual([14, 16, 18]);
    });
  });

  it(
    'two real callers race IDLE→WRITING; one coherent request wins',
    async () => {
      const payloadCapacity = 64;
      const { sab, ring: responder } = createSabRing({ payloadCapacity });
      const startSab = new SharedArrayBuffer(4);
      const attemptsSab = new SharedArrayBuffer(4);
      const workers = [11, 22].map(
        (marker) =>
          new Worker(fileURLToPath(contenderFixtureUrl), {
            workerData: {
              role: 'caller',
              sab,
              payloadCapacity,
              protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
              startSab,
              attemptsSab,
              marker,
            },
          }),
      );
      const observed = workers.map(observeContender);
      await Promise.all(observed.map(({ ready }) => ready));
      startContenders(startSab);

      const request = await readPublishedRequest(responder, 2_000);
      expect(request.byteLength).toBe(1);
      responder.writeReply(new Uint8Array([request[0] ?? 0]));

      const results = await Promise.all(observed.map(({ result }) => result));
      expect(results.filter(({ type }) => type === 'done')).toHaveLength(1);
      expect(results.filter(({ type }) => type === 'lost')).toHaveLength(1);
      const winner = results.find(({ type }) => type === 'done');
      expect(winner?.reply).toBe(winner?.marker);
      await Promise.all(observed.map(({ exit }) => exit));
    },
    REAL_WORKER_TIMEOUT_MS,
  );

  it(
    'two real responders race READY→HANDLING; one dispatcher wins',
    async () => {
      const payloadCapacity = 64;
      const { sab, ring: caller } = createSabRing({ payloadCapacity });
      const startSab = new SharedArrayBuffer(4);
      const attemptsSab = new SharedArrayBuffer(4);
      const workers = [1, 2].map(
        (marker) =>
          new Worker(fileURLToPath(contenderFixtureUrl), {
            workerData: {
              role: 'responder',
              sab,
              payloadCapacity,
              protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
              startSab,
              attemptsSab,
              marker,
            },
          }),
      );
      const observed = workers.map(observeContender);
      await Promise.all(observed.map(({ ready }) => ready));
      caller.writeRequest(new Uint8Array([7]));
      startContenders(startSab);

      expect(Array.from(await caller.waitReplyAsync(2_000))).toEqual([17]);
      const results = await Promise.all(observed.map(({ result }) => result));
      expect(results.filter(({ type }) => type === 'done')).toHaveLength(1);
      expect(results.filter(({ type }) => type === 'lost')).toHaveLength(1);
      expect(results.find(({ type }) => type === 'done')?.request).toBe(7);
      await Promise.all(observed.map(({ exit }) => exit));
    },
    REAL_WORKER_TIMEOUT_MS,
  );
});
