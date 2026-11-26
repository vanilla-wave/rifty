// stream/promises.pipeline: fs.ReadStream -> async generator -> fs.WriteStream.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const src = path.join(__dirname, 'in.txt');
const dst = path.join(__dirname, 'out.txt');
fs.writeFileSync(src, 'abc\n'.repeat(50000));
(async () => {
  try {
    await pipeline(
      fs.createReadStream(src),
      async function* (source) {
        for await (const c of source)
          yield Buffer.from(c.toString('latin1').toUpperCase(), 'latin1');
      },
      fs.createWriteStream(dst),
    );
    const out = fs.readFileSync(dst, 'latin1');
    console.log('pipeline', out.length, out === 'ABC\n'.repeat(50000));
  } catch (e) {
    console.log('pipeline threw', e2s(e));
  }
})();
