/**
 * Unit tests for the SAB request/reply ring (ADR-0011 phase 1).
 *
 * The browser caller uses {@link Atomics.wait} inside a Worker. These tests
 * run in Node (vitest's default), so ordinary round-trips use the async sibling
 * and host-boundary fault cases decorate Node's wait primitives:
 *   - caller side → {@link SabRing.waitReplyAsync}
 *   - responder side → {@link SabRing.readRequest} / {@link SabRing.writeReply}
 *
 * The real cross-realm `Atomics.wait` path is covered by the conformance
 * test in `tests/conformance/kernel/sab-ring.test.ts` (Worker fixture).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  REQ_STATE_OFFSET,
  RingPayloadTooLargeError,
  RingTimeoutError,
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from './sab-ring.ts';

type WaitResult = 'ok' | 'not-equal' | 'timed-out';
type Wait = (typedArray: Int32Array, index: number, value: number, timeout?: number) => WaitResult;
type WaitAsyncResult =
  | { async: false; value: WaitResult }
  | { async: true; value: Promise<'ok' | 'timed-out'> };
type WaitAsync = (
  typedArray: Int32Array,
  index: number,
  value: number,
  timeout?: number,
) => WaitAsyncResult;

const atomicsWait = Atomics as unknown as { wait: Wait; waitAsync: WaitAsync };

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
    const secondCaller = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1]));
    await expect(caller.waitReplyAsync(50)).rejects.toBeInstanceOf(RingTimeoutError);
    await expect(caller.waitReplyAsync(50).catch((e) => e)).resolves.toMatchObject({
      code: 'ERINGTIMEOUT',
    });
    expect(() => secondCaller.writeRequest(new Uint8Array([2]))).toThrow(
      /previous request is unread/,
    );
  });
});

describe('SabRing — early reply wakes', () => {
  it('waitReply re-checks an idle reply after early ok wakes, then consumes the real reply', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    const nativeWait = atomicsWait.wait.bind(Atomics);
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const observedTimeouts: number[] = [];
    let earlyWakes = 0;

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    const waitSpy = vi
      .spyOn(atomicsWait, 'wait')
      .mockImplementation((words, index, value, timeout) => {
        observedTimeouts.push(timeout ?? Number.POSITIVE_INFINITY);
        if (earlyWakes < 2) {
          earlyWakes++;
          nativeWait(sleeper, 0, 0, 5);
          return 'ok';
        }

        expect(responder.readRequest()).toEqual(new Uint8Array([1, 2, 3]));
        responder.writeReply(new Uint8Array([4, 5, 6]));
        return nativeWait(words, index, value, timeout);
      });

    try {
      expect(caller.waitReply(250)).toEqual(new Uint8Array([4, 5, 6]));
      expect(waitSpy).toHaveBeenCalledTimes(3);
      expect(observedTimeouts[0]).toBeGreaterThan(0);
      expect(observedTimeouts[0]).toBeLessThanOrEqual(250);
      expect(observedTimeouts[1]).toBeLessThan(observedTimeouts[0] ?? 0);
      expect(observedTimeouts[2]).toBeLessThan(observedTimeouts[1] ?? 0);
    } finally {
      waitSpy.mockRestore();
    }

    caller.writeRequest(new Uint8Array([7]));
    expect(responder.readRequest()).toEqual(new Uint8Array([7]));
    responder.writeReply(new Uint8Array([8]));
    expect(caller.waitReply(0)).toEqual(new Uint8Array([8]));
  });

  it('waitReplyAsync re-checks an idle reply after early ok wakes, then consumes the real reply', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    const nativeWaitAsync = atomicsWait.waitAsync.bind(Atomics);
    const observedTimeouts: number[] = [];
    let earlyWakes = 0;

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    const waitSpy = vi
      .spyOn(atomicsWait, 'waitAsync')
      .mockImplementation((words, index, value, timeout) => {
        observedTimeouts.push(timeout ?? Number.POSITIVE_INFINITY);
        if (earlyWakes < 2) {
          earlyWakes++;
          return {
            async: true,
            value: new Promise<'ok'>((resolve) => {
              setTimeout(() => resolve('ok'), 5);
            }),
          };
        }

        expect(responder.readRequest()).toEqual(new Uint8Array([1, 2, 3]));
        responder.writeReply(new Uint8Array([4, 5, 6]));
        return nativeWaitAsync(words, index, value, timeout);
      });

    try {
      await expect(caller.waitReplyAsync(250)).resolves.toEqual(new Uint8Array([4, 5, 6]));
      expect(waitSpy).toHaveBeenCalledTimes(3);
      expect(observedTimeouts[0]).toBeGreaterThan(0);
      expect(observedTimeouts[0]).toBeLessThanOrEqual(250);
      expect(observedTimeouts[1]).toBeLessThan(observedTimeouts[0] ?? 0);
      expect(observedTimeouts[2]).toBeLessThan(observedTimeouts[1] ?? 0);
    } finally {
      waitSpy.mockRestore();
    }
  });

  it('repeated early sync wakes expire against one monotonic deadline', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const secondCaller = SabRing.attach(sab, 16);
    const observedTimeouts: number[] = [];
    let monotonicNow = 1_000;

    caller.writeRequest(new Uint8Array([1]));
    const clockSpy = vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    const waitSpy = vi
      .spyOn(atomicsWait, 'wait')
      .mockImplementation((_words, _index, _value, timeout) => {
        observedTimeouts.push(timeout ?? Number.POSITIVE_INFINITY);
        if (observedTimeouts.length > 2) return 'timed-out';
        monotonicNow += 60;
        return 'ok';
      });

    let caught: unknown;
    try {
      caller.waitReply(100);
    } catch (error) {
      caught = error;
    } finally {
      waitSpy.mockRestore();
      clockSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(RingTimeoutError);
    if (!(caught instanceof RingTimeoutError)) throw new Error('expected RingTimeoutError');
    expect(caught.code).toBe('ERINGTIMEOUT');
    expect(caught.message).toBe(
      `SAB ring waitReply timed out after 100ms (header: version=${caller.expectedVersion} req=ready rep=idle reqLen=1 repLen=0)`,
    );
    expect(observedTimeouts.slice(0, 2)).toEqual([100, 40]);
    expect(observedTimeouts.slice(2).every((timeout) => timeout <= 0)).toBe(true);
    expect(() => secondCaller.writeRequest(new Uint8Array([2]))).toThrow(
      /previous request is unread/,
    );
  });

  it('repeated early async wakes expire against one monotonic deadline', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const secondCaller = SabRing.attach(sab, 16);
    const observedTimeouts: number[] = [];
    let monotonicNow = 1_000;

    caller.writeRequest(new Uint8Array([1]));
    const clockSpy = vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    const waitSpy = vi
      .spyOn(atomicsWait, 'waitAsync')
      .mockImplementation((_words, _index, _value, timeout) => {
        observedTimeouts.push(timeout ?? Number.POSITIVE_INFINITY);
        if (observedTimeouts.length > 2) return { async: false, value: 'timed-out' };
        return {
          async: true,
          value: Promise.resolve().then(() => {
            monotonicNow += 60;
            return 'ok' as const;
          }),
        };
      });

    let caught: unknown;
    try {
      await caller.waitReplyAsync(100);
    } catch (error) {
      caught = error;
    } finally {
      waitSpy.mockRestore();
      clockSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(RingTimeoutError);
    if (!(caught instanceof RingTimeoutError)) throw new Error('expected RingTimeoutError');
    expect(caught.code).toBe('ERINGTIMEOUT');
    expect(caught.message).toBe(
      `SAB ring waitReply timed out after 100ms (header: version=${caller.expectedVersion} req=ready rep=idle reqLen=1 repLen=0)`,
    );
    expect(observedTimeouts.slice(0, 2)).toEqual([100, 40]);
    expect(observedTimeouts.slice(2).every((timeout) => timeout <= 0)).toBe(true);
    expect(() => secondCaller.writeRequest(new Uint8Array([2]))).toThrow(
      /previous request is unread/,
    );
  });

  it('keeps a sync timed-out result authoritative over a later reply publication', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    const secondCaller = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1]));
    expect(responder.readRequest()).toEqual(new Uint8Array([1]));
    const waitSpy = vi.spyOn(atomicsWait, 'wait').mockImplementation(() => {
      responder.writeReply(new Uint8Array([9]));
      return 'timed-out';
    });

    try {
      expect(() => caller.waitReply(20)).toThrow(RingTimeoutError);
    } finally {
      waitSpy.mockRestore();
    }
    expect(() => secondCaller.writeRequest(new Uint8Array([2]))).toThrow(
      /previous reply is unread/,
    );
  });

  it('keeps an async timed-out result authoritative when a reply precedes continuation', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    const secondCaller = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1]));
    expect(responder.readRequest()).toEqual(new Uint8Array([1]));
    const waitSpy = vi.spyOn(atomicsWait, 'waitAsync').mockImplementation(() => ({
      async: true,
      value: new Promise<'timed-out'>((resolve) => {
        queueMicrotask(() => {
          resolve('timed-out');
          responder.writeReply(new Uint8Array([9]));
        });
      }),
    }));

    try {
      await expect(caller.waitReplyAsync(20)).rejects.toBeInstanceOf(RingTimeoutError);
    } finally {
      waitSpy.mockRestore();
    }
    expect(() => secondCaller.writeRequest(new Uint8Array([2]))).toThrow(
      /previous reply is unread/,
    );
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

describe('SabRing — zero-copy view (ADR-0084 #18)', () => {
  it('readRequest returns a live SAB view the consumer reads correctly before slot reuse', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);

    caller.writeRequest(new Uint8Array([10, 20, 30]));
    const view = responder.readRequest();
    expect(view).not.toBeNull();
    // Decode synchronously (the production contract): the bytes are correct now.
    expect(Array.from(view ?? [])).toEqual([10, 20, 30]);
  });

  it('a decoded-and-copied value is NOT corrupted when a later request reuses the slot', () => {
    // The view aliases the SAB; the contract is "decode synchronously". A
    // consumer that copies out (as the production decoders do) keeps a stable
    // value across the next request that overwrites the same slot.
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    const first = responder.readRequest();
    const decodedFirst = Array.from(first ?? []); // synchronous "decode" = copy out
    expect(decodedFirst).toEqual([1, 2, 3]);

    responder.writeReply(new Uint8Array(0));
    caller.waitReply(0);

    // The next completed exchange reuses the REQ slot — the copy stays stable.
    caller.writeRequest(new Uint8Array([7, 8, 9]));
    const second = responder.readRequest();
    expect(Array.from(second ?? [])).toEqual([7, 8, 9]);
    expect(decodedFirst).toEqual([1, 2, 3]); // already-decoded value is intact
  });
});

describe('SabRing — configurable capacity agreement (ADR-0084 #19)', () => {
  it('parent + child agree on offsets for a non-default capacity', () => {
    const cap = 4096;
    const { sab, ring: parent } = createSabRing({ payloadCapacity: cap });
    const child = SabRing.attach(sab, cap);
    expect(child.payloadCapacity).toBe(cap);
    expect(child.repPayloadOffset).toBe(parent.repPayloadOffset);
    expect(child.reqPayloadOffset).toBe(parent.reqPayloadOffset);
    expect(child.repPayloadOffset).toBe(SAB_RING_HEADER_BYTES + cap);
  });

  it('a >default-but-<configured payload round-trips on a larger ring', async () => {
    const cap = 2 * 1024 * 1024; // 2 MiB — above the 1 MiB default
    const { sab, ring: caller } = createSabRing({ payloadCapacity: cap });
    const responder = SabRing.attach(sab, cap);
    const big = new Uint8Array(1_500_000); // > default 1 MiB, < configured 2 MiB
    big[0] = 0xaa;
    big[big.length - 1] = 0xbb;
    caller.writeRequest(big);
    const got = responder.readRequest();
    expect(got?.length).toBe(big.length);
    expect(got?.[0]).toBe(0xaa);
    expect(got?.[got.length - 1]).toBe(0xbb);
    responder.writeReply(new Uint8Array([1]));
    expect(Array.from(await caller.waitReplyAsync(1000))).toEqual([1]);
  });

  it('a desynced capacity is rejected loudly (not a wrong-slot read)', () => {
    const { sab } = createSabRing({ payloadCapacity: 4096 });
    // Peer attaches with a different capacity → buffer size no longer matches
    // HEADER + 2×capacity → RangeError, instead of computing a wrong offset.
    expect(() => SabRing.attach(sab, 2048)).toThrow(RangeError);
    expect(() => SabRing.attach(sab, 8192)).toThrow(/peers disagree on payloadCapacity/);
  });
});

describe('SabRing — protocol violations', () => {
  it('rejects a second attached caller before it mutates one live exchange', () => {
    const { sab, ring: firstCaller } = createSabRing({ payloadCapacity: 16 });
    const secondCaller = SabRing.attach(sab, 16);

    firstCaller.writeRequest(new Uint8Array([1, 2, 3]));
    expect(() => secondCaller.writeRequest(new Uint8Array([4, 5, 6]))).toThrow(
      /previous request is unread/,
    );
  });

  it('rejects a second attached caller after the responder claims the first request', async () => {
    const { sab, ring: firstCaller } = createSabRing({ payloadCapacity: 16 });
    const secondCaller = SabRing.attach(sab, 16);
    const responder = SabRing.attach(sab, 16);

    firstCaller.writeRequest(new Uint8Array([1, 2, 3]));
    expect(responder.readRequest()).toEqual(new Uint8Array([1, 2, 3]));

    expect(() => secondCaller.writeRequest(new Uint8Array([4, 5, 6]))).toThrow(
      /previous request is being handled/,
    );

    responder.writeReply(new Uint8Array([7, 8, 9]));
    await expect(firstCaller.waitReplyAsync(100)).resolves.toEqual(new Uint8Array([7, 8, 9]));
  });

  it('rejects a second dispatcher from consuming one claimed request', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const firstResponder = SabRing.attach(sab, 16);
    const secondResponder = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    expect(firstResponder.readRequest()).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => secondResponder.readRequest()).toThrow(/previous request is being handled/);

    firstResponder.writeReply(new Uint8Array([4, 5, 6]));
    expect(firstResponder.readRequest()).toBeNull();
    expect(() => secondResponder.readRequest()).toThrow(/previous request is being handled/);
    expect(caller.waitReply(0)).toEqual(new Uint8Array([4, 5, 6]));
    expect(secondResponder.readRequest()).toBeNull();
  });

  it('lets the owning dispatcher re-pump one claimed request without consuming it twice', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    expect(responder.readRequest()).toEqual(new Uint8Array([1, 2, 3]));
    expect(responder.readRequest()).toBeNull();

    responder.writeReply(new Uint8Array([4, 5, 6]));
    expect(responder.readRequest()).toBeNull();
    expect(caller.waitReply(0)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects a second caller from consuming the first caller's reply", () => {
    const { sab, ring: firstCaller } = createSabRing({ payloadCapacity: 16 });
    const secondCaller = SabRing.attach(sab, 16);
    const responder = SabRing.attach(sab, 16);

    firstCaller.writeRequest(new Uint8Array([1, 2, 3]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([4, 5, 6]));

    expect(() => secondCaller.waitReply(0)).toThrow(/caller does not own the live request/);
    expect(firstCaller.waitReply(0)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects a second dispatcher from writing the first dispatcher's reply", () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const firstResponder = SabRing.attach(sab, 16);
    const secondResponder = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    firstResponder.readRequest();

    expect(() => secondResponder.writeReply(new Uint8Array([4, 5, 6]))).toThrow(
      /dispatcher does not own the live request/,
    );
    firstResponder.writeReply(new Uint8Array([7, 8, 9]));
    expect(caller.waitReply(0)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('rejects a duplicate reply consumer instead of returning an empty frame', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);

    caller.writeRequest(new Uint8Array([1, 2, 3]));
    const firstRead = caller.waitReplyAsync(100);
    const duplicateRead = caller.waitReplyAsync(100);
    responder.readRequest();
    responder.writeReply(new Uint8Array([4, 5, 6]));

    await expect(firstRead).resolves.toEqual(new Uint8Array([4, 5, 6]));
    await expect(duplicateRead).rejects.toThrow(/caller does not own the live request/);
  });

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
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([0]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([1]));
    expect(() => responder.writeReply(new Uint8Array([2]))).toThrow(/previous reply is unread/);
    caller.waitReply(0);
  });
});

describe('SabRing — violation forensics (CI-flake postmortem needs the header state)', () => {
  it('writeRequest-over-unread-reply names the full header state', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([1]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([2, 3]));
    expect(() => caller.writeRequest(new Uint8Array([4]))).toThrow(
      /previous reply is unread \(header: version=\d+ req=handling rep=ready reqLen=0 repLen=2\)/,
    );
    await caller.waitReplyAsync(100);
  });

  it('writeRequest-over-unread-request names the full header state', () => {
    const { ring: caller } = createSabRing({ payloadCapacity: 16 });
    caller.writeRequest(new Uint8Array([1, 2, 3]));
    expect(() => caller.writeRequest(new Uint8Array([4]))).toThrow(
      /previous request is unread \(header: version=\d+ req=ready rep=idle reqLen=3 repLen=0\)/,
    );
  });

  it('writeReply-over-unread-reply names the full header state', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([0]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([1]));
    expect(() => responder.writeReply(new Uint8Array([2]))).toThrow(
      /previous reply is unread \(header: version=\d+ req=handling rep=ready reqLen=0 repLen=1\)/,
    );
    caller.waitReply(0);
  });

  it('corrupt reply length names the full header state', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([1]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([2]));
    // Forge an out-of-range REP_LEN after a legitimate reply write.
    const i32 = new Int32Array(sab);
    i32[4] = 999; // REP_LEN slot (offset 16 >> 2)
    await expect(caller.waitReplyAsync(100)).rejects.toThrow(
      /corrupt reply length 999 \(capacity 16\) \(header: version=\d+/,
    );
  });

  it('rejects a reply whose request claim was released out of band', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 16 });
    const responder = SabRing.attach(sab, 16);
    caller.writeRequest(new Uint8Array([1]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([2]));

    Atomics.store(new Int32Array(sab), REQ_STATE_OFFSET >> 2, 0);

    await expect(caller.waitReplyAsync(100)).rejects.toThrow(
      /cannot consume reply unless request is handling/,
    );
  });

  it('RingTimeoutError names the header state at expiry', async () => {
    const { ring } = createSabRing({ payloadCapacity: 16 });
    ring.writeRequest(new Uint8Array([1]));
    // No responder: the request is still pending at timeout.
    await expect(ring.waitReplyAsync(30)).rejects.toThrow(
      /timed out after 30ms \(header: version=\d+ req=ready rep=idle reqLen=1 repLen=0\)/,
    );
  });
});
