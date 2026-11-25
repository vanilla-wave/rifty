// node streamprobe.cjs read|write|many <MiB|count> [target]
// read: writeFileSync <MiB> distinct bytes (untimed), time `for await` over fs.createReadStream to the end.
// write: time fs.createWriteStream(target) 64 KiB writes + end until 'close'; sha256 of readFileSync(target).
// many: create <count> 1 KiB files under ./many/ with writeFileSync (timed, setup).
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const [mode, nS, targetArg] = process.argv.slice(2);
const n = Number(nS);
const bytesOf = (N, seed) => {
  const b = Buffer.alloc(N);
  let x = seed >>> 0;
  for (let i = 0; i < N; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
};
let ticks = 0;
let iv;
let t0;
const start = () => {
  ticks = 0;
  iv = setInterval(() => ticks++, 1);
  t0 = performance.now();
};
const stop = () => {
  const ms = performance.now() - t0;
  clearInterval(iv);
  return { ms: Math.round(ms * 10) / 10, ticks };
};
if (mode === 'many') {
  fs.mkdirSync('many', { recursive: true });
  const one = bytesOf(1024, 7);
  start();
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join('many', `f${i}.txt`), one);
  const t = stop();
  console.log(JSON.stringify({ mode, count: n, ...t, files: fs.readdirSync('many').length }));
} else if (mode === 'read') {
  const f = targetArg ?? `read-${n}.bin`;
  fs.writeFileSync(f, bytesOf(n * 1048576, 0x12345678));
  (async () => {
    const h = crypto.createHash('sha256');
    let bytes = 0;
    start();
    for await (const c of fs.createReadStream(f)) {
      h.update(c);
      bytes += c.length;
    }
    const t = stop();
    console.log(JSON.stringify({ mode, mib: n, ...t, bytes, sha256: h.digest('hex') }));
  })();
} else if (mode === 'write') {
  const f = targetArg ?? `write-${n}.bin`;
  fs.rmSync(f, { force: true });
  const data = bytesOf(n * 1048576, 0x9e3779b9);
  start();
  const ws = fs.createWriteStream(f);
  for (let o = 0; o < data.length; o += 65536) ws.write(data.subarray(o, o + 65536));
  ws.end();
  ws.on('error', (e) => {
    console.log(JSON.stringify({ mode, mib: n, error: `${e.code} ${e.message}` }));
    process.exitCode = 1;
  });
  ws.on('close', () => {
    const t = stop();
    const back = fs.readFileSync(f);
    console.log(
      JSON.stringify({
        mode,
        mib: n,
        ...t,
        size: back.length,
        sha256: crypto.createHash('sha256').update(back).digest('hex'),
      }),
    );
  });
} else throw new Error(`mode ${mode}`);
