/**
 * Per Node docs (`stream.pipeline`): on error in any stage of the chain,
 * `pipeline` calls `destroy(err)` on every other stage. This guarantees the
 * upstream readable stops pumping into a dead writable, releasing any resource
 * (timer, FD, network handle) the source holds.
 *
 * Test pattern: a Readable that keeps push'ing on a timer, piped through a
 * Transform whose `_transform` cb errors on the second chunk. After the error
 * fires, the readable's `destroy` must have been called.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable, Transform, Writable, pipeline } = require('node:stream');

    let destroyed = false;
    const src = new Readable({
      read() {},
    });
    const origDestroy = src.destroy.bind(src);
    src.destroy = function(err) {
      destroyed = true;
      return origDestroy(err);
    };

    let chunkCount = 0;
    const fail = new Transform({
      transform(chunk, _enc, cb) {
        chunkCount++;
        if (chunkCount === 2) {
          cb(new Error('mid-stream-fail'));
          return;
        }
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      write(_c, _e, cb) { cb(); },
    });

    pipeline(src, fail, sink, (err) => {
      console.log('err:' + (err ? err.message : 'none'));
      console.log('src-destroyed:' + destroyed);
    });
    src.push('a');
    src.push('b');
    // 'b' triggers the transform error; pipeline must then destroy src.
  `,
};

export default c;
