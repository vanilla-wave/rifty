import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Buffer, isAscii, isUtf8 } from './buffer.ts';

describe('Buffer.from backing-store ownership', () => {
  it('aliases an ArrayBuffer window bidirectionally', () => {
    const arrayBuffer = Uint8Array.from([0, 1, 2, 3, 4]).buffer;
    const bytes = new Uint8Array(arrayBuffer);
    const buffer = Buffer.from(arrayBuffer, 1, 3);

    expect(buffer.buffer).toBe(arrayBuffer);
    expect(buffer.byteOffset).toBe(1);
    expect(Array.from(buffer)).toEqual([1, 2, 3]);

    bytes[1] = 9;
    buffer[1] = 8;
    expect(Array.from(buffer)).toEqual([9, 8, 3]);
    expect(Array.from(bytes)).toEqual([0, 9, 8, 3, 4]);
  });

  it('aliases a SharedArrayBuffer window when shared memory is available', () => {
    const shared = new SharedArrayBuffer(5);
    const bytes = new Uint8Array(shared);
    bytes.set([0, 1, 2, 3, 4]);
    const buffer = Buffer.from(shared, 1, 3);

    expect(buffer.buffer).toBe(shared);
    bytes[1] = 9;
    buffer[1] = 8;
    expect(Array.from(buffer)).toEqual([9, 8, 3]);
    expect(Array.from(bytes)).toEqual([0, 9, 8, 3, 4]);
  });

  it('accepts SharedArrayBuffer in the byte predicates', () => {
    const shared = new SharedArrayBuffer(3);
    new Uint8Array(shared).set([0x61, 0x62, 0x63]);

    expect(isUtf8(shared)).toBe(true);
    expect(isAscii(shared)).toBe(true);
  });

  it('recognizes ArrayBuffer and SharedArrayBuffer from another realm', () => {
    const foreign = runInNewContext('new ArrayBuffer(4)') as ArrayBuffer;
    const foreignShared = runInNewContext('new SharedArrayBuffer(4)') as SharedArrayBuffer;

    expect(foreign instanceof ArrayBuffer).toBe(false);
    expect(foreignShared instanceof SharedArrayBuffer).toBe(false);

    const buffer = Buffer.from(foreign, 1, 2);
    const sharedBuffer = Buffer.from(foreignShared, 1, 2);
    new Uint8Array(foreign)[1] = 7;
    new Uint8Array(foreignShared)[1] = 8;

    expect(buffer.buffer).toBe(foreign);
    expect(sharedBuffer.buffer).toBe(foreignShared);
    expect(buffer[0]).toBe(7);
    expect(sharedBuffer[0]).toBe(8);
  });

  it('keeps typed-array input as an explicit copy', () => {
    const typed = new Uint8Array([1, 2, 3]);
    const buffer = Buffer.from(typed);

    expect(buffer.buffer).not.toBe(typed.buffer);
    typed[0] = 9;
    buffer[1] = 8;
    expect(Array.from(typed)).toEqual([9, 2, 3]);
    expect(Array.from(buffer)).toEqual([1, 8, 3]);
  });

  it('length-tracks a resizable ArrayBuffer only when length is omitted', () => {
    const resizable = new (
      ArrayBuffer as unknown as {
        new (
          byteLength: number,
          options: { maxByteLength: number },
        ): ArrayBuffer & {
          resize(byteLength: number): void;
        };
      }
    )(4, { maxByteLength: 8 });
    new Uint8Array(resizable).set([1, 2, 3, 4]);
    const tracked = Buffer.from(resizable);
    const trackedOffset = Buffer.from(resizable, 1);
    const fixed = Buffer.from(resizable, 0, 4);

    expect([tracked.length, trackedOffset.length, fixed.length]).toEqual([4, 3, 4]);

    resizable.resize(8);
    new Uint8Array(resizable).set([5, 6, 7, 8], 4);
    expect([tracked.length, trackedOffset.length, fixed.length]).toEqual([8, 7, 4]);
    expect(tracked.toString('hex')).toBe('0102030405060708');
    expect(fixed.toString('hex')).toBe('01020304');

    resizable.resize(2);
    expect([tracked.length, trackedOffset.length, fixed.length]).toEqual([2, 1, 0]);
    expect(tracked.toString('hex')).toBe('0102');
  });

  it('length-tracks a growable SharedArrayBuffer only when length is omitted', () => {
    const growable = new (
      SharedArrayBuffer as unknown as {
        new (
          byteLength: number,
          options: { maxByteLength: number },
        ): SharedArrayBuffer & {
          grow(byteLength: number): void;
        };
      }
    )(4, { maxByteLength: 8 });
    const tracked = Buffer.from(growable);
    const fixed = Buffer.from(growable, 0, 4);

    growable.grow(8);

    expect([tracked.length, fixed.length]).toEqual([8, 4]);
  });

  it('observes writes made through WebAssembly.Memory after view creation', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const buffer = Buffer.from(memory.buffer, 0, 3);

    new Uint8Array(memory.buffer, 0, 3).set([0x61, 0x62, 0x63]);
    expect(buffer.buffer).toBe(memory.buffer);
    expect(buffer.toString()).toBe('abc');
  });

  it('tracks unshared WebAssembly.Memory detachment after grow', () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
    const original = memory.buffer;
    const buffer = Buffer.from(original, 0, 3);

    memory.grow(1);

    expect(original.byteLength).toBe(0);
    expect(memory.buffer).not.toBe(original);
    expect(buffer.buffer).toBe(original);
    expect(buffer.length).toBe(0);
    expect(buffer.toString()).toBe('');
  });

  it('keeps shared WebAssembly.Memory views fixed-length after grow', () => {
    let memory: WebAssembly.Memory;
    try {
      memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    } catch {
      return;
    }
    const original = memory.buffer;
    const buffer = Buffer.from(original, 1, 3);
    new Uint8Array(original).set([0, 1, 2, 3]);

    memory.grow(1);
    new Uint8Array(memory.buffer)[1] = 9;

    expect(original.byteLength).toBe(65_536);
    expect(memory.buffer.byteLength).toBe(131_072);
    expect(memory.buffer).not.toBe(original);
    expect(buffer.buffer).toBe(original);
    expect(buffer.length).toBe(3);
    expect(Array.from(buffer)).toEqual([9, 2, 3]);
  });

  it('reflects detached ArrayBuffer state and rejects a new detached view', () => {
    const arrayBuffer = new ArrayBuffer(4);
    const buffer = Buffer.from(arrayBuffer);

    structuredClone(arrayBuffer, { transfer: [arrayBuffer] });

    expect(arrayBuffer.byteLength).toBe(0);
    expect(buffer.buffer).toBe(arrayBuffer);
    expect(buffer.length).toBe(0);
    expect(buffer.toString()).toBe('');
    const error = captureError(() => Buffer.from(arrayBuffer));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBeUndefined();
  });

  it('still coerces toString bounds for empty and detached backing stores', () => {
    const empty = Buffer.alloc(0);
    expect(() => empty.toString('utf8', Symbol() as unknown as number)).toThrow(TypeError);

    const arrayBuffer = new ArrayBuffer(1);
    const detached = Buffer.from(arrayBuffer);
    structuredClone(arrayBuffer, { transfer: [arrayBuffer] });

    expect(() => detached.toString('utf8', Symbol() as unknown as number)).toThrow(TypeError);
  });

  it('matches Node coercion and bounds errors for offset and length', () => {
    const arrayBuffer = Uint8Array.from([0, 1, 2, 3]).buffer;
    const coercedOffset = Buffer.from(arrayBuffer, '1' as unknown as number);
    const fractionalLength = Buffer.from(arrayBuffer, 0, 1.9);
    const negativeLength = Buffer.from(arrayBuffer, 0, -1);

    expect(coercedOffset.byteOffset).toBe(1);
    expect(Array.from(coercedOffset)).toEqual([1, 2, 3]);
    expect(Array.from(fractionalLength)).toEqual([0]);
    expect(negativeLength.length).toBe(0);

    expect(Buffer.from(arrayBuffer, Number.NaN).byteOffset).toBe(0);
    expect(Buffer.from(arrayBuffer, -0.2).byteOffset).toBe(0);
    expect(Buffer.from(arrayBuffer, 1.9).byteOffset).toBe(1);

    const negativeOffsetError = captureError(() => Buffer.from(arrayBuffer, -1));
    expect(negativeOffsetError).toBeInstanceOf(RangeError);
    expect(negativeOffsetError.code).toBeUndefined();
    expect(negativeOffsetError.message).toBe('Start offset -1 is outside the bounds of the buffer');

    const offsetError = captureError(() => Buffer.from(arrayBuffer, 5));
    expect(offsetError).toBeInstanceOf(RangeError);
    expect(offsetError.code).toBe('ERR_BUFFER_OUT_OF_BOUNDS');
    expect(offsetError.message).toBe('"offset" is outside of buffer bounds');

    const fractionalOffsetError = captureError(() => Buffer.from(arrayBuffer, 4.2));
    expect(fractionalOffsetError.code).toBe('ERR_BUFFER_OUT_OF_BOUNDS');

    const lengthError = captureError(() => Buffer.from(arrayBuffer, 3, 2));
    expect(lengthError).toBeInstanceOf(RangeError);
    expect(lengthError.code).toBe('ERR_BUFFER_OUT_OF_BOUNDS');
    expect(lengthError.message).toBe('"length" is outside of buffer bounds');

    const fractionalWindowError = captureError(() => Buffer.from(arrayBuffer, 3.2, 1));
    expect(fractionalWindowError.code).toBe('ERR_BUFFER_OUT_OF_BOUNDS');
  });
});

