import type { ParityCase } from '../../src/types.ts';

/**
 * nodemon constructs its Bus with EventEmitter.call(this) + util.inherits.
 * Exercise that exact legacy form beside direct construction, ES subclassing,
 * and a plain receiver while crossing the same prototype listener methods.
 */
const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const { inherits } = require('node:util');

    const target = Object.create(EventEmitter.prototype);
    const targetCallResult = EventEmitter.call(target);

    function LegacyBus() {
      this.callResult = EventEmitter.call(this);
    }
    inherits(LegacyBus, EventEmitter);

    class ModernBus extends EventEmitter {}

    const legacy = new LegacyBus();
    const modern = new ModernBus();
    const direct = new EventEmitter();
    const seen = [];
    EventEmitter.prototype.on.call(target, 'value', () => seen.push('target'));
    legacy.on('value', () => seen.push('legacy'));
    modern.on('value', () => seen.push('modern'));
    direct.on('value', () => seen.push('direct'));
    target.emit('value');
    EventEmitter.prototype.emit.call(legacy, 'value');
    modern.emit('value');
    direct.emit('value');

    console.log(JSON.stringify({
      callReturnsUndefined: targetCallResult === undefined,
      targetPrototypeIdentity: Object.getPrototypeOf(target) === EventEmitter.prototype,
      targetInstanceof: target instanceof EventEmitter,
      legacyCallReturnsUndefined: legacy.callResult === undefined,
      legacyPrototypeIdentity: Object.getPrototypeOf(LegacyBus.prototype) === EventEmitter.prototype,
      legacySuperIdentity: LegacyBus.super_ === EventEmitter,
      legacyInstanceof: [legacy instanceof LegacyBus, legacy instanceof EventEmitter],
      modernInstanceof: [modern instanceof ModernBus, modern instanceof EventEmitter],
      constructorIdentity: EventEmitter.prototype.constructor === EventEmitter,
      seen,
    }));
  `,
  expected:
    '{"callReturnsUndefined":true,"targetPrototypeIdentity":true,"targetInstanceof":true,"legacyCallReturnsUndefined":true,"legacyPrototypeIdentity":true,"legacySuperIdentity":true,"legacyInstanceof":[true,true],"modernInstanceof":[true,true],"constructorIdentity":true,"seen":["target","legacy","modern","direct"]}\n',
};

export default c;
