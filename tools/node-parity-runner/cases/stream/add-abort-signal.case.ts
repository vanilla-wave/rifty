import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.addAbortSignal(signal, s)` vs real Node: returns `s`; aborting the
 * signal destroys `s`, emitting `'error'` with an `AbortError` whose
 * `code === 'ABORT_ERR'`; an already-aborted signal destroys immediately.
 */
const c: ParityCase = {
  code: `
    const s = require('node:stream');
    const { Readable } = s;
    (async () => {
      const ac = new AbortController();
      const r = new Readable({ read() {} });
      console.log('returns-same:' + (s.addAbortSignal(ac.signal, r) === r));
      r.on('error', (err) => {
        console.log('err-name:' + err.name);
        console.log('err-code:' + err.code);
      });
      ac.abort();
      await new Promise((res) => setTimeout(res, 10));
      console.log('destroyed:' + r.destroyed);

      // Already-aborted signal destroys immediately.
      const ac2 = new AbortController();
      ac2.abort();
      const r2 = new Readable({ read() {} });
      r2.on('error', () => {});
      s.addAbortSignal(ac2.signal, r2);
      await new Promise((res) => setTimeout(res, 10));
      console.log('already-aborted-destroyed:' + r2.destroyed);
    })();
  `,
};

export default c;
