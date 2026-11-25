// fd write probe: node fdwrite.cjs fswrite|writesync|append|poswrite|writefilesync|stream <MiB>
// 64 KiB chunks of LCG bytes; poswrite: <MiB>*16 positional chunks into an existing all-'a' file of <MiB>.
const fs = require('node:fs');
const crypto = require('node:crypto');
const [mode, mibS] = process.argv.slice(2);
const mib = Number(mibS);
const N = mib * 1048576;
const C = 65536;
const f = `w-${mode}-${mib}.bin`;
const data = Buffer.alloc(N);
let x = 0x9e3779b9;
for (let i = 0; i < N; i++) {
  x = (Math.imul(x, 1103515245) + 12345) >>> 0;
  data[i] = x >>> 24;
}
const chunk = (k) => data.subarray(k * C, (k + 1) * C);
const chunks = N / C;
const positions = Array.from({ length: chunks }, (_, k) => ((k * 7919) % chunks) * C);
fs.rmSync(f, { force: true });
if (mode === 'poswrite') fs.writeFileSync(f, Buffer.alloc(N, 0x61));
let ticks = 0;
const iv = setInterval(() => ticks++, 1);
const t0 = performance.now();
const done = () => {
  const ms = performance.now() - t0;
  const ticksAtDone = ticks;
  clearInterval(iv);
  const back = fs.readFileSync(f);
  console.log(
    JSON.stringify({
      mode,
      mib,
      ms: Math.round(ms),
      ticks: ticksAtDone,
      size: back.length,
      sha256: crypto.createHash('sha256').update(back).digest('hex'),
    }),
  );
};
if (mode === 'fswrite') {
  const fd = fs.openSync(f, 'w');
  let k = 0;
  const step = () => {
    if (k === chunks) return fs.close(fd, done);
    fs.write(fd, chunk(k++), 0, C, null, (e) => {
      if (e) throw e;
      step();
    });
  };
  step();
} else if (mode === 'writesync' || mode === 'append') {
  const fd = fs.openSync(f, mode === 'append' ? 'a' : 'w');
  for (let k = 0; k < chunks; k++) fs.writeSync(fd, chunk(k), 0, C, null);
  fs.closeSync(fd);
  done();
} else if (mode === 'poswrite') {
  const fd = fs.openSync(f, 'r+');
  for (let k = 0; k < chunks; k++) fs.writeSync(fd, chunk(k), 0, C, positions[k]);
  fs.closeSync(fd);
  done();
} else if (mode === 'writefilesync') {
  fs.writeFileSync(f, data);
  done();
} else if (mode === 'stream') {
  const ws = fs.createWriteStream(f);
  for (let k = 0; k < chunks; k++) ws.write(chunk(k));
  ws.end();
  ws.on('close', done);
  ws.on('error', (e) => {
    console.log(JSON.stringify({ mode, mib, error: `${e.code} ${e.message}` }));
    process.exit(1);
  });
} else throw new Error(`mode ${mode}`);
