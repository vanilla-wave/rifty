import type { ParityCase } from '../../src/types.ts';

// Node's Timeout exposes a [Symbol.toPrimitive] id, and clearTimeout/clearInterval
// honor that coerced numeric id. A self-clearing interval that calls
// `clearInterval(Number(handle))` on its first tick must stop after exactly one
// tick — in Node and in rifty alike. A regression where the numeric id misses the
// handle (no-op clear) would keep firing → ticks diverge. The trailing wait uses
// `node:timers/promises` (the keepalive-drained delay the harness awaits) so the
// observation is captured. No `expected`: compared head to head against real Node.
const c: ParityCase = {
  code: `
    const { setTimeout: delay } = require('node:timers/promises');
    (async () => {
      let ticks = 0;
      const handle = setInterval(() => {
        ticks++;
        clearInterval(Number(handle));
      }, 5);
      await delay(40);
      console.log('ticks ' + ticks);
    })();
  `,
};

export default c;
