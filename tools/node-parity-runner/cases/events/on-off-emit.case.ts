import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const ee = new EventEmitter();
    const calls = [];
    const handler = (...a) => calls.push(['h', ...a]);
    ee.on('boom', handler);
    ee.emit('boom', 1, 2);
    ee.once('once', (v) => calls.push(['once', v]));
    ee.emit('once', 'first');
    ee.emit('once', 'second');
    ee.off('boom', handler);
    ee.emit('boom', 99);
    console.log(JSON.stringify(calls));
  `,
};

export default c;
