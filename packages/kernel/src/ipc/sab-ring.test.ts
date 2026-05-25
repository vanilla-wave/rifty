/**
 * Unit tests for the SAB request/reply ring (ADR-0011 phase 1).
 *
 * The "caller" side of the protocol uses {@link Atomics.wait}, which only
 * works inside a Worker realm. These tests run in Node (vitest's default),
 * so they exercise the protocol via the async siblings:
 *   - caller side → {@link SabRing.waitReplyAsync}
 *   - responder side → {@link SabRing.readRequest} / {@link SabRing.writeReply}
 *
 * The real cross-realm `Atomics.wait` path is covered by the conformance
 * test in `tests/conformance/kernel/sab-ring.test.ts` (Worker fixture).
 */

import { describe, expect, it } from 'vitest';
import {
  RingPayloadTooLargeError,
  RingTimeoutError,
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from './sab-ring.ts';

describe('createSabRing', () => {
  it('allocates a buffer sized for header + 2× payload capacity', () => {
    const { sab } = createSabRing({ payloadCapacity: 4096 });
    expect(sab.byteLength).toBe(SAB_RING_HEADER_BYTES + 4096 * 2);
  });

  it('defaults payloadCapacity to 1 MiB', () => {
    const { sab } = createSabRing();
    expect(sab.byteLength).toBe(SAB_RING_HEADER_BYTES + 1024 * 1024 * 2);
  });

  it('rejects non-positive or non-integer capacity', () => {
    expect(() => createSabRing({ payloadCapacity: 0 })).toThrow(RangeError);
    expect(() => createSabRing({ payloadCapacity: -1 })).toThrow(RangeError);
    expect(() => createSabRing({ payloadCapacity: 1.5 })).toThrow(RangeError);
  });
});

describe('SabRing — request/reply round-trip', () => {
  it('caller writeRequest → responder readRequest → responder writeReply → caller waitReplyAsync', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 256 });
    const responder = SabRing.attach(sab, 256);

    const request = new Uint8Array([1, 2, 3, 4, 5]);
    caller.writeRequest(request);

    // Responder polls the request slot and echos with a tagged reply.
    const got = responder.readRequest();
    expect(got).not.toBeNull();
    expect(Array.from(got ?? [])).toEqual([1, 2, 3, 4, 5]);

    const reply = new Uint8Array([99, ...(got ?? [])]);
    responder.writeReply(reply);

    const seen = await caller.waitReplyAsync();
    expect(Array.from(seen)).toEqual([99, 1, 2, 3, 4, 5]);
  });

  it('returns reply bytes even when the responder writes first (no lost wake)', async () => {
    // Cover the race where writeReply lands before waitReplyAsync registers
    // the waiter. Atomics.waitAsync's not-equal check resolves immediately.
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 32 });
    const responder = SabRing.attach(sab, 32);

    caller.writeRequest(new Uint8Array([7]));
    expect(responder.readRequest()).toEqual(new Uint8Array([7]));
    responder.writeReply(new Uint8Array([42]));

    const seen = await caller.waitReplyAsync(1000);
    expect(Array.from(seen)).toEqual([42]);
  });
});

describe('SabRing — timeout', () => {
  it('waitReplyAsync(50) rejects with RingTimeoutError when no reply ever arrives', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    SabRing.attach(sab, 16); // responder is silent

    caller.writeRequest(new Uint8Array([1]));
    await expect(caller.waitReplyAsync(50)).rejects.toBeInstanceOf(RingTimeoutError);
    await expect(caller.waitReplyAsync(50).catch((e) => e)).resolves.toMatchObject({
      code: 'ERINGTIMEOUT',
    });
  });
});

describe('SabRing — payload too large', () => {
  it('writeRequest throws RingPayloadTooLargeError when payload > capacity', () => {
    const { ring: caller } = createSabRing({ payloadCapacity: 8 });
    expect(() => caller.writeRequest(new Uint8Array(9))).toThrowError(RingPayloadTooLargeError);
    try {
      caller.writeRequest(new Uint8Array(9));
    } catch (e) {
      expect(e).toMatchObject({ code: 'ERINGPAYLOAD', bytes: 9, capacity: 8 });
    }
  });

  it('writeReply throws RingPayloadTooLargeError when payload > capacity', () => {
    const { sab } = createSabRing({ payloadCapacity: 8 });
    const responder = SabRing.attach(sab, 8);
    expect(() => responder.writeReply(new Uint8Array(9))).toThrowError(RingPayloadTooLargeError);
  });
});

describe('SabRing — sequential round-trips', () => {
  it('three back-to-back exchanges all succeed; state slots reset cleanly', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);

    for (let i = 0; i < 3; i++) {
      caller.writeRequest(new Uint8Array([i, i + 1, i + 2]));
      const req = responder.readRequest();
      expect(req).not.toBeNull();
      // Reply: invert the payload values mod 256.
      const reply = new Uint8Array((req ?? []).map((b) => 255 - b));
      responder.writeReply(reply);
      const seen = await caller.waitReplyAsync(1000);
      expect(Array.from(seen)).toEqual([255 - i, 255 - (i + 1), 255 - (i + 2)]);
    }
  });

  it('readRequest returns null when no request is pending', () => {
    const { sab } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    expect(responder.readRequest()).toBeNull();
  });
});

describe('SabRing — protocol violations', () => {
  it('writeRequest while a reply is still unread throws', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([1]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([2]));
    // Caller has not consumed the reply yet.
    expect(() => caller.writeRequest(new Uint8Array([3]))).toThrow(/previous reply is unread/);
    // Drain so test cleanup is honest.
    await caller.waitReplyAsync(100);
  });

  it('writeReply while a previous reply is still unread throws', () => {
    const { sab } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    responder.writeReply(new Uint8Array([1]));
    expect(() => responder.writeReply(new Uint8Array([2]))).toThrow(/previous reply is unread/);
  });
});
