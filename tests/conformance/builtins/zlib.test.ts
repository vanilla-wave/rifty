/**
 * node:zlib web-compression-backed async subset (ADR-0158).
 *
 * The unique fidelity check the parity harness can't do: rifty's
 * `CompressionStream`-backed output is decompressed by real Node's NATIVE
 * `node:zlib`, and vice versa — proving the wire format is interoperable, not
 * a self-consistent round-trip. Plus the loud ceilings (sync/brotli/streams/
 * unzip/unsupported-options) that diverge from Node by design and therefore
 * live here (rifty-only), not in a cross-runtime parity case.
 */
import { promisify } from 'node:util';
import nodeZlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Buffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';
import zlib from '../../../packages/runtime-js/src/builtins/zlib.ts';

const text = 'The quick brown fox 🦊 jumps over the lazy dog. '.repeat(40);

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);
const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

const notImpl = (feature: string) =>
  expect.objectContaining({ name: 'NotImplementedError', feature }) as unknown as Error;

describe('node:zlib — round-trip (promisified)', () => {
  it('gzip → gunzip', async () => {
    expect(Buffer.from(await gunzip(await gzip(text))).toString()).toBe(text);
  });
  it('deflate → inflate', async () => {
    expect(Buffer.from(await inflate(await deflate(text))).toString()).toBe(text);
  });
  it('deflateRaw → inflateRaw', async () => {
    expect(Buffer.from(await inflateRaw(await deflateRaw(text))).toString()).toBe(text);
  });
});

describe('node:zlib — wire-compatible with real Node zlib (both directions)', () => {
  it('rifty.gzip output reads in Node.gunzipSync', async () => {
    expect(nodeZlib.gunzipSync(await gzip(text)).toString()).toBe(text);
  });
  it('Node.gzipSync output reads in rifty.gunzip', async () => {
    expect(Buffer.from(await gunzip(nodeZlib.gzipSync(Buffer.from(text)))).toString()).toBe(text);
  });
  it('rifty.deflate output reads in Node.inflateSync (zlib-wrapped)', async () => {
    expect(nodeZlib.inflateSync(await deflate(text)).toString()).toBe(text);
  });
  it('Node.deflateSync output reads in rifty.inflate', async () => {
    expect(Buffer.from(await inflate(nodeZlib.deflateSync(Buffer.from(text)))).toString()).toBe(
      text,
    );
  });
  it('rifty.deflateRaw output reads in Node.inflateRawSync (raw)', async () => {
    expect(nodeZlib.inflateRawSync(await deflateRaw(text)).toString()).toBe(text);
  });
  it('Node.deflateRawSync output reads in rifty.inflateRaw', async () => {
    expect(
      Buffer.from(await inflateRaw(nodeZlib.deflateRawSync(Buffer.from(text)))).toString(),
    ).toBe(text);
  });
});

describe('node:zlib — input shapes & callback contract', () => {
  it('callback receives (null, Buffer)', async () => {
    const buf = await new Promise<unknown>((resolve, reject) => {
      zlib.gzip(text, (err: Error | null, out: unknown) => (err ? reject(err) : resolve(out)));
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
  it('accepts a string (utf-8)', async () => {
    expect(Buffer.from(await gunzip(await gzip('hello'))).toString()).toBe('hello');
  });
  it('accepts a Uint8Array', async () => {
    const bytes = new TextEncoder().encode('hello');
    expect(Buffer.from(await gunzip(await gzip(bytes))).toString()).toBe('hello');
  });
  it('accepts an ArrayBuffer', async () => {
    const bytes = new TextEncoder().encode('hello');
    expect(Buffer.from(await gunzip(await gzip(bytes.buffer))).toString()).toBe('hello');
  });
  it('round-trips empty input', async () => {
    expect(Buffer.from(await gunzip(await gzip(''))).length).toBe(0);
  });
  it('accepts (and ignores) the level option — still round-trips', async () => {
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      zlib.gzip(text, { level: 9 }, (err: Error | null, out: Uint8Array) =>
        err ? reject(err) : resolve(out),
      );
    });
    expect(nodeZlib.gunzipSync(compressed).toString()).toBe(text);
  });
  it('accepts info:false (the default) as a no-op — does not throw, round-trips', async () => {
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      zlib.deflate(text, { info: false }, (err: Error | null, out: Uint8Array) =>
        err ? reject(err) : resolve(out),
      );
    });
    expect(nodeZlib.inflateSync(compressed).toString()).toBe(text);
  });
});

