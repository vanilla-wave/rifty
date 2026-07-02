import type { ParityCase } from '../../src/types.ts';

/**
 * `readable.iterator({ destroyOnReturn })`: default (`true`) destroys the source
 * on `return()`; `false` leaves it undestroyed. Asserted head-to-head vs real
 * Node. (`{signal}` abort has its own case so each keeps a short async tail.)
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      // destroyOnReturn:false → return() does NOT destroy.
      const rA = Readable.from([1, 2, 3, 4, 5]);
      const itA = rA.iterator({ destroyOnReturn: false });
      const a = await itA.next();
      await itA.return();
      await delay(5);
      console.log('nodestroy:first=' + a.value + ',destroyed=' + rA.destroyed);

      // default (destroyOnReturn:true) → return() DOES destroy.
      const rB = Readable.from([1, 2, 3, 4, 5]);
      const itB = rB.iterator();
      const b = await itB.next();
      await itB.return();
      await delay(5);
      console.log('default:first=' + b.value + ',destroyed=' + rB.destroyed);
    })();
  `,
};

export default c;
