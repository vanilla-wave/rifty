// The windows between units: core wired with today's fs classes (after 8c, before 9r), and Node's
// ReadStream with today's WriteStream (after 9r, before 9w). Rows a consumer could observe there.
const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const sp = require('node:stream/promises');
const e2s = (e) => (e ? `${e.code || e.name}` : 'none');
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const src = path.join(__dirname, 'win.txt');
fs.writeFileSync(src, 'w'.repeat(100000));
let k = 0;
const out = () => path.join(__dirname, `win-${k++}.out`);
row('ws instanceof Writable / isWritable', async (L) => {
  const ws = fs.createWriteStream(out());
  L.push(ws instanceof stream.Writable, stream.isWritable(ws));
  ws.destroy();
});
row('callback pipeline(rs, ws): cb, destroyed/closed, bytes', async (L) => {
  const f = out();
  const ws = fs.createWriteStream(f);
  await new Promise((res) =>
    stream.pipeline(fs.createReadStream(src), ws, (e) => {
      L.push(`cb ${e2s(e)}`);
      res();
    }),
  );
  await settle(20);
  L.push(`destroyed=${ws.destroyed}`, `closed=${ws.closed}`, `bytes=${fs.readFileSync(f).length}`);
});
row('callback pipeline(rs, PassThrough, ws): cb, bytes', async (L) => {
  const f = out();
  await new Promise((res) =>
    stream.pipeline(
      fs.createReadStream(src),
      new stream.PassThrough(),
      fs.createWriteStream(f),
      (e) => {
        L.push(`cb ${e2s(e)}`);
        res();
      },
    ),
  );
  await settle(20);
  L.push(`bytes=${fs.readFileSync(f).length}`);
});
row('promises.pipeline(rs, async gen, ws)', async (L) => {
  const f = out();
  try {
    await Promise.race([
      sp.pipeline(
        fs.createReadStream(src),
        async function* (s) {
          for await (const c of s) yield c;
        },
        fs.createWriteStream(f),
      ),
      settle(2000).then(() => {
        throw new Error('pending');
      }),
    ]);
    L.push('resolved', `bytes=${fs.readFileSync(f).length}`);
  } catch (e) {
    L.push(`threw ${e2s(e)}`);
  }
});
row('ws.destroy(err) mid-pipe: error event on ws', async (L) => {
  const rs = fs.createReadStream(src, { highWaterMark: 1024 });
  const ws = fs.createWriteStream(out());
  ws.on('error', (e) => L.push(`ws error ${e2s(e)}`));
  rs.pipe(ws);
  rs.once('data', () => ws.destroy(Object.assign(new Error('x'), { code: 'EX' })));
  await settle(50);
});
row('late finished(ws) after close', async (L) => {
  const ws = fs.createWriteStream(out());
  ws.end('x');
  await new Promise((r) => ws.on('close', r));
  await Promise.race([
    new Promise((res) =>
      stream.finished(ws, (e) => {
        L.push(`cb ${e2s(e)}`);
        res();
      }),
    ),
    settle(300).then(() => L.push('no cb')),
  ]);
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
