import type { ParityCase } from '../../src/types.ts';

/** Re-running a Node stream constructor refreshes state without erasing installed hooks. */
const c: ParityCase = {
  code: `
    const { Readable, Writable, Duplex, Transform, PassThrough } = require('node:stream');
    const results = {};

    const readable = new Readable({
      read() { this.push('readable-value'); this.push(null); },
    });
    const newListenerCount = readable.listenerCount('newListener');
    const readableResult = Readable.call(readable, { objectMode: true, highWaterMark: 3 });
    results.Readable = {
      returnUndefined: readableResult === undefined,
      listenersStable: readable.listenerCount('newListener') === newListenerCount,
      read: readable.read(),
      objectMode: readable.readableObjectMode,
      highWaterMark: readable.readableHighWaterMark,
    };

    const writableCalls = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        writableCalls.push('write:' + chunk);
        callback();
      },
      writev(chunks, callback) {
        writableCalls.push('writev:' + chunks.map(({ chunk }) => chunk).join(','));
        callback();
      },
      final(callback) {
        writableCalls.push('final');
        callback();
      },
    });
    const writableResult = Writable.call(writable, { objectMode: true, highWaterMark: 4 });
    writable.cork();
    writable.write('a');
    writable.write('b');
    writable.uncork();
    writable.write('c');
    writable.end();
    results.Writable = {
      returnUndefined: writableResult === undefined,
      calls: writableCalls,
      objectMode: writable.writableObjectMode,
      highWaterMark: writable.writableHighWaterMark,
    };

    const duplexCalls = [];
    const duplex = new Duplex({
      read() { this.push('duplex-read'); this.push(null); },
      write(chunk, _encoding, callback) {
        duplexCalls.push('write:' + chunk);
        callback();
      },
      final(callback) {
        duplexCalls.push('final');
        callback();
      },
    });
    const duplexResult = Duplex.call(duplex, { objectMode: true, highWaterMark: 5 });
    const duplexRead = duplex.read();
    duplex.write('duplex-value');
    duplex.end();
    results.Duplex = {
      returnUndefined: duplexResult === undefined,
      read: duplexRead,
      calls: duplexCalls,
      readableObjectMode: duplex.readableObjectMode,
      writableObjectMode: duplex.writableObjectMode,
      readableHighWaterMark: duplex.readableHighWaterMark,
      writableHighWaterMark: duplex.writableHighWaterMark,
    };

    const transformCalls = [];
    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        transformCalls.push('transform:' + chunk);
        callback(null, 'transformed:' + chunk);
      },
      flush(callback) {
        transformCalls.push('flush');
        callback();
      },
    });
    const transformResult = Transform.call(transform, { objectMode: true, highWaterMark: 6 });
    transform.write('transform-value');
    transform.end();
    results.Transform = {
      returnUndefined: transformResult === undefined,
      read: transform.read(),
      calls: transformCalls,
      readableObjectMode: transform.readableObjectMode,
      writableObjectMode: transform.writableObjectMode,
      readableHighWaterMark: transform.readableHighWaterMark,
      writableHighWaterMark: transform.writableHighWaterMark,
    };

    const passThrough = new PassThrough();
    const passThroughResult = PassThrough.call(passThrough, {
      objectMode: true,
      highWaterMark: 7,
    });
    passThrough.write('passthrough-value');
    results.PassThrough = {
      returnUndefined: passThroughResult === undefined,
      read: passThrough.read(),
      readableObjectMode: passThrough.readableObjectMode,
      writableObjectMode: passThrough.writableObjectMode,
      readableHighWaterMark: passThrough.readableHighWaterMark,
      writableHighWaterMark: passThrough.writableHighWaterMark,
    };

    console.log(JSON.stringify(results));
  `,
  expected:
    '{"Readable":{"returnUndefined":true,"listenersStable":true,"read":"readable-value","objectMode":true,"highWaterMark":3},"Writable":{"returnUndefined":true,"calls":["writev:a,b","write:c","final"],"objectMode":true,"highWaterMark":4},"Duplex":{"returnUndefined":true,"read":"duplex-read","calls":["write:duplex-value","final"],"readableObjectMode":true,"writableObjectMode":true,"readableHighWaterMark":5,"writableHighWaterMark":5},"Transform":{"returnUndefined":true,"read":"transformed:transform-value","calls":["transform:transform-value","flush"],"readableObjectMode":true,"writableObjectMode":true,"readableHighWaterMark":6,"writableHighWaterMark":6},"PassThrough":{"returnUndefined":true,"read":"passthrough-value","readableObjectMode":true,"writableObjectMode":true,"readableHighWaterMark":7,"writableHighWaterMark":7}}\n',
};

export default c;
