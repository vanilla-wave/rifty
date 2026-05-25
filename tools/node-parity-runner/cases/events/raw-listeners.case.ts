/**
 * `rawListeners(name)` returns the stored wrapper function for `once()` (with
 * `.listener` pointing to the original); `listeners(name)` unwraps them.
 * Previously rifty's `rawListeners` was identical to `listeners`.
 *
 * `removeListener(name, fn)` must also find the wrapper by matching `.listener`.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const ee = new EventEmitter();
    function fn() {}

    ee.once('a', fn);

    const ls = ee.listeners('a');
    const raw = ee.rawListeners('a');

    console.log('listeners-count:', ls.length);
    console.log('listeners[0]===fn:', ls[0] === fn);
    console.log('raw-count:', raw.length);
    console.log('raw[0]===fn:', raw[0] === fn);
    console.log('raw[0].listener===fn:', raw[0].listener === fn);

    // Plain on() — listeners and rawListeners agree.
    function plain() {}
    ee.on('b', plain);
    console.log('plain-ls:', ee.listeners('b')[0] === plain);
    console.log('plain-raw:', ee.rawListeners('b')[0] === plain);

    // removeListener via original fn unwraps the once wrapper.
    ee.removeListener('a', fn);
    console.log('after-remove:', ee.listenerCount('a'));

    // prependOnceListener mirrors once for wrapping.
    function fn2() {}
    ee.prependOnceListener('c', fn2);
    const raw2 = ee.rawListeners('c');
    console.log('once-prepend-raw[0].listener===fn2:', raw2[0].listener === fn2);
    console.log('once-prepend-listeners[0]===fn2:', ee.listeners('c')[0] === fn2);
  `,
};

export default c;
