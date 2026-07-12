import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.fromWeb(ws)`: `w.write('a');w.write('b');w.end('c')` reach the WHATWG
 * sink in order. Pins decodeStrings + HWM accounting and adapter-owned option
 * access; hooks are never observed. Async snapshots use phase barriers.
 */
const c: ParityCase = {
  expected: [
    'order:["write:a","write:b","write:c","close"]',
    'finish:true',
    'core-decode-byte-default:return=false length=2 sink=buffer:c3a9',
    'core-decode-byte-true:return=false length=2 sink=buffer:c3a9',
    'core-decode-byte-false:return=true length=1 sink=string:é',
    'core-decode-object-default:return=true length=1 sink=string:é',
    'core-decode-object-true:return=true length=1 sink=string:é',
    'core-decode-object-false:return=true length=1 sink=string:é',
    'fromweb-decode-byte-default:return=false length=2 sink=buffer:c3a9',
    'fromweb-decode-byte-true:return=false length=2 sink=buffer:c3a9',
    'fromweb-decode-byte-false:return=true length=1 sink=string:é',
    'fromweb-decode-object-default:return=true length=1 sink=string:é',
    'fromweb-decode-object-true:return=true length=1 sink=string:é',
    'fromweb-decode-object-false:return=true length=1 sink=string:é',
    'fromweb-decode-invalid-yes:ERR_INVALID_ARG_TYPE',
    'fromweb-decode-invalid-zero:ERR_INVALID_ARG_TYPE',
    'fromweb-decode-invalid-null:ERR_INVALID_ARG_TYPE',
    'config:order=highWaterMark,decodeStrings,objectMode hook-gets=0 hwm=2 object=false',
    'hooks-own-enumerable:gets=write:0,writev:0,final:0,destroy:0 calls=write:0,writev:0,final:0,destroy:0',
    'hooks-own-nonenumerable:gets=write:0,writev:0,final:0,destroy:0 calls=write:0,writev:0,final:0,destroy:0',
    'hooks-inherited:gets=write:0,writev:0,final:0,destroy:0 calls=write:0,writev:0,final:0,destroy:0',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Writable } = require('node:stream');
    (async () => {
      const immediate = () => new Promise((resolve) => setImmediate(resolve));
      const seen = [];
      const ws = new WritableStream({
        write(chunk) { seen.push('write:' + chunk); },
        close() { seen.push('close'); },
      });
      const w = Writable.fromWeb(ws);
      let finished = false;
      const finish = new Promise((resolve, reject) => {
        w.on('finish', () => { finished = true; resolve(); });
        w.on('error', reject);
      });
      w.write('a'); w.write('b'); w.end('c');
      await finish;
      console.log('order:' + JSON.stringify(seen));
      console.log('finish:' + finished);

      const tag = (value) => {
        if (Buffer.isBuffer(value)) return 'buffer:' + value.toString('hex');
        if (value instanceof Uint8Array) return 'u8:' + Buffer.from(value).toString('hex');
        return typeof value + ':' + value;
      };

      for (const objectMode of [false, true]) {
        const mode = objectMode ? 'object' : 'byte';
        for (const decode of ['default', 'true', 'false']) {
          let sink = 'none';
          let release;
          const options = {
            objectMode,
            highWaterMark: 2,
            write(chunk, _encoding, callback) {
              sink = tag(chunk);
              release = callback;
            },
          };
          if (decode !== 'default') options.decodeStrings = decode === 'true';
          const writable = new Writable(options);
          writable.on('error', () => {});
          const returned = writable.write('é');
          const length = writable.writableLength;
          await immediate();
          console.log(
            'core-decode-' + mode + '-' + decode +
            ':return=' + returned +
            ' length=' + length +
            ' sink=' + sink,
          );
          release();
          writable.end();
          await immediate();
          if (!writable.destroyed) writable.destroy();
        }
      }

      for (const objectMode of [false, true]) {
        const mode = objectMode ? 'object' : 'byte';
        for (const decode of ['default', 'true', 'false']) {
          let sink = 'none';
          let release;
          const web = new WritableStream({
            write(chunk) {
              sink = tag(chunk);
              return new Promise((resolve) => { release = resolve; });
            },
          });
          const options = { objectMode, highWaterMark: 2 };
          if (decode !== 'default') options.decodeStrings = decode === 'true';
          const writable = Writable.fromWeb(web, options);
          writable.on('error', () => {});
          const returned = writable.write('é');
          const length = writable.writableLength;
          await immediate();
          console.log(
            'fromweb-decode-' + mode + '-' + decode +
            ':return=' + returned +
            ' length=' + length +
            ' sink=' + sink,
          );
          if (release) release();
          writable.end();
          await immediate();
          if (!writable.destroyed) writable.destroy();
        }
      }

      for (const [label, decodeStrings] of [['yes', 'yes'], ['zero', 0], ['null', null]]) {
        let code = 'none';
        try {
          Writable.fromWeb(new WritableStream(), { decodeStrings });
        } catch (error) {
          code = error.code || 'none';
        }
        console.log('fromweb-decode-invalid-' + label + ':' + code);
      }

      {
        const order = [];
        let hookGets = 0;
        const options = {};
        for (const [name, value] of [
          ['decodeStrings', false],
          ['highWaterMark', 2],
          ['objectMode', false],
        ]) {
          Object.defineProperty(options, name, {
            enumerable: true,
            get() { order.push(name); return value; },
          });
        }
        for (const name of ['write', 'writev', 'final', 'destroy']) {
          Object.defineProperty(options, name, {
            enumerable: true,
            get() { hookGets++; return () => {}; },
          });
        }
        const writable = Writable.fromWeb(new WritableStream(), options);
        console.log(
          'config:order=' + order.join(',') +
          ' hook-gets=' + hookGets +
          ' hwm=' + writable.writableHighWaterMark +
          ' object=' + writable.writableObjectMode,
        );
        writable.destroy();
      }

      const hookNames = ['write', 'writev', 'final', 'destroy'];
      function hookOptions(placement, gets, calls) {
        const target = placement === 'inherited' ? {} : Object.create(null);
        for (const name of hookNames) {
          Object.defineProperty(target, name, {
            configurable: true,
            enumerable: placement !== 'own-nonenumerable',
            get() {
              gets[name]++;
              return (...args) => {
                calls[name]++;
                const callback = args[args.length - 1];
                if (typeof callback === 'function') callback();
              };
            },
          });
        }
        return placement === 'inherited' ? Object.create(target) : target;
      }
      const counts = (values) => hookNames.map((name) => name + ':' + values[name]).join(',');

      for (const placement of ['own-enumerable', 'own-nonenumerable', 'inherited']) {
        const gets = Object.fromEntries(hookNames.map((name) => [name, 0]));
        const calls = Object.fromEntries(hookNames.map((name) => [name, 0]));
        const writable = Writable.fromWeb(
          new WritableStream(),
          hookOptions(placement, gets, calls),
        );
        writable.on('error', () => {});
        writable.write(new Uint8Array([1]));
        writable.end();
        await immediate();
        if (!writable.destroyed) writable.destroy();
        await immediate();
        console.log(
          'hooks-' + placement +
          ':gets=' + counts(gets) +
          ' calls=' + counts(calls),
        );
      }
    })();
  `,
};

export default c;
