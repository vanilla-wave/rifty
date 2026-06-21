/**
 * Unit tests for the async/one-shot random surface (backlog
 * `runtime-js/crypto-random-and-oneshot`). Parity cases pin the deterministic
 * Node contract; these cover what stdout-diffing cannot:
 *  - `randomInt` unbiasedness — a DETERMINISTIC rejection-sampling proof near a
 *    power-of-two-adjacent boundary (stubbed RNG), plus a live in-range sweep.
 *  - the chunked fill core for sizes above the 65536-byte Web Crypto cap.
 *  - the async callback shapes (deferred, error-first / `Buffer` result).
 */
import { describe, expect, it, vi } from 'vitest';
import { Buffer } from './buffer.ts';
import cryptoModule from './crypto.ts';

const errorOf = (fn: () => unknown): { name?: string; code?: string } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e as { name?: string; code?: string };
  }
};

describe('crypto.randomInt — unbiased rejection sampling', () => {
  it('rejects the biased 48-bit tail and resamples (deterministic)', () => {
    // range = 3, min = 0. The 48-bit space N = 2^48; N % 3 === 1, so the
    // acceptance limit is N - 1. A draw of exactly N-1 (all-0xFF bytes) lands in
    // the rejected tail and must be discarded; the next draw (value 7) is
    // accepted and maps to 7 % 3 === 1. A naive `value % range` (no rejection)
    // would keep the first draw and bias the distribution.
    const grv = vi.fn((view: Uint8Array) => {
      const seq = grv.mock.calls.length === 1 ? [255, 255, 255, 255, 255, 255] : [0, 0, 0, 0, 0, 7];
      view.set(seq.slice(0, view.length));
      return view;
    });
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: grv,
      randomUUID: real.randomUUID,
      subtle: real.subtle,
    });
    try {
      expect(cryptoModule.randomInt(0, 3)).toBe(1);
      expect(grv).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays in range and covers every bucket near a power-of-two boundary', () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 21000; i++) {
      const n = cryptoModule.randomInt(0, 7); // 7 = 2^3 - 1
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      counts[n]++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });

  it('honours an explicit min and a deterministic single-value range', () => {
    expect(cryptoModule.randomInt(5, 6)).toBe(5);
    for (let i = 0; i < 200; i++) {
      const n = cryptoModule.randomInt(10, 13);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThan(13);
    }
  });

  it('throws the Node error contract on bad bounds', () => {
    expect(errorOf(() => cryptoModule.randomInt(0))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomInt(10, 5))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomInt(0, 2 ** 48))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomInt(1.5))).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE',
    });
  });

  it('validates bounds synchronously even in the callback overload', () => {
    expect(errorOf(() => cryptoModule.randomInt(10, 5, () => {}))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
  });

  it('async happy path calls cb(undefined, n)', async () => {
    const { err, n } = await new Promise<{ err: unknown; n: number }>((resolve) => {
      cryptoModule.randomInt(0, 1, (e: unknown, v: number) => resolve({ err: e, n: v }));
    });
    expect(err).toBeUndefined();
    expect(n).toBe(0);
  });
});

