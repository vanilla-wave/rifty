/**
 * Per Node, `Duplex.prototype` carries `write`/`end`/`read`/`pipe`/`destroy`
 * — not per-instance fields. This matters for:
 *   - `Object.getPrototypeOf(duplex).write === Duplex.prototype.write`
 *   - Subclassing — methods reachable via `super.write(...)`.
 *   - Patching (`d.write = wrapper`) doesn't double-wrap the per-instance
 *     binding the constructor installed.
 *
 * Our previous Duplex/Transform constructors did `this.write = ...` and
 * `this.end = ...` as instance fields. This case asserts the prototype shape
 * matches Node's.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Duplex, Transform } = require('node:stream');
    const d = new Duplex({
      objectMode: true,
      read() {},
      write(_c, _e, cb) { cb(); },
    });
    // Both write and end should live on the prototype, not as instance own properties.
    console.log('duplex-write-own:' + Object.prototype.hasOwnProperty.call(d, 'write'));
    console.log('duplex-end-own:' + Object.prototype.hasOwnProperty.call(d, 'end'));
    const t = new Transform({
      objectMode: true,
      transform(c, _e, cb) { cb(null, c); },
    });
    console.log('transform-write-own:' + Object.prototype.hasOwnProperty.call(t, 'write'));
    console.log('transform-end-own:' + Object.prototype.hasOwnProperty.call(t, 'end'));
    // And the value should be a function inherited from the class.
    console.log('duplex-write-fn:' + (typeof Object.getPrototypeOf(d).write === 'function'));
    console.log('transform-write-fn:' + (typeof Object.getPrototypeOf(t).write === 'function'));
  `,
};

export default c;
