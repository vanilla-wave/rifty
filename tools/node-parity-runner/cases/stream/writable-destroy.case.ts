/**
 * Per Node docs (`Writable.destroy(err?)`):
 *   - Flips `_writableState.destroyed = true`.
 *   - Pending callbacks for buffered writes get invoked with the error (or a
 *     premature-close error if no err was supplied).
 *   - Subsequent `write(chunk, cb)` calls invoke `cb(err)` and return `false`.
 *   - `'error'` (if err) and then `'close'` fire in that order.
 *
 * Our previous `destroy()` emitted `error`+`close` but did not flip the
 * destroyed flag, did not error pending callbacks, and silently accepted
 * subsequent writes. This diverges visibly for any caller that destroys a
 * stream mid-flight — e.g. pipeline()'s cleanup, or a connection aborting in
 * http.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const w = new Writable({
      highWaterMark: 4,
      write(_chunk, _enc, cb) {
        // Defer so writes pile up — destroy() should error the queued ones.
        setTimeout(cb, 10);
      },
    });
    const events = [];
    w.on('error', (err) => events.push('error:' + err.message));
    w.on('close', () => events.push('close'));
    // Queue some writes.
    w.write('aaaa');
    w.write('bbbb', (err) => {
      events.push('cb-bbbb:' + (err ? err.message : 'ok'));
    });
    w.destroy(new Error('boom'));
    // Subsequent write after destroy must invoke its callback with an error
    // and return false synchronously.
    const ret = w.write('cccc', (err) => {
      events.push('cb-cccc:' + (err ? err.message : 'ok'));
    });
    events.push('post-destroy-write:' + ret);
    // Wait a few microtask/timer ticks for async callbacks (close emit, post-
    // destroy write cb) to flush. We assert presence rather than ordering
    // because Node's queued-cb vs close-emit ordering varies between versions.
    setTimeout(() => {
      const hasError = events.some((e) => e === 'error:boom');
      const hasClose = events.some((e) => e === 'close');
      const hasPostWrite = events.some((e) => e === 'post-destroy-write:false');
      console.log('error:' + hasError);
      console.log('close:' + hasClose);
      console.log('post-write-false:' + hasPostWrite);
    }, 15);
  `,
};

export default c;
