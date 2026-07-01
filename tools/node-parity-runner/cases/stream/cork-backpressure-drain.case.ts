import type { ParityCase } from '../../src/types.ts';

/**
 * A corked stream still reports backpressure (`write()` → `false` past
 * `highWaterMark`) and emits `'drain'` after `uncork()` flushes. The `_writev`
 * is async (deferred cb) so backpressure persists until the batch drains.
 * Asserted vs real Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const log = [];
    const w = new Writable({
      objectMode: true,
      highWaterMark: 2,
      writev(_chunks, cb) { setTimeout(cb, 1); },
      write(_c, _e, cb) { setTimeout(cb, 1); },
    });
    // end() AFTER 'drain' fires — Node suppresses 'drain' once ending, so we
    // observe the post-uncork drain first (same convention as writable-drain).
    w.on('drain', () => {
      log.push('drain');
      w.end(() => console.log(log.join(' | ')));
    });
    w.cork();
    const r1 = w.write('a', 'utf8');
    const r2 = w.write('b', 'utf8');
    const r3 = w.write('c', 'utf8');
    log.push('r1=' + r1 + ' r2=' + r2 + ' r3=' + r3);
    w.uncork();
  `,
};

export default c;
