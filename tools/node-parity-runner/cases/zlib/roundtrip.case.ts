import type { ParityCase } from '../../src/types.ts';

// Round-trips every implemented format through the async one-shot API (promisified)
// and prints the decoded text — identical in Node (native zlib) and rifty
// (CompressionStream). ESM + top-level await so the runner sees settled output.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { promisify } from 'node:util';
    import zlib from 'node:zlib';

    const text = 'The quick brown fox 🦊 jumps over the lazy dog. '.repeat(30);
    const pairs = [
      ['gzip', 'gunzip'],
      ['deflate', 'inflate'],
      ['deflateRaw', 'inflateRaw'],
    ];
    for (const [compress, decompress] of pairs) {
      const c = promisify(zlib[compress]);
      const d = promisify(zlib[decompress]);
      const packed = await c(text);
      const back = Buffer.from(await d(packed)).toString();
      console.log(compress + ':', back === text ? 'roundtrip-ok' : 'MISMATCH', 'compressed>0', packed.length > 0);
    }
  `,
};

export default c;
