import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.compose` mixing a `Transform` and an async-generator-function stage
 * drains end-to-end (`compose(upper, <…>).end('hi')` → `['<HI>']`). Asserted
 * head-to-head vs Node.
 */
const c: ParityCase = {
  code: `
    const { compose, Transform } = require('node:stream');
    (async () => {
      const d = compose(
        new Transform({ objectMode: true, transform(c, e, cb) { cb(null, String(c).toUpperCase()); } }),
        async function* (src) { for await (const c of src) yield '<' + c + '>'; },
      );
      const out = [];
      d.on('data', (c) => out.push(c));
      d.end('hi');
      await new Promise((r) => setTimeout(r, 15));
      console.log('mixed-drain:' + JSON.stringify(out));
    })();
  `,
};

export default c;
