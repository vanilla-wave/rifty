import type { ParityCase } from '../../src/types.ts';

// Size/perf knobs (`level`/`memLevel`/`strategy`/`chunkSize`/`flush`/`finishFlush`)
// + `info:false` are accepted no-ops in BOTH runtimes (ADR-0159): real Node applies them, rifty
// ignores them, but both emit a VALID stream that round-trips. Pinning the
// round-trip — NOT the bytes, which legitimately differ like `level` already
// does — proves rifty does not throw where Node accepts these and that the output
// stays decodable. (`windowBits`/`dictionary`/truthy-`info` THROW in rifty and so
// diverge from Node by design — exercised rifty-only in the conformance suite, not
// here.)
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { promisify } from 'node:util';
    import zlib from 'node:zlib';

    const text = 'parity option-ignored fixture 🦊 ' + 'y'.repeat(60);
    const gzip = promisify(zlib.gzip);
    const gunzip = promisify(zlib.gunzip);
    const deflate = promisify(zlib.deflate);
    const inflate = promisify(zlib.inflate);

    const a = await gzip(text, {
      level: 9,
      memLevel: 8,
      strategy: 0,
      chunkSize: 1024,
      flush: zlib.constants.Z_SYNC_FLUSH,
      finishFlush: zlib.constants.Z_FINISH,
    });
    console.log('gzip+knobs:', Buffer.from(await gunzip(a)).toString() === text ? 'roundtrip-ok' : 'MISMATCH');

    const b = await deflate(text, { level: 1, strategy: 0, info: false });
    console.log('deflate+knobs+info:false:', Buffer.from(await inflate(b)).toString() === text ? 'roundtrip-ok' : 'MISMATCH');
  `,
};

export default c;
