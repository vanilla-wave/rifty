import type { ParityCase } from '../../src/types.ts';

// Pins the requireable `node:zlib` surface (ADR-0159): every member RESOLVES and
// is the right typeof in both runtimes. Implemented members (gzip/gunzip/…) and
// loud-ceiling members (gzipSync/brotli*/create*/classes) are all `function`; the
// *invocation* divergence (rifty's ceilings throw NotImplementedError where Node
// runs) is a by-design contract, exercised rifty-only in the conformance suite,
// not here — calling them would diverge from Node and isn't the surface contract.
const c: ParityCase = {
  code: `
    const zlib = require('node:zlib');

    // Implemented — web-compression-backed async one-shot.
    for (const name of ['gzip','gunzip','deflate','inflate','deflateRaw','inflateRaw']) {
      console.log(name, typeof zlib[name]);
    }
    // Sync + auto-detect ceilings.
    for (const name of ['gzipSync','gunzipSync','deflateSync','inflateSync','deflateRawSync','inflateRawSync','unzip','unzipSync']) {
      console.log(name, typeof zlib[name]);
    }
    // Brotli + zstd + crc32 ceilings (full Node-24 member set).
    for (const name of ['brotliCompress','brotliCompressSync','brotliDecompress','brotliDecompressSync','zstdCompress','zstdCompressSync','zstdDecompress','zstdDecompressSync','crc32']) {
      console.log(name, typeof zlib[name]);
    }
    // Transform-stream factories + classes.
    for (const name of ['createGzip','createGunzip','createDeflate','createInflate','createDeflateRaw','createInflateRaw','createUnzip','createBrotliCompress','createBrotliDecompress','createZstdCompress','createZstdDecompress']) {
      console.log(name, typeof zlib[name]);
    }
    for (const name of ['Gzip','Gunzip','Deflate','Inflate','DeflateRaw','InflateRaw','Unzip','BrotliCompress','BrotliDecompress','ZstdCompress','ZstdDecompress']) {
      console.log(name, typeof zlib[name]);
    }
    // Pure data.
    console.log('constants', typeof zlib.constants);
    console.log('codes', typeof zlib.codes);

    // Legacy top-level constant aliases are NON-enumerable (Node shape):
    // present + readable, but excluded from Object.keys / for…in.
    console.log('Z_alias=' + zlib.Z_BEST_COMPRESSION);
    console.log('Z_enumerable=' + Object.keys(zlib).includes('Z_BEST_COMPRESSION'));
    console.log('GZIP_enumerable=' + Object.keys(zlib).includes('GZIP'));
    console.log('constants_enumerable=' + Object.keys(zlib).includes('constants'));

    // Bare specifier resolves to the same module object.
    console.log('bare === node', require('zlib') === zlib ? 1 : 0);
  `,
};

export default c;
