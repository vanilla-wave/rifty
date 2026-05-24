import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { EventEmitter, once } = require('node:events');
    const ee = new EventEmitter();
    once(ee, 'ready').then((args) => console.log('got: ' + JSON.stringify(args)));
    setTimeout(() => ee.emit('ready', 'hello', 42), 1);
  `,
};

export default c;
