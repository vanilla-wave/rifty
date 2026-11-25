// 16 MiB file -> Transform (async per chunk) -> fs.WriteStream. In-flight = bytes the source emitted
// minus bytes the Transform handed on; Node bounds it by highWaterMarks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const { Transform } = require('node:stream');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const src = path.join(__dirname, 'big.bin');
const dst = path.join(__dirname, 'big.out');
const SIZE = 16 * 1024 * 1024;
const input = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) input[i] = (i * 31 + (i >> 11)) & 255;
fs.writeFileSync(src, input);
let read = 0;
let handed = 0;
let max = 0;
const rs = fs.createReadStream(src);
rs.on('data', (c) => {
  read += c.length;
  max = Math.max(max, read - handed);
});
const t = new Transform({
  transform(c, _e, cb) {
    setImmediate(() => {
      handed += c.length;
      cb(null, c);
    });
  },
});
const ws = fs.createWriteStream(dst);
ws.on('close', () => {
  const st = fs.statSync(dst);
  console.log(
    'size',
    st.size === SIZE,
    'bytes',
    sha(fs.readFileSync(dst)) === sha(input),
    sha(input),
    'maxInFlight<=1MiB',
    max <= 1024 * 1024,
  );
  process.stderr.write(`maxInFlight ${max}\n`);
});
ws.on('error', (e) => console.log('ws error', e2s(e)));
try {
  rs.pipe(t).pipe(ws);
} catch (e) {
  console.log('pipe threw', e2s(e));
}
