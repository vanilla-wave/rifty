// Constructor options as Node validates them (getHighWaterMark, addAbortSignal, encoding/defaultEncoding;
// a non-function hook option is ignored, not rejected) on Readable, Writable, Duplex, Transform.
const { Readable, Writable, Duplex, Transform } = require('node:stream');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const CLASSES = { Readable, Writable, Duplex, Transform };
const OPTIONS = [
  ['highWaterMark -1', { highWaterMark: -1 }],
  ['highWaterMark NaN', { highWaterMark: Number.NaN }],
  ['highWaterMark "16"', { highWaterMark: '16' }],
  ['highWaterMark 1.5', { highWaterMark: 1.5 }],
  ['readableHighWaterMark -1', { readableHighWaterMark: -1 }],
  ['writableHighWaterMark -1', { writableHighWaterMark: -1 }],
  ['signal 1', { signal: 1 }],
  ['signal {}', { signal: {} }],
  ['encoding "nope"', { encoding: 'nope' }],
  ['defaultEncoding "nope"', { defaultEncoding: 'nope' }],
  ['read 1', { read: 1 }],
  ['write 1', { write: 1 }],
  ['transform 1', { transform: 1 }],
  ['destroy 1', { destroy: 1 }],
  ['construct 1', { construct: 1 }],
];
for (const [label, opts] of OPTIONS) {
  row(`options ${label}`, async (L) => {
    L.push(
      Object.entries(CLASSES)
        .map(([k, C]) => {
          try {
            const s = new C(opts);
            return `${k}:ok hwm=${s.readableHighWaterMark ?? '-'}/${s.writableHighWaterMark ?? '-'}`;
          } catch (e) {
            return `${k}:${e2s(e).split(':')[0]}`;
          }
        })
        .join(' '),
    );
  });
}
row("write(chunk, '', cb): empty encoding (zlib's flush() passes '')", async (L) => {
  const w = new Writable({
    write(c, e, cb) {
      L.push(`_write ${typeof c} ${e}`);
      cb();
    },
  });
  w.on('error', (e) => L.push(`error ${e2s(e)}`));
  try {
    w.write(Buffer.from('a'), '', (e) => L.push(`cb ${e ? e2s(e) : 'ok'}`));
  } catch (e) {
    L.push(`threw ${e2s(e)}`);
  }
});
(async () => {
  for (const [name, fn] of rows) {
    const L = [];
    try {
      await Promise.race([fn(L), settle(3000).then(() => L.push('no settle in 3s'))]);
    } catch (e) {
      L.push(`threw ${e2s(e)}`);
    }
    await settle();
    console.log(`${name} => ${L.join(',')}`);
  }
})();
let uncaught = 0;
process.on('uncaughtException', (e) => console.log(`uncaught ${++uncaught} => ${e2s(e)}`));
