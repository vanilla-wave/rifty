// What node:zlib's brotli and zstd members do on this host: the result kind, or the error's name,
// code and first message line. Node v24.16.0 has both families (deps/brotli, deps/zstd).
const zlib = require('node:zlib');
const input = Buffer.from('hello hello hello hello');
const kind = (v) => (Buffer.isBuffer(v) ? `Buffer(${v.length})` : typeof v);
const err = (e) =>
  `threw ${e.name}${e.code ? ` ${e.code}` : ''}: ${String(e.message).split('\n')[0].slice(0, 90)}`;
const rows = [
  ['brotliCompressSync', () => kind(zlib.brotliCompressSync(input))],
  [
    'brotliDecompressSync(brotliCompressSync)',
    () => zlib.brotliDecompressSync(zlib.brotliCompressSync(input)).toString(),
  ],
  ['createBrotliCompress', () => typeof zlib.createBrotliCompress().write],
  ['createBrotliDecompress', () => typeof zlib.createBrotliDecompress().write],
  ['new zlib.BrotliCompress()', () => typeof new zlib.BrotliCompress().write],
  ['constants.BROTLI_PARAM_QUALITY', () => String(zlib.constants.BROTLI_PARAM_QUALITY)],
  ['zstdCompressSync', () => kind(zlib.zstdCompressSync(input))],
  [
    'zstdDecompressSync(zstdCompressSync)',
    () => zlib.zstdDecompressSync(zlib.zstdCompressSync(input)).toString(),
  ],
  ['createZstdCompress', () => typeof zlib.createZstdCompress().write],
  ['createZstdDecompress', () => typeof zlib.createZstdDecompress().write],
  ['new zlib.ZstdCompress()', () => typeof new zlib.ZstdCompress().write],
  ['constants.ZSTD_c_compressionLevel', () => String(zlib.constants.ZSTD_c_compressionLevel)],
];
(async () => {
  for (const [name, fn] of rows) {
    let out;
    try {
      out = fn();
    } catch (e) {
      out = err(e);
    }
    console.log(`${name} => ${out}`);
  }
  for (const [name, call] of [
    ['brotliCompress(cb)', (cb) => zlib.brotliCompress(input, cb)],
    ['zstdCompress(cb)', (cb) => zlib.zstdCompress(input, cb)],
  ]) {
    const out = await new Promise((res) => {
      try {
        call((e, v) => res(e ? err(e) : kind(v)));
      } catch (e) {
        res(err(e));
      }
      setTimeout(() => res('no callback in 2s'), 2000);
    });
    console.log(`${name} => ${out}`);
  }
  process.exit(0);
})();
