// Modules the Node stream core binds to, as Node: string_decoder encodings, Buffer encoding names
// (normalizeEncoding), events.addAbortListener, fs.writev/fsync, fs callback phase vs timers.
const fs = require('node:fs');
const path = require('node:path');
const events = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const NAMES = [
  'utf8',
  'UTF8',
  'utf-8',
  'UTF-8',
  'Utf8',
  'ucs2',
  'UCS2',
  'ucs-2',
  'utf16le',
  'UTF16LE',
  'utf-16le',
  'latin1',
  'LATIN1',
  'binary',
  'BINARY',
  'base64',
  'BASE64',
  'base64url',
  'hex',
  'HEX',
  'ascii',
  'ASCII',
  'nope',
  '',
];
const BYTES = Buffer.from([0x41, 0xe9, 0x00, 0xff, 0x80]);
const tryit = (f) => {
  try {
    return f();
  } catch (e) {
    // An error is labelled (threw <class> <code>), never printed like a value.
    return `threw ${e?.name ?? typeof e}${e?.code !== undefined ? ` ${e.code}` : ''}: ${String(e?.message).slice(0, 40)}`;
  }
};
row('Buffer.isEncoding per name', async (L) => {
  L.push(NAMES.map((n) => `${n || "''"}:${Buffer.isEncoding(n)}`).join(' '));
});
row('buf.toString(name) per name', async (L) => {
  L.push(
    NAMES.map(
      (n) =>
        `${n || "''"}:${tryit(() => Buffer.from(BYTES.toString(n), 'latin1').toString('hex'))}`,
    ).join(' '),
  );
});
row('Buffer.from(str, name) per name', async (L) => {
  L.push(
    NAMES.map((n) => `${n || "''"}:${tryit(() => Buffer.from('Aé', n).toString('hex'))}`).join(' '),
  );
});
row('new StringDecoder(name).write+end per name', async (L) => {
  L.push(
    NAMES.map(
      (n) =>
        `${n || "''"}:${tryit(() => {
          const d = new StringDecoder(n || undefined);
          return Buffer.from(
            d.write(BYTES.subarray(0, 3)) + d.end(BYTES.subarray(3)),
            'latin1',
          ).toString('hex');
        })}`,
    ).join(' '),
  );
});
row('events.addAbortListener', async (L) => {
  L.push(`typeof=${typeof events.addAbortListener}`);
  if (typeof events.addAbortListener !== 'function') return;
  const ac = new AbortController();
  const d = events.addAbortListener(ac.signal, () => L.push('aborted'));
  ac.abort();
  L.push(`disposable=${typeof d[Symbol.dispose]}`);
});
row('fs.writev / fs.fsync / fs.writevSync / fs.fsyncSync types', async (L) => {
  L.push(
    ['writev', 'fsync', 'writevSync', 'fsyncSync', 'fdatasync']
      .map((k) => `${k}:${typeof fs[k]}`)
      .join(' '),
  );
});
row('fs.read callback vs a timer due now', async (L) => {
  const f = path.join(__dirname, 'b.txt');
  fs.writeFileSync(f, 'abc');
  const fd = fs.openSync(f, 'r');
  setTimeout(() => L.push('timer'), 0);
  await new Promise((r) => setTimeout(r, 2));
  fs.read(fd, Buffer.alloc(3), 0, 3, 0, () => L.push('read cb'));
  setImmediate(() => L.push('immediate'));
  await settle(20);
  fs.closeSync(fd);
});
row('fs.write then fs.close in the same tick: bytes land', async (L) => {
  const f = path.join(__dirname, 'w.txt');
  const fd = fs.openSync(f, 'w');
  fs.write(fd, 'data', (e) => L.push(`write cb ${e ? e2s(e) : 'ok'}`));
  fs.close(fd, (e) => L.push(`close cb ${e ? e2s(e) : 'ok'}`));
  await settle(20);
  L.push(JSON.stringify(fs.readFileSync(f, 'utf8')));
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
