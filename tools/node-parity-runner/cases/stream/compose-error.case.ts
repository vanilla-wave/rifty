import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.compose` destroy-on-error: a stage erroring makes the composed Duplex
 * emit that error AND every stage `.destroyed === true`. Asserted head-to-head
 * against real Node.
 */
const c: ParityCase = {
  code: `
    const { compose, Transform } = require('node:stream');
    (async () => {
      const s0 = new Transform({ objectMode: true, transform(c, e, cb) { cb(null, String(c).toUpperCase()); } });
      const boom = new Error('stage-boom');
      const s1 = new Transform({ objectMode: true, transform(c, e, cb) { cb(boom); } });
      const composed = compose(s0, s1);
      let errMsg = 'none';
      composed.on('error', (e) => { errMsg = e.message; });
      composed.end('x');
      await new Promise((r) => setTimeout(r, 20));
      console.log('error:' + errMsg);
      console.log('s0-destroyed:' + s0.destroyed);
      console.log('s1-destroyed:' + s1.destroyed);
    })();
  `,
};

export default c;
