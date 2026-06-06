import type { ParityCase } from '../../src/types.ts';

// Guards the single-listener emit() fast path (#2): a once() listener removes
// itself from `arr` BEFORE its body runs, so listenerCount is 0 mid-call; emit
// must still return true, and a second emit fires nothing.
const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const ee = new EventEmitter();
    const seen = [];
    ee.once('e', (v) => { seen.push(v); seen.push(ee.listenerCount('e')); });
    seen.push(ee.emit('e', 1));
    seen.push(ee.emit('e', 2));
    console.log(JSON.stringify(seen));
  `,
};

export default c;