function captureError(fn: () => unknown): Error & { code?: string } {
  try {
    fn();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected function to throw');
}

describe('Buffer.write', () => {
  it('honors `length` (truncation)', () => {
    const b = Buffer.alloc(10);
    const n = b.write('hello', 0, 3);
    expect(n).toBe(3);
    expect(Array.from(b)).toEqual([0x68, 0x65, 0x6c, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('honors `encoding` (utf16le)', () => {
    const b = Buffer.alloc(10);
    const n = b.write('ab', 0, 4, 'utf16le');
    expect(n).toBe(4);
    expect(b.toString('hex', 0, 4)).toBe('61006200');
  });

  it('honors `encoding` (hex)', () => {
    const b = Buffer.alloc(4);
    const n = b.write('deadbeef', 0, 'hex');
    expect(n).toBe(4);
    expect(b.toString('hex')).toBe('deadbeef');
  });

  it('honors `encoding` (ascii)', () => {
    const b = Buffer.alloc(4);
    b.write('ABCD', 'ascii');
    expect(b.toString('ascii')).toBe('ABCD');
  });

  it('honors `encoding` (base64)', () => {
    const b = Buffer.alloc(6);
    const n = b.write('aGVsbG8h', 0, 'base64');
    expect(n).toBe(6);
    expect(b.toString('utf8')).toBe('hello!');
  });

  it('rejects offset > length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 5)).toThrow(/offset.*out of range/);
  });

  it('rejects length > buffer length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 0, 99)).toThrow(/length.*out of range/);
  });

  it('rejects negative length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 0, -1)).toThrow(/length.*out of range/);
  });

  it('truncates write to remaining buffer when length exceeds available space', () => {
    const b = Buffer.alloc(10);
    const n = b.write('helloworld', 5, 6);
    expect(n).toBe(5);
    expect(b.toString('utf8', 0, 5)).toBe('\x00\x00\x00\x00\x00');
    expect(b.toString('utf8', 5)).toBe('hello');
  });
});

describe('Buffer.toString decode', () => {
  it('ascii masks bytes >= 0x80 to 7-bit (& 0x7f)', () => {
    const b = Buffer.from([0x41, 0x80, 0xff, 0xc3]);
    const s = b.toString('ascii');
    expect([...s].map((c) => c.charCodeAt(0))).toEqual([0x41, 0x00, 0x7f, 0x43]);
  });

  it('latin1 does NOT mask — full 0-255 byte', () => {
    const b = Buffer.from([0x80, 0xff]);
    const s = b.toString('latin1');
    expect([...s].map((c) => c.charCodeAt(0))).toEqual([0x80, 0xff]);
  });
});

describe('Buffer.alloc', () => {
  it('tile-fills bytes from `fill` string under default utf8', () => {
    const b = Buffer.alloc(6, 'abc');
    expect(b.toString('utf8')).toBe('abcabc');
  });

  it('tile-fills under utf16le encoding', () => {
    const b = Buffer.alloc(8, 'a', 'utf16le');
    expect(b.toString('hex')).toBe('6100610061006100');
  });

  it('tile-fills under hex encoding', () => {
    const b = Buffer.alloc(4, 'AB', 'hex');
    expect(b.toString('hex')).toBe('abababab');
  });

  it('truncates the last tile to fit', () => {
    const b = Buffer.alloc(5, 'ab');
    expect(b.toString('utf8')).toBe('ababa');
  });

  it('numeric fill ignores encoding', () => {
    const b = Buffer.alloc(4, 0xaa);
    expect(b.toString('hex')).toBe('aaaaaaaa');
  });
});

describe('Buffer.read/writeFloat / Double', () => {
  it('roundtrips Float32 BE', () => {
    const b = Buffer.alloc(4);
    b.writeFloatBE(1.5, 0);
    expect(b.readFloatBE(0)).toBe(1.5);
  });

  it('BE != LE', () => {
    const be = Buffer.alloc(4);
    be.writeFloatBE(1.5, 0);
    const le = Buffer.alloc(4);
    le.writeFloatLE(1.5, 0);
    expect(be.toString('hex')).not.toBe(le.toString('hex'));
    expect(be.readFloatBE(0)).toBe(le.readFloatLE(0));
  });

  it('roundtrips Float64 (Double) BE/LE', () => {
    const be = Buffer.alloc(8);
    be.writeDoubleBE(Math.PI, 0);
    expect(be.readDoubleBE(0)).toBe(Math.PI);

    const le = Buffer.alloc(8);
    le.writeDoubleLE(Math.PI, 0);
    expect(le.readDoubleLE(0)).toBe(Math.PI);
  });

  it('writeFloat returns post-write offset', () => {
    const b = Buffer.alloc(8);
    expect(b.writeFloatBE(0.5, 0)).toBe(4);
    expect(b.writeDoubleBE(0.5, 0)).toBe(8);
  });
});

describe('Buffer.indexOf / lastIndexOf / includes', () => {
  it('finds a single byte int', () => {
    const b = Buffer.from([1, 2, 3, 2, 1]);
    expect(b.indexOf(2)).toBe(1);
    expect(b.lastIndexOf(2)).toBe(3);
    expect(b.includes(2)).toBe(true);
    expect(b.indexOf(99)).toBe(-1);
    expect(b.includes(99)).toBe(false);
  });

  it('finds a string needle (utf8 default)', () => {
    const b = Buffer.from('hello world hello');
    expect(b.indexOf('hello')).toBe(0);
    expect(b.lastIndexOf('hello')).toBe(12);
    expect(b.includes('orl')).toBe(true);
  });

  it('honors byteOffset', () => {
    const b = Buffer.from('aaa');
    expect(b.indexOf('a', 1)).toBe(1);
    expect(b.indexOf('a', 5)).toBe(-1);
  });

  it('finds a sub-buffer needle', () => {
    const b = Buffer.from([0, 1, 2, 3]);
    const needle = Buffer.from([2, 3]);
    expect(b.indexOf(needle)).toBe(2);
  });

  it('respects encoding for string needle', () => {
    const b = Buffer.from('AAAA', 'hex'); // bytes: aa aa
    expect(b.indexOf('AA', 0, 'hex')).toBe(0);
  });
});

describe('Buffer.fill', () => {
  it('fills with a number byte', () => {
    const b = Buffer.alloc(4);
    b.fill(0xab);
    expect(b.toString('hex')).toBe('abababab');
  });

  it('tile-fills with a string under default utf8', () => {
    const b = Buffer.alloc(6);
    b.fill('ab');
    expect(b.toString('utf8')).toBe('ababab');
  });

  it('honors offset/end range', () => {
    const b = Buffer.alloc(8, 0);
    b.fill(0xff, 2, 6);
    expect(b.toString('hex')).toBe('0000ffffffff0000');
  });

  it('honors encoding (utf16le)', () => {
    const b = Buffer.alloc(8, 0);
    b.fill('a', 'utf16le');
    expect(b.toString('hex')).toBe('6100610061006100');
  });

  it('returns the buffer for chaining', () => {
    const b = Buffer.alloc(2);
    expect(b.fill(0xaa)).toBe(b);
  });

  it('throws on out-of-range', () => {
    const b = Buffer.alloc(4);
    expect(() => b.fill(0, -1)).toThrow(/Out of range/);
    expect(() => b.fill(0, 0, 99)).toThrow(/Out of range/);
  });
});

describe('Buffer.compare (static)', () => {
  // Per task spec: the static signature widens to match the instance method's
  // range params. Note: Node 24's runtime `Buffer.compare(a, b)` has arity 2
  // and silently ignores extra args (verified via parity-runner). Our static
  // delegates to `compareSlices(a.subarray(...), b.subarray(...))` so the
  // range params are honoured here even though Node doesn't currently use
  // them. This is a typing-flexibility surface — future Node versions could
  // honour them at any time, and our subset is forward-compatible.
  it('compares two buffers without range params (Node-parity)', () => {
    const a = Buffer.from('a');
    const b = Buffer.from('b');
    expect(Buffer.compare(a, b)).toBe(-1);
    expect(Buffer.compare(b, a)).toBe(1);
    expect(Buffer.compare(a, a)).toBe(0);
  });

  it('honours targetStart/targetEnd (range on second buffer)', () => {
    // a='he', b='hello' — comparing first 2 bytes of b='he' against a='he':
    // equal → returns 0. Without the range params honoured, this would
    // compare 'he' vs 'hello' (a is shorter prefix) → returns -1.
    const a = Buffer.from('he');
    const b = Buffer.from('hello');
    expect(Buffer.compare(a, b, 0, 2)).toBe(0);
    // Sanity: without range, the comparison sees the full b.
    expect(Buffer.compare(a, b)).toBe(-1);
  });

  it('honours sourceStart/sourceEnd (range on first buffer)', () => {
    // a='hello', b='ll' — comparing a[1..3]='el' against b='ll':
    // 'e' < 'l' → returns -1.
    const a = Buffer.from('hello');
    const b = Buffer.from('ll');
    expect(Buffer.compare(a, b, 0, undefined, 1, 3)).toBe(-1);
    // a[2..4]='ll' against b='ll' → equal.
    expect(Buffer.compare(a, b, 0, undefined, 2, 4)).toBe(0);
  });
});

describe('Buffer.copy', () => {
  it('copies a slice into target', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10, 0x2e); // '.'
    const n = src.copy(dst, 2);
    expect(n).toBe(5);
    expect(dst.toString('utf8')).toBe('..hello...');
  });

  it('honors sourceStart and sourceEnd', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10, 0x2e);
    const n = src.copy(dst, 0, 1, 4); // 'ell'
    expect(n).toBe(3);
    expect(dst.toString('utf8', 0, 3)).toBe('ell');
  });

  it('truncates when target lacks space', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(3);
    const n = src.copy(dst, 0);
    expect(n).toBe(3);
    expect(dst.toString('utf8')).toBe('hel');
  });

  it('returns 0 when sourceEnd <= sourceStart', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10);
    expect(src.copy(dst, 0, 3, 1)).toBe(0);
  });
});

