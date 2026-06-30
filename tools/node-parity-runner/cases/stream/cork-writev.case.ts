import type { ParityCase } from '../../src/types.ts';

/**
 * `w.cork(); w.write('a'); w.write('b'); w.uncork()` with a `_writev` → exactly
 * ONE `_writev` call carrying the buffered chunks in order, in Node's
 * `{chunk, encoding}` entry shape. Object mode + explicit `'utf8'` encodings so
 * the entry shape is byte-identical across runtimes (byte-mode string→Buffer
 * encoding coercion is a separate, pre-existing difference). Asserted vs Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const calls = [];
    const w = new Writable({
      objectMode: true,
      writev(chunks, cb) {
        calls.push(chunks.map((e) => e.chunk + '/' + e.encoding));
        cb();
      },
      write(chunk, enc, cb) {
        calls.push(['WRITE:' + chunk]);
        cb();
      },
    });
    w.cork();
    w.write('a', 'utf8');
    w.write('b', 'utf8');
    w.uncork();
    w.end(() => {
      console.log('call-count:' + calls.length);
      console.log('call-0:' + JSON.stringify(calls[0]));
    });
  `,
};

export default c;