describe('crypto.randomBytes — size contract + chunked fill', () => {
  it('fills sizes above the 65536-byte cap, including the tail past the chunk boundary', () => {
    const buf = cryptoModule.randomBytes(70000);
    expect(buf.length).toBe(70000);
    // A non-chunking or off-by-one fill would leave the tail (bytes beyond the
    // first 65536-byte getRandomValues call) all-zero. Real CSPRNG output is
    // non-zero with overwhelming probability, so this discriminates a real fill.
    expect(buf.subarray(65536).some((b) => b !== 0)).toBe(true);
    expect(buf.subarray(0, 65536).some((b) => b !== 0)).toBe(true);
  });

  it('floors non-integer sizes like Node', () => {
    expect(cryptoModule.randomBytes(1.5).length).toBe(1);
    expect(cryptoModule.randomBytes(2.9).length).toBe(2);
  });

  it('throws ERR_OUT_OF_RANGE outside [0, 2^31-1] and for NaN', () => {
    expect(errorOf(() => cryptoModule.randomBytes(-1))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    // A negative FRACTION must throw too: `Math.trunc(-0.5)` is `-0`, which a
    // post-truncation `< 0` test would wrongly accept (Node validates the raw).
    expect(errorOf(() => cryptoModule.randomBytes(-0.5))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomBytes(2 ** 31))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    // NaN is a number, so it is ERR_OUT_OF_RANGE (RangeError), not a type error.
    expect(errorOf(() => cryptoModule.randomBytes(Number.NaN))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
  });

  it('callback overload is deferred and yields a Buffer', async () => {
    const order: string[] = [];
    const { err, buf } = await new Promise<{ err: unknown; buf: Buffer }>((resolve) => {
      cryptoModule.randomBytes(8, (e: unknown, b: Buffer) => {
        order.push('cb');
        resolve({ err: e, buf: b });
      });
      order.push('sync');
    });
    expect(order).toEqual(['sync', 'cb']);
    expect(err).toBeNull();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(8);
    // Guard the fill itself, not just the shape: a stubbed/no-op callback fill
    // would return an all-zero buffer. Real CSPRNG output is non-zero.
    expect(buf.some((b) => b !== 0)).toBe(true);
  });
});

describe('crypto.randomFill — async fill', () => {
  it('fills the whole buffer and resolves with the same instance', async () => {
    const target = Buffer.alloc(16); // zero-filled
    const { err, same, len } = await new Promise<{ err: unknown; same: boolean; len: number }>(
      (resolve) => {
        cryptoModule.randomFill(target, (e: unknown, b: Buffer) =>
          resolve({ err: e, same: b === target, len: b.length }),
        );
      },
    );
    expect(err).toBeNull();
    expect(same).toBe(true);
    expect(len).toBe(16);
    // The buffer started all-zero; a real fill makes it non-zero (guards a no-op).
    expect(target.some((b) => b !== 0)).toBe(true);
  });

  it('honours the offset/size window', async () => {
    const target = Buffer.alloc(8); // zero-filled
    await new Promise<void>((resolve) => {
      // Force the window bytes non-zero deterministically via a stubbed RNG.
      const real = globalThis.crypto;
      vi.stubGlobal('crypto', {
        getRandomValues: (view: Uint8Array) => {
          view.fill(0xab);
          return view;
        },
        randomUUID: real.randomUUID,
        subtle: real.subtle,
      });
      cryptoModule.randomFill(target, 2, 3, (_e: unknown, b: Buffer) => {
        vi.unstubAllGlobals();
        // Only [2,5) is filled; the rest stays zero.
        expect(Array.from(b)).toEqual([0, 0, 0xab, 0xab, 0xab, 0, 0, 0]);
        resolve();
      });
    });
  });

  it('floors a non-integer offset/size like Node', () => {
    const a = Buffer.alloc(6);
    expect(cryptoModule.randomFillSync(a, 1.9)).toBe(a); // offset → 1, fills [1,6)
    const b = Buffer.alloc(6);
    cryptoModule.randomFillSync(b, 0, 1.9); // size → 1, fills [0,1)
    expect(b.length).toBe(6);
  });

  it('validates the offset/size window SYNCHRONOUSLY even in the async form', () => {
    const buf = Buffer.alloc(4);
    // Bad offset/size throw synchronously (Node never delivers `cb(err)` here).
    expect(errorOf(() => cryptoModule.randomFill(buf, 10, 2, () => {}))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomFill(buf, 0, 7, () => {}))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
  });

  it('throws the Node window/type contract (sync form)', () => {
    expect(errorOf(() => cryptoModule.randomFillSync(Buffer.alloc(4), -1))).toMatchObject({
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomFillSync(Buffer.alloc(4), 0, 7))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(errorOf(() => cryptoModule.randomFillSync(Buffer.alloc(4), 3, 3))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE', // offset + size > length
    });
    expect(errorOf(() => cryptoModule.randomFillSync(Buffer.alloc(4), Number.NaN))).toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
    });
    // A non-view (string) is a type error, like Node.
    expect(errorOf(() => cryptoModule.randomFillSync('hello' as never))).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE',
    });
  });

  it('accepts a raw ArrayBuffer and fills it in place (Node contract)', () => {
    // Node's randomFill (UNLIKE hash) accepts a raw ArrayBuffer and returns it.
    const ab = new ArrayBuffer(8);
    const out = cryptoModule.randomFillSync(ab as never, 0, 4);
    expect(out).toBe(ab as never); // same instance back
    // [0,4) is filled; a real CSPRNG fill is non-zero with overwhelming odds.
    expect(new Uint8Array(ab, 0, 4).some((b) => b !== 0)).toBe(true);
    // The window is respected: [4,8) stays zero.
    expect(Array.from(new Uint8Array(ab, 4, 4))).toEqual([0, 0, 0, 0]);
  });
});

describe('crypto.hash — one-shot', () => {
  it('matches the streaming createHash digest', () => {
    expect(cryptoModule.hash('sha256', 'abc')).toBe(
      cryptoModule.createHash('sha256').update('abc').digest('hex'),
    );
  });

  it('defaults to a hex string and supports the buffer output mode', () => {
    expect(typeof cryptoModule.hash('sha256', 'abc')).toBe('string');
    const buf = cryptoModule.hash('sha256', 'abc', 'buffer');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('hex')).toBe(cryptoModule.hash('sha256', 'abc'));
  });

  it('accepts a Buffer/Uint8Array input', () => {
    expect(cryptoModule.hash('sha256', Buffer.from('abc'))).toBe(
      cryptoModule.hash('sha256', 'abc'),
    );
  });

  it('treats latin1 as a binary alias', () => {
    const latin1 = cryptoModule.hash('sha256', 'abc', 'latin1') as string;
    expect(latin1).toBe(cryptoModule.hash('sha256', 'abc', 'binary'));
    expect(latin1.length).toBe(32);
  });

  it('accepts any ArrayBufferView but rejects a raw ArrayBuffer (Node contract)', () => {
    const bytes = new Uint8Array([97, 98, 99]);
    expect(cryptoModule.hash('sha256', new DataView(bytes.buffer))).toBe(
      cryptoModule.hash('sha256', 'abc'),
    );
    expect(errorOf(() => cryptoModule.hash('sha256', bytes.buffer as never))).toMatchObject({
      code: 'ERR_INVALID_ARG_TYPE',
    });
  });
});