describe('Buffer.isBuffer / instanceof — bundling-robust brand', () => {
  it('recognizes a genuine Buffer; rejects a plain Uint8Array', () => {
    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.from('x') instanceof Buffer).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array([1]))).toBe(false);
    expect(new Uint8Array([1]) instanceof Buffer).toBe(false);
    expect(Buffer.isBuffer(null)).toBe(false);
    expect(Buffer.isBuffer('str')).toBe(false);
  });

  it('recognizes a Buffer from a DUPLICATE class copy (prod-bundle split)', () => {
    // The prod multi-worker bundle can duplicate this class (global `Buffer` vs the
    // `node:buffer` builtin): a real Buffer from another copy carries the shared
    // `Symbol.for` brand but is NOT `instanceof` THIS copy — yet `isBuffer`/`instanceof`
    // must still recognize it (the etag(express `Buffer.from`) → 500 prod crash).
    const fromOtherCopy = new Uint8Array([1, 2, 3]) as unknown as Record<symbol, unknown>;
    fromOtherCopy[Symbol.for('@riftydev/io.Buffer')] = true;
    expect(Buffer.isBuffer(fromOtherCopy)).toBe(true);
    expect(fromOtherCopy instanceof Buffer).toBe(true);
  });

  it('rejects a bare branded plain object that is not a Uint8Array (Node returns false)', () => {
    // The `Symbol.for` brand is a global-registry key; a non-Uint8Array object
    // carrying it must NOT be mis-recognized as a Buffer (the `Uint8Array` guard).
    const branded = { [Symbol.for('@riftydev/io.Buffer')]: true } as Record<symbol, unknown>;
    expect(Buffer.isBuffer(branded)).toBe(false);
    expect(branded instanceof Buffer).toBe(false);
  });
});
