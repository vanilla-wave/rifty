import type { ParityCase } from '../../src/types.ts';

/**
 * `Duplex.from(asyncGeneratorFunction)`: written chunks become the body's
 * `source`; its yields are the readable side. `write('ab')`/`write('cd')` →
 * readable yields `'AB'`/`'CD'` (instanceof Duplex). Asserted head-to-head vs
 * Node.
 */
const c: ParityCase = {
  code: `
    const { Duplex } = require('node:stream');
    (async () => {
      const d = Duplex.from(async function* (src) { for await (const c of src) yield String(c).toUpperCase(); });
      console.log('fn-instance:' + (d instanceof Duplex));
      const out = [];
      d.on('data', (c) => out.push(c));
      d.write('ab'); d.write('cd'); d.end();
      await new Promise((r) => setTimeout(r, 15));
      console.log('fn-data:' + JSON.stringify(out));
    })();
  `,
};

export default c;
