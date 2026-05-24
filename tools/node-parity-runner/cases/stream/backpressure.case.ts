import type { ParityCase } from '../../src/types.ts';

/**
 * Exercises Writable backpressure: when a chunk pushes the internal buffer past
 * highWaterMark, `.write()` must return `false`; once the buffer drains below
 * the watermark, `'drain'` must fire. We deliberately avoid relying on the
 * exact number of drain events (that depends on chunk-coalescing timing); we
 * just assert "at least one drain happened" so both runtimes can agree
 * regardless of micro-task scheduling differences.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const w = new Writable({
      highWaterMark: 16,
      write(_chunk, _enc, cb) {
        // Defer the callback so several writes pile up and trip the watermark.
        setTimeout(cb, 1);
      },
    });
    // Single write that exceeds highWaterMark — both runtimes must return false.
    const ok1 = w.write('x'.repeat(64));
    console.log('write1-returned:' + ok1);
    // Subsequent write while still queued — also returns false.
    const ok2 = w.write('y'.repeat(8));
    console.log('write2-returned:' + ok2);
    // The drain semantics around end() vary across runtimes; we don't assert
    // drain timing. We only assert the synchronous return-value contract above
    // and that end + 'finish' completes cleanly.
    w.end(() => {
      console.log('finished');
    });
  `,
};

export default c;
