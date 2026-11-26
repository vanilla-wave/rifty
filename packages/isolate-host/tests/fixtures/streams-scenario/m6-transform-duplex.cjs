// Transform/Duplex rows: Transform backpressure (readable side unread), Duplex surface and event order.
const { Duplex, Transform, PassThrough, Writable } = require('node:stream');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
row('Transform objectMode hwm 2, 8 writes, nobody reads', async (L) => {
  let calls = 0;
  const t = new Transform({
    highWaterMark: 2,
    objectMode: true,
    transform(c, _e, cb) {
      calls++;
      cb(null, c);
    },
  });
  const rets = [];
  for (let i = 0; i < 8; i++) rets.push(t.write(i));
  await settle(10);
  L.push(
    rets.join(' '),
    `transformCalls=${calls}`,
    `readableLength=${t.readableLength}`,
    `writableLength=${t.writableLength}`,
  );
});
row('Transform bytes: writes of 1 KiB until write() is false (cap 1000)', async (L) => {
  let calls = 0;
  const t = new Transform({
    transform(c, _e, cb) {
      calls++;
      cb(null, c);
    },
  });
  let n = 0;
  while (n < 1000 && t.write(Buffer.alloc(1024))) n++;
  await settle(10);
  L.push(
    `acceptedBeforeFalse=${n}`,
    `transformCalls=${calls}`,
    `readableLength=${t.readableLength}`,
  );
});
row('PassThrough -> slow Writable, producer honors write(): max PassThrough buffer', async (L) => {
  const p = new PassThrough();
  const w = new Writable({
    write(_c, _e, cb) {
      setImmediate(cb);
    },
  });
  p.pipe(w);
  let max = 0;
  for (let i = 0; i < 1024; i++) {
    const ok = p.write(Buffer.alloc(1024));
    max = Math.max(max, p.readableLength + p.writableLength);
    if (!ok) await new Promise((r) => p.once('drain', r));
  }
  p.end();
  await new Promise((r) => w.on('finish', r));
  L.push(`max<=256KiB=${max <= 262144}`, `max=${max}`);
});
row('Transform event order end("x")', async (L) => {
  const t = new Transform({
    transform(c, _e, cb) {
      L.push('T');
      cb(null, c);
    },
    flush(cb) {
      L.push('F');
      cb();
    },
  });
  for (const ev of ['prefinish', 'finish', 'end', 'close']) t.on(ev, () => L.push(ev));
  t.on('data', () => L.push('data'));
  t.end('x');
});
row('Duplex event order end("x") with readable ended', async (L) => {
  const d = new Duplex({
    read() {
      this.push('r');
      this.push(null);
    },
    write(_c, _e, cb) {
      cb();
    },
  });
  for (const ev of ['finish', 'end', 'close']) d.on(ev, () => L.push(ev));
  d.on('data', () => L.push('data'));
  d.end('x');
});
row('Duplex writable members', async (L) => {
  const d = new Duplex({
    read() {},
    write(_c, _e, cb) {
      cb();
    },
  });
  L.push(
    ['cork', 'uncork', 'setDefaultEncoding'].map((k) => typeof d[k]).join(' '),
    `corked=${d.writableCorked}`,
  );
});
row('per-side objectMode options', async (L) => {
  const t = new Transform({
    writableObjectMode: true,
    transform(c, _e, cb) {
      cb(null, String(c));
    },
  });
  L.push(
    `T.writableObjectMode=${t.writableObjectMode}`,
    `T.writableHighWaterMark=${t.writableHighWaterMark}`,
    `PT.readableObjectMode=${new PassThrough({ readableObjectMode: true }).readableObjectMode}`,
  );
});
row('allowHalfOpen false: readable end ends writable', async (L) => {
  const d = new Duplex({
    allowHalfOpen: false,
    read() {
      this.push(null);
    },
    write(_c, _e, cb) {
      cb();
    },
  });
  d.on('finish', () => L.push('finish'))
    .on('end', () => L.push('end'))
    .on('close', () => L.push('close'));
  d.resume();
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
