import type { ParityCase } from '../../src/types.ts';

/**
 * Nested `cork(); cork(); write('x'); uncork(); /* still corked *​/ uncork()` →
 * the buffered chunk flushes only after the SECOND uncork (cork counter returns
 * to 0). Asserted vs real Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const log = [];
    const w = new Writable({
      objectMode: true,
      writev(chunks, cb) { log.push('writev:' + chunks.map((e) => e.chunk).join('+')); cb(); },
    });
    w.cork();
    w.cork();
    w.write('x', 'utf8');
    w.uncork();
    log.push('after-first-uncork-len:' + w.writableLength);
    w.uncork();
    log.push('after-second-uncork-len:' + w.writableLength);
    w.end(() => console.log(log.join(' | ')));
  `,
};

export default c;
