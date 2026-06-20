import type { ParityCase } from '../../src/types.ts';

// The wire-interop proof: decompress bytes PRODUCED BY REAL NODE's zlib (embedded
// hex below, from `zlib.gzipSync`/`deflateSync`/`deflateRawSync`). Node decodes its
// own bytes natively; rifty decodes them via DecompressionStream. Both must yield
// the same original string — so rifty genuinely reads Node's RFC-1952/1950/1951
// wire format (ADR-0158), not just its own round-trip.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { promisify } from 'node:util';
    import zlib from 'node:zlib';

    const expected =
      'rifty zlib cross-format decode fixture — 🦊 αβγ — ' + 'x'.repeat(80);

    const GZIP_HEX =
      '1f8b08000000000000132bca4c2ba954a8cac94c52482eca2f2ed64dcb2fca4d2c5148494dce4f495548cbac28292d4a5578d43045e1c3fc655d0ae7369edb746e33985f41650000bd9bcaf68b000000';
    const DEFLATE_HEX =
      '789c2bca4c2ba954a8cac94c52482eca2f2ed64dcb2fca4d2c5148494dce4f495548cbac28292d4a5578d43045e1c3fc655d0ae7369edb746e33985f41650000072d3ff6';
    const DEFLATERAW_HEX =
      '2bca4c2ba954a8cac94c52482eca2f2ed64dcb2fca4d2c5148494dce4f495548cbac28292d4a5578d43045e1c3fc655d0ae7369edb746e33985f41650000';

    const gunzip = promisify(zlib.gunzip);
    const inflate = promisify(zlib.inflate);
    const inflateRaw = promisify(zlib.inflateRaw);

    const g = Buffer.from(await gunzip(Buffer.from(GZIP_HEX, 'hex'))).toString();
    const d = Buffer.from(await inflate(Buffer.from(DEFLATE_HEX, 'hex'))).toString();
    const r = Buffer.from(await inflateRaw(Buffer.from(DEFLATERAW_HEX, 'hex'))).toString();

    console.log('gunzip-node-bytes:', g === expected ? 'ok' : 'MISMATCH');
    console.log('inflate-node-bytes:', d === expected ? 'ok' : 'MISMATCH');
    console.log('inflateRaw-node-bytes:', r === expected ? 'ok' : 'MISMATCH');
  `,
};

export default c;
