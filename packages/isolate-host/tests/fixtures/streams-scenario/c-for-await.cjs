// for await over fs.createReadStream: bytes, chunks, digest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const f = path.join(__dirname, 'in.bin');
const data = Buffer.alloc(300000);
for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 8)) & 255;
fs.writeFileSync(f, data);
(async () => {
  let n = 0;
  let chunks = 0;
  const h = crypto.createHash('sha256');
  try {
    for await (const c of fs.createReadStream(f)) {
      n += c.length;
      chunks++;
      h.update(c);
    }
    console.log('for-await', n, chunks, h.digest('hex').slice(0, 12));
  } catch (e) {
    console.log('for-await threw', e2s(e));
  }
})();
