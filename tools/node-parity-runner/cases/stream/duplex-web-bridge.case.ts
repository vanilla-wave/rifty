import type { ParityCase } from '../../src/types.ts';

/**
 * `Duplex.toWeb(d)` → `{ readable, writable }` (both real WHATWG streams) that
 * round-trips a `Transform`. `Duplex.fromWeb(pair)` composes a Node `Duplex`
 * (`instanceof Duplex`) — with `allowHalfOpen` defaulting to `false`, the
 * OPPOSITE of a bare `new Duplex()` (which defaults `true`); `{allowHalfOpen:
 * true}` honored; readable byte admission, writable decode/HWM state, filtered
 * chunks, and adapter-owned options match Node. A non-WHATWG arg → sync
 * TypeError. Async snapshots use phase barriers.
 */
const c: ParityCase = {
  expected: [
    'toweb-keys:readable,writable',
    'toweb-readable:true',
    'toweb-writable:true',
    'toweb-roundtrip:T:a',
    'bare-allowhalfopen:true',
    'fromweb-instance:true',
    'fromweb-allowhalfopen-default:false',
    'fromweb-allowhalfopen-true:true',
    'fromweb-filtered-paused-object:first=4 seen=undefined,string:,u8:,u8:09 ended=true error=null reading=false buffer=0',
    'fromweb-filtered-paused-byte:first=1 seen=buffer:09 ended=true error=null reading=false buffer=0',
    'fromweb-filtered-flow-object:seen=undefined,string:,u8:,u8:09 ended=true error=null reading=false buffer=0',
    'fromweb-filtered-flow-byte:seen=buffer:09 ended=true error=null reading=false buffer=0',
    'fromweb-readable-byte-string:seen=buffer:c3a9',
    'core-decode-byte-default:return=false length=2 sink=buffer:c3a9',
    'core-decode-byte-true:return=false length=2 sink=buffer:c3a9',
    'core-decode-byte-false:return=true length=1 sink=string:é',
    'core-decode-object-default:return=true length=1 sink=string:é',
    'core-decode-object-true:return=true length=1 sink=string:é',
    'core-decode-object-false:return=true length=1 sink=string:é',
    'core-decode-byte-zero:return=false length=2 state=true sink=buffer:c3a9',
    'core-decode-byte-null:return=false length=2 state=true sink=buffer:c3a9',
    'fromweb-decode-byte-default:return=false length=2 sink=buffer:c3a9',
    'fromweb-decode-byte-true:return=false length=2 sink=buffer:c3a9',
    'fromweb-decode-byte-false:return=true length=1 sink=string:é',
    'fromweb-decode-object-default:return=true length=1 sink=string:é',
    'fromweb-decode-object-true:return=true length=1 sink=string:é',
    'fromweb-decode-object-false:return=true length=1 sink=string:é',
    'fromweb-decode-byte-zero:return=false length=2 state=true sink=buffer:c3a9',
    'fromweb-decode-byte-null:return=false length=2 state=true sink=buffer:c3a9',
    'fromweb-config:order=allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark hook-gets=0 hwm=2 object=false halfopen=true',
    'fromweb-hooks-own-enumerable:gets=read:0,write:0,writev:0,final:0,destroy:0 calls=read:0,write:0,writev:0,final:0,destroy:0',
    'fromweb-hooks-own-nonenumerable:gets=read:0,write:0,writev:0,final:0,destroy:0 calls=read:0,write:0,writev:0,final:0,destroy:0',
    'fromweb-hooks-inherited:gets=read:0,write:0,writev:0,final:0,destroy:0 calls=read:0,write:0,writev:0,final:0,destroy:0',
    'fromweb-badarg:TypeError',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Duplex, Transform } = require('node:stream');
    (async () => {
      // toWeb shape + round-trip.
      const d = new Transform({ objectMode: true, transform(c, e, cb) { cb(null, 'T:' + c); } });
      const pair = Duplex.toWeb(d);
      console.log('toweb-keys:' + Object.keys(pair).sort().join(','));
      console.log('toweb-readable:' + (pair.readable instanceof ReadableStream));
      console.log('toweb-writable:' + (pair.writable instanceof WritableStream));
      const writer = pair.writable.getWriter();
      const reader = pair.readable.getReader();
      await writer.write('a');
      const r1 = await reader.read();
      console.log('toweb-roundtrip:' + r1.value);

      // bare Duplex allowHalfOpen default.
      const bare = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
      console.log('bare-allowhalfopen:' + bare.allowHalfOpen);

      // fromWeb instance + allowHalfOpen defaults.
      const readableA = new ReadableStream({ start(c) { c.enqueue('x'); c.close(); } });
      const writableA = new WritableStream({ write() {} });
      const dA = Duplex.fromWeb({ readable: readableA, writable: writableA });
      console.log('fromweb-instance:' + (dA instanceof Duplex));
      console.log('fromweb-allowhalfopen-default:' + dA.allowHalfOpen);

      const readableB = new ReadableStream({ start(c) { c.close(); } });
      const writableB = new WritableStream({ write() {} });
      const dB = Duplex.fromWeb({ readable: readableB, writable: writableB }, { allowHalfOpen: true });
      console.log('fromweb-allowhalfopen-true:' + dB.allowHalfOpen);

      const immediate = () => new Promise((resolve) => setImmediate(resolve));
      const tag = (value) => {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return 'string:' + value;
        if (Buffer.isBuffer(value)) return 'buffer:' + value.toString('hex');
        return 'u8:' + Buffer.from(value).toString('hex');
      };

      function filteredWeb() {
        return new ReadableStream({
          start(next) {
            next.enqueue(undefined);
            next.enqueue('');
            next.enqueue(new Uint8Array(0));
            next.enqueue(new Uint8Array([9]));
            next.close();
          },
        });
      }

      async function filteredRow(consumption, objectMode) {
        const mode = objectMode ? 'object' : 'byte';
        const duplex = Duplex.fromWeb(
          { readable: filteredWeb(), writable: new WritableStream() },
          { objectMode },
        );
        const seen = [];
        let ended = false;
        let error = null;
        duplex.on('end', () => { ended = true; });
        duplex.on('error', (cause) => { error = cause.code || cause.message; });

        if (consumption === 'flow') {
          duplex.on('data', (chunk) => { seen.push(tag(chunk)); });
          await immediate();
          console.log(
            'fromweb-filtered-flow-' + mode + ':seen=' + seen.join(',') +
            ' ended=' + ended +
            ' error=' + error +
            ' reading=' + duplex._readableState.reading +
            ' buffer=' + duplex._readableState.length,
          );
        } else {
          duplex.read(1);
          await immediate();
          const firstLength = duplex._readableState.length;
          for (let phase = 0; phase < 8; phase++) {
            if (duplex._readableState.length > 0) seen.push(tag(duplex.read(1)));
            else duplex.read(1);
            await immediate();
          }
          console.log(
            'fromweb-filtered-paused-' + mode + ':first=' + firstLength +
            ' seen=' + seen.join(',') +
            ' ended=' + ended +
            ' error=' + error +
            ' reading=' + duplex._readableState.reading +
            ' buffer=' + duplex._readableState.length,
          );
        }
        if (!ended) duplex.destroy();
      }

      await filteredRow('paused', true);
      await filteredRow('paused', false);
      await filteredRow('flow', true);
      await filteredRow('flow', false);

      {
        const duplex = Duplex.fromWeb({
          readable: new ReadableStream({ start(next) { next.enqueue('é'); next.close(); } }),
          writable: new WritableStream(),
        });
        const seen = [];
        await new Promise((resolve, reject) => {
          duplex.on('data', (chunk) => { seen.push(tag(chunk)); });
          duplex.on('end', resolve);
          duplex.on('error', reject);
        });
        console.log('fromweb-readable-byte-string:seen=' + seen.join(','));
        duplex.destroy();
      }

      for (const objectMode of [false, true]) {
        const mode = objectMode ? 'object' : 'byte';
        for (const decode of ['default', 'true', 'false']) {
          let sink = 'none';
          let release;
          const options = {
            objectMode,
            highWaterMark: 2,
            read() {},
            write(chunk, _encoding, callback) {
              sink = tag(chunk);
              release = callback;
            },
          };
          if (decode !== 'default') options.decodeStrings = decode === 'true';
          const duplex = new Duplex(options);
          duplex.on('error', () => {});
          const returned = duplex.write('é');
          const length = duplex.writableLength;
          await immediate();
          console.log(
            'core-decode-' + mode + '-' + decode +
            ':return=' + returned +
            ' length=' + length +
            ' sink=' + sink,
          );
          release();
          duplex.end();
          await immediate();
          duplex.destroy();
        }
      }

      for (const [label, decodeStrings] of [['zero', 0], ['null', null]]) {
        let sink = 'none';
        let release;
        const duplex = new Duplex({
          objectMode: false,
          highWaterMark: 2,
          decodeStrings,
          read() {},
          write(chunk, _encoding, callback) {
            sink = tag(chunk);
            release = callback;
          },
        });
        const returned = duplex.write('é');
        const length = duplex.writableLength;
        await immediate();
        console.log(
          'core-decode-byte-' + label +
          ':return=' + returned +
          ' length=' + length +
          ' state=' + duplex._writableState.decodeStrings +
          ' sink=' + sink,
        );
        release();
        duplex.destroy();
      }

      for (const objectMode of [false, true]) {
        const mode = objectMode ? 'object' : 'byte';
        for (const decode of ['default', 'true', 'false']) {
          let sink = 'none';
          let release;
          const webWritable = new WritableStream({
            write(chunk) {
              sink = tag(chunk);
              return new Promise((resolve) => { release = resolve; });
            },
          });
          const options = { objectMode, highWaterMark: 2 };
          if (decode !== 'default') options.decodeStrings = decode === 'true';
          const duplex = Duplex.fromWeb(
            { readable: new ReadableStream(), writable: webWritable },
            options,
          );
          duplex.on('error', () => {});
          const returned = duplex.write('é');
          const length = duplex.writableLength;
          await immediate();
          console.log(
            'fromweb-decode-' + mode + '-' + decode +
            ':return=' + returned +
            ' length=' + length +
            ' sink=' + sink,
          );
          if (release) release();
          duplex.end();
          await immediate();
          duplex.destroy();
        }
      }

      for (const [label, decodeStrings] of [['zero', 0], ['null', null]]) {
        let sink = 'none';
        let release;
        const webWritable = new WritableStream({
          write(chunk) {
            sink = tag(chunk);
            return new Promise((resolve) => { release = resolve; });
          },
        });
        const duplex = Duplex.fromWeb(
          { readable: new ReadableStream(), writable: webWritable },
          { objectMode: false, highWaterMark: 2, decodeStrings },
        );
        const returned = duplex.write('é');
        const length = duplex.writableLength;
        await immediate();
        console.log(
          'fromweb-decode-byte-' + label +
          ':return=' + returned +
          ' length=' + length +
          ' state=' + duplex._writableState.decodeStrings +
          ' sink=' + sink,
        );
        release();
        duplex.destroy();
      }

      {
        const order = [];
        let hookGets = 0;
        const options = {};
        for (const [name, value] of [
          ['allowHalfOpen', true],
          ['decodeStrings', false],
          ['encoding', 'utf8'],
          ['highWaterMark', 2],
          ['objectMode', false],
        ]) {
          Object.defineProperty(options, name, {
            enumerable: true,
            get() { order.push(name); return value; },
          });
        }
        for (const name of ['read', 'write', 'writev', 'final', 'destroy']) {
          Object.defineProperty(options, name, {
            enumerable: true,
            get() { hookGets++; return () => {}; },
          });
        }
        const duplex = Duplex.fromWeb(
          { readable: new ReadableStream(), writable: new WritableStream() },
          options,
        );
        console.log(
          'fromweb-config:order=' + order.join(',') +
          ' hook-gets=' + hookGets +
          ' hwm=' + duplex.writableHighWaterMark +
          ' object=' + duplex.writableObjectMode +
          ' halfopen=' + duplex.allowHalfOpen,
        );
        duplex.destroy();
      }

      const hookNames = ['read', 'write', 'writev', 'final', 'destroy'];
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
        const duplex = Duplex.fromWeb(
          {
            readable: new ReadableStream({
              start(next) { next.enqueue(new Uint8Array([1])); next.close(); },
            }),
            writable: new WritableStream(),
          },
          hookOptions(placement, gets, calls),
        );
        duplex.on('error', () => {});
        duplex.resume();
        duplex.write(new Uint8Array([2]));
        duplex.end();
        await immediate();
        if (!duplex.destroyed) duplex.destroy();
        await immediate();
        console.log(
          'fromweb-hooks-' + placement +
          ':gets=' + counts(gets) +
          ' calls=' + counts(calls),
        );
      }

      // non-WHATWG arg -> sync TypeError.
      let badArg = 'no-throw';
      try { Duplex.fromWeb(42); } catch (e) { badArg = e.constructor.name; }
      console.log('fromweb-badarg:' + badArg);
    })();
  `,
};

export default c;
