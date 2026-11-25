// Readable/Writable state members visible on every subclass: readableFlowing, isPaused(), writableNeedDrain
// — on plain streams and on fs streams.
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable, Duplex } = require('node:stream');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const F = path.join(__dirname, 'm.txt');
fs.writeFileSync(F, 'x'.repeat(100000));
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const flow = (r, L) => {
  const st = () =>
    `${r.readableFlowing}/${typeof r.isPaused === 'function' ? r.isPaused() : 'no isPaused'}`;
  L.push(`new ${st()}`);
  r.on('data', () => {});
  L.push(`on(data) ${st()}`);
  r.pause();
  L.push(`pause ${st()}`);
  r.resume();
  L.push(`resume ${st()}`);
};
row('Readable readableFlowing/isPaused: new, on(data), pause, resume', async (L) =>
  flow(new Readable({ read() {} }), L),
);
row('fs.ReadStream readableFlowing/isPaused: new, on(data), pause, resume', async (L) => {
  const rs = fs.createReadStream(F);
  try {
    flow(rs, L);
  } finally {
    rs.destroy();
  }
});
const drain = (w, L) => {
  L.push(`start ${w.writableNeedDrain}`);
  w.write('ab');
  L.push(`below ${w.writableNeedDrain}`);
  w.write('cdef');
  L.push(`over ${w.writableNeedDrain}`);
  w.on('drain', () => L.push(`drain ${w.writableNeedDrain}`));
};
row('Writable writableNeedDrain below/over hwm, after drain', async (L) =>
  drain(
    new Writable({
      highWaterMark: 4,
      write(_c, _e, cb) {
        setImmediate(cb);
      },
    }),
    L,
  ),
);
row('Duplex writableNeedDrain', async (L) =>
  drain(
    new Duplex({
      highWaterMark: 4,
      read() {},
      write(_c, _e, cb) {
        setImmediate(cb);
      },
    }),
    L,
  ),
);
row('fs.WriteStream writableNeedDrain', async (L) => {
  const ws = fs.createWriteStream(path.join(__dirname, 'm.out'), { highWaterMark: 4 });
  drain(ws, L);
  await settle(20);
  ws.end();
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
