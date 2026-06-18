/**
 * Per Node (`Writable`): when a `_write` callback is invoked with an error, the
 * stream is destroyed with that error — the failing chunk's callback gets it,
 * `'error'` is emitted, `_writableState.destroyed` flips true, and EVERY
 * still-buffered write callback is errored (not silently dropped).
 *
 * Our previous drain loop errored only the failing chunk's callback and stopped,
 * leaving queued chunks' callbacks uncalled and `destroyed === false`. Booleans
 * (not message text) are asserted so Node's ERR_STREAM_DESTROYED vs the
 * originating error for buffered callbacks doesn't make this version-fragile.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const events = [];
    const w = new Writable({
      highWaterMark: 1, // every write past the first overflows -> all queue
      write(chunk, _enc, cb) {
        cb(String(chunk) === 'c1' ? new Error('write-failed') : undefined);
      },
    });
    w.on('error', (err) => events.push('error:' + err.message));
    w.write('c1', (err) => events.push('cb-c1:' + (err ? 'err' : 'ok')));
    w.write('c2', (err) => events.push('cb-c2:' + (err ? 'err' : 'ok')));
    setTimeout(() => {
      console.log('cb-c1-errored:' + events.includes('cb-c1:err'));
      console.log('cb-c2-errored:' + events.includes('cb-c2:err'));
      console.log('emitted-error:' + events.includes('error:write-failed'));
      console.log('destroyed:' + w.destroyed);
    }, 15);
  `,
};

export default c;
