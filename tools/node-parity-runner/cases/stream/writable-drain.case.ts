/**
 * Writable 'drain' protocol: Node only emits `'drain'` when a prior `write()`
 * returned `false` (buffer ≥ HWM). Small writes that never trip backpressure
 * must NOT emit `'drain'`. Once a write returns `false`, a single `'drain'`
 * fires after the buffer falls below HWM.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');

    // 1) Small writes under HWM — must not trip 'drain'.
    let drainsSmall = 0;
    const small = new Writable({
      highWaterMark: 64,
      write(_chunk, _enc, cb) { setTimeout(cb, 0); },
    });
    small.on('drain', () => { drainsSmall += 1; });
    const ok1 = small.write('a'.repeat(4));
    const ok2 = small.write('b'.repeat(4));
    console.log('small-write1:' + ok1);
    console.log('small-write2:' + ok2);

    small.end(() => {
      console.log('small-finish');
      console.log('small-drains:' + drainsSmall);

      // 2) Big write over HWM — must trip 'drain' at least once before end().
      let drainsBig = 0;
      const big = new Writable({
        highWaterMark: 16,
        write(_chunk, _enc, cb) { setTimeout(cb, 0); },
      });
      big.on('drain', () => {
        drainsBig += 1;
        // end() only after drain has fired, so we don't race with the
        // ending-state suppression Node applies.
        big.end(() => {
          console.log('big-finish');
          console.log('big-drains-at-least-one:' + (drainsBig >= 1));
        });
      });
      const okBig = big.write('x'.repeat(128));
      console.log('big-write:' + okBig);
    });
  `,
};

export default c;
