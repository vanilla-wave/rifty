import type { ParityCase } from '../../src/types.ts';

/**
 * A `Readable` that errors mid-stream → the web reader rejects with THAT error
 * (its `message`), not a generic one. Asserted head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      // Object mode so the pushed chunk passes through identically in both
      // runtimes — this case isolates error PROPAGATION, not chunk encoding.
      const r = new Readable({ objectMode: true, read() {} });
      const web = Readable.toWeb(r);
      const reader = web.getReader();
      r.push('first');
      const a = await reader.read();
      console.log('a:' + a.value);
      r.destroy(new Error('boom'));
      try {
        await reader.read();
        console.log('no-error');
      } catch (err) {
        console.log('err:' + err.message);
      }
    })();
  `,
};

export default c;
