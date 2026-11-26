// Ordinary core paths through each binding (review of PR #471, round 1): Blob sources, Buffer
// and Uint8Array fs paths, web adapters with ArrayBuffer/SharedArrayBuffer/offset chunks,
// deprecation warnings and `noDeprecation`, the safe-integer bound, hidden validator frames.
const fs = require('node:fs');
const path = require('node:path');
const { Duplex, Readable, Writable, PassThrough, pipeline } = require('node:stream');

const e2s = (e) => (e ? `${e.name}|${e.code}|${String(e.message).split('\n')[0]}` : String(e));
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const collect = (r) =>
  new Promise((res, rej) => {
    const a = [];
    r.on('data', (c) => a.push(Buffer.from(c)));
    r.on('end', () => res(Buffer.concat(a).toString()));
    r.on('error', rej);
  });
const file = path.join(__dirname, 'p4.txt');
fs.writeFileSync(file, 'binding paths');

row('Duplex.from(Blob): text', async () => collect(Duplex.from(new Blob(['blob ', 'bytes']))));
row('fs.createReadStream(Buffer path)', async () => {
  const rs = fs.createReadStream(Buffer.from(file), 'utf8');
  return `${await collect(rs)} path=${Buffer.isBuffer(rs.path)}`;
});
row('fs.createWriteStream(Uint8Array path)', async () => {
  const out = path.join(__dirname, 'p4-u8.txt');
  const ws = fs.createWriteStream(new TextEncoder().encode(out));
  await new Promise((r) => ws.end('u8 path', r));
  return fs.readFileSync(out, 'utf8');
});
row('fs.createReadStream(Uint16Array path)', async () => {
  try {
    fs.createReadStream(new Uint16Array(2));
    return 'no throw';
  } catch (e) {
    return e2s(e);
  }
});
row('Writable.toWeb: ArrayBuffer, Uint8Array, SharedArrayBuffer, string chunks', async () => {
  const got = [];
  const w = new Writable({
    write(c, _e, cb) {
      got.push(`${c.constructor.name}:${c.length}`);
      cb();
    },
  });
  const wr = Writable.toWeb(w).getWriter();
  await wr.write(new ArrayBuffer(3));
  await wr.write(new Uint8Array(2));
  await wr.write(new SharedArrayBuffer(4)).catch((e) => got.push(`SAB ${e2s(e)}`));
  await wr.write('str').catch((e) => got.push(`str ${e2s(e)}`));
  await wr.close().catch((e) => got.push(`close ${e2s(e)}`));
  return got.join(' ');
});
row('Writable.fromWeb: subarray and non-utf8 string chunks', async () => {
  const got = [];
  const w = Writable.fromWeb(
    new WritableStream({
      write(c) {
        got.push(Buffer.from(c).toString('hex'));
      },
    }),
    { decodeStrings: true },
  );
  w.write(Buffer.from('xxabcxx').subarray(2, 5));
  w.write('héllo', 'latin1');
  await new Promise((r) => w.end('ZZ', 'ascii', r));
  return got.join(' ');
});
row('Readable.toWeb / Duplex.toWeb chunks', async () => {
  const rr = Readable.toWeb(Readable.from([Buffer.from('q'), Buffer.from('r')])).getReader();
  const v = [];
  for (;;) {
    const { done, value } = await rr.read();
    if (done) break;
    v.push(`${value.constructor.name}:${value}`);
  }
  const pair = Duplex.toWeb(new PassThrough());
  const wrr = pair.writable.getWriter();
  wrr.write(new Uint8Array([65, 66]));
  wrr.close();
  const r1 = await pair.readable.getReader().read();
  return `${v.join()} ${r1.value.constructor.name}:${r1.value}`;
});
row('Duplex.from(WritableStream) in pipeline', async () => {
  const got = [];
  const ws = new WritableStream({
    write(c) {
      got.push(String(c));
    },
  });
  await new Promise((r) => pipeline(Readable.from(['a', 'b']), Duplex.from(ws), r));
  return got.join();
});
row('ReadStream.prototype.open(): DEP0135 warning', async () => {
  const seen = [];
  const on = (w) => seen.push(`${w.name}:${w.code}`);
  process.on('warning', on);
  const rs = fs.createReadStream(file);
  rs.open();
  rs.destroy();
  await new Promise((r) => setTimeout(r, 20));
  process.off('warning', on);
  return seen.join() || 'none';
});
row('process.noDeprecation = true: no DEP0135', async () => {
  const seen = [];
  const on = (w) => seen.push(`${w.name}:${w.code}`);
  process.on('warning', on);
  process.noDeprecation = true;
  const { WriteStream } = fs;
  const ws = new WriteStream(path.join(__dirname, 'p4-nd.txt'));
  ws.open();
  ws.destroy();
  await new Promise((r) => setTimeout(r, 20));
  process.noDeprecation = false;
  process.off('warning', on);
  return seen.join() || 'none';
});
row('createReadStream start 2**31+1 / 2**53', async () => {
  const r = [];
  for (const start of [2 ** 31 + 1, 2 ** 53]) {
    try {
      const rs = fs.createReadStream(file, { start });
      rs.on('error', () => {});
      rs.destroy();
      r.push('ok');
    } catch (e) {
      r.push(e2s(e));
    }
  }
  return r.join(' ; ');
});
row('validator error: first stack frame (hidden validator frames)', async () => {
  try {
    new Readable({ highWaterMark: 'x' });
    return 'no throw';
  } catch (e) {
    return `${e2s(e)} @ ${String(e.stack)
      .split('\n')[1]
      ?.trim()
      .replace(/ \(.*$/, '')}`;
  }
});
row('destroy(err) on an errored stream: aggregate', async () => {
  const r = new Readable({
    read() {},
    destroy(err, cb) {
      cb(new Error('second'));
    },
  });
  const e = await new Promise((res) => {
    r.on('error', res);
    r.destroy(new Error('first'));
  });
  return `${e2s(e)} errors=${e.errors ? e.errors.map((x) => x.message).join('+') : 'none'}`;
});
row("a guest's util.inspect/format after load: an ERR_* text", async () => {
  const util = require('node:util');
  const [inspect, format] = [util.inspect, util.format];
  util.inspect = () => 'FAKE-INSPECT';
  util.format = () => 'FAKE-FORMAT';
  try {
    new Readable({ highWaterMark: 'x' });
    return 'no throw';
  } catch (e) {
    return e.message;
  } finally {
    util.inspect = inspect;
    util.format = format;
  }
});

(async () => {
  for (const [name, fn] of rows) {
    let v;
    try {
      v = await fn();
    } catch (e) {
      v = `threw ${e2s(e)}`;
    }
    console.log(`${name} => ${v}`);
  }
})();
