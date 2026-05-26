/**
 * `pipe()` to two writables, `unpipe(w1)`, then push data: only `w2` must
 * receive bytes. This pins the routing contract (post-unpipe writes don't
 * leak to the unpiped sink) — both runtimes must agree on which sink got
 * which bytes.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable, Writable } = require('node:stream');
    const seen1 = [];
    const seen2 = [];
    const w1 = new Writable({
      write(chunk, _enc, cb) { seen1.push(chunk.toString()); cb(); },
    });
    const w2 = new Writable({
      write(chunk, _enc, cb) { seen2.push(chunk.toString()); cb(); },
    });
    const r = new Readable({ read() {} });
    r.pipe(w1);
    r.pipe(w2);
    // Push before unpipe — should reach both (we don't assert that, just
    // sanity).
    r.push('first');
    setImmediate(() => {
      r.unpipe(w1);
      r.push('after-unpipe');
      r.push(null);
      // Wait for both ends to settle.
      w1.once('finish', () => {});
      w2.on('finish', () => {
        console.log('w1-includes-after:' + seen1.includes('after-unpipe'));
        console.log('w2-includes-after:' + seen2.includes('after-unpipe'));
        console.log('w1-includes-first:' + seen1.includes('first'));
        console.log('w2-includes-first:' + seen2.includes('first'));
      });
    });
  `,
};

export default c;
