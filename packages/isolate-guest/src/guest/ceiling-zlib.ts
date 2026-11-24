/**
 * The guest's `node:zlib` (ADR-0557 §6, 2026-11-24): Node v24.16.0's export list
 * in its order and its class chains (`Gzip` → `Zlib` → `ZlibBase` → `Transform`).
 * Real: `constants`, `codes`, the legacy top-level constants. Every compression,
 * decompression and checksum member is a named gap: the host has no engine.
 */
import { Transform } from '@riftydev/io';
import { ZLIB_CODES, ZLIB_CONSTANTS } from '@riftydev/runtime-js/internal';
import { type Base, loudClass, loudFunction } from './egress-gaps.ts';

const NO_ENGINE =
  'no compression engine in the rifty isolate host (rifty zlib runs on web CompressionStream, absent here), ADR-0557';
const NO_CRC32 = 'not implemented in rifty yet, on any host: backlog runtime-js/zlib-crc32';

const ONE_SHOTS = [
  'deflate',
  'gzip',
  'deflateRaw',
  'unzip',
  'inflate',
  'gunzip',
  'inflateRaw',
  'brotliCompress',
  'brotliDecompress',
  'zstdCompress',
  'zstdDecompress',
] as const;
const STREAMS = [
  'Deflate',
  'Inflate',
  'DeflateRaw',
  'InflateRaw',
  'Gzip',
  'Gunzip',
  'Unzip',
  'BrotliCompress',
  'BrotliDecompress',
  'ZstdCompress',
  'ZstdDecompress',
] as const;

export function createZlib(): Record<string, unknown> {
  const cls = (name: string, length: number, base: Base, es6 = false) =>
    loudClass(name, length, `zlib.${name}`, base, NO_ENGINE, es6);
  // Node's internal bases (not exported): `ZlibBase(opts, mode, handle, flushes)`.
  const ZlibBase = cls('ZlibBase', 4, Transform);
  const Zlib = cls('Zlib', 2, ZlibBase);
  const Brotli = cls('Brotli', 2, Zlib);
  const Zstd = cls('Zstd', 4, ZlibBase, true);
  const classes: Record<(typeof STREAMS)[number], Base> = {
    Deflate: cls('Deflate', 1, Zlib),
    Inflate: cls('Inflate', 1, Zlib),
    DeflateRaw: cls('DeflateRaw', 1, Zlib),
    InflateRaw: cls('InflateRaw', 1, Zlib),
    Gzip: cls('Gzip', 1, Zlib),
    Gunzip: cls('Gunzip', 1, Zlib),
    Unzip: cls('Unzip', 1, Zlib),
    BrotliCompress: cls('BrotliCompress', 1, Brotli),
    BrotliDecompress: cls('BrotliDecompress', 1, Brotli),
    ZstdCompress: cls('ZstdCompress', 1, Zstd, true),
    ZstdDecompress: cls('ZstdDecompress', 1, Zstd, true),
  };
  const zlib: Record<string, unknown> = {
    crc32: loudFunction('crc32', 1, 'zlib.crc32', NO_CRC32),
  };
  for (const name of [
    'Deflate',
    'Inflate',
    'Gzip',
    'Gunzip',
    'DeflateRaw',
    'InflateRaw',
    'Unzip',
    'BrotliCompress',
    'BrotliDecompress',
    'ZstdCompress',
    'ZstdDecompress',
  ] as const)
    zlib[name] = classes[name];
  for (const fn of ONE_SHOTS) {
    zlib[fn] = loudFunction('asyncBufferWrapper', 3, `zlib.${fn}`, NO_ENGINE);
    zlib[`${fn}Sync`] = loudFunction('syncBufferWrapper', 2, `zlib.${fn}Sync`, NO_ENGINE);
  }
  // Node's `create*` are read-only `{ value: function(options) … }` descriptors: name `value`.
  for (const name of STREAMS)
    Object.defineProperty(zlib, `create${name}`, {
      value: loudFunction('value', 1, `zlib.create${name}`, NO_ENGINE),
      enumerable: true,
      configurable: true,
    });
  Object.defineProperties(zlib, {
    constants: { value: ZLIB_CONSTANTS, enumerable: true },
    codes: { value: ZLIB_CODES, enumerable: true },
  });
  // Node mirrors every non-`BROTLI_` constant onto the module, read-only and not enumerable.
  for (const [key, value] of Object.entries(ZLIB_CONSTANTS))
    if (!key.startsWith('BROTLI_')) Object.defineProperty(zlib, key, { value });
  return zlib;
}
