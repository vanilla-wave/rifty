import type { ParityCase } from '../../src/types.ts';

/**
 * `node:stream/web` re-exports the platform WHATWG globals — Node's own
 * implementation IS the WHATWG impl, so each present constructor is the
 * platform global (`require('node:stream/web').ReadableStream ===
 * globalThis.ReadableStream`). Assert the acceptance-listed constructors are
 * present AND identical to the global, vs real Node.
 */
const c: ParityCase = {
  code: `
    const web = require('node:stream/web');
    const names = [
      'ReadableStream', 'WritableStream', 'TransformStream',
      'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
      'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader',
      'ReadableStreamDefaultController', 'ReadableByteStreamController',
      'WritableStreamDefaultWriter', 'WritableStreamDefaultController',
      'TransformStreamDefaultController',
      'TextEncoderStream', 'TextDecoderStream',
    ];
    for (const name of names) {
      console.log(name + ':' + (web[name] === globalThis[name] ? 'global' : typeof web[name]));
    }
  `,
};

export default c;
