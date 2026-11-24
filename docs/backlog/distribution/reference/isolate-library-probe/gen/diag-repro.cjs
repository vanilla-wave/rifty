// node diag-repro.cjs: minimal repros of the stops in diag-outputs.cjs (exceljs CSV write/read,
// readFile, sheet protection; reading an fs stream: diag-fsread.cjs) plus sibling stream hooks and controls, one line each; the probe diffs
// them against real node.
const fs = require('node:fs');
const { Duplex, Transform, Writable, PassThrough } = require('node:stream');
fs.writeFileSync('r.txt', 'abc');
const rs = fs.createReadStream('r.txt');
console.log(`typeof fs.createReadStream().close: ${typeof rs.close}`);
rs.destroy();
console.log(`typeof fs.createWriteStream().close: ${typeof fs.createWriteStream('w.txt').close}`);
const kind = (c) =>
  `${c?.constructor?.name} instanceof Buffer=${c instanceof Buffer} isBuffer=${Buffer.isBuffer(c)}`;
// A Transform pushing a Buffer, piped into a plain object with a write() (exceljs StreamBuf's shape).
const t = new Transform({
  transform(row, _enc, cb) {
    this.push(Buffer.from(String(row), 'utf8'));
    cb();
  },
});
const got = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    got.push(`Writable.write chunk: ${kind(chunk)}`);
    cb();
  },
});
t.on('data', (c) => got.push(`'data' chunk: ${kind(c)}`));
t.pipe(sink);
const p = new PassThrough();
p.on('data', (c) => got.push(`PassThrough 'data' of a Buffer: ${kind(c)}`));
p.write(Buffer.from('x'));
t.end('row');
// A Transform subclass with _transform, without and with a public transform() method (fast-csv's
// CsvFormatterStream has both: CsvFormatterStream.js:6-17).
const sub = (withMethod) => {
  class T extends Transform {
    _transform(c, _e, cb) {
      this.push(Buffer.from(`<${c}>`));
      cb();
    }
  }
  if (withMethod)
    T.prototype.transform = function () {
      return this;
    };
  const s = new T();
  const out = [];
  s.on('data', (c) => out.push(String(c)));
  s.on('end', () =>
    got.push(
      `Transform subclass _transform${withMethod ? ' + transform() method' : ''}: ${out.join('')}`,
    ),
  );
  s.end('x');
};
sub(false);
sub(true);
// The other subclass hooks, same shape.
{
  class F extends Transform {
    _transform(c, _e, cb) {
      cb(null, c);
    }
    _flush(cb) {
      this.push('!');
      cb();
    }
  }
  const f = new F();
  const out = [];
  f.on('data', (c) => out.push(String(c)));
  f.on('end', () => got.push(`Transform subclass _flush: ${out.join('')}`));
  f.end('y');
  class D extends Duplex {
    _read() {}
    _write(c, _e, cb) {
      got.push(`Duplex subclass _write: ${c}`);
      cb();
    }
  }
  new D().end('d');
  class W extends Writable {
    _write(c, _e, cb) {
      got.push(`Writable subclass _write: ${c}`);
      cb();
    }
  }
  new W().end('z');
  class R extends require('node:stream').Readable {
    _read() {
      this.push('r');
      this.push(null);
    }
  }
  const r = new R();
  r.on('data', (c) => got.push(`Readable subclass _read: ${c}`));
}
// crypto's sha512 (exceljs worksheet.protect).
{
  const crypto = require('node:crypto');
  got.push(`crypto.getHashes() has sha512: ${crypto.getHashes().includes('sha512')}`);
  try {
    got.push(
      `crypto.createHash('sha512'): ${crypto.createHash('sha512').update('x').digest('hex').slice(0, 8)}`,
    );
  } catch (e) {
    got.push(`crypto.createHash('sha512'): ${e.name}: ${e.message}`);
  }
}
// JSZip's entry list for a nested file (control: equal on both).
{
  const JSZip = require('jszip');
  const z = new JSZip();
  z.file('a/b.txt', 'x');
  got.push(`JSZip entries of file('a/b.txt'): ${Object.keys(z.files).join(',')}`);
  z.generateAsync({ type: 'nodebuffer' }).then((buf) =>
    JSZip.loadAsync(buf).then((back) =>
      got.push(
        `JSZip entries after generate: ${Object.keys(back.files).join(',')} (${buf.length} B)`,
      ),
    ),
  );
}
// exceljs CSV's own pipe: fast-csv's formatter stream into exceljs's StreamBuf; what write() gets.
const StreamBuf = require('exceljs/lib/utils/stream-buf');
const { format } = require('@fast-csv/format');
const sb = new StreamBuf();
const write = sb.write;
sb.write = function (data, ...rest) {
  got.push(`StreamBuf.write data: ${kind(data)}${typeof data === 'string' ? ' string' : ''}`);
  return write.call(this, Buffer.isBuffer(data) ? data : Buffer.from(data), ...rest);
};
const csv = format();
csv.pipe(sb);
csv.write(['a', 1]);
csv.end();
setTimeout(() => {
  for (const l of new Set(got)) console.log(l);
}, 50);
