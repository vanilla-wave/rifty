import type { ParityCase } from '../../src/types.ts';

/**
 * Cork/uncork WITHOUT a `_writev` → the buffered chunks fall back to sequential
 * `_write` calls, order preserved. Asserted vs real Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    const calls = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) { calls.push(String(chunk)); cb(); },
    });
    w.cork();
    w.write('a', 'utf8');
    w.write('b', 'utf8');
    w.write('c', 'utf8');
    w.uncork();
    w.end(() => console.log('writes:' + calls.join(',')));
  `,
};

export default c;
