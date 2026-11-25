// fs.ReadStream rows: fs.ReadStream as Node's Readable subclass — shape, members, paused buffer, modes.
const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const util = require('node:util');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const F = path.join(__dirname, 'r.txt');
const BIG = path.join(__dirname, 'r-big.txt');
fs.writeFileSync(F, 'hello');
fs.writeFileSync(BIG, 'z'.repeat(300000));
const U = path.join(__dirname, 'r-utf8.txt');
fs.writeFileSync(U, 'é'.repeat(9));
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const MEMBERS = [
  'pause',
  'resume',
  'read',
  'setEncoding',
  'unpipe',
  'unshift',
  'wrap',
  'push',
  'iterator',
  'map',
  'filter',
  'toArray',
  'close',
  'destroy',
  'pipe',
  '_read',
  '_destroy',
  '_construct',
  'open',
];
const PROPS = [
  'readable',
  'readableLength',
  'readableHighWaterMark',
  'readableEncoding',
  'readableEnded',
  'readableObjectMode',
  'destroyed',
  'closed',
  'errored',
  'pending',
  'bytesRead',
  'fd',
  'flags',
  'mode',
  'start',
  'end',
  'autoClose',
];
row('instanceof Readable; prototype chain; isReadable', async (L) => {
  const rs = fs.createReadStream(F);
  L.push(
    rs instanceof stream.Readable,
    Object.getPrototypeOf(fs.ReadStream.prototype) === stream.Readable.prototype,
    stream.isReadable(rs),
  );
  rs.destroy();
});
row('member types', async (L) => {
  const rs = fs.createReadStream(F);
  L.push(
    MEMBERS.map((m) => `${m}:${typeof rs[m]}`).join(' '),
    `asyncIterator:${typeof rs[Symbol.asyncIterator]}`,
  );
  rs.destroy();
});
row('property values at create', async (L) => {
  const rs = fs.createReadStream(F);
  L.push(PROPS.map((p) => `${p}=${util.inspect(rs[p])}`).join(' '));
  rs.destroy();
});
row('property values at end', async (L) => {
  const rs = fs.createReadStream(F);
  rs.resume();
  await new Promise((r) => rs.on('close', r));
  L.push(PROPS.map((p) => `${p}=${util.inspect(rs[p])}`).join(' '));
});
row('ReadStream(path) without new', async (L) => {
  const rs = fs.ReadStream(F);
  L.push(rs instanceof fs.ReadStream);
  rs.destroy();
});
row('graceful-fs shape: ReadStream.apply(this) + prototype open override', async (L) => {
  function G(p, o) {
    fs.ReadStream.apply(this, [p, o]);
    return this;
  }
  G.prototype = Object.create(fs.ReadStream.prototype);
  G.prototype.open = function () {
    fs.open(this.path, this.flags, this.mode, (er, fd) => {
      if (er) return this.destroy(er);
      this.fd = fd;
      this.emit('open', fd);
      this.read();
    });
  };
  const rs = new G(F);
  let s = '';
  rs.on('data', (c) => {
    s += c;
  });
  await new Promise((r, j) => rs.on('end', r).on('error', j));
  L.push(JSON.stringify(s));
});
row('class extends fs.ReadStream', async (L) => {
  class X extends fs.ReadStream {}
  const rs = new X(F);
  let s = '';
  rs.on('data', (c) => {
    s += c;
  });
  await new Promise((r, j) => rs.on('end', r).on('error', j));
  L.push(JSON.stringify(s));
});
row('paused buffer: no listener 30ms, then readableLength and data', async (L) => {
  const rs = fs.createReadStream(BIG);
  await settle(30);
  L.push(`readableLength=${rs.readableLength}`);
  let n = 0;
  rs.on('data', (c) => {
    n += c.length;
  });
  await new Promise((r) => rs.on('end', r));
  L.push(`bytes=${n}`);
});
row('pause in first data, resume after 20ms', async (L) => {
  const rs = fs.createReadStream(BIG);
  let n = 0;
  let during = 0;
  rs.once('data', (c) => {
    n += c.length;
    rs.pause();
    setTimeout(() => {
      L.push(`paused got=${during}`);
      rs.on('data', (d) => {
        n += d.length;
      });
      rs.resume();
    }, 20);
    rs.on('data', () => {
      during++;
    });
  });
  await new Promise((r) => rs.on('end', r));
  L.push(`bytes=${n}`);
});
row('setEncoding utf8, highWaterMark 5, split code points', async (L) => {
  const rs = fs.createReadStream(U, { highWaterMark: 5 });
  rs.setEncoding('utf8');
  const parts = [];
  rs.on('data', (c) => parts.push(c));
  await new Promise((r) => rs.on('end', r));
  L.push(parts.join('|'));
});
row(
  'encoding option base64 / utf16le / latin1 with highWaterMark 4 (decoder across chunks)',
  async (L) => {
    const f = path.join(__dirname, 'r-enc.bin');
    fs.writeFileSync(f, Buffer.from('abcdefghij\u00e9\u00ff\u0100\ud83d\ude00!', 'utf16le'));
    for (const encoding of ['base64', 'utf16le', 'latin1', 'hex']) {
      const parts = [];
      try {
        for await (const c of fs.createReadStream(f, { encoding, highWaterMark: 4 })) parts.push(c);
        L.push(`${encoding}:${parts.join('|')}`);
      } catch (e) {
        L.push(`${encoding}:threw ${e2s(e)}`);
      }
    }
  },
);
row(
  "encoding option through 'data' (no for await): base64 / utf16le / latin1 / hex, highWaterMark 4",
  async (L) => {
    const f = path.join(__dirname, 'r-enc2.bin');
    fs.writeFileSync(f, Buffer.from('abcdefghij\u00e9\u00ff\u0100\ud83d\ude00!', 'utf16le'));
    for (const encoding of ['base64', 'utf16le', 'latin1', 'hex']) {
      try {
        const parts = [];
        await new Promise((res, rej) => {
          const rs = fs.createReadStream(f, { encoding, highWaterMark: 4 });
          rs.on('data', (c) => parts.push(c))
            .on('end', res)
            .on('error', rej);
        });
        L.push(`${encoding}:${parts.join('|')}`);
      } catch (e) {
        L.push(`${encoding}:threw ${e2s(e)}`);
      }
    }
  },
);
row('read(3) sized reads', async (L) => {
  const rs = fs.createReadStream(F);
  const got = [];
  rs.on('readable', () => {
    for (let c = rs.read(3); c !== null; c = rs.read(3)) got.push(String(c));
  });
  await new Promise((r) => rs.on('end', r));
  L.push(got.join('|'));
});
row('for await break: destroy and close', async (L) => {
  const rs = fs.createReadStream(BIG);
  rs.on('close', () => L.push('close'));
  for await (const c of rs) {
    L.push(`chunk ${c.length}`);
    break;
  }
  L.push(`destroyed=${rs.destroyed}`);
});
row('timers run while 16 MiB streams (for await)', async (L) => {
  const f = path.join(__dirname, 'r-16m.bin');
  fs.writeFileSync(f, Buffer.alloc(16 * 1024 * 1024, 1));
  let ticks = 0;
  const t = setInterval(() => {
    ticks++;
  }, 1);
  let n = 0;
  try {
    for await (const c of fs.createReadStream(f)) n += c.length;
  } finally {
    clearInterval(t);
  }
  L.push(`bytes=${n}`, `ticks>0=${ticks > 0}`);
});
row('timers run during an fs.read(fd) loop over 16 MiB (the fd source alone)', async (L) => {
  const f = path.join(__dirname, 'r-16m.bin');
  fs.writeFileSync(f, Buffer.alloc(16 * 1024 * 1024, 1));
  let ticks = 0;
  const t = setInterval(() => {
    ticks++;
  }, 1);
  const fd = await new Promise((r, j) => fs.open(f, 'r', (e, d) => (e ? j(e) : r(d))));
  const buf = Buffer.alloc(65536);
  let n = 0;
  for (;;) {
    const k = await new Promise((r, j) =>
      fs.read(fd, buf, 0, buf.length, null, (e, b) => (e ? j(e) : r(b))),
    );
    if (k === 0) break;
    n += k;
  }
  await new Promise((r) => fs.close(fd, r));
  clearInterval(t);
  L.push(`bytes=${n}`, `ticks>0=${ticks > 0}`);
});
row('close(cb) mid-read', async (L) => {
  const rs = fs.createReadStream(BIG);
  rs.on('close', () => L.push('close'));
  rs.once('data', () => rs.close((e) => L.push(`cb ${e2s(e)}`)));
});
row('destroy(err): error then close, errored', async (L) => {
  const rs = fs.createReadStream(F);
  rs.on('error', (e) => L.push(`error ${e2s(e)}`)).on('close', () =>
    L.push(`close errored=${rs.errored?.message}`),
  );
  rs.destroy(new Error('stop'));
});
row('pipe to slow Writable: max dest writableLength', async (L) => {
  const rs = fs.createReadStream(BIG);
  let max = 0;
  const w = new stream.Writable({
    highWaterMark: 1024,
    write(_c, _e, cb) {
      setImmediate(cb);
    },
  });
  const ow = w.write;
  w.write = function (...a) {
    const r = ow.apply(this, a);
    max = Math.max(max, this.writableLength);
    return r;
  };
  rs.pipe(w);
  await new Promise((r) => w.on('finish', r));
  L.push(`max<=128KiB=${max <= 131072}`, `max=${max}`);
});
row('missing file: error code and close', async (L) => {
  const rs = fs.createReadStream(path.join(__dirname, 'nope.txt'));
  rs.on('error', (e) => L.push(`error ${e.code}`)).on('close', () => L.push('close'));
});
row("Node's ReadStream source: fs.open + fs.read(fd) + fs.close callbacks", async (L) => {
  const fd = await new Promise((r, j) => fs.open(F, 'r', (e, d) => (e ? j(e) : r(d))));
  const buf = Buffer.alloc(16);
  const n = await new Promise((r, j) => fs.read(fd, buf, 0, 16, 0, (e, k) => (e ? j(e) : r(k))));
  await new Promise((r, j) => fs.close(fd, (e) => (e ? j(e) : r())));
  L.push(`fd=${typeof fd}`, `read=${n}`, JSON.stringify(buf.subarray(0, n).toString()));
});
row('Readable.from(fs.ReadStream) / toArray', async (L) => {
  const arr = await stream.Readable.from(fs.createReadStream(F)).toArray();
  L.push(arr.map(String).join('|'));
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
