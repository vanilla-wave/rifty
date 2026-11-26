// A 'data' listener attached after several awaits: Node keeps the stream paused until then.
const fs = require('node:fs');
const path = require('node:path');
const f = path.join(__dirname, 'in.txt');
fs.writeFileSync(f, 'x'.repeat(200000));
let n = 0;
let ended = false;
process.on('exit', () => console.log('exit bytes', n, 'end', ended));
(async () => {
  const rs = fs.createReadStream(f);
  await null;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 20));
  rs.on('data', (c) => {
    n += c.length;
  });
  rs.on('end', () => {
    ended = true;
  });
})();
