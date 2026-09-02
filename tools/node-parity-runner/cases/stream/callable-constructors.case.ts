import type { ParityCase } from '../../src/types.ts';

/**
 * @jsonjoy.com/fs-node's FsReadStream uses the long-standing userland form
 * `inherits(FsReadStream, Readable); Readable.call(this, options)`. Node keeps
 * every core stream constructor callable for that form, not only Stream itself.
 */
const c: ParityCase = {
  code: `
    const stream = require('node:stream');
    const { inherits } = require('node:util');
    const calls = { writes: [] };
    const results = {};

    function optionsFor(name) {
      switch (name) {
        case 'Readable':
          return {
            objectMode: true,
            highWaterMark: 3,
            read() { this.push('readable-value'); this.push(null); },
          };
        case 'Writable':
          return {
            objectMode: true,
            highWaterMark: 4,
            write(chunk, _encoding, callback) {
              calls.writes.push('Writable:' + chunk);
              callback();
            },
          };
        case 'Duplex':
          return {
            objectMode: true,
            highWaterMark: 5,
            read() { this.push('duplex-read'); this.push(null); },
            write(chunk, _encoding, callback) {
              calls.writes.push('Duplex:' + chunk);
              callback();
            },
          };
        case 'Transform':
          return {
            objectMode: true,
            highWaterMark: 6,
            transform(chunk, _encoding, callback) {
              callback(null, String(chunk) + ':transformed');
            },
          };
        case 'PassThrough':
          return { objectMode: true, highWaterMark: 7 };
      }
    }

    function exercise(name, instance) {
      switch (name) {
        case 'Readable':
          return {
            read: instance.read(),
            highWaterMark: instance.readableHighWaterMark,
            objectMode: instance.readableObjectMode,
          };
        case 'Writable':
          return {
            write: instance.write('writable-value'),
            highWaterMark: instance.writableHighWaterMark,
            objectMode: instance.writableObjectMode,
          };
        case 'Duplex':
          return {
            read: instance.read(),
            write: instance.write('duplex-write'),
            readableHighWaterMark: instance.readableHighWaterMark,
            writableHighWaterMark: instance.writableHighWaterMark,
            readableObjectMode: instance.readableObjectMode,
            writableObjectMode: instance.writableObjectMode,
          };
        case 'Transform':
          instance.write('transform-value');
          return {
            read: instance.read(),
            readableHighWaterMark: instance.readableHighWaterMark,
            writableHighWaterMark: instance.writableHighWaterMark,
            readableObjectMode: instance.readableObjectMode,
            writableObjectMode: instance.writableObjectMode,
          };
        case 'PassThrough':
          instance.write('passthrough-value');
          return {
            read: instance.read(),
            readableHighWaterMark: instance.readableHighWaterMark,
            writableHighWaterMark: instance.writableHighWaterMark,
            readableObjectMode: instance.readableObjectMode,
            writableObjectMode: instance.writableObjectMode,
          };
      }
    }

    for (const name of ['Readable', 'Writable', 'Duplex', 'Transform', 'PassThrough']) {
      const Constructor = stream[name];
      const options = optionsFor(name);
      let callResult;
      function LegacyStream() {
        callResult = Constructor.call(this, options);
      }
      inherits(LegacyStream, Constructor);

      let instance;
      let error = null;
      let operation = null;
      try {
        instance = new LegacyStream();
        operation = exercise(name, instance);
      } catch (cause) {
        error = cause.name + ': ' + cause.message;
      }

      let noNew;
      try {
        noNew = Constructor() instanceof Constructor;
      } catch (cause) {
        noNew = cause.name + ': ' + cause.message;
      }

      class ModernStream extends Constructor {}
      const modern = new ModernStream(optionsFor(name));

      results[name] = {
        name: Constructor.name,
        length: Constructor.length,
        error,
        callReturnsUndefined: callResult === undefined,
        instances: instance
          ? [instance instanceof LegacyStream, instance instanceof Constructor]
          : null,
        noNew,
        modernInstances: [modern instanceof ModernStream, modern instanceof Constructor],
        operation,
        prototypeConstructorIdentity: Constructor.prototype.constructor === Constructor,
        legacySuperIdentity: LegacyStream.super_ === Constructor,
      };
    }

    results.staticChain = {
      Duplex: Object.getPrototypeOf(stream.Duplex) === stream.Readable,
      Transform: Object.getPrototypeOf(stream.Transform) === stream.Duplex,
      PassThrough: Object.getPrototypeOf(stream.PassThrough) === stream.Transform,
    };
    results.writes = calls.writes;
    console.log(JSON.stringify(results));
  `,
  expected:
    '{"Readable":{"name":"Readable","length":1,"error":null,"callReturnsUndefined":true,"instances":[true,true],"noNew":true,"modernInstances":[true,true],"operation":{"read":"readable-value","highWaterMark":3,"objectMode":true},"prototypeConstructorIdentity":true,"legacySuperIdentity":true},"Writable":{"name":"Writable","length":1,"error":null,"callReturnsUndefined":true,"instances":[true,true],"noNew":true,"modernInstances":[true,true],"operation":{"write":true,"highWaterMark":4,"objectMode":true},"prototypeConstructorIdentity":true,"legacySuperIdentity":true},"Duplex":{"name":"Duplex","length":1,"error":null,"callReturnsUndefined":true,"instances":[true,true],"noNew":true,"modernInstances":[true,true],"operation":{"read":"duplex-read","write":true,"readableHighWaterMark":5,"writableHighWaterMark":5,"readableObjectMode":true,"writableObjectMode":true},"prototypeConstructorIdentity":true,"legacySuperIdentity":true},"Transform":{"name":"Transform","length":1,"error":null,"callReturnsUndefined":true,"instances":[true,true],"noNew":true,"modernInstances":[true,true],"operation":{"read":"transform-value:transformed","readableHighWaterMark":6,"writableHighWaterMark":6,"readableObjectMode":true,"writableObjectMode":true},"prototypeConstructorIdentity":true,"legacySuperIdentity":true},"PassThrough":{"name":"PassThrough","length":1,"error":null,"callReturnsUndefined":true,"instances":[true,true],"noNew":true,"modernInstances":[true,true],"operation":{"read":"passthrough-value","readableHighWaterMark":7,"writableHighWaterMark":7,"readableObjectMode":true,"writableObjectMode":true},"prototypeConstructorIdentity":true,"legacySuperIdentity":true},"staticChain":{"Duplex":true,"Transform":true,"PassThrough":true},"writes":["Writable:writable-value","Duplex:duplex-write"]}\n',
};

export default c;
