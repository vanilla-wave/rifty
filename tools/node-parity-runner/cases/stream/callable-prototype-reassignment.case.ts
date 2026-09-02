import type { ParityCase } from '../../src/types.ts';

/** New and bare calls follow the published constructor's current public prototype. */
const c: ParityCase = {
  code: `
    const stream = require('node:stream');
    const calls = [];
    const results = {};

    function optionsFor(name, kind) {
      switch (name) {
        case 'Readable':
          return {
            objectMode: true,
            read() { this.push(kind + ':readable'); this.push(null); },
          };
        case 'Writable':
          return {
            objectMode: true,
            write(chunk, _encoding, callback) {
              calls.push(kind + ':Writable:' + chunk);
              callback();
            },
          };
        case 'Duplex':
          return {
            objectMode: true,
            read() { this.push(kind + ':duplex-read'); this.push(null); },
            write(chunk, _encoding, callback) {
              calls.push(kind + ':Duplex:' + chunk);
              callback();
            },
          };
        case 'Transform':
          return {
            objectMode: true,
            transform(chunk, _encoding, callback) {
              callback(null, kind + ':' + String(chunk) + ':transformed');
            },
          };
        case 'PassThrough':
          return { objectMode: true };
      }
    }

    function exercise(name, instance, kind) {
      switch (name) {
        case 'Readable':
          return instance.read();
        case 'Writable':
          return instance.write(kind + ':writable-value');
        case 'Duplex':
          return {
            read: instance.read(),
            write: instance.write(kind + ':duplex-value'),
          };
        case 'Transform':
          instance.write(kind + ':transform-value');
          return instance.read();
        case 'PassThrough':
          instance.write(kind + ':passthrough-value');
          return instance.read();
      }
    }

    function summarize(Constructor, replacement, instance, operation) {
      return {
        prototypeIsReplacement: Object.getPrototypeOf(instance) === replacement,
        instanceofPublished: instance instanceof Constructor,
        marker: instance.marker,
        operation,
      };
    }

    for (const name of ['Readable', 'Writable', 'Duplex', 'Transform', 'PassThrough']) {
      const Constructor = stream[name];
      const original = Constructor.prototype;
      const replacement = Object.create(Object.getPrototypeOf(original));
      const descriptors = Object.getOwnPropertyDescriptors(original);
      delete descriptors.constructor;
      Object.defineProperties(replacement, descriptors);
      replacement.marker = name;
      Constructor.prototype = replacement;

      let constructed;
      let called;
      let error = null;
      try {
        const constructedInstance = new Constructor(optionsFor(name, 'new'));
        constructed = summarize(
          Constructor,
          replacement,
          constructedInstance,
          exercise(name, constructedInstance, 'new'),
        );
        const calledInstance = Constructor(optionsFor(name, 'call'));
        called = summarize(
          Constructor,
          replacement,
          calledInstance,
          exercise(name, calledInstance, 'call'),
        );
      } catch (cause) {
        error = cause.name + ': ' + cause.message;
      }

      results[name] = {
        error,
        constructed: constructed ?? null,
        called: called ?? null,
      };
      Constructor.prototype = original;
    }

    results.calls = calls;
    console.log(JSON.stringify(results));
  `,
  expected:
    '{"Readable":{"error":null,"constructed":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Readable","operation":"new:readable"},"called":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Readable","operation":"call:readable"}},"Writable":{"error":null,"constructed":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Writable","operation":true},"called":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Writable","operation":true}},"Duplex":{"error":null,"constructed":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Duplex","operation":{"read":"new:duplex-read","write":true}},"called":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Duplex","operation":{"read":"call:duplex-read","write":true}}},"Transform":{"error":null,"constructed":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Transform","operation":"new:new:transform-value:transformed"},"called":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"Transform","operation":"call:call:transform-value:transformed"}},"PassThrough":{"error":null,"constructed":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"PassThrough","operation":"new:passthrough-value"},"called":{"prototypeIsReplacement":true,"instanceofPublished":true,"marker":"PassThrough","operation":"call:passthrough-value"}},"calls":["new:Writable:new:writable-value","call:Writable:call:writable-value","new:Duplex:new:duplex-value","call:Duplex:call:duplex-value"]}\n',
};

export default c;
