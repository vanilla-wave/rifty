/** `Readable.from(iter, opts)`: default object mode, atomic string/Buffer, options. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  expected: [
    'array-string:object=true hwm=1 chunks=["string:a","string:","string:é"]',
    'array-buffer:object=true hwm=1 chunks=["buffer:61:same=true","buffer:62:same=true"]',
    'bare-string:object=true hwm=16 chunks=["string:hé"]',
    'bare-empty-string:object=true hwm=16 chunks=["string:"]',
    'bare-buffer:object=true hwm=16 chunks=["buffer:0102:same=true"]',
    'bare-empty-buffer:object=true hwm=16 chunks=["buffer::same=true"]',
    'bare-u8:object=true hwm=1 chunks=["number:1","number:2"]',
    'special-string-false:object=false hwm=65536 chunks=["buffer:68c3a9:same=false"]',
    'special-string-undefined:object=false hwm=65536 chunks=["buffer:68c3a9:same=false"]',
    'special-string-null:object=false hwm=65536 chunks=["buffer:68c3a9:same=false"]',
    'special-buffer-false:object=false hwm=65536 chunks=["buffer:0102:same=true"]',
    'special-buffer-undefined:object=false hwm=65536 chunks=["buffer:0102:same=true"]',
    'special-buffer-null:object=false hwm=65536 chunks=["buffer:0102:same=true"]',
    'explicit-object:object=true hwm=1 chunks=["string:a","string:b"]',
    'explicit-undefined:object=false hwm=1',
    'special-undefined:object=false hwm=65536',
    'hwm-undefined:object=true hwm=16',
    'hwm-null:object=true hwm=16',
    'special-hwm-null:object=true hwm=16',
    'special-hwm3:object=true hwm=3',
    'generic-hwm3:object=true hwm=3',
    'async-string:object=true hwm=1 chunks=["string:a","string:b"]',
    'lazy-cold:0',
    'lazy-demand:1',
    'async-lazy-cold:0',
    'async-lazy-demand:1',
    'hwm0:nexts=2 seen=["zero"] ended=true length=0',
    'async-hwm0:nexts=2 seen=["async-zero"] ended=true stateEnded=true length=0',
    'hwm0-read:first=paused second=null nexts=2 ended=true stateEnded=true',
    'hwm0-read1:first=paused second=null nexts=2 ended=true stateEnded=true',
    'async-hwm0-read:first=null second=async-paused third=null nexts=2 stateEnded=true length=0',
    'async-hwm0-read1:first=null second=async-paused third=null nexts=2 stateEnded=true length=0',
    'hwm:7',
    'non-iterable-typeerror:true',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Readable } = require('node:stream');
    (async () => {
      const tag = (value, input) => {
        if (typeof value === 'string') return 'string:' + value;
        if (typeof value === 'number') return 'number:' + value;
        if (Buffer.isBuffer(value)) {
          return 'buffer:' + value.toString('hex') + ':same=' + (value === input);
        }
        if (value instanceof Uint8Array) {
          return 'u8:' + Buffer.from(value).toString('hex') + ':same=' + (value === input);
        }
        return typeof value;
      };
      async function row(name, input, options) {
        const source = Readable.from(input, options);
        const objectMode = source.readableObjectMode;
        const highWaterMark = source.readableHighWaterMark;
        const chunks = [];
        for await (const value of source) {
          const original = Array.isArray(input) ? input[chunks.length] : input;
          chunks.push(tag(value, original));
        }
        console.log(
          name + ':object=' + objectMode + ' hwm=' + highWaterMark +
          ' chunks=' + JSON.stringify(chunks)
        );
      }
      function configRow(name, input, options) {
        const source = Readable.from(input, options);
        console.log(
          name + ':object=' + source.readableObjectMode +
          ' hwm=' + source.readableHighWaterMark
        );
        source.destroy();
      }

      await row('array-string', ['a', '', 'é']);
      await row('array-buffer', [Buffer.from('a'), Buffer.from('b')]);
      await row('bare-string', 'hé');
      await row('bare-empty-string', '');
      const bareBuffer = Buffer.from([1, 2]);
      await row('bare-buffer', bareBuffer);
      const bareEmptyBuffer = Buffer.alloc(0);
      await row('bare-empty-buffer', bareEmptyBuffer);
      await row('bare-u8', new Uint8Array([1, 2]));
      await row('special-string-false', 'hé', { objectMode: false });
      await row('special-string-undefined', 'hé', { objectMode: undefined });
      await row('special-string-null', 'hé', { objectMode: null });
      const specialBufferFalse = Buffer.from([1, 2]);
      await row('special-buffer-false', specialBufferFalse, { objectMode: false });
      const specialBufferUndefined = Buffer.from([1, 2]);
      await row('special-buffer-undefined', specialBufferUndefined, { objectMode: undefined });
      const specialBufferNull = Buffer.from([1, 2]);
      await row('special-buffer-null', specialBufferNull, { objectMode: null });
      await row('explicit-object', ['a', 'b'], { objectMode: true });
      configRow('explicit-undefined', [Buffer.from('a')], { objectMode: undefined });
      configRow('special-undefined', 'x', { objectMode: undefined });
      configRow('hwm-undefined', ['x'], { highWaterMark: undefined });
      configRow('hwm-null', ['x'], { highWaterMark: null });
      configRow('special-hwm-null', 'x', { highWaterMark: null });
      configRow('special-hwm3', 'x', { highWaterMark: 3 });
      configRow('generic-hwm3', ['x'], { highWaterMark: 3 });
      async function* asyncStrings() { yield 'a'; yield 'b'; }
      await row('async-string', asyncStrings());

      let nexts = 0;
      const lazy = Readable.from({
        [Symbol.iterator]() {
          return {
            next() {
              nexts++;
              if (nexts === 1) return { value: 'x', done: false };
              if (nexts === 2) return { value: undefined, done: true };
              throw new Error('unexpected third sync next');
            },
          };
        },
      });
      console.log('lazy-cold:' + nexts);
      lazy.read(0);
      console.log('lazy-demand:' + nexts);
      lazy.destroy();

      let asyncNexts = 0;
      const asyncLazy = Readable.from({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              asyncNexts++;
              if (asyncNexts === 1) return { value: 'x', done: false };
              if (asyncNexts === 2) return { value: undefined, done: true };
              throw new Error('unexpected third async next');
            },
          };
        },
      });
      console.log('async-lazy-cold:' + asyncNexts);
      asyncLazy.read(0);
      console.log('async-lazy-demand:' + asyncNexts);
      asyncLazy.destroy();

      let zeroNexts = 0;
      const zero = Readable.from({
        [Symbol.iterator]() {
          return {
            next() {
              zeroNexts++;
              return zeroNexts === 1
                ? { value: 'zero', done: false }
                : { value: undefined, done: true };
            },
          };
        },
      }, { highWaterMark: 0 });
      const zeroSeen = [];
      let zeroEnded = false;
      zero.on('data', (value) => zeroSeen.push(value));
      zero.on('end', () => { zeroEnded = true; });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      console.log(
        'hwm0:nexts=' + zeroNexts +
        ' seen=' + JSON.stringify(zeroSeen) +
        ' ended=' + zeroEnded +
        ' length=' + zero.readableLength
      );
      if (!zeroEnded) zero.destroy();

      let asyncZeroNexts = 0;
      const asyncZero = Readable.from({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              asyncZeroNexts++;
              return asyncZeroNexts === 1
                ? { value: 'async-zero', done: false }
                : { value: undefined, done: true };
            },
          };
        },
      }, { highWaterMark: 0 });
      const asyncZeroSeen = [];
      let asyncZeroEnded = false;
      asyncZero.on('data', (value) => asyncZeroSeen.push(value));
      asyncZero.on('end', () => { asyncZeroEnded = true; });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      console.log(
        'async-hwm0:nexts=' + asyncZeroNexts +
        ' seen=' + JSON.stringify(asyncZeroSeen) +
        ' ended=' + asyncZeroEnded +
        ' stateEnded=' + asyncZero._readableState.ended +
        ' length=' + asyncZero.readableLength
      );
      if (!asyncZeroEnded) asyncZero.destroy();

      for (const [label, size] of [['read', undefined], ['read1', 1]]) {
        let pausedNexts = 0;
        const paused = Readable.from({
          [Symbol.iterator]() {
            return {
              next() {
                pausedNexts++;
                return pausedNexts === 1
                  ? { value: 'paused', done: false }
                  : { value: undefined, done: true };
              },
            };
          },
        }, { highWaterMark: 0 });
        let pausedEnded = false;
        paused.on('end', () => { pausedEnded = true; });
        const first = paused.read(size);
        const second = paused.read(size);
        await new Promise((resolve) => setImmediate(resolve));
        console.log(
          'hwm0-' + label + ':first=' + first +
          ' second=' + second +
          ' nexts=' + pausedNexts +
          ' ended=' + pausedEnded +
          ' stateEnded=' + paused._readableState.ended
        );
      }

      for (const [label, size] of [['read', undefined], ['read1', 1]]) {
        let pausedNexts = 0;
        const paused = Readable.from({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                pausedNexts++;
                return pausedNexts === 1
                  ? { value: 'async-paused', done: false }
                  : { value: undefined, done: true };
              },
            };
          },
        }, { highWaterMark: 0 });
        const first = paused.read(size);
        await new Promise((resolve) => setImmediate(resolve));
        const second = paused.read(size);
        await new Promise((resolve) => setImmediate(resolve));
        const third = paused.read(size);
        await new Promise((resolve) => setImmediate(resolve));
        console.log(
          'async-hwm0-' + label +
          ':first=' + first +
          ' second=' + second +
          ' third=' + third +
          ' nexts=' + pausedNexts +
          ' stateEnded=' + paused._readableState.ended +
          ' length=' + paused.readableLength
        );
        paused.destroy();
      }

      const hwm = Readable.from(['x'], { highWaterMark: 7 });
      console.log('hwm:' + hwm.readableHighWaterMark);
      hwm.destroy();
      let threw = false;
      try { Readable.from(42); } catch (e) { threw = e && e.name === 'TypeError'; }
      console.log('non-iterable-typeerror:' + threw);
    })();
  `,
};

export default c;
