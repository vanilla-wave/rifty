import type { ParityCase } from '../../src/types.ts';

// Legacy ecosystem constructors still use this exact Node idiom (nodemon's
// dependency tree included): invoke EventEmitter as a function, then inherit
// its prototype with util.inherits. The callable constructor and the modern
// `new EventEmitter()` form are one public contract.
const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const { inherits } = require('node:util');

    function Bus() {
      EventEmitter.call(this);
    }
    inherits(Bus, EventEmitter);

    const bus = new Bus();
    const seen = [];
    bus.on('message', (value) => seen.push(value));

    console.log(
      'shape:',
      EventEmitter.name,
      EventEmitter.prototype.constructor === EventEmitter,
      Bus.super_ === EventEmitter,
    );
    console.log('bus:', bus instanceof Bus, bus instanceof EventEmitter);
    console.log('emit:', bus.emit('message', 42), JSON.stringify(seen));

    class ModernBus extends EventEmitter {}
    const modern = new ModernBus();
    const originalMax = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = 3;
    console.log(
      'modern:',
      modern instanceof ModernBus,
      modern instanceof EventEmitter,
      modern.getMaxListeners(),
      typeof EventEmitter.captureRejectionSymbol,
    );
    EventEmitter.defaultMaxListeners = originalMax;
  `,
};

export default c;
