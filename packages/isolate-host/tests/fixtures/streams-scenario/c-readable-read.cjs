// on('readable') + read() loop over fs.createReadStream.
const fs = require('node:fs');
const path = require('node:path');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const f = path.join(__dirname, 'in.txt');
fs.writeFileSync(f, 'y'.repeat(150000));
let n = 0;
let ended = false;
process.on('exit', () => console.log('exit bytes', n, 'end', ended));
try {
  const rs = fs.createReadStream(f);
  rs.on('readable', () => {
    for (let c = rs.read(); c !== null; c = rs.read()) n += c.length;
  });
  rs.on('end', () => {
    ended = true;
  });
} catch (e) {
  console.log('threw', e2s(e));
}