describe('node:zlib — corrupt input rejects with an Error (error-first holds)', () => {
  it('gunzip of garbage calls back with an Error', async () => {
    await expect(gunzip(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(Error);
  });
});

describe('node:zlib — wire/shape-affecting options throw (no silent lie)', () => {
  it('windowBits throws (CompressionStream emits a fixed max window; honoring a smaller request would emit window-15 bytes a strict zlib consumer rejects with Z_DATA_ERROR)', () => {
    expect(() => zlib.gzip(text, { windowBits: 9 }, () => {})).toThrowError(
      notImpl('zlib.gzip option: windowBits'),
    );
  });
  it('dictionary throws (preset dict changes the wire bytes — cannot honor)', () => {
    expect(() => zlib.deflate(text, { dictionary: Buffer.from('x') }, () => {})).toThrowError(
      notImpl('zlib.deflate option: dictionary'),
    );
  });
  it('info:true throws (changes return shape to {buffer,engine})', () => {
    expect(() => zlib.gzip(text, { info: true }, () => {})).toThrowError(
      notImpl('zlib.gzip option: info'),
    );
  });
  it('any truthy info throws too — Node returns {buffer,engine} for any truthy info, not just true', () => {
    // `info: 1` is caller misuse of the boolean option, but Node still takes the
    // engine-shape branch; rifty must throw, not silently return a bare Buffer.
    expect(() =>
      zlib.gzip(text, { info: 1 } as unknown as Parameters<typeof zlib.gzip>[1], () => {}),
    ).toThrowError(notImpl('zlib.gzip option: info'));
  });
});

describe('node:zlib — loud ceilings (sync / brotli / streams / unzip)', () => {
  it('gzipSync throws NotImplementedError', () => {
    expect(() => zlib.gzipSync(Buffer.from(text))).toThrowError(notImpl('zlib.gzipSync'));
  });
  it('gunzipSync throws NotImplementedError', () => {
    expect(() => zlib.gunzipSync(Buffer.from(text))).toThrowError(notImpl('zlib.gunzipSync'));
  });
  it('brotliCompress throws NotImplementedError', () => {
    expect(() => zlib.brotliCompress(Buffer.from(text), () => {})).toThrowError(
      notImpl('zlib.brotliCompress'),
    );
  });
  it('brotliDecompressSync throws NotImplementedError', () => {
    expect(() => zlib.brotliDecompressSync(Buffer.from(text))).toThrowError(
      notImpl('zlib.brotliDecompressSync'),
    );
  });
  it('createGzip throws NotImplementedError (streams deferred)', () => {
    expect(() => zlib.createGzip()).toThrowError(notImpl('zlib.createGzip'));
  });
  it('Gzip class throws on construct', () => {
    expect(() => new zlib.Gzip()).toThrowError(notImpl('zlib.Gzip'));
  });
  it('unzip throws NotImplementedError (auto-detect deferred)', () => {
    expect(() => zlib.unzip(Buffer.from(text), () => {})).toThrowError(notImpl('zlib.unzip'));
  });
});

describe('node:zlib — maxOutputLength is honored (ERR_BUFFER_TOO_LARGE), not ignored', () => {
  it('rejects when decompressed output exceeds the cap — matching Node code', async () => {
    const big = nodeZlib.gzipSync(Buffer.from('x'.repeat(5000)));
    // Node's own error shape for the same call, as the oracle.
    const nodeErr = await new Promise<NodeJS.ErrnoException>((resolve) => {
      nodeZlib.gunzip(big, { maxOutputLength: 100 }, (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(nodeErr.code).toBe('ERR_BUFFER_TOO_LARGE');
    // rifty rejects with the same code.
    await expect(gunzip(big, { maxOutputLength: 100 })).rejects.toMatchObject({
      code: 'ERR_BUFFER_TOO_LARGE',
    });
  });
  it('succeeds when output fits within the cap', async () => {
    const small = nodeZlib.gzipSync(Buffer.from('tiny'));
    expect(Buffer.from(await gunzip(small, { maxOutputLength: 1000 })).toString()).toBe('tiny');
  });
});

describe('node:zlib — legacy top-level constant aliases are NON-enumerable (Node shape)', () => {
  it('aliases are readable but excluded from Object.keys / for…in', () => {
    expect(zlib.Z_BEST_COMPRESSION).toBe(9);
    expect(Object.keys(zlib)).not.toContain('Z_BEST_COMPRESSION');
    expect(Object.keys(zlib)).not.toContain('GZIP');
    // ...while the real members stay enumerable, like Node.
    expect(Object.keys(zlib)).toContain('gzip');
    expect(Object.keys(zlib)).toContain('constants');
  });
  it('matches Node: no Z_* alias appears in Object.keys', () => {
    const nodeAliasInKeys = Object.keys(nodeZlib).filter((k) => k.startsWith('Z_'));
    const riftyAliasInKeys = Object.keys(zlib).filter((k) => k.startsWith('Z_'));
    expect(riftyAliasInKeys).toEqual(nodeAliasInKeys); // both empty
  });
});

describe('node:zlib — constants (full real Node table + legacy aliases)', () => {
  it('exposes Z_* constants with real values', () => {
    expect(zlib.constants.Z_BEST_COMPRESSION).toBe(9);
    expect(zlib.constants.Z_NO_FLUSH).toBe(0);
    expect(zlib.constants.Z_FINISH).toBe(4);
    expect(zlib.constants.Z_DEFAULT_COMPRESSION).toBe(-1);
  });
  it('exposes BROTLI_* constants (pure data, even though brotli is a ceiling)', () => {
    expect(zlib.constants.BROTLI_PARAM_QUALITY).toBe(1);
    expect(zlib.constants.BROTLI_MAX_QUALITY).toBe(11);
  });
  it('mirrors the entire Node constants table', () => {
    for (const [k, v] of Object.entries(nodeZlib.constants)) {
      expect(zlib.constants[k as keyof typeof zlib.constants]).toBe(v);
    }
  });
  it('exposes legacy top-level Z_* aliases (Node shape)', () => {
    expect(zlib.Z_BEST_COMPRESSION).toBe(9);
  });
  it('exposes the codes map', () => {
    expect(zlib.codes.Z_OK).toBe(0);
    expect(zlib.codes['0']).toBe('Z_OK');
  });
  it('codes is frozen, matching Node (constants is NOT frozen in Node — matched too)', () => {
    expect(Object.isFrozen(zlib.codes)).toBe(true);
    expect(Object.isFrozen(zlib.codes)).toBe(Object.isFrozen(nodeZlib.codes));
    expect(Object.isFrozen(zlib.constants)).toBe(Object.isFrozen(nodeZlib.constants));
  });
});
