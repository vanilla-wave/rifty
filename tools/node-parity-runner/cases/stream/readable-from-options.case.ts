/**
 * `Readable.from(iter, opts)` — `options.objectMode` is honoured when
 * supplied. Note: Node defaults to objectMode `true` regardless of the
 * iterable's element type; rifty (per the 2026-05-26 streams review)
 * detects byte-vs-object from the first chunk when objectMode is NOT given,
 * which diverges from Node — so we only assert on the path the two agree
 * on: explicit `objectMode` wins. Both runtimes must report the same value.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    // 1. Explicit objectMode true wins over any inference.
    const r1 = Readable.from(['a','b','c'], { objectMode: true });
    console.log('r1.objectMode:' + r1.readableObjectMode);
    // 2. highWaterMark passes through.
    const r2 = Readable.from(['x'], { highWaterMark: 7 });
    console.log('r2.hwm:' + r2.readableHighWaterMark);
    // 3. Non-iterable throws synchronously.
    let threw = false;
    try { Readable.from(42); } catch (e) { threw = e && e.name === 'TypeError'; }
    console.log('non-iterable-typeerror:' + threw);
  `,
};

export default c;
