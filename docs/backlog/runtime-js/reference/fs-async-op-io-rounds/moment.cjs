// Async fs write entries × the moment the caller mutates its buffer; plus class rows.
const fs = require('node:fs');
const bytes = (p) => Array.from(fs.readFileSync(p)).join(',');
const moments = {
  sync: (f) => f(),
  microtask: (f) => queueMicrotask(f),
  nextTick: (f) => process.nextTick(f),
  setImmediate: (f) => setImmediate(f),
  after: null,
};
const done = (res, rej) => (e) => (e ? rej(e) : res());
const entries = {
  'promises.writeFile': (p, b, s) => {
    const r = fs.promises.writeFile(p, b);
    s();
    return r;
  },
  'promises.appendFile': (p, b, s) => {
    const r = fs.promises.appendFile(p, b);
    s();
    return r;
  },
  'writeFile cb': (p, b, s) =>
    new Promise((res, rej) => {
      fs.writeFile(p, b, done(res, rej));
      s();
    }),
  'appendFile cb':
    typeof fs.appendFile !== 'function'
      ? null
      : (p, b, s) =>
          new Promise((res, rej) => {
            fs.appendFile(p, b, done(res, rej));
            s();
          }),
  'write fd cb': (p, b, s) =>
    new Promise((res, rej) => {
      const fd = fs.openSync(p, 'w');
      fs.write(fd, b, (e) => {
        fs.closeSync(fd);
        e ? rej(e) : res();
      });
      s();
    }),
  'FileHandle.writeFile':
    typeof fs.promises.open !== 'function'
      ? null
      : async (p, b, s) => {
          const h = await fs.promises.open(p, 'w');
          const r = h.writeFile(b);
          s();
          await r;
          await h.close();
        },
  'FileHandle.write':
    typeof fs.promises.open !== 'function'
      ? null
      : async (p, b, s) => {
          const h = await fs.promises.open(p, 'w');
          const r = h.write(b);
          s();
          await r;
          await h.close();
        },
  'WriteStream before open': (p, b, s) =>
    new Promise((res) => {
      const ws = fs.createWriteStream(p);
      ws.write(b);
      s();
      ws.end(res);
    }),
  'WriteStream after open': (p, b, s) =>
    new Promise((res) => {
      const ws = fs.createWriteStream(p);
      ws.on('open', () => {
        ws.write(b);
        s();
        ws.end(res);
      });
    }),
};
(async () => {
  let n = 0;
  for (const [entry, run] of Object.entries(entries)) {
    if (run === null) {
      console.log(entry, 'missing');
      continue;
    }
    const row = [];
    for (const [moment, at] of Object.entries(moments)) {
      const p = `m${n++}`;
      const b = new Uint8Array([1, 2, 3]);
      const fill = () => b.fill(9);
      try {
        await run(p, b, at === null ? () => {} : () => at(fill));
        if (at === null) fill();
        await new Promise((r) => setImmediate(r));
        row.push(`${moment}=${bytes(p)}`);
      } catch (e) {
        row.push(`${moment}=${e.code || e.message}`);
      }
    }
    console.log(entry, row.join(' '));
  }
  // Class rows: the op runs at the call here, in its own turn in Node.
  fs.writeFileSync('c1', 'abc');
  const fd = fs.openSync('c1', 'r');
  const into = Buffer.alloc(3);
  await new Promise((res) => {
    fs.read(fd, into, 0, 3, 0, res);
    console.log('fs.read fills buf before return', into.toString('latin1') === 'abc');
  });
  fs.closeSync(fd);
  fs.writeFileSync('c2', 'old');
  const w2 = fs.promises.writeFile('c2', 'new');
  console.log(
    'readFileSync right after promises.writeFile',
    JSON.stringify(fs.readFileSync('c2', 'latin1')),
  );
  await w2;
  const w3 = fs.promises.writeFile('c3', 'x');
  console.log('existsSync right after promises.writeFile (new file)', fs.existsSync('c3'));
  await w3;
  fs.writeFileSync('c4', 'old');
  const r4 = fs.promises.readFile('c4', 'latin1');
  fs.writeFileSync('c4', 'new');
  console.log('promises.readFile then writeFileSync same tick', await r4);
  fs.writeFileSync('c5', 'kept');
  await fs.promises.writeFile('c5', 'x', { flag: 'wx' }).then(
    () => console.log('wx existing resolved'),
    (e) => console.log('wx existing rejects', e.code),
  );
  console.log('wx existing content', fs.readFileSync('c5', 'latin1'));
  const order = [fs.promises.writeFile('c6', 'first'), fs.promises.writeFile('c6', 'second!')];
  await Promise.all(order);
  console.log('two promises.writeFile one file', fs.readFileSync('c6', 'latin1'));
  const seq = [];
  fs.writeFile('c7', 'a', () => seq.push('writeFile'));
  fs.stat('.', () => seq.push('stat'));
  Promise.resolve().then(() => seq.push('promise'));
  await new Promise((r) => setTimeout(r, 20));
  console.log('callback order', seq.join(','));
  let err;
  try {
    fs.promises.writeFile('c8', 123).then(
      () => console.log('promises.writeFile(123) resolved'),
      (e) => console.log('promises.writeFile(123) rejects', e.code),
    );
  } catch (e) {
    err = e;
  }
  if (err) console.log('promises.writeFile(123) throws', err.code);
  await new Promise((r) => setTimeout(r, 20));
})();
