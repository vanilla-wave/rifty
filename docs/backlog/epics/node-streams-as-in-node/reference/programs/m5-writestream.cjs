// fs.WriteStream rows: fs.WriteStream as Node's Writable subclass — shape graceful-fs needs, members, drain, close.
const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const util = require('node:util');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
let k = 0;
const out = () => path.join(__dirname, `w${k++}.txt`);
const read = (f) => JSON.stringify(fs.readFileSync(f, 'utf8'));
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const MEMBERS = [
  'write',
  'end',
  'cork',
  'uncork',
  'setDefaultEncoding',
  'destroy',
  'close',
  'destroySoon',
  '_write',
  '_writev',
  '_final',
  '_destroy',
  '_construct',
  'open',
];
const PROPS = [
  'writable',
  'writableLength',
  'writableHighWaterMark',
  'writableEnded',
  'writableFinished',
  'writableCorked',
  'writableObjectMode',
  'destroyed',
  'closed',
  'errored',
  'pending',
  'bytesWritten',
  'fd',
  'flags',
  'mode',
  'start',
  'pos',
  'autoClose',
];
row('instanceof Writable; prototype chain; isWritable', async (L) => {
  const ws = fs.createWriteStream(out());
  L.push(
    ws instanceof stream.Writable,
    Object.getPrototypeOf(fs.WriteStream.prototype) === stream.Writable.prototype,
    stream.isWritable(ws),
  );
  ws.destroy();
});
row('member types', async (L) => {
  const ws = fs.createWriteStream(out());
  L.push(MEMBERS.map((m) => `${m}:${typeof ws[m]}`).join(' '));
  ws.destroy();
});
row('property values at create', async (L) => {
  const ws = fs.createWriteStream(out());
  L.push(PROPS.map((p) => `${p}=${util.inspect(ws[p])}`).join(' '));
  ws.destroy();
});
row('property values after end', async (L) => {
  const ws = fs.createWriteStream(out());
  ws.end('abc');
  await new Promise((r) => ws.on('close', r));
  L.push(PROPS.map((p) => `${p}=${util.inspect(ws[p])}`).join(' '));
});
row('WriteStream(path) without new', async (L) => {
  const f = out();
  const ws = fs.WriteStream(f);
  L.push(ws instanceof fs.WriteStream);
  ws.end('x');
  await new Promise((r) => ws.on('close', r));
  L.push(read(f));
});
row('graceful-fs shape: WriteStream.apply(this) + prototype open override', async (L) => {
  function G(p, o) {
    fs.WriteStream.apply(this, [p, o]);
    return this;
  }
  G.prototype = Object.create(fs.WriteStream.prototype);
  G.prototype.open = function () {
    fs.open(this.path, this.flags, this.mode, (er, fd) => {
      if (er) {
        this.destroy();
        this.emit('error', er);
        return;
      }
      this.fd = fd;
      this.emit('open', fd);
    });
  };
  const f = out();
  const ws = new G(f);
  ws.on('open', (fd) => L.push(`open ${typeof fd}`));
  ws.end('graceful');
  await new Promise((r, j) => ws.on('close', r).on('error', j));
  L.push(read(f));
});
row('class extends fs.WriteStream', async (L) => {
  class X extends fs.WriteStream {}
  const f = out();
  const ws = new X(f);
  ws.end('cls');
  await new Promise((r, j) => ws.on('close', r).on('error', j));
  L.push(read(f));
});
row('write() returns false over highWaterMark, then drain', async (L) => {
  const ws = fs.createWriteStream(out(), { highWaterMark: 4 });
  L.push(`w1=${ws.write('ab')}`, `w2=${ws.write('cdef')}`);
  ws.on('drain', () => L.push('drain'));
  await settle(20);
  ws.end();
});
row('cork/uncork: one file content', async (L) => {
  const f = out();
  const ws = fs.createWriteStream(f);
  ws.cork();
  ws.write('a');
  ws.write('b');
  L.push(`corked=${ws.writableCorked}`);
  ws.uncork();
  ws.end('c');
  await new Promise((r) => ws.on('close', r));
  L.push(read(f));
});
row('event order end(cb): finish/close/cb', async (L) => {
  const ws = fs.createWriteStream(out());
  for (const ev of ['open', 'ready', 'prefinish', 'finish', 'close']) ws.on(ev, () => L.push(ev));
  ws.end('x', () => L.push('end cb'));
});
row('close(cb) before end: pending writes land', async (L) => {
  const f = out();
  const ws = fs.createWriteStream(f);
  ws.write('keep');
  ws.close((e) => L.push(`cb ${e2s(e)}`));
  await new Promise((r) => ws.on('close', r));
  L.push(read(f));
});
row('write after end: callback and error', async (L) => {
  const ws = fs.createWriteStream(out());
  ws.on('error', (e) => L.push(`error ${e2s(e)}`));
  ws.end('x');
  ws.write('y', (e) => L.push(`cb ${e2s(e)}`));
});
row('destroy(err): error, close, errored', async (L) => {
  const ws = fs.createWriteStream(out());
  ws.on('error', (e) => L.push(`error ${e2s(e)}`)).on('close', () =>
    L.push(`close errored=${ws.errored?.message}`),
  );
  ws.destroy(new Error('stop'));
});
row('timers run while a WriteStream writes 16 MiB in 64 KiB chunks', async (L) => {
  const f = out();
  let ticks = 0;
  const t = setInterval(() => {
    ticks++;
  }, 0);
  const chunk = Buffer.alloc(65536, 0x62);
  const ws = fs.createWriteStream(f);
  try {
    for (let i = 0; i < 256; i++)
      if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
    await new Promise((r) => ws.end(r));
  } finally {
    clearInterval(t);
  }
  L.push(`bytes=${fs.statSync(f).size}`, `ticks>0=${ticks > 0}`);
});
row('Readable.pipe(ws) with slow source: bytes and finish', async (L) => {
  const f = out();
  const src = new stream.Readable({ read() {} });
  const ws = fs.createWriteStream(f);
  ws.on('finish', () => L.push('finish')).on('close', () => L.push('close'));
  src.pipe(ws);
  for (const s of ['1', '2', '3']) {
    src.push(s);
    await settle(5);
  }
  src.push(null);
  await new Promise((r) => ws.on('close', r));
  L.push(read(f));
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
