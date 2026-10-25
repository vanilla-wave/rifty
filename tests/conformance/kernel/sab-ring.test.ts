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
import type { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SYNC_RPC_PROTOCOL_VERSION } from '../../../packages/kernel/src/ipc/sync-rpc.ts';
import { REAL_WORKER_TEST_TIMEOUT_MS, runRealWorkerLifecycle } from './real-worker-lifecycle.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof Atomics !== 'undefined' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const fixtureUrl = new URL('./fixtures/sab-ring-echo.js', import.meta.url);
const contenderFixtureUrl = new URL('./fixtures/sab-ring-contender.js', import.meta.url);
const STATE_READY = 1;
const STATE_HANDLING = 2;
const STATE_WRITING = 3;

interface ContenderMessage {
  readonly type:
    | 'ready'
    | 'admission-blocked'
    | 'attempted'
    | 'request-published'
    | 'lost'
    | 'done';
  readonly role?: 'caller' | 'responder';
  readonly marker?: number;
  readonly state?: number;
  readonly reply?: number;
  readonly request?: number;
}

function observeContender(worker: Worker): {
  readonly ready: Promise<void>;
  readonly admissionBlocked: Promise<ContenderMessage>;
  readonly attempted: Promise<ContenderMessage>;
  readonly published: Promise<ContenderMessage>;
  readonly result: Promise<ContenderMessage>;
} {
  let readySettled = false;
  let admissionBlockedSettled = false;
  let attemptedSettled = false;
  let publishedSettled = false;
  let resultSettled = false;
  let resolveReady: (() => void) | undefined;
  let resolveAdmissionBlocked: ((message: ContenderMessage) => void) | undefined;
  let resolveAttempted: ((message: ContenderMessage) => void) | undefined;
  let resolvePublished: ((message: ContenderMessage) => void) | undefined;
  let resolveResult: ((message: ContenderMessage) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let rejectAdmissionBlocked: ((error: Error) => void) | undefined;
  let rejectAttempted: ((error: Error) => void) | undefined;
  let rejectPublished: ((error: Error) => void) | undefined;
  let rejectResult: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ContenderMessage>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const admissionBlocked = new Promise<ContenderMessage>((resolve, reject) => {
    resolveAdmissionBlocked = resolve;
    rejectAdmissionBlocked = reject;
  });
  const attempted = new Promise<ContenderMessage>((resolve, reject) => {
    resolveAttempted = resolve;
    rejectAttempted = reject;
  });
  const published = new Promise<ContenderMessage>((resolve, reject) => {
    resolvePublished = resolve;
    rejectPublished = reject;
  });
  worker.on('message', (message: ContenderMessage) => {
    if (message.type === 'ready') {
      readySettled = true;
      resolveReady?.();
    } else if (message.type === 'admission-blocked') {
      admissionBlockedSettled = true;
      resolveAdmissionBlocked?.(message);
    } else if (message.type === 'attempted') {
      attemptedSettled = true;
      resolveAttempted?.(message);
    } else if (message.type === 'request-published') {
      publishedSettled = true;
      resolvePublished?.(message);
    } else {
      resultSettled = true;
      resolveResult?.(message);
    }
  });
  worker.once('error', (error) => {
    if (!readySettled) rejectReady?.(error);
    if (!admissionBlockedSettled) rejectAdmissionBlocked?.(error);
    if (!attemptedSettled) rejectAttempted?.(error);
    if (!publishedSettled) rejectPublished?.(error);
    if (!resultSettled) rejectResult?.(error);
  });
  worker.once('exit', () => {
    const error = new Error('SAB contender exited before every observed phase');
    if (!readySettled) rejectReady?.(error);
    if (!admissionBlockedSettled) rejectAdmissionBlocked?.(error);
    if (!attemptedSettled) rejectAttempted?.(error);
    if (!publishedSettled) rejectPublished?.(error);
    if (!resultSettled) rejectResult?.(error);
  });
  for (const promise of [ready, admissionBlocked, attempted, published, result]) {
    void promise.catch(() => undefined);
  }
  return {
    ready,
    admissionBlocked,
    attempted,
    published,
    result,
  };
}

function startContenders(startSab: SharedArrayBuffer): void {
  const start = new Int32Array(startSab);
  Atomics.store(start, 0, 1);
  Atomics.notify(start, 0);
}

interface EchoWorkerMessage {
  readonly type: 'ready' | 'reply-published';
  readonly sequence?: number;
}

function waitForEchoMessage(
  worker: Worker,
  type: EchoWorkerMessage['type'],
  sequence?: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (message: EchoWorkerMessage): void => {
      cleanup();
      if (message.type === type && (sequence === undefined || message.sequence === sequence)) {
        resolve();
      } else {
        reject(new Error(`unexpected worker message: ${JSON.stringify(message)}`));
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`sab-ring fixture exited with code ${code} before ${type}`));
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
}

function sink<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

describe.skipIf(!hasSab)('SabRing — real Worker round-trip (ADR-0011 phase 1)', () => {
  it(
    'parent writes requests; worker echoes via Atomics.wait/notify on the SAB ring',
    async () => {
      const payloadCapacity = 1024;
      const { sab, ring } = createSabRing({ payloadCapacity });
      const successorPublicationGateSab = new SharedArrayBuffer(4);
      const successorPublicationGate = new Int32Array(successorPublicationGateSab);
      expect(sab.byteLength).toBe(SAB_RING_HEADER_BYTES + payloadCapacity * 2);

      await runRealWorkerLifecycle(async (scope) => {
        const worker = scope.spawn(fileURLToPath(fixtureUrl), {
          workerData: {
            sab,
            payloadCapacity,
            protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
            successorPublicationGateSab,
          },
        });
        try {
          await waitForEchoMessage(worker, 'ready');

          // Three sequential request/reply cycles. The fixture's phase message
          // proves publication; zero-wait then exercises the production
          // consumer without assigning Worker scheduling to the protocol
          // deadline.
          const payloads = [
            new Uint8Array([1, 2, 3]),
            new Uint8Array([42]),
            new Uint8Array([0xff, 0x00, 0x10, 0x20, 0x40]),
          ];
          for (const [index, payload] of payloads.entries()) {
            const replyPublished = sink(waitForEchoMessage(worker, 'reply-published', index));
            ring.writeRequest(payload);
            if (index === 1) {
              Atomics.store(successorPublicationGate, 0, 1);
              Atomics.notify(successorPublicationGate, 0);
            }
            await replyPublished;
            const reply = await ring.waitReplyAsync(0);
            expect(Array.from(reply)).toEqual(Array.from(payload));
          }

          const shutdownPublished = sink(
            waitForEchoMessage(worker, 'reply-published', payloads.length),
          );
          ring.writeRequest(new Uint8Array(0));
          await shutdownPublished;
          const finalReply = await ring.waitReplyAsync(0);
          expect(finalReply.byteLength).toBe(0);
        } finally {
          Atomics.store(successorPublicationGate, 0, 1);
          Atomics.notify(successorPublicationGate, 0);
        }
      });
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
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
      await runRealWorkerLifecycle(async (scope) => {
        const observed: ReturnType<typeof observeContender>[] = [];
        try {
          for (const marker of [11, 22]) {
            const worker = scope.spawn(fileURLToPath(contenderFixtureUrl), {
              workerData: {
                role: 'caller',
                sab,
                payloadCapacity,
                protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
                startSab,
                attemptsSab,
                marker,
              },
            });
            observed.push(observeContender(worker));
          }
          await Promise.all(observed.map(({ ready }) => ready));
          startContenders(startSab);

          await Promise.any(observed.map(({ published }) => published));
          const request = responder.readRequest();
          expect(request).not.toBeNull();
          expect(request?.byteLength).toBe(1);
          responder.writeReply(new Uint8Array([request?.[0] ?? 0]));

          const results = await Promise.all(observed.map(({ result }) => result));
          expect(results.filter(({ type }) => type === 'done')).toHaveLength(1);
          expect(results.filter(({ type }) => type === 'lost')).toHaveLength(1);
          const winner = results.find(({ type }) => type === 'done');
          const loser = results.find(({ type }) => type === 'lost');
          expect(winner?.reply).toBe(winner?.marker);
          expect(loser?.state).toBe(STATE_WRITING);
        } finally {
          startContenders(startSab);
        }
      });
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'two real responders race READY→HANDLING; one dispatcher wins',
    async () => {
      const payloadCapacity = 64;
      const { sab, ring: caller } = createSabRing({ payloadCapacity });
      const startSab = new SharedArrayBuffer(4);
      const attemptsSab = new SharedArrayBuffer(4);
      const admissionGateSab = new SharedArrayBuffer(4);
      const admissionGate = new Int32Array(admissionGateSab);
      await runRealWorkerLifecycle(async (scope) => {
        const observed: ReturnType<typeof observeContender>[] = [];
        try {
          for (const marker of [1, 2]) {
            const worker = scope.spawn(fileURLToPath(contenderFixtureUrl), {
              workerData: {
                role: 'responder',
                sab,
                payloadCapacity,
                protocolVersion: SYNC_RPC_PROTOCOL_VERSION,
                startSab,
                attemptsSab,
                admissionGateSab,
                gatedMarker: 2,
                marker,
              },
            });
            observed.push(observeContender(worker));
          }
          await Promise.all(observed.map(({ ready }) => ready));
          caller.writeRequest(new Uint8Array([7]));
          startContenders(startSab);
          let resultsSettled = false;
          const resultsPromise = sink(Promise.all(observed.map(({ result }) => result)));
          void resultsPromise.then(
            () => {
              resultsSettled = true;
            },
            () => {
              resultsSettled = true;
            },
          );

          const blocked = await observed[1]?.admissionBlocked;
          expect(blocked?.marker).toBe(2);
          const admitted = await observed[0]?.attempted;
          expect(admitted?.marker).toBe(1);
          expect(admitted?.state).toBe(STATE_READY);
          expect(Atomics.load(new Int32Array(attemptsSab), 0)).toBe(1);
          expect(Atomics.load(new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2), 1)).toBe(
            STATE_HANDLING,
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(resultsSettled).toBe(false);

          Atomics.store(admissionGate, 0, 1);
          Atomics.notify(admissionGate, 0);
          const results = await resultsPromise;
          expect(results.filter(({ type }) => type === 'done')).toHaveLength(1);
          expect(results.filter(({ type }) => type === 'lost')).toHaveLength(1);
          const winner = results.find(({ type }) => type === 'done');
          const loser = results.find(({ type }) => type === 'lost');
          expect(winner?.marker).toBe(1);
          expect(winner?.request).toBe(7);
          expect(loser?.marker).toBe(2);
          expect(loser?.state).toBe(STATE_HANDLING);
          expect(Array.from(await caller.waitReplyAsync(0))).toEqual([17]);
        } finally {
          startContenders(startSab);
          Atomics.store(admissionGate, 0, 1);
          Atomics.notify(admissionGate, 0);
        }
      });
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );
});
