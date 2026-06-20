import type { ParityCase } from '../../src/types.ts';

// The async one-shot accepts string / Buffer / Uint8Array / empty input — pinned
// identical across Node and rifty (ADR-0159). Prints decoded text + lengths so a
// divergent input-normalisation path shows up loud.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { promisify } from 'node:util';
    import zlib from 'node:zlib';

    const gzip = promisify(zlib.gzip);
    const gunzip = promisify(zlib.gunzip);

    // string input (utf-8)
    console.log('string:', Buffer.from(await gunzip(await gzip('héllo 🦊'))).toString());
    // Buffer input
    console.log('buffer:', Buffer.from(await gunzip(await gzip(Buffer.from('buf-input')))).toString());
    // Uint8Array input
    console.log('u8:', Buffer.from(await gunzip(await gzip(new TextEncoder().encode('u8-input')))).toString());
    // empty input round-trips to empty
    console.log('empty-len:', Buffer.from(await gunzip(await gzip(''))).length);
  `,
};

export default c;
