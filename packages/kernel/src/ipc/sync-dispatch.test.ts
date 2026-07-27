/**
 * Unit tests for the event-driven dispatcher responder (ADR-0084 #17).
 *
 * The dispatcher arms `Atomics.waitAsync` on each ring's REQ_STATE slot so the
 * caller's `writeRequest` notify wakes it sub-ms — no busy-poll tick. A single
 * global backstop timer (50-100 ms) recovers missed notifies. When
 * `Atomics.waitAsync` is absent the dispatcher falls back to the legacy
 * `setInterval` poll.
 *
 * These run same-realm (no real Worker): the caller side drives
 * `waitReplyAsync`; the responder is the dispatcher. A HUGE backstop proves a
 * fast pump is the notify, not a tick. The cross-realm `Atomics.wait` path is
 * covered by `tests/conformance/kernel/sync-rpc.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SabRing, createSabRing } from './sab-ring.ts';
import { SyncRpcDispatcher } from './sync-dispatch.ts';
import { decodeReply, encodeRequest } from './sync-rpc.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Real Atomics.waitAsync probe — these tests assume the Node env has it. */
const hasWaitAsync =
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

describe.skipIf(!hasWaitAsync)('SyncRpcDispatcher — event-driven responder (ADR-0084 #17)', () => {
  it('wakes on Atomics.notify, not on a timer tick (huge backstop)', async () => {
    // Backstop so large a tick cannot explain a sub-second pump.
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('echo', (p) => p);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);

    const start = Date.now();
    caller.writeRequest(encodeRequest({ method: 'echo', payload: { x: 1 } }));
    const reply = await caller.waitReplyAsync(5_000);
    const elapsed = Date.now() - start;

    dispatcher.detachAll();
    expect(JSON.parse(new TextDecoder().decode(reply.subarray(1)))).toEqual({
      ok: true,
      value: { x: 1 },
    });
    // Serviced by the notify within a few ms — far under the 60 s backstop.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('event-driven mode keeps exactly one backstop timer (getActiveTimerCount === 1)', () => {
    const dispatcher = new SyncRpcDispatcher();
    const { ring } = createSabRing({ payloadCapacity: 64 });
    dispatcher.attach(ring);
    expect(dispatcher.getActiveTimerCount()).toBe(1);
    dispatcher.detachAll();
    expect(dispatcher.getActiveTimerCount()).toBe(0);
  });

  it('services back-to-back serialized round-trips via notify (re-arm after each reply)', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('inc', (p) => (p as number) + 1);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);

    for (let i = 0; i < 5; i++) {
      caller.writeRequest(encodeRequest({ method: 'inc', payload: i }));
      const reply = await caller.waitReplyAsync(5_000);
      expect(JSON.parse(new TextDecoder().decode(reply.subarray(1))).value).toBe(i + 1);
    }
    dispatcher.detachAll();
  });

  it('an async handler defers re-arm until the reply is written, then services the next request', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    // Async handler: the reply lands on a later microtask/macrotask. Re-arm must
    // wait for inFlight to clear, else the next request would be lost or spin.
    dispatcher.register('slow', async (p) => {
      await new Promise((r) => setTimeout(r, 10));
      return p;
    });
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);

    caller.writeRequest(encodeRequest({ method: 'slow', payload: 'a' }));
    expect(
      JSON.parse(new TextDecoder().decode((await caller.waitReplyAsync(5_000)).subarray(1))).value,
    ).toBe('a');
    // Second request after the first reply — re-armed correctly.
    caller.writeRequest(encodeRequest({ method: 'slow', payload: 'b' }));
    expect(
      JSON.parse(new TextDecoder().decode((await caller.waitReplyAsync(5_000)).subarray(1))).value,
    ).toBe('b');
    dispatcher.detachAll();
  });

  it('a sync handler fires exactly once per request across many round-trips', async () => {
    // Re-arm correctness: a sync handler's reply-writer re-arms from inside
    // pumpOnce, and onArmSettled re-arms too. The handler must fire exactly once
    // per request — no missed or duplicated dispatch. (The pendingArm guard also
    // stops the two re-arm paths from leaking a second parked promise per cycle.)
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    const handler = vi.fn((p: unknown) => p);
    dispatcher.register('echo', handler);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);

    for (let i = 0; i < 3; i++) {
      caller.writeRequest(encodeRequest({ method: 'echo', payload: i }));
      await caller.waitReplyAsync(5_000);
    }
    // Let any leaked extra arm settle/pump (would invoke the handler again).
    await new Promise((r) => setTimeout(r, 20));
    dispatcher.detachAll();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('survives detach + re-attach (arm guard released on detach)', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('echo', (p) => p);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);
    dispatcher.detach(ring);
    // Re-attach must arm fresh (the guard was released on detach) and service.
    dispatcher.attach(ring);
    caller.writeRequest(encodeRequest({ method: 'echo', payload: 'x' }));
    const reply = await caller.waitReplyAsync(5_000);
    dispatcher.detachAll();
    expect(JSON.parse(new TextDecoder().decode(reply.subarray(1))).value).toBe('x');
  });

  it('detach cancels the pending waitAsync — no pump after detach', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    const handler = vi.fn((p: unknown) => p);
    dispatcher.register('echo', handler);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    dispatcher.attach(ring);
    // Detach while the waitAsync is parked (no request yet).
    dispatcher.detach(ring);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    // A request that arrives after detach must NOT be serviced.
    caller.writeRequest(encodeRequest({ method: 'echo', payload: 1 }));
    await new Promise((r) => setTimeout(r, 60)); // longer than any settle window
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('SyncRpcDispatcher — backstop is uncounted infra (ADR-0152 §5, keepalive gap-e)', () => {
  it('arms the backstop with the module-load host timer, not the live (keepalive-wrapped) global setInterval', () => {
    // The backstop is pure infra: it must NEVER enter runtime-js's keepalive count
    // (ADR-0152 §5). A worker realm replaces global setInterval with a keepalive-
    // counted wrapper (installTimerGlobals); a nested child (depth-2) whose parent
    // realm did that would have its drain PINNED if the backstop read the live
    // wrapped global. The module captures the host setInterval at load, so a global
    // swapped in AFTERWARDS must not change which timer the backstop arms.
    const spy = vi.spyOn(globalThis, 'setInterval');
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    const { ring } = createSabRing({ payloadCapacity: 64 });
    dispatcher.attach(ring); // arms the single backstop timer
    expect(dispatcher.getActiveTimerCount()).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    dispatcher.detachAll();
  });
});

describe('SyncRpcDispatcher — busy-poll fallback when waitAsync is absent (ADR-0084 #17)', () => {
  it('falls back to setInterval poll and still round-trips a request/reply', async () => {
    // Stub waitAsync away so the dispatcher constructs in busy-poll mode.
    const original = (Atomics as unknown as { waitAsync?: unknown }).waitAsync;
    try {
      (Atomics as unknown as { waitAsync?: unknown }).waitAsync = undefined;
      const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
      dispatcher.register('echo', (p) => p);
      const { sab, ring } = createSabRing({ payloadCapacity: 256 });
      const caller = SabRing.attach(sab, 256);
      dispatcher.attach(ring);
      // One timer drives the fallback poll.
      expect(dispatcher.getActiveTimerCount()).toBe(1);
      caller.writeRequest(encodeRequest({ method: 'echo', payload: 42 }));
      // waitReplyAsync needs the real waitAsync on the CALLER side; restore it
      // for the await while the dispatcher (already constructed) keeps polling.
      (Atomics as unknown as { waitAsync?: unknown }).waitAsync = original;
      const reply = await caller.waitReplyAsync(2_000);
      dispatcher.detachAll();
      expect(JSON.parse(new TextDecoder().decode(reply.subarray(1))).value).toBe(42);
    } finally {
      (Atomics as unknown as { waitAsync?: unknown }).waitAsync = original;
    }
  });
});

describe('SyncRpcDispatcher — a dropped reply is LOUD, never silent', () => {
  it('returns an in-band error when a handler result exceeds the reply slot', () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('oversized', () => 'x'.repeat(1_024));
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    caller.writeRequest(encodeRequest({ method: 'oversized', payload: null }));

    dispatcher.pumpOnce(ring);

    expect(decodeReply(caller.waitReply(0))).toMatchObject({
      ok: false,
      error: {
        name: 'RingPayloadTooLargeError',
        code: 'ERINGPAYLOAD',
        message: expect.stringMatching(/exceeds capacity/),
      },
    });
  });

  it('when even the error reply cannot land, console.error names the method + ring state', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('echo', (p) => p);
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    caller.writeRequest(encodeRequest({ method: 'echo', payload: 1 }));
    // Forge a protocol violation: occupy the reply slot so BOTH the value reply
    // and the fallback error reply fail their "previous reply unread" guard.
    ring.writeReply(new Uint8Array([9]));
    dispatcher.pumpOnce(ring);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = String(errSpy.mock.calls[0]?.[0]);
    expect(line).toMatch(/SyncRpcDispatcher: reply for 'echo' DROPPED/);
    expect(line).toMatch(/previous reply is unread/);
    dispatcher.detachAll();
  });
});
